import {
  ARENA_RADIUS,
  DT,
  PICKUP_DAMAGE_MUL,
  PLAYER_RADIUS,
  REGEN_DELAY_TICKS,
  REGEN_PER_SECOND,
  SCORE_PER_KILL,
  STEALTH_BREAK_DELAY_TICKS,
} from './constants.ts';
import {
  getClass,
  MOVE_ABILITY,
  POWER_ABILITY,
  TRICK_ABILITY,
} from './classes.ts';
import { computeStats, XP_PER_DAMAGE, XP_PER_KILL } from './upgrades.ts';
import { grantXp } from './progression.ts';
import type { InputFrame, PlayerState, World } from './types.ts';
import { isStealthed } from './world.ts';
import { hasLineOfSight, pushOutOfObstacles } from './terrain.ts';

/**
 * Cała walka jest rozstrzygana tutaj, po stronie autorytatywnej.
 * Klient nie zgłasza trafień — zgłasza wyłącznie intencję (sekcja 3).
 */

export function damageMultiplier(p: PlayerState, tick: number): number {
  let mul = tick < p.damageBuffEndTick ? PICKUP_DAMAGE_MUL : 1;
  // Furia — ulepszenie: im bliżej śmierci, tym mocniejszy cios.
  if (p.hp / p.stats.maxHp < p.stats.furyThreshold) mul *= p.stats.furyMul;
  return mul;
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
  range = attacker.stats.attackRange,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = range;
  for (const other of world.players) {
    if (other.id === attacker.id || !other.alive) continue;
    if (isStealthed(other, world.tick)) continue;
    const d = Math.hypot(other.x - attacker.x, other.y - attacker.y);
    if (d >= bestDist) continue;
    // Nie da się trafić przez mur — to jest to, co czyni osłonę decyzją,
    // a nie dekoracją.
    if (!hasLineOfSight(attacker.x, attacker.y, other.x, other.y, world.obstacles)) continue;
    bestDist = d;
    best = other;
  }
  return best;
}

export function stepAutoAttacks(world: World): void {
  for (const p of world.players) {
    if (!p.alive) continue;
    if (world.tick < p.cdAttack) continue;
    // W trakcie ruchu ze slotu RUCH nie atakujemy — to jest okno na
    // przemieszczenie, nie darmowy DPS.
    if (world.tick < p.dashEndTick) continue;

    // W ukryciu auto-atak MILCZY.
    //
    // Atak jest automatyczny (wymóg jednej ręki), więc gracz nie może go
    // powstrzymać. Gdyby strzelał w ukryciu, sam by się zdradzał w chwili,
    // gdy podchodzi do celu — a zasadzka Widma stawała się nierozgrywalna.
    // Ukrycie jest teraz stanem decyzji: wychodzisz z niego własnym ciosem,
    // w wybranym momencie, a nie dlatego, że wróg wszedł w zasięg.
    if (isStealthed(p, world.tick)) continue;

    const target = findAttackTarget(world, p);
    const decoyHit = findDecoyTarget(world, p, p.stats.attackRange);

    // Zwód konkuruje z graczami o uwagę na tych samych zasadach: liczy się
    // odległość. Gdyby był traktowany inaczej, przestałby zmyłką być.
    const targetDist = target ? Math.hypot(target.x - p.x, target.y - p.y) : Infinity;
    if (decoyHit && decoyHit.dist < targetDist) {
      p.cdAttack = world.tick + p.stats.attackCooldownTicks;
      p.facing = Math.atan2(decoyHit.decoy.y - p.y, decoyHit.decoy.x - p.x);
      decoyHit.decoy.hp -= p.stats.attackDamage * damageMultiplier(p, world.tick);
      continue;
    }

    if (!target) continue;

    p.cdAttack = world.tick + p.stats.attackCooldownTicks;
    p.facing = Math.atan2(target.y - p.y, target.x - p.x);

    applyDamage(world, target, p.stats.attackDamage * damageMultiplier(p, world.tick), p.id);
  }
}

// --- Slot SZTUCZKA -----------------------------------------------------------

