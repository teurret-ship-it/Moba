/**
 * Deterministyczny RNG (mulberry32).
 *
 * Symulacja nie może używać Math.random — mecz musi być odtwarzalny z
 * `seed` zapisanego w `match.seed` (sekcja 6 modelu danych). To jest
 * warunek debugowania desynchronizacji w Fazie 1.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Kopia stanu — pozwala rozgałęzić strumień bez wpływu na oryginał. */
  clone(): Rng {
    const r = new Rng(0);
    r.state = this.state;
    return r;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Liczba całkowita [min, max] */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: pusta tablica');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Losowy punkt w kole o zadanym środku i promieniu (rozkład jednostajny). */
  pointInCircle(cx: number, cy: number, radius: number): { x: number; y: number } {
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(this.next()) * radius;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
}

/** Seed z ciągu znaków — do powtarzalnych testów i „replay z linku". */
export function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
