import { TICK_HZ, WARMUP_TICKS } from './constants.ts';
import type { Rng } from './rng.ts';
import type { ObjectiveState, PlayerState, World } from './types.ts';
import { hasLineOfSight } from './terrain.ts';
import { isStealthed } from './world.ts';
import { xpForLevel } from './upgrades.ts';

/**
 * Rdzeń — punkt przejęcia, czyli struktura środkowej fazy rundy.
 *
 * Problem: między pierwszymi potyczkami a domknięciem przez strefę runda
 * nie miała własnego pytania. Zrzuty zaopatrzenia dawały powód, żeby gdzieś
 * pójść, ale nie powód, żeby się o coś bić — drop podnosi pierwszy, kto
 * dobiegnie, i sprawa się kończy.
 *
 * Rdzeń działa inaczej i to jest cały zamysł:
 *
 *  - **stoisz w miejscu, żeby go przejąć** — a stanie w miejscu na arenie
 *    jest najdroższą rzeczą, jaką można zrobić,
 *  - **dwóch graczy zatrzymuje postęp** — nie wygrywa szybszy, tylko ten,
 *    kto zostanie sam,
 *  - **jest ogłaszany wszystkim** — więc tworzy umówione miejsce starcia,
 *    zamiast nagradzać tego, kto akurat był blisko,
 *  - **nagrodą jest awans**, czyli mechanika, którą gracz już zna: karta
 *    ulepszenia. To jednocześnie realna szansa na odrobienie strat, bo
 *    przegrywający ma najwięcej powodów, żeby zaryzykować.
 */

/** Kiedy pojawia się pierwszy Rdzeń i co ile kolejne. */
const FIRST_SPAWN_TICKS = WARMUP_TICKS + 52 * TICK_HZ;
const RESPAWN_INTERVAL_TICKS = 62 * TICK_HZ;
/** Ostrzeżenie przed pojawieniem się — czas na dobiegnięcie. */
const WARN_TICKS = 6 * TICK_HZ;
/** Nieprzejęty Rdzeń znika po tym czasie, żeby nie wisiał do końca rundy. */
const LIFETIME_TICKS = 40 * TICK_HZ;

/**
 * Rdzeń czeka, aż stawka się przerzedzi.
 *
 * Punkt sporny przy dwunastu żywych nie jest starciem, tylko młynkiem:
 * wszyscy zbiegają się w jedno miejsce i wybijają nawzajem w kilkanaście
 * sekund. Zmierzone — jeden z dziesięciu przebiegów kończył się po 56 s.
 *
 * Rdzeń ma strukturyzować ŚRODEK rundy, a nie przyspieszać jej początek,
 * więc pojawia się dopiero, gdy zostało tylu graczy, że walka o punkt jest
 * walką, a nie kotłem.
 */
const MAX_ALIVE_FOR_SPAWN = 8;

/** Promień, w którym trzeba stać. */
export const OBJECTIVE_RADIUS = 4.6;
/** Ile sekund nieprzerwanego stania daje przejęcie. */
const CAPTURE_TICKS = Math.round(4.5 * TICK_HZ);
/** Utracony postęp na tick, gdy nikogo nie ma w środku. */
const DECAY_PER_TICK = 0.6;

export function createObjective(): ObjectiveState {
  return {
    active: false,
    x: 0,
    y: 0,
    progress: 0,
    holderId: -1,
    contested: false,
    nextSpawnTick: FIRST_SPAWN_TICKS,
    warnedTick: -1,
    expiresTick: -1,
  };
}

