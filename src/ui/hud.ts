import { MATCH_TICKS, TICK_HZ, WARMUP_TICKS } from '../sim/constants.ts';
import {
  ABILITY_GLYPHS,
  ABILITY_NAMES,
  getClass,
  MOVE_ABILITY,
  POWER_ABILITY,
  TRICK_ABILITY,
  type ClassId,
} from '../sim/classes.ts';
import type { Snapshot } from '../sim/snapshot.ts';
import type { SimEvent } from '../sim/types.ts';
import { OFFER_DEADLINE_TICKS, UPGRADES, type UpgradeId } from '../sim/upgrades.ts';
import { PLAYER_COLORS } from '../render/textures.ts';

/**
 * HUD w DOM, nie w canvasie.
 *
 * Powód: tekst w WebGL wymaga atlasu czcionek i osobnego pipeline'u,
 * a na telefonie kosztuje więcej niż warstwa DOM, którą przeglądarka
 * i tak kompozytuje na GPU. Dodatkowo DOM daje za darmo skalowanie
 * czcionek systemowych i czytniki ekranu (Accessibility QA, Faza 2).
 */

interface KillFeedEntry {
  el: HTMLElement;
  expiresAt: number;
}

export class Hud {
  private killFeed: KillFeedEntry[] = [];

  private readonly el: {
    timer: HTMLElement;
    alive: HTMLElement;
    hpFill: HTMLElement;
    hpText: HTMLElement;
    kills: HTMLElement;
    killFeed: HTMLElement;
    banner: HTMLElement;
    hurt: HTMLElement;
    hpShield: HTMLElement;
    cdDash: HTMLElement;
    cdStealth: HTMLElement;
    cdBurst: HTMLElement;
    warmup: HTMLElement;
    debug: HTMLElement;
    joystick: HTMLElement;
    joystickKnob: HTMLElement;
    xpFill: HTMLElement;
    level: HTMLElement;
    upgradePick: HTMLElement;
    upgradeCards: HTMLElement;
    upgradeLevel: HTMLElement;
    upgradeTimer: HTMLElement;
    deadPanel: HTMLElement;
    deadPlace: HTMLElement;
    requeue: HTMLButtonElement;
    mute: HTMLButtonElement;
  };

