import { beforeEach, describe, expect, it } from 'vitest';
import { RecordStore, type MatchOutcome } from '../records.ts';

/**
 * Rekordy są jedynym mechanizmem, który ma ciągnąć gracza do rundy trzeciej,
 * a bramka Fazy 0 mierzy dokładnie to. Warto więc, żeby liczyły poprawnie
 * także wtedy, gdy przeglądarka odmówi zapisu.
 */

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

function outcome(over: Partial<MatchOutcome> = {}): MatchOutcome {
  return {
    place: 5,
    players: 12,
    kills: 1,
    damage: 200,
    survivedSeconds: 60,
    score: 300,
    level: 3,
    classId: 'lowca',
    won: false,
    ...over,
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

describe('RecordStore', () => {
  it('pierwsza runda ustawia rekordy, ale nie zgłasza wygranej', () => {
    const store = new RecordStore();
    expect(store.isFirstEver).toBe(true);

    const beaten = store.record(outcome());

    expect(beaten.firstWin).toBe(false);
    expect(store.current.roundsPlayed).toBe(1);
    expect(store.current.bestPlace).toBe(5);
    expect(store.isFirstEver).toBe(false);
  });

  it('rekord pada tylko wtedy, gdy wynik jest lepszy', () => {
    const store = new RecordStore();
    store.record(outcome({ place: 5, kills: 3, score: 300, survivedSeconds: 60 }));

    const worse = store.record(outcome({ place: 8, kills: 1, score: 100, survivedSeconds: 20 }));
    expect(worse).toEqual({ place: false, kills: false, survival: false, score: false, firstWin: false });
    // Gorsza runda nie może zjeść dorobku.
    expect(store.current.bestPlace).toBe(5);
    expect(store.current.mostKills).toBe(3);

    const better = store.record(outcome({ place: 2, kills: 4, score: 900, survivedSeconds: 120 }));
    expect(better.place).toBe(true);
    expect(better.kills).toBe(true);
    expect(better.score).toBe(true);
    expect(better.survival).toBe(true);
  });

  it('pierwsza wygrana zgłasza się raz', () => {
    const store = new RecordStore();
    expect(store.record(outcome({ won: true, place: 1 })).firstWin).toBe(true);
    expect(store.record(outcome({ won: true, place: 1 })).firstWin).toBe(false);
    expect(store.current.wins).toBe(2);
  });

  it('seria liczy się w sesji, rekord serii przeżywa restart', () => {
    const store = new RecordStore();
    store.record(outcome());
    store.record(outcome());
    store.record(outcome());
    expect(store.current.sessionStreak).toBe(3);
    expect(store.current.bestStreak).toBe(3);

    // Nowa sesja: seria startuje od zera, ale rekord zostaje.
    const next = new RecordStore();
    expect(next.current.sessionStreak).toBe(0);
    expect(next.current.bestStreak).toBe(3);
    expect(next.current.roundsPlayed).toBe(3);
  });

  it('stary zapis bez nowych pól nie wywraca ekranu wyniku', () => {
    localStorage.setItem('arena.records.v1', JSON.stringify({ roundsPlayed: 4, wins: 1 }));
    const store = new RecordStore();
    expect(store.current.roundsPlayed).toBe(4);
    expect(store.current.bestStreak).toBe(0);
    expect(() => store.record(outcome())).not.toThrow();
  });

  it('uszkodzony zapis jest traktowany jak brak zapisu', () => {
    localStorage.setItem('arena.records.v1', '{nie-json');
    const store = new RecordStore();
    expect(store.isFirstEver).toBe(true);
  });

  it('brak możliwości zapisu nie przerywa rundy', () => {
    // Tryb prywatny w Safari: setItem rzuca. Rekordy są dodatkiem,
    // nie warunkiem działania gry.
    const throwing = fakeStorage();
    throwing.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    globalThis.localStorage = throwing;

    const store = new RecordStore();
    expect(() => store.record(outcome())).not.toThrow();
    expect(store.current.roundsPlayed).toBe(1);
  });
});
