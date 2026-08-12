import { AOI_RADIUS, SNAPSHOT_HZ, TICK_HZ } from './constants.ts';
import type {
  MatchPhase,
  Pickup,
  PlayerId,
  PlayerState,
  SimEvent,
  World,
  ZoneState,
} from './types.ts';
import { isStealthed } from './world.ts';

/**
 * Snapshot — jedyna rzecz, którą klient dostaje o świecie.
 *
 * Dwie reguły z sekcji 7, obie zaimplementowane tutaj i obie krytyczne:
 *
 *  1. **Stealth rozstrzyga serwer.** Gracze niewidoczni nie są wysyłani
 *     do klienta W OGÓLE. Gdyby lecieli z flagą `invisible: true`,
 *     cheat przez czytanie pamięci byłby trywialny.
 *
 *  2. **Area of Interest.** Klient dostaje tylko byty w promieniu
 *     widzenia. To jednocześnie anti-cheat i oszczędność pasma.
 *
 * W Fazie 0 filtr działa lokalnie i nikogo nie chroni — ale gra jest
 * pisana pod jego zachowanie, więc włączenie serwera w Fazie 1 niczego
 * nie zmienia w odczuciach. Retrofit tego filtru po starcie oznaczałby
 * przeprojektowanie stealth i zasięgu widzenia.
 */

export interface PlayerView {
  id: PlayerId;
  x: number;
  y: number;
  facing: number;
  hp: number;
  alive: boolean;
  colorIndex: number;
  name: string;
  isBot: boolean;
  dashing: boolean;
  /** Ustawiane tylko dla odbiorcy snapshotu — nikt inny nie wie o cudzym ukryciu. */
  stealthed: boolean;
  speedBuffed: boolean;
  damageBuffed: boolean;
  bursting: boolean;
}

export interface Snapshot {
  tick: number;
  phase: MatchPhase;
  /** Slot odbiorcy — snapshot jest zawsze personalizowany. */
  viewerId: PlayerId;
  /** Ostatni `seq` wejścia uwzględniony w tym snapshocie (rekoncyliacja). */
  ackSeq: number;
  players: PlayerView[];
  pickups: Pickup[];
  zone: ZoneState;
  aliveCount: number;
  events: SimEvent[];
  winner: PlayerId;
  /** Pełny stan gracza lokalnego — potrzebny do predykcji i HUD. */
  self: SelfView | null;
}

export interface SelfView {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  alive: boolean;
  dashEndTick: number;
  dashDirX: number;
  dashDirY: number;
  stealthEndTick: number;
  speedBuffEndTick: number;
  damageBuffEndTick: number;
  cdDash: number;
  cdStealth: number;
  cdBurst: number;
  kills: number;
  score: number;
}

/**
 * Czy w tym ticku wysyłamy snapshot.
 *
 * Bezstanowe i odporne na nierówny podział TICK_HZ / SNAPSHOT_HZ.
 * Przy 20 Hz symulacji i 15 Hz snapshotów daje wzorzec 1-1-2 ticki,
 * czyli dokładnie 15 snapshotów na sekundę zamiast 10, które wychodziły
 * z naiwnego porównania licznika z 1,33.
 */
export function isSnapshotTick(tick: number): boolean {
  if (tick <= 0) return false;
  const ratio = SNAPSHOT_HZ / TICK_HZ;
  return Math.floor(tick * ratio) > Math.floor((tick - 1) * ratio);
}

export function buildSnapshot(world: World, viewerId: PlayerId): Snapshot {
  const viewer = world.players[viewerId];
  const players: PlayerView[] = [];

  // Martwy gracz obserwuje — wtedy AoI liczymy od miejsca śmierci.
  const eyeX = viewer?.x ?? 0;
  const eyeY = viewer?.y ?? 0;
  const aoi = viewer?.alive ? AOI_RADIUS : AOI_RADIUS * 1.8;

  for (const p of world.players) {
    const isSelf = p.id === viewerId;

    if (!isSelf) {
      // Reguła 1: ukryci nie trafiają do snapshotu.
      if (isStealthed(p, world.tick)) continue;
      // Reguła 2: poza AoI nie trafiają do snapshotu.
      if (Math.hypot(p.x - eyeX, p.y - eyeY) > aoi) continue;
      // Martwych pomijamy — nie ma zwłok do renderowania.
      if (!p.alive) continue;
    }

    players.push(toView(p, world.tick, isSelf));
  }

  const pickups = world.pickups.filter(
    (item) => Math.hypot(item.x - eyeX, item.y - eyeY) <= aoi,
  );

  return {
    tick: world.tick,
    phase: world.phase,
    viewerId,
    ackSeq: viewer?.lastAckSeq ?? 0,
    players,
    pickups: pickups.map((p) => ({ ...p })),
    zone: { ...world.zone },
    aliveCount: world.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0),
    events: filterEvents(world, viewerId, eyeX, eyeY, aoi),
    winner: world.winner,
    self: viewer ? toSelfView(viewer) : null,
  };
}

