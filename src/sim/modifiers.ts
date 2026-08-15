import { TICK_HZ } from './constants.ts';
import { Rng } from './rng.ts';

/**
 * Warianty rundy.
 *
 * Bramka Fazy 0 brzmi „5 obcych osób gra ≥3 rundy z rzędu bez proszenia",
 * a największym wrogiem trzeciej rundy jest to, że wygląda dokładnie jak
 * pierwsza. Klasy dały różne rundy między sobą, ulepszenia dały różne rundy
 * tą samą klasą — ale sam FORMAT był zawsze ten sam: dwunastu, cztery minuty,
 * kurczący się krąg.
 *
 * Wariant to jedna zasada obowiązująca wszystkich w danej rundzie, ogłaszana
 * na starcie. Trzy reguły projektowe, wszystkie wymuszone przez to, czym
 * Faza 0 jest:
 *
 *  1. **Symetryczny.** Dotyczy każdego tak samo, więc nie wymaga strojenia
 *     balansu klas od nowa — a to jest jedyny powód, dla którego stać mnie
 *     na osiem wariantów zamiast jednego.
 *  2. **Wyrażony istniejącymi pokrętłami.** Żaden wariant nie dokłada nowej
 *     mechaniki; wszystkie mnożą to, co już jest. Nowa mechanika w wariancie
 *     byłaby treścią, której gracz zobaczy raz na osiem rund.
 *  3. **Ogłoszony przed startem.** Wariant, którego gracz nie zna, jest
 *     nieuczciwy — a wariant, którego się nie zauważy, nie istnieje.
 *
 * Losowanie ma własny strumień losowy (jak teren i Rdzeń), żeby dołożenie
 * dziewiątego wariantu nie przesunęło wszystkich późniejszych losowań
 * i nie unieważniło porównań między pomiarami.
 */

export type ModifierId =
  | 'zwykla'
  | 'szybkie_rece'
  | 'krucha_skora'
  | 'zywe_srebro'
  | 'obfitosc'
  | 'lowcy_nagrod'
  | 'ciasny_krag'
  | 'goly_teren';

export interface ModifierDef {
  id: ModifierId;
  name: string;
  /** Jedno zdanie na ekranie startowym i na banerze. */
  text: string;
  glyph: string;
  /** Waga losowania. „Zwykła runda" jest częstsza niż każdy wariant z osobna. */
  weight: number;

  // --- Mnożniki. Wartość neutralna = 1 (albo 0 dla dodatków). ---
  /** Czas odnowień wszystkich umiejętności. */
  cooldownMul: number;
  /** Maksymalne zdrowie wszystkich postaci. */
  healthMul: number;
  /** Prędkość ruchu. */
  speedMul: number;
  /** Częstość pojawiania się dropów. */
  pickupRateMul: number;
  /** Doświadczenie za eliminację. */
  killXpMul: number;
  /** Promień startowy strefy. */
  zoneStartMul: number;
  /** Liczba przeszkód na arenie. */
  terrainMul: number;
}

function base(over: Partial<ModifierDef> & Pick<ModifierDef, 'id' | 'name' | 'text' | 'glyph' | 'weight'>): ModifierDef {
  return {
    cooldownMul: 1,
    healthMul: 1,
    speedMul: 1,
    pickupRateMul: 1,
    killXpMul: 1,
    zoneStartMul: 1,
    terrainMul: 1,
    ...over,
  };
}

export const MODIFIERS: Record<ModifierId, ModifierDef> = {
  zwykla: base({
    id: 'zwykla',
    name: 'Zwykła runda',
    text: 'Bez zmian w zasadach.',
    glyph: '○',
    // Waga 3: co trzecia runda jest „normalna". Wariant przestaje być
    // wariantem, gdy nie ma do czego go porównać.
    weight: 3,
  }),

  szybkie_rece: base({
    id: 'szybkie_rece',
    name: 'Szybkie ręce',
    text: 'Umiejętności odnawiają się o jedną trzecią szybciej.',
    glyph: '↻',
    weight: 1,
    cooldownMul: 0.66,
  }),

  krucha_skora: base({
    id: 'krucha_skora',
    name: 'Krucha skóra',
    text: 'Wszyscy mają o jedną czwartą mniej zdrowia.',
    glyph: '✂',
    weight: 1,
    healthMul: 0.75,
  }),

  zywe_srebro: base({
    id: 'zywe_srebro',
    name: 'Żywe srebro',
    text: 'Wszyscy biegają o jedną piątą szybciej.',
    glyph: '»',
    weight: 1,
    speedMul: 1.2,
  }),

  obfitosc: base({
    id: 'obfitosc',
    name: 'Obfitość',
    text: 'Dropy pojawiają się dwa razy częściej.',
    glyph: '⊕',
    weight: 1,
    pickupRateMul: 0.5,
  }),

  lowcy_nagrod: base({
    id: 'lowcy_nagrod',
    name: 'Łowcy nagród',
    text: 'Eliminacja daje podwójne doświadczenie.',
    glyph: '✦',
    weight: 1,
    killXpMul: 2,
  }),

  ciasny_krag: base({
    id: 'ciasny_krag',
    name: 'Ciasny krąg',
    text: 'Strefa startuje mniejsza. Nie ma gdzie się schować.',
    glyph: '◎',
    weight: 1,
    zoneStartMul: 0.72,
  }),

  goly_teren: base({
    id: 'goly_teren',
    name: 'Goły teren',
    text: 'Znacznie mniej osłon. Widać wszystkich.',
    glyph: '▱',
    weight: 1,
    terrainMul: 0.35,
  }),
};

export const MODIFIER_IDS = Object.keys(MODIFIERS) as ModifierId[];

/**
 * Wariant dla danego ziarna.
 *
 * Deterministyczny i policzalny bez tworzenia świata — klient dostaje go
 * w snapshocie, ale musi też umieć pokazać go na ekranie startowym, zanim
 * runda w ogóle wystartuje.
 */
export function pickModifier(seed: number): ModifierDef {
  // Osobny strumień, jak teren (^0x5bf03635) i Rdzeń (^0x2545f491).
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  const total = MODIFIER_IDS.reduce((n, id) => n + MODIFIERS[id].weight, 0);
  let roll = rng.next() * total;
  for (const id of MODIFIER_IDS) {
    roll -= MODIFIERS[id].weight;
    if (roll <= 0) return MODIFIERS[id];
  }
  return MODIFIERS.zwykla;
}

/** Ile ticków trzyma się baner z nazwą wariantu na starcie rundy. */
export const MODIFIER_BANNER_TICKS = Math.round(3.5 * TICK_HZ);
