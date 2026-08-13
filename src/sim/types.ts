/**
 * Typy stanu symulacji.
 *
 * Wszystkie timery są wyrażone w **tickach**, nie w milisekundach.
 * Powód: klient predykuje własny ruch odtwarzając te same ticki co serwer
 * (sekcja 7). Timery w ms rozjeżdżają się przy rekoncyliacji.
 */

import type { ClassId } from './classes.ts';
import type { EffectiveStats, UpgradeId } from './upgrades.ts';

export type PlayerId = number;

/** Jedyne, co klient ma prawo twierdzić (sekcja 3: zasada zaufania). */
export interface InputFrame {
  /** Numer sekwencyjny — rośnie monotonicznie, służy do ACK i rekoncyliacji. */
  seq: number;
  /** Kierunek ruchu, znormalizowany, długość 0..1. */
  moveX: number;
  moveY: number;
  /** Krawędziowe — true tylko w klatce wciśnięcia. */
  dash: boolean;
  stealth: boolean;
  burst: boolean;
  /**
   * Wybór karty ulepszenia: indeks 0..2, albo -1 gdy gracz nic nie wybrał.
   * Klient przysyła NUMER KARTY, nigdy efektu — serwer waliduje go wobec
   * oferty, którą sam wystawił (sekcja 3: zasada zaufania).
   */
  pick: number;
}

export function emptyInput(seq = 0): InputFrame {
  return { seq, moveX: 0, moveY: 0, dash: false, stealth: false, burst: false, pick: -1 };
}

export type AbilityKey = 'dash' | 'stealth' | 'burst';

export interface PlayerState {
  id: PlayerId;
  slot: number;
  name: string;
  isBot: boolean;
  colorIndex: number;
  classId: ClassId;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Kąt w radianach — kierunek patrzenia, sterowany ostatnim niezerowym wejściem. */
  facing: number;

  hp: number;
  /** Z klasy — nie stała globalna, bo Kolos ma 150, a Widmo 82. */
  maxHp: number;
  alive: boolean;
  /** Tick śmierci (-1 gdy żyje) — do kolejności na tablicy wyników. */
  deathTick: number;
  /** Kto zadał ostatnie obrażenia (dla killfeeda i punktów). */
  lastHitBy: PlayerId;
  lastHitTick: number;

  // Timery (tick, w którym efekt się kończy / umiejętność jest gotowa).
  // Nazwy są slotowe, nie nazwane po konkretnej umiejętności: w slocie
  // RUCH siedzi Skok, Szarża albo Mgnienie i wszystkie dzielą te pola.
  dashEndTick: number;
  dashDirX: number;
  dashDirY: number;
  /** Kogo już trafiła bieżąca Szarża — żeby nie zadawała obrażeń co tick. */
  dashHits: PlayerId[];

  stealthEndTick: number;
  /** Tarcza: ile obrażeń jeszcze pochłonie i do kiedy działa. */
  shieldHp: number;
  shieldEndTick: number;

  /** Slot MOCY: tick detonacji (Fala/Rozdarcie) lub startu Salwy. */
  powerFireTick: number;
  /** Salwa: ile strzałów zostało i kiedy następny. */
  salvoLeft: number;
  salvoNextTick: number;
  salvoTargetId: PlayerId;
  /**
   * Czy następny cios liczy się jako zasadzka (wyjście z ukrycia).
   * Ustawiane przy wejściu w Cień, zdejmowane po pierwszym trafieniu.
   */
  ambushReady: boolean;

  cdMove: number;
  cdTrick: number;
  cdPower: number;
  cdAttack: number;

  // Buffy z dropów
  speedBuffEndTick: number;
  damageBuffEndTick: number;

  // Progresja w trakcie rundy.
  xp: number;
  level: number;
  upgrades: UpgradeId[];
  /** Wystawione karty. Pusta tablica = nie ma czego wybierać. */
  offer: UpgradeId[];
  offerDeadlineTick: number;
  /** Przeliczone z klasy i ulepszeń — nie licz tego co tick. */
  stats: EffectiveStats;
  /** Do kiedy działa Impet (przyspieszenie po użyciu slotu RUCH). */
  impetusEndTick: number;

