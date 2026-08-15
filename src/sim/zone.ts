import {
  DT,
  TICK_HZ,
  WARMUP_TICKS,
  ZONE_DPS_BASE,
  ZONE_DPS_RAMP,
  ZONE_END_RADIUS,
  ZONE_HOLD_SECONDS,
  ZONE_SHRINK_END_SECONDS,
  ZONE_START_RADIUS,
} from './constants.ts';
import { applyDamage } from './combat.ts';
import type { World } from './types.ts';

/**
 * Kurcząca się strefa. Jej jedyne zadanie: gwarantować, że mecz kończy
 * się w ~4 minuty niezależnie od tego, jak pasywnie grają uczestnicy.
 * Bez tego „last man standing" potrafi trwać w nieskończoność.
 */

const HOLD_TICKS = WARMUP_TICKS + ZONE_HOLD_SECONDS * TICK_HZ;
const SHRINK_END_TICKS = WARMUP_TICKS + ZONE_SHRINK_END_SECONDS * TICK_HZ;

export function zoneRadiusAtTick(tick: number, startMul = 1): number {
  const start = ZONE_START_RADIUS * startMul;
  if (tick <= HOLD_TICKS) return start;
  if (tick >= SHRINK_END_TICKS) return ZONE_END_RADIUS;
  const t = (tick - HOLD_TICKS) / (SHRINK_END_TICKS - HOLD_TICKS);
  // Ease-in: na początku ledwo zauważalne, pod koniec dociska.
  const eased = t * t * (3 - 2 * t);
  return start + (ZONE_END_RADIUS - start) * eased;
}

export function stepZone(world: World): void {
  const prev = world.zone.radius;
  const startMul = world.modifier.zoneStartMul;
  const next = zoneRadiusAtTick(world.tick, startMul);
  world.zone.radius = next;
  world.zone.nextRadius = zoneRadiusAtTick(world.tick + 10 * TICK_HZ, startMul);
  const shrinking = next < prev - 1e-9;

  // Zdarzenie tylko na krawędzi zmiany stanu — HUD ma pokazać komunikat raz.
  if (shrinking && !world.zone.shrinking) {
    world.events.push({ type: 'zoneShrink', radius: next, tick: world.tick });
  }
  world.zone.shrinking = shrinking;

  // Obrażenia poza strefą rosną z czasem — pod koniec meczu stanie poza
  // kręgiem musi być wyrokiem, a nie kosztem, który da się przeczekać.
  const progress = clamp01((world.tick - HOLD_TICKS) / Math.max(1, SHRINK_END_TICKS - HOLD_TICKS));
  const dps = ZONE_DPS_BASE + ZONE_DPS_RAMP * progress;

  for (const p of world.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - world.zone.x, p.y - world.zone.y);
    if (d <= world.zone.radius) continue;
    // Źródło -1 = środowisko. Zabójstwo przez strefę nie liczy się nikomu.
    applyDamage(world, p, dps * DT, -1);
  }
}

export function isOutsideZone(world: World, x: number, y: number): boolean {
  return Math.hypot(x - world.zone.x, y - world.zone.y) > world.zone.radius;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
