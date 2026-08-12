import {
  ATTACK_RANGE,
  BURST_RADIUS,
  MAX_HP,
  TICK_HZ,
  WARMUP_TICKS,
} from './constants.ts';
import type { Rng } from './rng.ts';
import type { BotBrain, InputFrame, PlayerState, World } from './types.ts';
import { isStealthed } from './world.ts';

/**
 * AI botów.
 *
 * Sekcja 7 planu: „Bot musi być nie do odróżnienia przez pierwsze 60 s.
 * Bez tego pierwszy gracz wchodzi na pustą arenę i nie wraca."
 *
 * Dlatego bot NIE jest optymalny. Trzy rzeczy robią różnicę i wszystkie
 * są tu celowe:
 *  1. opóźnienie reakcji — decyzje co 200–600 ms, nie co tick,
 *  2. dryf toru — bot nie idzie idealnie prosto do celu,
 *  3. wahanie — losowe krótkie przystanki i zmiany zdania.
 *
 * Bot, który celuje idealnie i skręca natychmiast, czyta się jako bot
 * po kilkunastu sekundach. Bot, który się myli, czyta się jako słaby gracz.
 */

export function createBrain(rng: Rng, tick: number): BotBrain {
  return {
    skill: rng.range(0.35, 1.0),
    nextDecisionTick: tick + rng.int(0, 8),
    targetId: -1,
    waypointX: 0,
    waypointY: 0,
    idleUntilTick: -1,
    mood: 'roam',
    driftPhase: rng.next() * Math.PI * 2,
  };
}

/**
 * Narastanie agresji w czasie rundy.
 *
 * Bez tego wszystkie 12 botów rusza do walki w sekundzie zero i po minucie
 * żyje 4 z 12 — runda nie ma wczesnej fazy, tylko masakrę i dogrywkę.
 * (Zmierzone: `balance.probe.test.ts`.)
 *
 * Ramp odtwarza łuk, który gracze robią sami: najpierw rozejrzyj się i
 * pozbieraj dropy, potem szukaj starcia, na końcu i tak zmusi cię strefa.
 * Przy okazji to jest warunek z sekcji 7 — bot ma być nie do odróżnienia
 * przez pierwsze 60 s, a bot szarżujący od pierwszej sekundy nim nie jest.
 */
const AGGRO_START_TICKS = WARMUP_TICKS + 50 * TICK_HZ;
const AGGRO_FULL_TICKS = WARMUP_TICKS + 140 * TICK_HZ;
const AGGRO_MIN = 0.4;

function aggression(world: World): number {
  if (world.tick <= AGGRO_START_TICKS) return AGGRO_MIN;
  if (world.tick >= AGGRO_FULL_TICKS) return 1;
  const t = (world.tick - AGGRO_START_TICKS) / (AGGRO_FULL_TICKS - AGGRO_START_TICKS);
  return AGGRO_MIN + (1 - AGGRO_MIN) * t;
}

/** Odstęp między decyzjami: słabszy bot myśli wolniej. */
function decisionInterval(brain: BotBrain, rng: Rng): number {
  const base = 0.55 - 0.3 * brain.skill; // 0.55 s → 0.25 s
  return Math.max(2, Math.round((base + rng.range(-0.06, 0.12)) * TICK_HZ));
}