export function tryStartTrick(world: World, p: PlayerState, input: InputFrame): void {
  if (!p.alive || !input.stealth) return;
  if (world.tick < p.cdTrick) return;

  const trick = getClass(p.classId).trick;

  if (trick === 'cien') {
    if (isStealthed(p, world.tick)) return;
    const def = TRICK_ABILITY.cien;
    p.stealthEndTick = world.tick + def.durationTicks + p.stats.stealthBonusTicks;
    p.cdTrick = world.tick + Math.round(def.cooldownTicks * p.stats.cooldownMul);
    // Wejście w ukrycie uzbraja zasadzkę — pierwszy cios po wyjściu
    // liczy się podwójnie dla Rozdarcia.
    p.ambushReady = true;
    world.events.push({ type: 'stealthIn', player: p.id, x: p.x, y: p.y, tick: world.tick });
    return;
  }

  if (trick === 'zwod') {
    const def = TRICK_ABILITY.zwod;
    // Jeden Zwód naraz — poprzedni znika. Inaczej Kuglarz zapełniłby arenę
    // kopiami i przestałoby to być zmyłką, a stało się ścianą.
    for (let i = world.decoys.length - 1; i >= 0; i--) {
      if (world.decoys[i]!.ownerId === p.id) world.decoys.splice(i, 1);
    }
    // Kopia leci PRZED siebie, nie staje pod nogami.
    //
    // Wcześniej stawała dokładnie w miejscu właściciela i to wyglądało na
    // czystszy projekt („zdradzasz miejsce, w którym byłeś"), ale odbierało
    // sens drugiej połowie kitu. Pomiar: na 6807 tickach, w których bot-Kuglarz
    // miał kopię i gotową Zamianę, opłacalna zamiana istniała w 0,9% z nich.
    // Mediana różnicy odległości (kopia→cel) − (ja→cel) wynosiła 0,2 — kopia
    // stała tam, gdzie ja, więc zamiana z nią nie zmieniała niczego.
    //
    // Kopia leci TAM, DOKĄD IDZIESZ — a gdy stoisz, tam, gdzie patrzysz.
    //
    // Pierwsza wersja rzutu szła zawsze za `facing`, czyli w stronę
    // przeciwnika, i to naprawiło combo wejściowe („wróg bije w kopię, ty
    // lądujesz mu za plecami"), ale odebrało Kuglarzowi jedyną ucieczkę:
    // zamiana zawsze ciągnęła go w stronę zagrożenia. Klasa ginęła 15–22 s
    // wcześniej od reszty stawki (70 s wobec 85–92 s) przy wsp. 0,64.
    //
    // Kierunek ruchu rozstrzyga to jedną regułą i bez trybu: uciekasz —
    // kopia zostaje na twojej drodze ucieczki i zamiana wyrywa cię z kontaktu;
    // nacierasz — kopia ląduje między wami i zamiana jest wejściem.
    // Zobowiązanie zostaje: kopia jest nieruchomym punktem, który zdradza,
    // gdzie zamierzasz być.
    // Kopię też da się rzucić celowo: przeciągnięcie po przycisku wygrywa
    // z kierunkiem marszu. Bez tego Kuglarz jako jedyny nie miałby dostępu
    // do ręcznego celowania, a to jego kit jest o miejscu na planszy.
    const aim = resolveAimNoTarget(p, input);
    const dirX = aim.x;
    const dirY = aim.y;
    const spot = { x: p.x + dirX * def.throwDistance, y: p.y + dirY * def.throwDistance, vx: 0, vy: 0 };
    const far = Math.hypot(spot.x, spot.y);
    const limit = ARENA_RADIUS - PLAYER_RADIUS;
    if (far > limit) {
      spot.x *= limit / far;
      spot.y *= limit / far;
    }
    // Kopia w murze byłaby nie do trafienia, a zamiana z nią wsadzałaby
    // właściciela w przeszkodę.
    pushOutOfObstacles(spot, world.obstacles);

    world.decoys.push({
      id: world.nextDecoyId++,
      ownerId: p.id,
      x: spot.x,
      y: spot.y,
      hp: def.hp + p.stats.decoyBonusHp,
      maxHp: def.hp + p.stats.decoyBonusHp,
      colorIndex: p.colorIndex,
      classId: p.classId,
      endTick: world.tick + def.durationTicks + p.stats.decoyBonusTicks,
      cdAttack: world.tick + def.attackCooldownTicks,
    });
    p.cdTrick = world.tick + Math.round(def.cooldownTicks * p.stats.cooldownMul);
    world.events.push({ type: 'decoySpawn', player: p.id, x: spot.x, y: spot.y, tick: world.tick });
    return;
  }

  // Tarcza
  const def = TRICK_ABILITY.tarcza;
  if (p.shieldHp > 0 && world.tick < p.shieldEndTick) return;
  p.shieldHp = def.absorb + p.stats.shieldBonusAbsorb;
  p.shieldEndTick = world.tick + def.durationTicks;
  p.cdTrick = world.tick + Math.round(def.cooldownTicks * p.stats.cooldownMul);
  world.events.push({ type: 'shieldUp', player: p.id, x: p.x, y: p.y, tick: world.tick });
}

