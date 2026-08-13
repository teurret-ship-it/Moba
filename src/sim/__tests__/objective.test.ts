import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ } from '../constants.ts';
import { OBJECTIVE_RADIUS, objectiveProgressFraction } from '../objective.ts';
import { buildSnapshot } from '../snapshot.ts';

function liveSim(seed = 1) {
  const s = new Simulation({ seed, playerCount: 6, humanCount: 1 });
  s.world.phase = 'live';
  return s;
}

/** Ustawia scenę: Rdzeń aktywny w znanym miejscu, wszyscy poza nim. */
function armObjective(s: Simulation, x = 0, y = 0) {
  const o = s.world.objective;
  o.active = true;
  o.x = x;
  o.y = y;
  o.progress = 0;
  o.holderId = -1;
  o.contested = false;
  o.expiresTick = s.world.tick + 60 * TICK_HZ;
  for (const p of s.world.players) {
    p.x = 200;
    p.y = 200;
    p.ai = undefined;
  }
  return o;
}

describe('Rdzeń — przejmowanie', () => {
  it('samotny gracz przejmuje po odstaniu swojego', () => {
    const s = liveSim();
    armObjective(s);
    const p = s.world.players[0]!;
    const levelBefore = p.level;

    let captured = false;
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      p.x = 0;
      p.y = 0;
      s.step();
      if (s.world.events.some((e) => e.type === 'objectiveCaptured')) captured = true;
      if (captured) break;
    }

    expect(captured).toBe(true);
    // Nagrodą jest awans — mechanika, którą gracz już zna. Doświadczenie
    // jest od razu konsumowane przez awans, więc sprawdzamy skutek
    // (poziom i wystawiona karta), a nie samo doświadczenie.
    s.step();
    expect(p.level).toBeGreaterThan(levelBefore);
    expect(p.offer.length).toBeGreaterThan(0);
  });

  it('dwóch graczy w kręgu zatrzymuje postęp', () => {
    const s = liveSim(2);
    const o = armObjective(s);
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;

    // Najpierw sam — postęp rośnie.
    for (let i = 0; i < 20; i++) {
      a.x = 0; a.y = 0;
      s.step();
    }
    const solo = o.progress;
    expect(solo).toBeGreaterThan(0);

    // Teraz we dwóch — postęp stoi.
    for (let i = 0; i < 30; i++) {
      a.x = 0; a.y = 0;
      b.x = 1; b.y = 0;
      s.step();
    }

    expect(o.contested).toBe(true);
    expect(o.progress).toBe(solo);
  });

  it('zmiana zdobywcy zeruje postęp', () => {
    const s = liveSim(3);
    const o = armObjective(s);
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;

    for (let i = 0; i < 25; i++) {
      a.x = 0; a.y = 0;
      s.step();
    }
    expect(o.progress).toBeGreaterThan(0);
    expect(o.holderId).toBe(a.id);

    // `a` odchodzi, wchodzi `b` — nie dziedziczy cudzej pracy.
    a.x = 200; a.y = 200;
    b.x = 0; b.y = 0;
    s.step();

    expect(o.holderId).toBe(b.id);
    expect(o.progress).toBeLessThanOrEqual(1);
  });

  it('gracz w ukryciu nie przejmuje', () => {
    // Inaczej Cień dawałby darmowe przejęcie, którego nikt nie może
    // zakwestionować — a cały sens punktu polega na tym, że da się go odbić.
    const s = liveSim(4);
    const o = armObjective(s);
    const p = s.world.players[0]!;
    p.stealthEndTick = s.world.tick + 500;

    for (let i = 0; i < 8 * TICK_HZ; i++) {
      p.x = 0;
      p.y = 0;
      s.step();
    }

    expect(o.progress).toBe(0);
    expect(objectiveProgressFraction(o)).toBe(0);
  });

  it('stanie poza kręgiem nie liczy się', () => {
    const s = liveSim(5);
    const o = armObjective(s);
    const p = s.world.players[0]!;

    for (let i = 0; i < 40; i++) {
      p.x = OBJECTIVE_RADIUS + 2;
      p.y = 0;
      s.step();
    }

    expect(o.progress).toBe(0);
  });
});

describe('Rdzeń — widoczność i cykl życia', () => {
  it('jest informacją globalną, mimo AoI', () => {
    // Punkt przejęcia działa tylko wtedy, gdy wszyscy wiedzą, gdzie jest.
    const s = liveSim(6);
    armObjective(s, 40, 0);
    const viewer = s.world.players[0]!;
    viewer.x = -40;
    viewer.y = 0;

    const snap = buildSnapshot(s.world, viewer.id);
    expect(snap.objective.active).toBe(true);
    expect(snap.objective.x).toBe(40);
  });

  it('znika, gdy zostanie poza kurczącą się strefą', () => {
    const s = liveSim(7);
    // Promień strefy jest funkcją ticka, więc przesuwamy czas do momentu,
    // w którym krąg jest już ciasny — ręczne ustawienie promienia zostałoby
    // nadpisane przez `stepZone` w tym samym kroku.
    s.world.tick = 4200;
    const o = armObjective(s, 40, 0);

    s.step();

    expect(s.world.zone.radius).toBeLessThan(20);
    expect(o.active).toBe(false);
  });

  it('pojawia się w normalnym meczu i bywa przejmowany', () => {
    let spawned = 0;
    let captured = 0;

    for (const seed of [1, 42, 4242]) {
      const sim = new Simulation({ seed, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < MATCH_TICKS; t++) {
        sim.step();
        for (const e of sim.world.events) {
          if (e.type === 'objectiveSpawn') spawned++;
          if (e.type === 'objectiveCaptured') captured++;
        }
        if (sim.world.phase === 'over') break;
      }
    }

    expect(spawned).toBeGreaterThan(0);
    // Gdyby boty nigdy nie przejmowały, punkt byłby dekoracją, a dla
    // gracza — darmową nagrodą bez starcia.
    expect(captured).toBeGreaterThan(0);
  });
});
