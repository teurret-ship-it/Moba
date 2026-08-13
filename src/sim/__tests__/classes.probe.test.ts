import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim.ts';
import { MATCH_TICKS, TICK_HZ } from '../constants.ts';
import { CLASS_IDS, getClass, type ClassId } from '../classes.ts';

/**
 * Sonda równowagi klas.
 *
 * Trzy klasy mają sens tylko wtedy, gdy każda daje się wygrać. Jeśli jedna
 * zbiera 60% zwycięstw, gracze wybiorą ją i wrócimy do stanu sprzed
 * iteracji: wszyscy grają tym samym, tylko z dodatkowym ekranem po drodze.
 *
 * To pomiar bot-vs-bot, więc mierzy równowagę SUROWYCH statystyk, nie
 * sufitu umiejętności. Widmo w rękach człowieka będzie mocniejsze niż
 * w rękach bota, bo zasadzka wymaga decyzji. Sonda ma łapać rozjazd
 * rażący — nie ustawiać metagry.
 */

interface Tally {
  wins: Record<ClassId, number>;
  played: Record<ClassId, number>;
  kills: Record<ClassId, number>;
  survival: Record<ClassId, number>;
}

function emptyTally(): Tally {
  const zero = () => ({ lowca: 0, kolos: 0, widmo: 0 }) as Record<ClassId, number>;
  return { wins: zero(), played: zero(), kills: zero(), survival: zero() };
}

describe('równowaga klas', () => {
  it('każda klasa wygrywa i żadna nie dominuje', () => {
    const tally = emptyTally();
    // 120 rund, nie 60. Przy 60 na klasę wypada ~20 zwycięstw, a szum
    // Poissona na takiej liczbie to ±4,5 — czyli ±0,22 na współczynniku.
    // Strojenie różnic mniejszych niż 0,4 na takiej próbie to gonienie
    // własnego ogona; przekonałem się o tym, przerzucając dominację między
    // Łowcą a Kolosem trzy razy z rzędu.
    const rounds = 120;

    for (let seed = 1; seed <= rounds; seed++) {
      const sim = new Simulation({ seed: seed * 7919, playerCount: 12, humanCount: 0 });
      for (const p of sim.world.players) tally.played[p.classId] += 1;

      for (let t = 0; t < MATCH_TICKS; t++) {
        sim.step();
        if (sim.world.phase === 'over') break;
      }

      for (const p of sim.world.players) {
        tally.kills[p.classId] += p.kills;
        tally.survival[p.classId] += (p.alive ? sim.world.tick : p.deathTick) / TICK_HZ;
      }
      const winner = sim.world.players[sim.world.winner];
      if (winner) tally.wins[winner.classId] += 1;
    }

    const totalPlayed = CLASS_IDS.reduce((n, id) => n + tally.played[id], 0);

    const lines = CLASS_IDS.map((id) => {
      const played = tally.played[id];
      // Znormalizowany współczynnik zwycięstw: 1,0 = dokładnie tyle wygranych,
      // ile wynika z liczby wystawionych postaci. Boty losują klasę, więc
      // surowa liczba wygranych premiuje tę, która trafiła się częściej.
      const expected = rounds * (played / totalPlayed);
      const share = expected === 0 ? 0 : tally.wins[id] / expected;
      const kpg = played === 0 ? 0 : tally.kills[id] / played;
      const surv = played === 0 ? 0 : tally.survival[id] / played;
      return {
        id,
        share,
        text:
          `  ${getClass(id).name.padEnd(6)} wygrane ${String(tally.wins[id]).padStart(2)}/${rounds}` +
          `  wsp. ${share.toFixed(2)}` +
          `  elim./postać ${kpg.toFixed(2)}` +
          `  przeżyte ${surv.toFixed(0)}s`,
      };
    });

    console.log(
      ['', '  --- równowaga klas (60 rund, same boty) ---', ...lines.map((l) => l.text), ''].join('\n'),
    );

    for (const l of lines) {
      // Każda klasa musi cokolwiek wygrywać — zero zwycięstw to klasa-pułapka.
      expect(tally.wins[l.id], `${l.id} nie wygrał ani razu`).toBeGreaterThan(0);
      // Przy trzech klasach uczciwy udział to 33%. Dopuszczamy szeroki
      // przedział, bo to pomiar botów — łapiemy dominację, nie niuans.
      // Uczciwy współczynnik to 1,0. Przedział jest szeroki, bo to pomiar
      // botów — łapiemy dominację i klasy-pułapki, nie niuanse metagry.
      expect(l.share, `${l.id} jest za słaby`).toBeGreaterThan(0.45);
      expect(l.share, `${l.id} dominuje`).toBeLessThan(1.85);
    }
  });
});
