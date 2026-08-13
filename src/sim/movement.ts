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
export function applyMovement(p: PlayerState, input: InputFrame, tick: number): void {
  if (!p.alive) return;

  const cls = getClass(p.classId);

  if (tick < p.dashEndTick) {
    // W trakcie skoku wejście nie ma wpływu — to jest zobowiązanie,
    // a nie sterowany ruch. Dzięki temu skok da się czytać u przeciwnika.
    const move = MOVE_ABILITY[cls.move];
    p.vx = p.dashDirX * move.speed;
    p.vy = p.dashDirY * move.speed;
  } else {
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    const speed = cls.speed * speedMultiplier(p, tick);
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
}

export function speedMultiplier(p: PlayerState, tick: number): number {
  let mul = 1;
  if (tick < p.stealthEndTick) mul *= STEALTH_SPEED_MUL;
  if (tick < p.speedBuffEndTick) mul *= PICKUP_SPEED_MUL;
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
export function tryStartMove(p: PlayerState, input: InputFrame, tick: number): boolean {
  if (!p.alive) return false;
  if (!input.dash) return false;
  if (tick < p.cdMove) return false;
  if (tick < p.dashEndTick) return false;

  const cls = getClass(p.classId);
  const move = MOVE_ABILITY[cls.move];

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
  p.cdMove = tick + move.cooldownTicks;
  p.dashHits.length = 0;
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

/** Czy postać jest w trakcie ruchu, którego nie da się zatrzymać ciałem. */
function isUnstoppable(p: PlayerState, tick: number): boolean {
  if (tick >= p.dashEndTick) return false;
  return MOVE_ABILITY[getClass(p.classId).move].damage > 0;
}
