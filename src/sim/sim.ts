import {
  MATCH_TICKS,
  POSTMATCH_TICKS,
  SCORE_PER_SECOND_ALIVE,
  SCORE_WIN_BONUS,
  TICK_HZ,
  WARMUP_TICKS,
} from './constants.ts';
import { stepAutoAttacks, stepBursts, stepRegen, tryStartBurst, tryStartStealth } from './combat.ts';
import { computeBotInput, createBrain } from './bots.ts';
import { applyMovement, resolveOverlaps, tryStartDash } from './movement.ts';
import { stepPickups } from './pickups.ts';
import { Rng } from './rng.ts';
import type { InputFrame, MatchResult, PlayerState, World } from './types.ts';
import { emptyInput } from './types.ts';
import { aliveCount, createWorld, type CreateWorldOptions } from './world.ts';
import { stepZone } from './zone.ts';

/**
 * Autorytatywna symulacja meczu.
 *
 * W Fazie 0 działa lokalnie w przeglądarce. W Fazie 1 ta sama klasa
 * uruchamia się na serwerze, a klient dostaje wyłącznie snapshoty.
 * Dlatego `Simulation` nie wie nic o renderowaniu ani o tym, kto jest
 * „graczem lokalnym" — zna tylko sloty i wejścia.
 */
export class Simulation {
  readonly world: World;
  private readonly rng: Rng;
  /** Ostatnie wejście otrzymane dla każdego slotu. */
  private readonly inputs = new Map<number, InputFrame>();

  constructor(opts: CreateWorldOptions) {
    this.world = createWorld(opts);
    this.rng = new Rng(opts.seed ^ 0x9e3779b9);
    for (const p of this.world.players) {
      if (p.isBot) p.ai = createBrain(this.rng, 0);
    }
  }

  /**
   * Przyjęcie wejścia od klienta.
   *
   * Wejście spoza kolejności jest odrzucane — to jest pierwsza linia
   * obrony przed powtórką (replay) wejść (sekcja 10).
   */
  pushInput(playerId: number, input: InputFrame): void {
    const current = this.inputs.get(playerId);
    if (current && input.seq < current.seq) return;

    if (current && current.seq === input.seq) {
      // Ten sam tick, nowe zdarzenie krawędziowe — sumujemy wciśnięcia,
      // żeby szybkie tapnięcie nie przepadło między tickami.
      current.moveX = input.moveX;
      current.moveY = input.moveY;
      current.dash ||= input.dash;
      current.stealth ||= input.stealth;
      current.burst ||= input.burst;
      return;
    }

    this.inputs.set(playerId, { ...input });
  }