function toView(p: PlayerState, tick: number, isSelf: boolean): PlayerView {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    facing: p.facing,
    hp: p.hp,
    alive: p.alive,
    colorIndex: p.colorIndex,
    name: p.name,
    isBot: p.isBot,
    dashing: tick < p.dashEndTick,
    stealthed: isSelf && tick < p.stealthEndTick,
    speedBuffed: tick < p.speedBuffEndTick,
    damageBuffed: tick < p.damageBuffEndTick,
    bursting: p.burstFireTick >= 0,
  };
}

function toSelfView(p: PlayerState): SelfView {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    facing: p.facing,
    hp: p.hp,
    alive: p.alive,
    dashEndTick: p.dashEndTick,
    dashDirX: p.dashDirX,
    dashDirY: p.dashDirY,
    stealthEndTick: p.stealthEndTick,
    speedBuffEndTick: p.speedBuffEndTick,
    damageBuffEndTick: p.damageBuffEndTick,
    cdDash: p.cdDash,
    cdStealth: p.cdStealth,
    cdBurst: p.cdBurst,
    kills: p.kills,
    score: p.score,
  };
}

/**
 * Zdarzenia też podlegają AoI — inaczej klient słyszy wybuchy z drugiego
 * końca mapy i wie, gdzie stoją przeciwnicy. Wyjątki: zdarzenia globalne
 * (koniec meczu, strefa, zapowiedź zrzutu) i zdarzenia dotyczące odbiorcy.
 */
function filterEvents(
  world: World,
  viewerId: PlayerId,
  eyeX: number,
  eyeY: number,
  aoi: number,
): SimEvent[] {
  const out: SimEvent[] = [];
  for (const e of world.events) {
    switch (e.type) {
      case 'matchOver':
      case 'zoneShrink':
      case 'supplyWarn':
      case 'supplyDrop':
        out.push(e);
        break;
      case 'kill':
        // Killfeed jest globalny — to jest informacja o stanie rundy,
        // a nie o pozycji. Współrzędnych w tym zdarzeniu nie ma.
        out.push(e);
        break;
      case 'damage':
        if (e.target === viewerId || e.source === viewerId || withinAoi(e.x, e.y, eyeX, eyeY, aoi)) {
          out.push(e);
        }
        break;
      case 'pickup':
        if (e.player === viewerId || withinAoi(e.x, e.y, eyeX, eyeY, aoi)) out.push(e);
        break;
      case 'stealthIn':
      case 'stealthOut':
      case 'dash':
      case 'burst':
        if (e.player === viewerId || withinAoi(e.x, e.y, eyeX, eyeY, aoi)) out.push(e);
        break;
    }
  }
  return out;
}

function withinAoi(x: number, y: number, eyeX: number, eyeY: number, aoi: number): boolean {
  return Math.hypot(x - eyeX, y - eyeY) <= aoi;
}

/**
 * Szacunek rozmiaru snapshotu w bajtach, gdyby był zakodowany binarnie.
 *
 * Sekcja 4 planu daje budżet: ≤1,5 MB danych na mecz (twardy limit 3 MB).
 * Binarny enkoder to Faza 1 — ale budżet trzeba mierzyć od Fazy 0, bo
 * jeśli już teraz go przekraczamy, to problem jest w projekcie widoku,
 * a nie w formacie. Stąd estymator zamiast enkodera.
 *
 * Założenia kodowania (typowe dla snapshot delta):
 *  - nagłówek: tick u32 + phase u8 + ack u16 + liczności = 10 B
 *  - gracz: id u8, x/y i16 (stała precyzja), facing u8, hp u8, flagi u8 = 8 B
 *  - drop: id u16, kind u8, x/y i16 = 7 B
 *  - strefa: radius i16 + flagi = 4 B
 *  - zdarzenie: typ u8 + payload ~6 B = 7 B
 */
export function estimateSnapshotBytes(s: Snapshot): number {
  return 10 + s.players.length * 8 + s.pickups.length * 7 + 4 + s.events.length * 7;
}
