import { INTERP_DELAY_MS } from '../sim/constants.ts';
import type { Snapshot, PlayerView } from '../sim/snapshot.ts';
import type { Decoy, ObjectiveState, Pickup, ZoneState } from '../sim/types.ts';

/**
 * Bufor interpolacji (sekcja 7: „klient interpoluje 100 ms wstecz").
 *
 * Renderujemy świat celowo w przeszłości. Kosztem 100 ms opóźnienia
 * dostajemy płynny ruch cudzych postaci mimo snapshotów co ~66 ms
 * i mimo jitteru sieci — a to jest ryzyko #4 z sekcji 16.
 *
 * Własna postać jest wyjątkiem: ona idzie przez predykcję, bez opóźnienia.
 */

export interface RenderPlayer extends PlayerView {
  /** Czy ta postać jest interpolowana (false = pojawiła się dopiero teraz). */
  fresh: boolean;
}

export interface RenderState {
  players: RenderPlayer[];
  pickups: Pickup[];
  /** Zwody nie ruszają się, więc nie ma czego interpolować. */
  decoys: Decoy[];
  zone: ZoneState;
  objective: ObjectiveState;
  aliveCount: number;
  tick: number;
}

interface Timed {
  snapshot: Snapshot;
  /** Czas odbioru po stronie klienta (ms). */
  receivedAt: number;
}

export class SnapshotBuffer {
  private buffer: Timed[] = [];
  /** Ile snapshotów trzymamy — wystarczy na ~1 s przy 15 Hz. */
  private readonly capacity = 24;

  push(snapshot: Snapshot, now: number): void {
    // Snapshot spóźniony (dotarł po nowszym) — odrzucamy, kolejność ma znaczenie.
    const last = this.buffer[this.buffer.length - 1];
    if (last && snapshot.tick <= last.snapshot.tick) return;

    this.buffer.push({ snapshot, receivedAt: now });
    while (this.buffer.length > this.capacity) this.buffer.shift();
  }

  get latest(): Snapshot | null {
    return this.buffer[this.buffer.length - 1]?.snapshot ?? null;
  }

  get size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  /**
   * Stan świata do wyrenderowania w chwili `now`, cofnięty o INTERP_DELAY_MS.
   */
  sample(now: number): RenderState | null {
    if (this.buffer.length === 0) return null;
    const target = now - INTERP_DELAY_MS;

    // Za mało historii — pokaż najstarszy, jaki mamy. Zdarza się tylko
    // przez pierwsze ~100 ms rundy.
    const first = this.buffer[0];
    if (!first) return null;
    if (target <= first.receivedAt) return toRenderState(first.snapshot, null, 0);

    let a: Timed | undefined;
    let b: Timed | undefined;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const entry = this.buffer[i];
      if (entry && entry.receivedAt <= target) {
        a = entry;
        b = this.buffer[i + 1];
        break;
      }
    }

    if (!a) return toRenderState(first.snapshot, null, 0);
    if (!b) {
      // Brak nowszego snapshotu — ekstrapolacja jest gorsza od zamrożenia,
      // bo generuje ruch, który zaraz zostanie cofnięty.
      return toRenderState(a.snapshot, null, 0);
    }

    const span = b.receivedAt - a.receivedAt;
    const t = span > 0 ? clamp01((target - a.receivedAt) / span) : 0;
    return toRenderState(a.snapshot, b.snapshot, t);
  }
}

function toRenderState(a: Snapshot, b: Snapshot | null, t: number): RenderState {
  const players: RenderPlayer[] = [];

  for (const pa of a.players) {
    const pb = b ? b.players.find((p) => p.id === pa.id) : undefined;
    if (!pb) {
      // Byt zniknął z nowszego snapshotu: wyszedł z AoI albo wszedł w ukrycie.
      // Renderujemy go jeszcze na ostatniej znanej pozycji — znikanie
      // obsługuje warstwa renderu (wygaszenie), nie interpolacja.
      players.push({ ...pa, fresh: false });
      continue;
    }
    players.push({
      ...pa,
      x: lerp(pa.x, pb.x, t),
      y: lerp(pa.y, pb.y, t),
      facing: lerpAngle(pa.facing, pb.facing, t),
      hp: pb.hp,
      alive: pb.alive,
      dashing: pb.dashing,
      stealthed: pb.stealthed,
      speedBuffed: pb.speedBuffed,
      damageBuffed: pb.damageBuffed,
      bursting: pb.bursting,
      fresh: false,
    });
  }

  if (b) {
    // Byty, które pojawiły się dopiero w nowszym snapshocie (weszły w AoI
    // albo wyszły z ukrycia) — brak pozycji „przed", więc bez interpolacji.
    for (const pb of b.players) {
      if (!a.players.some((p) => p.id === pb.id)) {
        players.push({ ...pb, fresh: true });
      }
    }
  }

  const source = b ?? a;
  return {
    players,
    pickups: source.pickups,
    decoys: source.decoys,
    zone: {
      x: lerp(a.zone.x, source.zone.x, t),
      y: lerp(a.zone.y, source.zone.y, t),
      radius: lerp(a.zone.radius, source.zone.radius, t),
      nextRadius: source.zone.nextRadius,
      shrinking: source.zone.shrinking,
    },
    // Rdzeń nie jest interpolowany: nie porusza się, a jego postęp ma
    // pokazywać stan serwera, nie zgadywanie klienta.
    objective: source.objective,
    aliveCount: source.aliveCount,
    tick: source.tick,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolacja kąta najkrótszą drogą — inaczej postać obraca się o 350°. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
