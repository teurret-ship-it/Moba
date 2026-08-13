import { describe, expect, it } from 'vitest';
import { applyDeadZone } from '../controls.ts';

/**
 * Martwa strefa gałki.
 *
 * Pierwsza wersja liczyła siłę wychylenia jako `dist / promień` i po prostu
 * zerowała wszystko poniżej progu. Skutek: tuż za krawędzią martwej strefy
 * postać ruszała od razu z ~10% prędkości. To jest znany błąd — skalowana
 * promieniowa martwa strefa istnieje właśnie po to, żeby pełny zakres 0..1
 * rozciągał się OD krawędzi martwej strefy, a nie od środka gałki.
 */

describe('skalowana promieniowa martwa strefa', () => {
  const DEAD = 8;
  const RADIUS = 64;

  it('milczy wewnątrz martwej strefy', () => {
    expect(applyDeadZone(0, DEAD, RADIUS)).toBe(0);
    expect(applyDeadZone(DEAD, DEAD, RADIUS)).toBe(0);
  });

  it('nie ma uskoku na krawędzi', () => {
    // Tuż za progiem wychylenie ma być bliskie zeru, a nie skakać do 12%.
    const justOutside = applyDeadZone(DEAD + 0.01, DEAD, RADIUS);
    expect(justOutside).toBeGreaterThan(0);
    expect(justOutside).toBeLessThan(0.001);
  });

  it('osiąga pełne wychylenie na krawędzi gałki i nie przekracza go', () => {
    expect(applyDeadZone(RADIUS, DEAD, RADIUS)).toBeCloseTo(1, 6);
    expect(applyDeadZone(RADIUS * 3, DEAD, RADIUS)).toBe(1);
  });

  it('rośnie monotonicznie', () => {
    let prev = -1;
    for (let d = 0; d <= RADIUS; d += 0.5) {
      const v = applyDeadZone(d, DEAD, RADIUS);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('połowa drogi za progiem to połowa wychylenia', () => {
    // Własność, która odróżnia skalowaną martwą strefę od zwykłego odcięcia:
    // zakres jest rozciągnięty, a nie przycięty.
    const mid = DEAD + (RADIUS - DEAD) / 2;
    expect(applyDeadZone(mid, DEAD, RADIUS)).toBeCloseTo(0.5, 6);
  });
});
