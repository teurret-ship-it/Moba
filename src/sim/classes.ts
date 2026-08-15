import { TICK_HZ } from './constants.ts';

/**
 * Klasy postaci.
 *
 * Do tej pory wszyscy w lobby byli identyczni — jedyną zmienną był drop.
 * To jest za mało treści na 3 rundy z rzędu (bramka Fazy 0): druga runda
 * wygląda dokładnie jak pierwsza.
 *
 * Struktura kitu jest wspólna dla wszystkich klas — trzy sloty, zawsze te
 * same trzy przyciski:
 *
 *   RUCH     — przemieszczenie. Zawsze predykowane przez klienta (sekcja 7),
 *              więc każda implementacja musi dać się policzyć bez znajomości
 *              całego świata.
 *   SZTUCZKA — przetrwanie / oszustwo. Rozstrzyga serwer.
 *   MOC      — obrażenia. Rozstrzyga serwer.
 *
 * Dzięki wspólnym slotom gracz uczy się sterowania raz, a mimo to każda
 * klasa gra inaczej. Zmiana klasy nie wymaga zmiany layoutu HUD-u ani
 * przeuczenia kciuka — co przy jednej ręce na telefonie jest warunkiem,
 * a nie wygodą.
 */

export type ClassId = 'lowca' | 'kolos' | 'widmo' | 'kuglarz';

export type MoveAbility = 'skok' | 'szarza' | 'mgnienie' | 'zamiana';
export type TrickAbility = 'cien' | 'tarcza' | 'zwod';
export type PowerAbility = 'salwa' | 'fala' | 'rozdarcie' | 'sidla';

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Jedno zdanie na ekranie wyboru — po co bym to wziął. */
  tagline: string;

  maxHp: number;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackCooldownTicks: number;

  move: MoveAbility;
  trick: TrickAbility;
  power: PowerAbility;

  /** Zdanie o cesze klasy na ekranie wyboru. Puste = klasa bez cechy. */
  passive?: string;
  /** Cecha mechaniczna: eliminacja natychmiast odnawia slot SZTUCZKA. */
  trickResetOnKill?: boolean;
}

export const ABILITY_NAMES: Record<MoveAbility | TrickAbility | PowerAbility, string> = {
  skok: 'Skok',
  szarza: 'Szarża',
  mgnienie: 'Mgnienie',
  zamiana: 'Zamiana',
  cien: 'Cień',
  tarcza: 'Tarcza',
  zwod: 'Zwód',
  salwa: 'Salwa',
  fala: 'Fala',
  rozdarcie: 'Rozdarcie',
  sidla: 'Sidła',
};

export const ABILITY_GLYPHS: Record<MoveAbility | TrickAbility | PowerAbility, string> = {
  skok: '➤',
  szarza: '⏵',
  mgnienie: '⇢',
  zamiana: '⇄',
  cien: '◍',
  tarcza: '❖',
  zwod: '⧉',
  salwa: '⁙',
  fala: '✸',
  rozdarcie: '✦',
  sidla: '❋',
};

