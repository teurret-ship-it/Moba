/**
 * Telefon jako urządzenie, a nie jako mały ekran.
 *
 * Runda trwa trzy minuty i przez sporą jej część gracz nie dotyka ekranu —
 * biegnie, patrzy, czeka na strefę. Android wygasza ekran po 15–30 sekundach
 * bezczynności DOTYKOWEJ, więc bez blokady wygaszania playtest z sekcji 19
 * wygląda tak: obcy człowiek gra półtorej minuty, ekran mu gaśnie, on odblokowuje
 * telefon i już nie wraca. To nie jest problem gry, tylko urządzenia — ale
 * kosztuje dokładnie to samo.
 *
 * Reguły z dokumentacji Wake Lock, wszystkie tu przestrzegane:
 *
 *  - **przeglądarka ma prawo odmówić** (niski poziom baterii, tryb
 *    oszczędzania), więc każde żądanie idzie w try/catch i porażka jest cicha;
 *  - **blokada gaśnie sama**, gdy dokument przestaje być widoczny — po powrocie
 *    trzeba ją wziąć jeszcze raz, inaczej działa tylko do pierwszego
 *    przełączenia aplikacji;
 *  - **trzymamy referencję**, żeby dało się zwolnić;
 *  - **zwalniamy, gdy zadanie się kończy.** Blokada trzymana po rundzie to już
 *    tylko zjadanie baterii — a gracz, który zauważy, że gra zjada baterię,
 *    nie zagra trzeciej rundy.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

export class ScreenAwake {
  private sentinel: WakeLockSentinelLike | null = null;
  /** Czy gra CHCE być obudzona. Blokada bywa zabrana bez pytania. */
  private wanted = false;
  private readonly onVisibility = () => {
    // Powrót do gry po przełączeniu aplikacji — blokadę trzeba wziąć od nowa.
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Czy urządzenie w ogóle to potrafi — do nakładki pomiarowej. */
  get supported(): boolean {
    return wakeLockApi() !== null;
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Wołane na starcie rundy. */
  enable(): void {
    this.wanted = true;
    void this.acquire();
  }

  /** Wołane na koniec rundy — bateria jest zasobem gracza, nie moim. */
  disable(): void {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => {});
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disable();
  }

  private async acquire(): Promise<void> {
    if (this.active) return;
    const api = wakeLockApi();
    if (!api) return;
    try {
      const sentinel = await api.request('screen');
      // Wyścig: runda mogła się skończyć, zanim obietnica się rozwiązała.
      if (!this.wanted) {
        void sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Odmowa jest normalna: niski poziom baterii, tryb oszczędzania,
      // brak gestu użytkownika. Gra działa dalej, tylko ekran gaśnie.
    }
  }
}

/**
 * Blokada orientacji.
 *
 * HUD jest zbudowany pod pion: gałka w dolnej połowie, przyciski przy
 * krawędzi kciuka. W poziomie da się grać, ale obrót W TRAKCIE rundy to
 * przebudowa układu w środku walki.
 *
 * Blokady nie da się założyć bez trybu pełnoekranowego, a trybu
 * pełnoekranowego nie wymuszam — wejście na siłę w pełny ekran przy
 * pierwszym dotknięciu jest dokładnie tym, czego ludzie nie znoszą
 * w grach przeglądarkowych. Próbujemy więc tylko wtedy, gdy gracz sam
 * jest już w pełnym ekranie albo zainstalował grę na ekranie domowym.
 */
export function tryLockPortrait(): void {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>;
  };
  if (!orientation?.lock) return;

  const standalone =
    document.fullscreenElement !== null ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  if (!standalone) return;

  orientation.lock('portrait').catch(() => {
    // Przeglądarka na komputerze odmówi zawsze i to jest w porządku.
  });
}
