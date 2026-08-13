import {
  PICKUP_BUFF_DURATION_TICKS,
  PICKUP_HEAL_AMOUNT,
  PICKUP_MAX_ACTIVE,
  PICKUP_RADIUS,
  PICKUP_SPAWN_INTERVAL_TICKS,
  PLAYER_RADIUS,
  SUPPLY_EVENT_INTERVAL_TICKS,
  SUPPLY_EVENT_PICKUPS,
  SUPPLY_EVENT_WARN_TICKS,
} from './constants.ts';
import type { Rng } from './rng.ts';
import type { PickupKind, World } from './types.ts';

const KINDS: readonly PickupKind[] = ['heal', 'speed', 'damage'];

export function stepPickups(world: World, rng: Rng): void {
  spawnRoutinePickups(world, rng);
  stepSupplyEvent(world, rng);
  collectPickups(world);
}

function spawnRoutinePickups(world: World, rng: Rng): void {
  if (world.tick < world.nextPickupSpawnTick) return;
  world.nextPickupSpawnTick = world.tick + PICKUP_SPAWN_INTERVAL_TICKS;
  if (world.pickups.length >= PICKUP_MAX_ACTIVE) return;

  // Dropy spawnują się tylko w strefie — inaczej gra zachęca do wychodzenia
  // poza krąg, co jest dokładnie odwrotnością tego, co robi strefa.
  spawnPickupInZone(world, rng, rng.pick(KINDS));
}

/**
 * Zdarzenie mapy: zrzut zaopatrzenia. Ogłaszany z wyprzedzeniem, żeby
 * ściągnąć graczy w jedno miejsce — to jest generator starć w środkowej
 * fazie rundy, gdy strefa jeszcze nie dociska.
 */
function stepSupplyEvent(world: World, rng: Rng): void {
  const warnTick = world.nextSupplyTick - SUPPLY_EVENT_WARN_TICKS;

  if (world.tick === warnTick && world.supplyWarnedTick !== warnTick) {
    const spot = rng.pointInCircle(world.zone.x, world.zone.y, world.zone.radius * 0.55);
    world.supplyX = spot.x;
    world.supplyY = spot.y;
    world.supplyWarnedTick = warnTick;
    world.events.push({ type: 'supplyWarn', x: spot.x, y: spot.y, tick: world.tick });
    return;
  }

  if (world.tick < world.nextSupplyTick) return;
  world.nextSupplyTick = world.tick + SUPPLY_EVENT_INTERVAL_TICKS;

  world.events.push({ type: 'supplyDrop', x: world.supplyX, y: world.supplyY, tick: world.tick });
  for (let i = 0; i < SUPPLY_EVENT_PICKUPS; i++) {
    const a = (i / SUPPLY_EVENT_PICKUPS) * Math.PI * 2 + rng.next();
    const r = rng.range(1.2, 3.2);
    world.pickups.push({
      id: world.nextPickupId++,
      kind: rng.pick(KINDS),
      x: world.supplyX + Math.cos(a) * r,
      y: world.supplyY + Math.sin(a) * r,
      spawnTick: world.tick,
    });
  }
}

export function spawnPickupInZone(world: World, rng: Rng, kind: PickupKind): void {
  const spot = rng.pointInCircle(world.zone.x, world.zone.y, Math.max(3, world.zone.radius - 3));
  world.pickups.push({
    id: world.nextPickupId++,
    kind,
    x: spot.x,
    y: spot.y,
    spawnTick: world.tick,
  });
}

function collectPickups(world: World): void {
  const reach = PICKUP_RADIUS + PLAYER_RADIUS;
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const item = world.pickups[i];
    if (!item) continue;

    for (const p of world.players) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - item.x, p.y - item.y) > reach) continue;
      // Leczenie przy pełnym HP nie jest podnoszone — inaczej gracze
      // zbierają apteczki „na zapas" i drop przestaje być decyzją.
      if (item.kind === 'heal' && p.hp >= p.maxHp) continue;

      applyPickup(world, p.id, item.kind);
      world.events.push({
        type: 'pickup',
        player: p.id,
        kind: item.kind,
        x: item.x,
        y: item.y,
        tick: world.tick,
      });
      world.pickups.splice(i, 1);
      break;
    }
  }
}

export function applyPickup(world: World, playerId: number, kind: PickupKind): void {
  const p = world.players[playerId];
  if (!p) return;
  switch (kind) {
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + PICKUP_HEAL_AMOUNT);
      break;
    case 'speed':
      p.speedBuffEndTick = world.tick + PICKUP_BUFF_DURATION_TICKS;
      break;
    case 'damage':
      p.damageBuffEndTick = world.tick + PICKUP_BUFF_DURATION_TICKS;
      break;
  }
}

export { SUPPLY_EVENT_INTERVAL_TICKS };
