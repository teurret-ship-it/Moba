import { TICK_HZ } from '../sim/constants.ts';

/**
 * Czytelność walki.
 *
 * `docs/FAZA0.md` wymienia „nie wiem, co mnie zabiło" jako typową skargę
 * playtestera i traktuje ją osobno od „nie było fajnie": gra może być
 * dobrze zbalansowana i nadal nieczytelna. Na ekranie 6 cali, trzymanym
 * jedną ręką, obraz nie zdąży przekazać trzech rzeczy:
 *
 *  1. **skąd** przyszły obrażenia — kamera pokazuje tylko wycinek areny,
 *     a strzelec bywa poza kadrem,
 *  2. **ile** zadałeś — bez tego walka jest zgadywanką, czy cokolwiek robisz,
 *  3. **gdzie** jest bezpiecznie, gdy jesteś poza kręgiem i nie widzisz go
 *     na ziemi.
 *
 * Wszystkie trzy są tu rozwiązane w DOM, nie w scenie: tekst i łuki w WebGL
 * wymagałyby atlasu czcionek i osobnej ścieżki renderu, a przeglądarka
 * kompozytuje tę warstwę na GPU i tak.
 */

/** Ile liczb obrażeń trzymamy naraz. Powyżej tego robi się szum. */
const NUMBER_POOL = 14;
const NUMBER_LIFE_MS = 750;
/** Jak długo świeci wskaźnik kierunku obrażeń. */
const DIRECTION_LIFE_MS = 900;

interface FloatingNumber {
  el: HTMLElement;
  bornAt: number;
  worldX: number;
  worldY: number;
  active: boolean;
}

interface DamageArc {
  el: HTMLElement;
  bornAt: number;
  angle: number;
  active: boolean;
}

export class CombatFeedback {
  private numbers: FloatingNumber[] = [];
  private arcs: DamageArc[] = [];
  private numberCursor = 0;
  private arcCursor = 0;
  private readonly compass: HTMLElement;
  private readonly compassArrow: HTMLElement;
  private readonly lowHp: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'feedback-layer';
    root.appendChild(layer);

    // Pule tworzone z góry — alokacja elementów DOM w trakcie walki
    // powoduje zacięcia dokładnie wtedy, gdy najbardziej przeszkadzają.
    for (let i = 0; i < NUMBER_POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-number';
      el.style.display = 'none';
      layer.appendChild(el);
      this.numbers.push({ el, bornAt: 0, worldX: 0, worldY: 0, active: false });
    }

    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-arc';
      el.style.display = 'none';
      layer.appendChild(el);
      this.arcs.push({ el, bornAt: 0, angle: 0, active: false });
    }

    this.compass = document.createElement('div');
    this.compass.className = 'zone-compass';
    this.compass.hidden = true;
    this.compass.innerHTML =
      '<span class="zone-compass-arrow">▲</span><span class="zone-compass-text">WRACAJ DO STREFY</span>';
    layer.appendChild(this.compass);
    this.compassArrow = this.compass.querySelector('.zone-compass-arrow') as HTMLElement;

    this.lowHp = document.createElement('div');
    this.lowHp.className = 'low-hp-vignette';
    layer.appendChild(this.lowHp);
  }

  /** Liczba obrażeń unosząca się nad celem. */
  addNumber(worldX: number, worldY: number, amount: number, kind: 'dealt' | 'taken', now: number): void {
    const rounded = Math.round(amount);
    if (rounded <= 0) return;

    const item = this.numbers[this.numberCursor % NUMBER_POOL]!;
    this.numberCursor++;

    item.el.textContent = String(rounded);
    item.el.className = `dmg-number dmg-number--${kind}${rounded >= 25 ? ' is-big' : ''}`;
    item.el.style.display = 'block';
    item.bornAt = now;
    // Rozrzut poziomy, żeby seria trafień nie układała się w jedną kolumnę.
    item.worldX = worldX + (Math.random() - 0.5) * 1.4;
    item.worldY = worldY + (Math.random() - 0.5) * 1.4;
    item.active = true;
  }

  /**
   * Łuk przy krawędzi ekranu wskazujący źródło obrażeń.
   *
   * `angle` jest kątem świata (radiany, jak `facing`). Przeliczamy go na
   * obrót ekranowy — świat ma Y w górę, ekran w dół.
   */
  addDamageDirection(worldAngle: number, now: number): void {
    const item = this.arcs[this.arcCursor % this.arcs.length]!;
    this.arcCursor++;
    item.angle = worldAngle;
    item.bornAt = now;
    item.active = true;
    item.el.style.display = 'block';
  }

  /**
   * Aktualizacja co klatkę.
   *
   * `project` przelicza punkt świata na piksele; zwraca `null` dla punktów
   * za kamerą — takie liczby po prostu chowamy.
   */
  update(
    now: number,
    project: (x: number, y: number, h?: number) => { sx: number; sy: number } | null,
  ): void {
    for (const item of this.numbers) {
      if (!item.active) continue;
      const age = (now - item.bornAt) / NUMBER_LIFE_MS;
      if (age >= 1) {
        item.active = false;
        item.el.style.display = 'none';
        continue;
      }
      const p = project(item.worldX, item.worldY, 2.2 + age * 2.4);
      if (!p) {
        item.el.style.display = 'none';
        continue;
      }
      item.el.style.display = 'block';
      item.el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%) scale(${1.15 - age * 0.35})`;
      item.el.style.opacity = String(1 - age * age);
    }

    for (const item of this.arcs) {
      if (!item.active) continue;
      const age = (now - item.bornAt) / DIRECTION_LIFE_MS;
      if (age >= 1) {
        item.active = false;
        item.el.style.display = 'none';
        continue;
      }
      // Świat: 0 rad = w prawo, Y w górę. Ekran: obrót zgodny z zegarem,
      // 0° = w górę. Stąd konwersja kąta i znak minus przy Y.
      const screenDeg = 90 - (item.angle * 180) / Math.PI;
      item.el.style.transform = `rotate(${screenDeg}deg)`;
      item.el.style.opacity = String((1 - age) * 0.85);
    }
  }

  /**
   * Kompas do strefy — pokazywany tylko wtedy, gdy jesteś poza kręgiem.
   *
   * Kamera pokazuje wycinek areny, więc gracz stojący daleko poza strefą
   * nie widzi jej krawędzi na ziemi i nie wie, w którą stronę biec.
   */
  setZoneCompass(outside: boolean, worldAngleToCenter: number): void {
    if (!outside) {
      if (!this.compass.hidden) this.compass.hidden = true;
      return;
    }
    this.compass.hidden = false;
    const screenDeg = 90 - (worldAngleToCenter * 180) / Math.PI;
    this.compassArrow.style.transform = `rotate(${screenDeg}deg)`;
  }

  /** Pulsujące obramowanie przy niskim zdrowiu — widoczne kątem oka. */
  setLowHp(fraction: number): void {
    const danger = fraction > 0 && fraction < 0.3;
    this.lowHp.classList.toggle('is-active', danger);
  }

  reset(): void {
    for (const item of this.numbers) {
      item.active = false;
      item.el.style.display = 'none';
    }
    for (const item of this.arcs) {
      item.active = false;
      item.el.style.display = 'none';
    }
    this.compass.hidden = true;
    this.lowHp.classList.remove('is-active');
  }

  dispose(): void {
    const layer = this.root.querySelector('.feedback-layer');
    layer?.remove();
  }
}

export { TICK_HZ };
