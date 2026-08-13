import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Haptics, SettingsStore } from '../settings.ts';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function setReducedMotion(reduce: boolean): void {
  globalThis.matchMedia = ((q: string) => ({
    matches: q.includes('reduce') && reduce,
    media: q,
  })) as unknown as typeof matchMedia;
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  setReducedMotion(false);
});

describe('SettingsStore', () => {
  it('domyślnie prawa ręka, wibracja włączona, wstrząs automatyczny', () => {
    const s = new SettingsStore();
    expect(s.current).toEqual({ handed: 'right', haptics: true, motion: 'auto' });
  });

  it('zapisuje i odczytuje ustawienia', () => {
    const first = new SettingsStore();
    first.set('handed', 'left');
    first.set('haptics', false);
    expect(new SettingsStore().current).toEqual({
      handed: 'left',
      haptics: false,
      motion: 'auto',
    });
  });

  it('zawiadamia o zmianie tylko wtedy, gdy coś się zmieniło', () => {
    const s = new SettingsStore();
    const seen: string[] = [];
    s.onChange((next) => seen.push(next.handed));
    s.set('handed', 'left');
    s.set('handed', 'left');
    expect(seen).toEqual(['left']);
  });

  it('ręcznie zepsuty zapis wraca do wartości domyślnych', () => {
    localStorage.setItem('arena.settings.v1', JSON.stringify({ handed: 'obie', motion: 'wow' }));
    const s = new SettingsStore();
    expect(s.current.handed).toBe('right');
    expect(s.current.motion).toBe('auto');
  });

  it('nie-JSON jest traktowany jak brak zapisu', () => {
    localStorage.setItem('arena.settings.v1', '{{');
    expect(new SettingsStore().current.handed).toBe('right');
  });

  describe('wstrząs kamery', () => {
    it('w trybie auto słucha ustawienia systemowego', () => {
      setReducedMotion(true);
      expect(new SettingsStore().motionAllowed).toBe(false);
      setReducedMotion(false);
      expect(new SettingsStore().motionAllowed).toBe(true);
    });

    it('ręczne ustawienie ma pierwszeństwo w obie strony', () => {
      // Ktoś może mieć ograniczenie ruchu w systemie i mimo to chcieć
      // wstrząsu w grze — i odwrotnie.
      setReducedMotion(true);
      const on = new SettingsStore();
      on.set('motion', 'on');
      expect(on.motionAllowed).toBe(true);

      setReducedMotion(false);
      const off = new SettingsStore();
      off.set('motion', 'off');
      expect(off.motionAllowed).toBe(false);
    });
  });
});

describe('Haptics', () => {
  it('milczy, gdy gracz wyłączył wibrację', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const settings = new SettingsStore();
    settings.set('haptics', false);

    new Haptics(settings).pulse(20);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('dławi serie impulsów', () => {
    // W grze obrywa się kilka razy na sekundę. Bez dławika telefon zamienia
    // się w brzęczyk, a wytyczne mówią wprost: haptyka ma nie męczyć.
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const h = new Haptics(new SettingsStore());

    for (let i = 0; i < 20; i++) h.pulse(20, 1000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('przycina długość impulsu', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    new Haptics(new SettingsStore()).pulse(5000);
    expect(vibrate).toHaveBeenCalledWith(60);
  });

  it('nie wywraca się na urządzeniu bez wibracji', () => {
    vi.stubGlobal('navigator', {});
    expect(() => new Haptics(new SettingsStore()).pulse(20)).not.toThrow();
  });
});
