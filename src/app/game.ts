import {
  MAX_PLAYERS,
  TICK_HZ,
  TICK_MS,
} from '../sim/constants.ts';
import type { Snapshot } from '../sim/snapshot.ts';
import { POWER_ABILITY, type ClassId } from '../sim/classes.ts';
import { generateTerrain } from '../sim/terrain.ts';
import { SnapshotBuffer } from '../client/interpolation.ts';
import { Predictor } from '../client/prediction.ts';
import { LocalTransport, NET_PROFILES, type NetSimConfig } from '../client/transport.ts';
import { Controls } from '../input/controls.ts';
import { ArenaRenderer } from '../render/renderer.ts';
import { PICKUP_COLORS } from '../render/textures.ts';
import { Hud } from '../ui/hud.ts';
import { Screens } from '../ui/screens.ts';
import { Sfx } from '../audio/sfx.ts';
import { CombatFeedback } from '../ui/feedback.ts';
import { RecordStore } from './records.ts';
import { Haptics, SettingsStore } from './settings.ts';
import { TICK_HZ as SIM_HZ } from '../sim/constants.ts';

/**
 * Spięcie wszystkiego w pętlę.
 *
 * Pętla ma stały krok symulacji (TICK_MS) i zmienny krok renderu.
 * To nie jest kosmetyka: przy zmiennym kroku symulacji ten sam skok
 * pokonuje inny dystans na telefonie z 30 FPS niż na desktopie z 120 FPS,
 * a w Fazie 1 klient i serwer natychmiast się rozjeżdżają.
 */

/** Sekcja 4: powrót po >30 s = pełny re-sync, nie wznowienie z pamięci. */
const RESYNC_AFTER_MS = 30_000;
/** Górna granica nadrabiania ticków w jednej klatce — ochrona przed spiralą. */
const MAX_CATCHUP_TICKS = 5;

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  netProfile?: string;
  debug?: boolean;
}

export class Game {
  private readonly renderer: ArenaRenderer;
  private readonly controls: Controls;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly sfx = new Sfx();
  private readonly feedback: CombatFeedback;
  private readonly records = new RecordStore();
  private readonly settings = new SettingsStore();
  private readonly haptics = new Haptics(this.settings);
  private readonly firstRunHints: HTMLElement;

  private transport: LocalTransport | null = null;
  private buffer = new SnapshotBuffer();
  private predictor = new Predictor();
  private latestSnapshot: Snapshot | null = null;

  private readonly localPlayerId = 0;
  private localClass: ClassId = 'lowca';
  private names = new Map<number, string>();
  private colors = new Map<number, number>();
  private classes = new Map<number, string>();

  private running = false;
  private accumulator = 0;
  private lastFrame = 0;
  private hiddenAt = 0;
  private rafHandle = 0;

  private netProfile: NetSimConfig;
  private debugVisible: boolean;

  // Pomiary do budżetów z sekcji 4 i 13.
  private fpsSamples: number[] = [];
  private matchStartBytes = 0;
  private worstFrameMs = 0;

  constructor(opts: GameOptions) {
    this.renderer = new ArenaRenderer(opts.canvas);
    this.hud = new Hud(opts.uiRoot);
    this.screens = new Screens(opts.uiRoot);
    this.feedback = new CombatFeedback(opts.uiRoot);
    this.firstRunHints = required(opts.uiRoot, '#first-run-hints');
    this.netProfile = NET_PROFILES[opts.netProfile ?? 'local'] ?? NET_PROFILES.local!;
    this.debugVisible = opts.debug ?? false;
    this.hud.toggleDebug(this.debugVisible);

    this.controls = new Controls(opts.canvas, {
      dash: required(opts.uiRoot, '#btn-dash'),
      stealth: required(opts.uiRoot, '#btn-stealth'),
      burst: required(opts.uiRoot, '#btn-burst'),
    });

    // Ustawienia sterowania i odbioru wchodzą w życie od razu, także
    // w trakcie rundy — przełącznik, który wymaga restartu, w praktyce
    // nie zostanie użyty.
    this.applySettings();
    this.settings.onChange(() => this.applySettings());

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('keydown', this.onKeyDown);

    this.hud.bindActions(
      (index) => this.controls.choose(index),
      () => this.startMatch(),
    );

    this.hud.bindMute(
      () => this.sfx.toggleMute(),
      this.sfx.isMuted,
    );

    this.screens.bindSettings(this.settings);

    this.screens.showStart((classId) => {
      // Kontekst audio wolno obudzić tylko z gestu użytkownika — „Graj"
      // jest jedynym pewnym miejscem, przez które przechodzi każdy gracz.
      this.sfx.unlock();
      this.startMatch(undefined, classId);
    });
  }

