import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { ARENA_RADIUS, MATCH_TICKS, PLAYER_RADIUS, ZONE_END_RADIUS } from '../constants.ts';
import {
  distanceToObstacle,
  generateTerrain,
  hasLineOfSight,
  pushOutOfObstacles,
} from '../terrain.ts';
import { emptyInput, type InputFrame } from '../types.ts';

function input(over: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(1), ...over };
}

describe('generacja terenu', () => {
  it('jest deterministyczna — to samo ziarno daje tę samą mapę', () => {
    expect(generateTerrain(1234)).toEqual(generateTerrain(1234));
    expect(generateTerrain(1234)).not.toEqual(generateTerrain(1235));
  });

  it('nie zastawia środka areny ani krawędzi', () => {
    for (const seed of [1, 42, 777, 31337, 65535]) {
      const obstacles = generateTerrain(seed);
      expect(obstacles.length).toBeGreaterThan(4);

      for (const o of obstacles) {
        // Finał rozgrywa się w środku — tam nie może stać mur.
        expect(distanceToObstacle(0, 0, o)).toBeGreaterThan(ZONE_END_RADIUS);
        // Nic nie wystaje poza arenę.
        for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]] as const) {
          expect(Math.hypot(x, y) + o.r).toBeLessThan(ARENA_RADIUS);
        }
      }
    }
  });
});

describe('kolizje z terenem', () => {
  it('postać nigdy nie zostaje wewnątrz przeszkody', () => {
    const s = new Simulation({ seed: 4242, playerCount: 12, humanCount: 1 });
    s.world.phase = 'live';

    for (let t = 0; t < 600; t++) {
      // Gracz celowo taranuje mapę, łącznie ze skokami.
      s.pushInput(
        0,
        input({ seq: t + 1, moveX: Math.cos(t / 25), moveY: Math.sin(t / 17), dash: t % 30 === 0 }),
      );
      s.step();

      for (const p of s.world.players) {
        if (!p.alive) continue;
        for (const o of s.world.obstacles) {
          // Dopuszczamy mikroskopijne zanurzenie z zaokrągleń zmiennoprzecinkowych.
          expect(distanceToObstacle(p.x, p.y, o)).toBeGreaterThan(o.r + PLAYER_RADIUS - 0.05);
        }
      }
    }
  });

  it('wypchnięcie „do przodu" przenosi na drugą stronę muru', () => {
    // Tak działa Mgnienie: teleport przechodzi przez osłonę zamiast się
    // od niej odbijać. To jedyna rzecz, która obraca teren na korzyść Widma.
    const wall = { x1: 0, y1: -6, x2: 0, y2: 6, r: 1.5 };
    const p = { x: 0.2, y: 0, vx: 0, vy: 0 };

    pushOutOfObstacles(p, [wall], { x: 1, y: 0 });
    expect(p.x).toBeGreaterThan(wall.r);

    // Bez kierunku wypchnięcie idzie do najbliższej krawędzi — czyli z powrotem.
    const q = { x: -0.2, y: 0, vx: 0, vy: 0 };
    pushOutOfObstacles(q, [wall]);
    expect(q.x).toBeLessThan(0);
  });
});

describe('linia strzału', () => {
  it('mur między postaciami blokuje trafienie', () => {
    const wall = [{ x1: 0, y1: -8, x2: 0, y2: 8, r: 1.5 }];
    expect(hasLineOfSight(-10, 0, 10, 0, wall)).toBe(false);
    // Obejście dołem — czysto.
    expect(hasLineOfSight(-10, -12, 10, -12, wall)).toBe(true);
    // Brak przeszkód — zawsze czysto.
    expect(hasLineOfSight(-10, 0, 10, 0, [])).toBe(true);
  });

  it('nie da się trafić przeciwnika zza muru', () => {
    const s = new Simulation({ seed: 5, playerCount: 4, humanCount: 1 });
    s.world.phase = 'live';

    // Ustaw scenę ręcznie: gruby mur dokładnie między dwiema postaciami.
    s.world.obstacles = [{ x1: 0, y1: -8, x2: 0, y2: 8, r: 2 }];
    const a = s.world.players[0]!;
    const b = s.world.players[1]!;
    for (const p of s.world.players) {
      if (p.id > 1) { p.alive = false; p.x = 500; p.y = 500; }
    }
    a.x = -4; a.y = 0;
    b.x = 4; b.y = 0;
    b.ai = undefined;
    b.cdAttack = Number.MAX_SAFE_INTEGER;
    const hpBefore = b.hp;

    for (let i = 0; i < 30; i++) {
      a.x = -4; a.y = 0;
      b.x = 4; b.y = 0;
      s.step();
    }

    expect(b.hp).toBe(hpBefore);
  });
});

describe('teren nie psuje reszty symulacji', () => {
  it('mecz nadal kończy się w limicie czasu', () => {
    for (const seed of [3, 77, 909]) {
      const s = new Simulation({ seed, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < MATCH_TICKS; t++) {
        s.step();
        if (s.world.phase === 'over') break;
      }
      expect(s.world.phase).toBe('over');
    }
  });
});
