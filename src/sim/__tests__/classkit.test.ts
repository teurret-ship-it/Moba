import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ } from '../constants.ts';
import { CLASS_IDS, getClass, POWER_ABILITY, TRICK_ABILITY, type ClassId } from '../classes.ts';
import { killPlayer } from '../combat.ts';
import {
  availableUpgrades,
  CLASS_UPGRADES,
  computeStats,
  UPGRADES,
  UPGRADE_IDS,
  type UpgradeId,
} from '../upgrades.ts';
import { emptyInput, type InputFrame } from '../types.ts';

/**
 * Ulepszenia klasowe i cechy klas.
 *
 * Wspólne ulepszenia podnoszą liczby, klasowe zmieniają to, co postać robi.
 * Ta różnica jest cała wartością iteracji, więc pilnujemy dwóch rzeczy:
 * że karta trafia wyłącznie do swojej klasy i że naprawdę zmienia efekt
 * umiejętności, a nie tylko opis na karcie.
 */

function arena(localClass: ClassId, seed = 1) {
  const s = new Simulation({ seed, playerCount: 4, humanCount: 1, localClass });
  s.world.phase = 'live';
  for (const p of s.world.players) {
    if (p.id === 0) continue;
    p.x = 300;
    p.y = 300;
    p.ai = undefined;
  }
  return s;
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(1), ...over };
}

function give(s: Simulation, id: UpgradeId, times = 1): void {
  const p = s.world.players[0]!;
  for (let i = 0; i < times; i++) p.upgrades.push(id);
  p.stats = computeStats(p.classId, p.upgrades);
  p.maxHp = p.stats.maxHp;
}

describe('pula ulepszeń', () => {
  it('karta klasowa nie trafia do obcej klasy', () => {
    for (const id of CLASS_IDS) {
      const pool = availableUpgrades([], id);
      for (const up of pool) {
        const owner = UPGRADES[up].classId;
        expect(owner === undefined || owner === id, `${up} w puli ${id}`).toBe(true);
      }
      // ...ale własne w niej są. Inaczej cała mechanika byłaby martwa.
      for (const own of CLASS_UPGRADES[id]) expect(pool).toContain(own);
    }
  });

  it('każda klasa ma swoje karty i każda karta ma właściciela', () => {
    for (const id of CLASS_IDS) expect(CLASS_UPGRADES[id].length).toBeGreaterThan(0);
    const assigned = CLASS_IDS.flatMap((id) => CLASS_UPGRADES[id]);
    const declared = UPGRADE_IDS.filter((id) => UPGRADES[id].classId !== undefined);
    expect(assigned.sort()).toEqual(declared.sort());
  });

  it('limit stosów obowiązuje też karty klasowe', () => {
    const grad = UPGRADES.grad.maxStacks;
    const taken: UpgradeId[] = Array.from({ length: grad }, () => 'grad');
    expect(availableUpgrades(taken, 'lowca')).not.toContain('grad');
  });

  it('statystyki bez ulepszeń są neutralne', () => {
    // Klasa, która danej karty nie ma w puli, musi liczyć się dokładnie
    // tak jak przed iteracją — inaczej dołożenie karty zmienia balans
    // wszystkim naraz.
    for (const id of CLASS_IDS) {
      const s = computeStats(id, []);
      expect(s.salvoBonusShots).toBe(0);
      expect(s.stealthBonusTicks).toBe(0);
      expect(s.stealthSpeedMul).toBe(1);
      expect(s.shieldBonusAbsorb).toBe(0);
      expect(s.chargeBonusDamage).toBe(0);
      expect(s.ambushBonus).toBe(0);
      expect(s.moveCooldownMul).toBe(1);
      expect(s.decoyBonusHp).toBe(0);
      expect(s.snareSlowBonus).toBe(0);
    }
  });
});

