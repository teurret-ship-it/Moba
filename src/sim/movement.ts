import {
  ACCEL,
  ARENA_RADIUS,
  DT,
  FRICTION,
  PICKUP_SPEED_MUL,
  PLAYER_RADIUS,
  STEALTH_SPEED_MUL,
} from './constants.ts';
import { getClass, MOVE_ABILITY } from './classes.ts';
import { pushOutOfObstacles, type Obstacle } from './terrain.ts';
import type { InputFrame, PlayerState } from './types.ts';

/**
 * Ruch postaci — JEDYNE miejsce, w którym zmienia się pozycja gracza.
 *
 * Ta funkcja jest wywoływana w dwóch miejscach:
 *  1. w symulacji autorytatywnej (`sim.ts`),
 *  2. w predykcji po stronie klienta (`client/prediction.ts`).
 *
 * Jeśli te dwie ścieżki kiedykolwiek się rozjadą, gracz zobaczy „gumkę".
 * Dlatego nie wolno tu dopisać nic, co zależy od pełnego świata — w tym
 * obrażeń od Szarży, które rozstrzyga serwer w `combat.ts`.
 */
export function applyMovement(
  p: PlayerState,
  input: InputFrame,
  tick: number,
  obstacles: readonly Obstacle[] = [],
): void {
  if (!p.alive) return;

  const cls = getClass(p.classId);

  if (tick < p.dashEndTick) {
    // W trakcie skoku wejście nie ma wpływu — to jest zobowiązanie,
    // a nie sterowany ruch. Dzięki temu skok da się czytać u przeciwnika.
    const move = MOVE_ABILITY[cls.move];
    p.vx = p.dashDirX * move.speed;
    p.vy = p.dashDirY * move.speed;
  } else {
    const speed = p.stats.speed * speedMultiplier(p, tick);

    // Koniec ruchu ze slotu RUCH: ucinamy nadmiarowy pęd.
    //
    // Bez tego prędkość skoku zostaje w postaci i wygasa dopiero przez
    // hamowanie (ACCEL). Dla Skoku (42) to ułamek sekundy, ale Mgnienie ma
    // prędkość 210 — postać leciała jeszcze ~3 s po teleporcie i wynosiło ją
    // średnio 7,5 jednostki poza kurczący się krąg. Zmierzone: 74 śmierci
    // Widma od strefy na 40 rund wobec 3 u Kolosa, w 63 przypadkach w trybie
    // „wracam do strefy" — postać wiedziała, że jest poza, i nie potrafiła
    // zawrócić, bo wciąż leciała.
    //
    // Slot RUCH ma być przemieszczeniem, nie darmowym pędem.
    if (tick === p.dashEndTick) {
      const carried = Math.hypot(p.vx, p.vy);
      if (carried > speed) {
        const s = speed / carried;
        p.vx *= s;
        p.vy *= s;
      }
    }

    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    const targetVx = mx * speed;
    const targetVy = my * speed;

    const rate = len > 0.001 ? ACCEL : FRICTION;
    p.vx = approach(p.vx, targetVx, rate * DT);
    p.vy = approach(p.vy, targetVy, rate * DT);

    if (len > 0.001) {
      p.facing = Math.atan2(my, mx);
    }
  }

  p.x += p.vx * DT;
  p.y += p.vy * DT;

  clampToArena(p);

  // Teren jest statyczny i identyczny po obu stronach, więc wypchnięcie
  // z przeszkody nie generuje rozjazdu predykcji.
  //
  // Teleport przechodzi PRZEZ mur: gdy Mgnienie ląduje w przeszkodzie,
  // wypychamy postać do przodu, a nie do najbliższej krawędzi. To jedyna
  // rzecz, która obraca teren na korzyść Widma — osłona z natury pomaga
  // temu, kto chce zerwać kontakt, a zabójca musi go nawiązać.
  const move = MOVE_ABILITY[cls.move];
  const throughWalls = tick <= p.dashEndTick && move.speed > 100;
  pushOutOfObstacles(
    p,
    obstacles,
    throughWalls ? { x: p.dashDirX, y: p.dashDirY } : undefined,
  );
}

export function speedMultiplier(p: PlayerState, tick: number): number {
  let mul = 1;
  if (tick < p.stealthEndTick) mul *= STEALTH_SPEED_MUL;
  if (tick < p.speedBuffEndTick) mul *= PICKUP_SPEED_MUL;
  // Impet — ulepszenie: przyspieszenie tuż po użyciu slotu RUCH.
  if (tick < p.impetusEndTick) mul *= p.stats.impetusMul;
  // Sidła — spowolnienie. Mnożone na końcu, więc nie da się go „przebić"
  // dropem prędkości do zera efektu.
  if (tick < p.slowEndTick) mul *= p.slowMul;
  return mul;
}

