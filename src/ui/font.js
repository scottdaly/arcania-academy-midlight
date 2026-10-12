// Bitmap pixel font, 3x5 glyphs on a 4x6 grid (team: ui). Lowercase renders as uppercase.
// drawText is also exposed as game.ui.drawText so other teams (debug overlays) can use it.

const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001110',
  '.': '000000000000010', ',': '000000000010100', '!': '010010010000010', '?': '110001010000010',
  "'": '010010000000000', '"': '101101000000000', ':': '000010000010000', ';': '000010000010100',
  '-': '000000111000000', '+': '000010111010000', '/': '001001010100100', '(': '001010010010001',
  ')': '100010010010100', '%': '101001010100101', '=': '000111000111000', '<': '001010100010001',
  '>': '100010001010100', '_': '000000000000111', '*': '000101010101000', '#': '101111101111101',
  '[': '011010010010011', ']': '110010010010110', '&': '010101010101011', ' ': '000000000000000',
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;
export const LINE_HEIGHT = 7;

const CHARS = Object.keys(GLYPHS);
const INDEX = new Map(CHARS.map((c, i) => [c, i]));
let baseAtlas = null;
const tinted = new Map();

function buildAtlas() {
  const c = document.createElement('canvas');
  c.width = CHARS.length * ADVANCE;
  c.height = GLYPH_H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  CHARS.forEach((ch, i) => {
    const bits = GLYPHS[ch];
    for (let k = 0; k < 15; k++) if (bits[k] === '1') g.fillRect(i * ADVANCE + (k % 3), (k / 3) | 0, 1, 1);
  });
  return c;
}

function atlasFor(color) {
  baseAtlas ||= buildAtlas();
  let a = tinted.get(color);
  if (!a) {
    a = document.createElement('canvas');
    a.width = baseAtlas.width;
    a.height = baseAtlas.height;
    const g = a.getContext('2d');
    g.drawImage(baseAtlas, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, a.width, a.height);
    tinted.set(color, a);
  }
  return a;
}

/** Width in pixels of the longest line. */
export function measureText(text, scale = 1) {
  let max = 0;
  for (const line of String(text).split('\n')) max = Math.max(max, line.length * ADVANCE - (line.length ? 1 : 0));
  return max * scale;
}

/** Greedy word wrap to maxWidth pixels. Returns lines. */
export function wrapText(text, maxWidth, scale = 1) {
  const out = [];
  const maxChars = Math.max(1, Math.floor((maxWidth / scale + 1) / ADVANCE));
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (cand.length > maxChars && line) { out.push(line); line = word; } else line = cand;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw text. (x, y) = top-left (or top-centre / top-right per align).
 * opts: { color='#f4f0ff', align='left'|'center'|'right', scale=1, shadow='#140c1c'|null, alpha=1 }
 */
export function drawText(ctx, text, x, y, opts = {}) {
  const { color = '#f4f0ff', align = 'left', scale = 1, shadow = '#140c1c', alpha = 1 } = opts;
  const lines = String(text).toUpperCase().split('\n');
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = false;
  lines.forEach((line, li) => {
    const w = measureText(line, scale);
    let lx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
    const ly = Math.round(y + li * LINE_HEIGHT * scale);
    for (const pass of shadow ? [shadow, color] : [color]) {
      const atlas = atlasFor(pass);
      const off = pass === shadow && shadow ? scale : 0;
      let cx = lx;
      for (const ch of line) {
        const i = INDEX.get(ch) ?? INDEX.get('?');
        ctx.drawImage(atlas, i * ADVANCE, 0, GLYPH_W, GLYPH_H, cx + off, ly + off, GLYPH_W * scale, GLYPH_H * scale);
        cx += ADVANCE * scale;
      }
    }
  });
  ctx.restore();
}
