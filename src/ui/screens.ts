import { TICK_HZ } from '../sim/constants.ts';
import {
  ABILITY_GLYPHS,
  ABILITY_NAMES,
  CLASS_IDS,
  getClass,
  type ClassId,
} from '../sim/classes.ts';
import type { MatchResult } from '../sim/types.ts';
import type { BeatenRecords, Records } from '../app/records.ts';
import { PLAYER_COLORS } from '../render/textures.ts';

/** Jedno zdanie na umiejętność — czytane raz, przed pierwszą rundą. */
const ABILITY_HINTS: Record<string, string> = {
  skok: 'krótki wyskok — wyjdź z opresji albo dogoń',
  szarza: 'wjeżdżasz w tłum, tratując i odrzucając po drodze',
  mgnienie: 'teleport — nie da się cię trafić w locie',
  zamiana: 'zamieniasz się miejscami z własną kopią — na dowolny dystans',
  cien: 'znikasz naprawdę: przeciwnik przestaje cię widzieć',
  zwod: 'stawiasz nieruchomą kopię siebie; wrogowie biją w nią',
  sidla: 'obszarowe spowolnienie — nie zabija, ale odbiera wybór',
  tarcza: 'bańka, która pochłania obrażenia zamiast ciebie',
  salwa: 'trzy szybkie strzały w jeden cel, z dystansu',
  fala: 'wybuch dookoła — odrzuca i wybija z ukrycia',
  rozdarcie: 'cięcie przed sobą; z ukrycia boli podwójnie',
};

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
  private readonly classPick: HTMLElement;
  private readonly howto: Record<'move' | 'trick' | 'power', HTMLElement>;
  private selectedClass: ClassId = 'lowca';
  private readonly over: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overStats: HTMLElement;
  private readonly standings: HTMLElement;
  private readonly recordsRow: HTMLElement;

  constructor(root: HTMLElement) {
    this.start = required(root, '#screen-start');
    this.classPick = required(root, '#class-pick');
    this.howto = {
      move: required(root, '#howto-move'),
      trick: required(root, '#howto-trick'),
      power: required(root, '#howto-power'),
    };
    this.buildClassPicker();
    this.over = required(root, '#screen-over');
    this.overTitle = required(root, '#over-title');
    this.overStats = required(root, '#over-stats');
    this.standings = required(root, '#over-standings');
    this.recordsRow = required(root, '#over-records');
  }

  showStart(onPlay: (classId: ClassId) => void): void {
    this.start.hidden = false;
    this.over.hidden = true;
    const button = this.start.querySelector<HTMLButtonElement>('#btn-play');
    if (button) {
      button.onclick = () => {
        this.start.hidden = true;
        onPlay(this.selectedClass);
      };
    }
  }

  get chosenClass(): ClassId {
    return this.selectedClass;
  }

  /**
   * Karty wyboru postaci.
   *
   * Statystyki są pokazane jako trzy słupki, nie liczby: „150 HP" nic nie
   * znaczy przed pierwszą rundą, a trzy paski od razu mówią, że Kolos jest
   * twardy i wolny. Liczby wracają, gdy gracz będzie miał do czego ich odnieść.
   */
  private buildClassPicker(): void {
    this.classPick.innerHTML = '';

    for (const id of CLASS_IDS) {
      const cls = getClass(id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'class-card';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(id === this.selectedClass));
      card.innerHTML = `
        <span class="class-mark">${classMark(id)}</span>
        <span class="class-name">${escapeHtml(cls.name)}</span>
        <span class="class-stat">${bar('ŻYW', cls.maxHp, 60, 160)}</span>
        <span class="class-stat">${bar('SZYB', cls.speed, 7.5, 11)}</span>
        <span class="class-stat">${bar('ZAS', cls.attackRange, 5, 8.5)}</span>
      `;
      card.onclick = () => this.selectClass(id);
      this.classPick.appendChild(card);
    }

    this.selectClass(this.selectedClass);
  }

  private selectClass(id: ClassId): void {
    this.selectedClass = id;
    const cards = [...this.classPick.querySelectorAll<HTMLElement>('.class-card')];
    cards.forEach((card, i) => {
      card.setAttribute('aria-checked', String(CLASS_IDS[i] === id));
    });

    // Opis kitu zmienia się razem z wyborem — gracz widzi, czym zagra,
    // zanim wciśnie „Graj", a nie dopiero w trakcie rundy.
    const cls = getClass(id);
    setHowto(this.howto.move, cls.move);
    setHowto(this.howto.trick, cls.trick);
    setHowto(this.howto.power, cls.power);

    let tagline = this.start.querySelector<HTMLElement>('.class-tagline');
    if (!tagline) {
      tagline = document.createElement('p');
      tagline.className = 'class-tagline';
      this.classPick.after(tagline);
    }
    tagline.textContent = cls.tagline;

    // Cecha klasy — działa bez przycisku, więc gracz nie ma jej skąd odkryć
    // w trakcie rundy. Jedyne miejsce, gdzie da się ją pokazać, jest tutaj.
    let passive = this.start.querySelector<HTMLElement>('.class-passive');
    if (!passive) {
      passive = document.createElement('p');
      passive.className = 'class-passive';
      tagline.after(passive);
    }
    passive.textContent = cls.passive ?? '';
    passive.hidden = !cls.passive;
  }

  /**
   * Pas rekordów pod tabelą wyników.
   *
   * Dwie rzeczy naraz: co właśnie pobiłeś (świeży powód do satysfakcji)
   * i jak blisko byłeś (powód do jeszcze jednej rundy). Drugie jest
   * ważniejsze — „zabrakło jednego miejsca" ciągnie mocniej niż sucha
   * statystyka.
   */
  private renderRecords(
    records: { current: Readonly<Records>; beaten: BeatenRecords } | undefined,
    place: number,
    players: number,
  ): void {
    if (!records) {
      this.recordsRow.hidden = true;
      return;
    }

    const { current, beaten } = records;
    // Pierwsza runda bije wszystkie rekordy naraz, bo żadnego jeszcze nie
    // było. Cztery odznaki za samo zagranie to nie nagroda, tylko szum —
    // i psują wagę tych prawdziwych w rundzie drugiej. Wyjątkiem jest
    // wygrana: ta jest osiągnięciem niezależnie od historii.
    const firstRound = current.roundsPlayed <= 1;
    const badges: string[] = [];
    if (beaten.firstWin) badges.push('PIERWSZA WYGRANA');
    if (!firstRound) {
      if (beaten.place) badges.push('NAJLEPSZE MIEJSCE');
      if (beaten.kills) badges.push('NAJWIĘCEJ ELIMINACJI');
      if (beaten.survival) badges.push('NAJDŁUŻSZE PRZEŻYCIE');
      if (beaten.score) badges.push('NAJWYŻSZY WYNIK');
    }

    // „Ile zabrakło" liczymy tylko wtedy, gdy naprawdę było blisko —
    // przy dziesiątym miejscu taka informacja jest kpiną, nie zachętą.
    let nudge = '';
    if (firstRound && place > 0) {
      // Pierwszy wynik nie ma z czym się ścigać, więc dajemy mu poprzeczkę:
      // konkretną liczbę do pobicia w następnej rundzie.
      nudge = `Miejsce ${place} z ${players}. Do pobicia.`;
    } else if (!beaten.place && place > 1 && place <= 3) {
      nudge = place === 2 ? 'Zabrakło jednego miejsca.' : `Zabrakło ${place - 1} miejsc.`;
    } else if (current.sessionStreak >= 2) {
      nudge = `Seria: ${current.sessionStreak} rund z rzędu.`;
    }

    this.recordsRow.innerHTML =
      badges.map((b) => `<span class="record-badge">${escapeHtml(b)}</span>`).join('') +
      (nudge ? `<span class="record-nudge">${escapeHtml(nudge)}</span>` : '') +
      `<span class="record-tally">rundy ${current.roundsPlayed} · wygrane ${current.wins}` +
      (current.bestPlace < Number.MAX_SAFE_INTEGER ? ` · najlepsze ${current.bestPlace}.` : '') +
      `</span>`;
    this.recordsRow.hidden = false;
  }

  hideAll(): void {
    this.start.hidden = true;
    this.over.hidden = true;
  }

  showResult(
    result: MatchResult,
    localId: number,
    onAgain: () => void,
    records?: { current: Readonly<Records>; beaten: BeatenRecords },
  ): void {
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

    this.renderRecords(records, me?.place ?? 0, result.standings.length);

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

function setHowto(row: HTMLElement, ability: keyof typeof ABILITY_NAMES): void {
  const key = row.querySelector<HTMLElement>('.howto-key');
  const desc = row.querySelector<HTMLElement>('.howto-desc');
  if (key) key.textContent = `${ABILITY_GLYPHS[ability]} ${ABILITY_NAMES[ability]}`;
  if (desc) desc.textContent = ABILITY_HINTS[ability] ?? '';
}

/** Trzysegmentowy słupek — czytelny bez znajomości skali. */
function bar(label: string, value: number, min: number, max: number): string {
  const filled = Math.max(1, Math.min(3, Math.round(((value - min) / (max - min)) * 3)));
  return `${label} ${'▮'.repeat(filled)}${'▯'.repeat(3 - filled)}`;
}

/** Znacznik klasy — ten sam kształt co sylwetka na arenie. */
function classMark(id: ClassId): string {
  const common = 'width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"';
  if (id === 'kolos') {
    return `<svg ${common}><polygon points="17,4 29,11 29,23 17,30 5,23 5,11" fill="#ff8a65" stroke="#0b0e15" stroke-width="2"/></svg>`;
  }
  if (id === 'widmo') {
    return `<svg ${common}><polygon points="17,3 27,17 17,31 7,17" fill="#ba68c8" stroke="#0b0e15" stroke-width="2"/></svg>`;
  }
  if (id === 'kuglarz') {
    // Dwa nachodzące kształty — kopia i oryginał.
    return `<svg ${common}><circle cx="12" cy="17" r="9" fill="#4db6ac" stroke="#0b0e15" stroke-width="2" opacity="0.55"/><circle cx="21" cy="17" r="9" fill="#4db6ac" stroke="#0b0e15" stroke-width="2"/></svg>`;
  }
  return `<svg ${common}><circle cx="17" cy="17" r="13" fill="#4fc3f7" stroke="#0b0e15" stroke-width="2"/></svg>`;
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