export const CLASSES: Record<ClassId, ClassDef> = {
  // Punkt odniesienia. Kto nie wie, co wybrać, bierze Łowcę i gra dobrze.
  lowca: {
    id: 'lowca',
    name: 'Łowca',
    tagline: 'Dystans i tempo. Bije z daleka, znika, gdy zrobi się gęsto.',
    maxHp: 100,
    speed: 9.5,
    attackRange: 6.8,
    attackDamage: 4.8,
    attackCooldownTicks: Math.round(0.55 * TICK_HZ),
    move: 'skok',
    trick: 'cien',
    power: 'salwa',
  },

  // Wolny i wytrzymały. Wygrywa starcia, których nie da się uniknąć,
  // ale nie potrafi wybierać, w które wchodzi.
  kolos: {
    id: 'kolos',
    name: 'Kolos',
    tagline: 'Wchodzi pierwszy i wychodzi ostatni. Powolny, ale nie do zdarcia.',
    maxHp: 120,
    speed: 8.2,
    attackRange: 5.5,
    attackDamage: 6.0,
    attackCooldownTicks: Math.round(0.7 * TICK_HZ),
    move: 'szarza',
    trick: 'tarcza',
    power: 'fala',
  },

  // Szklana armata. Zabija z zaskoczenia albo ginie.
  widmo: {
    id: 'widmo',
    name: 'Widmo',
    tagline: 'Zabija z zaskoczenia. Kruche — jeśli je zobaczysz, już przegrało.',
    // 102 -> 92. Opis mówi „kruche", a pomiar mówił co innego: Widmo miało
    // NAJDŁUŻSZE przeżycie w całej stawce (90 s wobec 73-82 s) przy
    // najwyższych eliminacjach. Szklana armata, która nie jest szklana,
    // jest po prostu armatą.
    maxHp: 92,
    speed: 10.6,
    attackRange: 6.0,
    attackDamage: 5.6,
    attackCooldownTicks: Math.round(0.48 * TICK_HZ),
    move: 'mgnienie',
    trick: 'cien',
    power: 'rozdarcie',
    passive: 'Zniknięcie — eliminacja natychmiast odnawia Cień.',
    trickResetOnKill: true,
  },

  // Nie walczy o pozycję — walczy o to, gdzie przeciwnik myśli, że jesteś.
  // Cała trójka umiejętności działa razem: stawiasz kopię, wróg bije w nią,
  // ty zamieniasz się z nią miejscami i lądujesz mu za plecami.
  kuglarz: {
    id: 'kuglarz',
    name: 'Kuglarz',
    tagline: 'Nie tam, gdzie go widzisz. Stawia kopię i zamienia się z nią miejscami.',
    // Jedyna klasa bez mocy zadającej obrażenia — Sidła kontrolują, ale nie
    // zabijają. Rekompensatą jest najwyższe obrażenie na sekundę z auto-ataku,
    // co spina się z jej własnym kitem: spowolniony przeciwnik nie ucieknie
    // przed ciągłym ostrzałem. Bez tego Kuglarz miał 0,35 eliminacji na
    // postać przy ~1,0 u pozostałych.
    // 105 -> 112. Najtrwalszy sygnał z całego pomiaru: Kuglarz ginie
    // 15-22 sekundy wcześniej niż reszta stawki (70 s wobec 85-92 s),
    // i to w każdym kolejnym przebiegu, przy każdej wersji AI. Powód jest
    // strukturalny — jako jedyny nie ma mocy zadającej obrażenia, więc
    // potrzebuje więcej CZASU w starciu, żeby zamienić przewagę
    // auto-ataku na eliminację. Przy tej samej kruchości po prostu
    // przegrywa wymianę, zanim zdąży ją wygrać.
    maxHp: 112,
    speed: 9.8,
    attackRange: 6.5,
    attackDamage: 6.6,
    attackCooldownTicks: Math.round(0.46 * TICK_HZ),
    move: 'zamiana',
    trick: 'zwod',
    power: 'sidla',
  },
};

export const CLASS_IDS: readonly ClassId[] = ['lowca', 'kolos', 'widmo', 'kuglarz'];

export function getClass(id: ClassId): ClassDef {
  return CLASSES[id] ?? CLASSES.lowca;
}

// --- Parametry umiejętności --------------------------------------------------

