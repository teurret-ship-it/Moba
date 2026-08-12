import {
  BURST_COOLDOWN_TICKS,
  DASH_COOLDOWN_TICKS,
  MATCH_TICKS,
  MAX_HP,
  STEALTH_COOLDOWN_TICKS,
  TICK_HZ,
  WARMUP_TICKS,
} from '../sim/constants.ts';
import type { Snapshot } from '../sim/snapshot.ts';
import type { SimEvent } from '../sim/types.ts';
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
    cdDash: HTMLElement;
    cdStealth: HTMLElement;
    cdBurst: HTMLElement;
    warmup: HTMLElement;
    debug: HTMLElement;
    joystick: HTMLElement;
    joystickKnob: HTMLElement;
  };

  private bannerUntil = 0;

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
      cdDash: must(root, '#btn-dash .cd'),
      cdStealth: must(root, '#btn-stealth .cd'),
      cdBurst: must(root, '#btn-burst .cd'),
      warmup: must(root, '#hud-warmup'),
      debug: must(root, '#hud-debug'),
      joystick: must(root, '#joystick'),
      joystickKnob: must(root, '#joystick-knob'),
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
      const frac = Math.max(0, self.hp / MAX_HP);
      this.el.hpFill.style.width = `${frac * 100}%`;
      this.el.hpFill.dataset.level = frac > 0.5 ? 'ok' : frac > 0.25 ? 'warn' : 'low';
      this.el.hpText.textContent = String(Math.ceil(Math.max(0, self.hp)));
      this.el.kills.textContent = String(self.kills);

      this.setCooldown(this.el.cdDash, self.cdDash, snapshot.tick, DASH_COOLDOWN_TICKS);
      this.setCooldown(this.el.cdStealth, self.cdStealth, snapshot.tick, STEALTH_COOLDOWN_TICKS);
      this.setCooldown(this.el.cdBurst, self.cdBurst, snapshot.tick, BURST_COOLDOWN_TICKS);
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
        case 'matchOver':
          break;
        default:
          break;
      }
    }
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
    this.el.banner.hidden = true;
    this.el.warmup.hidden = true;
  }
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
