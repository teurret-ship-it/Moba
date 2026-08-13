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
  | 'furia'
  // Klasowe — patrz CLASS_UPGRADES niżej.
  | 'grad'
  | 'czajenie'
  | 'pancerz'
  | 'taran'
  | 'zasadzka'
  | 'przeskok'
  | 'trwala_kopia'
  | 'ciasne_sidla';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** Opis skutku — jedno zdanie, czytane w ferworze walki. */
  text: string;
  glyph: string;
  /** Ile razy da się wziąć. Po wyczerpaniu znika z puli. */
  maxStacks: number;
  /**
   * Klasa, dla której to ulepszenie istnieje. `undefined` = pula wspólna.
   *
   * Wzmacnia konkretną umiejętność z kitu, więc dla innej klasy byłoby
   * martwą kartą — a martwa karta w ofercie trzech to w praktyce oferta
   * dwóch.
   */
  classId?: ClassId;
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

  // --- Klasowe ---------------------------------------------------------------
  //
  // Dwanaście ulepszeń wspólnych daje tę samą krzywą każdej klasie: rosną
  // liczby, nie sposób grania. Klasowe robią coś innego — wzmacniają tę
  // umiejętność, która definiuje klasę, więc runda buduje TĘ postać,
  // a nie „postać z większymi liczbami".
  //
  // To jest też jedyny uczciwy lewar na Widmo (wsp. wygranych 0,46 przy
  // 1,38 Łowcy): podnoszenie mu obrażeń bazowych psuje starcie w otwartym
  // polu, którego Widmo i tak nie ma wygrywać. Zasadzka nagradza to,
  // do czego klasa jest zbudowana.
  grad: {
    // Startowo +2 pociski na stos. Przy 10 obrażeniach za pocisk dawało to
    // Łowcy +40 obrażeń w jednym przycisku i wywindowało go do wsp. 1,55
    // (najczęściej brana karta klasy). Jeden pocisk na stos wystarczy,
    // żeby Salwa była nadal tą kartą, którą się chce wziąć.
    id: 'grad', name: 'Grad', text: 'Salwa wystrzeliwuje pocisk więcej',
    glyph: '⁘', maxStacks: 2, classId: 'lowca',
  },
  czajenie: {
    // Pierwsza wersja obiecywała, że Cień "nie spowalnia" — a ukrycie
    // w tej grze nigdy nie spowalniało, tylko przyspieszało (mnożnik 1,18).
    // Karta nie robiła więc nic poza wydłużeniem czasu. Teraz wzmacnia to,
    // co Cień naprawdę daje Łowcy: możliwość wyjścia ze starcia.
    id: 'czajenie', name: 'Czajenie', text: 'Cień trwa +1,5 s i jest w nim szybciej',
    glyph: '☾', maxStacks: 2, classId: 'lowca',
  },
  pancerz: {
    // +20 na stos przy trzech stosach dawało Tarczy 94 pochłoniętych obrażeń
    // wobec 34 bazowych — Kolos wychodził z rundy praktycznie nie do zabicia
    // (wsp. 1,26 +/- 0,11, najdłuższe przeżycie w stawce po Widmie).
    id: 'pancerz', name: 'Pancerz', text: 'Tarcza pochłania +14 obrażeń',
    glyph: '⛨', maxStacks: 3, classId: 'kolos',
  },
  taran: {
    id: 'taran', name: 'Taran', text: 'Szarża zadaje +12 obrażeń i mocniej odrzuca',
    glyph: '⏻', maxStacks: 2, classId: 'kolos',
  },
  zasadzka: {
    id: 'zasadzka', name: 'Zasadzka', text: 'Rozdarcie z ukrycia zadaje jeszcze +60%',
    glyph: '☠', maxStacks: 2, classId: 'widmo',
  },
  przeskok: {
    id: 'przeskok', name: 'Przeskok', text: 'Mgnienie odnawia się o 30% szybciej',
    glyph: '⇶', maxStacks: 2, classId: 'widmo',
  },
  trwala_kopia: {
    id: 'trwala_kopia', name: 'Trwała kopia', text: 'Zwód ma +30 zdrowia i stoi 2 s dłużej',
    glyph: '⧈', maxStacks: 2, classId: 'kuglarz',
  },
  ciasne_sidla: {
    id: 'ciasne_sidla', name: 'Ciasne sidła', text: 'Sidła spowalniają mocniej i o 1 s dłużej',
    glyph: '❊', maxStacks: 2, classId: 'kuglarz',
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

/** Ulepszenia klasowe pogrupowane — do ekranu wyboru postaci i testów. */
export const CLASS_UPGRADES: Record<ClassId, UpgradeId[]> = UPGRADE_IDS.reduce(
  (acc, id) => {
    const cls = UPGRADES[id].classId;
    if (cls) acc[cls].push(id);
    return acc;
  },
  { lowca: [], kolos: [], widmo: [], kuglarz: [] } as Record<ClassId, UpgradeId[]>,
);

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

  // --- Modyfikatory kitu klasowego ------------------------------------------
  //
  // Wszystkie są neutralne w wartości domyślnej (0 lub 1), więc klasa, która
  // danego ulepszenia nie ma w puli, liczy się dokładnie tak jak wcześniej.

  /** Salwa: dodatkowe pociski. */
  salvoBonusShots: number;
  /** Cień: dłuższe trwanie i dodatkowa prędkość w ukryciu. */
  stealthBonusTicks: number;
  stealthSpeedMul: number;
  /** Tarcza: większa pochłaniana pula. */
  shieldBonusAbsorb: number;
  /** Szarża: mocniejsze wejście. */
  chargeBonusDamage: number;
  chargeBonusKnockback: number;
  /** Rozdarcie: premia do mnożnika z ukrycia. */
  ambushBonus: number;
  /** Osobny mnożnik odnowienia slotu RUCH (Mgnienie). */
  moveCooldownMul: number;
  /** Zwód: wytrzymalsza i dłużej stojąca kopia. */
  decoyBonusHp: number;
  decoyBonusTicks: number;
  /** Sidła: silniejsze i dłuższe spowolnienie. */
  snareSlowBonus: number;
  snareBonusTicks: number;
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

    salvoBonusShots: count('grad'),
    stealthBonusTicks: Math.round(1.5 * TICK_HZ) * count('czajenie'),
    stealthSpeedMul: Math.pow(1.1, count('czajenie')),
    shieldBonusAbsorb: 14 * count('pancerz'),
    chargeBonusDamage: 12 * count('taran'),
    chargeBonusKnockback: 10 * count('taran'),
    ambushBonus: 0.6 * count('zasadzka'),
    moveCooldownMul: Math.pow(0.7, count('przeskok')),
    decoyBonusHp: 30 * count('trwala_kopia'),
    decoyBonusTicks: Math.round(2 * TICK_HZ) * count('trwala_kopia'),
    snareSlowBonus: 0.09 * count('ciasne_sidla'),
    snareBonusTicks: Math.round(1 * TICK_HZ) * count('ciasne_sidla'),
  };

  return stats;
}

export function baseStats(classId: ClassId): EffectiveStats {
  return computeStats(classId, []);
}

/**
 * Ulepszenia, które gracz może jeszcze wziąć (nie wyczerpał limitu).
 *
 * Klasowe wchodzą do puli tylko swojej klasie — reszta by ich nie użyła.
 */
export function availableUpgrades(upgrades: readonly UpgradeId[], classId: ClassId): UpgradeId[] {
  return UPGRADE_IDS.filter((id) => {
    const def = UPGRADES[id];
    if (def.classId !== undefined && def.classId !== classId) return false;
    const taken = upgrades.reduce((n, u) => (u === id ? n + 1 : n), 0);
    return taken < def.maxStacks;
  });
}
