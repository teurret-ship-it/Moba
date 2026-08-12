/**
 * Stałe symulacji.
 *
 * Ten plik (i cały katalog `sim/`) nie może importować niczego z DOM,
 * Three.js ani `window`. To jest kod, który w Fazie 1 przenosi się
 * bez zmian na serwer autorytatywny (sekcja 7 planu).
 */

// --- Czas -------------------------------------------------------------------

/** Częstotliwość symulacji (sekcja 7: tick 15–20 Hz, nie 60). */
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const DT = 1 / TICK_HZ;

/**
 * Częstotliwość wysyłania snapshotów (sekcja 7: snapshot delta → 15 Hz).
 *
 * Uwaga: 20 Hz / 15 Hz = 1,33 — to NIE dzieli się równo. Licznik ticków
 * porównywany z 1,33 wysyłałby snapshot co 2 ticki, czyli 10 Hz zamiast 15.
 * Dlatego harmonogram liczy `isSnapshotTick()`, które daje wzorzec 1-1-2
 * i dokładnie 3 snapshoty na 4 ticki.
 */
export const SNAPSHOT_HZ = 15;

/** Sekcja 1: sesja 3–6 minut. */
export const MATCH_SECONDS = 240;
export const MATCH_TICKS = MATCH_SECONDS * TICK_HZ;
export const WARMUP_SECONDS = 3;
export const WARMUP_TICKS = WARMUP_SECONDS * TICK_HZ;
/** Ile ticków ekranu wyniku zanim runda może się zrestartować. */
export const POSTMATCH_TICKS = 6 * TICK_HZ;

// --- Arena ------------------------------------------------------------------

export const ARENA_RADIUS = 46;
/** Sekcja 1: maks. 8–12 graczy na instancję. */
export const MAX_PLAYERS = 12;
export const PLAYER_RADIUS = 0.85;

// --- Strefa (kurczący się obszar bezpieczny) --------------------------------

export const ZONE_START_RADIUS = ARENA_RADIUS;
export const ZONE_END_RADIUS = 7;
/** Strefa zaczyna się kurczyć po tylu sekundach od startu rundy. */
export const ZONE_HOLD_SECONDS = 45;
/** Kurczenie kończy się w tej sekundzie meczu (potem już tylko trzyma). */
export const ZONE_SHRINK_END_SECONDS = 200;
/** Obrażenia na sekundę poza strefą (rosną z czasem, patrz zone.ts). */
export const ZONE_DPS_BASE = 6;
export const ZONE_DPS_RAMP = 14;

// --- Postać -----------------------------------------------------------------

export const MAX_HP = 100;
export const BASE_SPEED = 9.5;

/**
 * Regeneracja poza walką.
 *
 * Bez niej runda jest czystą attrycją: obrażenia kumulują się przez cały
 * mecz, nikt nie odzyskuje zdrowia i stawka topnieje w ~90 s zamiast
 * zakładanych 3–6 minut (sekcja 1). Zmierzone w `balance.probe.test.ts`.
 *
 * Efekt uboczny jest pożądany: regeneracja nadaje wartość ucieczce, więc
 * Skok i Cień przestają być tylko narzędziami ataku, a wycofanie się
 * staje się realną decyzją zamiast przegranej.
 */
export const REGEN_DELAY_TICKS = Math.round(4 * TICK_HZ);
export const REGEN_PER_SECOND = 10;
/** Przyspieszenie — im wyżej, tym ostrzejsze sterowanie. */
export const ACCEL = 70;
export const FRICTION = 60;

// --- Atak podstawowy (auto, jednoręczne sterowanie) -------------------------

export const ATTACK_RANGE = 7.0;
export const ATTACK_COOLDOWN_TICKS = Math.round(0.55 * TICK_HZ);
export const ATTACK_DAMAGE = 5;

// --- Umiejętność 1: Skok (dash) --------------------------------------------

export const DASH_COOLDOWN_TICKS = Math.round(6 * TICK_HZ);
export const DASH_DURATION_TICKS = Math.round(0.18 * TICK_HZ);
export const DASH_SPEED = 42;

// --- Umiejętność 2: Cień (stealth) -----------------------------------------

export const STEALTH_COOLDOWN_TICKS = Math.round(14 * TICK_HZ);
export const STEALTH_DURATION_TICKS = Math.round(3.5 * TICK_HZ);
export const STEALTH_SPEED_MUL = 1.18;
/** Wyjście z ukrycia po ataku nie jest natychmiastowe — daje okno na cios. */
export const STEALTH_BREAK_DELAY_TICKS = 2;

// --- Umiejętność 3: Fala (obszarowy wybuch) ---------------------------------

export const BURST_COOLDOWN_TICKS = Math.round(10 * TICK_HZ);
export const BURST_RADIUS = 7.5;
export const BURST_DAMAGE = 20;
export const BURST_KNOCKBACK = 26;
/** Opóźnienie między wciśnięciem a detonacją (czytelność dla przeciwnika). */
export const BURST_WINDUP_TICKS = Math.round(0.25 * TICK_HZ);

// --- Dropy ------------------------------------------------------------------

export const PICKUP_RADIUS = 1.4;
export const PICKUP_MAX_ACTIVE = 10;
export const PICKUP_SPAWN_INTERVAL_TICKS = Math.round(5 * TICK_HZ);
export const PICKUP_HEAL_AMOUNT = 32;
export const PICKUP_BUFF_DURATION_TICKS = Math.round(9 * TICK_HZ);
export const PICKUP_SPEED_MUL = 1.3;
export const PICKUP_DAMAGE_MUL = 1.45;

// --- Zdarzenie mapy: zrzut zaopatrzenia -------------------------------------

export const SUPPLY_EVENT_INTERVAL_TICKS = Math.round(45 * TICK_HZ);
export const SUPPLY_EVENT_PICKUPS = 4;
/** Ostrzeżenie na HUD przed zrzutem. */
export const SUPPLY_EVENT_WARN_TICKS = Math.round(4 * TICK_HZ);

// --- Sieć / widoczność ------------------------------------------------------

/**
 * Area of Interest (sekcja 7): klient dostaje tylko byty w tym promieniu.
 * Jednocześnie anti-cheat i oszczędność pasma.
 */
export const AOI_RADIUS = 34;

/** Sekcja 7: klient interpoluje 100 ms wstecz. */
export const INTERP_DELAY_MS = 100;

// --- Punktacja --------------------------------------------------------------

export const SCORE_PER_KILL = 100;
export const SCORE_PER_SECOND_ALIVE = 2;
export const SCORE_WIN_BONUS = 250;