export function computeBotInput(world: World, bot: PlayerState, rng: Rng): InputFrame {
  const brain = bot.ai;
  const input: InputFrame = {
    seq: world.tick,
    moveX: 0,
    moveY: 0,
    dash: false,
    stealth: false,
    burst: false,
  };
  if (!brain || !bot.alive) return input;

  if (world.tick >= brain.nextDecisionTick) {
    brain.nextDecisionTick = world.tick + decisionInterval(brain, rng);
    decide(world, bot, brain, rng);
  }

  // Wahanie: krótki przystanek. Gracze też się zatrzymują bez powodu.
  if (world.tick < brain.idleUntilTick) {
    return input;
  }

  const target = brain.targetId >= 0 ? world.players[brain.targetId] : undefined;
  let goalX = brain.waypointX;
  let goalY = brain.waypointY;

  if (target && target.alive && (brain.mood === 'hunt' || brain.mood === 'flee')) {
    if (brain.mood === 'hunt') {
      // Trzymaj dystans zbliżony do zasięgu ataku, zamiast wchodzić w kontakt.
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const d = Math.hypot(dx, dy) || 1;
      const desired = ATTACK_RANGE * 0.75;
      goalX = target.x - (dx / d) * desired;
      goalY = target.y - (dy / d) * desired;
    } else {
      const dx = bot.x - target.x;
      const dy = bot.y - target.y;
      const d = Math.hypot(dx, dy) || 1;
      goalX = bot.x + (dx / d) * 14;
      goalY = bot.y + (dy / d) * 14;
    }
  }

  // Nie uciekaj poza strefę nawet w panice — to jest samobójstwo,
  // a gracze go nie popełniają (zwykle).
  const goal = pullIntoZone(world, goalX, goalY);

  let dx = goal.x - bot.x;
  let dy = goal.y - bot.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.6) {
    return input;
  }

  dx /= dist;
  dy /= dist;

  // Dryf: powolna sinusoida prostopadła do kierunku marszu. Im słabszy
  // bot, tym bardziej „pływa". To jest ta rzecz, która najbardziej
  // odróżnia ruch bota od ruchu skryptu.
  const drift = Math.sin(world.tick * 0.08 + brain.driftPhase) * (0.34 - 0.24 * brain.skill);
  const px = -dy * drift;
  const py = dx * drift;
  const mx = dx + px;
  const my = dy + py;
  const mlen = Math.hypot(mx, my) || 1;

  input.moveX = mx / mlen;
  input.moveY = my / mlen;

  chooseAbilities(world, bot, brain, target, input, rng);
  return input;
}

function decide(world: World, bot: PlayerState, brain: BotBrain, rng: Rng): void {
  const hpFrac = bot.hp / MAX_HP;
  const distToCenter = Math.hypot(bot.x - world.zone.x, bot.y - world.zone.y);
  const outside = distToCenter > world.zone.radius - 2;

  // Priorytet 1: przeżyć strefę. Bez tego boty giną masowo i mecz
  // kończy się „sam", co od razu zdradza, że przeciwnicy nie są ludźmi.
  if (outside) {
    brain.mood = 'rezone';
    brain.targetId = -1;
    // Cel wewnątrz kręgu, nie dokładnie środek — inaczej wszystkie boty
    // zbiegają się w jeden punkt i widać skrypt.
    const spot = rng.pointInCircle(world.zone.x, world.zone.y, Math.max(2, world.zone.radius * 0.6));
    brain.waypointX = spot.x;
    brain.waypointY = spot.y;
    return;
  }

  const aggro = aggression(world);
  const threat = findThreat(world, bot, brain, aggro);

  // Priorytet 2: uciekać przy niskim HP. Próg zależy od „umiejętności" —
  // słabe boty uciekają za późno, dokładnie jak słabi gracze.
  const fleeThreshold = 0.34 + 0.20 * brain.skill;
  if (threat && hpFrac < fleeThreshold) {
    brain.mood = 'flee';
    brain.targetId = threat.id;
    return;
  }

  // Priorytet 3: apteczka, jeśli poobijany i jest blisko.
  if (hpFrac < 0.62) {
    const heal = nearestPickup(world, bot, 'heal', 26);
    if (heal) {
      brain.mood = 'loot';
      brain.targetId = -1;
      brain.waypointX = heal.x;
      brain.waypointY = heal.y;
      return;
    }
  }

  // Priorytet 4: we wczesnej fazie drop jest ważniejszy niż starcie.
  // Buff zabrany teraz wygrywa walkę za minutę — tak samo rozumuje gracz.
  if (aggro < 0.75) {
    const early = nearestPickup(world, bot, null, 24);
    if (early) {
      brain.mood = 'loot';
      brain.targetId = -1;
      brain.waypointX = early.x;
      brain.waypointY = early.y;
      return;
    }
  }

  // Priorytet 5: cel do zabicia.
  if (threat) {
    brain.mood = 'hunt';
    brain.targetId = threat.id;
    return;
  }

  // Priorytet 6: dowolny drop w pobliżu.
  const loot = nearestPickup(world, bot, null, 20);
  if (loot && rng.bool(0.7)) {
    brain.mood = 'loot';
    brain.targetId = -1;
    brain.waypointX = loot.x;
    brain.waypointY = loot.y;
    return;
  }

  // Priorytet 7: wędruj. Sporadyczne przystanki = wahanie gracza.
  brain.mood = 'roam';
  brain.targetId = -1;
  const spot = rng.pointInCircle(world.zone.x, world.zone.y, Math.max(4, world.zone.radius - 4));
  brain.waypointX = spot.x;
  brain.waypointY = spot.y;
  if (rng.bool(0.16)) {
    brain.idleUntilTick = world.tick + rng.int(4, 14);
  }
}

