/**
 * Dźwięk — syntezowany, bez plików.
 *
 * Cicha gra czyta się jak makieta, nie jak gra. Uderza to wprost w jedyne
 * kryterium Fazy 0, a jednocześnie dźwięk niesie informację, której obraz
 * na małym ekranie nie zdąży przekazać: że coś trafiło CIEBIE, że ktoś
 * właśnie wyszedł z ukrycia obok, że strefa rusza.
 *
 * Wszystko jest generowane przez WebAudio w locie. Powody są te same, co
 * przy grafice proceduralnej (sekcja 4, budżet pobrania ≤15 MB): zero
 * plików do pobrania, zero pipeline'u, zero licencji.
 *
 * Dwie rzeczy wymuszone przez przeglądarki i telefony:
 *  - kontekst audio startuje dopiero po geście użytkownika (polityka
 *    autoodtwarzania), więc budzimy go przy pierwszym tapnięciu „Graj",
 *  - dźwięk musi milknąć, gdy gra idzie w tło — inaczej telefon gra
 *    w kieszeni.
 */

export type SfxName =
  | 'attack'
  | 'hurt'
  | 'dash'
  | 'blink'
  | 'stealthIn'
  | 'stealthOut'
  | 'burst'
  | 'rend'
  | 'salvo'
  | 'shieldUp'
  | 'shieldBreak'
  | 'pickup'
  | 'levelUp'
  | 'upgrade'
  | 'kill'
  | 'death'
  | 'revive'
  | 'zone'
  | 'supply'
  | 'countdown'
  | 'start'
  | 'win';

const STORAGE_KEY = 'arena.muted';

