import {
  ARENA_RADIUS,
  MAX_HP,
  PICKUP_SPAWN_INTERVAL_TICKS,
  SUPPLY_EVENT_INTERVAL_TICKS,
  WARMUP_TICKS,
  ZONE_START_RADIUS,
} from './constants.ts';
import { Rng } from './rng.ts';
import type { PlayerState, World } from './types.ts';

export const BOT_NAMES = [
  'Kruk', 'Igła', 'Wilk', 'Sowa', 'Cień', 'Mors', 'Rysz', 'Lis',
  'Kret', 'Żmija', 'Bąk', 'Osa', 'Ćma', 'Ryś', 'Jeż', 'Sum',
] as const;

export interface CreateWorldOptions {
  seed: number;
  /** Liczba wszystkich slotów w lobby (ludzie + boty). */
  playerCount: number;
  /** Nazwa gracza lokalnego (slot 0). W Fazie 0 jest tylko jeden człowiek. */
  localName?: string;
  /** Ilu graczy w lobby to ludzie. Reszta to fill botami (sekcja 7). */
  humanCount?: number;
}

export function createWorld(opts: CreateWorldOptions): World {
  const rng = new Rng(opts.seed);
  const humanCount = opts.humanCount ?? 1;
  const players: PlayerState[] = [];

  // Rozstawienie na okręgu — równy dystans do środka dla wszystkich.
  const spawnRadius = ARENA_RADIUS * 0.74;
  const angleOffset = rng.next() * Math.PI * 2;
  const usedNames = new Set<string>();

  for (let slot = 0; slot < opts.playerCount; slot++) {
    const angle = angleOffset + (slot / opts.playerCount) * Math.PI * 2;
    const isBot = slot >= humanCount;

    let name: string;
    if (isBot) {
      do {
        name = rng.pick(BOT_NAMES) + ' ' + rng.int(10, 99);
      } while (usedNames.has(name));
    } else {
      name = slot === 0 ? (opts.localName ?? 'Ty') : `Gracz ${slot + 1}`;
    }
    usedNames.add(name);

    players.push(
      createPlayer({
        id: slot,
        slot,
        name,
        isBot,
        x: Math.cos(angle) * spawnRadius,
        y: Math.sin(angle) * spawnRadius,
        facing: angle + Math.PI,
        colorIndex: slot,
      }),
    );
  }

  return {
    tick: 0,
    seed: opts.seed,
    phase: 'warmup',
    players,
    pickups: [],
    zone: {
      x: 0,
      y: 0,
      radius: ZONE_START_RADIUS,
      nextRadius: ZONE_START_RADIUS,
      shrinking: false,
    },
    nextPickupId: 1,
    nextPickupSpawnTick: WARMUP_TICKS + PICKUP_SPAWN_INTERVAL_TICKS,
    nextSupplyTick: WARMUP_TICKS + SUPPLY_EVENT_INTERVAL_TICKS,
    supplyWarnedTick: -1,
    supplyX: 0,
    supplyY: 0,
    winner: -1,
    overTick: -1,
    events: [],
  };
}

interface CreatePlayerArgs {
  id: number;
  slot: number;
  name: string;
  isBot: boolean;
  x: number;
  y: number;
  facing: number;
  colorIndex: number;
}

export function createPlayer(a: CreatePlayerArgs): PlayerState {
  return {
    id: a.id,
    slot: a.slot,
    name: a.name,
    isBot: a.isBot,
    colorIndex: a.colorIndex,

    x: a.x,
    y: a.y,
    vx: 0,
    vy: 0,
    facing: a.facing,

    hp: MAX_HP,
    alive: true,
    deathTick: -1,
    lastHitBy: -1,
    lastHitTick: -1,

    dashEndTick: -1,
    dashDirX: 0,
    dashDirY: 0,
    stealthEndTick: -1,
    burstFireTick: -1,
    cdDash: 0,
    cdStealth: 0,
    cdBurst: 0,
    cdAttack: 0,

    speedBuffEndTick: -1,
    damageBuffEndTick: -1,

    kills: 0,
    damageDealt: 0,
    score: 0,
    lastAckSeq: 0,
  };
}

export function getPlayer(world: World, id: number): PlayerState | undefined {
  // Sloty są gęste i stałe przez cały mecz, więc indeks == id.
  const p = world.players[id];
  return p && p.id === id ? p : world.players.find((q) => q.id === id);
}

export function aliveCount(world: World): number {
  let n = 0;
  for (const p of world.players) if (p.alive) n++;
  return n;
}

export function isStealthed(p: PlayerState, tick: number): boolean {
  return p.alive && tick < p.stealthEndTick;
}

/** Głęboka kopia stanu gracza — używana przez predykcję klienta. */
export function clonePlayer(p: PlayerState): PlayerState {
  const { ai: _ai, ...rest } = p;
  return { ...rest };
}