/** RUCH — wszystkie są predykowane, więc muszą być czysto kinematyczne. */
export const MOVE_ABILITY = {
  skok: {
    cooldownTicks: Math.round(6 * TICK_HZ),
    durationTicks: Math.round(0.18 * TICK_HZ),
    speed: 42,
    /** Obrażenia zadawane mijanym wrogom (0 = brak). */
    damage: 0,
    knockback: 0,
  },
  // Dłuższa i wolniejsza od Skoku, ale rozpycha i boli. Kolos nie ucieka
  // szarżą — on nią wchodzi.
  szarza: {
    cooldownTicks: Math.round(7 * TICK_HZ),
    durationTicks: Math.round(0.34 * TICK_HZ),
    speed: 34,
    damage: 14,
    knockback: 18,
  },
  // Teleport: zero czasu trwania, więc nie da się go przerwać ani trafić
  // w locie. Za to krótszy dystans i brak obrażeń.
  mgnienie: {
    // 4 s -> 5 s. Najkrótsze odnowienie slotu RUCH w całej stawce (reszta
    // ma 5-7 s), a Widmo używa go i do wejścia, i do wyjścia. Po naprawieniu
    // celowania klasa zaczęła wygrywać oba te momenty naraz.
    cooldownTicks: Math.round(5 * TICK_HZ),
    durationTicks: 1,
    speed: 210,
    damage: 0,
    knockback: 0,
  },
  // Zamiana bez postawionego Zwodu jest krótkim skokiem — umiejętność ma
  // zawsze coś robić, inaczej przycisk kłamie. Z Zwodem zamienia miejscami
  // i wtedy zasięg jest dowolny, co obsługuje `combat.ts`, nie kinematyka.
  zamiana: {
    cooldownTicks: Math.round(5 * TICK_HZ),
    durationTicks: Math.round(0.14 * TICK_HZ),
    speed: 40,
    damage: 0,
    knockback: 0,
  },
} as const;

export const TRICK_ABILITY = {
  cien: {
    cooldownTicks: Math.round(14 * TICK_HZ),
    durationTicks: Math.round(3.5 * TICK_HZ),
  },
  tarcza: {
    cooldownTicks: Math.round(12 * TICK_HZ),
    durationTicks: Math.round(5 * TICK_HZ),
    /**
     * Ile obrażeń pochłania, zanim pęknie.
     *
     * Wartość wróciła do 34 po ścięciu do 28. Ścięcie było reakcją na
     * wsp. 1,30 Kolosa — a ten wynik brał się z tego, że Widmo popełniało
     * masowe samobójstwa na strefie i oddawało finały. Po naprawieniu weta
     * strefy Kolos spadł do 0,77 i okazało się, że nerf leczył objaw cudzej
     * choroby. Trzeci raz w tym projekcie, kiedy pozorna nierównowaga klas
     * była w istocie błędem gdzie indziej.
     */
    absorb: 34,
  },
  // Zwód stoi nieruchomo i wygląda dokładnie jak właściciel. Dla botów jest
  // nieodróżnialny od gracza — i o to chodzi.
  zwod: {
    cooldownTicks: Math.round(13 * TICK_HZ),
    durationTicks: Math.round(6 * TICK_HZ),
    // 45 -> 60. Zwód jest jedynym narzędziem przetrwania Kuglarza (Sidła
    // nie ranią, Zamiana wymaga kopii), a klasa ginęła najszybciej w stawce:
    // 68 s przeżycia wobec 84-87 s u pozostałych, przy wsp. 0,69 +/- 0,08.
    // Kopia musi wytrzymać na tyle długo, żeby zdążyć się z nią zamienić.
    hp: 60,
    /**
     * Kopia strzela — słabiej i rzadziej niż właściciel.
     *
     * Ułamek, nie liczba: kopia ma skalować się razem z postacią, więc
     * ulepszenia obrażeń działają też na nią. 45% i wolniejszy rytm ustawiają
     * ją jako groźbę, a nie jako drugiego gracza.
     */
    damageShare: 0.45,
    attackCooldownTicks: Math.round(0.8 * TICK_HZ),
    attackRange: 6.0,
    /**
     * Jak daleko przed siebie leci kopia.
     *
     * Nieco mniej niż zasięg auto-ataku Kuglarza (6,5): rzucona w stronę
     * przeciwnika ląduje między wami, więc konkuruje o jego cios, a zamiana
     * z nią jest realnym wejściem, nie kosmetyką.
     */
    throwDistance: 6.0,
  },
} as const;

