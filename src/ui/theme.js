// Shared look & feel for every UI surface (team: ui): palette, pixel frames, buttons, bars,
// crisp pixel discs, cooldown sweeps, element emblems, key caps and easing helpers.
// Everything here draws at integer coordinates and caches generated canvases.
import { ELEMENT_COLORS } from '../core/config.js';
import { drawText, measureText } from './font.js';

export const COL = Object.freeze({
  ink: '#140c1c',
  ink2: '#0b0716',
  bg: '#1c1230',
  bg2: '#251a40',
  bg3: '#30224f',
  edge: '#7a5aff',
  edgeHi: '#c8b8ff',
  edgeLo: '#3a2a6a',
  text: '#f4f0ff',
  dim: '#8a80a8',
  dimmer: '#5a5078',
  gold: '#ffd25a',
  goldHi: '#fff2b0',
  goldLo: '#b07a20',
  bad: '#ff5a6a',
  good: '#7aff9a',
  hp: '#ff3a50',
  hpHi: '#ff9aa4',
  hpLo: '#8a1028',
  mana: '#3a7aff',
  manaHi: '#a8d0ff',
  manaLo: '#1a2a7a',
  trail: '#fff0c0',
  boss: '#ff3a8a',
  bossHi: '#ffb0d8',
});

export const RARITY = Object.freeze({
  common: { color: '#c8c8d0', hi: '#ffffff', label: 'Common' },
  rare: { color: '#4fa8ff', hi: '#bfe4ff', label: 'Rare' },
  epic: { color: '#c05aff', hi: '#ecc0ff', label: 'Epic' },
  legendary: { color: '#ffb83a', hi: '#fff0b0', label: 'Legendary' },
});
export const rarityOf = (r) => RARITY[r] || RARITY.common;

export const elColor = (el, i = 0) => (ELEMENT_COLORS[el] || ELEMENT_COLORS.physical)[i];

// ------------------------------------------------------------------ math / easing

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const easeInCubic = (t) => clamp(t, 0, 1) ** 3;
export const easeOutBack = (t) => {
  t = clamp(t, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const easeOutElastic = (t) => {
  t = clamp(t, 0, 1);
  if (t === 0 || t === 1) return t;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
/** Approach `target` exponentially (frame-rate independent). */
export const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

/** Mix two #rrggbb colours. */
export function mix(c1, c2, t) {
  const a = hex(c1), b = hex(c2);
  const r = Math.round(lerp(a[0], b[0], t)), g = Math.round(lerp(a[1], b[1], t)), bl = Math.round(lerp(a[2], b[2], t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
const hexCache = new Map();
function hex(c) {
  let v = hexCache.get(c);
  if (v) return v;
  let s = String(c).replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  hexCache.set(c, v);
  return v;
}
export function rgba(c, a) {
  const [r, g, b] = hex(c);
  return `rgba(${r},${g},${b},${a})`;
}

// ------------------------------------------------------------------ canvas cache helpers

const canvasCache = new Map();
function cached(key, w, h, draw) {
  let c = canvasCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    draw(g, c);
    canvasCache.set(key, c);
    if (canvasCache.size > 2000) canvasCache.delete(canvasCache.keys().next().value);
  }
  return c;
}

/** Crisp pixel disc (filled), optional 1px ring. Returns a (2r+1)^2 canvas. */
export function discCanvas(r, fill, ring = null, ringW = 1) {
  r = Math.max(1, Math.round(r));
  return cached(`disc:${r}:${fill}:${ring}:${ringW}`, r * 2 + 1, r * 2 + 1, (g) => {
    const rr = (r + 0.5) ** 2, ir = (r + 0.5 - ringW) ** 2;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = x * x + y * y;
        if (d > rr) continue;
        const isRing = ring && d > ir;
        if (!isRing && !fill) continue;
        g.fillStyle = isRing ? ring : fill;
        g.fillRect(x + r, y + r, 1, 1);
      }
    }
  });
}
export function drawDisc(ctx, cx, cy, r, fill, ring = null, ringW = 1) {
  const c = discCanvas(r, fill, ring, ringW);
  const rr = Math.max(1, Math.round(r));
  ctx.drawImage(c, Math.round(cx) - rr, Math.round(cy) - rr);
}
export function drawRing(ctx, cx, cy, r, color, w = 1) {
  drawDisc(ctx, cx, cy, r, null, color, w);
}

/**
 * Cooldown sweep overlay: a clockwise pie (from 12 o'clock) covering `frac` (0..1) of a circle of
 * radius r or of a w x h square. Quantised to 40 steps and cached. shape 'circle'|'rect'.
 */
export function drawSweep(ctx, x, y, w, h, frac, color = 'rgba(8,4,16,0.68)', shape = 'rect') {
  if (frac <= 0) return;
  const STEPS = 40;
  const step = Math.min(STEPS, Math.ceil(clamp(frac, 0, 1) * STEPS));
  const c = cached(`sweep:${shape}:${w}:${h}:${step}:${color}`, w, h, (g) => {
    const cx = w / 2, cy = h / 2, lim = (step / STEPS) * Math.PI * 2;
    const rr = (Math.min(w, h) / 2 + 0.25) ** 2;
    g.fillStyle = color;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
        if (shape === 'circle' && dx * dx + dy * dy > rr) continue;
        let a = Math.atan2(dx, -dy); // 0 at top, clockwise
        if (a < 0) a += Math.PI * 2;
        if (a <= lim) g.fillRect(px, py, 1, 1);
      }
    }
  });
  ctx.drawImage(c, Math.round(x), Math.round(y));
}

// ------------------------------------------------------------------ frames & panels

/** Pixel rectangle with 1px cut corners. */
export function rrect(ctx, x, y, w, h, color) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
}

