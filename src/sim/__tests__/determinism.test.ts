import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ } from '../constants.ts';
import { Rng, seedFromString } from '../rng.ts';
import type { InputFrame } from '../types.ts';

/**
 * Determinizm symulacji.
 *
 * Dlaczego to jest testowane w Fazie 0, mimo że backendu jeszcze nie ma:
 * w Fazie 1 klient predykuje ruch tym samym kodem, którym serwer liczy
 * prawdę. Jeśli symulacja przestanie być deterministyczna (np. przez
 * wsunięcie gdzieś Math.random), rozjazd objawi się jako „gumkowanie"
 * u graczy i będzie praktycznie niediagnozowalny.
 *
 * Ten test jest tańszy niż tamten debug.
 */

function runMatch(seed: number, ticks: number, inputs?: (tick: number) => InputFrame) {
  const sim = new Simulation({ seed, playerCount: 12, humanCount: 1 });
  for (let t = 0; t < ticks; t++) {
    if (inputs) sim.pushInput(0, inputs(t));
    sim.step();
  }
  return sim;
}

function fingerprint(sim: Simulation): string {
  return sim.world.players
    .map((p) =>
      [
        p.id,
        p.x.toFixed(6),
        p.y.toFixed(6),
        p.hp.toFixed(4),
        p.alive ? 1 : 0,
        p.kills,
        p.score,
      ].join(','),
    )
    .join('|');
}

describe('determinizm', () => {
  it('ten sam seed daje identyczny przebieg', () => {
    const a = runMatch(12345, 600);
    const b = runMatch(12345, 600);
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.world.tick).toBe(b.world.tick);
  });

  it('różne seedy dają różne przebiegi', () => {
    const a = runMatch(1, 600);
    const b = runMatch(2, 600);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('powtarzalność zachowuje się przy wejściach gracza', () => {
    const script = (tick: number): InputFrame => ({
      seq: tick + 1,
      moveX: Math.sin(tick * 0.1),
      moveY: Math.cos(tick * 0.13),
      // Celowanie ręczne co jakiś czas — determinizm musi obejmować także
      // tę ścieżkę, nie tylko automat.
      aimX: tick % 30 === 0 ? Math.sin(tick * 0.2) : 0,
      aimY: tick % 30 === 0 ? Math.cos(tick * 0.2) : 0,
      dash: tick % 137 === 0,
      stealth: tick % 311 === 0,
      burst: tick % 223 === 0,
      pick: -1,
    });
    const a = runMatch(999, 900, script);
    const b = runMatch(999, 900, script);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('Rng', () => {
  it('jest powtarzalny i mieści się w [0,1)', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('clone rozgałęzia strumień bez wpływu na oryginał', () => {
    const a = new Rng(7);
    a.next();
    const b = a.clone();
    expect(a.next()).toBe(b.next());
  });

  it('seedFromString jest stabilny', () => {
    expect(seedFromString('arena')).toBe(seedFromString('arena'));
    expect(seedFromString('arena')).not.toBe(seedFromString('arenb'));
  });

  it('pointInCircle nie wychodzi poza promień', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      const p = rng.pointInCircle(5, -2, 10);
      expect(Math.hypot(p.x - 5, p.y + 2)).toBeLessThanOrEqual(10.0001);
    }
  });
});

describe('zakończenie meczu', () => {
  it('każdy mecz kończy się w limicie czasu', () => {
    // Strefa istnieje właśnie po to, żeby to było prawdą dla KAŻDEGO seeda.
    // Gdyby choć jeden przebieg nie kończył się sam, mecze wisiałyby
    // w produkcji i trzymały instancję serwera (sekcja 13: koszt/sesja).
    for (const seed of [1, 2, 3, 77, 4242, 99999]) {
      const sim = runMatch(seed, MATCH_TICKS + TICK_HZ);
      expect(sim.world.phase).toBe('over');
      expect(sim.world.winner).toBeGreaterThanOrEqual(0);
    }
  });

  it('wyłania dokładnie jednego zwycięzcę i pełną tabelę', () => {
    const sim = runMatch(555, MATCH_TICKS + TICK_HZ);
    const result = sim.result();
    expect(result.standings).toHaveLength(12);
    expect(new Set(result.standings.map((s) => s.place)).size).toBe(12);
    expect(result.standings[0]!.id).toBe(result.winner);
  });
});
