import { TICK_HZ, WARMUP_TICKS } from './constants.ts';
import { getClass, POWER_ABILITY } from './classes.ts';
import type { Rng } from './rng.ts';
import type { BotBrain, InputFrame, PlayerState, World } from './types.ts';
import { isStealthed } from './world.ts';
import { hasLineOfSight, distanceToObstacle } from './terrain.ts';

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
const AGGRO_FULL_TICKS = WARMUP_TICKS + 155 * TICK_HZ;
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
    pick: -1,
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
      const desired = getClass(bot.classId).attackRange * 0.75;
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

  const steered = steerAroundObstacles(world, bot, mx / mlen, my / mlen);
  input.moveX = steered.x;
  input.moveY = steered.y;

  chooseAbilities(world, bot, brain, target, input, rng);
  return input;
}

function decide(world: World, bot: PlayerState, brain: BotBrain, rng: Rng): void {
  const hpFrac = bot.hp / bot.maxHp;
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
 * Omijanie przeszkód.
 *
 * Nie ma tu szukania ścieżki — bot sprawdza, czy tuż przed nim jest mur,
 * i jeśli tak, ślizga się wzdłuż niego. To wystarcza na okrągłej arenie
 * z rzadkimi przeszkodami, a co ważniejsze wygląda jak człowiek: gracz też
 * nie planuje trasy, tylko odbija się od tego, na co wpadnie.
 */
function steerAroundObstacles(
  world: World,
  bot: PlayerState,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const probe = 3.4;
  const aheadX = bot.x + dx * probe;
  const aheadY = bot.y + dy * probe;

  for (const o of world.obstacles) {
    const clearance = o.r + 1.6;
    if (distanceToObstacle(aheadX, aheadY, o) > clearance) continue;

    // Wybierz tę stronę przeszkody, która jest bliżej obecnego kierunku.
    const leftX = -dy;
    const leftY = dx;
    const leftClear = distanceToObstacle(bot.x + leftX * probe, bot.y + leftY * probe, o);
    const rightClear = distanceToObstacle(bot.x - leftX * probe, bot.y - leftY * probe, o);
    const sign = leftClear >= rightClear ? 1 : -1;

    // Mieszanka: część pierwotnego kierunku plus ślizg wzdłuż przeszkody.
    const mx = dx * 0.35 + sign * leftX * 0.9;
    const my = dy * 0.35 + sign * leftY * 0.9;
    const len = Math.hypot(mx, my) || 1;
    return { x: mx / len, y: my / len };
  }

  return { x: dx, y: dy };
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
    // Zza muru bot nikogo nie widzi — tak samo jak gracz.
    if (!hasLineOfSight(bot.x, bot.y, other.x, other.y, world.obstacles)) continue;

    // Bliżej = lepiej, ranny = lepiej. Wagi zależne od skilla:
    // dobry bot dobija rannych, słaby idzie po najbliższym.
    const woundedBonus = (1 - other.hp / other.maxHp) * 30 * brain.skill;

    // Kara za tłok: cel, który ma już dwóch napastników, jest mniej
    // atrakcyjny. Bez tego pół lobby zbiegało się na jedną ofiarę i ta
    // ginęła w sekundy niezależnie od tempa rampy agresji — wczesna faza
    // rundy wyglądała jak egzekucja, a nie jak potyczki.
    // Gracze też tak nie grają: darmowy dobitek owszem, ale trzeci
    // w kolejce do tego samego celu szuka sobie innego.
    const crowd = countAttackers(world, other.id, bot.id);
    const crowdPenalty = crowd >= 2 ? 22 * (crowd - 1) : 0;

    const score = -d + woundedBonus - crowdPenalty + (other.id === brain.targetId ? 6 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

/** Ilu innych botów poluje w tej chwili na wskazany cel. */
function countAttackers(world: World, targetId: number, exceptId: number): number {
  let n = 0;
  for (const p of world.players) {
    if (!p.alive || p.id === exceptId) continue;
    if (p.ai && p.ai.mood === 'hunt' && p.ai.targetId === targetId) n++;
  }
  return n;
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
  const cls = getClass(bot.classId);
  const hpFrac = bot.hp / bot.maxHp;
  const distToTarget = target && target.alive
    ? Math.hypot(target.x - bot.x, target.y - bot.y)
    : Infinity;

  // --- Slot MOC ---
  // Każda moc ma inny zasięg i inny moment, w którym warto ją wydać.
  if (world.tick >= bot.cdPower) {
    const def = POWER_ABILITY[cls.power];
    let wants = false;

    if (cls.power === 'fala') {
      wants = distToTarget < POWER_ABILITY.fala.radius * 0.8;
    } else if (cls.power === 'salwa') {
      // Salwa opłaca się z dystansu — z bliska bot i tak bije automatem.
      wants = distToTarget < POWER_ABILITY.salwa.range * 0.95;
    } else {
      // Rozdarcie: z bliska, a z ukrycia zawsze — to jest cała zasadzka Widma.
      // Uzbrojona zasadzka jest warta podwójnych obrażeń, więc bot nie
      // marnuje jej na cel poza stożkiem.
      const inRange = distToTarget < POWER_ABILITY.rozdarcie.range * 0.8;
      const armed = bot.ambushReady && isStealthed(bot, world.tick);
      wants = inRange && (armed || rng.bool(0.6));
    }
    void def;

    if (wants && rng.bool(0.25 + 0.55 * brain.skill)) {
      input.burst = true;
      return;
    }
  }

  // --- Slot RUCH ---
  if (world.tick >= bot.cdMove) {
    const needsZone = brain.mood === 'rezone';
    let wants = needsZone;

    if (cls.move === 'szarza') {
      // Kolos szarżuje DO walki, nie z niej. Ucieczka szarżą to marnotrawstwo,
      // bo jest wolniejsza od Skoku i ciągnie go przez wrogów.
      wants ||= brain.mood === 'hunt' && distToTarget > cls.attackRange && distToTarget < 22;
    } else {
      // Skok i Mgnienie służą obu kierunkom.
      const wantsGap = brain.mood === 'flee' || (hpFrac < 0.3 && distToTarget < 8);
      const wantsClose =
        brain.mood === 'hunt' && distToTarget > cls.attackRange * 1.4 && distToTarget < 20;
      wants ||= wantsGap || wantsClose;
    }

    if (wants && rng.bool(0.2 + 0.5 * brain.skill)) {
      input.dash = true;
      return;
    }
  }

  // --- Slot SZTUCZKA ---
  if (world.tick >= bot.cdTrick) {
    if (cls.trick === 'tarcza') {
      // Tarcza ma sens tylko wtedy, gdy coś w nią uderzy. Bot stawia ją,
      // gdy jest w kontakcie i obrywa — nie prewencyjnie na pustej mapie.
      const underFire = world.tick - bot.lastHitTick < 1.5 * TICK_HZ;
      const engaged = distToTarget < cls.attackRange * 1.6;
      if ((underFire || (engaged && hpFrac < 0.7)) && rng.bool(0.3 + 0.6 * brain.skill)) {
        input.stealth = true;
      }
      return;
    }

    // Cień: ucieczka albo zasadzka. Słabe boty używają go losowo,
    // co wygląda dokładnie jak marnowanie umiejętności przez człowieka.
    const escaping = brain.mood === 'flee' && hpFrac < 0.4;
    const ambushing =
      brain.mood === 'hunt' && distToTarget > cls.attackRange * 1.5 && distToTarget < 18;
    // Klasa, której moc premiuje zasadzkę, wchodzi w ukrycie ZANIM podejdzie.
    // Bez tego bot-Widmo używa Cienia wyłącznie do ucieczki i nigdy nie gra
    // tym, co stanowi całą jego ekonomię.
    //
    // Warunek konieczny: moc musi być gotowa. W ukryciu auto-atak milczy,
    // więc wejście w Cień bez Rozdarcia na podorędziu to dobrowolne
    // 3,5 sekundy zerowych obrażeń.
    const assassin = cls.power === 'rozdarcie';
    const powerReady = world.tick >= bot.cdPower;
    const ambushChance = assassin && powerReady ? 0.55 + 0.4 * brain.skill : 0.3 * brain.skill;
    const wasteful = rng.bool(0.02 * (1 - brain.skill));
    if (escaping || (ambushing && rng.bool(ambushChance)) || wasteful) {
      input.stealth = true;
    }
  }
}

/**
 * Ograniczenie celu do wnętrza strefy — z zapasem, nie do samej krawędzi.
 *
 * Zmierzone: bot uciekający przed przeciwnikiem biegł dokładnie na skraj
 * kręgu, a kurczenie strefy zastawało go tam i zabijało. Najbardziej
 * dotykało to klasy, która ucieka najczęściej (Widmo: 65 śmierci od strefy
 * na 40 rund wobec 1 u Kolosa), przez co wyglądało na problem balansu klas,
 * a było zwykłym błędem nawigacji.
 *
 * Zapas jest procentowy, nie stały: pod koniec rundy krąg ma promień 7,
 * więc „minus 2,5" zostawiało margines, który znikał przy pierwszym
 * zacieśnieniu.
 */
function pullIntoZone(world: World, x: number, y: number): { x: number; y: number } {
  const dx = x - world.zone.x;
  const dy = y - world.zone.y;
  const d = Math.hypot(dx, dy);
  const limit = Math.max(2, Math.min(world.zone.radius - 2.5, world.zone.radius * 0.8));
  if (d <= limit) return { x, y };
  const s = limit / d;
  return { x: world.zone.x + dx * s, y: world.zone.y + dy * s };
}
