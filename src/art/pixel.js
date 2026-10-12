// Tiny pixel-drawing helpers for procedural art (team: art+fx).
// Everything here draws hard-edged pixels (no anti-aliasing) into small offscreen canvases.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const ctx = c.getContext('2d', { willReadFrequently: false });
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}

export function rect(ctx, x, y, w, h, color) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Filled pixel circle (no anti-aliasing). */
export function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
    ctx.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1);
  }
}

/** Filled pixel ellipse centred on (cx, cy). */
export function ellipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  if (rx <= 0 || ry <= 0) return;
  for (let y = -ry; y <= ry; y++) {
    const k = 1 - (y * y) / ((ry + 0.4) * (ry + 0.4));
    if (k <= 0) continue;
    const w = Math.round(rx * Math.sqrt(k));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

/** Bresenham line. */
export function line(ctx, x0, y0, x1, y1, color) {
  ctx.fillStyle = color;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 256; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Polygon fill via canvas path (crisp enough at integer vertices). */
export function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

const rgbCache = new Map();
/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' -> [r,g,b]. */
export function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  if (hex[0] === '#') {
    let h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h.slice(0, 6), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = hex.match(/\d+/g) || [255, 0, 255];
    v = [+m[0], +m[1], +m[2]];
  }
  rgbCache.set(hex, v);
  return v;
}

export function rgbToHex(r, g, b) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Lighten (amt>0) or darken (amt<0) a colour. amt in -1..1. Returns '#rrggbb'. */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  // darkening drifts towards cool violet, lightening towards warm cream: keeps the palette cohesive
  if (amt < 0) {
    const k = 1 + amt;
    return rgbToHex(r * k + 20 * -amt * 0.5, g * k + 8 * -amt * 0.5, b * k + 40 * -amt * 0.5);
  }
  return rgbToHex(r + (255 - r) * amt, g + (250 - g) * amt, b + (230 - b) * amt * 0.9);
}

/** Linear mix of two colours (t 0..1). */
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** 5-step ramp [darkest, dark, base, light, lightest] from one base colour. */
export function ramp(hex) {
  return [shade(hex, -0.62), shade(hex, -0.32), rgbToHex(...hexToRgb(hex)), shade(hex, 0.25), shade(hex, 0.55)];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Deterministic hash noise 0..1 for (x, y, seed). */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise 0..1, tileable with period `per` (in cells). */
export function vnoise(x, y, seed = 0, per = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (a) => (per ? ((a % per) + per) % per : a);
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Mulberry32 PRNG for cosmetic generation. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Add a 1px outline around every opaque pixel of a canvas (in place).
 * `color` may be a fixed css colour, or null for a "selective" outline (darkened neighbour colour).
 */
export function outline(canvas, color = '#140c1c', alphaMin = 100) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const [or, og, ob] = color ? hexToRgb(color) : [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] >= alphaMin) continue;
      let found = -1;
      if (x > 0 && src[i - 4 + 3] >= alphaMin) found = i - 4;
      else if (x < w - 1 && src[i + 4 + 3] >= alphaMin) found = i + 4;
      else if (y > 0 && src[i - w * 4 + 3] >= alphaMin) found = i - w * 4;
      else if (y < h - 1 && src[i + w * 4 + 3] >= alphaMin) found = i + w * 4;
      if (found < 0) continue;
      if (color) { d[i] = or; d[i + 1] = og; d[i + 2] = ob; }
      else { d[i] = src[found] * 0.3; d[i + 1] = src[found + 1] * 0.25; d[i + 2] = src[found + 2] * 0.35 + 10; }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Tinted silhouette of a canvas (for hit flashes). */
export function silhouette(canvas, color = '#ffffff') {
  const { canvas: c, ctx } = makeCanvas(canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Recolour pixels of `canvas` via fn(r,g,b,a,x,y) -> [r,g,b,a] | null (in place). */
export function mapPixels(canvas, fn) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data, w = canvas.width;
  for (let i = 0; i < d.length; i += 4) {
    const p = i >> 2;
    const out = fn(d[i], d[i + 1], d[i + 2], d[i + 3], p % w, (p / w) | 0);
    if (out) { d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3]; }
  }
  ctx.putImageData(img, 0, 0);
}

/** Paint a w x h texture via fn(x, y) -> css colour | null into ctx at (ox, oy). Uses ImageData. */
export function paint(ctx, ox, oy, w, h, fn) {
  const img = ctx.getImageData(ox, oy, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    if (!c) continue;
    const [r, g, b] = hexToRgb(c);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  ctx.putImageData(img, ox, oy);
}