  private bannerUntil = 0;
  private shownClass: ClassId | null = null;
  /** Podpis oferty aktualnie narysowanej — żeby nie przerysowywać co klatkę. */
  private shownOffer = '';
  private onPick: ((index: number) => void) | null = null;
  private onRequeue: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = {
      timer: must(root, '#hud-timer'),
      alive: must(root, '#hud-alive'),
      hpFill: must(root, '#hud-hp-fill'),
      hpText: must(root, '#hud-hp-text'),
      kills: must(root, '#hud-kills'),
      killFeed: must(root, '#hud-killfeed'),
      banner: must(root, '#hud-banner'),
      hurt: must(root, '#hud-hurt'),
      hpShield: must(root, '#hud-hp-shield'),
      cdDash: must(root, '#btn-dash .cd'),
      cdStealth: must(root, '#btn-stealth .cd'),
      cdBurst: must(root, '#btn-burst .cd'),
      warmup: must(root, '#hud-warmup'),
      debug: must(root, '#hud-debug'),
      joystick: must(root, '#joystick'),
      joystickKnob: must(root, '#joystick-knob'),
      xpFill: must(root, '#hud-xp-fill'),
      level: must(root, '#hud-level'),
      upgradePick: must(root, '#upgrade-pick'),
      upgradeCards: must(root, '#upgrade-cards'),
      upgradeLevel: must(root, '#upgrade-level'),
      upgradeTimer: must(root, '#upgrade-timer'),
      deadPanel: must(root, '#dead-panel'),
      deadPlace: must(root, '#dead-place'),
      requeue: must(root, '#btn-requeue') as HTMLButtonElement,
      mute: must(root, '#btn-mute') as HTMLButtonElement,
    };
  }

  update(snapshot: Snapshot, now: number): void {
    const { self } = snapshot;

    // Czas do końca rundy.
    const remaining = Math.max(0, MATCH_TICKS - snapshot.tick);
    const seconds = Math.ceil(remaining / TICK_HZ);
    this.el.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('is-urgent', seconds <= 30);

    this.el.alive.textContent = String(snapshot.aliveCount);

    if (self) {
      const cls = getClass(self.classId);
      // Etykiety przycisków zależą od klasy — ustawiamy je raz, gdy klasa
      // się zmienia, a nie co klatkę.
      if (this.shownClass !== self.classId) {
        this.shownClass = self.classId;
        this.labelButtons(self.classId);
      }

      const frac = Math.max(0, self.hp / self.maxHp);
      this.el.hpFill.style.width = `${frac * 100}%`;
      this.el.hpFill.dataset.level = frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'low';
      this.el.hpText.textContent = String(Math.ceil(Math.max(0, self.hp)));

      // Tarcza rysowana jako nakładka na pasku HP — Kolos musi widzieć,
      // ile jeszcze wytrzyma, bez patrzenia na postać.
      const shieldFrac = Math.max(0, Math.min(1, self.shieldHp / self.maxHp));
      this.el.hpShield.style.width = `${shieldFrac * 100}%`;
      this.el.hpShield.hidden = shieldFrac <= 0;
      this.el.kills.textContent = String(self.kills);

      // Pasek doświadczenia i poziom.
      this.el.xpFill.style.width = `${Math.min(100, (self.xp / Math.max(1, self.xpForNext)) * 100)}%`;
      this.el.level.textContent = String(self.level);

      this.syncOffer(self.offer, self.level, self.offerDeadlineTick, snapshot.tick, self.upgrades);
      this.syncDead(self.alive, snapshot.aliveCount);

      this.setCooldown(this.el.cdDash, self.cdMove, snapshot.tick, MOVE_ABILITY[cls.move].cooldownTicks);
      this.setCooldown(this.el.cdStealth, self.cdTrick, snapshot.tick, TRICK_ABILITY[cls.trick].cooldownTicks);
      this.setCooldown(this.el.cdBurst, self.cdPower, snapshot.tick, POWER_ABILITY[cls.power].cooldownTicks);
    }

    // Odliczanie startu.
    if (snapshot.phase === 'warmup') {
      const left = Math.ceil((WARMUP_TICKS - snapshot.tick) / TICK_HZ);
      this.el.warmup.textContent = left > 0 ? String(left) : 'START';
      this.el.warmup.hidden = false;
    } else {
      this.el.warmup.hidden = true;
    }

    if (now > this.bannerUntil) this.el.banner.hidden = true;
    this.pruneKillFeed(now);
  }

  /** Zdarzenia z ostatniego snapshotu — killfeed, komunikaty, czerwony błysk. */
  handleEvents(events: SimEvent[], selfId: number, names: Map<number, string>, colors: Map<number, number>, now: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'kill': {
          const victim = names.get(e.victim) ?? '?';
          const killer = e.killer >= 0 ? names.get(e.killer) ?? '?' : null;
          this.pushKill(
            killer,
            victim,
            e.killer >= 0 ? colors.get(e.killer) ?? 0 : -1,
            colors.get(e.victim) ?? 0,
            now,
          );
          if (e.victim === selfId) this.banner('Wyeliminowany', 2500, now);
          break;
        }
        case 'damage':
          if (e.target === selfId) this.flashHurt();
          break;
        case 'zoneShrink':
          this.banner('Strefa się zaciska', 2200, now);
          break;
        case 'supplyWarn':
          this.banner('Zrzut zaopatrzenia', 2500, now);
          break;
        case 'objectiveWarn':
          this.banner('Rdzeń się budzi', 2600, now);
          break;
        case 'objectiveSpawn':
          this.banner('Rdzeń aktywny — stań w kręgu', 2600, now);
          break;
        case 'objectiveCaptured':
          this.banner(
            e.player === selfId ? 'Rdzeń przejęty' : `${names.get(e.player) ?? '?'} przejmuje Rdzeń`,
            2600,
            now,
          );
          break;
        case 'upgradePicked':
          if (e.player === selfId) this.banner(UPGRADES[e.upgrade].name, 1600, now);
          break;
        case 'revive':
          if (e.player === selfId) this.banner('Drugie życie', 2200, now);
          break;
        case 'matchOver':
          break;
        default:
          break;
      }
    }
  }

  /** Przełącznik dźwięku. `onToggle` zwraca nowy stan wyciszenia. */
  bindMute(onToggle: () => boolean, initiallyMuted: boolean): void {
    const paint = (muted: boolean) => {
      this.el.mute.textContent = muted ? '🔇' : '🔊';
      this.el.mute.classList.toggle('is-off', muted);
      this.el.mute.setAttribute('aria-pressed', String(muted));
    };
    paint(initiallyMuted);
    this.el.mute.onclick = () => paint(onToggle());
  }

  /** Podpięcie akcji gracza spoza gałki i przycisków akcji. */
  bindActions(onPick: (index: number) => void, onRequeue: () => void): void {
    this.onPick = onPick;
    this.onRequeue = onRequeue;
    this.el.requeue.onclick = () => this.onRequeue?.();
  }

  /**
   * Karty ulepszeń.
   *
   * Rysowane tylko przy zmianie oferty — przy 60 klatkach na sekundę
   * przebudowa DOM co klatkę kosztowałaby więcej niż cała reszta HUD-u.
   */
  private syncOffer(
    offer: readonly UpgradeId[],
    level: number,
    deadlineTick: number,
    tick: number,
    owned: readonly UpgradeId[],
  ): void {
    if (offer.length === 0) {
      if (this.shownOffer !== '') {
        this.shownOffer = '';
        this.el.upgradePick.hidden = true;
        this.el.upgradeCards.innerHTML = '';
      }
      return;
    }

    const signature = offer.join(',');
    if (signature !== this.shownOffer) {
      this.shownOffer = signature;
      this.el.upgradeLevel.textContent = `Poziom ${level}`;
      this.el.upgradeCards.innerHTML = '';

      offer.forEach((id, index) => {
        const def = UPGRADES[id];
        const stacks = owned.reduce((n, u) => (u === id ? n + 1 : n), 0);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'upgrade-card';
        card.innerHTML =
          `<span class="upgrade-glyph">${def.glyph}</span>` +
          `<span class="upgrade-name">${escapeHtml(def.name)}</span>` +
          `<span class="upgrade-text">${escapeHtml(def.text)}</span>` +
          (stacks > 0 ? `<span class="upgrade-stack">masz ${stacks}×</span>` : '');
        card.onclick = () => this.onPick?.(index);
        this.el.upgradeCards.appendChild(card);
      });

      this.el.upgradePick.hidden = false;
    }

    // Odliczanie: po nim wybór rozstrzyga się sam, więc gracz musi je widzieć.
    const left = Math.max(0, deadlineTick - tick);
    this.el.upgradeTimer.textContent = `${Math.ceil(left / TICK_HZ)} s`;
    void OFFER_DEADLINE_TICKS;
  }

  /**
   * Panel po śmierci.
   *
   * Sekcja 14, bramka Fazy 0: liczy się chęć zagrania JESZCZE RAZ. Gracz
   * wyeliminowany w połowie rundy nie może być skazany na oglądanie cudzej
   * końcówki — dostaje wyjście od razu, ale nie jest do niego zmuszany.
   */
  private syncDead(alive: boolean, aliveCount: number): void {
    if (alive) {
      if (!this.el.deadPanel.hidden) this.el.deadPanel.hidden = true;
      return;
    }
    if (this.el.deadPanel.hidden) {
      this.el.deadPanel.hidden = false;
    }
    this.el.deadPlace.textContent = `zostało ${aliveCount} graczy`;
  }

  /** Podmiana nazw i symboli na przyciskach zgodnie z klasą. */
  private labelButtons(classId: ClassId): void {
    const cls = getClass(classId);
    setButton(this.el.cdDash, cls.move);
    setButton(this.el.cdStealth, cls.trick);
    setButton(this.el.cdBurst, cls.power);
  }

  setDebug(lines: string[]): void {
    this.el.debug.textContent = lines.join('\n');
  }

  toggleDebug(visible: boolean): void {
    this.el.debug.hidden = !visible;
  }

  /** Rysowanie pływającej gałki — pozycje w pikselach ekranu. */
  setJoystick(active: boolean, baseX: number, baseY: number, knobX: number, knobY: number): void {
    this.el.joystick.hidden = !active;
    if (!active) return;
    this.el.joystick.style.transform = `translate(${baseX}px, ${baseY}px)`;
    this.el.joystickKnob.style.transform = `translate(${knobX - baseX}px, ${knobY - baseY}px)`;
  }

  banner(text: string, durationMs: number, now: number): void {
    this.el.banner.textContent = text;
    this.el.banner.hidden = false;
    this.bannerUntil = now + durationMs;
  }

  private flashHurt(): void {
    this.el.hurt.classList.remove('is-active');
    // Wymuszenie reflow, żeby animacja odpaliła przy szybkich, kolejnych trafieniach.
    void this.el.hurt.offsetWidth;
    this.el.hurt.classList.add('is-active');
  }

  private setCooldown(el: HTMLElement, readyTick: number, tick: number, total: number): void {
    const left = readyTick - tick;
    if (left <= 0) {
      el.style.setProperty('--cd', '0');
      el.textContent = '';
      el.parentElement?.classList.remove('is-cooling');
      return;
    }
    el.style.setProperty('--cd', String(left / total));
    el.textContent = String(Math.ceil(left / TICK_HZ));
    el.parentElement?.classList.add('is-cooling');
  }

  private pushKill(
    killer: string | null,
    victim: string,
    killerColor: number,
    victimColor: number,
    now: number,
  ): void {
    const el = document.createElement('div');
    el.className = 'killfeed-row';
    if (killer) {
      el.innerHTML =
        `<span style="color:${PLAYER_COLORS[killerColor % PLAYER_COLORS.length]}">${escapeHtml(killer)}</span>` +
        `<span class="killfeed-sep">✕</span>` +
        `<span style="color:${PLAYER_COLORS[victimColor % PLAYER_COLORS.length]}">${escapeHtml(victim)}</span>`;
    } else {
      el.innerHTML =
        `<span class="killfeed-sep">strefa</span>` +
        `<span class="killfeed-sep">✕</span>` +
        `<span style="color:${PLAYER_COLORS[victimColor % PLAYER_COLORS.length]}">${escapeHtml(victim)}</span>`;
    }
    this.el.killFeed.prepend(el);
    this.killFeed.push({ el, expiresAt: now + 5000 });
    while (this.killFeed.length > 5) {
      const oldest = this.killFeed.shift();
      oldest?.el.remove();
    }
  }

  private pruneKillFeed(now: number): void {
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      const entry = this.killFeed[i]!;
      if (entry.expiresAt <= now) {
        entry.el.remove();
        this.killFeed.splice(i, 1);
      }
    }
  }

  reset(): void {
    for (const entry of this.killFeed) entry.el.remove();
    this.killFeed = [];
    this.shownOffer = '';
    this.el.upgradePick.hidden = true;
    this.el.upgradeCards.innerHTML = '';
    this.el.deadPanel.hidden = true;
    this.el.banner.hidden = true;
    this.el.warmup.hidden = true;
  }
}

/** Ustawia symbol i nazwę na przycisku (rodzeństwo elementu `.cd`). */
function setButton(cdEl: HTMLElement, ability: keyof typeof ABILITY_NAMES): void {
  const btn = cdEl.parentElement;
  if (!btn) return;
  const glyph = btn.querySelector<HTMLElement>('.action-glyph');
  const name = btn.querySelector<HTMLElement>('.action-name');
  if (glyph) glyph.textContent = ABILITY_GLYPHS[ability];
  if (name) name.textContent = ABILITY_NAMES[ability];
  btn.setAttribute('aria-label', ABILITY_NAMES[ability]);
}

function must(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`HUD: brak elementu ${selector}`);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
