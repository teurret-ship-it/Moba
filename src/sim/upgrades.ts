import { TICK_HZ } from './constants.ts';
import { getClass, type ClassDef, type ClassId } from './classes.ts';

/**
 * Ulepszenia zdobywane W TRAKCIE rundy.
 *
 * Problem, który to rozwiązuje: dotąd runda zaczynała się i kończyła tym
 * samym zestawem statystyk. Klasy dały trzy różne rundy, ale wciąż każda
 * runda tą samą klasą wyglądała identycznie. Bramka Fazy 0 brzmi „3 rundy
 * z rzędu bez proszenia" — a to wymaga, żeby runda budowała jakąś historię.
 *
 * Model: zbierasz doświadczenie za walkę i przetrwanie, na poziomie
 * dostajesz TRZY karty do wyboru, bierzesz jedną. Wybory się kumulują,
 * więc pod koniec rundy ta sama klasa gra inaczej niż na starcie.
 *
 * Trzy decyzje projektowe, wszystkie wymuszone przez cel Fazy 1:
 *
 *  1. **Gra się nie zatrzymuje.** Pauza jest niemożliwa w meczu z ludźmi,
 *     więc nie wolno jej zakładać już teraz. Karty czekają na tapnięcie,
 *     a runda leci dalej.
 *  2. **Wybór ma termin.** Po upływie czasu ulepszenie wybiera się samo —
 *     gracz, który nie zdąży, nie zostaje bez niczego, a mecz nie czeka.
 *  3. **Serwer rozstrzyga.** Klient przysyła numer karty, nie efekt.
 *     Sam wybór jest walidowany wobec wystawionej oferty (sekcja 3).
 */

export type UpgradeId =
  | 'sila'
  | 'zwinnosc'
  | 'wytrzymalosc'
  | 'szybkosc'
  | 'zasieg'
  | 'odnowienie'
  | 'regeneracja'
  | 'wampiryzm'
  | 'magnes'
  | 'drugie_zycie'
  | 'impet'
  | 'furia';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Opis skutku — jedno zdanie, czytane w ferworze walki. */
  text: string;
  glyph: string;
  /** Ile razy da się wziąć. Po wyczerpaniu znika z puli. */
  maxStacks: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  sila: { id: 'sila', name: 'Siła', text: '+14% obrażeń', glyph: '⚔', maxStacks: 4 },
  zwinnosc: { id: 'zwinnosc', name: 'Zwinność', text: '+11% szybkości ataku', glyph: '⚡', maxStacks: 4 },
  wytrzymalosc: { id: 'wytrzymalosc', name: 'Wytrzymałość', text: '+22 maks. zdrowia', glyph: '♥', maxStacks: 4 },
  szybkosc: { id: 'szybkosc', name: 'Szybkość', text: '+7% prędkości ruchu', glyph: '»', maxStacks: 3 },
  zasieg: { id: 'zasieg', name: 'Zasięg', text: '+0,7 zasięgu ataku', glyph: '◎', maxStacks: 3 },
  odnowienie: { id: 'odnowienie', name: 'Odnowienie', text: '−12% czasu odnowień', glyph: '↻', maxStacks: 3 },
  regeneracja: { id: 'regeneracja', name: 'Regeneracja', text: '+5 zdrowia na sekundę poza walką', glyph: '✚', maxStacks: 3 },
  wampiryzm: { id: 'wampiryzm', name: 'Wampiryzm', text: '8% zadanych obrażeń wraca jako zdrowie', glyph: '❣', maxStacks: 3 },
  magnes: { id: 'magnes', name: 'Magnes', text: 'Zbierasz dropy z większej odległości', glyph: '⊕', maxStacks: 2 },
  drugie_zycie: { id: 'drugie_zycie', name: 'Drugie życie', text: 'Raz na rundę przeżywasz śmierć z 30% zdrowia', glyph: '✧', maxStacks: 1 },
  impet: { id: 'impet', name: 'Impet', text: 'Po Skoku +25% prędkości na 2 s', glyph: '➹', maxStacks: 2 },
  furia: { id: 'furia', name: 'Furia', text: '+30% obrażeń poniżej 40% zdrowia', glyph: '✹', maxStacks: 2 },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

