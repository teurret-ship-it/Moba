import * as THREE from 'three';
import { getGlowTexture, getRingTexture, PLAYER_COLORS } from './textures.ts';

/**
 * Efekty jednorazowe, na puli obiektów.
 *
 * Pula, a nie tworzenie w locie: alokacja sprite'ów w trakcie walki
 * powoduje zacięcia GC dokładnie w momencie, w którym gracz najbardziej
 * ich nie chce. Budżet FPS z sekcji 4 (cel 60, twardy limit 30) jest
 * ustalany przez najgorszą klatkę, nie przez średnią.
 */

const POOL_SIZE = 64;

interface FxItem {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  riseSpeed: number;
  active: boolean;
}

export class FxSystem {
  readonly group = new THREE.Group();
  private items: FxItem[] = [];
  private cursor = 0;

  constructor() {
    const glow = getGlowTexture();
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.items.push({
        sprite,
        life: 0,
        maxLife: 1,
        startScale: 1,
        endScale: 1,
        startOpacity: 1,
        riseSpeed: 0,
        active: false,
      });
    }
  }

  private acquire(): FxItem {
    // Nadpisujemy najstarszy, gdy pula się skończy — lepiej zgubić efekt
    // niż zgubić klatkę.
    for (let i = 0; i < POOL_SIZE; i++) {
      const idx = (this.cursor + i) % POOL_SIZE;
      const item = this.items[idx]!;
      if (!item.active) {
        this.cursor = (idx + 1) % POOL_SIZE;
        return item;
      }
    }
    const item = this.items[this.cursor]!;
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    return item;
  }

  private emit(opts: {
    x: number;
    y: number;
    height: number;
    color: THREE.ColorRepresentation;
    startScale: number;
    endScale: number;
    life: number;
    opacity: number;
    map?: THREE.Texture;
    rise?: number;
  }): void {
    const item = this.acquire();
    const mat = item.sprite.material as THREE.SpriteMaterial;
    mat.map = opts.map ?? getGlowTexture();
    mat.color.set(opts.color);
    mat.opacity = opts.opacity;
    mat.needsUpdate = true;

    item.sprite.position.set(opts.x, opts.height, -opts.y);
    item.sprite.scale.setScalar(opts.startScale);
    item.sprite.visible = true;
    item.life = 0;
    item.maxLife = opts.life;
    item.startScale = opts.startScale;
    item.endScale = opts.endScale;
    item.startOpacity = opts.opacity;
    item.riseSpeed = opts.rise ?? 0;
    item.active = true;
  }

  hit(x: number, y: number, amount: number): void {
    const scale = 0.9 + Math.min(1.6, amount / 22);
    this.emit({
      x, y, height: 1.1,
      color: 0xffd2a0,
      startScale: scale,
      endScale: scale * 1.9,
      life: 0.24,
      opacity: 0.85,
      rise: 1.4,
    });
  }

  burst(x: number, y: number, radius: number, colorIndex: number): void {
    this.emit({
      x, y, height: 0.35,
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!,
      startScale: radius * 0.5,
      endScale: radius * 2.15,
      life: 0.42,
      opacity: 0.7,
      map: getRingTexture(),
    });
    this.emit({
      x, y, height: 0.6,
      color: 0xffffff,
      startScale: radius * 0.4,
      endScale: radius * 1.2,
      life: 0.3,
      opacity: 0.55,
    });
  }

  dash(x: number, y: number, colorIndex: number): void {
    this.emit({
      x, y, height: 0.6,
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!,
      startScale: 2.6,
      endScale: 0.6,
      life: 0.28,
      opacity: 0.6,
    });
  }

  stealth(x: number, y: number, entering: boolean): void {
    this.emit({
      x, y, height: 0.9,
      color: entering ? 0x8f7ad6 : 0xd6c07a,
      startScale: entering ? 3.2 : 1.0,
      endScale: entering ? 0.4 : 3.4,
      life: 0.34,
      opacity: 0.65,
    });
  }

  pickup(x: number, y: number, color: THREE.ColorRepresentation): void {
    this.emit({
      x, y, height: 0.9,
      color,
      startScale: 1.6,
      endScale: 3.4,
      life: 0.35,
      opacity: 0.8,
      rise: 2.2,
    });
  }

  death(x: number, y: number, colorIndex: number): void {
    this.emit({
      x, y, height: 1.0,
      color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!,
      startScale: 1.5,
      endScale: 6.5,
      life: 0.6,
      opacity: 0.9,
    });
    this.emit({
      x, y, height: 0.35,
      color: 0xffffff,
      startScale: 1.0,
      endScale: 5.0,
      life: 0.5,
      opacity: 0.6,
      map: getRingTexture(),
    });
  }

  /** Rozdarcie: krótki łuk w kierunku patrzenia, nie okrąg. */
  rend(x: number, y: number, facing: number, range: number, colorIndex: number): void {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const spread = (t - 0.5) * 1.5;
      const a = facing + spread;
      this.emit({
        x: x + Math.cos(a) * range * 0.62,
        y: y + Math.sin(a) * range * 0.62,
        height: 1.0,
        color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!,
        startScale: 2.4,
        endScale: 0.5,
        life: 0.26,
        opacity: 0.85,
      });
    }
  }

  /** Salwa: smuga od strzelca do celu — pokazuje, kto do kogo strzela. */
  tracer(fromX: number, fromY: number, toX: number, toY: number, colorIndex: number): void {
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.emit({
        x: fromX + (toX - fromX) * t,
        y: fromY + (toY - fromY) * t,
        height: 1.2,
        color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!,
        startScale: 0.9,
        endScale: 0.2,
        life: 0.16 + t * 0.05,
        opacity: 0.8,
      });
    }
  }

  shield(x: number, y: number, up: boolean): void {
    this.emit({
      x, y, height: 1.2,
      color: up ? 0x8fd4ff : 0xffd2a0,
      startScale: up ? 5.5 : 4.0,
      endScale: up ? 3.8 : 8.0,
      life: up ? 0.3 : 0.45,
      opacity: 0.8,
      map: getRingTexture(),
    });
  }

  /** Awans: pierścień w górę spod nóg — czytelny kątem oka w walce. */
  levelUp(x: number, y: number): void {
    this.emit({
      x, y, height: 0.3,
      color: 0x9fe6ff,
      startScale: 1.2,
      endScale: 5.0,
      life: 0.55,
      opacity: 0.85,
      map: getRingTexture(),
      rise: 3.2,
    });
  }

  supplyMarker(x: number, y: number): void {
    this.emit({
      x, y, height: 0.3,
      color: 0xffd76a,
      startScale: 12,
      endScale: 3,
      life: 1.2,
      opacity: 0.75,
      map: getRingTexture(),
    });
  }

  update(dt: number): void {
    for (const item of this.items) {
      if (!item.active) continue;
      item.life += dt;
      const t = item.life / item.maxLife;
      if (t >= 1) {
        item.active = false;
        item.sprite.visible = false;
        continue;
      }
      const scale = item.startScale + (item.endScale - item.startScale) * t;
      item.sprite.scale.setScalar(scale);
      item.sprite.position.y += item.riseSpeed * dt;
      (item.sprite.material as THREE.SpriteMaterial).opacity = item.startOpacity * (1 - t * t);
    }
  }

  dispose(): void {
    for (const item of this.items) {
      (item.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.items = [];
  }
}
