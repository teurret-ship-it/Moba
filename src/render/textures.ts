import * as THREE from 'three';
import type { ClassId } from '../sim/classes.ts';

/**
 * Grafika proceduralna.
 *
 * Sekcja 14, Faza 0: „placeholderowa grafika". Sekcja 4: budżet pobrania
 * ≤15 MB. Generowanie tekstur w canvasie zamiast ładowania plików załatwia
 * oba naraz — zero assetów do pobrania, zero pipeline'u, zero licencji.
 *
 * Gdy Faza 0 przejdzie bramkę, te funkcje zastępuje atlas sprite'ów.
 * Interfejs (`getCharacterTexture(colorIndex)`) zostaje ten sam.
 */

/** Paleta slotów — 12 kolorów rozróżnialnych także przy deuteranopii. */
export const PLAYER_COLORS = [
  '#4fc3f7', '#ff8a65', '#aed581', '#ba68c8',
  '#ffd54f', '#4db6ac', '#f06292', '#90a4ae',
  '#7986cb', '#dce775', '#a1887f', '#4dd0e1',
] as const;

export const PICKUP_COLORS = {
  heal: '#6bd97a',
  speed: '#63d2ff',
  damage: '#ff9a55',
} as const;

const cache = new Map<string, THREE.Texture>();

function canvas(size: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Brak kontekstu 2D — nie da się wygenerować tekstur');
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, key: string): THREE.Texture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * Postać jako billboard (sekcja 2: „sprite'y 2D + billboardy w 3D").
 * Kształt kropli z ciemnym konturem — czytelny na każdym tle, także
 * gdy pod postacią leży drop.
 */
export function getCharacterTexture(colorIndex: number, classId: ClassId = 'lowca'): THREE.Texture {
  const key = `char:${colorIndex}:${classId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const { c, ctx } = canvas(size);
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]!;

  const cx = size / 2;
  const cy = size * 0.56;
  const r = size * 0.3;

  // Sylwetka niesie klasę: Kolos jest kanciasty i barczysty, Widmo
  // spiczaste, Łowca okrągły. Rozmiar robi renderer — tu chodzi o to,
  // żeby kształt dało się odczytać także u dwóch graczy tego samego koloru.
  const outline = (grow: number) => {
    ctx.beginPath();
    if (classId === 'kolos') roundedHex(ctx, cx, cy, r + grow);
    else if (classId === 'widmo') shard(ctx, cx, cy, r + grow);
    else ctx.arc(cx, cy, r + grow, 0, Math.PI * 2);
    ctx.closePath();
  };

  // Kontur
  outline(5);
  ctx.fillStyle = 'rgba(8,10,16,0.92)';
  ctx.fill();

  // Korpus z gradientem — daje wrażenie objętości bez modelu 3D.
  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, lighten(color, 0.35));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, darken(color, 0.4));
  outline(0);
  ctx.fillStyle = grad;
  ctx.fill();

  // Refleks
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.28, cy - r * 0.4, r * 0.34, r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fill();

  // „Głowa" — mały znacznik nad korpusem, ułatwia odczyt kierunku w tłumie.
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.12, r * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,10,16,0.92)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - r * 1.12, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = lighten(color, 0.5);
  ctx.fill();

  return toTexture(c, key);
}

/** Wskaźnik kierunku patrzenia — rysowany płasko na ziemi pod postacią. */
export function getFacingTexture(): THREE.Texture {
  const key = 'facing';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const { c, ctx } = canvas(size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.beginPath();
  ctx.moveTo(cx + size * 0.42, cy);
  ctx.lineTo(cx + size * 0.16, cy - size * 0.15);
  ctx.lineTo(cx + size * 0.16, cy + size * 0.15);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();

  return toTexture(c, key);
}

/** Pierścień pod postacią gracza lokalnego — „gdzie ja jestem". */
export function getSelfRingTexture(): THREE.Texture {
  const key = 'selfring';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const { c, ctx } = canvas(size);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.41, 0, Math.PI * 2);
  ctx.stroke();

  return toTexture(c, key);
}

export function getShadowTexture(): THREE.Texture {
  const key = 'shadow';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 64;
  const { c, ctx } = canvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return toTexture(c, key);
}

export function getPickupTexture(kind: keyof typeof PICKUP_COLORS): THREE.Texture {
  const key = `pickup:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 96;
  const { c, ctx } = canvas(size);
  const color = PICKUP_COLORS[kind];
  const cx = size / 2;
  const cy = size / 2;

  // Poświata — drop musi być widoczny kątem oka, bez wpatrywania się.
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  glow.addColorStop(0, hexToRgba(color, 0.55));
  glow.addColorStop(1, hexToRgba(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Romb — kształt inny niż okrągła postać, żeby nie mylić się w ferworze.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(10,12,18,0.9)';
  ctx.fillRect(-size * 0.2, -size * 0.2, size * 0.4, size * 0.4);
  ctx.fillStyle = color;
  ctx.fillRect(-size * 0.155, -size * 0.155, size * 0.31, size * 0.31);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(-size * 0.155, -size * 0.155, size * 0.31, size * 0.09);
  ctx.restore();

  // Symbol: + / » / ▲
  ctx.fillStyle = 'rgba(12,14,20,0.85)';
  ctx.font = `bold ${Math.round(size * 0.28)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind === 'heal' ? '+' : kind === 'speed' ? '»' : '▲', cx, cy + 1);

  return toTexture(c, key);
}

/** Podłoże: subtelna siatka + szum. Daje odczucie ruchu bez kosztu. */
export function getGroundTexture(): THREE.Texture {
  const key = 'ground';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const { c, ctx } = canvas(size);

  ctx.fillStyle = '#1d2230';
  ctx.fillRect(0, 0, size, size);

  // Szum — bez niego duże płaszczyzny pasmują (banding) na tanich ekranach.
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    img.data[i] = clampByte(img.data[i]! + n);
    img.data[i + 1] = clampByte(img.data[i + 1]! + n);
    img.data[i + 2] = clampByte(img.data[i + 2]! + n);
  }
  ctx.putImageData(img, 0, 0);

  ctx.strokeStyle = 'rgba(120,150,200,0.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }

  const tex = toTexture(c, key);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

/** Miękka poświata — używana do fal, trafień i znaczników zrzutu. */
export function getGlowTexture(): THREE.Texture {
  const key = 'glow';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 128;
  const { c, ctx } = canvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return toTexture(c, key);
}

export function getRingTexture(): THREE.Texture {
  const key = 'ring';
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const { c, ctx } = canvas(size);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();

  return toTexture(c, key);
}

export function disposeTextures(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

// --- pomocnicze kolory ------------------------------------------------------

/** Sześciokąt o zaokrąglonych rogach — barczysta sylwetka Kolosa. */
function roundedHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.95;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Pionowy romb zwężony u dołu — smukła, niepokojąca sylwetka Widma. */
function shard(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.moveTo(cx, cy - r * 1.15);
  ctx.lineTo(cx + r * 0.82, cy - r * 0.1);
  ctx.lineTo(cx, cy + r * 1.15);
  ctx.lineTo(cx - r * 0.82, cy - r * 0.1);
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${mix(r, 255, amount)},${mix(g, 255, amount)},${mix(b, 255, amount)})`;
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgb(${mix(r, 0, amount)},${mix(g, 0, amount)},${mix(b, 0, amount)})`;
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