/** Wygaszenie tarczy po upływie czasu — bez tego trwałaby do rozbicia. */
export function stepShields(world: World): void {
  for (const p of world.players) {
    if (p.shieldHp <= 0) continue;
    if (world.tick < p.shieldEndTick) continue;
    p.shieldHp = 0;
  }
}

// --- Celowanie ---------------------------------------------------------------

/**
 * Rozstrzygnięcie kierunku umiejętności.
 *
 * Standard rynkowy tego gatunku na telefonie: tapnięcie = celowanie
 * automatyczne, przeciągnięcie = ręczne. Obie ścieżki schodzą się tutaj,
 * po stronie serwera, bo klient przysyła co najwyżej WEKTOR, a nigdy
 * gotowego celu ani trafienia.
 *
 * Kolejność jest ta sama, co w grach, z których jest wzięta:
 *
 *  1. **wektor od gracza** — przeciągnął, więc wie, czego chce,
 *  2. **automat na najbliższego widocznego wroga** w zasięgu umiejętności,
 *  3. **kierunek marszu** — odpowiednik ustawienia „skok w stronę ruchu",
 *  4. **kierunek patrzenia** — ostatnia deska ratunku, żeby przycisk nigdy
 *     nie okazał się martwy.
 *
 * Automat celuje w zasięgu SAMEJ UMIEJĘTNOŚCI, nie auto-ataku: inaczej
 * Rozdarcie o zasięgu 7,5 celowałoby wyłącznie w cele bliższe niż 6,0
 * i wyglądałoby na zepsute.
 */
export function resolveAim(
  world: World,
  p: PlayerState,
  input: InputFrame,
  range: number,
): { x: number; y: number } {
  const len = Math.hypot(input.aimX, input.aimY);
  // Wektor od klienta nie jest rozkazem — serwer go normalizuje.
  if (len > 0.2) return { x: input.aimX / len, y: input.aimY / len };

  const target = findAttackTarget(world, p, range);
  if (target) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  const moveLen = Math.hypot(input.moveX, input.moveY);
  if (moveLen > 0.1) return { x: input.moveX / moveLen, y: input.moveY / moveLen };

  return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
}

/**
 * Celowanie bez naprowadzania na wroga.
 *
 * Dla Zwodu i slotu RUCH automat na najbliższego przeciwnika byłby szkodliwy:
 * uciekający gracz dostawałby kopię (albo skok) prosto w stronę zagrożenia.
 * Kolejność jest więc krótsza: przeciągnięcie, potem kierunek marszu,
 * na końcu kierunek patrzenia.
 */
export function resolveAimNoTarget(p: PlayerState, input: InputFrame): { x: number; y: number } {
  const aimLen = Math.hypot(input.aimX, input.aimY);
  if (aimLen > 0.2) return { x: input.aimX / aimLen, y: input.aimY / aimLen };
  const moveLen = Math.hypot(input.moveX, input.moveY);
  if (moveLen > 0.1) return { x: input.moveX / moveLen, y: input.moveY / moveLen };
  return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
}

// --- Slot MOC ----------------------------------------------------------------

