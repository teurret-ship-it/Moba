import {
  ACCEL,
  ARENA_RADIUS,
  BASE_SPEED,
  DASH_COOLDOWN_TICKS,
  DASH_DURATION_TICKS,
  DASH_SPEED,
  DT,
  FRICTION,
  PICKUP_SPEED_MUL,
  PLAYER_RADIUS,
  STEALTH_SPEED_MUL,
} from './constants.ts';
import type { InputFrame, PlayerState } from './types.ts';

/**
 * Ruch postaci — JEDYNE miejsce, w którym zmienia się pozycja gracza.
 *
 * Ta funkcja jest wywoływana w dwóch miejscach:
 *  1. w symulacji autorytatywnej (`sim.ts`),
 *  2. w predykcji po stronie klienta (`client/prediction.ts`).
 *
 * Jeśli te dwie ścieżki kiedykolwiek się rozjadą, gracz zobaczy „gumkę".
 * Dlatego nie wolno tu dopisać nic, co zależy od pełnego świata.
 */
export function applyMovement(p: PlayerState, input: InputFrame, tick: number): void {
  if (!p.alive) return;

  if (tick < p.dashEndTick) {
    // W trakcie skoku wejście nie ma wpływu — to jest zobowiązanie,
    // a nie sterowany ruch. Dzięki temu skok da się czytać u przeciwnika.
    p.vx = p.dashDirX * DASH_SPEED;
    p.vy = p.dashDirY * DASH_SPEED;
  } else {
    let mx = input.moveX;
    let my = input.moveY;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }

    const speed = BASE_SPEED * speedMultiplier(p, tick);
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
 * Aktywacja skoku. Wydzielona z `applyMovement`, bo klient predykuje
 * skok (jest ruchem), ale NIE predykuje cienia ani fali (są rozstrzygane
 * przez serwer i widoczne dopiero w snapshocie).
 */
export function tryStartDash(p: PlayerState, input: InputFrame, tick: number): boolean {
  if (!p.alive) return false;
  if (!input.dash) return false;
  if (tick < p.cdDash) return false;
  if (tick < p.dashEndTick) return false;

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
  p.dashEndTick = tick + DASH_DURATION_TICKS;
  p.cdDash = tick + DASH_COOLDOWN_TICKS;
  return true;
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Rozpychanie postaci, żeby nie stały w tym samym punkcie. */
export function resolveOverlaps(players: PlayerState[]): void {
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
      const push = (minDist - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      clampToArena(a);
      clampToArena(b);
    }
  }
}
