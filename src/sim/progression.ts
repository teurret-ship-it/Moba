import { TICK_HZ } from './constants.ts';
import type { Rng } from './rng.ts';
import type { PlayerState, World } from './types.ts';
import {
  availableUpgrades,
  computeStats,
  OFFER_DEADLINE_TICKS,
  OFFER_SIZE,
  UPGRADES,
  XP_PER_SECOND,
  xpForLevel,
  type UpgradeId,
} from './upgrades.ts';

/**
 * Progresja w trakcie rundy: doświadczenie, awanse, wybór ulepszeń.
 *
 * Wszystko rozstrzyga serwer. Klient dostaje wystawioną ofertę w snapshocie
 * i odsyła wyłącznie indeks karty — nigdy identyfikatora ulepszenia i tym
 * bardziej nigdy jego efektu.
 */

export function grantXp(world: World, playerId: number, amount: number): void {
  const p = world.players[playerId];
  if (!p || !p.alive || amount <= 0) return;
  p.xp += amount;
}

/** Doświadczenie za samo trwanie — naliczane co sekundę, nie co tick. */
export function stepSurvivalXp(world: World): void {
  if (world.tick % TICK_HZ !== 0) return;
  for (const p of world.players) {
    if (p.alive) p.xp += XP_PER_SECOND;
  }
}

export function stepProgression(world: World, rng: Rng): void {
  for (const p of world.players) {
    if (!p.alive) continue;

    // Awans: tylko gdy nie ma już wystawionej oferty. Kolejkowanie
    // dwóch wyborów naraz byłoby nieczytelne na telefonie.
    if (p.offer.length === 0 && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level += 1;
      p.offer = rollOffer(p, rng);
      p.offerDeadlineTick = world.tick + OFFER_DEADLINE_TICKS;
      world.events.push({ type: 'levelUp', player: p.id, level: p.level, tick: world.tick });

      // Brak dostępnych ulepszeń (wszystko wyczerpane) — awans bez wyboru.
      if (p.offer.length === 0) p.offerDeadlineTick = -1;
    }

    // Termin minął — bierzemy pierwszą kartę. Gracz, który nie zdążył,
    // nie zostaje bez niczego, a runda nie czeka.
    if (p.offer.length > 0 && world.tick >= p.offerDeadlineTick) {
      applyPick(world, p, 0);
    }
  }
}

/**
 * Wybór karty przez gracza.
 *
 * Indeks jest walidowany wobec oferty wystawionej przez serwer — klient
 * nie może „wybrać" ulepszenia, którego mu nie zaproponowano.
 */
export function pickUpgrade(world: World, p: PlayerState, index: number): void {
  if (p.offer.length === 0) return;
  if (!Number.isInteger(index) || index < 0 || index >= p.offer.length) return;
  applyPick(world, p, index);
}

function applyPick(world: World, p: PlayerState, index: number): void {
  const id = p.offer[index];
  p.offer = [];
  p.offerDeadlineTick = -1;
  if (!id) return;

  p.upgrades.push(id);
  const before = p.stats;
  p.stats = computeStats(p.classId, p.upgrades);

  // Wzrost maksimum zdrowia leczy o tyle samo — inaczej „+22 HP" przy
  // pełnym pasku byłoby wyborem, który nic nie daje w chwili wzięcia.
  const gained = p.stats.maxHp - before.maxHp;
  if (gained > 0) p.hp = Math.min(p.stats.maxHp, p.hp + gained);
  p.maxHp = p.stats.maxHp;

  world.events.push({ type: 'upgradePicked', player: p.id, upgrade: id, tick: world.tick });
}

/**
 * Losowanie oferty.
 *
 * Boty i gracze dostają z tej samej puli — bot, który zawsze bierze to samo,
 * jest rozpoznawalny (sekcja 7), więc jego wybór też jest losowy, tylko
 * z lekką preferencją klasową.
 */
function rollOffer(p: PlayerState, rng: Rng): UpgradeId[] {
  const pool = availableUpgrades(p.upgrades);
  const out: UpgradeId[] = [];
  const taken = new Set<UpgradeId>();

  while (out.length < OFFER_SIZE && taken.size < pool.length) {
    const candidate = rng.pick(pool);
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    out.push(candidate);
  }
  return out;
}

/**
 * Wybór bota — natychmiastowy, ale nie optymalny.
 *
 * Bot bierze kartę od razu (człowiek potrzebuje chwili, więc bot z opóźnieniem
 * wyglądałby dziwnie w statystykach, a nie w rozgrywce — tego i tak nie widać).
 * Preferencja jest lekka: wojownik chętniej bierze zdrowie, zabójca obrażenia.
 */
export function botPick(p: PlayerState, rng: Rng): number {
  if (p.offer.length === 0) return -1;

  const weights = p.offer.map((id) => {
    let w = 1;
    if (p.classId === 'kolos' && (id === 'wytrzymalosc' || id === 'regeneracja')) w = 2.2;
    if (p.classId === 'widmo' && (id === 'sila' || id === 'wampiryzm' || id === 'wytrzymalosc')) w = 2.2;
    if (p.classId === 'lowca' && (id === 'zasieg' || id === 'zwinnosc')) w = 2.2;
    // Drugie życie jest silne dla każdego — boty też to „widzą".
    if (id === 'drugie_zycie') w *= 1.8;
    return w;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return i;
  }
  return 0;
}

/** Nazwa ulepszenia do killfeeda / tablicy wyników. */
export function upgradeName(id: UpgradeId): string {
  return UPGRADES[id].name;
}
