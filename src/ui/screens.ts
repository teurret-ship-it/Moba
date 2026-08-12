import { TICK_HZ } from '../sim/constants.ts';
import type { MatchResult } from '../sim/types.ts';
import { PLAYER_COLORS } from '../render/textures.ts';

/**
 * Ekrany poza rozgrywką: start i wynik.
 *
 * Faza 0 nie ma kont ani lobby (sekcja 19: „Backendu w tym tygodniu nie
 * ma. Świadomie."). Ekran startowy istnieje po to, żeby playtest z sekcji
 * 19 pkt 7 dało się przeprowadzić bez tłumaczenia sterowania na głos —
 * jeśli trzeba tłumaczyć, bramka Fazy 0 i tak jest niezaliczona.
 */

export class Screens {
  private readonly start: HTMLElement;
  private readonly over: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overStats: HTMLElement;
  private readonly standings: HTMLElement;

  constructor(root: HTMLElement) {
    this.start = required(root, '#screen-start');
    this.over = required(root, '#screen-over');
    this.overTitle = required(root, '#over-title');
    this.overStats = required(root, '#over-stats');
    this.standings = required(root, '#over-standings');
  }

  showStart(onPlay: () => void): void {
    this.start.hidden = false;
    this.over.hidden = true;
    const button = this.start.querySelector<HTMLButtonElement>('#btn-play');
    if (button) {
      button.onclick = () => {
        this.start.hidden = true;
        onPlay();
      };
    }
  }

  hideAll(): void {
    this.start.hidden = true;
    this.over.hidden = true;
  }

  showResult(result: MatchResult, localId: number, onAgain: () => void): void {
    const me = result.standings.find((s) => s.id === localId);
    const won = result.winner === localId;

    this.overTitle.textContent = won ? 'Zwycięstwo' : me ? `Miejsce ${me.place}` : 'Koniec rundy';
    this.overTitle.dataset.result = won ? 'win' : 'loss';

    if (me) {
      const survived = Math.round(me.survivedTicks / TICK_HZ);
      this.overStats.innerHTML = [
        stat('Eliminacje', String(me.kills)),
        stat('Obrażenia', String(me.damageDealt)),
        stat('Przetrwane', `${survived}s`),
        stat('Wynik', String(me.score)),
      ].join('');
    }

    // Tablica wyników pokazuje, że boty grają — a nie tylko istnieją.
    // Jeśli boty regularnie kończą na ostatnich miejscach, AI jest za słabe
    // i pierwsze wrażenie z sekcji 7 nie zadziała.
    this.standings.innerHTML = result.standings
      .slice(0, 8)
      .map((s) => {
        const color = PLAYER_COLORS[s.id % PLAYER_COLORS.length];
        const isMe = s.id === localId;
        return `<div class="standing-row${isMe ? ' is-me' : ''}">
          <span class="standing-place">${s.place}</span>
          <span class="standing-name" style="color:${color}">${escapeHtml(s.name)}</span>
          <span class="standing-kills">${s.kills}</span>
          <span class="standing-score">${s.score}</span>
        </div>`;
      })
      .join('');

    this.over.hidden = false;
    const button = this.over.querySelector<HTMLButtonElement>('#btn-again');
    if (button) {
      button.onclick = () => {
        this.over.hidden = true;
        onAgain();
      };
    }
  }
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`;
}

function required(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Ekran: brak elementu ${selector}`);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
