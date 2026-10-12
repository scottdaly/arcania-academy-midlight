// Tiny procedural pixel icons for the HUD and touch controls (team: ui).
// Each icon is a '#' mask; drawMask() bakes it once (fill, top-left highlight, bottom shade and a
// 1 px dark outline) into a cached canvas and blits it at integer coordinates.
import { COL } from './theme.js';

export const MASKS = Object.freeze({
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  drop: ['..#..', '..#..', '.###.', '#####', '#####', '#####', '.###.'],
  skull: ['.#####.', '#######', '##.#.##', '#######', '.#####.', '.#.#.#.'],
  rune0: ['...#...', '..#.#..', '.#...#.', '#..#..#', '.#...#.', '..#.#..', '...#...'],
  rune1: ['.......', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '.......'],
  bag: ['..###..', '.#...#.', '.#####.', '#######', '###.###', '#######', '.#####.'],
  pause: ['##.##', '##.##', '##.##', '##.##', '##.##'],
  anvil: ['#######', '.######', '...###.', '..###..', '.#####.'],
  dash: ['#..#...', '.#..#..', '..#..#.', '.#..#..', '#..#...'],
  star: ['...#...', '...#...', '.#####.', '..###..', '.##.##.'],
});

const cache = new Map();

function bake(name, rows, fill, hi, lo, outline) {
  const w = rows[0].length, h = rows.length;
  const c = document.createElement('canvas');
  c.width = w + 2;
  c.height = h + 2;
  const g = c.getContext('2d');
  const on = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] === '#';
  if (outline) {
    g.fillStyle = outline;
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (on(x, y)) continue;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!on(x, y)) continue;
    g.fillStyle = !on(x, y - 1) || !on(x - 1, y) ? hi : !on(x, y + 1) ? lo : fill;
    g.fillRect(x + 1, y + 1, 1, 1);
  }
  return c;
}

/** Size {w,h} of a mask (without the outline). */
export function maskSize(name) {
  const rows = MASKS[name] || MASKS.star;
  return { w: rows[0].length, h: rows.length };
}

/**
 * Draw a mask icon with its top-left (excluding outline) at (x, y).
 * colors: fill, hi (top/left edge), lo (bottom edge), outline (null = none). opts.alpha.
 */
export function drawMask(ctx, name, x, y, fill = COL.text, hi = fill, lo = fill, outline = COL.ink, alpha = 1) {
  const key = `${name}|${fill}|${hi}|${lo}|${outline}`;
  let c = cache.get(key);
  if (!c) {
    c = bake(name, MASKS[name] || MASKS.star, fill, hi, lo, outline);
    cache.set(key, c);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  if (alpha !== 1) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * alpha;
    ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1);
    ctx.globalAlpha = a;
  } else ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1);
}

/** Translucent HUD plate (readable over bright grass and dark dungeons alike). */
export function plate(ctx, x, y, w, h, edge = 'rgba(200,184,255,0.22)', alpha = 1) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.fillStyle = 'rgba(11,7,22,0.55)';
  ctx.fillRect(x, y - 1, w, h + 2);
  ctx.fillRect(x - 1, y, w + 2, h);
  ctx.fillStyle = 'rgba(28,18,48,0.78)';
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = edge;
  ctx.fillRect(x + 1, y, w - 2, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.globalAlpha = a;
}
