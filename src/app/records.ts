import type { ClassId } from '../sim/classes.ts';

/**
 * Rekordy lokalne — jedyny powód, żeby zagrać jeszcze raz.
 *
 * Bramka Fazy 0 brzmi „5 obcych osób gra ≥3 rundy z rzędu bez proszenia".
 * Runda ma już treść (klasy, ulepszenia, Rdzeń), ale po ekranie wyniku nie
 * zostawało nic — a człon „Z" z sekcji 1 („wraca jutro, bo Z") to najsłabsze
 * miejsce całego prototypu.
 *
 * Zakres jest celowo minimalny i mieści się w regule z sekcji 17:
 *
 *  - **wyłącznie localStorage**, zero serwera i zero konta. Sekcja 19 mówi
 *    wprost, że backendu w Fazie 0 nie ma, więc nie ma go też tutaj.
 *  - **zero danych osobowych**. To są liczby o rozgrywce: miejsce,
 *    eliminacje, czas. Nie ma tu nic, co identyfikuje człowieka, więc nie
 *    uruchamia obowiązków z sekcji 11 — a gdy w Fazie 1 pojawi się konto,
 *    ten sam zestaw pól przeniesie się do `progression` bez zmian.
 *  - **brak blokad treści**. Kusi, żeby odblokowywać klasy za rundy, ale
 *    playtest z zablokowaną połową gry mierzy cierpliwość, nie zabawę.
 *
 * Zapis może się nie udać (tryb prywatny, brak miejsca) i to nie może
 * wywrócić gry — wszystkie operacje są bezpieczne i ciche.
 */

const STORAGE_KEY = 'arena.records.v1';

export interface MatchOutcome {
  place: number;
  players: number;
  kills: number;
  damage: number;
  survivedSeconds: number;
  score: number;
  level: number;
  classId: ClassId;
  won: boolean;
}

export interface Records {
  roundsPlayed: number;
  wins: number;
  bestPlace: number;
  mostKills: number;
  longestSurvival: number;
  bestScore: number;
  /** Ile rund z rzędu w tej sesji — dokładnie to, co mierzy bramka Fazy 0. */
  sessionStreak: number;
  /** Najlepsza seria w historii, żeby było co bić. */
  bestStreak: number;
}

/** Co w ostatniej rundzie okazało się rekordem — do podświetlenia na ekranie. */
export interface BeatenRecords {
  place: boolean;
  kills: boolean;
  survival: boolean;
  score: boolean;
  firstWin: boolean;
}

function empty(): Records {
  return {
    roundsPlayed: 0,
    wins: 0,
    bestPlace: Number.MAX_SAFE_INTEGER,
    mostKills: 0,
    longestSurvival: 0,
    bestScore: 0,
    sessionStreak: 0,
    bestStreak: 0,
  };
}

export class RecordStore {
  private data: Records;

  constructor() {
    this.data = load();
    // Seria liczy się w obrębie sesji — po zamknięciu gry zaczyna się od zera.
    // Inaczej „3 rundy z rzędu" dałoby się uzbierać przez tydzień, a bramka
    // pyta o coś innego: czy gra ciągnie TERAZ.
    this.data.sessionStreak = 0;
  }

  get current(): Readonly<Records> {
    return this.data;
  }

  /**
   * Zapisuje wynik rundy i zwraca, które rekordy padły.
   *
   * Kolejność ma znaczenie: porównujemy z poprzednim stanem, a dopiero
   * potem podnosimy rekordy.
   */
  record(outcome: MatchOutcome): BeatenRecords {
    const beaten: BeatenRecords = {
      place: outcome.place < this.data.bestPlace,
      kills: outcome.kills > this.data.mostKills,
      survival: outcome.survivedSeconds > this.data.longestSurvival,
      score: outcome.score > this.data.bestScore,
      firstWin: outcome.won && this.data.wins === 0,
    };

    this.data.roundsPlayed += 1;
    this.data.sessionStreak += 1;
    if (outcome.won) this.data.wins += 1;
    if (beaten.place) this.data.bestPlace = outcome.place;
    if (beaten.kills) this.data.mostKills = outcome.kills;
    if (beaten.survival) this.data.longestSurvival = outcome.survivedSeconds;
    if (beaten.score) this.data.bestScore = outcome.score;
    if (this.data.sessionStreak > this.data.bestStreak) {
      this.data.bestStreak = this.data.sessionStreak;
    }

    save(this.data);
    return beaten;
  }

  /** Pierwsza runda w ogóle — wtedy pokazujemy podpowiedzi sterowania. */
  get isFirstEver(): boolean {
    return this.data.roundsPlayed === 0;
  }

  reset(): void {
    this.data = empty();
    save(this.data);
  }
}

function load(): Records {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Records>;
    // Scalamy z pustym zestawem: stary zapis bez nowego pola nie może
    // wywrócić ekranu wyniku (sekcja 15 — schemat tylko się rozszerza).
    return { ...empty(), ...parsed };
  } catch {
    return empty();
  }
}

function save(data: Records): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Tryb prywatny albo brak miejsca. Rekordy są miłym dodatkiem,
    // nie warunkiem działania gry.
  }
}
