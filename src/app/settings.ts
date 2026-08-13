/**
 * Ustawienia sterowania i odbioru — wyłącznie localStorage.
 *
 * Ta sama reguła co przy rekordach (`records.ts`): zero serwera, zero konta,
 * zero danych osobowych. Sekcja 19 mówi wprost, że backendu w Fazie 0 nie ma.
 *
 * Zakres nie jest dowolny — każdy z trzech przełączników wynika z konkretnej
 * wytycznej, nie z upodobania:
 *
 *  - **ręka**. Układ „lewy kciuk rusza, prawy działa" trzeba dać się odbić
 *    lustrzanie; poradniki sterowania dotykowego wymieniają to jako wymóg,
 *    nie opcję. Bez tego leworęczny gracz obsługuje gałkę ręką, którą trzyma
 *    telefon — a bramka Fazy 0 mierzy obcych ludzi, nie mnie.
 *  - **haptyka**. Wytyczne do Vibration API są zgodne: jeśli pokazujesz
 *    przełącznik, uszanuj go; część ludzi nie znosi wibracji, część ich nie
 *    czuje, a to zawsze ma być dodatek do obrazu i dźwięku, nie jedyny kanał.
 *  - **wstrząs kamery**. `prefers-reduced-motion` jest ustawieniem systemowym
 *    i domyślnie je czytamy, ale zostawiamy ręczne nadpisanie w obie strony:
 *    ktoś może mieć włączone ograniczenie ruchu w systemie, a mimo to chcieć
 *    wstrząsu w grze.
 */

const STORAGE_KEY = 'arena.settings.v1';

export type Handedness = 'right' | 'left';
export type MotionMode = 'auto' | 'on' | 'off';

export interface Settings {
  /** Po której stronie ekranu są przyciski akcji. */
  handed: Handedness;
  haptics: boolean;
  motion: MotionMode;
}

function defaults(): Settings {
  return { handed: 'right', haptics: true, motion: 'auto' };
}

export class SettingsStore {
  private data: Settings;
  private listeners: Array<(s: Readonly<Settings>) => void> = [];

  constructor() {
    this.data = load();
  }

  get current(): Readonly<Settings> {
    return this.data;
  }

  /** Czy wolno trząść kamerą — z uwzględnieniem ustawienia systemowego. */
  get motionAllowed(): boolean {
    if (this.data.motion === 'on') return true;
    if (this.data.motion === 'off') return false;
    return !prefersReducedMotion();
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    save(this.data);
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (s: Readonly<Settings>) => void): void {
    this.listeners.push(fn);
  }
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Scalamy z domyślnymi: zapis sprzed dołożenia pola nie może wywrócić gry.
    const merged = { ...defaults(), ...parsed };
    // Wartości spoza zakresu (ręcznie edytowany zapis) wracają do domyślnych.
    if (merged.handed !== 'left' && merged.handed !== 'right') merged.handed = 'right';
    if (merged.motion !== 'auto' && merged.motion !== 'on' && merged.motion !== 'off') {
      merged.motion = 'auto';
    }
    merged.haptics = Boolean(merged.haptics);
    return merged;
  } catch {
    return defaults();
  }
}

function save(data: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Tryb prywatny albo brak miejsca — ustawienia są wygodą, nie warunkiem.
  }
}

/**
 * Haptyka w jednym miejscu, z dławikiem.
 *
 * Wytyczne mówią to samo z dwóch stron: impuls ma być krótki (grubo poniżej
 * pół sekundy) i nie wolno nim męczyć. W grze, w której obrywa się kilka razy
 * na sekundę, brak dławika zamienia telefon w brzęczyk — więc odstęp jest
 * twardy, a nie „zwykle wystarczający".
 */
export class Haptics {
  // Nie zero: `performance.now()` startuje od zera, więc pierwszy impuls
  // w pierwszej sekundzie życia strony byłby zjedzony przez dławik.
  private lastAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly settings: SettingsStore) {}

  /** @param minGapMs minimalny odstęp od poprzedniego impulsu */
  pulse(ms: number, minGapMs = 90): void {
    if (!this.settings.current.haptics) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.lastAt < minGapMs) return;
    this.lastAt = now;
    navigator.vibrate(Math.min(60, ms));
  }
}