export function tryStartPower(world: World, p: PlayerState, input: InputFrame): void {
  if (!p.alive || !input.burst) return;
  if (world.tick < p.cdPower) return;
  if (p.powerFireTick >= 0 || p.salvoLeft > 0) return;

  const power = getClass(p.classId).power;

  if (power === 'salwa') {
    const def = POWER_ABILITY.salwa;
    const target = aimedTarget(world, p, input, def.range);
    // Salwa bez celu nie odpala — nie marnujemy odnowienia na powietrze.
    if (!target) return;
    p.salvoLeft = def.shots + p.stats.salvoBonusShots;
    p.salvoNextTick = world.tick;
    p.salvoTargetId = target.id;
    p.cdPower = world.tick + Math.round(def.cooldownTicks * p.stats.cooldownMul);
    return;
  }

  const def = POWER_ABILITY[power];
  const windup = def.windupTicks;
  const cooldown = def.cooldownTicks;

  // Rozdarcie jest stożkiem, więc kierunek jest całą jego treścią. Fala
  // i Sidła są okręgami wokół postaci — tam celowanie niczego nie zmienia
  // i udawanie, że zmienia, byłoby kłamstwem interfejsu.
  //
  // Kierunek zapamiętujemy TERAZ, a nie odczytujemy przy detonacji: między
  // wciśnięciem a wyjściem ciosu mija zwłoka, a w tym czasie auto-atak
  // przestawia `facing` na własny cel. Bez tego ręczne celowanie nie
  // działało dokładnie wtedy, gdy jest potrzebne — w trakcie walki.
  if (power === 'rozdarcie') {
    const aim = resolveAim(world, p, input, POWER_ABILITY.rozdarcie.range);
    p.powerFacing = Math.atan2(aim.y, aim.x);
  }

  // Sidła są rzucane, nie wybuchają pod nogami.
  //
  // Standard gatunku dla obszarowej kontroli: pole stawia się TAM, gdzie
  // przeciwnik będzie, a nie tam, gdzie stoisz. Krąg wokół siebie miał sens
  // dla Fali (Kolos wchodzi w tłum i wybija), ale dla Kuglarza — klasy o
  // miejscu na planszy — odbierał umiejętności całą treść: żeby kogoś
  // spowolnić, trzeba było najpierw do niego podejść.
  if (power === 'sidla') {
    const def = POWER_ABILITY.sidla;
    const aim = resolveAim(world, p, input, def.throwRange);
    const target = findAttackTarget(world, p, def.throwRange);
    // Tapnięcie rzuca w cel (jeśli jest), przeciągnięcie na pełny dystans
    // we wskazaną stronę.
    const manual = Math.hypot(input.aimX, input.aimY) > 0.2;
    const reach = !manual && target
      ? Math.min(def.throwRange, Math.hypot(target.x - p.x, target.y - p.y))
      : def.throwRange;
    p.powerX = p.x + aim.x * reach;
    p.powerY = p.y + aim.y * reach;
  }

  p.powerFireTick = world.tick + windup;
  p.cdPower = world.tick + Math.round(cooldown * p.stats.cooldownMul);
}

/**
 * Cel Salwy: ręcznie wskazany, jeśli gracz przeciągnął, inaczej najbliższy.
 *
 * „Ręcznie wskazany" znaczy tu: najbliższy prawidłowy cel do KIERUNKU, który
 * gracz pokazał — a nie dowolny punkt. Salwa trafia w postać, nie w ziemię,
 * więc celowanie wybiera ofiarę, nie współrzędne.
 */
function aimedTarget(
  world: World,
  p: PlayerState,
  input: InputFrame,
  range: number,
): PlayerState | null {
  const len = Math.hypot(input.aimX, input.aimY);
  if (len <= 0.2) return findAttackTarget(world, p, range);

  const ax = input.aimX / len;
  const ay = input.aimY / len;
  let best: PlayerState | null = null;
  let bestScore = -Infinity;

  for (const other of world.players) {
    if (other.id === p.id || !other.alive) continue;
    if (isStealthed(other, world.tick)) continue;
    const dx = other.x - p.x;
    const dy = other.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > range || d < 1e-4) continue;
    if (!hasLineOfSight(p.x, p.y, other.x, other.y, world.obstacles)) continue;
    // Zgodność kierunku waży więcej niż odległość: gracz pokazał, w którą
    // stronę strzela, i ma dostać to, a nie to, co bliżej.
    const align = (dx / d) * ax + (dy / d) * ay;
    if (align < 0.35) continue;
    const score = align * 2 - d / range;
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }

  return best ?? findAttackTarget(world, p, range);
}