/**
 * Wybór przeciwnika. Bot widzi tylko to, co widziałby klient —
 * gracze w ukryciu nie istnieją dla AI. To nie jest uprzejmość wobec
 * gracza, tylko konsekwencja sekcji 7: ukryci nie trafiają do widoku.
 */
function findThreat(
  world: World,
  bot: PlayerState,
  brain: BotBrain,
  aggro: number,
): PlayerState | null {
  const searchRange = (16 + 18 * brain.skill) * aggro;
  let best: PlayerState | null = null;
  let bestScore = -Infinity;

  for (const other of world.players) {
    if (other.id === bot.id || !other.alive) continue;
    if (isStealthed(other, world.tick)) continue;

    const d = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (d > searchRange) continue;

    // Bliżej = lepiej, ranny = lepiej. Wagi zależne od skilla:
    // dobry bot dobija rannych, słaby idzie po najbliższym.
    const woundedBonus = (1 - other.hp / MAX_HP) * 30 * brain.skill;
    const score = -d + woundedBonus + (other.id === brain.targetId ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function nearestPickup(
  world: World,
  bot: PlayerState,
  kind: string | null,
  maxDist: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = maxDist;
  for (const item of world.pickups) {
    if (kind && item.kind !== kind) continue;
    const d = Math.hypot(item.x - bot.x, item.y - bot.y);
    if (d < bestD) {
      bestD = d;
      best = { x: item.x, y: item.y };
    }
  }
  return best;
}

function chooseAbilities(
  world: World,
  bot: PlayerState,
  brain: BotBrain,
  target: PlayerState | undefined,
  input: InputFrame,
  rng: Rng,
): void {
  const hpFrac = bot.hp / MAX_HP;
  const distToTarget = target && target.alive
    ? Math.hypot(target.x - bot.x, target.y - bot.y)
    : Infinity;

  // Fala: gdy cel jest w zasięgu wybuchu. Słabsze boty pudłują z timingiem.
  if (world.tick >= bot.cdBurst && distToTarget < BURST_RADIUS * 0.85) {
    if (rng.bool(0.25 + 0.55 * brain.skill)) {
      input.burst = true;
      return;
    }
  }

  // Skok: dogonić uciekającego albo zerwać dystans przy ucieczce.
  if (world.tick >= bot.cdDash) {
    const wantsGap = brain.mood === 'flee' || (hpFrac < 0.3 && distToTarget < 8);
    const wantsClose = brain.mood === 'hunt' && distToTarget > ATTACK_RANGE * 1.4 && distToTarget < 20;
    const needsZone = brain.mood === 'rezone';
    if ((wantsGap || wantsClose || needsZone) && rng.bool(0.2 + 0.5 * brain.skill)) {
      input.dash = true;
      return;
    }
  }

  // Cień: ucieczka albo zasadzka. Słabe boty używają go losowo,
  // co wygląda dokładnie jak marnowanie umiejętności przez człowieka.
  if (world.tick >= bot.cdStealth) {
    const escaping = brain.mood === 'flee' && hpFrac < 0.4;
    const ambushing = brain.mood === 'hunt' && distToTarget > ATTACK_RANGE * 1.5 && distToTarget < 18;
    const wasteful = rng.bool(0.02 * (1 - brain.skill));
    if (escaping || (ambushing && rng.bool(0.3 * brain.skill)) || wasteful) {
      input.stealth = true;
    }
  }
}

function pullIntoZone(world: World, x: number, y: number): { x: number; y: number } {
  const dx = x - world.zone.x;
  const dy = y - world.zone.y;
  const d = Math.hypot(dx, dy);
  const limit = Math.max(2, world.zone.radius - 2.5);
  if (d <= limit) return { x, y };
  const s = limit / d;
  return { x: world.zone.x + dx * s, y: world.zone.y + dy * s };
}
