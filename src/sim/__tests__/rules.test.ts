import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { buildSnapshot, estimateSnapshotBytes } from '../snapshot.ts';
import {
  AOI_RADIUS,
  ARENA_RADIUS,
  MATCH_TICKS,
  MAX_HP,
  PLAYER_RADIUS,
  SNAPSHOT_HZ,
  STEALTH_DURATION_TICKS,
  TICK_HZ,
} from '../constants.ts';
import { emptyInput, type InputFrame } from '../types.ts';

function sim(seed = 1, playerCount = 12) {
  return new Simulation({ seed, playerCount, humanCount: 1 });
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(1), ...over };
}

describe('zasada zaufania i widoczność (sekcja 3 i 7)', () => {
  it('gracz w ukryciu NIE jest wysyłany do klienta', () => {
    const s = sim();
    // Postaw dwóch graczy obok siebie, żeby AoI nie był powodem odfiltrowania.
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;
    s.world.phase = 'live';
    a.x = 0; a.y = 0;
    b.x = 3; b.y = 0;

    const before = buildSnapshot(s.world, a.id);
    expect(before.players.some((p) => p.id === b.id)).toBe(true);

    b.stealthEndTick = s.world.tick + STEALTH_DURATION_TICKS;

    const after = buildSnapshot(s.world, a.id);
    // Kluczowe: nie „widoczny: false", tylko całkowity brak w ładunku.
    expect(after.players.some((p) => p.id === b.id)).toBe(false);
    expect(JSON.stringify(after)).not.toContain(b.name);
  });

  it('gracz widzi własne ukrycie', () => {
    const s = sim();
    const a = s.world.players[0]!;
    a.stealthEndTick = s.world.tick + STEALTH_DURATION_TICKS;
    const snap = buildSnapshot(s.world, a.id);
    const self = snap.players.find((p) => p.id === a.id);
    expect(self?.stealthed).toBe(true);
  });

  it('Area of Interest odcina byty poza promieniem widzenia', () => {
    const s = sim();
    s.world.phase = 'live';
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;
    a.x = 0; a.y = 0;
    b.x = AOI_RADIUS + 5; b.y = 0;

    const snap = buildSnapshot(s.world, a.id);
    expect(snap.players.some((p) => p.id === b.id)).toBe(false);

    b.x = AOI_RADIUS - 5;
    expect(buildSnapshot(s.world, a.id).players.some((p) => p.id === b.id)).toBe(true);
  });

  it('ukryty przeciwnik nie może zostać celem auto-ataku', () => {
    const s = sim();
    s.world.phase = 'live';
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;
    for (const p of s.world.players) {
      // Odsuń resztę lobby, żeby test dotyczył tylko tej pary.
      if (p.id > 1) { p.x = 1000; p.y = 1000; p.alive = false; }
    }
    a.x = 0; a.y = 0;
    b.x = 2; b.y = 0;
    b.stealthEndTick = s.world.tick + 200;
    // `b` musi pozostać bierny: własny atak celowo zdejmuje ukrycie
    // (patrz test niżej), a tutaj sprawdzamy wyłącznie regułę celowania.
    b.ai = undefined;
    b.cdAttack = Number.MAX_SAFE_INTEGER;
    const hpBefore = b.hp;

    for (let i = 0; i < 20; i++) s.step();

    expect(b.hp).toBe(hpBefore);
  });

  it('atak z ukrycia zdejmuje ukrycie napastnikowi', () => {
    const s = sim();
    s.world.phase = 'live';
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;
    for (const p of s.world.players) {
      if (p.id > 1) { p.x = 1000; p.y = 1000; p.alive = false; }
    }
    a.x = 0; a.y = 0;
    b.x = 2; b.y = 0;
    a.stealthEndTick = s.world.tick + 200;
    b.ai = undefined;
    b.cdAttack = Number.MAX_SAFE_INTEGER;

    // `a` atakuje automatycznie, bo `b` jest w zasięgu — i tym samym
    // przestaje być niewidzialny. Ukrycie ma być zasadzką, nie immunitetem.
    for (let i = 0; i < 5; i++) s.step();

    expect(a.stealthEndTick).toBeLessThanOrEqual(s.world.tick + 2);
    expect(b.hp).toBeLessThan(MAX_HP);
  });
});