  private applySettings(): void {
    const s = this.settings.current;
    this.controls.setHandedness(s.handed);
    this.renderer.setMotionAllowed(this.settings.motionAllowed);
    // Klasa na <body> przestawia układ HUD-u — logika sterowania nie musi
    // wiedzieć nic o pikselach, a CSS nic o wejściu.
    document.body.dataset.handed = s.handed;
  }

  startMatch(seed?: number, classId?: ClassId): void {
    const matchSeed = seed ?? (Math.random() * 0xffffffff) >>> 0;
    if (classId) this.localClass = classId;
    this.transport?.dispose();
    this.renderer.reset();
    this.hud.reset();
    this.feedback.reset();
    this.firstRunHints.hidden = true;
    this.buffer.clear();
    this.predictor.reset();
    this.screens.hideAll();

    this.transport = new LocalTransport(
      {
        seed: matchSeed,
        playerCount: MAX_PLAYERS,
        humanCount: 1,
        localName: 'Ty',
        localClass: this.localClass,
      },
      this.localPlayerId,
      this.netProfile,
    );

    this.names.clear();
    this.colors.clear();
    this.classes.clear();
    for (const p of this.transport.sim.world.players) {
      this.names.set(p.id, p.name);
      this.colors.set(p.id, p.colorIndex);
      this.classes.set(p.id, p.classId);
    }

    // Teren odtwarzamy z ziarna — tak samo jak klient w Fazie 1, który
    // dostanie ziarno w handshake, a nie listę przeszkód co ramkę.
    this.renderer.setTerrain(generateTerrain(matchSeed));

    this.transport.onSnapshot((snapshot) => this.onSnapshot(snapshot));
    this.matchStartBytes = this.transport.stats.bytesReceived;
    this.worstFrameMs = 0;
    this.fpsSamples = [];

    // Podpowiedzi tylko przy pierwszej rundzie w życiu — i tylko przez
    // kilka sekund. Przy trzeciej rundzie byłyby już wyłącznie hałasem.
    this.firstRunHints.hidden = !this.records.isFirstEver;

    this.accumulator = 0;
    this.lastFrame = performance.now();
    if (!this.running) {
      this.running = true;
      this.rafHandle = requestAnimationFrame(this.frame);
    }
  }

