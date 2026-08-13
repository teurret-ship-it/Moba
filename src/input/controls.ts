import type { InputFrame } from '../sim/types.ts';

/**
 * Sterowanie dotykowe (sekcja 4: „touch: joystick + 2–3 przyciski akcji").
 *
 * Założenie z sekcji 1: gra ma być obsługiwana JEDNĄ RĘKĄ w przerywanym
 * graniu. Dlatego atak podstawowy jest automatyczny — kciuk obsługuje
 * ruch, a przyciski są wyłącznie dla trzech decyzji, nie dla DPS-u.
 *
 * Gałka jest „pływająca": pojawia się tam, gdzie palec dotknie połowy ekranu
 * należącej do ruchu. Gałka w stałym miejscu wymaga patrzenia na ekran przy
 * chwytaniu telefonu, a to jest realny koszt na małych urządzeniach.
 * Porównania obu wariantów dają im podobną użyteczność, z lekką przewagą
 * pływającej w łatwości nauki — a pierwsze wrażenie jest tu wszystkim.
 *
 * Strona ekranu jest przełączalna. Układ „lewy kciuk rusza, prawy działa"
 * to założenie o ręce gracza, nie fakt o człowieku.
 */

/**
 * Promień gałki i martwa strefa, obie względem ekranu.
 *
 * Wartości stałe w pikselach rozjeżdżają się między telefonem a tabletem,
 * więc promień jest ułamkiem krótszego boku, przycięty do rozsądnego
 * przedziału, a martwa strefa jest ułamkiem promienia.
 */
const JOYSTICK_RADIUS_FRACTION = 0.16;
const JOYSTICK_RADIUS_MIN = 50;
const JOYSTICK_RADIUS_MAX = 74;
const DEAD_ZONE_FRACTION = 0.12;

export interface ControlsState {
  moveX: number;
  moveY: number;
  /** Do rysowania gałki. */
  joystickActive: boolean;
  joystickBaseX: number;
  joystickBaseY: number;
  joystickKnobX: number;
  joystickKnobY: number;
}

/** Skalowana promieniowa martwa strefa — patrz `applyDeadZone`. */
export function applyDeadZone(dist: number, dead: number, radius: number): number {
  if (dist <= dead) return 0;
  return Math.min(1, (dist - dead) / (radius - dead));
}

export class Controls {
  readonly state: ControlsState = {
    moveX: 0,
    moveY: 0,
    joystickActive: false,
    joystickBaseX: 0,
    joystickBaseY: 0,
    joystickKnobX: 0,
    joystickKnobY: 0,
  };

  /** Zdarzenia krawędziowe — konsumowane przy budowie ramki wejścia. */
  private pendingDash = false;
  private pendingStealth = false;
  private pendingBurst = false;
  /** Wybrana karta ulepszenia (indeks) albo -1. */
  private pendingPick = -1;

  private seq = 0;
  private joystickPointerId: number | null = null;
  /** Po której stronie ekranu leży gałka. Prawa ręka = gałka po lewej. */
  private moveOnLeft = true;
  private keys = new Set<string>();
  private disposers: Array<() => void> = [];

  constructor(
    private readonly surface: HTMLElement,
    buttons: { dash: HTMLElement; stealth: HTMLElement; burst: HTMLElement },
  ) {
    this.bindTouch();
    this.bindButton(buttons.dash, () => (this.pendingDash = true));
    this.bindButton(buttons.stealth, () => (this.pendingStealth = true));
    this.bindButton(buttons.burst, () => (this.pendingBurst = true));
    this.bindKeyboard();
  }

  /**
   * Zamiana stron dla leworęcznych.
   *
   * Zmienia tylko to, która połowa ekranu przyjmuje gałkę — układ przycisków
   * przestawia CSS. Trwający dotyk jest przerywany, bo po zamianie stron
   * gałka trzymana w starej połowie sterowałaby czymś, czego już tam nie ma.
   */
  setHandedness(handed: 'left' | 'right'): void {
    const moveOnLeft = handed === 'right';
    if (moveOnLeft === this.moveOnLeft) return;
    this.moveOnLeft = moveOnLeft;
    this.releaseAll();
  }

  /** Promień gałki dla bieżącego ekranu. */
  private joystickRadius(): number {
    const shorter = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(
      JOYSTICK_RADIUS_MIN,
      Math.min(JOYSTICK_RADIUS_MAX, shorter * JOYSTICK_RADIUS_FRACTION),
    );
  }

  /** Buduje ramkę wejścia dla bieżącego ticka i zużywa zdarzenia krawędziowe. */
  sample(): InputFrame {
    const kb = this.keyboardVector();
    let moveX = this.state.moveX;
    let moveY = this.state.moveY;

    // Klawiatura wygrywa, jeśli gałka nie jest dotykana — pozwala testować
    // na desktopie bez przełączania trybu.
    if (!this.state.joystickActive && (kb.x !== 0 || kb.y !== 0)) {
      moveX = kb.x;
      moveY = kb.y;
    }

    const frame: InputFrame = {
      seq: ++this.seq,
      moveX,
      moveY,
      dash: this.pendingDash,
      stealth: this.pendingStealth,
      burst: this.pendingBurst,
      pick: this.pendingPick,
    };

    this.pendingDash = false;
    this.pendingStealth = false;
    this.pendingBurst = false;
    this.pendingPick = -1;
    return frame;
  }