/** Ile kart pokazujemy przy awansie. Trzy: wybór bez paraliżu decyzyjnego. */
export const OFFER_SIZE = 3;
/** Po tylu tickach niewybrana oferta rozstrzyga się sama (pierwsza karta). */
export const OFFER_DEADLINE_TICKS = Math.round(9 * TICK_HZ);

// --- Doświadczenie -----------------------------------------------------------

export const XP_PER_DAMAGE = 0.55;
export const XP_PER_KILL = 60;
export const XP_PER_PICKUP = 18;
export const XP_PER_SECOND = 3;

/**
 * Próg awansu na dany poziom. Rośnie, ale nie stromo — w 2-minutowej
 * rundzie gracz ma zobaczyć 4–6 wyborów, inaczej mechanika nie zdąży
 * niczego zbudować.
 */
export function xpForLevel(level: number): number {
  return Math.round(90 + (level - 1) * 70 + (level - 1) * (level - 1) * 12);
}

// --- Statystyki wynikowe -----------------------------------------------------

export interface EffectiveStats {
  maxHp: number;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackCooldownTicks: number;
  /** Mnożnik czasu odnowień umiejętności (mniej = szybciej). */
  cooldownMul: number;
  regenPerSecond: number;
  /** Ułamek zadanych obrażeń wracający jako zdrowie. */
  lifesteal: number;
  pickupReachBonus: number;
  /** Ile razy zostało „drugie życie". */
  extraLives: number;
  /** Mnożnik prędkości po użyciu slotu RUCH i czas jego trwania. */
  impetusMul: number;
  impetusTicks: number;
  /** Mnożnik obrażeń przy niskim zdrowiu i próg jego działania. */
  furyMul: number;
  furyThreshold: number;
}

/**
 * Przelicza klasę + wzięte ulepszenia na statystyki używane w symulacji.
 *
 * Wywoływane tylko przy zmianie listy ulepszeń, nie co tick — wynik ląduje
 * w `PlayerState.stats`. Klient przelicza to samo z tej samej listy, więc
 * predykcja ruchu pozostaje zgodna z serwerem.
 */
export function computeStats(classId: ClassId, upgrades: readonly UpgradeId[]): EffectiveStats {
  const cls: ClassDef = getClass(classId);
  const count = (id: UpgradeId) => upgrades.reduce((n, u) => (u === id ? n + 1 : n), 0);

  const stats: EffectiveStats = {
    maxHp: cls.maxHp + 22 * count('wytrzymalosc'),
    speed: cls.speed * Math.pow(1.07, count('szybkosc')),
    attackRange: cls.attackRange + 0.7 * count('zasieg'),
    attackDamage: cls.attackDamage * Math.pow(1.14, count('sila')),
    attackCooldownTicks: Math.max(
      2,
      Math.round(cls.attackCooldownTicks * Math.pow(1 / 1.11, count('zwinnosc'))),
    ),
    cooldownMul: Math.pow(0.88, count('odnowienie')),
    regenPerSecond: 5 * count('regeneracja'),
    lifesteal: 0.08 * count('wampiryzm'),
    pickupReachBonus: 2.5 * count('magnes'),
    extraLives: count('drugie_zycie'),
    impetusMul: count('impet') > 0 ? 1 + 0.25 * count('impet') : 1,
    impetusTicks: count('impet') > 0 ? Math.round(2 * TICK_HZ) : 0,
    furyMul: count('furia') > 0 ? 1 + 0.3 * count('furia') : 1,
    furyThreshold: 0.4,
  };

  return stats;
}

export function baseStats(classId: ClassId): EffectiveStats {
  return computeStats(classId, []);
}

/** Ulepszenia, które gracz może jeszcze wziąć (nie wyczerpał limitu). */
export function availableUpgrades(upgrades: readonly UpgradeId[]): UpgradeId[] {
  return UPGRADE_IDS.filter((id) => {
    const taken = upgrades.reduce((n, u) => (u === id ? n + 1 : n), 0);
    return taken < UPGRADES[id].maxStacks;
  });
}