/** Detonacja mocy, których windup już minął, oraz kolejne strzały Salwy. */
export function stepPowers(world: World): void {
  for (const p of world.players) {
    stepSalvo(world, p);

    if (p.powerFireTick < 0) continue;
    if (world.tick < p.powerFireTick) continue;

    p.powerFireTick = -1;
    if (!p.alive) continue;

    const power = getClass(p.classId).power;
    if (power === 'fala') fireBurst(world, p);
    else if (power === 'rozdarcie') fireRend(world, p);
    else if (power === 'sidla') fireSnare(world, p);
  }
}

function stepSalvo(world: World, p: PlayerState): void {
  if (p.salvoLeft <= 0) return;
  if (!p.alive) {
    p.salvoLeft = 0;
    return;
  }
  if (world.tick < p.salvoNextTick) return;

  const def = POWER_ABILITY.salwa;
  const target = world.players[p.salvoTargetId];

  // Cel zginął, uciekł albo zniknął w ukryciu — salwa się urywa.
  // To jest cena za zasięg: Salwa nagradza wybór momentu.
  if (
    !target ||
    !target.alive ||
    isStealthed(target, world.tick) ||
    Math.hypot(target.x - p.x, target.y - p.y) > def.range * 1.25
  ) {
    p.salvoLeft = 0;
    return;
  }

  p.salvoLeft -= 1;
  p.salvoNextTick = world.tick + def.intervalTicks;
  p.facing = Math.atan2(target.y - p.y, target.x - p.x);

  // Salwa wychodzi z ukrycia — z małym opóźnieniem, żeby pierwszy strzał
  // wciąż liczył się jako zasadzka.
  if (isStealthed(p, world.tick)) {
    p.stealthEndTick = world.tick + STEALTH_BREAK_DELAY_TICKS;
  }

  world.events.push({
    type: 'salvo',
    player: p.id,
    x: p.x,
    y: p.y,
    target: target.id,
    tick: world.tick,
  });
  applyDamage(world, target, def.damagePerShot * damageMultiplier(p, world.tick), p.id);
}

function fireBurst(world: World, p: PlayerState): void {
  const def = POWER_ABILITY.fala;
  world.events.push({
    type: 'burst',
    player: p.id,
    x: p.x,
    y: p.y,
    radius: def.radius,
    tick: world.tick,
  });

  // Fala wybija z ukrycia — to jest jej druga rola poza obrażeniami.
  breakStealth(world, p);

  const dmg = def.damage * damageMultiplier(p, world.tick);
  for (const other of world.players) {
    if (other.id === p.id || !other.alive) continue;
    const dx = other.x - p.x;
    const dy = other.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > def.radius) continue;
    if (!hasLineOfSight(p.x, p.y, other.x, other.y, world.obstacles)) continue;

    // Fala trafia także ukrytych — nie musisz ich widzieć, żeby ich zdmuchnąć.
    breakStealth(world, other);

    // Obrażenia maleją z odległością — środek fali boli, krawędź odpycha.
    const falloff = 1 - (d / def.radius) * 0.55;
    applyDamage(world, other, dmg * falloff, p.id);

    if (d > 1e-4) {
      const push = def.knockback * (1 - d / def.radius);
      other.vx += (dx / d) * push;
      other.vy += (dy / d) * push;
    }
  }
}

/**
 * Rozdarcie — stożek przed postacią.
 *
 * Trafia także ukrytych, ale nie ujawnia ich celowaniem: to cios na oślep
 * w wybranym kierunku, a nie namierzanie.
 */
