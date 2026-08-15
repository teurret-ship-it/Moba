import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { POWER_ABILITY, type ClassId } from '../classes.ts';
import { emptyInput, type InputFrame } from '../types.ts';

/**
 * Celowanie: tapnięcie = automat, przeciągnięcie = ręcznie.
 *
 * Standard rynkowy tego gatunku na telefonie, i tak samo jak reszta walki —
 * rozstrzygany po stronie autorytatywnej. Klient przysyła WEKTOR, nigdy celu
 * ani trafienia, więc wszystko, co tu sprawdzamy, jest jednocześnie regułą
 * bezpieczeństwa: serwer normalizuje kierunek i sam decyduje, co on znaczy
 * dla danej umiejętności.
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
  const me = s.world.players[0]!;
  me.x = 0;
  me.y = 0;
  me.facing = 0;
  // Auto-atak wyciszony: przestawia `facing` co cios, więc zafałszowałby
  // każdy pomiar kierunku umiejętności. To zresztą dokładnie ten mechanizm,
  // który psuł ręczne celowanie, zanim kierunek zaczął być zapamiętywany
  // w chwili wciśnięcia.
  me.cdAttack = Number.MAX_SAFE_INTEGER;
  return s;
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(1), ...over };
}

describe('celowanie automatyczne (tapnięcie)', () => {
  it('Rozdarcie obraca się do najbliższego wroga', () => {
    const s = arena('widmo');
    const me = s.world.players[0]!;
    const enemy = s.world.players[1]!;
    // Wróg z boku, postać patrzy w zupełnie inną stronę.
    enemy.x = 0;
    enemy.y = 5;
    me.facing = Math.PI;

    s.pushInput(0, input({ seq: 1, burst: true }));
    for (let i = 0; i < 5; i++) s.step();

    // Tapnięcie ma trafiać z bliska bez celowania — to jest cała jego rola.
    expect(me.facing).toBeCloseTo(Math.PI / 2, 2);
  });

  it('bez wroga w zasięgu bierze kierunek marszu', () => {
    // Odpowiednik ustawienia „umiejętność w stronę ruchu": tapnięcie ma
    // wysyłać tam, dokąd biegniesz, bo w większości przypadków o to chodzi.
    const s = arena('widmo', 2);
    const me = s.world.players[0]!;
    me.facing = Math.PI;

    s.pushInput(0, input({ seq: 1, moveX: 0, moveY: -1, burst: true }));
    for (let i = 0; i < 5; i++) s.step();

    expect(me.facing).toBeCloseTo(-Math.PI / 2, 2);
  });
});

describe('celowanie ręczne (przeciągnięcie)', () => {
  it('wektor gracza wygrywa z automatem', () => {
    const s = arena('widmo', 3);
    const me = s.world.players[0]!;
    const enemy = s.world.players[1]!;
    // Wróg jest w zasięgu, ale gracz celuje gdzie indziej — i ma dostać to,
    // co pokazał. Inaczej „ręczne" celowanie jest ozdobą.
    enemy.x = 4;
    enemy.y = 0;

    s.pushInput(0, input({ seq: 1, aimX: 0, aimY: 1, burst: true }));
    for (let i = 0; i < 5; i++) s.step();

    expect(me.facing).toBeCloseTo(Math.PI / 2, 2);
  });

  it('wektor nie musi być znormalizowany — serwer to robi', () => {
    // Klient może przysłać cokolwiek. Długość wektora nie może niczego
    // zmieniać, bo inaczej byłaby ukrytym mnożnikiem siły.
    const short = arena('widmo', 4);
    const long = arena('widmo', 4);
    short.pushInput(0, input({ seq: 1, aimX: 0.3, aimY: 0.3, burst: true }));
    long.pushInput(0, input({ seq: 1, aimX: 900, aimY: 900, burst: true }));
    for (let i = 0; i < 5; i++) {
      short.step();
      long.step();
    }

    expect(short.world.players[0]!.facing).toBeCloseTo(long.world.players[0]!.facing, 6);
    expect(short.world.players[0]!.facing).toBeCloseTo(Math.PI / 4, 3);
  });

  it('mikroruch palca liczy się jako tapnięcie, nie jako celowanie', () => {
    // Próg jest po obu stronach: interfejs nie wysyła drgnięcia jako
    // kierunku, a symulacja i tak go nie przyjmuje.
    const s = arena('widmo', 5);
    const me = s.world.players[0]!;
    const enemy = s.world.players[1]!;
    enemy.x = 0;
    enemy.y = 5;

    s.pushInput(0, input({ seq: 1, aimX: 0.05, aimY: -0.05, burst: true }));
    for (let i = 0; i < 5; i++) s.step();

    // Automat wygrał: postać patrzy na wroga, nie w stronę drgnięcia.
    expect(me.facing).toBeCloseTo(Math.PI / 2, 2);
  });

  it('Salwa wybiera cel zgodny z kierunkiem, a nie najbliższy', () => {
    const s = arena('lowca', 6);
    const near = s.world.players[1]!;
    const aimed = s.world.players[2]!;

    near.x = 3;
    near.y = 0;
    aimed.x = 0;
    aimed.y = 6;
    near.hp = 10_000;
    near.maxHp = 10_000;
    aimed.hp = 10_000;
    aimed.maxHp = 10_000;

    s.pushInput(0, input({ seq: 1, aimX: 0, aimY: 1, burst: true }));
    for (let i = 0; i < 12; i++) {
      near.x = 3; near.y = 0;
      aimed.x = 0; aimed.y = 6;
      s.step();
    }

    // Gracz pokazał, w którą stronę strzela — i to ma być rozstrzygające.
    expect(aimed.hp).toBeLessThan(10_000);
    expect(near.hp).toBe(10_000);
  });

  it('Salwa w pustkę spada na cel automatyczny zamiast marnować odnowienie', () => {
    const s = arena('lowca', 7);
    const enemy = s.world.players[1]!;
    enemy.x = 4;
    enemy.y = 0;
    enemy.hp = 10_000;
    enemy.maxHp = 10_000;

    // Celowanie w przeciwną stronę niż jedyny wróg.
    s.pushInput(0, input({ seq: 1, aimX: -1, aimY: 0, burst: true }));
    for (let i = 0; i < 12; i++) {
      enemy.x = 4;
      enemy.y = 0;
      s.step();
    }

    expect(enemy.hp).toBeLessThan(10_000);
  });
});

describe('slot RUCH', () => {
  it('leci w stronę przeciągnięcia', () => {
    const s = arena('lowca', 8);
    const me = s.world.players[0]!;

    s.pushInput(0, input({ seq: 1, aimX: 0, aimY: 1, dash: true }));
    for (let i = 0; i < 6; i++) s.step();

    expect(me.y).toBeGreaterThan(2);
    expect(Math.abs(me.x)).toBeLessThan(1);
  });

  it('nie naprowadza się sam na wroga', () => {
    // RUCH celuje tylko ręcznie albo z ruchu. Automat wpychałby uciekającego
    // gracza prosto w to, przed czym ucieka.
    const s = arena('lowca', 9);
    const me = s.world.players[0]!;
    const enemy = s.world.players[1]!;
    enemy.x = 0;
    enemy.y = 6;

    s.pushInput(0, input({ seq: 1, moveX: 0, moveY: -1, dash: true }));
    for (let i = 0; i < 6; i++) s.step();

    expect(me.y).toBeLessThan(-2);
  });
});

describe('umiejętności bez kierunku', () => {
  it('Fala i Sidła są okręgami — celowanie nic w nich nie zmienia', () => {
    for (const [cls, def] of [
      ['kolos', POWER_ABILITY.fala],
      ['kuglarz', POWER_ABILITY.sidla],
    ] as const) {
      const plain = arena(cls, 10);
      const aimed = arena(cls, 10);
      plain.world.players[0]!.facing = 0;
      aimed.world.players[0]!.facing = 0;

      plain.pushInput(0, input({ seq: 1, burst: true }));
      aimed.pushInput(0, input({ seq: 1, aimX: 0, aimY: 1, burst: true }));
      for (let i = 0; i < 8; i++) {
        plain.step();
        aimed.step();
      }

      // Udawanie, że celowanie coś tu daje, byłoby kłamstwem interfejsu.
      expect(aimed.world.players[0]!.facing).toBe(plain.world.players[0]!.facing);
      expect(def.radius).toBeGreaterThan(0);
    }
  });
});
