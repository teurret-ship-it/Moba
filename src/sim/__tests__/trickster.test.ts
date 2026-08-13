import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ } from '../constants.ts';
import { POWER_ABILITY, TRICK_ABILITY } from '../classes.ts';
import { buildSnapshot } from '../snapshot.ts';
import { emptyInput, type InputFrame } from '../types.ts';

function trickster(seed = 1) {
  const s = new Simulation({ seed, playerCount: 4, humanCount: 1, localClass: 'kuglarz' });
  s.world.phase = 'live';
  // Reszta lobby odsunięta i bierna — testujemy mechanikę, nie starcie.
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

describe('Zwód', () => {
  it('staje tam, gdzie stoisz, i znika po czasie', () => {
    const s = trickster();
    const p = s.world.players[0]!;
    p.x = 5;
    p.y = -3;

    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();

    expect(s.world.decoys).toHaveLength(1);
    const d = s.world.decoys[0]!;
    // Postawienie kopii jest zobowiązaniem: zdradza miejsce, w którym byłeś.
    expect(d.x).toBeCloseTo(5, 3);
    expect(d.y).toBeCloseTo(-3, 3);
    expect(d.ownerId).toBe(p.id);

    for (let i = 0; i < TRICK_ABILITY.zwod.durationTicks + 2; i++) s.step();
    expect(s.world.decoys).toHaveLength(0);
  });

  it('jest tylko jeden naraz', () => {
    // Inaczej Kuglarz zapełniłby arenę kopiami i przestałoby to być zmyłką,
    // a stało się ścianą.
    const s = trickster(2);
    const p = s.world.players[0]!;

    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();
    p.cdTrick = 0;
    p.x += 6;
    s.pushInput(0, input({ seq: 2, stealth: true }));
    s.step();

    expect(s.world.decoys).toHaveLength(1);
  });

  it('ściąga auto-atak przeciwnika', () => {
    // To jest cały sens Zwodu: dla atakującego jest nieodróżnialny od
    // postaci, więc pochłania cios, który miał trafić gdzie indziej.
    const s = trickster(3);
    const p = s.world.players[0]!;
    const enemy = s.world.players[1]!;

    p.x = 0; p.y = 0;
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();
    const decoy = s.world.decoys[0]!;
    expect(decoy.hp).toBe(TRICK_ABILITY.zwod.hp);

    // Wróg bliżej kopii niż właściciela.
    enemy.x = 1; enemy.y = 0;
    p.x = 12; p.y = 0;
    const ownerHpBefore = p.hp;

    for (let i = 0; i < 20; i++) {
      enemy.x = 1; enemy.y = 0;
      p.x = 12; p.y = 0;
      s.step();
    }

    expect(p.hp).toBe(ownerHpBefore);
    const stillThere = s.world.decoys[0];
    // Kopia albo oberwała, albo została rozbita — w obu przypadkach
    // przejęła na siebie cios.
    expect(stillThere === undefined || stillThere.hp < TRICK_ABILITY.zwod.hp).toBe(true);
  });

  it('znika razem z właścicielem', () => {
    const s = trickster(4);
    const p = s.world.players[0]!;
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();
    expect(s.world.decoys).toHaveLength(1);

    p.alive = false;
    s.step();

    // Kopia bez właściciela zostawałaby na mapie jako duch, którego nikt
    // nie może rozliczyć.
    expect(s.world.decoys).toHaveLength(0);
  });
});

describe('Zamiana', () => {
  it('zamienia miejscami z kopią, nie teleportuje w jedną stronę', () => {
    const s = trickster(5);
    const p = s.world.players[0]!;

    p.x = 0; p.y = 0;
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();

    // Odejdź od kopii, potem zamień się z nią.
    p.x = 20; p.y = 8;
    const fromX = p.x;
    const fromY = p.y;

    s.pushInput(0, input({ seq: 2, dash: true }));
    s.step();

    // Właściciel wylądował na miejscu kopii...
    expect(Math.hypot(p.x - 0, p.y - 0)).toBeLessThan(1.5);
    // ...a kopia przejęła jego miejsce. Bez tego przeciwnik bijący w Zwód
    // od razu wie, że został oszukany.
    const d = s.world.decoys[0]!;
    expect(Math.hypot(d.x - fromX, d.y - fromY)).toBeLessThan(0.001);
  });

  it('bez kopii działa jak zwykły krótki skok', () => {
    // Umiejętność ma zawsze coś robić, inaczej przycisk kłamie.
    const s = trickster(6);
    const p = s.world.players[0]!;
    p.x = 0; p.y = 0;
    expect(s.world.decoys).toHaveLength(0);

    s.pushInput(0, input({ seq: 1, moveX: 1, dash: true }));
    for (let i = 0; i < 6; i++) s.step();

    expect(p.x).toBeGreaterThan(1);
    expect(p.cdMove).toBeGreaterThan(0);
  });

  it('własna kopia trafia do snapshotu, żeby predykcja mogła ją odtworzyć', () => {
    const s = trickster(7);
    const p = s.world.players[0]!;
    p.x = 9; p.y = 2;
    s.pushInput(0, input({ seq: 1, stealth: true }));
    s.step();

    const snap = buildSnapshot(s.world, p.id);
    expect(snap.self?.decoy).not.toBeNull();
    expect(snap.self?.decoy?.x).toBeCloseTo(9, 3);
    expect(snap.decoys).toHaveLength(1);
  });
});

describe('Sidła', () => {
  it('spowalniają, ale nie zadają obrażeń', () => {
    const s = trickster(8);
    const p = s.world.players[0]!;
    const enemy = s.world.players[1]!;

    p.x = 0; p.y = 0;
    enemy.x = 3; enemy.y = 0;
    // Wyciszamy auto-atak Kuglarza: cel stoi w jego zasięgu, więc bez tego
    // mierzylibyśmy obrażenia z podstawowego ataku, a nie z Sideł.
    p.cdAttack = Number.MAX_SAFE_INTEGER;
    const hpBefore = enemy.hp;

    s.pushInput(0, input({ seq: 1, burst: true }));
    for (let i = 0; i < 6; i++) {
      enemy.x = 3; enemy.y = 0;
      s.step();
    }

    // Narzędzie kontroli, nie zabijania.
    expect(enemy.hp).toBe(hpBefore);
    expect(enemy.slowEndTick).toBeGreaterThan(s.world.tick);
    expect(enemy.slowMul).toBeCloseTo(POWER_ABILITY.sidla.slowMul, 3);
  });

  it('spowolnienie realnie zmniejsza przebyty dystans', () => {
    // Mierzymy na slocie gracza, nie bota: symulacja czyta kolejkę wejść
    // wyłącznie dla ludzi, botom liczy wejścia z AI.
    const s = trickster(9);
    const p = s.world.players[0]!;
    p.x = 0;
    p.y = 0;
    p.vx = 0;

    for (let i = 0; i < 20; i++) {
      s.pushInput(0, input({ seq: i + 1, moveX: 1 }));
      s.step();
    }
    const free = p.x;
    expect(free).toBeGreaterThan(1);

    // Ten sam bieg, ale w Sidłach.
    p.x = 0;
    p.vx = 0;
    p.slowEndTick = s.world.tick + 100;
    p.slowMul = POWER_ABILITY.sidla.slowMul;
    for (let i = 0; i < 20; i++) {
      s.pushInput(0, input({ seq: 100 + i, moveX: 1 }));
      s.step();
    }

    expect(p.x).toBeLessThan(free * 0.85);
  });
});

describe('Kuglarz w normalnym meczu', () => {
  it('boty stawiają kopie i się z nimi zamieniają', () => {
    let decoys = 0;
    let swaps = 0;

    for (const seed of [11, 22, 33]) {
      const sim = new Simulation({ seed, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < MATCH_TICKS; t++) {
        sim.step();
        for (const e of sim.world.events) {
          if (e.type === 'decoySpawn') decoys++;
          if (e.type === 'swap') swaps++;
        }
        if (sim.world.phase === 'over') break;
      }
    }

    // Gdyby boty nie grały kitem Kuglarza, ta klasa byłaby dla gracza
    // darmową wygraną, a dla obserwatora — manekinem.
    expect(decoys).toBeGreaterThan(0);
    expect(swaps).toBeGreaterThan(0);
  });

  it('kopie nie psują determinizmu', () => {
    const run = () => {
      const sim = new Simulation({ seed: 777, playerCount: 12, humanCount: 0 });
      for (let t = 0; t < 60 * TICK_HZ; t++) sim.step();
      return sim.world.players.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.hp.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('Zwód w ścieżce klienta', () => {
  it('dociera aż do stanu renderu', async () => {
    // Sprawdza całą drogę: symulacja → snapshot → bufor interpolacji →
    // RenderState. Renderer dostaje kopie stąd, więc jeśli tu ich nie ma,
    // żadne poprawki w scenie nic nie dadzą.
    const { SnapshotBuffer } = await import('../../client/interpolation.ts');
    const { isSnapshotTick } = await import('../snapshot.ts');

    const s = trickster(31);
    const p = s.world.players[0]!;
    p.x = 4;
    p.y = 1;

    const buffer = new SnapshotBuffer();
    let now = 1000;

    s.pushInput(0, input({ seq: 1, stealth: true }));
    for (let i = 0; i < 12; i++) {
      s.step();
      if (isSnapshotTick(s.world.tick)) {
        buffer.push(buildSnapshot(s.world, 0), now);
        now += 66;
      }
    }

    expect(s.world.decoys).toHaveLength(1);

    // Interpolacja renderuje 100 ms wstecz, więc próbkujemy z zapasem.
    const state = buffer.sample(now + 200);
    expect(state).not.toBeNull();
    expect(state!.decoys).toHaveLength(1);
    expect(state!.decoys[0]!.x).toBeCloseTo(4, 3);
  });
});
