// Bitmap pixel font (team: ui). Proportional, 5 px cap height + 1 px descender, 1 px tracking.
// Hand-tuned glyphs (1..5 px wide) read far better on phones than a fixed 3x5 grid.
// Lowercase renders as uppercase. drawText is also exposed as game.ui.drawText so other teams
// (core's debug overlay) can use it.
//
// Rendering: every (line, colour, shadow, outline) combination is rasterised once into a small
// cached canvas, then blitted with one drawImage. HUD text that repeats every frame costs ~nothing.

/* Glyph rows: '#' = ink. 5 rows (cap height) + optional 6th descender row. */
const G = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.#.', '.#.#'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#..#', '#..#', '.##.', '#..#', '#..#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['####', '...#', '.##.', '#...', '####'],
  0: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '.#.'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['.#.', '#.#', '.#.', '#.#', '.#.'],
  9: ['.#.', '#.#', '###', '..#', '##.'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '.#', '#.'],
  '!': ['#', '#', '#', '.', '#'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  "'": ['#', '#', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  ':': ['.', '#', '.', '#', '.'],
  ';': ['..', '.#', '..', '.#', '.#', '#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '\\': ['#..', '#..', '.#.', '..#', '..#'],
  '(': ['.#', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '##'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '=': ['...', '###', '...', '###', '...'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  _: ['...', '...', '...', '...', '###'],
  '*': ['...', '#.#', '.#.', '#.#', '...'],
  '#': ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
  '&': ['.#..', '#.#.', '.#..', '#.#.', '.#.#'],
  '~': ['....', '.#.#', '#.#.', '....', '....'],
  '^': ['.#.', '#.#', '...', '...', '...'],
  '@': ['.###.', '#.###', '#.#.#', '#.###', '.##..'],
  $: ['.###', '#.#.', '.###', '..##', '###.'],
  '|': ['#', '#', '#', '#', '#'],
  ' ': ['..', '..', '..', '..', '..'],
  // ---- symbols used by the UI (keep the code points stable) ----
  '×': ['...', '#.#', '.#.', '#.#', '...'],
  '•': ['..', '##', '##', '..', '..'],
  '·': ['.', '.', '#', '.', '.'],
  '↑': ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  '↓': ['..#..', '..#..', '#.#.#', '.###.', '..#..'],
  '←': ['..#..', '.#...', '#####', '.#...', '..#..'],
  '→': ['..#..', '...#.', '#####', '...#.', '..#..'],
  '♥': ['.#.#.', '#####', '#####', '.###.', '..#..'],
  '★': ['..#..', '#####', '.###.', '.#.#.', '#...#'],
  '◆': ['..#..', '.###.', '#####', '.###.', '..#..'],
  '▶': ['#..', '##.', '###', '##.', '#..'],
  '◀': ['..#', '.##', '###', '.##', '..#'],
  '▲': ['.....', '..#..', '.###.', '#####', '.....'],
  '▼': ['.....', '#####', '.###.', '..#..', '.....'],
  '✓': ['....#', '...#.', '#.#..', '.#...', '.....'],
  '…': ['.....', '.....', '.....', '.....', '#.#.#'],
  '°': ['.#.', '#.#', '.#.', '...', '...'],
};
// Accent-free fallbacks for a few common typographic characters.
const ALIAS = { '’': "'", '‘': "'", '“': '"', '”': '"', '—': '-', '–': '-', x: 'X' };

export const GLYPH_H = 5; // cap height
export const LINE_HEIGHT = 8; // baseline-to-baseline at scale 1 (5 cap + 1 descender + 2 gap)
export const TRACKING = 1;
export const SPACE_W = 2;
/** Back-compat (old fixed-width font). Average advance. */
export const GLYPH_W = 4;
export const ADVANCE = 5;

const GLYPHS = new Map(); // char -> {w, rows}
for (const [ch, rows] of Object.entries(G)) GLYPHS.set(ch, { w: rows[0].length, rows });

function glyph(ch) {
  let g = GLYPHS.get(ch);
  if (g) return g;
  const up = ch.toUpperCase();
  g = GLYPHS.get(up) || GLYPHS.get(ALIAS[ch]) || GLYPHS.get(ALIAS[up]);
  if (!g) g = GLYPHS.get('?');
  GLYPHS.set(ch, g); // memoise the lookup
  return g;
}

/** Width in px (scale 1) of one line (no newlines). */
function lineWidth(line) {
  if (!line) return 0;
  let w = 0;
  for (const ch of line) w += (ch === ' ' ? SPACE_W : glyph(ch).w) + TRACKING;
  return w - TRACKING;
}

/** Width in pixels of the longest line. */
export function measureText(text, scale = 1) {
  let max = 0;
  for (const line of String(text).split('\n')) max = Math.max(max, lineWidth(line));
  return max * scale;
}

/** Height in px of a block of `lines` lines at `scale`. */
export function textHeight(lines = 1, scale = 1) {
  return ((lines - 1) * LINE_HEIGHT + GLYPH_H) * scale;
}

/** Greedy word wrap to maxWidth pixels. Returns lines. Long words are hard-broken. */
export function wrapText(text, maxWidth, scale = 1) {
  const out = [];
  const max = Math.max(4, maxWidth / scale);
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let word of para.split(' ')) {
      while (lineWidth(word) > max && word.length > 1) {
        // hard-break very long words
        let cut = word.length - 1;
        while (cut > 1 && lineWidth(word.slice(0, cut)) > max) cut--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const cand = line ? line + ' ' + word : word;
      if (line && lineWidth(cand) > max) { out.push(line); line = word; } else line = cand;
    }
    out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------ rasterisation + cache

const cache = new Map();
const CACHE_MAX = 600;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Rasterise one line into a canvas at scale 1 (2px padding for outline/shadow). */
function rasterLine(line, color, shadow, outline) {
  const pad = 1;
  const w = lineWidth(line) + pad * 2 + 1;
  const h = GLYPH_H + 1 + pad * 2 + 1;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  // collect ink pixels once
  const ink = [];
  let cx = pad;
  for (const ch of line) {
    if (ch === ' ') { cx += SPACE_W + TRACKING; continue; }
    const gl = glyph(ch);
    for (let r = 0; r < gl.rows.length; r++) {
      const row = gl.rows[r];
      for (let k = 0; k < row.length; k++) if (row.charCodeAt(k) === 35) ink.push(cx + k, pad + r);
    }
    cx += gl.w + TRACKING;
  }
  const plot = (dx, dy, col) => {
    g.fillStyle = col;
    for (let i = 0; i < ink.length; i += 2) g.fillRect(ink[i] + dx, ink[i + 1] + dy, 1, 1);
  };
  if (outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) plot(dx, dy, outline);
    if (shadow) plot(1, 2, shadow);
  } else if (shadow) plot(1, 1, shadow);
  plot(0, 0, color);
  return { canvas: c, pad };
}

function getLine(line, color, shadow, outline) {
  const key = line + '\u0001' + color + '\u0001' + (shadow || '') + '\u0001' + (outline || '');
  let e = cache.get(key);
  if (e) {
    // LRU-ish refresh
    cache.delete(key);
    cache.set(key, e);
    return e;
  }
  e = rasterLine(line, color, shadow, outline);
  cache.set(key, e);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return e;
}

/**
 * Draw text. (x, y) = top-left of the cap height (or top-centre / top-right per align).
 * opts: { color='#f4f0ff', align='left'|'center'|'right', scale=1, shadow='#140c1c'|null,
 *         outline=null|css (1px all-round outline, best over the busy world), alpha=1 }
 */
export function drawText(ctx, text, x, y, opts = {}) {
  const { color = '#f4f0ff', align = 'left', scale = 1, alpha = 1, outline = null } = opts;
  const shadow = opts.shadow === undefined ? '#140c1c' : opts.shadow;
  const str = String(text);
  if (!str) return;
  const prevAlpha = ctx.globalAlpha;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.imageSmoothingEnabled = false;
  const s = Math.max(1, Math.round(scale));
  const lines = str.indexOf('\n') >= 0 ? str.split('\n') : [str];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line) continue;
    const w = lineWidth(line) * s;
    const lx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
    const ly = Math.round(y + li * LINE_HEIGHT * s);
    const { canvas, pad } = getLine(line, color, shadow, outline);
    ctx.drawImage(canvas, lx - pad * s, ly - pad * s, canvas.width * s, canvas.height * s);
  }
  ctx.globalAlpha = prevAlpha;
  ctx.imageSmoothingEnabled = prevSmooth;
}

/**
 * Draw text with per-character colours / offsets (title logo, wavy banners).
 * fn(i, ch) -> {color?, dy?, alpha?} . Slower: use for a handful of big strings only.
 */
export function drawTextFx(ctx, text, x, y, opts = {}, fn = null) {
  const { align = 'left', scale = 1, outline = null } = opts;
  const shadow = opts.shadow === undefined ? '#140c1c' : opts.shadow;
  const s = Math.max(1, Math.round(scale));
  const str = String(text);
  const w = lineWidth(str) * s;
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  let i = 0;
  for (const ch of str) {
    const fxo = fn ? fn(i, ch) || {} : {};
    const cw = (ch === ' ' ? SPACE_W : glyph(ch).w) * s;
    if (ch !== ' ') {
      drawText(ctx, ch, cx, Math.round(y + (fxo.dy || 0)), {
        color: fxo.color || opts.color || '#f4f0ff', scale: s, shadow, outline, alpha: (opts.alpha ?? 1) * (fxo.alpha ?? 1),
      });
    }
    cx += cw + TRACKING * s;
    i++;
  }
}