function fireRend(world: World, p: PlayerState): void {
  const def = POWER_ABILITY.rozdarcie;
  const facing = p.powerFacing;
  // Postać obraca się w stronę własnego ciosu — inaczej sylwetka pokazywałaby
  // co innego niż stożek obrażeń.
  p.facing = facing;
  world.events.push({
    type: 'rend',
    player: p.id,
    x: p.x,
    y: p.y,
    facing,
    tick: world.tick,
  });

  const ambush = p.ambushReady && isStealthed(p, world.tick);
  breakStealth(world, p);

  const mul =
    damageMultiplier(p, world.tick) *
    (ambush ? def.ambushMultiplier + p.stats.ambushBonus : 1);
  if (ambush) p.ambushReady = false;

  for (const other of world.players) {
    if (other.id === p.id || !other.alive) continue;
    const dx = other.x - p.x;
    const dy = other.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > def.range) continue;

    // Postać stojąca w kontakcie zawsze jest w stożku — inaczej Rozdarcie
    // gubiłoby cele przyklejone do pleców.
    if (d > PLAYER_RADIUS * 2) {
      const angle = Math.atan2(dy, dx);
      if (Math.abs(angleDiff(angle, p.facing)) > def.halfAngle) continue;
    }
    if (!hasLineOfSight(p.x, p.y, other.x, other.y, world.obstacles)) continue;

    breakStealth(world, other);
    applyDamage(world, other, def.damage * mul, p.id);
  }
}

/**
 * Sidła — obszarowe spowolnienie, bez obrażeń.
 *
 * Narzędzie kontroli, nie zabijania: pozwala uciec albo dogonić, ale samo
 * nikogo nie kładzie. Dlatego nie wybija z ukrycia i nie przerywa niczego —
 * jedyne, co robi, to odbiera przeciwnikowi wybór, gdzie będzie za sekundę.
 */
function fireSnare(world: World, p: PlayerState): void {
  const def = POWER_ABILITY.sidla;
  const cx = p.powerX;
  const cy = p.powerY;
  world.events.push({
    type: 'snare',
    player: p.id,
    x: cx,
    y: cy,
    radius: def.radius,
    tick: world.tick,
  });

  for (const other of world.players) {
    if (other.id === p.id || !other.alive) continue;
    const d = Math.hypot(other.x - cx, other.y - cy);
    if (d > def.radius) continue;
    // Widoczność liczona od RZUCAJĄCEGO, nie od środka pola: inaczej dałoby
    // się spowalniać zza muru, którego się nie widzi.
    if (!hasLineOfSight(p.x, p.y, other.x, other.y, world.obstacles)) continue;

    other.slowEndTick = world.tick + def.durationTicks + p.stats.snareBonusTicks;
    other.slowMul = Math.max(0.25, def.slowMul - p.stats.snareSlowBonus);
  }
}

/** Wygaszanie Zwodów po upływie czasu. */
export function stepDecoys(world: World): void {
  for (let i = world.decoys.length - 1; i >= 0; i--) {
    const d = world.decoys[i]!;
    const owner = world.players[d.ownerId];
    // Kopia znika razem z właścicielem — inaczej zostawałaby na mapie
    // jako duch, którego nikt nie może rozliczyć.
    if (world.tick >= d.endTick || d.hp <= 0 || !owner || !owner.alive) {
      world.events.push({ type: 'decoyBreak', x: d.x, y: d.y, tick: world.tick });
      world.decoys.splice(i, 1);
      continue;
    }

    // Kopia STRZELA.
    //
    // Standard gatunku dla klonów jest jednoznaczny: klon bije, tylko słabiej.
    // I to jest dokładnie ta rzecz, której Kuglarzowi brakowało — jako jedyna
    // klasa nie ma mocy zadającej obrażenia i w każdym pomiarze miał najniższe
    // eliminacje ORAZ najkrótsze przeżycie w stawce. Kopia, która tylko
    // pochłania ciosy, jest kosztem przeciwnika, ale nie jest groźbą; kopia,
    // która strzela, zmusza go do decyzji — bić w nią czy w ciebie.
    //
    // Obrażenia idą na konto WŁAŚCICIELA: to on je zdobył, stawiając kopię
    // w dobrym miejscu, i to on ma dostać za nie doświadczenie.
    if (world.tick < d.cdAttack) continue;
    const def = TRICK_ABILITY.zwod;
    const target = findAttackTargetAt(world, d.x, d.y, owner, def.attackRange);
    if (!target) continue;
    d.cdAttack = world.tick + def.attackCooldownTicks;
    applyDamage(
      world,
      target,
      owner.stats.attackDamage * def.damageShare * damageMultiplier(owner, world.tick),
      owner.id,
    );
  }
}

