import {
  ATTACK_COOLDOWN_TICKS,
  ATTACK_DAMAGE,
  ATTACK_RANGE,
  BURST_COOLDOWN_TICKS,
  BURST_DAMAGE,
  BURST_KNOCKBACK,
  BURST_RADIUS,
  BURST_WINDUP_TICKS,
  DT,
  MAX_HP,
  PICKUP_DAMAGE_MUL,
  REGEN_DELAY_TICKS,
  REGEN_PER_SECOND,
  SCORE_PER_KILL,
  STEALTH_BREAK_DELAY_TICKS,
  STEALTH_COOLDOWN_TICKS,
  STEALTH_DURATION_TICKS,
} from './constants.ts';
import type { InputFrame, PlayerState, World } from './types.ts';
import { isStealthed } from './world.ts';

/**
 * Cała walka jest rozstrzygana tutaj, po stronie autorytatywnej.
 * Klient nie zgłasza trafień — zgłasza wyłącznie intencję (sekcja 3).
 */

export function damageMultiplier(p: PlayerState, tick: number): number {
  return tick < p.damageBuffEndTick ? PICKUP_DAMAGE_MUL : 1;
}

/**
 * Wybór celu auto-ataku: najbliższy żywy, widoczny przeciwnik w zasięgu.
 *
 * „Widoczny" jest kluczowe — gracz w ukryciu nie może być celem, bo
 * inaczej stealth nie daje nic poza kosmetyką.
 */
export function findAttackTarget(
  world: World,
  attacker: PlayerState,
  range = ATTACK_RANGE,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = range;
  for (const other of world.players) {
    if (other.id === attacker.id || !other.alive) continue;
    if (isStealthed(other, world.tick)) continue;
    const d = Math.hypot(other.x - attacker.x, other.y - attacker.y);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

export function stepAutoAttacks(world: World): void {
  for (const p of world.players) {
    if (!p.alive) continue;
    if (world.tick < p.cdAttack) continue;
    // W trakcie skoku nie atakujemy — skok to okno na ucieczkę, nie DPS.
    if (world.tick < p.dashEndTick) continue;

    const target = findAttackTarget(world, p);
    if (!target) continue;

    p.cdAttack = world.tick + ATTACK_COOLDOWN_TICKS;
    p.facing = Math.atan2(target.y - p.y, target.x - p.x);

    // Atak zdradza pozycję: ukrycie kończy się z małym opóźnieniem,
    // dzięki czemu zasadzka z ukrycia ma sens, ale nie jest darmowa.
    if (isStealthed(p, world.tick)) {
      p.stealthEndTick = world.tick + STEALTH_BREAK_DELAY_TICKS;
    }

    const dmg = ATTACK_DAMAGE * damageMultiplier(p, world.tick);
    applyDamage(world, target, dmg, p.id);
  }
}

export function tryStartStealth(world: World, p: PlayerState, input: InputFrame): void {
  if (!p.alive || !input.stealth) return;
  if (world.tick < p.cdStealth) return;
  if (isStealthed(p, world.tick)) return;

  p.stealthEndTick = world.tick + STEALTH_DURATION_TICKS;
  p.cdStealth = world.tick + STEALTH_COOLDOWN_TICKS;
  world.events.push({ type: 'stealthIn', player: p.id, x: p.x, y: p.y, tick: world.tick });
}

export function tryStartBurst(world: World, p: PlayerState, input: InputFrame): void {
  if (!p.alive || !input.burst) return;
  if (world.tick < p.cdBurst) return;
  if (p.burstFireTick >= 0) return;

  p.burstFireTick = world.tick + BURST_WINDUP_TICKS;
  p.cdBurst = world.tick + BURST_COOLDOWN_TICKS;
}

/** Detonacja fal, których windup już minął. */
export function stepBursts(world: World): void {
  for (const p of world.players) {
    if (p.burstFireTick < 0) continue;
    if (world.tick < p.burstFireTick) continue;

    p.burstFireTick = -1;
    if (!p.alive) continue;

    world.events.push({ type: 'burst', player: p.id, x: p.x, y: p.y, tick: world.tick });

    // Fala wybija z ukrycia — to jest jej druga rola poza obrażeniami.
    if (isStealthed(p, world.tick)) {
      p.stealthEndTick = world.tick;
      world.events.push({ type: 'stealthOut', player: p.id, x: p.x, y: p.y, tick: world.tick });
    }

    const dmg = BURST_DAMAGE * damageMultiplier(p, world.tick);
    for (const other of world.players) {
      if (other.id === p.id || !other.alive) continue;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > BURST_RADIUS) continue;

      // Fala trafia także ukrytych — nie musisz ich widzieć, żeby ich zdmuchnąć.
      if (isStealthed(other, world.tick)) {
        other.stealthEndTick = world.tick;
        world.events.push({ type: 'stealthOut', player: other.id, x: other.x, y: other.y, tick: world.tick });
      }

      // Obrażenia maleją z odległością — środek fali boli, krawędź odpycha.
      const falloff = 1 - (d / BURST_RADIUS) * 0.55;
      applyDamage(world, other, dmg * falloff, p.id);

      if (d > 1e-4) {
        const push = BURST_KNOCKBACK * (1 - d / BURST_RADIUS);
        other.vx += (dx / d) * push;
        other.vy += (dy / d) * push;
      }
    }
  }
}

/**
 * Regeneracja poza walką. Licznik resetuje KAŻDE otrzymane obrażenie,
 * łącznie ze strefą — stanie poza kręgiem nigdy się nie „opłaca przeczekać".
 */
export function stepRegen(world: World): void {
  for (const p of world.players) {
    if (!p.alive || p.hp >= MAX_HP) continue;
    if (p.lastHitTick >= 0 && world.tick - p.lastHitTick < REGEN_DELAY_TICKS) continue;
    p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_SECOND * DT);
  }
}

export function applyDamage(
  world: World,
  target: PlayerState,
  amount: number,
  sourceId: number,
): void {
  if (!target.alive || amount <= 0) return;

  const dealt = Math.min(amount, target.hp);
  target.hp -= dealt;
  target.lastHitBy = sourceId;
  target.lastHitTick = world.tick;

  if (sourceId >= 0) {
    const src = world.players[sourceId];
    if (src) src.damageDealt += dealt;
  }

  world.events.push({
    type: 'damage',
    target: target.id,
    amount: dealt,
    source: sourceId,
    x: target.x,
    y: target.y,
    tick: world.tick,
  });

  if (target.hp <= 0) {
    killPlayer(world, target, sourceId);
  }
}

export function killPlayer(world: World, victim: PlayerState, killerId: number): void {
  victim.hp = 0;
  victim.alive = false;
  victim.deathTick = world.tick;
  victim.vx = 0;
  victim.vy = 0;
  victim.stealthEndTick = -1;
  victim.dashEndTick = -1;
  victim.burstFireTick = -1;

  const killer = killerId >= 0 && killerId !== victim.id ? world.players[killerId] : undefined;
  if (killer) {
    killer.kills += 1;
    killer.score += SCORE_PER_KILL;
  }

  world.events.push({
    type: 'kill',
    killer: killer ? killer.id : -1,
    victim: victim.id,
    tick: world.tick,
  });
}
