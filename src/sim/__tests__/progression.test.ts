import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { ARENA_RADIUS, TICK_HZ } from '../constants.ts';
import { getClass, MOVE_ABILITY } from '../classes.ts';
import { computeStats, xpForLevel } from '../upgrades.ts';
import { killPlayer } from '../combat.ts';
import { emptyInput, type InputFrame } from '../types.ts';

function sim(seed = 1) {
  return new Simulation({ seed, playerCount: 4, humanCount: 1, localClass: 'widmo' });
}

function input(over: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(1), ...over };
}

describe('slot RUCH nie daje darmowego pędu', () => {
  it('po Mgnieniu prędkość wraca do własnej prędkości postaci', () => {
    // Regresja. Mgnienie ma prędkość 210, a przy przyspieszeniu 70 hamowanie
    // z takiej wartości trwa ~3 sekundy. Postać leciała więc długo po
    // teleporcie i wynosiło ją średnio 7,5 jednostki poza kurczący się krąg:
    // 74 śmierci Widma od strefy na 40 rund wobec 3 u Kolosa. Wyglądało to
    // na problem równowagi klas, a było błędem kinematyki.
    const s = sim();
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    p.x = 0;
    p.y = 0;
    p.vx = 0;
    p.vy = 0;

    expect(MOVE_ABILITY[getClass(p.classId).move].speed).toBeGreaterThan(100);

    s.pushInput(0, input({ seq: 1, moveX: 1, dash: true }));
    s.step();

    // Tick po zakończeniu ruchu prędkość nie może przekraczać prędkości
    // biegu — z zapasem na chwilowe modyfikatory (ukrycie, dropy).
    for (let i = 0; i < 6; i++) {
      s.pushInput(0, input({ seq: 2 + i, moveX: 0, moveY: 0 }));
      s.step();
    }

    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(p.stats.speed * 1.6);
  });

  it('teleport nie wynosi postaci poza arenę', () => {
    const s = sim(99);
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    for (let t = 0; t < 200; t++) {
      s.pushInput(0, input({ seq: t + 1, moveX: 1, moveY: 0.2, dash: true }));
      s.step();
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(ARENA_RADIUS);
    }
  });
});

describe('progresja w rundzie', () => {
  it('doświadczenie prowadzi do awansu i wystawienia oferty', () => {
    const s = sim(7);
    s.world.phase = 'live';
    const p = s.world.players[0]!;

    p.xp = xpForLevel(p.level);
    s.step();

    expect(p.level).toBe(2);
    expect(p.offer.length).toBeGreaterThan(0);
    expect(p.offerDeadlineTick).toBeGreaterThan(s.world.tick);
  });

  it('klient nie może wybrać ulepszenia spoza wystawionej oferty', () => {
    const s = sim(11);
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    p.xp = xpForLevel(p.level);
    s.step();

    const offered = [...p.offer];
    expect(offered.length).toBe(3);

    // Indeksy poza zakresem są ignorowane — nie da się nimi nic zdobyć.
    for (const bad of [-1, 3, 99, 1.5, Number.NaN]) {
      s.pushInput(0, input({ seq: s.world.tick + 1, pick: bad }));
      s.step();
      expect(p.upgrades.length).toBe(0);
      expect(p.offer.length).toBe(3);
    }

    // Poprawny indeks przyznaje dokładnie tę kartę, którą serwer wystawił.
    s.pushInput(0, input({ seq: s.world.tick + 1, pick: 1 }));
    s.step();
    expect(p.upgrades).toEqual([offered[1]]);
    expect(p.offer.length).toBe(0);
  });

  it('niewybrana oferta rozstrzyga się sama, a runda nie czeka', () => {
    const s = sim(13);
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    p.xp = xpForLevel(p.level);
    s.step();
    expect(p.offer.length).toBe(3);

    for (let i = 0; i < 10 * TICK_HZ; i++) s.step();

    expect(p.offer.length).toBe(0);
    expect(p.upgrades.length).toBe(1);
  });

  it('śmierć zamyka wystawioną ofertę', () => {
    // Regresja: krok progresji pomija nieżyjących, więc oferta wystawiona
    // tuż przed śmiercią zostawała na ekranie na zawsze, z licznikiem
    // zatrzymanym na zerze.
    const s = sim(23);
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    p.xp = xpForLevel(p.level);
    s.step();
    expect(p.offer.length).toBe(3);

    const killer = s.world.players[1]!;
    killPlayer(s.world, p, killer.id);

    expect(p.alive).toBe(false);
    expect(p.offer.length).toBe(0);
    expect(p.offerDeadlineTick).toBe(-1);
  });

  it('ulepszenia kumulują się i zmieniają statystyki', () => {
    const base = computeStats('lowca', []);
    const buffed = computeStats('lowca', ['sila', 'sila', 'wytrzymalosc']);

    expect(buffed.attackDamage).toBeGreaterThan(base.attackDamage);
    expect(buffed.maxHp).toBe(base.maxHp + 22);
    // Limit sztuk jest respektowany przy wyliczaniu.
    const capped = computeStats('lowca', ['drugie_zycie']);
    expect(capped.extraLives).toBe(1);
  });

  it('„drugie życie" ratuje raz i zużywa ładunek', () => {
    const s = sim(17);
    s.world.phase = 'live';
    const p = s.world.players[0]!;
    p.upgrades = ['drugie_zycie'];
    p.stats = computeStats(p.classId, p.upgrades);
    p.hp = 1;

    const other = s.world.players[1]!;
    other.x = p.x + 1;
    other.y = p.y;

    for (let i = 0; i < 40; i++) s.step();

    // Pierwsza śmierć została zamieniona na wskrzeszenie, więc ładunek zniknął.
    expect(p.upgrades).not.toContain('drugie_zycie');
    expect(p.stats.extraLives).toBe(0);
  });
});
