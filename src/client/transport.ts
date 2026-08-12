import { Simulation } from '../sim/sim.ts';
import {
  buildSnapshot,
  estimateSnapshotBytes,
  isSnapshotTick,
  type Snapshot,
} from '../sim/snapshot.ts';
import type { InputFrame } from '../sim/types.ts';
import type { CreateWorldOptions } from '../sim/world.ts';

/**
 * Warstwa transportu.
 *
 * Faza 0 nie ma backendu — świadomie (sekcja 19). Ale gra rozmawia z
 * symulacją przez ten sam interfejs, którym w Fazie 1 będzie rozmawiać
 * przez WebSocket. Zamiana `LocalTransport` na `WebSocketTransport` nie
 * dotyka ani renderu, ani predykcji, ani HUD-u.
 *
 * `netSim` pozwala nałożyć sztuczne opóźnienie, jitter i utratę pakietów
 * już teraz. To jest jedyny sposób, żeby sprawdzić ryzyko #4 („netcode
 * nie działa na mobilnym internecie") przed napisaniem serwera.
 */

export interface NetSimConfig {
  /** Opóźnienie w jedną stronę, ms. */
  latencyMs: number;
  /** Losowy rozrzut opóźnienia, ms. */
  jitterMs: number;
  /** Prawdopodobieństwo zgubienia pakietu, 0..1. */
  loss: number;
}

export const NET_PROFILES: Record<string, NetSimConfig> = {
  local: { latencyMs: 0, jitterMs: 0, loss: 0 },
  wifi: { latencyMs: 25, jitterMs: 8, loss: 0.001 },
  lte: { latencyMs: 60, jitterMs: 25, loss: 0.01 },
  bad: { latencyMs: 140, jitterMs: 70, loss: 0.05 },
};

export interface TransportStats {
  snapshotsReceived: number;
  bytesReceived: number;
  lastSnapshotBytes: number;
  inputsSent: number;
  droppedPackets: number;
}

export interface Transport {
  readonly stats: TransportStats;
  sendInput(input: InputFrame): void;
  onSnapshot(cb: (snapshot: Snapshot) => void): void;
  /** Wywoływane co klatkę renderu — dostarcza opóźnione pakiety. */
  pump(nowMs: number): void;
  dispose(): void;
}

interface Delayed<T> {
  payload: T;
  deliverAt: number;
}

export class LocalTransport implements Transport {
  readonly sim: Simulation;
  readonly localPlayerId: number;
  readonly stats: TransportStats = {
    snapshotsReceived: 0,
    bytesReceived: 0,
    lastSnapshotBytes: 0,
    inputsSent: 0,
    droppedPackets: 0,
  };

  private netSim: NetSimConfig;
  private inbound: Delayed<InputFrame>[] = [];
  private outbound: Delayed<Snapshot>[] = [];
  private listener: ((s: Snapshot) => void) | null = null;
  private now = 0;

  constructor(worldOpts: CreateWorldOptions, localPlayerId = 0, netSim: NetSimConfig = NET_PROFILES.local!) {
    this.sim = new Simulation(worldOpts);
    this.localPlayerId = localPlayerId;
    this.netSim = { ...netSim };
  }

  setNetSim(config: NetSimConfig): void {
    this.netSim = { ...config };
  }

  sendInput(input: InputFrame): void {
    this.stats.inputsSent++;
    if (this.drop()) return;
    this.inbound.push({ payload: { ...input }, deliverAt: this.now + this.travelTime() });
  }

  onSnapshot(cb: (snapshot: Snapshot) => void): void {
    this.listener = cb;
  }

  /**
   * Krok „serwera". W Fazie 1 wykonuje go proces serwerowy w swoim
   * własnym tempie; tutaj woła go pętla klienta, bo to ten sam wątek.
   */
  serverTick(nowMs: number): void {
    this.now = nowMs;

    // Dostarcz wejścia, których czas podróży już minął.
    for (let i = this.inbound.length - 1; i >= 0; i--) {
      const item = this.inbound[i];
      if (!item || item.deliverAt > nowMs) continue;
      this.sim.pushInput(this.localPlayerId, item.payload);
      this.inbound.splice(i, 1);
    }

    this.sim.step();

    if (isSnapshotTick(this.sim.world.tick)) {
      const snapshot = buildSnapshot(this.sim.world, this.localPlayerId);
      if (!this.drop()) {
        this.outbound.push({ payload: snapshot, deliverAt: nowMs + this.travelTime() });
      }
    }
  }

  pump(nowMs: number): void {
    this.now = nowMs;
    if (!this.listener) return;

    // Sortowanie po czasie dostarczenia: przy jitterze pakiety mogą
    // przyjść w innej kolejności niż zostały wysłane. Bufor interpolacji
    // odrzuci spóźnione — i o to chodzi, żeby to przetestować już teraz.
    this.outbound.sort((a, b) => a.deliverAt - b.deliverAt);

    while (this.outbound.length > 0 && this.outbound[0]!.deliverAt <= nowMs) {
      const item = this.outbound.shift()!;
      this.stats.snapshotsReceived++;
      const bytes = estimateSnapshotBytes(item.payload);
      this.stats.lastSnapshotBytes = bytes;
      this.stats.bytesReceived += bytes;
      this.listener(item.payload);
    }
  }

  dispose(): void {
    this.listener = null;
    this.inbound = [];
    this.outbound = [];
  }

  private travelTime(): number {
    const { latencyMs, jitterMs } = this.netSim;
    if (latencyMs === 0 && jitterMs === 0) return 0;
    return Math.max(0, latencyMs + (Math.random() * 2 - 1) * jitterMs);
  }

  private drop(): boolean {
    if (this.netSim.loss <= 0) return false;
    if (Math.random() < this.netSim.loss) {
      this.stats.droppedPackets++;
      return true;
    }
    return false;
  }
}
