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

export type ClassId = 'lowca' | 'kolos' | 'widmo';

export type MoveAbility = 'skok' | 'szarza' | 'mgnienie';
export type TrickAbility = 'cien' | 'tarcza';
export type PowerAbility = 'salwa' | 'fala' | 'rozdarcie';

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

}

export const ABILITY_NAMES: Record<MoveAbility | TrickAbility | PowerAbility, string> = {
  skok: 'Skok',
  szarza: 'Szarża',
  mgnienie: 'Mgnienie',
  cien: 'Cień',
  tarcza: 'Tarcza',
  salwa: 'Salwa',
  fala: 'Fala',
  rozdarcie: 'Rozdarcie',
};

export const ABILITY_GLYPHS: Record<MoveAbility | TrickAbility | PowerAbility, string> = {
  skok: '➤',
  szarza: '⏵',
  mgnienie: '⇢',
  cien: '◍',
  tarcza: '❖',
  salwa: '⁙',
  fala: '✸',
  rozdarcie: '✦',
};

export const CLASSES: Record<ClassId, ClassDef> = {
  // Punkt odniesienia. Kto nie wie, co wybrać, bierze Łowcę i gra dobrze.
  lowca: {
    id: 'lowca',
    name: 'Łowca',
    tagline: 'Dystans i tempo. Bije z daleka, znika, gdy zrobi się gęsto.',
    maxHp: 100,
    speed: 9.5,
    attackRange: 7.2,
    attackDamage: 5.0,
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
    maxHp: 130,
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
    maxHp: 95,
    speed: 10.6,
    attackRange: 6.0,
    attackDamage: 5.6,
    attackCooldownTicks: Math.round(0.48 * TICK_HZ),
    move: 'mgnienie',
    trick: 'cien',
    power: 'rozdarcie',
  },
};

export const CLASS_IDS: readonly ClassId[] = ['lowca', 'kolos', 'widmo'];

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
    cooldownTicks: Math.round(4 * TICK_HZ),
    durationTicks: 1,
    speed: 210,
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
    /** Ile obrażeń pochłania, zanim pęknie. */
    absorb: 40,
  },
} as const;

export const POWER_ABILITY = {
  // Trzy szybkie strzały w jeden cel. Nagradza utrzymanie dystansu.
  salwa: {
    cooldownTicks: Math.round(9 * TICK_HZ),
    shots: 3,
    intervalTicks: Math.round(0.12 * TICK_HZ),
    damagePerShot: 10,
    range: 8.5,
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
    cooldownTicks: Math.round(7 * TICK_HZ),
    windupTicks: Math.round(0.12 * TICK_HZ),
    range: 7.5,
    /** Połowa kąta stożka w radianach. */
    halfAngle: Math.PI * 0.42,
    damage: 34,
    ambushMultiplier: 2.0,
  },
} as const;
