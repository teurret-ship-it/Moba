import {
  ARENA_RADIUS,
  PLAYER_RADIUS,
  PICKUP_SPAWN_INTERVAL_TICKS,
  SUPPLY_EVENT_INTERVAL_TICKS,
  WARMUP_TICKS,
  ZONE_START_RADIUS,
} from './constants.ts';
import { getClass, CLASS_IDS, type ClassId } from './classes.ts';
import { baseStats } from './upgrades.ts';
import { generateTerrain, distanceToObstacle, type Obstacle } from './terrain.ts';
import { createObjective } from './objective.ts';
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
  /** Klasa gracza lokalnego. Boty losują własne. */
  localClass?: ClassId;
}

export function createWorld(opts: CreateWorldOptions): World {
  const rng = new Rng(opts.seed);
  const humanCount = opts.humanCount ?? 1;
  const players: PlayerState[] = [];
  const obstacles = generateTerrain(opts.seed);

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

    // Boty losują klasę, żeby lobby nie było jednorodne. Gracz wybiera
    // swoją na ekranie startowym.
    const classId: ClassId = isBot
      ? rng.pick(CLASS_IDS)
      : (opts.localClass ?? 'lowca');

    // Nikt nie startuje w murze: przy zajętym miejscu przesuwamy punkt
    // startowy wzdłuż okręgu, zamiast wypychać postać po pierwszym ticku.
    const spawn = freeSpawn(obstacles, angle, spawnRadius);

    players.push(
      createPlayer({
        id: slot,
        slot,
        name,
        isBot,
        classId,
        x: spawn.x,
        y: spawn.y,
        facing: angle + Math.PI,
        colorIndex: slot,
      }),
    );
  }

  return {
    tick: 0,
    seed: opts.seed,
    obstacles,
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
    decoys: [],
    nextDecoyId: 1,
    objective: createObjective(),
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

/** Punkt startowy wolny od przeszkód, szukany wzdłuż okręgu spawnu. */
function freeSpawn(
  obstacles: readonly Obstacle[],
  angle: number,
  radius: number,
): { x: number; y: number } {
  for (let i = 0; i < 24; i++) {
    // Naprzemiennie w lewo i w prawo od pierwotnego kąta — rozstawienie
    // zostaje równomierne, a nie zsuwa się w jedną stronę.
    const offset = (i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 0.09);
    const a = angle + offset;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (obstacles.every((o) => distanceToObstacle(x, y, o) > o.r + PLAYER_RADIUS + 0.6)) {
      return { x, y };
    }
  }
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

interface CreatePlayerArgs {
  id: number;
  slot: number;
  name: string;
  isBot: boolean;
  classId: ClassId;
  x: number;
  y: number;
  facing: number;
  colorIndex: number;
}

export function createPlayer(a: CreatePlayerArgs): PlayerState {
  const cls = getClass(a.classId);
  return {
    id: a.id,
    slot: a.slot,
    name: a.name,
    isBot: a.isBot,
    colorIndex: a.colorIndex,
    classId: a.classId,

    x: a.x,
    y: a.y,
    vx: 0,
    vy: 0,
    facing: a.facing,

    hp: cls.maxHp,
    maxHp: cls.maxHp,
    alive: true,
    deathTick: -1,
    lastHitBy: -1,
    lastHitTick: -1,

    dashEndTick: -1,
    dashDirX: 0,
    dashDirY: 0,
    dashHits: [],

    stealthEndTick: -1,
    shieldHp: 0,
    shieldEndTick: -1,

    powerFireTick: -1,
    salvoLeft: 0,
    salvoNextTick: -1,
    salvoTargetId: -1,
    ambushReady: false,

    cdMove: 0,
    cdTrick: 0,
    cdPower: 0,
    cdAttack: 0,

    slowEndTick: -1,
    slowMul: 1,

    speedBuffEndTick: -1,
    damageBuffEndTick: -1,

    xp: 0,
    level: 1,
    upgrades: [],
    offer: [],
    offerDeadlineTick: -1,
    stats: baseStats(a.classId),
    impetusEndTick: -1,

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
  return {
    ...rest,
    dashHits: [...p.dashHits],
    upgrades: [...p.upgrades],
    offer: [...p.offer],
    stats: { ...p.stats },
  };
}
