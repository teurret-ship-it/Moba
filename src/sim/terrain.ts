import { ARENA_RADIUS, PLAYER_RADIUS, ZONE_END_RADIUS } from './constants.ts';
import { Rng } from './rng.ts';

/**
 * Teren: przeszkody generowane z ziarna meczu.
 *
 * Do tej pory arena była gołym dyskiem. Konsekwencje były trzy i wszystkie
 * uderzały w to, co ma sprawdzić Faza 0:
 *  - nie było osłony, więc zasięg wygrywał zawsze i bezwarunkowo,
 *  - ucieczka nie miała geometrii — biegłeś po prostej i albo cię dogonili,
 *    albo nie; Skok i Mgnienie nie miały czego omijać,
 *  - każda mapa wyglądała identycznie, więc druga runda nie miała nowego
 *    pytania do zadania.
 *
 * Przeszkody są **kapsułami** (odcinek + promień). Koło to kapsuła o zerowej
 * długości, więc filary i mury dzielą tę samą matematykę kolizji i widoczności
 * — jeden kod zamiast dwóch, co przy symulacji autorytatywnej ma znaczenie,
 * bo każda ścieżka musi być identyczna po obu stronach.
 *
 * Teren NIE jest wysyłany w snapshocie. Klient generuje go z tego samego
 * ziarna tą samą funkcją — zero bajtów na coś, co się nie zmienia przez cały
 * mecz. To jest w duchu sekcji 15: manifest treści wersjonowany osobno od
 * stanu, nie doklejany do każdej ramki.
 */

export interface Obstacle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  r: number;
}

/** Środek areny zostaje pusty — tam kończy strefa i rozgrywa się finał. */
const CENTER_CLEAR = ZONE_END_RADIUS + 3;
/** Pas przy krawędzi bez przeszkód, żeby nie robić pułapek bez wyjścia. */
const EDGE_MARGIN = 5;

/**
 * Generacja układu przeszkód.
 *
 * Deterministyczna: to samo ziarno daje tę samą mapę, więc `?seed=` odtwarza
 * mecz co do przeszkody, a klient nie potrzebuje ich dostawać z serwera.
 */
export function generateTerrain(seed: number): Obstacle[] {
  // Osobny strumień losowości niż symulacja — inaczej dołożenie przeszkody
  // przesuwałoby wszystkie późniejsze losowania w meczu.
  const rng = new Rng(seed ^ 0x5bf03635);
  const out: Obstacle[] = [];

  const pillars = rng.int(5, 8);
  const walls = rng.int(3, 5);

  for (let i = 0; i < pillars; i++) {
    const spot = findSpot(rng, out, 3.2);
    if (!spot) continue;
    out.push({ x1: spot.x, y1: spot.y, x2: spot.x, y2: spot.y, r: rng.range(1.8, 3.2) });
  }

  for (let i = 0; i < walls; i++) {
    const spot = findSpot(rng, out, 4.0);
    if (!spot) continue;
    // Mur jest krótki i gruby: ma dawać osłonę i zmuszać do obejścia,
    // a nie dzielić areny na korytarze, w których nie da się nikogo znaleźć.
    const angle = rng.next() * Math.PI * 2;
    const r = rng.range(1.1, 1.8);

    // Losujemy środek, a długość dokładamy po fakcie — więc mur potrafiłby
    // wystawać poza arenę i sterczeć przez jej krawędź. Skracamy go, aż oba
    // końce zmieszczą się w środku, zamiast odrzucać całe losowanie.
    const limit = ARENA_RADIUS - r - 1;
    let half = rng.range(3.5, 7.0);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    while (
      half > 1.2 &&
      (Math.hypot(spot.x + ux * half, spot.y + uy * half) > limit ||
        Math.hypot(spot.x - ux * half, spot.y - uy * half) > limit)
    ) {
      half *= 0.85;
    }

    const wall: Obstacle = {
      x1: spot.x - ux * half,
      y1: spot.y - uy * half,
      x2: spot.x + ux * half,
      y2: spot.y + uy * half,
      r,
    };

    // Odstęp sprawdzamy dla CAŁEGO muru, nie tylko dla jego środka.
    // Wcześniej wolne było jedynie miejsce na środek, więc długi mur mógł
    // końcem wejść w sąsiedni filar. Powstawała ciasna kieszeń, z której
    // wypychanie odbijało postać między dwiema bryłami i zostawiało ją
    // zanurzoną w ścianie — a stamtąd dało się strzelać przez mur.
    if (out.some((o) => obstacleGap(wall, o) < 3)) continue;

    out.push(wall);
  }

  return out;
}

function findSpot(
  rng: Rng,
  placed: readonly Obstacle[],
  clearance: number,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    const spot = rng.pointInCircle(0, 0, ARENA_RADIUS - EDGE_MARGIN);
    const d = Math.hypot(spot.x, spot.y);
    if (d < CENTER_CLEAR) continue;

    // Zostaw przejście między przeszkodami — inaczej powstają zbite bryły,
    // które zamykają połowę mapy.
    let clear = true;
    for (const o of placed) {
      if (distanceToObstacle(spot.x, spot.y, o) < o.r + clearance + 4) {
        clear = false;
        break;
      }
    }
    if (clear) return spot;
  }
  return null;
}