/** Arena jest okrągła i zamknięta — nie ma wypadania poza mapę. */
export function clampToArena(p: PlayerState): void {
  const limit = ARENA_RADIUS - PLAYER_RADIUS;
  const d = Math.hypot(p.x, p.y);
  if (d > limit) {
    const s = limit / d;
    p.x *= s;
    p.y *= s;
    // Wygaś składową prędkości skierowaną na zewnątrz, żeby nie „kleiło" ściany.
    const nx = p.x / limit;
    const ny = p.y / limit;
    const outward = p.vx * nx + p.vy * ny;
    if (outward > 0) {
      p.vx -= outward * nx;
      p.vy -= outward * ny;
    }
  }
}

/**
 * Aktywacja umiejętności ze slotu RUCH (Skok / Szarża / Mgnienie).
 *
 * Wydzielona z `applyMovement`, bo klient predykuje TYLKO ruch. Obrażenia
 * Szarży dolicza serwer — klient przewiduje, gdzie postać wyląduje, nie
 * kogo po drodze rozjedzie.
 */
export function tryStartMove(
  p: PlayerState,
  input: InputFrame,
  tick: number,
  /**
   * Pozycja własnego Zwodu, jeśli stoi. Podawana osobno, bo predykcja
   * klienta nie zna całego świata — ale własną kopię zna zawsze, więc
   * Zamiana pozostaje w pełni przewidywalna.
   */
  ownDecoy?: { x: number; y: number } | null,
): boolean {
  if (!p.alive) return false;
  if (!input.dash) return false;
  if (tick < p.cdMove) return false;
  if (tick < p.dashEndTick) return false;

  const cls = getClass(p.classId);
  const move = MOVE_ABILITY[cls.move];

  // Zamiana z postawionym Zwodem: teleport na jego miejsce, niezależnie od
  // odległości. To nie jest ruch ciągły, więc nie ma czasu trwania ani pędu.
  if (cls.move === 'zamiana' && ownDecoy) {
    p.x = ownDecoy.x;
    p.y = ownDecoy.y;
    p.vx = 0;
    p.vy = 0;
    p.cdMove = tick + Math.round(move.cooldownTicks * p.stats.cooldownMul);
    clampToArena(p);
    return true;
  }

  let dx = input.moveX;
  let dy = input.moveY;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    // Brak kierunku z gałki — skacz tam, gdzie patrzysz.
    dx = Math.cos(p.facing);
    dy = Math.sin(p.facing);
  } else {
    dx /= len;
    dy /= len;
  }

  p.dashDirX = dx;
  p.dashDirY = dy;
  p.facing = Math.atan2(dy, dx);
  p.dashEndTick = tick + move.durationTicks;
  p.cdMove = tick + Math.round(move.cooldownTicks * p.stats.cooldownMul);
  p.dashHits.length = 0;
  if (p.stats.impetusTicks > 0) {
    p.impetusEndTick = tick + move.durationTicks + p.stats.impetusTicks;
  }
  return true;
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Rozpychanie postaci, żeby nie stały w tym samym punkcie. */
export function resolveOverlaps(players: PlayerState[], tick: number): void {
  const minDist = PLAYER_RADIUS * 2;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a || !a.alive) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b || !b.alive) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= minDist || d < 1e-6) continue;

      // Postać w trakcie ruchu z rozpędu nie daje się odepchnąć — inaczej
      // Kolos zatrzymywałby się na pierwszym napotkanym ciele, a Szarża
      // przestałaby być wejściem w grupę.
      const aFixed = isUnstoppable(a, tick);
      const bFixed = isUnstoppable(b, tick);
      if (aFixed && bFixed) continue;

      // Gdy tylko jedno jest nieruchome, drugie ustępuje za oboje.
      const push = (minDist - d) / (aFixed !== bFixed ? 1 : 2);
      const nx = dx / d;
      const ny = dy / d;
      if (!aFixed) {
        a.x -= nx * push;
        a.y -= ny * push;
        clampToArena(a);
      }
      if (!bFixed) {
        b.x += nx * push;
        b.y += ny * push;
        clampToArena(b);
      }
    }
  }
}

/**
 * Ponowne wypchnięcie z terenu po rozpychaniu się postaci.
 *
 * Kolejność w kroku symulacji to ruch → teren → rozpychanie postaci, a to
 * ostatnie potrafi wepchnąć kogoś w mur. Bez tej poprawki gracz w tłoku
 * przy ścianie zanurzał się w niej o ułamek jednostki i mógł zza niej
 * strzelać. Teren jest twardszy niż ciała — on ma ostatnie słowo.
 */
export function settleIntoTerrain(
  players: PlayerState[],
  obstacles: readonly Obstacle[],
): void {
  if (obstacles.length === 0) return;
  for (const p of players) {
    if (!p.alive) continue;
    pushOutOfObstacles(p, obstacles);
  }
}

/** Czy postać jest w trakcie ruchu, którego nie da się zatrzymać ciałem. */
function isUnstoppable(p: PlayerState, tick: number): boolean {
  if (tick >= p.dashEndTick) return false;
  return MOVE_ABILITY[getClass(p.classId).move].damage > 0;
}