describe('karty Łowcy', () => {
  it('Grad dokłada pociski do Salwy', () => {
    // Liczymy wystrzały, nie licznik: Salwa startuje i strzela w tym samym
    // ticku, więc `salvoLeft` tuż po wciśnięciu jest już pomniejszony.
    const shots = (upgrades: number) => {
      const s = arena('lowca');
      const p = s.world.players[0]!;
      const enemy = s.world.players[1]!;
      give(s, 'grad', upgrades);
      // Salwa nie odpala bez celu w zasięgu — postać musi realnie stać
      // obok przeciwnika, a nie tam, gdzie ją postawił spawn.
      p.x = 0;
      p.y = 0;
      p.cdAttack = Number.MAX_SAFE_INTEGER;
      enemy.hp = 10_000;
      enemy.maxHp = 10_000;

      let fired = 0;
      s.pushInput(0, input({ seq: 1, burst: true }));
      for (let i = 0; i < 30; i++) {
        enemy.x = 3;
        enemy.y = 0;
        s.step();
        fired += s.world.events.filter((e) => e.type === 'salvo').length;
      }
      return fired;
    };

    expect(shots(0)).toBe(POWER_ABILITY.salwa.shots);
    expect(shots(2)).toBe(POWER_ABILITY.salwa.shots + 2);
  });

  it('Czajenie wydłuża Cień i przyspiesza w ukryciu', () => {
    const plain = arena('lowca', 2);
    const buffed = arena('lowca', 2);
    give(buffed, 'czajenie');

    for (const s of [plain, buffed]) {
      s.pushInput(0, input({ seq: 1, stealth: true }));
      s.step();
    }

    const a = plain.world.players[0]!;
    const b = buffed.world.players[0]!;
    expect(b.stealthEndTick - a.stealthEndTick).toBe(Math.round(1.5 * TICK_HZ));

    // Ukrycie w tej grze przyspiesza (mnożnik 1,18) — jest narzędziem
    // zrywania kontaktu, nie skradania. Czajenie dokłada do tego swoje.
    for (const s of [plain, buffed]) {
      const p = s.world.players[0]!;
      p.x = 0;
      p.y = 0;
      p.vx = 0;
      p.vy = 0;
      for (let i = 0; i < 24; i++) {
        s.pushInput(0, input({ seq: 10 + i, moveX: 1 }));
        s.step();
      }
    }
    expect(b.x).toBeGreaterThan(a.x);
  });
});

describe('karty Kolosa', () => {
  it('Pancerz powiększa pulę Tarczy', () => {
    const s = arena('kolos', 3);
    give(s, 'pancerz', 2);
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();
    expect(s.world.players[0]!.shieldHp).toBe(TRICK_ABILITY.tarcza.absorb + 40);
  });

  it('Taran podnosi obrażenia Szarży', () => {
    const hit = (upgrades: number) => {
      const s = arena('kolos', 4);
      const p = s.world.players[0]!;
      const enemy = s.world.players[1]!;
      give(s, 'taran', upgrades);
      p.x = 0;
      p.y = 0;
      enemy.x = 1.2;
      enemy.y = 0;
      const before = enemy.hp;
      s.pushInput(0, input({ seq: 1, moveX: 1, dash: true }));
      s.step();
      return before - enemy.hp;
    };

    expect(hit(1)).toBeCloseTo(hit(0) + 12, 3);
  });
});