  kills: number;
  damageDealt: number;
  score: number;
  /** Ostatni przetworzony `seq` — klient używa go do rekoncyliacji. */
  lastAckSeq: number;

  /** Stan AI — obecny tylko dla botów, ignorowany przy snapshotach. */
  ai?: BotBrain;
}

export interface BotBrain {
  /** 0..1 — „umiejętność" bota. Rozrzut sprawia, że lobby nie jest jednorodne. */
  skill: number;
  /** Tick, w którym bot podejmie następną decyzję (opóźnienie reakcji). */
  nextDecisionTick: number;
  targetId: PlayerId;
  /** Punkt, do którego bot aktualnie idzie. */
  waypointX: number;
  waypointY: number;
  /** Chwilowa „bezczynność" — bot udaje wahanie gracza. */
  idleUntilTick: number;
  mood: BotMood;
  /** Losowe przesunięcie kierunku — bot nie porusza się idealnie prosto. */
  driftPhase: number;
}

export type BotMood = 'roam' | 'hunt' | 'flee' | 'loot' | 'rezone';

export type PickupKind = 'heal' | 'speed' | 'damage';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  spawnTick: number;
}

export interface ZoneState {
  x: number;
  y: number;
  radius: number;
  /** Docelowy promień po zakończeniu kurczenia — HUD pokazuje zapowiedź. */
  nextRadius: number;
  shrinking: boolean;
}

export type MatchPhase = 'warmup' | 'live' | 'over';

/** Zdarzenia jednorazowe — konsumowane przez render/HUD, nie trzymane w stanie. */
export type SimEvent =
  | { type: 'kill'; killer: PlayerId; victim: PlayerId; tick: number }
  | { type: 'damage'; target: PlayerId; amount: number; source: PlayerId; x: number; y: number; tick: number }
  | { type: 'dash'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'stealthIn'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'stealthOut'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'burst'; player: PlayerId; x: number; y: number; radius: number; tick: number }
  | { type: 'rend'; player: PlayerId; x: number; y: number; facing: number; tick: number }
  | { type: 'salvo'; player: PlayerId; x: number; y: number; target: PlayerId; tick: number }
  | { type: 'shieldUp'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'shieldBreak'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'pickup'; player: PlayerId; kind: PickupKind; x: number; y: number; tick: number }
  | { type: 'supplyWarn'; x: number; y: number; tick: number }
  | { type: 'supplyDrop'; x: number; y: number; tick: number }
  | { type: 'zoneShrink'; radius: number; tick: number }
  | { type: 'levelUp'; player: PlayerId; level: number; tick: number }
  | { type: 'upgradePicked'; player: PlayerId; upgrade: UpgradeId; tick: number }
  | { type: 'revive'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'matchOver'; winner: PlayerId; tick: number };

export interface World {
  tick: number;
  seed: number;
  phase: MatchPhase;
  players: PlayerState[];
  pickups: Pickup[];
  zone: ZoneState;
  nextPickupId: number;
  nextPickupSpawnTick: number;
  nextSupplyTick: number;
  supplyWarnedTick: number;
  supplyX: number;
  supplyY: number;
  winner: PlayerId;
  overTick: number;
  /** Zdarzenia z ostatniego ticka. Czyszczone na początku każdego kroku. */
  events: SimEvent[];
}

/** Wynik meczu — to, co w Fazie 1 poleci do `match_player` i Progression. */
export interface MatchResult {
  seed: number;
  durationTicks: number;
  winner: PlayerId;
  standings: Array<{
    id: PlayerId;
    name: string;
    isBot: boolean;
    place: number;
    kills: number;
    damageDealt: number;
    score: number;
    survivedTicks: number;
    level: number;
    upgrades: UpgradeId[];
  }>;
}