/** Wybór celu z DOWOLNEGO punktu — używany przez Zwód, który stoi osobno. */
function findAttackTargetAt(
  world: World,
  x: number,
  y: number,
  owner: PlayerState,
  range: number,
): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDist = range;
  for (const other of world.players) {
    if (other.id === owner.id || !other.alive) continue;
    if (isStealthed(other, world.tick)) continue;
    const d = Math.hypot(other.x - x, other.y - y);
    if (d >= bestDist) continue;
    if (!hasLineOfSight(x, y, other.x, other.y, world.obstacles)) continue;
    bestDist = d;
    best = other;
  }
  return best;
}

/**
 * Najbliższy Zwód w zasięgu — cel auto-ataku na równi z graczami.
 *
 * To jest cały sens Zwodu: dla atakującego jest nieodróżnialny od postaci,
 * więc pochłania cios, który miał trafić gdzie indziej.
 */
export function findDecoyTarget(
  world: World,
  attacker: PlayerState,
  range: number,
): { decoy: (typeof world.decoys)[number]; dist: number } | null {
  let best: (typeof world.decoys)[number] | null = null;
  let bestDist = range;
  for (const d of world.decoys) {
    if (d.ownerId === attacker.id) continue;
    const dist = Math.hypot(d.x - attacker.x, d.y - attacker.y);
    if (dist >= bestDist) continue;
    if (!hasLineOfSight(attacker.x, attacker.y, d.x, d.y, world.obstacles)) continue;
    bestDist = dist;
    best = d;
  }
  return best ? { decoy: best, dist: bestDist } : null;
}

/** Obrażenia od Szarży — zadawane każdemu mijanemu wrogowi raz na szarżę. */
export function stepChargeContact(world: World): void {
  for (const p of world.players) {
    if (!p.alive || world.tick >= p.dashEndTick) continue;
    const move = MOVE_ABILITY[getClass(p.classId).move];
    if (move.damage <= 0) continue;

    for (const other of world.players) {
      if (other.id === p.id || !other.alive) continue;
      if (p.dashHits.includes(other.id)) continue;
      const dx = other.x - p.x;
      const dy = other.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > PLAYER_RADIUS * 2.6) continue;

      p.dashHits.push(other.id);
      breakStealth(world, other);
      const impact = move.damage + p.stats.chargeBonusDamage;
      applyDamage(world, other, impact * damageMultiplier(p, world.tick), p.id);

      const knockback = move.knockback + p.stats.chargeBonusKnockback;
      if (d > 1e-4 && knockback > 0) {
        other.vx += (dx / d) * knockback;
        other.vy += (dy / d) * knockback;
      }
    }
  }
}