describe('karty i cecha Widma', () => {
  it('Zasadzka mnoży Rozdarcie tylko z ukrycia', () => {
    const rend = (upgrades: number, fromStealth: boolean) => {
      const s = arena('widmo', 5);
      const p = s.world.players[0]!;
      const enemy = s.world.players[1]!;
      give(s, 'zasadzka', upgrades);
      p.x = 0;
      p.y = 0;
      p.facing = 0;
      enemy.x = 3;
      enemy.y = 0;
      enemy.hp = 10_000;
      enemy.maxHp = 10_000;
      // Auto-atak zafałszowałby pomiar — cel stoi w zasięgu.
      p.cdAttack = Number.MAX_SAFE_INTEGER;
      if (fromStealth) {
        s.pushInput(0, input({ seq: 1, stealth: true }));
        s.step();
      }
      const before = enemy.hp;
      s.pushInput(0, input({ seq: 2, burst: true }));
      for (let i = 0; i < 6; i++) {
        enemy.x = 3;
        enemy.y = 0;
        s.step();
      }
      return before - enemy.hp;
    };

    // Bez ukrycia karta nic nie robi — to nie jest ogólny wzrost obrażeń.
    expect(rend(2, false)).toBeCloseTo(rend(0, false), 3);
    expect(rend(1, true)).toBeGreaterThan(rend(0, true) * 1.2);
  });

  it('Przeskok skraca odnowienie Mgnienia, ale nie reszty kitu', () => {
    const s = arena('widmo', 6);
    const p = s.world.players[0]!;
    give(s, 'przeskok');

    s.pushInput(0, input({ seq: 1, moveX: 1, dash: true, stealth: true }));
    s.step();

    const move = getClass('widmo').move;
    const moveCd = p.cdMove - s.world.tick;
    const trickCd = p.cdTrick - s.world.tick;
    expect(moveCd).toBeLessThan(Math.round(4 * TICK_HZ));
    // Cień odnawia się tak jak zawsze — inaczej Widmo dostawałoby wszystko
    // naraz, a nie mobilność.
    expect(trickCd).toBe(TRICK_ABILITY.cien.cooldownTicks);
    expect(move).toBe('mgnienie');
  });

  it('cecha: eliminacja natychmiast odnawia Cień', () => {
    const s = arena('widmo', 7);
    const p = s.world.players[0]!;
    const victim = s.world.players[1]!;

    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();
    expect(p.cdTrick).toBeGreaterThan(s.world.tick);

    killPlayer(s.world, victim, p.id);
    expect(p.cdTrick).toBeLessThanOrEqual(s.world.tick);
  });

  it('cecha należy tylko do Widma', () => {
    for (const id of CLASS_IDS) {
      expect(Boolean(getClass(id).trickResetOnKill)).toBe(id === 'widmo');
    }
  });
});

describe('karty Kuglarza', () => {
  it('Trwała kopia daje Zwodowi zdrowie i czas', () => {
    const s = arena('kuglarz', 8);
    give(s, 'trwala_kopia');
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();

    const d = s.world.decoys[0]!;
    expect(d.hp).toBe(TRICK_ABILITY.zwod.hp + 30);
    expect(d.endTick - s.world.tick).toBeGreaterThan(TRICK_ABILITY.zwod.durationTicks);
  });

  it('Ciasne sidła spowalniają mocniej i dłużej', () => {
    const s = arena('kuglarz', 9);
    const p = s.world.players[0]!;
    const enemy = s.world.players[1]!;
    give(s, 'ciasne_sidla', 2);
    p.x = 0;
    p.y = 0;
    enemy.x = 3;
    enemy.y = 0;
    p.cdAttack = Number.MAX_SAFE_INTEGER;

    s.pushInput(0, input({ seq: 1, burst: true }));
    for (let i = 0; i < 6; i++) {
      enemy.x = 3;
      enemy.y = 0;
      s.step();
    }

    expect(enemy.slowMul).toBeLessThan(POWER_ABILITY.sidla.slowMul);
    expect(enemy.slowEndTick - s.world.tick).toBeGreaterThan(POWER_ABILITY.sidla.durationTicks);
    // Kontrola nie zamienia się w zabijanie — Sidła nadal nie ranią.
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

describe('kit klasowy w normalnym meczu', () => {
  it('boty biorą karty klasowe i mecz nadal się kończy', () => {
    const picked = new Set<UpgradeId>();
    let finished = 0;

    for (const seed of [101, 202, 303, 404]) {
      const sim = new Simulation({ seed, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < MATCH_TICKS; t++) {
        sim.step();
        for (const e of sim.world.events) {
          if (e.type === 'upgradePicked' && UPGRADES[e.upgrade].classId !== undefined) {
            picked.add(e.upgrade);
          }
        }
        if (sim.world.phase === 'over') break;
      }
      if (sim.world.phase === 'over') finished += 1;
    }

    expect(finished).toBe(4);
    // Karta, której bot nigdy nie weźmie, nie istnieje w pomiarach balansu.
    expect(picked.size).toBeGreaterThanOrEqual(6);
  });

  it('kit klasowy nie psuje determinizmu', () => {
    const run = () => {
      const sim = new Simulation({ seed: 4242, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < 90 * TICK_HZ; t++) sim.step();
      return sim.world.players
        .map((p) => `${p.x.toFixed(6)},${p.hp.toFixed(3)},${p.upgrades.join('+')}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});
