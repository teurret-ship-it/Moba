import { DT, TICK_HZ } from '../sim/constants.ts';
import { applyMovement, tryStartMove } from '../sim/movement.ts';
import type { InputFrame, PlayerState } from '../sim/types.ts';
import type { SelfView, Snapshot } from '../sim/snapshot.ts';
import { computeStats } from '../sim/upgrades.ts';

/**
 * Predykcja ruchu własnej postaci (sekcja 7).
 *
 * Klient predykuje TYLKO własny ruch — nigdy cudzych pozycji, nigdy HP,
 * nigdy trafień. Po każdym snapshocie stan jest przywracany do wersji
 * serwera i wejścia, których serwer jeszcze nie potwierdził, są odtwarzane
 * na nowo tym samym kodem (`applyMovement`).
 *
 * Bez tego przy 100 ms opóźnienia interpolacji własna postać reagowałaby
 * z zauważalnym opóźnieniem, co na telefonie natychmiast czuć.
 */

/** Powyżej tej różnicy (w jednostkach świata) nie wygładzamy, tylko przeskakujemy. */
const SNAP_THRESHOLD = 4;
/** Jak szybko znika błąd predykcji. 1/s. */
const SMOOTHING_RATE = 12;

export class Predictor {
  /** Przewidywany stan własnej postaci — to jego pozycję renderujemy. */
  private state: PlayerState | null = null;
  /** Wejścia wysłane, ale jeszcze niepotwierdzone przez serwer. */
  private pending: InputFrame[] = [];
  /** Wizualne wygładzenie korekty — offset dodawany do pozycji, dążący do zera. */
  private errX = 0;
  private errY = 0;
  private lastServerTick = 0;

  /** Ostatnia zarejestrowana rozbieżność predykcji — do overlayu debug. */
  lastError = 0;

  recordInput(input: InputFrame): void {
    this.pending.push({ ...input });
    // Zabezpieczenie przed nieograniczonym wzrostem przy zerwanym połączeniu.
    if (this.pending.length > TICK_HZ * 3) this.pending.shift();
  }

  /** Rekoncyliacja: przywróć stan serwera i odtwórz niepotwierdzone wejścia. */
  reconcile(snapshot: Snapshot): void {
    const self = snapshot.self;
    if (!self) return;

    const beforeX = this.state?.x ?? self.x;
    const beforeY = this.state?.y ?? self.y;

    this.state = fromSelfView(self);
    this.lastServerTick = snapshot.tick;

    this.pending = this.pending.filter((i) => i.seq > snapshot.ackSeq);

    let tick = snapshot.tick;
    for (const input of this.pending) {
      tick++;
      tryStartMove(this.state, input, tick);
      applyMovement(this.state, input, tick);
    }

    const dx = beforeX - this.state.x;
    const dy = beforeY - this.state.y;
    const err = Math.hypot(dx, dy);
    this.lastError = err;

    if (err > SNAP_THRESHOLD) {
      // Duża rozbieżność = coś, czego klient nie mógł przewidzieć
      // (odrzut od fali, kolizja, śmierć). Przeskakujemy bez wygładzania —
      // udawanie, że nic się nie stało, byłoby kłamstwem wobec gracza.
      this.errX = 0;
      this.errY = 0;
    } else {
      this.errX = dx;
      this.errY = dy;
    }
  }

  /**
   * Krok predykcji dla wejścia z bieżącej klatki. Wywoływany raz na tick
   * klienta, tym samym DT co serwer.
   */
  predict(input: InputFrame): void {
    if (!this.state) return;
    this.lastServerTick++;
    tryStartMove(this.state, input, this.lastServerTick);
    applyMovement(this.state, input, this.lastServerTick);
  }

  /** Wygaszanie korekty — wywoływane z prawdziwym dt renderu. */
  decayError(dtSeconds: number): void {
    const k = Math.exp(-SMOOTHING_RATE * dtSeconds);
    this.errX *= k;
    this.errY *= k;
    if (Math.abs(this.errX) < 0.001) this.errX = 0;
    if (Math.abs(this.errY) < 0.001) this.errY = 0;
  }

  /** Pozycja do renderowania: predykcja + zanikająca korekta. */
  renderPosition(): { x: number; y: number; facing: number } | null {
    if (!this.state) return null;
    return {
      x: this.state.x + this.errX,
      y: this.state.y + this.errY,
      facing: this.state.facing,
    };
  }

  get predicted(): PlayerState | null {
    return this.state;
  }

  reset(): void {
    this.state = null;
    this.pending = [];
    this.errX = 0;
    this.errY = 0;
    this.lastError = 0;
    this.lastServerTick = 0;
  }
}

/** Minimalny `PlayerState` wystarczający do odtworzenia ruchu. */
function fromSelfView(self: SelfView): PlayerState {
  return {
    id: self.id,
    slot: self.id,
    name: '',
    isBot: false,
    colorIndex: 0,
    classId: self.classId,
    x: self.x,
    y: self.y,
    vx: self.vx,
    vy: self.vy,
    facing: self.facing,
    hp: self.hp,
    maxHp: self.maxHp,
    alive: self.alive,
    deathTick: -1,
    lastHitBy: -1,
    lastHitTick: -1,
    dashEndTick: self.dashEndTick,
    dashDirX: self.dashDirX,
    dashDirY: self.dashDirY,
    dashHits: [],

    stealthEndTick: self.stealthEndTick,
    shieldHp: self.shieldHp,
    shieldEndTick: -1,

    powerFireTick: -1,
    salvoLeft: 0,
    salvoNextTick: -1,
    salvoTargetId: -1,
    ambushReady: false,

    cdMove: self.cdMove,
    cdTrick: self.cdTrick,
    cdPower: self.cdPower,
    cdAttack: 0,

    xp: self.xp,
    level: self.level,
    upgrades: [...self.upgrades],
    offer: [],
    offerDeadlineTick: -1,
    // Te same ulepszenia dają te same statystyki co na serwerze —
    // inaczej predykcja ruchu rozjechałaby się po każdym awansie.
    stats: computeStats(self.classId, self.upgrades),
    impetusEndTick: self.impetusEndTick,
    speedBuffEndTick: self.speedBuffEndTick,
    damageBuffEndTick: self.damageBuffEndTick,
    kills: self.kills,
    damageDealt: 0,
    score: self.score,
    lastAckSeq: 0,
  };
}

export { DT };
