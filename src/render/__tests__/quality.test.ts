import { describe, expect, it } from 'vitest';
import {
  MIN_ACCEPTABLE_FPS,
  MIN_PIXEL_RATIO,
  MOBILE_PIXEL_RATIO,
  QualityGovernor,
} from '../quality.ts';

const BUDGET = 1000 / MIN_ACCEPTABLE_FPS;
const SLOW = BUDGET * 1.5;
const FAST = BUDGET * 0.4;

function feed(g: QualityGovernor, frameMs: number, times: number): number[] {
  const changes: number[] = [];
  for (let i = 0; i < times; i++) {
    const next = g.update(frameMs);
    if (next !== null) changes.push(next);
  }
  return changes;
}

describe('regulator jakości', () => {
  it('nie rusza niczego, dopóki klatki mieszczą się w budżecie', () => {
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    expect(feed(g, BUDGET * 0.9, 600)).toEqual([]);
    expect(g.pixelRatioCap).toBe(MOBILE_PIXEL_RATIO);
  });

  it('schodzi z rozdzielczości, gdy urządzenie nie wyrabia', () => {
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    const changes = feed(g, SLOW, 30);
    expect(changes).toEqual([1.25]);
  });

  it('nie schodzi poniżej dolnej granicy', () => {
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    feed(g, SLOW, 10_000);
    expect(g.pixelRatioCap).toBe(MIN_PIXEL_RATIO);
  });

  it('wraca w górę dopiero po długim spokoju', () => {
    // Niesymetryczna histereza: gdyby powrót był tak szybki jak zejście,
    // gra migotałaby rozdzielczością dokładnie na granicy budżetu.
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    feed(g, SLOW, 30);
    expect(g.pixelRatioCap).toBe(1.25);

    expect(feed(g, FAST, 179)).toEqual([]);
    expect(feed(g, FAST, 1)).toEqual([MOBILE_PIXEL_RATIO]);
  });

  it('pojedyncza zacięta klatka nie obniża jakości', () => {
    // Zbieranie śmieci albo przełączenie aplikacji potrafi dać jedną klatkę
    // po 200 ms. Reagowanie na nią zmieniłoby obraz gry z powodu, który
    // już minął.
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    for (let i = 0; i < 100; i++) {
      expect(g.update(i % 20 === 0 ? SLOW * 4 : FAST)).not.toBe(MIN_PIXEL_RATIO);
    }
    expect(g.pixelRatioCap).toBe(MOBILE_PIXEL_RATIO);
  });

  it('nie przekracza pułapu mobilnego przy powrocie', () => {
    const g = new QualityGovernor(MOBILE_PIXEL_RATIO);
    feed(g, FAST, 2000);
    expect(g.pixelRatioCap).toBe(MOBILE_PIXEL_RATIO);
  });
});
