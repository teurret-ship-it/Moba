import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ, WARMUP_TICKS } from '../constants.ts';

/**
 * Sonda tempa — „gdzie w rundzie się nudzę".
 *
 * Sekcja 19 pkt 5–6: „Zagraj 20 rund samodzielnie; zanotuj moment, w którym
 * się nudzisz. Popraw ten moment."
 *
 * Wrażenia z 20 rund są potrzebne, ale są też drogie i nieprecyzyjne —
 * „chyba gdzieś w środku" nie wskazuje, co zmienić. Ta sonda mierzy to samo
 * obiektywnie: dla każdej sekundy rundy sprawdza, czy gracz miał się czym
 * zająć.
 *
 * Gracz jest ZAJĘTY, jeśli zachodzi którykolwiek warunek:
 *  - przeciwnik w promieniu 20 (widać go, można podjąć decyzję),
 *  - walka w ciągu ostatnich 3 s (zadane lub otrzymane obrażenia),
 *  - drop w promieniu 10 (jest po co iść),
 *  - strefa depcze po piętach (mniej niż 6 od krawędzi).
 *
 * Poza tym gracz idzie przez pustą mapę i patrzy na nic. To jest ten moment.
 *
 * Sonda nie zastępuje playtestu — mówi GDZIE patrzeć, nie CZY jest fajnie.
 */

const ENEMY_RANGE = 20;
const PICKUP_RANGE = 10;
const ZONE_PRESSURE = 6;
const COMBAT_MEMORY_TICKS = 3 * TICK_HZ;
const BUCKET_SECONDS = 15;

interface Pacing {
  /** Udział „martwego czasu" w każdym 15-sekundowym oknie rundy. */
  buckets: number[];
  overall: number;
  roundSeconds: number;
}

function measure(seed: number): Pacing {
  const sim = new Simulation({ seed, playerCount: 12, humanCount: 0 });
  const w = sim.world;

  // Ostatni tick, w którym gracz zadał obrażenia (otrzymane ma w lastHitTick).
  const lastDealt = new Map<number, number>();
  const busy: number[] = [];
  const total: number[] = [];

  for (let t = 0; t < MATCH_TICKS; t++) {
    sim.step();
    if (w.phase === 'over') break;
    if (w.phase !== 'live') continue;

    for (const e of w.events) {
      if (e.type === 'damage' && e.source >= 0) lastDealt.set(e.source, w.tick);
    }

    // Próbkujemy raz na sekundę — mierzymy sekundy nudy, nie ticki.
    if (w.tick % TICK_HZ !== 0) continue;

    const bucket = Math.floor((w.tick - WARMUP_TICKS) / (BUCKET_SECONDS * TICK_HZ));
    if (bucket < 0) continue;
    while (busy.length <= bucket) {
      busy.push(0);
      total.push(0);
    }

    for (const p of w.players) {
      if (!p.alive) continue;
      total[bucket]! += 1;
      if (isBusy(sim, p.id, lastDealt.get(p.id) ?? -1)) busy[bucket]! += 1;
    }
  }

  const buckets = busy.map((b, i) => {
    const n = total[i]!;
    return n === 0 ? 0 : 1 - b / n;
  });

  const busySum = busy.reduce((a, b) => a + b, 0);
  const totalSum = total.reduce((a, b) => a + b, 0);

  return {
    buckets,
    overall: totalSum === 0 ? 0 : 1 - busySum / totalSum,
    roundSeconds: w.tick / TICK_HZ,
  };
}

function isBusy(sim: Simulation, playerId: number, dealtTick: number): boolean {
  const w = sim.world;
  const p = w.players[playerId]!;

  if (w.tick - dealtTick < COMBAT_MEMORY_TICKS) return true;
  if (p.lastHitTick >= 0 && w.tick - p.lastHitTick < COMBAT_MEMORY_TICKS) return true;

  const distToEdge = w.zone.radius - Math.hypot(p.x - w.zone.x, p.y - w.zone.y);
  if (distToEdge < ZONE_PRESSURE) return true;

  for (const other of w.players) {
    if (other.id === p.id || !other.alive) continue;
    if (Math.hypot(other.x - p.x, other.y - p.y) <= ENEMY_RANGE) return true;
  }

  for (const item of w.pickups) {
    if (Math.hypot(item.x - p.x, item.y - p.y) <= PICKUP_RANGE) return true;
  }

  return false;
}

describe('tempo rundy — gdzie jest martwy czas', () => {
  it('żadne okno rundy nie jest w większości puste', () => {
    const seeds = [1, 7, 13, 42, 99, 256, 1024, 4242, 31337, 65535];
    const runs = seeds.map(measure);

    const maxBuckets = Math.max(...runs.map((r) => r.buckets.length));
    const avg: number[] = [];
    for (let i = 0; i < maxBuckets; i++) {
      const vals = runs.map((r) => r.buckets[i]).filter((v): v is number => v !== undefined);
      avg.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    const lines = avg.map((v, i) => {
      const from = i * BUCKET_SECONDS;
      const to = from + BUCKET_SECONDS;
      const bar = '█'.repeat(Math.round(v * 40)).padEnd(40, '·');
      return `  ${String(from).padStart(3)}–${String(to).padStart(3)}s  ${bar} ${(v * 100).toFixed(0)}%`;
    });

    const overall = runs.reduce((a, r) => a + r.overall, 0) / runs.length;
    console.log(
      [
        '',
        '  --- sonda tempa: udział martwego czasu (10 seedów) ---',
        ...lines,
        `  ŚREDNIO: ${(overall * 100).toFixed(0)}%`,
        '',
      ].join('\n'),
    );

    // Okno, w którym ponad połowa czasu to chodzenie po pustej mapie,
    // jest dokładnie tym „momentem, w którym się nudzisz" z sekcji 19.
    const worst = Math.max(...avg);
    expect(worst).toBeLessThan(0.5);
    expect(overall).toBeLessThan(0.3);
  });
});