/** Ile dźwięków naraz. Powyżej tego robi się kasza, a nie informacja. */
const MAX_CONCURRENT = 10;
/** Poza tym promieniem zdarzenia są niesłyszalne — zgodnie z AoI. */
const HEARING_RANGE = 34;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private active = 0;
  /** Ostatni tick, w którym zagrał dany dźwięk — dławi powtórki w tym samym ticku. */
  private lastPlayed = new Map<SfxName, number>();

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // Prywatny tryb przeglądarki potrafi rzucić przy dostępie do storage.
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Brak zapisu preferencji nie może wywrócić gry.
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  /**
   * Uruchomienie kontekstu. Musi paść z procedury obsługi gestu użytkownika,
   * inaczej przeglądarka zostawi kontekst zawieszony.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    const master = this.ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.5;

    // Kompresor zamiast pilnowania sum amplitud: przy zbiegu wybuchu,
    // trafienia i awansu suma potrafi przesterować, a trzask na telefonie
    // jest głośniejszy niż wszystko, co chcieliśmy przekazać.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    master.connect(limiter);
    limiter.connect(this.ctx.destination);
    this.master = master;
  }

  /** Wyciszenie na czas przejścia w tło — telefon nie może grać w kieszeni. */
  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /**
   * Odtworzenie dźwięku zdarzenia.
   *
   * `dist` to odległość od słuchacza w jednostkach świata, `pan` to
   * przesunięcie w poziomie (-1..1). Oba są opcjonalne — dźwięki interfejsu
   * (awans, odliczanie) są bezpozycyjne.
   */
  play(name: SfxName, opts: { dist?: number; pan?: number; tick?: number } = {}): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;
    if (ctx.state !== 'running') return;
    if (this.active >= MAX_CONCURRENT) return;

    // Dławienie: to samo zdarzenie w tym samym ticku (np. Salwa trafiająca
    // trzy razy) ma zabrzmieć raz, a nie zlepić się w trzask.
    if (opts.tick !== undefined) {
      if (this.lastPlayed.get(name) === opts.tick) return;
      this.lastPlayed.set(name, opts.tick);
    }

    const dist = opts.dist ?? 0;
    if (dist > HEARING_RANGE) return;
    // Tłumienie z odległości — liniowe, bo logarytmiczne na krótkim
    // dystansie areny robi się nieczytelne.
    const attenuation = 1 - Math.min(1, dist / HEARING_RANGE) * 0.85;

    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = attenuation;

    if (opts.pan !== undefined && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(panner);
      panner.connect(master);
    } else {
      out.connect(master);
    }

    this.active++;
    const done = () => {
      this.active--;
      out.disconnect();
    };

    this.render(name, ctx, out, t, done);
  }

  // --- Synteza ---------------------------------------------------------------

  private render(
    name: SfxName,
    ctx: AudioContext,
    out: GainNode,
    t: number,
    done: () => void,
  ): void {
    switch (name) {
      case 'attack':
        this.blip(ctx, out, t, { freq: 520, to: 380, dur: 0.055, type: 'square', gain: 0.1 }, done);
        break;
      case 'hurt':
        this.blip(ctx, out, t, { freq: 220, to: 90, dur: 0.16, type: 'sawtooth', gain: 0.3 }, done);
        break;
      case 'dash':
        this.swoosh(ctx, out, t, 0.2, 900, 2600, 0.16, done);
        break;
      case 'blink':
        this.blip(ctx, out, t, { freq: 900, to: 2400, dur: 0.12, type: 'sine', gain: 0.16 }, done);
        break;
      case 'stealthIn':
        this.blip(ctx, out, t, { freq: 700, to: 180, dur: 0.3, type: 'sine', gain: 0.18 }, done);
        break;
      case 'stealthOut':
        this.blip(ctx, out, t, { freq: 200, to: 760, dur: 0.22, type: 'sine', gain: 0.18 }, done);
        break;
      case 'burst':
        this.boom(ctx, out, t, 0.45, done);
        break;
      case 'rend':
        this.swoosh(ctx, out, t, 0.16, 2600, 700, 0.24, done);
        break;
      case 'salvo':
        this.blip(ctx, out, t, { freq: 1200, to: 820, dur: 0.05, type: 'square', gain: 0.12 }, done);
        break;
      case 'shieldUp':
        this.chord(ctx, out, t, [440, 660], 0.26, 0.13, done);
        break;
      case 'shieldBreak':
        this.swoosh(ctx, out, t, 0.22, 3000, 500, 0.2, done);
        break;
      case 'pickup':
        this.chord(ctx, out, t, [880, 1320], 0.16, 0.13, done);
        break;
      case 'levelUp':
        this.arpeggio(ctx, out, t, [523, 659, 784, 1047], 0.09, 0.14, done);
        break;
      case 'upgrade':
        this.chord(ctx, out, t, [659, 988], 0.2, 0.14, done);
        break;
      case 'kill':
        this.chord(ctx, out, t, [330, 494, 659], 0.3, 0.16, done);
        break;
      case 'death':
        this.blip(ctx, out, t, { freq: 400, to: 60, dur: 0.7, type: 'sawtooth', gain: 0.3 }, done);
        break;
      case 'revive':
        this.arpeggio(ctx, out, t, [392, 523, 659, 880], 0.11, 0.18, done);
        break;
      case 'zone':
        this.blip(ctx, out, t, { freq: 120, to: 80, dur: 0.9, type: 'triangle', gain: 0.22 }, done);
        break;
      case 'supply':
        this.chord(ctx, out, t, [784, 1175], 0.5, 0.14, done);
        break;
      case 'countdown':
        this.blip(ctx, out, t, { freq: 660, to: 660, dur: 0.09, type: 'square', gain: 0.14 }, done);
        break;
      case 'start':
        this.chord(ctx, out, t, [523, 784], 0.35, 0.18, done);
        break;
      case 'win':
        this.arpeggio(ctx, out, t, [523, 659, 784, 1047, 1319], 0.13, 0.2, done);
        break;
    }
  }

  private blip(
    ctx: AudioContext,
    out: GainNode,
    t: number,
    o: { freq: number; to: number; dur: number; type: OscillatorType; gain: number },
    done: () => void,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);

    // Krótki atak i wykładnicze wygaszenie — bez tego każdy dźwięk kończy
    // się trzaskiem na obcięciu przebiegu.
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(o.gain, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
    osc.onended = done;
  }

  private chord(
    ctx: AudioContext,
    out: GainNode,
    t: number,
    freqs: number[],
    dur: number,
    gainValue: number,
    done: () => void,
  ): void {
    let remaining = freqs.length;
    const finish = () => {
      remaining--;
      if (remaining === 0) done();
    };
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * 0.012;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(gainValue / freqs.length + 0.03, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      osc.onended = finish;
    });
  }

  private arpeggio(
    ctx: AudioContext,
    out: GainNode,
    t: number,
    freqs: number[],
    step: number,
    gainValue: number,
    done: () => void,
  ): void {
    let remaining = freqs.length;
    const finish = () => {
      remaining--;
      if (remaining === 0) done();
    };
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + i * step;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(gainValue, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + step * 1.6);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + step * 1.8);
      osc.onended = finish;
    });
  }

  /** Szum przepuszczony przez przestrajany filtr — świst ruchu i cięcia. */
  private swoosh(
    ctx: AudioContext,
    out: GainNode,
    t: number,
    dur: number,
    fromHz: number,
    toHz: number,
    gainValue: number,
    done: () => void,
  ): void {
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, toHz), t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t);
    src.onended = done;
  }

  /** Niski wybuch: opadająca sinusoida plus krótki szum. */
  private boom(ctx: AudioContext, out: GainNode, t: number, dur: number, done: () => void): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + dur);
    gain.gain.setValueAtTime(0.34, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = done;

    this.swoosh(ctx, out, t, 0.18, 1800, 300, 0.16, () => {});
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