function breakStealth(world: World, p: PlayerState): void {
  if (!isStealthed(p, world.tick)) return;
  p.stealthEndTick = world.tick;
  world.events.push({ type: 'stealthOut', player: p.id, x: p.x, y: p.y, tick: world.tick });
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// --- Obrażenia, regeneracja, śmierć -----------------------------------------

/**
 * Regeneracja poza walką. Licznik resetuje KAŻDE otrzymane obrażenie,
 * łącznie ze strefą — stanie poza kręgiem nigdy się nie „opłaca przeczekać".
 */
export function stepRegen(world: World): void {
  for (const p of world.players) {
    if (!p.alive || p.hp >= p.stats.maxHp) continue;
    if (p.lastHitTick >= 0 && world.tick - p.lastHitTick < REGEN_DELAY_TICKS) continue;
    const rate = REGEN_PER_SECOND + p.stats.regenPerSecond;
    p.hp = Math.min(p.stats.maxHp, p.hp + rate * DT);
  }
}

export function applyDamage(
  world: World,
  target: PlayerState,
  amount: number,
  sourceId: number,
): void {
  if (!target.alive || amount <= 0) return;

  let remaining = amount;
  let absorbed = 0;

  // Tarcza pochłania pierwsza. Liczy się do „zadanych obrażeń" napastnika,
  // bo z jego perspektywy cios wylądował — inaczej statystyki kłamią.
  if (target.shieldHp > 0 && world.tick < target.shieldEndTick) {
    absorbed = Math.min(target.shieldHp, remaining);
    target.shieldHp -= absorbed;
    remaining -= absorbed;
    if (target.shieldHp <= 0) {
      world.events.push({
        type: 'shieldBreak',
        player: target.id,
        x: target.x,
        y: target.y,
        tick: world.tick,
      });
    }
  }

  const dealt = Math.min(remaining, target.hp);
  const landed = absorbed + dealt;
  target.hp -= dealt;
  target.lastHitBy = sourceId;
  target.lastHitTick = world.tick;

  if (sourceId >= 0) {
    const src = world.players[sourceId];
    if (src) {
      src.damageDealt += landed;
      grantXp(world, src.id, landed * XP_PER_DAMAGE);
      // Wampiryzm — ulepszenie: część zadanych obrażeń wraca jako zdrowie.
      if (src.stats.lifesteal > 0 && src.alive) {
        src.hp = Math.min(src.stats.maxHp, src.hp + landed * src.stats.lifesteal);
      }
    }
  }

  world.events.push({
    type: 'damage',
    target: target.id,
    amount: landed,
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
  // Drugie życie — ulepszenie: jednorazowe wskrzeszenie zamiast śmierci.
  // Zużywa ładunek przez usunięcie ulepszenia z listy, więc przelicza się
  // razem z resztą statystyk i nie da się go „odzyskać".
  if (victim.stats.extraLives > 0) {
    const idx = victim.upgrades.indexOf('drugie_zycie');
    if (idx >= 0) {
      victim.upgrades.splice(idx, 1);
      victim.stats = computeStats(victim.classId, victim.upgrades);
      victim.maxHp = victim.stats.maxHp;
      victim.hp = victim.stats.maxHp * 0.3;
      victim.lastHitTick = world.tick;
      victim.shieldHp = 0;
      world.events.push({ type: 'revive', player: victim.id, x: victim.x, y: victim.y, tick: world.tick });
      return;
    }
  }

  victim.hp = 0;
  victim.alive = false;
  victim.deathTick = world.tick;
  victim.vx = 0;
  victim.vy = 0;
  victim.stealthEndTick = -1;
  victim.dashEndTick = -1;
  victim.powerFireTick = -1;
  victim.salvoLeft = 0;
  victim.shieldHp = 0;

  // Martwy nie ma czego wybierać. Bez tego wystawiona oferta zostawała
  // na ekranie na zawsze z licznikiem zatrzymanym na zerze, bo krok
  // progresji pomija nieżyjących i nigdy jej nie rozstrzygał.
  victim.offer = [];
  victim.offerDeadlineTick = -1;

  const killer = killerId >= 0 && killerId !== victim.id ? world.players[killerId] : undefined;
  if (killer) {
    killer.kills += 1;
    killer.score += SCORE_PER_KILL;
    grantXp(world, killer.id, XP_PER_KILL);

    // Cecha klasy: eliminacja odnawia SZTUCZKĘ.
    //
    // Pomiar pokazał, dlaczego to jest potrzebne akurat tutaj. Widmo dociera
    // do pierwszej trójki tak samo często jak Łowca (29% vs 31%), ale wygrywa
    // trzy razy rzadziej — czyli przegrywa nie rundę, tylko jej koniec.
    // W finałowym starciu nie ma się gdzie schować, a Cień odnawia się 14 s,
    // więc klasa oparta na zaskoczeniu wchodzi w decydujące 30 sekund bez
    // swojego jedynego narzędzia. Reset po eliminacji daje jej te 30 sekund
    // z powrotem i nagradza dokładnie to, do czego jest zbudowana — zamiast
    // podnosić jej obrażenia w otwartym polu, którego i tak nie ma wygrywać.
    if (getClass(killer.classId).trickResetOnKill && killer.alive) {
      // Połowa pozostałego odnowienia, nie całość.
      //
      // Pełny reset był dobrany wtedy, gdy Rozdarcie w praktyce chybiało
      // i klasa potrzebowała wszystkiego, co się dało. Po naprawieniu
      // celowania ten sam bonus zaczął się kumulować: eliminacja daje ukrycie,
      // ukrycie daje zasadzkę, zasadzka daje eliminację. Połowa zostawia
      // nagrodę, ale przerywa pętlę.
      const left = Math.max(0, killer.cdTrick - world.tick);
      killer.cdTrick = world.tick + Math.floor(left / 2);
    }
  }

  world.events.push({
    type: 'kill',
    killer: killer ? killer.id : -1,
    victim: victim.id,
    tick: world.tick,
  });
}