/**
 * Ornate panel. opts { fill, fill2, edge, edgeHi, edgeLo, studs=true, alpha=1, glow=null }
 * Layers: outer dark outline, coloured edge, inner bevel, two-tone fill, gold corner studs.
 */
export function panel(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const { fill = COL.bg, fill2 = COL.bg2, edge = COL.edge, edgeHi = COL.edgeHi, edgeLo = COL.edgeLo, studs = true, alpha = 0.96, glow = null } = opts;
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow) {
    ctx.fillStyle = glow;
    ctx.fillRect(x - 2, y + 1, w + 4, h - 2);
    ctx.fillRect(x + 1, y - 2, w - 2, h + 4);
  }
  rrect(ctx, x - 1, y - 1, w + 2, h + 2, COL.ink);
  rrect(ctx, x, y, w, h, edge);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  // soft top band
  ctx.fillStyle = fill2;
  ctx.fillRect(x + 2, y + 2, w - 4, Math.min(h - 4, Math.max(3, Math.round((h - 4) * 0.35))));
  // bevel
  ctx.fillStyle = edgeHi;
  ctx.fillRect(x + 2, y + 1, w - 4, 1);
  ctx.fillStyle = edgeLo;
  ctx.fillRect(x + 2, y + h - 2, w - 4, 1);
  ctx.restore();
  if (studs && w > 12 && h > 12) {
    for (const [sx, sy] of [[x, y], [x + w - 3, y], [x, y + h - 3], [x + w - 3, y + h - 3]]) {
      ctx.fillStyle = COL.goldLo;
      ctx.fillRect(sx, sy, 3, 3);
      ctx.fillStyle = COL.gold;
      ctx.fillRect(sx, sy, 2, 2);
      ctx.fillStyle = COL.goldHi;
      ctx.fillRect(sx, sy, 1, 1);
    }
  }
}

/** Recessed well (slots, text fields). */
export function inset(ctx, x, y, w, h, fill = COL.ink2, edge = COL.edgeLo) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  rrect(ctx, x, y, w, h, edge);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
}

/** Header ribbon with a title, centred at cx. Returns its height. */
export function ribbon(ctx, cx, y, text, opts = {}) {
  const { color = COL.gold, fill = COL.edgeLo, edge = COL.edge, scale = 1 } = opts;
  const tw = measureText(text, scale);
  const w = tw + 16, h = 7 * scale + 4;
  const x = Math.round(cx - w / 2);
  rrect(ctx, x - 1, y - 1, w + 2, h + 2, COL.ink);
  rrect(ctx, x, y, w, h, edge);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  // swallowtails
  ctx.fillStyle = COL.ink;
  ctx.fillRect(x - 4, y + 1, 3, h - 2);
  ctx.fillRect(x + w + 1, y + 1, 3, h - 2);
  ctx.fillStyle = edge;
  ctx.fillRect(x - 3, y + 2, 2, h - 4);
  ctx.fillRect(x + w + 1, y + 2, 2, h - 4);
  drawText(ctx, text, cx, y + 2 + Math.floor(scale / 2), { align: 'center', color, scale });
  return h;
}

