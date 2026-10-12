// Cached FX sprites (team: art+fx): soft glows, light falloffs, smoke puffs, rune glyphs, decals.
// Every radial gradient is rendered ONCE into a small canvas and then blitted (mobile friendly).

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

export function rgbOf(color) {
  if (color[0] === '#') {
    let h = color.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = color.match(/\d+(\.\d+)?/g);
  return m ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
}
export const rgba = (color, a) => { const [r, g, b] = rgbOf(color); return `rgba(${r},${g},${b},${a})`; };

const glowCache = new Map();
/** Soft additive glow blob of radius r (px) in `color`. */
export function glowSprite(color, r) {
  r = Math.max(1, Math.min(32, Math.round(r)));
  const key = color + '|' + r;
  let s = glowCache.get(key);
  if (s) return s;
  const { c, ctx } = canvas(r * 2 + 1, r * 2 + 1);
  const [R, G, B] = rgbOf(color);
  const g = ctx.createRadialGradient(r + 0.5, r + 0.5, 0, r + 0.5, r + 0.5, r + 0.5);
  g.addColorStop(0, `rgba(${R},${G},${B},0.95)`);
  g.addColorStop(0.3, `rgba(${R},${G},${B},0.5)`);
  g.addColorStop(0.65, `rgba(${R},${G},${B},0.15)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, r * 2 + 1, r * 2 + 1);
  glowCache.set(key, (s = c));
  return s;
}

let lightMask = null;
/** White radial falloff (64px) used to punch light holes into the darkness layer. */
export function lightMaskSprite() {
  if (lightMask) return lightMask;
  const { c, ctx } = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return (lightMask = c);
}

const tintCache = new Map();
/** Coloured light tint (64px radial) for additive light colour. */
export function lightTintSprite(color) {
  let s = tintCache.get(color);
  if (s) return s;
  const { c, ctx } = canvas(64, 64);
  const [R, G, B] = rgbOf(color);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`);
  g.addColorStop(0.4, `rgba(${R},${G},${B},0.45)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tintCache.set(color, (s = c));
  return s;
}

const smokeCache = new Map();
/** Pixel-y soft puff for smoke/steam/dust (non-additive). */
export function smokeSprite(color, r) {
  r = Math.max(1, Math.min(12, Math.round(r)));
  const key = color + '|' + r;
  let s = smokeCache.get(key);
  if (s) return s;
  const { c, ctx } = canvas(r * 2 + 1, r * 2 + 1);
  const [R, G, B] = rgbOf(color);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.sqrt(x * x + y * y) / (r + 0.5);
    if (d > 1) continue;
    const a = (1 - d * d) * 0.9;
    // a little dither keeps it pixel-art
    if (d > 0.7 && ((x + y) & 1)) continue;
    ctx.fillStyle = `rgba(${R},${G},${B},${a.toFixed(3)})`;
    ctx.fillRect(x + r, y + r, 1, 1);
  }
  smokeCache.set(key, (s = c));
  return s;
}

const RUNES = [
  [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [4, 0], [3, 1], [1, 3], [0, 4]],
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [0, 2], [1, 2], [3, 2], [4, 2], [0, 0], [4, 4]],
  [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0], [2, 0], [2, 4], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 1], [2, 2], [1, 3], [3, 3], [0, 4], [4, 4]],
  [[2, 0], [1, 1], [3, 1], [0, 2], [4, 2], [1, 3], [3, 3], [2, 4], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 1], [3, 0], [2, 3], [3, 4]],
];
const runeCache = new Map();
export const RUNE_COUNT = RUNES.length;
/** 5x5 glowing rune glyph. */
export function runeSprite(k, color) {
  const key = k + '|' + color;
  let s = runeCache.get(key);
  if (s) return s;
  const { c, ctx } = canvas(7, 7);
  ctx.fillStyle = rgba(color, 0.35);
  for (const [x, y] of RUNES[k % RUNES.length]) ctx.fillRect(x, y, 3, 3);
  ctx.fillStyle = color;
  for (const [x, y] of RUNES[k % RUNES.length]) ctx.fillRect(x + 1, y + 1, 1, 1);
  runeCache.set(key, (s = c));
  return s;
}

const decalCache = new Map();
/** Ground decal: 'scorch' | 'frost' | 'burn' | 'glyph' | 'crack' | 'corrupt'. */
export function decalSprite(type, r) {
  r = Math.max(4, Math.min(40, Math.round(r / 2) * 2));
  const key = type + '|' + r;
  let s = decalCache.get(key);
  if (s) return s;
  const { c, ctx } = canvas(r * 2 + 1, r * 2 + 1);
  const h = (x, y, k) => {
    let n = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.sqrt(x * x + (y * y) * 1.6) / r;
    if (d > 1) continue;
    const n = h(x, y, 7);
    let col = null;
    if (type === 'scorch') {
      if (d < 0.75 - n * 0.3) col = `rgba(20,8,6,${0.55 * (1 - d)})`;
      if (n < 0.04 && d < 0.6) col = 'rgba(255,120,40,0.8)';
    } else if (type === 'frost') {
      if (d < 0.9 - n * 0.35) col = `rgba(200,240,255,${0.35 * (1 - d * 0.6)})`;
      if (n < 0.06 && d < 0.85) col = 'rgba(255,255,255,0.8)';
    } else if (type === 'burn') {
      const a = Math.atan2(y, x);
      const ray = Math.abs(Math.sin(a * 4 + n)) > 0.85 - d * 0.4;
      if (ray && d < 0.95) col = `rgba(20,16,30,${0.5 * (1 - d)})`;
      if (d < 0.2) col = 'rgba(30,24,40,0.5)';
    } else if (type === 'glyph') {
      if (Math.abs(d - 0.8) < 0.07 || Math.abs(d - 0.55) < 0.06) col = 'rgba(190,140,255,0.55)';
    } else if (type === 'crack') {
      const a = Math.atan2(y, x);
      if (Math.abs(Math.sin(a * 3 + d * 2)) < 0.08 + (1 - d) * 0.05) col = `rgba(30,20,10,${0.7 * (1 - d)})`;
      if (d < 0.5 && n < 0.15) col = 'rgba(90,70,40,0.4)';
    } else if (type === 'corrupt') {
      if (d < 0.8 - n * 0.3) col = `rgba(40,10,50,${0.5 * (1 - d)})`;
      if (n < 0.04) col = 'rgba(122,255,90,0.7)';
    }
    if (col) { ctx.fillStyle = col; ctx.fillRect(x + r, y + r, 1, 1); }
  }
  decalCache.set(key, (s = c));
  return s;
}

const vignetteCache = new Map();
export function vignetteSprite(w, h, color = '#05030a') {
  const key = `${w}x${h}|${color}`;
  let s = vignetteCache.get(key);
  if (s) return s;
  const { c, ctx } = canvas(w, h);
  const [R, G, B] = rgbOf(color);
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
  g.addColorStop(0, `rgba(${R},${G},${B},0)`);
  g.addColorStop(1, `rgba(${R},${G},${B},1)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (vignetteCache.size > 6) vignetteCache.clear();
  vignetteCache.set(key, (s = c));
  return s;
}