/** Prześwit między dwiema przeszkodami (0 = stykają się). */
export function obstacleGap(a: Obstacle, b: Obstacle): number {
  const d = Math.sqrt(segmentDistanceSq(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2));
  return d - a.r - b.r;
}

// --- Kolizje -----------------------------------------------------------------

/** Odległość punktu od osi kapsuły (bez uwzględnienia jej promienia). */
export function distanceToObstacle(x: number, y: number, o: Obstacle): number {
  return Math.sqrt(distanceToSegmentSq(x, y, o.x1, o.y1, o.x2, o.y2));
}

/**
 * Wypchnięcie postaci z przeszkody.
 *
 * Wywoływane po ruchu, po stronie serwera I w predykcji klienta — teren jest
 * statyczny i identyczny po obu stronach, więc wypychanie nie generuje
 * rozjazdu, w przeciwieństwie do rozpychania się postaci.
 */
export function pushOutOfObstacles(
  p: { x: number; y: number; vx: number; vy: number },
  obstacles: readonly Obstacle[],
  /**
   * Kierunek preferowanego wyjścia. Gdy podany, postać jest wypychana
   * DO PRZODU zamiast do najbliższej krawędzi — dzięki temu teleport
   * przechodzi przez mur, zamiast odbijać się od niego z powrotem.
   */
  forward?: { x: number; y: number },
): void {
  // Dwa przejścia: wypchnięcie z jednej przeszkody potrafi wepchnąć
  // w sąsiednią. Dwa wystarczają, bo generator zostawia między nimi przerwy.
  for (let pass = 0; pass < 2; pass++) {
    pushPass(p, obstacles, forward);
  }
}

function pushPass(
  p: { x: number; y: number; vx: number; vy: number },
  obstacles: readonly Obstacle[],
  forward?: { x: number; y: number },
): void {
  for (const o of obstacles) {
    const min = o.r + PLAYER_RADIUS;
    const closest = closestPointOnSegment(p.x, p.y, o.x1, o.y1, o.x2, o.y2);
    let dx = p.x - closest.x;
    let dy = p.y - closest.y;
    let d = Math.hypot(dx, dy);

    if (d >= min) continue;

    // Postać dokładnie na osi muru — brak kierunku wypchnięcia. Wypychamy
    // prostopadle do muru, żeby nie zależeć od błędu numerycznego.
    if (d < 1e-6) {
      const ax = o.x2 - o.x1;
      const ay = o.y2 - o.y1;
      const len = Math.hypot(ax, ay);
      if (len < 1e-6) {
        dx = 1;
        dy = 0;
      } else {
        dx = -ay / len;
        dy = ax / len;
      }
      d = 1;
    }

    let nx = dx / d;
    let ny = dy / d;

    // Wyjście do przodu: jeśli najbliższa krawędź jest za plecami, wypchnij
    // na drugą stronę przeszkody wzdłuż kierunku ruchu.
    if (forward && nx * forward.x + ny * forward.y < 0) {
      nx = forward.x;
      ny = forward.y;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      // Odległość mierzymy od osi, więc wyjście z drugiej strony wymaga
      // pełnej szerokości przeszkody plus promienia postaci.
      p.x = closest.x + nx * min;
      p.y = closest.y + ny * min;
      continue;
    }

    p.x = closest.x + nx * min;
    p.y = closest.y + ny * min;

    // Wygaś prędkość wchodzącą w przeszkodę — bez tego postać „wibruje"
    // przy ścianie, wypychana i wpychana w kolejnych tickach.
    const into = p.vx * nx + p.vy * ny;
    if (into < 0) {
      p.vx -= into * nx;
      p.vy -= into * ny;
    }
  }
}

// --- Widoczność ---------------------------------------------------------------

/**
 * Czy odcinek (ax,ay)–(bx,by) jest wolny od przeszkód.
 *
 * Używane przez celowanie: nie da się trafić przez mur. To jest to, co czyni
 * osłonę realną decyzją, a nie dekoracją.
 */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  obstacles: readonly Obstacle[],
): boolean {
  for (const o of obstacles) {
    if (segmentDistanceSq(ax, ay, bx, by, o.x1, o.y1, o.x2, o.y2) < o.r * o.r) {
      return false;
    }
  }
  return true;
}

// --- Geometria ----------------------------------------------------------------

function closestPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return { x: x1, y: y1 };
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: x1 + dx * t, y: y1 + dy * t };
}

function distanceToSegmentSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const c = closestPointOnSegment(px, py, x1, y1, x2, y2);
  const dx = px - c.x;
  const dy = py - c.y;
  return dx * dx + dy * dy;
}

/** Kwadrat najmniejszej odległości między dwoma odcinkami. */
function segmentDistanceSq(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distanceToSegmentSq(ax, ay, cx, cy, dx, dy),
    distanceToSegmentSq(bx, by, cx, cy, dx, dy),
    distanceToSegmentSq(cx, cy, ax, ay, bx, by),
    distanceToSegmentSq(dx, dy, ax, ay, bx, by),
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}