/**
 * Button. state { focus, pressed, disabled, accent, t (realTime for shimmer), small }
 * Draws label centred. Returns nothing; hit-testing is done by the caller's Hits registry.
 */
export function button(ctx, x, y, w, h, label, state = {}) {
  x = Math.round(x); y = Math.round(y);
  const { focus = false, pressed = false, disabled = false, accent = COL.edge, t = 0, icon = null, textColor = null } = state;
  const oy = pressed ? 1 : 0;
  rrect(ctx, x - 1, y - 1, w + 2, h + 2, COL.ink);
  if (!pressed) rrect(ctx, x, y + 1, w, h, mix(accent, COL.ink, 0.6)); // drop edge
  const face = disabled ? COL.bg : focus ? mix(accent, COL.bg2, 0.45) : COL.bg2;
  rrect(ctx, x, y + oy, w, h - 1, focus && !disabled ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : disabled ? COL.edgeLo : accent);
  ctx.fillStyle = face;
  ctx.fillRect(x + 1, y + 1 + oy, w - 2, h - 3);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(x + 1, y + 1 + oy, w - 2, Math.max(1, Math.floor((h - 3) / 2)));
  const col = textColor || (disabled ? COL.dimmer : focus ? COL.goldHi : COL.text);
  const ty = y + oy + Math.round((h - 1 - 5) / 2);
  if (icon) {
    const iw = 9, tw = measureText(label);
    const sx = Math.round(x + w / 2 - (iw + tw) / 2);
    icon(ctx, sx, ty - 1);
    drawText(ctx, label, sx + iw, ty, { color: col });
  } else drawText(ctx, label, x + w / 2, ty, { align: 'center', color: col });
}

/**
 * Animated resource bar. frac = current fill, trail = delayed damage trail (>= frac), gain = flash.
 * colors {fill, hi, lo, trail}
 */