export function stepObjective(world: World, rng: Rng): void {
  const o = world.objective;

  if (!o.active) {
    // Zapowiedź: gracze muszą mieć czas dobiec, inaczej wygrywa przypadek.
    const warnAt = o.nextSpawnTick - WARN_TICKS;
    if (world.tick === warnAt && o.warnedTick !== warnAt && countAlive(world) <= MAX_ALIVE_FOR_SPAWN) {
      const spot = pickSpot(world, rng);
      o.x = spot.x;
      o.y = spot.y;
      o.warnedTick = warnAt;
      world.events.push({ type: 'objectiveWarn', x: o.x, y: o.y, tick: world.tick });
      return;
    }

    if (world.tick < o.nextSpawnTick) return;

    // Za tłoczno — odkładamy, zamiast rezygnować. Zapowiedź też się cofa,
    // żeby nie ogłaszać czegoś, co się nie pojawi.
    if (countAlive(world) > MAX_ALIVE_FOR_SPAWN) {
      o.nextSpawnTick = world.tick + 5 * TICK_HZ;
      o.warnedTick = -1;
      return;
    }

    o.active = true;
    o.progress = 0;
    o.holderId = -1;
    o.contested = false;
    o.expiresTick = world.tick + LIFETIME_TICKS;
    o.nextSpawnTick = world.tick + RESPAWN_INTERVAL_TICKS;
    world.events.push({ type: 'objectiveSpawn', x: o.x, y: o.y, tick: world.tick });
    return;
  }

  // Rdzeń poza kurczącą się strefą przestaje być decyzją, a staje się
  // pułapką — wtedy znika przedwcześnie.
  const outsideZone =
    Math.hypot(o.x - world.zone.x, o.y - world.zone.y) > world.zone.radius - OBJECTIVE_RADIUS;

  if (world.tick >= o.expiresTick || outsideZone) {
    deactivate(o, world.tick);
    return;
  }

  // Kto stoi w środku. Ukryci nie liczą się jako obecni — inaczej Cień
  // dawałby darmowe przejęcie, którego nikt nie może zakwestionować.
  const inside: PlayerState[] = [];
  for (const p of world.players) {
    if (!p.alive || isStealthed(p, world.tick)) continue;
    if (Math.hypot(p.x - o.x, p.y - o.y) > OBJECTIVE_RADIUS) continue;
    inside.push(p);
  }

  o.contested = inside.length > 1;

  if (inside.length === 1) {
    const holder = inside[0]!;
    // Zmiana zdobywcy zeruje postęp: przejęcie ma być nagrodą za utrzymanie
    // miejsca, a nie za dobiegnięcie na ostatnią sekundę cudzej pracy.
    if (o.holderId !== holder.id) {
      o.holderId = holder.id;
      o.progress = 0;
    }
    o.progress += 1;

    if (o.progress >= CAPTURE_TICKS) {
      capture(world, holder);
      deactivate(o, world.tick);
    }
    return;
  }

  // Pusto albo tłok — postęp się cofa, ale wolniej niż narastał.
  if (inside.length === 0) {
    o.progress = Math.max(0, o.progress - DECAY_PER_TICK);
    if (o.progress === 0) o.holderId = -1;
  }
}

function capture(world: World, holder: PlayerState): void {
  // Nagrodą jest awans — mechanika, którą gracz już zna. Doświadczenie
  // dosypujemy do progu, żeby karta pojawiła się natychmiast, zamiast
  // wprowadzać drugi, osobny rodzaj nagrody.
  holder.xp += xpForLevel(holder.level);
  world.events.push({
    type: 'objectiveCaptured',
    player: holder.id,
    x: holder.x,
    y: holder.y,
    tick: world.tick,
  });
}

function deactivate(o: ObjectiveState, tick: number): void {
  if (o.active) {
    o.active = false;
    o.progress = 0;
    o.holderId = -1;
    o.contested = false;
    o.expiresTick = -1;
    void tick;
  }
}

/**
 * Miejsce Rdzenia.
 *
 * Nie w środku areny (tam i tak wszyscy trafią przez strefę) i nie w murze.
 * Cel: punkt, do którego trzeba świadomie pójść, a nie taki, na którym
 * ktoś przypadkiem stoi.
 */
function pickSpot(world: World, rng: Rng): { x: number; y: number } {
  const radius = Math.max(6, world.zone.radius * 0.62);

  for (let attempt = 0; attempt < 24; attempt++) {
    const spot = rng.pointInCircle(world.zone.x, world.zone.y, radius);

    // Musi być miejsce na stanie i na walkę wokół — Rdzeń wciśnięty
    // między filary premiowałby tego, kto zdąży zająć jedyne wejście.
    const clear = world.obstacles.every(
      (ob) => hasLineOfSight(spot.x, spot.y, spot.x + OBJECTIVE_RADIUS, spot.y, [ob]),
    );
    if (!clear) continue;

    const blocked = world.obstacles.some((ob) => {
      const dx = spot.x - (ob.x1 + ob.x2) / 2;
      const dy = spot.y - (ob.y1 + ob.y2) / 2;
      return Math.hypot(dx, dy) < ob.r + OBJECTIVE_RADIUS + 1.5;
    });
    if (!blocked) return spot;
  }

  return rng.pointInCircle(world.zone.x, world.zone.y, radius);
}

function countAlive(world: World): number {
  let n = 0;
  for (const p of world.players) if (p.alive) n++;
  return n;
}

/** Ułamek postępu przejęcia 0..1 — do paska na HUD i pierścienia w scenie. */
export function objectiveProgressFraction(o: ObjectiveState): number {
  return Math.max(0, Math.min(1, o.progress / CAPTURE_TICKS));
}
