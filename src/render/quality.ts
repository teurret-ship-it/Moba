/**
 * Adaptacyjna rozdzielczość.
 *
 * Poradniki wydajności radzą „wykryj klasę urządzenia i ustaw jakość" — tyle
 * że klasy urządzenia nie da się wykryć, można ją tylko zgadnąć z nazwy
 * przeglądarki, a ta kłamie od dwudziestu lat. Mierzenie własnego czasu klatki
 * jest tym samym pomysłem bez zgadywania.
 *
 * Regulowany jest wyłącznie mnożnik pikseli, bo tylko on ma KWADRATOWY wpływ
 * na koszt wypełniania (przy DPR 3 rysujemy dziewięć razy więcej pikseli niż
 * przy 1) i zerowy wpływ na rozgrywkę. Nie ruszamy zasięgu widzenia ani
 * liczby obiektów — to zmieniłoby, co gracz widzi, czyli reguły.
 *
 * Wydzielone z renderera, żeby dało się to przetestować bez kontekstu WebGL:
 * histereza jest logiką, a nie grafiką.
 */

/** Próg z sekcji 4 planu — poniżej tego gra przestaje być grywalna. */
export const MIN_ACCEPTABLE_FPS = 30;

/**
 * Na telefonie 1,5 zamiast 2 to o ~44% mniej pikseli do wypełnienia, a na
 * sześciocalowym ekranie różnicy nie widać. Dolna granica 0,75 jest ostatnią
 * deską ratunku: obraz robi się miękki, ale gra pozostaje grą.
 */
export const MOBILE_PIXEL_RATIO = 1.5;
export const DESKTOP_PIXEL_RATIO = 2;
export const MIN_PIXEL_RATIO = 0.75;

/**
 * Histereza jest celowo niesymetryczna: schodzimy po ~1,5 s zacinania,
 * wracamy po ~9 s spokoju. Symetryczna kazałaby grze migotać rozdzielczością
 * dokładnie tam, gdzie jest najciężej — na granicy budżetu.
 */
const SLOW_FRAMES_TO_DROP = 30;
const FAST_FRAMES_TO_RAISE = 180;
/** Klatka musi być wyraźnie szybsza od budżetu, żeby liczyć się jako zapas. */
const HEADROOM = 0.7;

export class QualityGovernor {
  private slow = 0;
  private fast = 0;

  constructor(private cap: number) {}

  get pixelRatioCap(): number {
    return this.cap;
  }

  /**
   * @param frameMs czas ostatniej klatki
   * @returns nowy pułap, jeśli się zmienił — inaczej `null`
   */
  update(frameMs: number): number | null {
    const budget = 1000 / MIN_ACCEPTABLE_FPS;

    if (frameMs > budget) {
      this.slow += 1;
      this.fast = 0;
    } else if (frameMs < budget * HEADROOM) {
      this.fast += 1;
      this.slow = 0;
    }

    if (this.slow >= SLOW_FRAMES_TO_DROP && this.cap > MIN_PIXEL_RATIO) {
      this.cap = Math.max(MIN_PIXEL_RATIO, this.cap - 0.25);
      this.slow = 0;
      return this.cap;
    }

    if (this.fast >= FAST_FRAMES_TO_RAISE && this.cap < MOBILE_PIXEL_RATIO) {
      this.cap = Math.min(MOBILE_PIXEL_RATIO, this.cap + 0.25);
      this.fast = 0;
      return this.cap;
    }

    return null;
  }
}

/**
 * Zgadywanie, czy to telefon.
 *
 * Świadomie prymitywne: to tylko punkt startowy dla adaptacji, która i tak
 * zmierzy prawdziwą wydajność. Pomyłka w jedną stronę kosztuje półtorej
 * sekundy brzydszego obrazu, w drugą — nic.
 */
export function isProbablyMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (navigator.maxTouchPoints > 0 && window.innerWidth < 1100) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