  /** Jeden krok symulacji o stały czas DT. Nigdy nie zależy od czasu ściennego. */
  step(): void {
    const w = this.world;
    w.events.length = 0;

    if (w.phase === 'over') {
      w.tick++;
      return;
    }

    w.tick++;

    if (w.phase === 'warmup') {
      // W rozgrzewce gracze mogą się rozglądać, ale nie ma ruchu ani walki.
      // Sekcja 1: runda ma być czytelna od pierwszej sekundy.
      if (w.tick >= WARMUP_TICKS) w.phase = 'live';
      return;
    }

    // 1. Zbierz wejścia: ludzie z kolejki, boty z AI.
    const frames = new Map<number, InputFrame>();
    for (const p of w.players) {
      if (!p.alive) continue;
      if (p.isBot) {
        frames.set(p.id, computeBotInput(w, p, this.rng));
      } else {
        const input = this.inputs.get(p.id) ?? emptyInput();
        frames.set(p.id, input);
        p.lastAckSeq = input.seq;
      }
    }

    // 2. Aktywacja umiejętności PRZED ruchem — skok musi zadziałać
    //    w tym samym ticku, w którym gracz go wcisnął, inaczej czuć lag.
    for (const p of w.players) {
      const input = frames.get(p.id);
      if (!input) continue;
      if (tryStartDash(p, input, w.tick)) {
        w.events.push({ type: 'dash', player: p.id, x: p.x, y: p.y, tick: w.tick });
      }
      tryStartStealth(w, p, input);
      tryStartBurst(w, p, input);
    }

    // 3. Ruch.
    for (const p of w.players) {
      const input = frames.get(p.id);
      applyMovement(p, input ?? emptyInput(), w.tick);
    }
    resolveOverlaps(w.players);

    // 4. Koniec ukrycia — zdarzenie na krawędzi, do efektu wizualnego.
    for (const p of w.players) {
      if (p.stealthEndTick === w.tick) {
        w.events.push({ type: 'stealthOut', player: p.id, x: p.x, y: p.y, tick: w.tick });
      }
    }

    // 5. Walka. Fale detonują przed auto-atakami, żeby knockback
    //    wpływał na to, kto jest w zasięgu w tym ticku.
    stepBursts(w);
    stepAutoAttacks(w);

    // 6. Dropy i zdarzenia mapy.
    stepPickups(w, this.rng);

    // 7. Strefa (może zabić — dlatego po walce, przed sprawdzeniem końca).
    stepZone(w);

    // 8. Regeneracja — po strefie, żeby obrażenia od kręgu resetowały
    //    licznik jeszcze w tym samym ticku.
    stepRegen(w);

    // 9. Punkty za przetrwanie — naliczane co sekundę, nie co tick.
    if (w.tick % TICK_HZ === 0) {
      for (const p of w.players) {
        if (p.alive) p.score += SCORE_PER_SECOND_ALIVE;
      }
    }

    // 10. Warunek zwycięstwa.
    this.checkMatchEnd();

    // Zwolnij zużyte wejścia krawędziowe, żeby jedno tapnięcie
    // nie aktywowało umiejętności w kolejnych tickach.
    for (const [id, input] of this.inputs) {
      this.inputs.set(id, { ...input, dash: false, stealth: false, burst: false });
    }
  }

  private checkMatchEnd(): void {
    const w = this.world;
    const alive = aliveCount(w);
    const timeUp = w.tick >= MATCH_TICKS;

    if (alive > 1 && !timeUp) return;

    let winner = -1;
    if (alive === 1) {
      winner = w.players.find((p) => p.alive)?.id ?? -1;
    } else if (alive > 1) {
      // Czas minął przy kilku żywych — wygrywa najwyższy wynik.
      let best: PlayerState | undefined;
      for (const p of w.players) {
        if (!p.alive) continue;
        if (!best || p.score > best.score || (p.score === best.score && p.hp > best.hp)) best = p;
      }
      winner = best?.id ?? -1;
    } else {
      // Wszyscy zginęli w tym samym ticku (np. strefa) — wygrywa ostatni zmarły.
      let best: PlayerState | undefined;
      for (const p of w.players) {
        if (!best || p.deathTick > best.deathTick) best = p;
      }
      winner = best?.id ?? -1;
    }

    w.phase = 'over';
    w.winner = winner;
    w.overTick = w.tick;
    const champ = winner >= 0 ? w.players[winner] : undefined;
    if (champ) champ.score += SCORE_WIN_BONUS;
    w.events.push({ type: 'matchOver', winner, tick: w.tick });
  }

  /** Czy ekran wyniku był pokazywany wystarczająco długo, by wrócić do lobby. */
  canRestart(): boolean {
    return this.world.phase === 'over' && this.world.tick - this.world.overTick >= POSTMATCH_TICKS;
  }

  /** Wynik meczu w formie, którą Faza 1 zapisze do `match_player`. */
  result(): MatchResult {
    const w = this.world;
    const ordered = [...w.players].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.deathTick !== b.deathTick) return b.deathTick - a.deathTick;
      return b.score - a.score;
    });

    return {
      seed: w.seed,
      durationTicks: w.tick,
      winner: w.winner,
      standings: ordered.map((p, i) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        place: i + 1,
        kills: p.kills,
        damageDealt: Math.round(p.damageDealt),
        score: p.score,
        survivedTicks: p.alive ? w.tick : p.deathTick,
      })),
    };
  }
}
