/**
 * Typy stanu symulacji.
 *
 * Wszystkie timery są wyrażone w **tickach**, nie w milisekundach.
 * Powód: klient predykuje własny ruch odtwarzając te same ticki co serwer
 * (sekcja 7). Timery w ms rozjeżdżają się przy rekoncyliacji.
 */

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
}

export function emptyInput(seq = 0): InputFrame {
  return { seq, moveX: 0, moveY: 0, dash: false, stealth: false, burst: false };
}

export type AbilityKey = 'dash' | 'stealth' | 'burst';

export interface PlayerState {
  id: PlayerId;
  slot: number;
  name: string;
  isBot: boolean;
  colorIndex: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Kąt w radianach — kierunek patrzenia, sterowany ostatnim niezerowym wejściem. */
  facing: number;

  hp: number;
  alive: boolean;
  /** Tick śmierci (-1 gdy żyje) — do kolejności na tablicy wyników. */
  deathTick: number;
  /** Kto zadał ostatnie obrażenia (dla killfeeda i punktów). */
  lastHitBy: PlayerId;
  lastHitTick: number;

  // Timery (tick, w którym efekt się kończy / umiejętność jest gotowa)
  dashEndTick: number;
  dashDirX: number;
  dashDirY: number;
  stealthEndTick: number;
  burstFireTick: number;
  cdDash: number;
  cdStealth: number;
  cdBurst: number;
  cdAttack: number;

  // Buffy z dropów
  speedBuffEndTick: number;
  damageBuffEndTick: number;

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
  | { type: 'burst'; player: PlayerId; x: number; y: number; tick: number }
  | { type: 'pickup'; player: PlayerId; kind: PickupKind; x: number; y: number; tick: number }
  | { type: 'supplyWarn'; x: number; y: number; tick: number }
  | { type: 'supplyDrop'; x: number; y: number; tick: number }
  | { type: 'zoneShrink'; radius: number; tick: number }
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
  }>;
}
