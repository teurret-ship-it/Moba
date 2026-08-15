import { describe, expect, it } from 'vitest';
import { Simulation } from '../../sim/sim.ts';
import { buildSnapshot, isSnapshotTick, type Snapshot } from '../../sim/snapshot.ts';
import { WARMUP_TICKS } from '../../sim/constants.ts';
import type { InputFrame } from '../../sim/types.ts';
import { Predictor } from '../prediction.ts';

/**
 * Predykcja i rekoncyliacja pod opóźnieniem.
 *
 * Sekcja 16, ryzyko #4: „netcode nie działa na mobilnym internecie".
 * Sekcja 7 przewiduje predykcję własnego ruchu jako mitygację — ale
 * mitygacja niesprawdzona jest tylko deklaracją.
 *
 * Ten test odtwarza pętlę klient–serwer z opóźnieniem w obie strony,
 * bez przeglądarki i bez losowości, i sprawdza trzy rzeczy:
 *  1. predykcja faktycznie wyprzedza snapshot (inaczej jest bez sensu),
 *  2. błąd rekoncyliacji nie narasta (inaczej gracz „gumkuje"),
 *  3. po ustaniu wejść stan klienta zbiega się do stanu serwera.
 */

interface Loop {
  maxError: number;
  maxLead: number;
  finalDrift: number;
}

function runLoop(latencyTicks: number, ticks = 260): Loop {
  const sim = new Simulation({ seed: 777, playerCount: 6, humanCount: 1 });
  const predictor = new Predictor();

  const inflightInputs: Array<{ at: number; input: InputFrame }> = [];
  const inflightSnaps: Array<{ at: number; snap: Snapshot }> = [];

  let maxError = 0;
  let maxLead = 0;

  for (let t = 0; t < ticks; t++) {
    // Po fazie ruchu przestajemy sterować — pozwala sprawdzić zbieżność.
    const steering = t < ticks - 60;
    const input: InputFrame = {
      seq: t + 1,
      moveX: steering ? Math.sin(t * 0.07) : 0,
      moveY: steering ? Math.cos(t * 0.05) : 0,
      aimX: 0,
      aimY: 0,
      dash: false,
      stealth: false,
      burst: false,
      pick: -1,
    };

    // --- klient ---
    predictor.recordInput(input);
    predictor.predict(input);
    inflightInputs.push({ at: t + latencyTicks, input });

    // --- serwer ---
    for (let i = inflightInputs.length - 1; i >= 0; i--) {
      const item = inflightInputs[i]!;
      if (item.at > t) continue;
      sim.pushInput(0, item.input);
      inflightInputs.splice(i, 1);
    }
    sim.step();

    if (isSnapshotTick(sim.world.tick)) {
      inflightSnaps.push({ at: t + latencyTicks, snap: buildSnapshot(sim.world, 0) });
    }

    // --- klient odbiera ---
    for (let i = inflightSnaps.length - 1; i >= 0; i--) {
      const item = inflightSnaps[i]!;
      if (item.at > t) continue;

      const predicted = predictor.predicted;
      const self = item.snap.self;
      if (predicted && self && sim.world.tick > WARMUP_TICKS + 20) {
        // O ile predykcja wyprzedza to, co widać w snapshocie.
        maxLead = Math.max(maxLead, Math.hypot(predicted.x - self.x, predicted.y - self.y));
      }

      predictor.reconcile(item.snap);
      if (sim.world.tick > WARMUP_TICKS + 20) {
        maxError = Math.max(maxError, predictor.lastError);
      }
      inflightSnaps.splice(i, 1);
    }
  }

  const predicted = predictor.predicted!;
  const authoritative = sim.world.players[0]!;
  return {
    maxError,
    maxLead,
    finalDrift: Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y),
  };
}

describe('predykcja pod opóźnieniem', () => {
  it('bez opóźnienia predykcja jest dokładna', () => {
    const r = runLoop(0);
    // Nie zero: rozpychanie postaci (`resolveOverlaps`) i odrzut Szarży
    // liczy wyłącznie serwer, bo klient nie zna pozycji wszystkich graczy
    // (AoI, ukrycie). Zmierzone maksimum to ~0,2 jednostki — poniżej
    // ćwierci promienia postaci i daleko od progu przeskoku (4), więc
    // korekta rozpływa się niewidocznie.
    expect(r.maxError).toBeLessThan(0.5);
    expect(r.finalDrift).toBeLessThan(0.05);
  });

  it('przy 150 ms RTT predykcja wyprzedza snapshot i nie rozjeżdża się', () => {
    // 3 ticki w jedną stronę przy 20 Hz ≈ 150 ms w obie strony.
    const r = runLoop(3);

    // Gdyby predykcja nie działała, postać byłaby rysowana tam, gdzie
    // serwer widział ją 150 ms temu — to jest ten dystans.
    expect(r.maxLead).toBeGreaterThan(0.5);

    // Błąd rekoncyliacji to rozjazd predykcji względem prawdy. Jeśli
    // urośnie, gracz zobaczy szarpanie postaci.
    expect(r.maxError).toBeLessThan(1.0);

    // Po ustaniu wejść klient musi zbiec się do stanu serwera.
    expect(r.finalDrift).toBeLessThan(0.4);
  });

  it('przy złym łączu (300 ms RTT) błąd nadal jest ograniczony', () => {
    const r = runLoop(6);
    expect(r.maxError).toBeLessThan(2.0);
    expect(r.finalDrift).toBeLessThan(0.6);
  });

  it('błąd pozostaje ograniczony przez cały mecz', () => {
    const long = runLoop(3, 900);

    // Dłuższy mecz przynosi zdarzenia, których klient nie może przewidzieć:
    // awans zmienia prędkość i odnowienia, a klient dowiaduje się o tym
    // dopiero z następnego snapshotu. To jednorazowa korekta, taka sama
    // jak odrzut od Fali — nie narastający dryf.
    //
    // Własność, która musi być prawdziwa: błąd nigdy nie przekracza progu
    // przeskoku (4), więc korekta zawsze rozpływa się płynnie i gracz
    // nie widzi teleportacji własnej postaci.
    expect(long.maxError).toBeLessThan(4);

    // I najważniejsze — po ustaniu wejść stan zbiega się do zera.
    // Gdyby rekoncyliacja gubiła stan, dryf by został.
    expect(long.finalDrift).toBeLessThan(0.05);
  });
});