  /** Zgłoszenie wyboru karty ulepszenia — wywoływane przez warstwę UI. */
  choose(index: number): void {
    this.pendingPick = index;
    navigator.vibrate?.(14);
  }

  /** Zerowanie po utracie fokusu — inaczej postać biegnie w tle. */
  releaseAll(): void {
    this.keys.clear();
    this.joystickPointerId = null;
    this.state.joystickActive = false;
    this.state.moveX = 0;
    this.state.moveY = 0;
    this.pendingDash = false;
    this.pendingStealth = false;
    this.pendingBurst = false;
    this.pendingPick = -1;
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
  }

  private bindTouch(): void {
    const onDown = (e: PointerEvent) => {
      // Druga połowa ekranu należy do przycisków akcji. Granica jest lekko
      // przesunięta na korzyść gałki: chybiony kciuk częściej ląduje za
      // blisko środka niż za daleko.
      const split = window.innerWidth * (this.moveOnLeft ? 0.55 : 0.45);
      const onMoveSide = this.moveOnLeft ? e.clientX <= split : e.clientX >= split;
      if (!onMoveSide) return;
      if (this.joystickPointerId !== null) return;
      this.joystickPointerId = e.pointerId;
      this.state.joystickActive = true;
      this.state.joystickBaseX = e.clientX;
      this.state.joystickBaseY = e.clientY;
      this.state.joystickKnobX = e.clientX;
      this.state.joystickKnobY = e.clientY;
      this.surface.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== this.joystickPointerId) return;
      const dx = e.clientX - this.state.joystickBaseX;
      const dy = e.clientY - this.state.joystickBaseY;
      const dist = Math.hypot(dx, dy);

      const radius = this.joystickRadius();
      const dead = radius * DEAD_ZONE_FRACTION;

      if (dist <= dead) {
        this.state.moveX = 0;
        this.state.moveY = 0;
        this.state.joystickKnobX = this.state.joystickBaseX;
        this.state.joystickKnobY = this.state.joystickBaseY;
        return;
      }

      const clamped = Math.min(dist, radius);
      const nx = dx / dist;
      const ny = dy / dist;
      this.state.joystickKnobX = this.state.joystickBaseX + nx * clamped;
      this.state.joystickKnobY = this.state.joystickBaseY + ny * clamped;

      // Skalowana promieniowa martwa strefa.
      //
      // Wcześniej siła wychylenia liczyła się jako `dist / promień` z twardym
      // odcięciem poniżej martwej strefy — czyli tuż za jej krawędzią postać
      // ruszała od razu z 10% prędkości, a nie od zera. To jest dokładnie ten
      // uskok, przed którym ostrzegają opisy martwych stref: gałka ma pełny
      // zakres od 0 do 1 rozciągnięty na drogę OD krawędzi martwej strefy do
      // krawędzi gałki, a nie od jej środka.
      const strength = applyDeadZone(dist, dead, radius);
      this.state.moveX = nx * strength;
      // Ekran ma Y w dół, świat ma Y w górę.
      this.state.moveY = -ny * strength;
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== this.joystickPointerId) return;
      this.joystickPointerId = null;
      this.state.joystickActive = false;
      this.state.moveX = 0;
      this.state.moveY = 0;
    };

    this.surface.addEventListener('pointerdown', onDown, { passive: false });
    this.surface.addEventListener('pointermove', onMove, { passive: false });
    this.surface.addEventListener('pointerup', onUp);
    this.surface.addEventListener('pointercancel', onUp);
    this.disposers.push(() => {
      this.surface.removeEventListener('pointerdown', onDown);
      this.surface.removeEventListener('pointermove', onMove);
      this.surface.removeEventListener('pointerup', onUp);
      this.surface.removeEventListener('pointercancel', onUp);
    });
  }

  private bindButton(el: HTMLElement, fire: () => void): void {
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      fire();
      el.classList.add('is-pressed');
      // Haptyka: krótki impuls potwierdza akcję bez patrzenia na przycisk.
      navigator.vibrate?.(12);
    };
    const onUp = () => el.classList.remove('is-pressed');

    el.addEventListener('pointerdown', onDown, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
    this.disposers.push(() => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onUp);
    });
  }

  private bindKeyboard(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.pendingDash = true;
      if (e.code === 'KeyQ' || e.code === 'ShiftLeft') this.pendingStealth = true;
      if (e.code === 'KeyE') this.pendingBurst = true;
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => this.releaseAll();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private keyboardVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }
}
