import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenAwake } from '../device.ts';

/**
 * Blokada wygaszania ekranu.
 *
 * Reguły są proste, ale każda z nich to osobny sposób na cichą porażkę:
 * blokada gaśnie sama przy przełączeniu aplikacji, przeglądarka ma prawo
 * odmówić, a trzymanie jej po rundzie zjada baterię gracza. Wszystkie trzy
 * są tu sprawdzone, bo żadnej nie widać po zachowaniu gry.
 */

interface FakeSentinel {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (t: string, fn: () => void) => void;
  fire: () => void;
}

function sentinel(): FakeSentinel {
  const listeners: Array<() => void> = [];
  const s: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      s.released = true;
    }),
    addEventListener: (_t, fn) => listeners.push(fn),
    fire: () => {
      s.released = true;
      for (const fn of listeners) fn();
    },
  };
  return s;
}

let visibility: DocumentVisibilityState = 'visible';
let visibilityListeners: Array<() => void> = [];

function setupDocument(): void {
  visibilityListeners = [];
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (t: string, fn: () => void) => {
      if (t === 'visibilitychange') visibilityListeners.push(fn);
    },
    removeEventListener: (t: string, fn: () => void) => {
      if (t === 'visibilitychange') {
        visibilityListeners = visibilityListeners.filter((l) => l !== fn);
      }
    },
  });
}

function goVisible(state: DocumentVisibilityState): void {
  visibility = state;
  for (const fn of [...visibilityListeners]) fn();
}

beforeEach(() => {
  visibility = 'visible';
  setupDocument();
});

describe('ScreenAwake', () => {
  it('bierze blokadę na starcie rundy i oddaje na końcu', async () => {
    const s = sentinel();
    const request = vi.fn(async () => s);
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const awake = new ScreenAwake();
    awake.enable();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith('screen');
    expect(awake.active).toBe(true);

    awake.disable();
    expect(s.release).toHaveBeenCalled();
    expect(awake.active).toBe(false);
  });

  it('bierze blokadę na nowo po powrocie do gry', async () => {
    // System zabiera blokadę przy przełączeniu aplikacji. Bez tego działa
    // ona tylko do pierwszego powiadomienia, czyli w praktyce nigdy.
    const handed: FakeSentinel[] = [];
    const request = vi.fn(async () => {
      const s = sentinel();
      handed.push(s);
      return s;
    });
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const awake = new ScreenAwake();
    awake.enable();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    // Tak zachowuje się platforma: schowany dokument traci blokadę.
    handed[0]!.fire();
    goVisible('hidden');
    goVisible('visible');
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(awake.active).toBe(true);
  });

  it('nie bierze blokady po zakończonej rundzie', async () => {
    const request = vi.fn(async () => sentinel());
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const awake = new ScreenAwake();
    awake.enable();
    await Promise.resolve();
    awake.disable();

    goVisible('hidden');
    goVisible('visible');
    await Promise.resolve();

    // Bateria jest zasobem gracza, nie moim.
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('odmowa przeglądarki nie wywraca gry', async () => {
    // Niski poziom baterii albo tryb oszczędzania — dokumentacja mówi wprost,
    // że żądanie wolno odrzucić.
    const request = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    vi.stubGlobal('navigator', { wakeLock: { request } });

    const awake = new ScreenAwake();
    expect(() => awake.enable()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(awake.active).toBe(false);
  });

  it('urządzenie bez Wake Lock po prostu go nie ma', () => {
    vi.stubGlobal('navigator', {});
    const awake = new ScreenAwake();
    expect(awake.supported).toBe(false);
    expect(() => awake.enable()).not.toThrow();
  });

  it('blokada zabrana przez system przestaje być uznawana za aktywną', async () => {
    const s = sentinel();
    vi.stubGlobal('navigator', { wakeLock: { request: async () => s } });

    const awake = new ScreenAwake();
    awake.enable();
    await Promise.resolve();
    expect(awake.active).toBe(true);

    s.fire();
    expect(awake.active).toBe(false);
  });

  it('runda zakończona w trakcie żądania nie zostawia wiszącej blokady', async () => {
    // Wyścig: gracz zginął i wcisnął „Nowa runda", zanim obietnica się
    // rozwiązała. Bez tego blokada zostaje bez właściciela.
    const s = sentinel();
    let resolve!: (v: FakeSentinel) => void;
    vi.stubGlobal('navigator', {
      wakeLock: { request: () => new Promise<FakeSentinel>((r) => (resolve = r)) },
    });

    const awake = new ScreenAwake();
    awake.enable();
    awake.disable();
    resolve(s);
    await Promise.resolve();
    await Promise.resolve();

    expect(s.release).toHaveBeenCalled();
    expect(awake.active).toBe(false);
  });
});