  private onSnapshot(snapshot: Snapshot): void {
    this.latestSnapshot = snapshot;
    this.buffer.push(snapshot, performance.now());
    this.predictor.reconcile(snapshot);

    this.hud.handleEvents(snapshot.events, this.localPlayerId, this.names, this.colors, performance.now());

    const self = snapshot.self;

    for (const e of snapshot.events) {
      switch (e.type) {
        case 'damage': {
          this.renderer.fx.hit(e.x, e.y, e.amount);
          const now = performance.now();
          if (e.target === this.localPlayerId) {
            this.playAt('hurt', e.x, e.y, self, snapshot.tick);
            this.feedback.addNumber(e.x, e.y, e.amount, 'taken', now);
            // Skąd przyszedł cios. Napastnik bywa poza kadrem, więc bez
            // tego gracz naprawdę nie wie, co go zabiło.
            const src = snapshot.players.find((p) => p.id === e.source);
            if (src && self) {
              const angle = Math.atan2(src.y - self.y, src.x - self.x);
              this.feedback.addDamageDirection(angle, now);
              // Wstrząs wzdłuż wektora ciosu: kamera jest odpychana OD
              // napastnika, więc sam ruch obrazu mówi, skąd przyszło.
              this.renderer.shake(0.25, -Math.cos(angle), -Math.sin(angle));
            } else {
              this.renderer.shake(0.25);
            }
            // Trzeci kanał: dłoń. Obraz i dźwięk mogą umknąć — telefon
            // trzymany w ręce nie umyka. Impuls jest krótki i dławiony,
            // bo obrywa się kilka razy na sekundę.
            this.haptics.pulse(e.amount >= 20 ? 26 : 14, 120);
          } else if (e.source === this.localPlayerId) {
            this.playAt('attack', e.x, e.y, self, snapshot.tick);
            this.feedback.addNumber(e.x, e.y, e.amount, 'dealt', now);
            // Mocny cios zatrzymuje obraz na moment — trafienie ma „ważyć".
            if (e.amount >= 25) this.renderer.freeze(0.05);
          }
          break;
        }
        case 'kill':
          // Eliminacja to jedyne zdarzenie warte mocniejszego impulsu —
          // i jedyne, przy którym na pewno nie zleją się dwa pod rząd.
          if (e.killer === this.localPlayerId) this.haptics.pulse(34, 200);
          break;
        case 'burst':
          this.renderer.fx.burst(e.x, e.y, e.radius, this.colors.get(e.player) ?? 0);
          if (e.player === this.localPlayerId) this.renderer.shake(0.35);
          this.playAt('burst', e.x, e.y, self, snapshot.tick);
          break;
        case 'rend':
          this.renderer.fx.rend(e.x, e.y, e.facing, POWER_ABILITY.rozdarcie.range, this.colors.get(e.player) ?? 0);
          if (e.player === this.localPlayerId) this.renderer.shake(0.2);
          this.playAt('rend', e.x, e.y, self, snapshot.tick);
          break;
        case 'salvo': {
          const target = snapshot.players.find((p) => p.id === e.target);
          if (target) this.renderer.fx.tracer(e.x, e.y, target.x, target.y, this.colors.get(e.player) ?? 0);
          this.playAt('salvo', e.x, e.y, self, snapshot.tick);
          break;
        }
        case 'shieldUp':
          this.renderer.fx.shield(e.x, e.y, true);
          this.playAt('shieldUp', e.x, e.y, self, snapshot.tick);
          break;
        case 'decoySpawn':
          this.renderer.fx.stealth(e.x, e.y, true);
          this.playAt('stealthIn', e.x, e.y, self, snapshot.tick);
          break;
        case 'decoyBreak':
          this.renderer.fx.stealth(e.x, e.y, false);
          this.playAt('shieldBreak', e.x, e.y, self, snapshot.tick);
          break;
        case 'swap':
          this.renderer.fx.dash(e.x, e.y, this.colors.get(e.player) ?? 0);
          this.playAt('blink', e.x, e.y, self, snapshot.tick);
          break;
        case 'snare':
          this.renderer.fx.burst(e.x, e.y, e.radius, this.colors.get(e.player) ?? 0);
          this.playAt('shieldUp', e.x, e.y, self, snapshot.tick);
          break;
        case 'levelUp': {
          const me = snapshot.players.find((p) => p.id === e.player);
          if (me) this.renderer.fx.levelUp(me.x, me.y);
          // Awans jest komunikatem interfejsu, nie zdarzeniem w świecie —
          // gra bez tłumienia odległością, na pełnej głośności.
          this.sfx.play('levelUp', { tick: snapshot.tick });
          break;
        }
        case 'upgradePicked':
          this.sfx.play('upgrade', { tick: snapshot.tick });
          break;
        case 'revive': {
          this.renderer.fx.death(e.x, e.y, this.colors.get(e.player) ?? 0);
          if (e.player === this.localPlayerId) this.renderer.shake(0.5);
          this.sfx.play('revive', { tick: snapshot.tick });
          break;
        }
        case 'shieldBreak':
          this.renderer.fx.shield(e.x, e.y, false);
          if (e.player === this.localPlayerId) this.renderer.shake(0.3);
          this.playAt('shieldBreak', e.x, e.y, self, snapshot.tick);
          break;
        case 'dash': {
          this.renderer.fx.dash(e.x, e.y, this.colors.get(e.player) ?? 0);
          const cls = this.classes.get(e.player);
          this.playAt(cls === 'widmo' ? 'blink' : 'dash', e.x, e.y, self, snapshot.tick);
          break;
        }
        case 'stealthIn':
          this.renderer.fx.stealth(e.x, e.y, true);
          this.playAt('stealthIn', e.x, e.y, self, snapshot.tick);
          break;
        case 'stealthOut':
          this.renderer.fx.stealth(e.x, e.y, false);
          this.playAt('stealthOut', e.x, e.y, self, snapshot.tick);
          break;
        case 'pickup':
          this.renderer.fx.pickup(e.x, e.y, PICKUP_COLORS[e.kind]);
          this.playAt('pickup', e.x, e.y, self, snapshot.tick);
          break;
        case 'zoneShrink':
          this.sfx.play('zone', { tick: snapshot.tick });
          break;
        case 'supplyWarn':
        case 'supplyDrop':
          this.renderer.fx.supplyMarker(e.x, e.y);
          this.sfx.play('supply', { tick: snapshot.tick });
          break;
        case 'objectiveWarn':
        case 'objectiveSpawn':
          this.renderer.fx.supplyMarker(e.x, e.y);
          this.sfx.play('supply', { tick: snapshot.tick });
          break;
        case 'objectiveCaptured':
          this.renderer.fx.levelUp(e.x, e.y);
          this.sfx.play(e.player === this.localPlayerId ? 'win' : 'zone', { tick: snapshot.tick });
          break;
        default:
          break;
      }
    }

    // Śmierć postaci lokalnej — efekt musi być natychmiastowy i wyraźny.
    for (const e of snapshot.events) {
      if (e.type === 'kill') {
        const victimColor = this.colors.get(e.victim) ?? 0;
        const view = snapshot.players.find((p) => p.id === e.victim);
        if (view) this.renderer.fx.death(view.x, view.y, victimColor);
        if (e.victim === this.localPlayerId) {
          this.renderer.shake(0.8);
          this.sfx.play('death', { tick: snapshot.tick });
        } else if (e.killer === this.localPlayerId) {
          this.sfx.play('kill', { tick: snapshot.tick });
          this.renderer.freeze(0.09);
        }
      }
    }
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);