describe('wejścia klienta', () => {
  it('wejście z niższym seq jest odrzucane (ochrona przed powtórką)', () => {
    const s = sim();
    s.pushInput(0, input({ seq: 10, moveX: 1 }));
    s.pushInput(0, input({ seq: 3, moveX: -1 }));
    s.world.phase = 'live';
    const startX = s.world.players[0]!.x;
    s.step();
    // Ruch poszedł w prawo (seq 10), a nie w lewo (seq 3).
    expect(s.world.players[0]!.x).toBeGreaterThan(startX);
  });

  it('pojedyncze tapnięcie aktywuje umiejętność tylko raz', () => {
    const s = sim();
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    s.pushInput(0, input({ seq: 1, dash: true }));
    s.step();
    const firstCd = p.cdDash;
    expect(firstCd).toBeGreaterThan(0);

    // Kolejne ticki bez nowego wejścia nie mogą odpalić skoku ponownie.
    for (let i = 0; i < 5; i++) s.step();
    expect(p.cdDash).toBe(firstCd);
  });
});

describe('ograniczenia świata', () => {
  it('gracz nigdy nie wychodzi poza arenę', () => {
    const s = sim();
    s.world.phase = 'live';
    for (let t = 0; t < 400; t++) {
      s.pushInput(0, input({ seq: t + 1, moveX: 1, moveY: 0.4, dash: t % 20 === 0 }));
      s.step();
      for (const p of s.world.players) {
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(ARENA_RADIUS - PLAYER_RADIUS + 0.001);
      }
    }
  });

  it('HP nigdy nie schodzi poniżej zera ani nie przekracza maksimum', () => {
    const s = sim(4242);
    for (let t = 0; t < MATCH_TICKS; t++) {
      s.step();
      for (const p of s.world.players) {
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(MAX_HP);
      }
      if (s.world.phase === 'over') break;
    }
  });

  it('martwy gracz nie wraca do życia', () => {
    const s = sim(31337);
    const died = new Set<number>();
    for (let t = 0; t < MATCH_TICKS; t++) {
      s.step();
      for (const p of s.world.players) {
        if (!p.alive) died.add(p.id);
        else expect(died.has(p.id)).toBe(false);
      }
      if (s.world.phase === 'over') break;
    }
    expect(died.size).toBeGreaterThan(0);
  });
});

describe('budżet pasma (sekcja 4: ≤1,5 MB na mecz)', () => {
  it('prognoza transferu mieści się w budżecie', () => {
    const s = sim(2024);
    let bytes = 0;
    let snapshots = 0;
    const ticksPerSnapshot = TICK_HZ / SNAPSHOT_HZ;

    for (let t = 0; t < MATCH_TICKS; t++) {
      s.pushInput(0, input({ seq: t + 1, moveX: Math.sin(t / 30), moveY: Math.cos(t / 40) }));
      s.step();
      if (t % ticksPerSnapshot === 0) {
        bytes += estimateSnapshotBytes(buildSnapshot(s.world, 0));
        snapshots++;
      }
      if (s.world.phase === 'over') break;
    }

    // Ruch w górę: wejścia klienta (20 Hz × ~8 B) też zużywają pasmo.
    const inputBytes = MATCH_TICKS * 8;
    const total = bytes + inputBytes;

    expect(snapshots).toBeGreaterThan(0);
    expect(total).toBeLessThan(1.5 * 1024 * 1024);
  });
});

describe('boty (sekcja 7: fill botami jest nieopcjonalny)', () => {
  it('boty aktywnie walczą, a nie tylko istnieją', () => {
    const s = sim(8080);
    for (let t = 0; t < MATCH_TICKS; t++) {
      s.step();
      if (s.world.phase === 'over') break;
    }
    const botKills = s.world.players
      .filter((p) => p.isBot)
      .reduce((n, p) => n + p.kills, 0);
    // Gdyby boty nie zabijały, mecz kończyłby się wyłącznie strefą,
    // a pierwszy gracz zobaczyłby pustą arenę z chodzącymi manekinami.
    expect(botKills).toBeGreaterThan(0);
  });

  it('boty poruszają się i nie zbijają się w jeden punkt', () => {
    const s = sim(606);
    for (let t = 0; t < 20 * TICK_HZ; t++) s.step();
    const alive = s.world.players.filter((p) => p.alive);
    const positions = new Set(alive.map((p) => `${p.x.toFixed(0)}:${p.y.toFixed(0)}`));
    expect(positions.size).toBeGreaterThan(Math.min(3, alive.length - 1));
  });
});