export const POWER_ABILITY = {
  // Trzy szybkie strzały w jeden cel. Nagradza utrzymanie dystansu.
  salwa: {
    cooldownTicks: Math.round(9 * TICK_HZ),
    shots: 3,
    intervalTicks: Math.round(0.12 * TICK_HZ),
    // 10 -> 8. Przy trzech pociskach Salwa dawała 30 obrażeń z zasięgu 8,
    // czyli więcej niż Fala Kolosa z 9 jednostek i bez konieczności wejścia
    // w kontakt. Pomiar na 400 rundach: Łowca 1,49 +/- 0,12 przy uczciwym 1,0.
    damagePerShot: 8,
    range: 8.0,
  },
  fala: {
    cooldownTicks: Math.round(10 * TICK_HZ),
    windupTicks: Math.round(0.25 * TICK_HZ),
    radius: 9.0,
    damage: 24,
    knockback: 26,
  },
  // Stożek przed sobą. Krótki zasięg, wysokie obrażenia — i podwójne,
  // jeśli wychodzisz z ukrycia. To jest cała ekonomia Widma.
  rozdarcie: {
    // Powrót do 7 s po skróceniu do 6 s.
    //
    // Skrócenie było odpowiedzią na wsp. 0,56 Widma i wtedy było słuszne.
    // Zmieniło je jednak co innego: odkąd celowanie automatyczne szuka celu
    // w zasięgu SAMEJ umiejętności (7,5), a nie auto-ataku (6,0), Rozdarcie
    // trafia w cele, których wcześniej nie umiało wskazać. Widmo skoczyło do
    // wsp. 2,55 przy 1,96 eliminacji na postać — czyli poprawka celowania
    // była zarazem sporym wzmocnieniem tej jednej klasy.
    cooldownTicks: Math.round(7 * TICK_HZ),
    windupTicks: Math.round(0.12 * TICK_HZ),
    range: 7.5,
    /**
     * Połowa kąta stożka w radianach.
     *
     * 0,42π (151° rozwarcia) to nie był stożek, tylko półokrąg — przy takim
     * kącie celowanie nie miało znaczenia, bo trafiało się we wszystko przed
     * sobą. 0,3π daje 108°: nadal wybaczające na telefonie, ale już nagradza
     * pokazanie kierunku.
     */
    halfAngle: Math.PI * 0.3,
    // 34 -> 22.
    //
    // Sama umiejętność się nie zmieniła — zmieniła się jej SKUTECZNOŚĆ.
    // Zanim celowanie zaczęło działać, stożek leciał tam, gdzie akurat
    // patrzył auto-atak, więc w praktyce często chybiał; klasa była
    // zbalansowana wokół zepsutej umiejętności. Po naprawieniu Widmo skoczyło
    // z wsp. 0,87 na 2,56 przy 1,87 eliminacji na postać. To jest ta sama
    // lekcja co przy Zamianie Kuglarza, tylko w drugą stronę: liczby
    // opisujące mechanikę są warte tyle, ile jej działanie.
    damage: 22,
    ambushMultiplier: 2.0,
  },
  // Sidła nie zadają obrażeń — spowalniają. To jest narzędzie kontroli:
  // pozwala uciec albo dogonić, ale nikogo samo nie zabija.
  sidla: {
    cooldownTicks: Math.round(11 * TICK_HZ),
    windupTicks: Math.round(0.2 * TICK_HZ),
    // Promień zmniejszony z 8,0, bo pole przestało wybuchać pod nogami
    // i zaczęło być rzucane — obszar o promieniu 8 rzucany na 9 jednostek
    // pokrywałby pół areny końcowej.
    radius: 6.5,
    /** Jak daleko da się rzucić środek pola. */
    throwRange: 9.0,
    /**
     * Mnożnik prędkości dla złapanych.
     *
     * Kuglarz jest jedyną klasą bez mocy zadającej obrażenia i jedyną, która
     * w każdym pomiarze ma najniższe eliminacje ORAZ najkrótsze przeżycie.
     * Jego rekompensatą ma być najwyższe obrażenie z auto-ataku — a to działa
     * tylko wtedy, gdy spowolniony przeciwnik naprawdę nie ucieknie.
     */
    slowMul: 0.48,
    durationTicks: Math.round(2.6 * TICK_HZ),
  },
} as const;