    const frameStart = now;
    let dt = now - this.lastFrame;
    this.lastFrame = now;

    // Klatka dłuższa niż 250 ms = przeglądarka nas uśpiła. Nadrabianie
    // takiej dziury krok po kroku daje przewijanie w przód; zamiast tego
    // odrzucamy zaległość (w Fazie 1 zrobi to re-sync z serwerem).
    if (dt > 250) dt = TICK_MS;
    this.accumulator += dt;

    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.accumulator -= TICK_MS;
      ticks++;
      this.tick(now);
    }
    if (ticks >= MAX_CATCHUP_TICKS) this.accumulator = 0;

    this.transport?.pump(now);
    this.draw(now, dt / 1000);

    const frameMs = performance.now() - frameStart;
    if (frameMs > this.worstFrameMs) this.worstFrameMs = frameMs;
    // Adaptacja jakości karmi się rzeczywistym czasem klatki. Klasy
    // urządzenia nie da się wykryć — da się ją tylko zmierzyć.
    this.renderer.tuneQuality(dt);
    this.fpsSamples.push(1000 / Math.max(1, dt));
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
  };

  /** Jeden krok o stałym czasie: wejście → predykcja → wysyłka → serwer. */
  private tick(now: number): void {
    const transport = this.transport;
    if (!transport) return;

    const input = this.controls.sample();
    this.predictor.recordInput(input);
    this.predictor.predict(input);
    transport.sendInput(input);
    transport.serverTick(now);

    if (transport.sim.world.phase === 'over' && transport.sim.canRestart()) {
      this.finishMatch();
    }
  }

  private draw(now: number, dtSeconds: number): void {
    const state = this.buffer.sample(now);
    if (!state) return;

    this.predictor.decayError(dtSeconds);
    const self = this.predictor.renderPosition();

    this.renderer.render(state, self, this.localPlayerId, dtSeconds);

    const snapshot = this.latestSnapshot;
    if (snapshot) {
      this.hud.update(snapshot, now);

      const me = snapshot.self;
      if (me) {
        this.feedback.setLowHp(me.alive ? me.hp / me.maxHp : 0);
        const pos = self ?? me;
        const dz = Math.hypot(pos.x - state.zone.x, pos.y - state.zone.y);
        this.feedback.setZoneCompass(
          me.alive && dz > state.zone.radius,
          Math.atan2(state.zone.y - pos.y, state.zone.x - pos.x),
        );
      }
    }
    this.feedback.update(now, (x, y, h) => this.renderer.project(x, y, h));

    const controls = this.controls.state;
    this.hud.setJoystick(
      controls.joystickActive,
      controls.joystickBaseX,
      controls.joystickBaseY,
      controls.joystickKnobX,
      controls.joystickKnobY,
    );

    if (this.debugVisible) this.updateDebug();
  }

  private finishMatch(): void {
    const transport = this.transport;
    if (!transport) return;
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.controls.releaseAll();

    const result = transport.sim.result();
    this.sfx.play(result.winner === this.localPlayerId ? 'win' : 'death');

    const me = result.standings.find((s) => s.id === this.localPlayerId);
    const beaten = me
      ? this.records.record({
          place: me.place,
          players: result.standings.length,
          kills: me.kills,
          damage: me.damageDealt,
          survivedSeconds: Math.round(me.survivedTicks / SIM_HZ),
          score: me.score,
          level: me.level,
          classId: this.localClass,
          won: result.winner === this.localPlayerId,
        })
      : undefined;

    this.screens.showResult(
      result,
      this.localPlayerId,
      () => this.startMatch(),
      beaten ? { current: this.records.current, beaten } : undefined,
    );
  }

  /**
   * Pomiary kontrolne wobec budżetów z sekcji 4 i 13.
   *
   * To nie jest gadżet. „Zużycie danych / mecz ≤1,5 MB" i „FPS ≥30" są
   * kryteriami wyjścia, a nie da się ich poprawić po fakcie bez przebudowy
   * widoku. Mierzymy je od pierwszego prototypu, żeby wiedzieć, czy
   * projekt snapshotu w ogóle mieści się w budżecie.
   */
  private updateDebug(): void {
    const transport = this.transport;
    if (!transport) return;

    const avgFps =
      this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);
    const matchBytes = transport.stats.bytesReceived - this.matchStartBytes;
    const tick = transport.sim.world.tick;
    const seconds = Math.max(1, tick / TICK_HZ);
    const projectedPerMatch = (matchBytes / seconds) * 240;

    const gpu = this.renderer.budgetStats;
    this.hud.setDebug([
      `fps ${avgFps.toFixed(0)}  najgorsza klatka ${this.worstFrameMs.toFixed(1)} ms`,
      // Wywołania rysowania są jedynym budżetem wydajności, który da się
      // odczytać bez profilera — a na telefonie wytyczne mówią o pułapie ~50.
      `rysowanie ${gpu.calls} wywołań  ${(gpu.triangles / 1000).toFixed(1)}k trójkątów  piksele ×${gpu.pixelRatio.toFixed(2)}`,
      `tick ${tick}  snapshoty ${transport.stats.snapshotsReceived}  bufor ${this.buffer.size}`,
      `w kadrze: gracze ${this.latestSnapshot?.players.length ?? 0}  kopie ${this.latestSnapshot?.decoys.length ?? 0}  dropy ${this.latestSnapshot?.pickups.length ?? 0}`,
      `snapshot ${transport.stats.lastSnapshotBytes} B  (~${(transport.stats.lastSnapshotBytes * 15 / 1024).toFixed(1)} kB/s)`,
      `mecz ${(matchBytes / 1024).toFixed(0)} kB  prognoza ${(projectedPerMatch / 1024 / 1024).toFixed(2)} MB / 4 min`,
      `budżet 1,5 MB ${projectedPerMatch < 1.5 * 1024 * 1024 ? 'OK' : 'PRZEKROCZONY'}`,
      `błąd predykcji ${this.predictor.lastError.toFixed(3)}  zgubione ${transport.stats.droppedPackets}`,
      `sieć lat ${this.netProfile.latencyMs}±${this.netProfile.jitterMs} ms  loss ${(this.netProfile.loss * 100).toFixed(1)}%`,
    ]);
  }

  /**
   * Dźwięk zdarzenia w świecie: tłumiony odległością i panoramowany
   * względem gracza, żeby niósł informację „gdzie", a nie tylko „coś".
   */
  private playAt(
    name: Parameters<Sfx['play']>[0],
    x: number,
    y: number,
    self: { x: number; y: number } | null,
    tick: number,
  ): void {
    if (!self) {
      this.sfx.play(name, { tick });
      return;
    }
    const dx = x - self.x;
    const dy = y - self.y;
    this.sfx.play(name, {
      dist: Math.hypot(dx, dy),
      pan: Math.max(-1, Math.min(1, dx / 22)),
      tick,
    });
  }

  private onResize = (): void => {
    this.renderer.resize();
  };

  /**
   * Cykl życia na mobilnym (sekcja 4: „mobile jest wrogi").
   *
   * Faza 0 nie ma serwera, więc „re-sync" oznacza wyczyszczenie bufora
   * interpolacji i predykcji. W Fazie 1 dokładnie w tym miejscu wchodzi
   * ponowne połączenie WS i 45-sekundowe okno na reconnect.
   */
  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      this.controls.releaseAll();
      // Telefon nie może grać w kieszeni.
      this.sfx.setSuspended(true);
      return;
    }

    this.sfx.setSuspended(false);

    const away = performance.now() - this.hiddenAt;
    this.lastFrame = performance.now();
    this.accumulator = 0;

    if (away > RESYNC_AFTER_MS) {
      this.buffer.clear();
      this.predictor.reset();
      this.hud.banner('Ponowna synchronizacja', 1500, performance.now());
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3' || e.code === 'Backquote') {
      e.preventDefault();
      this.debugVisible = !this.debugVisible;
      this.hud.toggleDebug(this.debugVisible);
    }
  };

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('keydown', this.onKeyDown);
    this.controls.dispose();
    this.transport?.dispose();
    this.renderer.dispose();
    this.sfx.dispose();
    this.feedback.dispose();
  }
}

function required(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Gra: brak elementu ${selector}`);
  return el;
}