export function bar(ctx, x, y, w, h, frac, trail = frac, colors = {}, opts = {}) {
  x = Math.round(x); y = Math.round(y);
  const { fill = COL.hp, hi = COL.hpHi, lo = COL.hpLo, trailCol = COL.trail } = colors;
  const { flash = 0, segments = 0, shimmer = 0 } = opts;
  rrect(ctx, x - 1, y - 1, w + 2, h + 2, COL.ink);
  ctx.fillStyle = '#2a1e3e';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x, y, w, 1);
  const fw = Math.round(w * clamp(frac, 0, 1));
  const tw = Math.round(w * clamp(trail, 0, 1));
  if (tw > fw) {
    ctx.fillStyle = trailCol;
    ctx.fillRect(x + fw, y, tw - fw, h);
  }
  if (fw > 0) {
    ctx.fillStyle = lo;
    ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, h - 1);
    ctx.fillStyle = hi;
    ctx.fillRect(x, y, fw, 1);
    if (shimmer > 0 && fw > 4) {
      // a moving glint along the bar
      const gx = Math.floor(((shimmer % 1) * (fw + 12)) - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let i = 0; i < 3; i++) if (gx + i >= 0 && gx + i < fw) ctx.fillRect(x + gx + i, y, 1, h - 1);
    }
  }
  if (segments > 1) {
    ctx.fillStyle = 'rgba(10,6,20,0.45)';
    for (let i = 1; i < segments; i++) ctx.fillRect(x + Math.round((w * i) / segments), y + 1, 1, h - 1);
  }
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${clamp(flash, 0, 1) * 0.8})`;
    ctx.fillRect(x, y, w, h);
  }
}

// ------------------------------------------------------------------ element emblems (7x7)

const EMBLEMS = {
  fire: ['...#...', '..##...', '..###..', '.#####.', '.##.##.', '.#...#.', '..###..'],
  ice: ['...#...', '.#.#.#.', '..###..', '###.###', '..###..', '.#.#.#.', '...#...'],
  lightning: ['....##.', '...##..', '..##...', '.#####.', '...##..', '..##...', '.##....'],
  arcane: ['...#...', '...#...', '..###..', '#######', '..###..', '...#...', '...#...'],
  earth: ['.......', '..###..', '.#####.', '###.###', '#######', '.#####.', '.......'],
  physical: ['......#', '.....#.', '#...#..', '.#.#...', '..#....', '.#.#...', '#......'],
};

/** Tiny element emblem, 7x7, top-left at (x,y). Dark outline baked in (9x9 footprint). */
export function drawEmblem(ctx, el, x, y, opts = {}) {
  const rows = EMBLEMS[el] || EMBLEMS.arcane;
  const c1 = opts.color || elColor(el, 0), c2 = opts.hi || elColor(el, 1);
  const outline = opts.outline === undefined ? COL.ink : opts.outline;
  const c = cached(`emb:${el}:${c1}:${c2}:${outline}`, 9, 9, (g) => {
    const on = (cx, cy) => cy >= 0 && cy < 7 && cx >= 0 && cx < 7 && rows[cy][cx] === '#';
    if (outline) {
      g.fillStyle = outline;
      for (let yy = -1; yy <= 7; yy++) for (let xx = -1; xx <= 7; xx++) {
        if (on(xx, yy)) continue;
        if (on(xx - 1, yy) || on(xx + 1, yy) || on(xx, yy - 1) || on(xx, yy + 1)) g.fillRect(xx + 1, yy + 1, 1, 1);
      }
    }
    for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) {
      if (!on(xx, yy)) continue;
      // highlight: pixels with no ink above get the bright tone
      g.fillStyle = !on(xx, yy - 1) || !on(xx - 1, yy) ? c2 : c1;
      g.fillRect(xx + 1, yy + 1, 1, 1);
    }
  });
  const s = opts.scale || 1;
  if (opts.alpha != null) { const a = ctx.globalAlpha; ctx.globalAlpha = a * opts.alpha; ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1, 9 * s, 9 * s); ctx.globalAlpha = a; }
  else ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1, 9 * s, 9 * s);
}

// ------------------------------------------------------------------ device glyphs

/** Draw a keyboard key cap with a label. Returns the width used. (x,y) top-left; height 9. */
export function keycap(ctx, label, x, y, opts = {}) {
  const tw = measureText(label);
  const w = Math.max(9, tw + 5), h = 9;
  x = Math.round(x); y = Math.round(y);
  const { alpha = 1, color = COL.text, face = '#3a3058', pressed = false } = opts;
  ctx.save();
  ctx.globalAlpha *= alpha;
  rrect(ctx, x, y, w, h, COL.ink);
  rrect(ctx, x + 1, y + 1, w - 2, h - 2, '#8a80a8');
  ctx.fillStyle = face;
  ctx.fillRect(x + 2, y + (pressed ? 2 : 1), w - 4, h - 4);
  ctx.restore();
  drawText(ctx, label, x + w / 2, y + (pressed ? 3 : 2), { align: 'center', color, shadow: null, alpha });
  return w;
}

/** Touch "tap" glyph (a filled circle with a ring), 9x9. Returns width. */
export function tapGlyph(ctx, x, y, opts = {}) {
  const { alpha = 1, label = null } = opts;
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawDisc(ctx, x + 4, y + 4, 4, '#3a3058', COL.edgeHi);
  ctx.restore();
  if (label) drawText(ctx, label, x + 4, y + 2, { align: 'center', color: COL.text, shadow: null, alpha });
  else { ctx.fillStyle = COL.text; ctx.fillRect(Math.round(x) + 3, Math.round(y) + 3, 3, 3); }
  return 9;
}

/** Mouse glyph (left or right button highlighted), 7x10. Returns width. */
export function mouseGlyph(ctx, x, y, which = 'left') {
  x = Math.round(x); y = Math.round(y);
  rrect(ctx, x, y, 7, 10, COL.ink);
  rrect(ctx, x + 1, y + 1, 5, 8, '#c8c0e0');
  ctx.fillStyle = COL.gold;
  ctx.fillRect(which === 'left' ? x + 1 : x + 4, y + 1, 2, 4);
  ctx.fillStyle = COL.ink;
  ctx.fillRect(x + 3, y + 1, 1, 4);
  ctx.fillRect(x + 1, y + 5, 5, 1);
  return 7;
}

// ------------------------------------------------------------------ misc

/** Full-screen dim with a subtle vignette. */
export function dim(ctx, W, H, a = 0.55) {
  ctx.fillStyle = `rgba(5,3,10,${a})`;
  ctx.fillRect(0, 0, W, H);
}

/** Draw an 8-point sparkle (pixel cross) — used for flourishes. */
export function sparkle(ctx, x, y, size, color) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = color;
  ctx.fillRect(x, y - size, 1, size * 2 + 1);
  ctx.fillRect(x - size, y, size * 2 + 1, 1);
  if (size >= 3) {
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }
}
