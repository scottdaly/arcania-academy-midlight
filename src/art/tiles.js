// Procedural tileset (team: art+fx).
// drawTileImpl is called by core's TileMapRenderer via art.drawTile:
//   static tiles once into chunk caches (time = 0); TILE_DEFS[id].animated tiles every frame.
//
// Static floors/walls are generated per pixel in WORLD space (seamless, no visible grid) into a
// scratch 16x16 buffer, then blitted. Animated tiles only ever blit pre-rendered, cached frames.
// Walls auto-tile in 3/4 view: a wall with walkable ground below shows its lit FACE, otherwise its
// TOP with rims against open neighbours. Floors get ambient-occlusion under walls and soft
// fringes where grass meets path/dirt/sand. Liquids get shorelines with animated foam.
import { TILE, TILE_DEFS } from '../core/tiles.js';
import { P } from './palette.js';
import { makeCanvas, rect, px, line, disc, ellipse, poly, outline, hexToRgb, hash2, vnoise, mix, shade } from './pixel.js';

const T = TILE;
const isWall = (id) => (id >= 40 && id < 60) || id === T.EMPTY;
const isLiquid = (id) => id === T.WATER || id === T.DEEP_WATER || id === T.LAVA || id === T.POISON;

// ------------------------------------------------------------------ themes

const STONE_THEMES = {
  academy: { stone: ['#16131f', '#2c2838', '#48435a', '#6c6782', '#9590ab', '#c3bfd4'], moss: ['#1a4a26', '#2a6e30', '#43963a'] },
  crypt: { stone: ['#0c0b14', '#1a1826', '#2a2838', '#3c3a4e', '#545268', '#76748a'], moss: ['#183a20', '#2a5a2a', '#4a8a3a'], accent: '#5affb0' },
  magma: { stone: ['#100606', '#200e0c', '#341814', '#4a241e', '#62342a', '#80483a'], moss: ['#3a1408', '#7a2a0e', '#d8501a'], accent: '#ff7a1a', glowCracks: true },
  frost: { stone: ['#0c1424', '#18263e', '#26395a', '#384f78', '#526c98', '#8aa6cc'], moss: ['#a8c8e8', '#d8ecff', '#ffffff'], accent: '#9af0ff', icicles: true },
  crystal: { stone: ['#0a0c1c', '#141832', '#1e2448', '#2c3462', '#424c82', '#6470a6'], moss: ['#1a4a5a', '#2a8a9a', '#5ad8e8'], accent: '#ff7af0', shards: true },
  tower: { stone: ['#120c1e', '#221832', '#34264c', '#4a386a', '#64508c', '#8a76b4'], moss: ['#3a1a6a', '#6a3ac0', '#9a6aff'], accent: '#b05aff' },
  boss: { stone: ['#0a0610', '#180c22', '#261434', '#38204a', '#4e3062', '#6c4680'], moss: ['#1a4a12', '#3aa01e', '#7aff5a'], accent: '#7aff5a', glowCracks: true },
};
let themeResolver = () => 'academy';
export function setThemeResolver(fn) { themeResolver = fn; }
function themeOf(map) {
  try { return themeResolver(map) || 'academy'; } catch { return 'academy'; }
}

// ------------------------------------------------------------------ pixel scratch buffer

const scratch = makeCanvas(16, 16);
const simg = scratch.ctx.createImageData(16, 16);
const sd = simg.data;
const rgbOf = (c) => hexToRgb(c);

/** Fill the scratch tile via fn(lx, ly, wx, wy) -> css colour | null, then blit it at (x, y). */
function pixTile(ctx, x, y, wx0, wy0, fn) {
  for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
    const c = fn(lx, ly, wx0 + lx, wy0 + ly);
    const i = (ly * 16 + lx) * 4;
    if (!c) { sd[i + 3] = 0; continue; }
    const [r, g, b] = rgbOf(c);
    sd[i] = r; sd[i + 1] = g; sd[i + 2] = b; sd[i + 3] = 255;
  }
  scratch.ctx.putImageData(simg, 0, 0);
  ctx.drawImage(scratch.canvas, x, y);
}

/** Voronoi helper in world space. Returns {d1, d2, id, cx, cy} for cell size `s`. */
const vor = { d1: 0, d2: 0, id: 0, cx: 0, cy: 0 };
function voronoi(wx, wy, s, seed) {
  const gx = Math.floor(wx / s), gy = Math.floor(wy / s);
  let d1 = 1e9, d2 = 1e9, best = 0, bx = 0, by = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const fx = (cx + 0.15 + hash2(cx, cy, seed) * 0.7) * s, fy = (cy + 0.15 + hash2(cx, cy, seed + 1) * 0.7) * s;
    const dx = wx + 0.5 - fx, dy = wy + 0.5 - fy;
    const d = dx * dx + dy * dy;
    if (d < d1) { d2 = d1; d1 = d; best = cx * 7919 + cy * 104729; bx = fx; by = fy; } else if (d < d2) d2 = d;
  }
  vor.d1 = Math.sqrt(d1); vor.d2 = Math.sqrt(d2); vor.id = best; vor.cx = bx; vor.cy = by;
  return vor;
}

const clampI = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);

// ------------------------------------------------------------------ floor generators (world space)

function grassPx(wx, wy, flowers) {
  const g = P.grass;
  const n = vnoise(wx / 13, wy / 13, 1) * 0.55 + vnoise(wx / 4, wy / 4, 2) * 0.45;
  let i = n < 0.36 ? 1 : n < 0.62 ? 2 : 3;
  const h = hash2(wx, wy, 5);
  if (h < 0.045) return g[Math.min(5, i + 1)]; // blade tip
  if (hash2(wx, wy - 1, 5) < 0.045) return g[Math.max(0, i - 1)]; // blade shadow
  if (hash2(wx, wy, 9) < 0.0015) return P.cream; // tiny daisy
  if (flowers) {
    const c = flowerAt(wx, wy);
    if (c) return c;
  }
  return g[i];
}

const FLOWER_COLS = [['#ff7ab8', '#ffd0e8'], ['#ffe14a', '#fff8c0'], ['#f4f0ff', '#ffffff'], ['#7ab0ff', '#d0e4ff'], ['#c07aff', '#ecd0ff'], ['#ff6a4a', '#ffc0a0']];
function flowerAt(wx, wy) {
  // flowers sit on a jittered 5px grid
  const cx = Math.floor(wx / 5), cy = Math.floor(wy / 5);
  if (hash2(cx, cy, 31) > 0.55) return null;
  const fx = cx * 5 + 1 + Math.floor(hash2(cx, cy, 32) * 3), fy = cy * 5 + 1 + Math.floor(hash2(cx, cy, 33) * 3);
  const dx = wx - fx, dy = wy - fy;
  const col = FLOWER_COLS[Math.floor(hash2(cx, cy, 34) * FLOWER_COLS.length)];
  if (dx === 0 && dy === 0) return col[1];
  if (Math.abs(dx) + Math.abs(dy) === 1) return dy === 1 ? mix(col[0], '#000000', 0.25) : col[0];
  if (dx === 0 && dy === 2) return P.grass[1];
  return null;
}

function dirtPx(wx, wy) {
  const d = P.dirt;
  const n = vnoise(wx / 9, wy / 9, 11) * 0.6 + vnoise(wx / 3, wy / 3, 12) * 0.4;
  const h = hash2(wx, wy, 13);
  if (h < 0.025) return d[4];
  if (hash2(wx, wy - 1, 13) < 0.025) return d[0];
  return d[n < 0.4 ? 1 : n < 0.65 ? 2 : 3];
}

function sandPx(wx, wy) {
  const s = P.sand;
  const r = Math.sin(wy * 0.9 + vnoise(wx / 8, wy / 8, 21) * 5 + wx * 0.15);
  const h = hash2(wx, wy, 22);
  if (h < 0.02) return s[4];
  if (h > 0.985) return s[0];
  return r > 0.75 ? s[3] : r < -0.8 ? s[1] : s[2];
}

function pathPx(wx, wy) {
  const v = voronoi(wx, wy, 6, 41);
  const edge = v.d2 - v.d1;
  if (edge < 1.1) return edge < 0.55 ? P.dirt[1] : P.dirt[2];
  const tone = hash2(v.id, 0, 42);
  const base = tone < 0.33 ? P.stoneWarm[3] : tone < 0.66 ? P.stoneWarm[4] : mix(P.stoneWarm[3], P.stone[3], 0.5);
  const dy = wy + 0.5 - v.cy, dx = wx + 0.5 - v.cx;
  if (dx + dy < -2.2) return shade(base, 0.18);
  if (dx + dy > 2.5) return shade(base, -0.22);
  if (hash2(wx, wy, 43) < 0.04) return shade(base, -0.12);
  return base;
}

function flagstonePx(wx, wy, ramp, seed, rowH = 8) {
  const row = Math.floor(wy / rowH);
  const off = Math.floor(hash2(row, 0, seed) * 12);
  const sx = wx + off;
  const slabW = 12;
  const col = Math.floor(sx / slabW);
  const lx = ((sx % slabW) + slabW) % slabW, ly = ((wy % rowH) + rowH) % rowH;
  if (lx === 0 || ly === 0) return ramp[1];
  const tone = hash2(col, row, seed + 1);
  let i = tone < 0.3 ? 2 : tone < 0.85 ? 3 : 4;
  if (ly === 1 || lx === 1) i = Math.min(ramp.length - 1, i + 1);
  if (ly === rowH - 1 || lx === slabW - 1) i -= 1;
  const n = hash2(wx, wy, seed + 2);
  if (n < 0.05) i -= 1;
  // occasional crack
  if (hash2(col, row, seed + 3) < 0.18) {
    const cx = 3 + Math.floor(hash2(col, row, seed + 4) * 6);
    if (Math.abs(lx - cx - Math.round(Math.sin(ly * 1.3) * 1.2)) < 0.5 && ly > 1 && ly < rowH - 1) return ramp[1];
  }
  return ramp[clampI(i, ramp.length)];
}

function woodPx(wx, wy) {
  const w = P.wood;
  const plankH = 4;
  const row = Math.floor(wy / plankH);
  const ly = ((wy % plankH) + plankH) % plankH;
  const off = Math.floor(hash2(row, 1, 51) * 20);
  const len = 14 + Math.floor(hash2(row, 2, 51) * 10);
  const sx = wx + off;
  const seg = Math.floor(sx / len);
  const lx = ((sx % len) + len) % len;
  if (ly === plankH - 1) return w[0];
  if (lx === 0) return w[1];
  if ((lx === 1 || lx === len - 2) && ly === 1) return w[0]; // nails
  const tone = hash2(seg, row, 52);
  let i = tone < 0.4 ? 2 : 3;
  if (ly === 0) i++;
  const grain = Math.sin((wx + off) * 0.7 + Math.sin(wy * 2.1 + seg) * 2);
  if (grain > 0.85) i--;
  return w[clampI(i, w.length)];
}

function marblePx(wx, wy, tx, ty) {
  const dark = ((tx + ty) & 1) === 1;
  const m = P.marble;
  const base = dark ? mix(m[1], '#5a4a8a', 0.25) : m[3];
  const lx = wx & 15, ly = wy & 15;
  if (lx === 15 || ly === 15) return dark ? m[0] : m[1];
  if (lx === 0 || ly === 0) return dark ? m[2] : m[4];
  const n = vnoise(wx / 6, wy / 6, 61) + vnoise(wx / 2.5, wy / 2.5, 62) * 0.3;
  if (Math.abs(n - 0.75) < 0.035) return dark ? m[0] : m[2];
  if (lx + ly === 7 || lx + ly === 9) return shade(base, 0.08);
  return base;
}

function dungeonFloorPx(wx, wy, th, mossy) {
  const s = th.stone;
  const v = voronoi(wx, wy, 7, 71);
  const edge = v.d2 - v.d1;
  if (edge < 1) return s[0];
  const tone = hash2(v.id, 3, 72);
  let i = tone < 0.4 ? 2 : tone < 0.85 ? 3 : 4;
  const dy = wy + 0.5 - v.cy, dx = wx + 0.5 - v.cx;
  if (edge < 1.8 && dx + dy > 0) i -= 1;
  else if (edge < 1.8 && dx + dy < 0) i += 1;
  if (hash2(wx, wy, 73) < 0.06) i -= 1;
  let c = s[clampI(i, s.length)];
  if (mossy) {
    const n = vnoise(wx / 5, wy / 5, 74) * 0.7 + hash2(wx, wy, 75) * 0.3;
    if (n > 0.62) c = th.moss[n > 0.78 ? 2 : n > 0.7 ? 1 : 0];
  }
  return c;
}

function towerFloorPx(wx, wy, th) {
  const s = th.stone;
  // polished 16px slabs in a running bond
  const row = Math.floor(wy / 16);
  const sx = wx + (row & 1) * 8;
  const lx = ((sx % 16) + 16) % 16, ly = ((wy % 16) + 16) % 16;
  const col = Math.floor(sx / 16);
  if (lx === 15 || ly === 15) return s[1];
  const tone = hash2(col, row, 81);
  const n = vnoise(wx / 6, wy / 6, 83);
  let i = n < 0.42 ? 2 : 3;
  if (tone < 0.2) i = 2;
  if (lx === 0 || ly === 0) i = 4;
  // star inlays
  const h = hash2(wx, wy, 82);
  if (h < 0.004) return '#fff4d6';
  if (h < 0.009) return th.moss[2];
  // great inlaid circles every 80px give the floor an arcane, non-grid structure
  const cx = Math.floor(wx / 80) * 80 + 40, cy = Math.floor(wy / 80) * 80 + 40;
  const d = Math.hypot(wx + 0.5 - cx, (wy + 0.5 - cy) * 1.15);
  if (Math.abs(d - 30) < 0.55 || Math.abs(d - 24) < 0.5) return th.moss[0];
  if (d > 24 && d < 30) {
    const a = Math.atan2(wy - cy, wx - cx);
    if (Math.abs(((a / (Math.PI * 2)) * 16 + 16) % 1 - 0.5) < 0.06) return th.moss[0];
  }
  return s[clampI(i, s.length)];
}

function icePx(wx, wy) {
  const s = P.ice;
  const v = voronoi(wx, wy, 9, 91);
  if (v.d2 - v.d1 < 0.7) return s[4];
  const n = vnoise(wx / 7, wy / 7, 92);
  if (((wx + wy * 2) % 13 === 0) && n > 0.5) return s[5];
  return s[n < 0.45 ? 2 : 3];
}

function bridgePx(wx, wy, horiz) {
  const w = P.wood;
  const a = horiz ? wx : wy, b = horiz ? wy : wx;
  const plank = Math.floor(a / 4);
  const la = ((a % 4) + 4) % 4;
  if (la === 3) return w[0];
  const tone = hash2(plank, 0, 95);
  let i = tone < 0.5 ? 2 : 3;
  if (la === 0) i++;
  if (Math.sin(b * 0.8 + plank * 3) > 0.9) i--;
  return w[clampI(i, w.length)];
}

// ------------------------------------------------------------------ walls (world space)

function wallFacePx(id, th, lx, ly, wx, wy, v) {
  const s = th.stone;
  if (id === T.HEDGE) {
    const l = P.leaf;
    const n = vnoise(wx / 3, wy / 3, 101) * 0.7 + hash2(wx, wy, 102) * 0.3;
    let i = n < 0.35 ? 1 : n < 0.6 ? 2 : n < 0.8 ? 3 : 4;
    if (ly < 3) i = Math.min(5, i + 1);
    if (ly > 12) i = Math.max(0, i - (ly - 12));
    if (hash2(wx, wy, 103) < 0.01) return '#ff6a8a';
    return l[i];
  }
  if (id === T.CRYSTAL_WALL) {
    const c = P.crystal;
    const band = Math.floor((wx * 0.7 + wy) / 5);
    const lb = ((wx * 0.7 + wy) % 5 + 5) % 5;
    let i = 1 + Math.floor(hash2(band, Math.floor(wx / 6), 111) * 3);
    if (lb < 1) i = 4;
    if (ly < 2) i = 4;
    if (ly > 13) i = 0;
    return c[clampI(i, c.length)];
  }
  if (id === T.WOOD_WALL) {
    const w = P.wood;
    const plank = Math.floor(wx / 5);
    const lp = ((wx % 5) + 5) % 5;
    if (ly < 2) return ly === 0 ? w[4] : w[3];
    if (ly > 13) return w[0];
    if (lp === 4) return w[0];
    let i = hash2(plank, 0, 121) < 0.5 ? 2 : 3;
    if (lp === 0) i++;
    if ((ly === 4 || ly === 11) && lp === 2) return P.steel[2];
    return w[clampI(i, w.length)];
  }
  // masonry walls
  let ramp = s, bh = 4, bw = 8;
  if (id === T.BRICK_WALL) { ramp = P.brick; bh = 3; bw = 6; }
  if (id === T.STONE_WALL) { ramp = STONE_THEMES.academy.stone; bh = 4; bw = 9; }
  if (id === T.TOWER_WALL) { bh = 6; bw = 10; }
  if (ly === 0) return ramp[5] || ramp[4];
  if (ly === 1) return ramp[4];
  if (ly >= 14) return ly === 15 ? ramp[0] : ramp[1];
  const yy = ly - 2;
  const row = Math.floor(yy / bh);
  const by = yy % bh;
  const off = (row & 1) * Math.floor(bw / 2) + Math.floor(hash2(Math.floor(wy / 16), row, 131) * 3);
  const sx = wx + off;
  const col = Math.floor(sx / bw);
  const bx = ((sx % bw) + bw) % bw;
  if (by === bh - 1 || bx === 0) return ramp[1];
  if (id === T.DUNGEON_WALL && hash2(col, row + Math.floor(wy / 16) * 9, 132) < 0.12 && (bx === 1 || by === 0)) return ramp[1];
  const tone = hash2(col, row + Math.floor(wy / 16) * 9, 133);
  let i = tone < 0.35 ? 2 : tone < 0.85 ? 3 : 4;
  if (by === 0) i++;
  if (bx === bw - 1) i--;
  if (hash2(wx, wy, 134) < 0.07) i--;
  // gold trim line on the tower
  if (id === T.TOWER_WALL && ly === 2) return P.gold[1];
  return ramp[clampI(i, ramp.length)];
}

function wallTopPx(id, th, lx, ly, wx, wy) {
  if (id === T.HEDGE) {
    const l = P.leaf;
    const n = vnoise(wx / 3, wy / 3, 141) * 0.7 + hash2(wx, wy, 142) * 0.3;
    return l[n < 0.3 ? 2 : n < 0.6 ? 3 : n < 0.85 ? 4 : 5];
  }
  if (id === T.CRYSTAL_WALL) {
    const c = P.crystal;
    const v = voronoi(wx, wy, 5, 143);
    if (v.d2 - v.d1 < 0.8) return c[0];
    return c[1 + Math.floor(hash2(v.id, 0, 144) * 2)];
  }
  if (id === T.WOOD_WALL) return ((wx >> 2) & 1) ? P.woodDark[2] : P.woodDark[3];
  if (id === T.EMPTY) return null;
  const s = id === T.BRICK_WALL ? P.brick : id === T.STONE_WALL ? STONE_THEMES.academy.stone : th.stone;
  const n = hash2(wx, wy, 145);
  const v = vnoise(wx / 5, wy / 5, 146);
  return n < 0.06 ? s[2] : v > 0.6 ? s[1] : mix(s[0], s[1], 0.6);
}

// ------------------------------------------------------------------ static floor / wall entry

function drawGround(ctx, id, x, y, v, tx, ty, map, th, thName) {
  const wx0 = tx * 16, wy0 = ty * 16;
  const nb = (dx, dy) => (map ? map.getGround(tx + dx, ty + dy) : id);
  if (isWall(id)) {
    if (id === T.EMPTY) { drawVoid(ctx, x, y, tx, ty, nb); return; }
    const below = nb(0, 1);
    const face = !isWall(below);
    if (face) {
      pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => wallFacePx(id, th, lx, ly, wx, wy, v));
      wallFaceDetails(ctx, id, x, y, v, th, thName, tx, ty, nb);
    } else {
      pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => wallTopPx(id, th, lx, ly, wx, wy));
      // rims against open neighbours
      const rim = id === T.HEDGE ? P.leaf[5] : id === T.CRYSTAL_WALL ? P.crystal[4] : id === T.TOWER_WALL ? P.gold[2] : (id === T.STONE_WALL ? STONE_THEMES.academy.stone : th.stone)[4];
      const ink = P.ink;
      if (!isWall(nb(0, -1))) { rect(ctx, x, y, 16, 1, ink); rect(ctx, x, y + 1, 16, 1, rim); }
      if (!isWall(nb(-1, 0))) { rect(ctx, x, y, 1, 16, ink); rect(ctx, x + 1, y, 1, 16, rim); }
      if (!isWall(nb(1, 0))) { rect(ctx, x + 15, y, 1, 16, ink); rect(ctx, x + 14, y, 1, 16, shade(rim, -0.3)); }
      // top above a face: lit lip at the bottom
      if (!isWall(nb(0, 2)) && isWall(below) && id !== T.HEDGE) rect(ctx, x, y + 15, 16, 1, shade(rim, -0.15));
    }
    return;
  }
  switch (id) {
    case T.GRASS: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => grassPx(wx, wy, false)); break;
    case T.GRASS_FLOWERS: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => grassPx(wx, wy, true)); break;
    case T.DIRT: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => dirtPx(wx, wy)); break;
    case T.PATH: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => pathPx(wx, wy)); break;
    case T.SAND: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => sandPx(wx, wy)); break;
    case T.STONE_FLOOR: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => flagstonePx(wx, wy, thName === 'academy' ? STONE_THEMES.academy.stone : th.stone, 151)); break;
    case T.WOOD_FLOOR: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => woodPx(wx, wy)); break;
    case T.CARPET: drawCarpet(ctx, x, y, tx, ty, nb); break;
    case T.MARBLE: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => marblePx(wx, wy, tx, ty)); break;
    case T.DUNGEON_FLOOR: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => dungeonFloorPx(wx, wy, th, false)); break;
    case T.DUNGEON_FLOOR_MOSSY: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => dungeonFloorPx(wx, wy, th, true)); break;
    case T.TOWER_FLOOR: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => towerFloorPx(wx, wy, th)); break;
    case T.BRIDGE: {
      const horiz = !isLiquid(nb(-1, 0)) || !isLiquid(nb(1, 0)) ? false : true;
      const travelH = !(isLiquid(nb(-1, 0)) && isLiquid(nb(1, 0)));
      pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => bridgePx(wx, wy, !travelH));
      if (travelH) { if (isLiquid(nb(0, -1))) { rect(ctx, x, y, 16, 1, P.wood[0]); rect(ctx, x, y + 1, 16, 1, P.wood[4]); } if (isLiquid(nb(0, 1))) { rect(ctx, x, y + 14, 16, 1, P.wood[4]); rect(ctx, x, y + 15, 16, 1, P.wood[0]); } }
      else { rect(ctx, x, y, 1, 16, P.wood[0]); rect(ctx, x + 15, y, 1, 16, P.wood[0]); }
      void horiz;
      break;
    }
    case T.ICE_FLOOR: pixTile(ctx, x, y, wx0, wy0, (lx, ly, wx, wy) => icePx(wx, wy)); break;
    case T.CHASM: drawChasm(ctx, x, y, tx, ty, nb, th); return;
    default: {
      const def = TILE_DEFS[id];
      rect(ctx, x, y, 16, 16, def?.liquid ? '#2a6ab8' : '#3a3448');
    }
  }
  floorFringes(ctx, id, x, y, tx, ty, nb);
  floorShadows(ctx, x, y, nb);
}

/** Ambient occlusion: dark band under walls, softer along wall sides. */
function floorShadows(ctx, x, y, nb) {
  const up = nb(0, -1), l = nb(-1, 0), r = nb(1, 0);
  if (isWall(up)) {
    ctx.fillStyle = 'rgba(10,6,24,0.45)'; ctx.fillRect(x, y, 16, 2);
    ctx.fillStyle = 'rgba(10,6,24,0.22)'; ctx.fillRect(x, y + 2, 16, 2);
    ctx.fillStyle = 'rgba(10,6,24,0.1)'; ctx.fillRect(x, y + 4, 16, 2);
  }
  if (isWall(l)) { ctx.fillStyle = 'rgba(10,6,24,0.28)'; ctx.fillRect(x, y, 2, 16); }
  if (isWall(r)) { ctx.fillStyle = 'rgba(10,6,24,0.18)'; ctx.fillRect(x + 15, y, 1, 16); }
  if (!isWall(up) && isWall(nb(-1, -1))) { ctx.fillStyle = 'rgba(10,6,24,0.25)'; ctx.fillRect(x, y, 2, 2); }
}

// grass overhangs lower-priority ground with ragged tufts
const FRINGE_PRI = { [T.GRASS]: 3, [T.GRASS_FLOWERS]: 3, [T.DIRT]: 2, [T.SAND]: 2, [T.PATH]: 1, [T.DUNGEON_FLOOR_MOSSY]: 2, [T.DUNGEON_FLOOR]: 1 };
function floorFringes(ctx, id, x, y, tx, ty, nb) {
  const me = FRINGE_PRI[id];
  if (!me) return;
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    const n = nb(dx, dy);
    const np = FRINGE_PRI[n];
    if (!np || np <= me) continue;
    const grassy = n === T.GRASS || n === T.GRASS_FLOWERS;
    const mossy = n === T.DUNGEON_FLOOR_MOSSY;
    const cols = grassy ? [P.grass[1], P.grass[2], P.grass[3]] : mossy ? null : n === T.SAND ? [P.sand[1], P.sand[2], P.sand[3]] : [P.dirt[1], P.dirt[2], P.dirt[3]];
    if (!cols) continue;
    for (let k = 0; k < 16; k++) {
      const wx = tx * 16 + (dx === 0 ? k : 0), wy = ty * 16 + (dy === 0 ? k : 0);
      const depth = 1 + Math.floor(hash2(wx + dx * 7, wy + dy * 7, 161) * (grassy ? 3.5 : 2.5));
      for (let d = 0; d < depth; d++) {
        const lx = dx === 0 ? k : dx < 0 ? d : 15 - d;
        const ly = dy === 0 ? k : dy < 0 ? d : 15 - d;
        const c = d === depth - 1 ? cols[0] : cols[1 + ((k + d) & 1)];
        ctx.fillStyle = c;
        ctx.fillRect(x + lx, y + ly, 1, 1);
      }
    }
  }
}

function drawCarpet(ctx, x, y, tx, ty, nb) {
  const red = ['#2a0812', '#4e0e22', '#7a1a34', '#9a2a44', '#c04a5a'];
  const gold = P.gold;
  const isC = (dx, dy) => nb(dx, dy) === T.CARPET;
  const up = isC(0, -1), dn = isC(0, 1), lf = isC(-1, 0), rt = isC(1, 0);
  pixTile(ctx, x, y, tx * 16, ty * 16, (lx, ly, wx, wy) => {
    const eu = up ? 99 : ly, ed = dn ? 99 : 15 - ly, el = lf ? 99 : lx, er = rt ? 99 : 15 - lx;
    const e = Math.min(eu, ed, el, er);
    if (e === 0) return red[0];
    if (e === 1) return gold[2];
    if (e === 2) return red[1];
    if (e === 3) return (wx + wy) & 1 ? gold[1] : red[2];
    const a = ((wx + wy) % 8 + 8) % 8, b = ((wx - wy) % 8 + 8) % 8;
    if (a === 0 || b === 0) return red[3];
    if ((a === 4 && b === 4)) return gold[3];
    const n = hash2(wx, wy, 171);
    return n < 0.08 ? red[1] : red[2];
  });
}

function drawVoid(ctx, x, y, tx, ty, nb) {
  rect(ctx, x, y, 16, 16, '#05030a');
  if (hash2(tx, ty, 181) < 0.3) px(ctx, x + Math.floor(hash2(tx, ty, 182) * 16), y + Math.floor(hash2(tx, ty, 183) * 16), '#1a1230');
}

function drawChasm(ctx, x, y, tx, ty, nb, th) {
  rect(ctx, x, y, 16, 16, '#030208');
  const above = nb(0, -1);
  if (above !== T.CHASM && above !== T.EMPTY) {
    const s = th.stone;
    for (let lx = 0; lx < 16; lx++) {
      const h = 4 + Math.floor(hash2(tx * 16 + lx, ty, 191) * 3);
      for (let ly = 0; ly < h; ly++) {
        const t = ly / h;
        ctx.fillStyle = ly === 0 ? s[4] : t < 0.4 ? s[2] : t < 0.75 ? s[1] : s[0];
        ctx.fillRect(x + lx, y + ly, 1, 1);
      }
    }
  }
  for (let i = 0; i < 2; i++) if (hash2(tx, ty, 192 + i) < 0.35) px(ctx, x + Math.floor(hash2(tx, ty, 194 + i) * 16), y + 8 + Math.floor(hash2(tx, ty, 196 + i) * 8), i ? '#2a1a4a' : '#3a2a6a');
}

function wallFaceDetails(ctx, id, x, y, v, th, thName, tx, ty, nb) {
  const h = (k) => hash2(tx, ty, 200 + k);
  if (id === T.STONE_WALL || (id === T.TOWER_WALL && v % 6 === 0)) {
    // arched window with warm light
    if (v % 7 === 0) {
      const glassTop = id === T.TOWER_WALL ? '#b8a0ff' : '#ffe9a0', glassBot = id === T.TOWER_WALL ? '#6a4ad8' : '#ffa84a';
      rect(ctx, x + 4, y + 4, 8, 9, P.ink);
      rect(ctx, x + 5, y + 3, 6, 1, P.ink);
      for (let ly = 0; ly < 8; ly++) {
        const w = ly === 0 ? 4 : 6;
        ctx.fillStyle = mix(glassTop, glassBot, ly / 8);
        ctx.fillRect(x + 8 - w / 2, y + 4 + ly, w, 1);
      }
      rect(ctx, x + 7, y + 4, 2, 8, P.ink); rect(ctx, x + 5, y + 8, 6, 1, P.ink);
      rect(ctx, x + 4, y + 13, 8, 1, STONE_THEMES.academy.stone[5]);
      px(ctx, x + 5, y + 5, '#ffffff');
      return;
    }
  }
  if (id === T.STONE_WALL && v % 7 === 3) {
    // hanging ivy
    for (let k = 0; k < 5; k++) {
      const cx = 1 + Math.floor(h(k) * 14), len = 3 + Math.floor(h(k + 5) * 9);
      for (let ly = 0; ly < len; ly++) {
        const xx = cx + Math.round(Math.sin(ly * 0.9 + k) * 0.8);
        ctx.fillStyle = ly % 3 === 0 ? P.leaf[4] : P.leaf[2 + (ly & 1)];
        ctx.fillRect(x + xx, y + ly, ly % 3 === 0 ? 2 : 1, 1);
      }
    }
  }
  if (id === T.DUNGEON_WALL) {
    if (thName === 'crypt' || thName === 'academy') {
      // moss drips
      for (let k = 0; k < 3; k++) if (h(k) < 0.5) {
        const cx = Math.floor(h(k + 3) * 15), len = 1 + Math.floor(h(k + 6) * 5);
        rect(ctx, x + cx, y + 1, 2, 1, th.moss[1]); rect(ctx, x + cx, y + 2, 1, len, th.moss[0]); px(ctx, x + cx, y + 2 + len, th.moss[1]);
      }
    }
    if (th.icicles) {
      for (let k = 0; k < 4; k++) if (h(k) < 0.7) {
        const cx = Math.floor(h(k + 3) * 15), len = 2 + Math.floor(h(k + 6) * 5);
        for (let ly = 0; ly < len; ly++) { ctx.fillStyle = ly === len - 1 ? '#ffffff' : P.ice[3 + (ly === 0 ? 1 : 0)]; ctx.fillRect(x + cx, y + 2 + ly, ly < len / 2 ? 2 : 1, 1); }
      }
      rect(ctx, x, y, 16, 2, '#e8f4ff');
    }
    if (th.glowCracks) {
      const cx = 3 + Math.floor(h(1) * 10);
      if (h(2) < 0.55) {
        let xx = cx;
        for (let ly = 6 + Math.floor(h(3) * 4); ly < 15; ly++) { xx += Math.round((hash2(tx, ly, 210) - 0.5) * 2); ctx.fillStyle = ly > 12 ? th.accent : th.moss[1]; ctx.fillRect(x + xx, y + ly, 1, 1); }
        rect(ctx, x + cx - 2, y + 14, 5, 1, th.moss[2]);
      }
    }
    if (th.shards && h(4) < 0.35) {
      const cx = 3 + Math.floor(h(5) * 10);
      poly(ctx, [x + cx, y + 15, x + cx + 2, y + 7, x + cx + 4, y + 15], th.moss[1]);
      line(ctx, x + cx + 1, y + 14, x + cx + 2, y + 8, th.moss[2]);
      poly(ctx, [x + cx + 4, y + 15, x + cx + 6, y + 10, x + cx + 7, y + 15], th.moss[0]);
    }
    if (thName === 'boss' && h(6) < 0.25) {
      rect(ctx, x + 6, y + 5, 4, 6, P.ink); px(ctx, x + 7, y + 6, th.accent); px(ctx, x + 8, y + 9, th.accent); px(ctx, x + 7, y + 8, '#c05aff');
    }
  }
  if (id === T.TOWER_WALL && v % 9 === 4) {
    // glowing rune stone
    const c = '#c08aff';
    rect(ctx, x + 5, y + 5, 6, 6, STONE_THEMES.tower.stone[1]);
    line(ctx, x + 6, y + 6, x + 9, y + 9, c); line(ctx, x + 9, y + 6, x + 6, y + 9, c); px(ctx, x + 7, y + 5, c);
  }
  // shadowed sides where the face turns a corner
  if (!isWall(nb(-1, 0))) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x, y + 2, 1, 12); }
  if (!isWall(nb(1, 0))) { ctx.fillStyle = 'rgba(10,6,24,0.35)'; ctx.fillRect(x + 15, y + 2, 1, 14); }
}

// ------------------------------------------------------------------ animated ground (cached frames)

const animCache = new Map();
function cached(key, w, h, draw) {
  let c = animCache.get(key);
  if (!c) {
    const m = makeCanvas(w, h);
    draw(m.ctx);
    animCache.set(key, (c = m.canvas));
  }
  return c;
}

const LIQ_FRAMES = 8;
function liquidFrame(id, f, qx, qy) {
  // Liquids tile with a 64px period (4x4 tiles) so large lakes do not show a 16px repeat.
  return cached(`liq:${id}:${f}:${qx}:${qy}`, 16, 16, (c) => {
    const ph = (f / LIQ_FRAMES) * Math.PI * 2;
    const TAU = Math.PI * 2;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const X = qx * 16 + x, Y = qy * 16 + y;
      let col;
      if (id === T.WATER || id === T.DEEP_WATER) {
        const r = id === T.WATER ? P.water : P.deep;
        const n = vnoise(X / 8, Y / 8, 301, 8);
        col = n < 0.42 ? r[2] : r[3];
        const crest = Math.sin(TAU * (Y / 16 + 0.18 * Math.sin(TAU * X / 32 + ph)) - ph);
        const n2 = vnoise(X / 6, Y / 6, 302, 0) ;
        if (crest > 0.9 && n2 > 0.35) col = r[4];

        const tw = hash2(X, Y, 303);
        if (tw < 0.012 && Math.sin(ph + tw * 900) > 0.6) col = r[5];
      } else if (id === T.LAVA) {
        const r = P.lava;
        const e = voronoiP(X, Y, 64, 10, 312);
        const pulse = 0.5 + 0.5 * Math.sin(ph + X * 0.1 + Y * 0.07);
        const n = vnoise(X / 5, Y / 5, 313, 0);
        if (e < 0.8) col = pulse > 0.5 ? r[5] : r[4];
        else if (e < 1.8) col = r[3];
        else col = n < 0.35 ? r[1] : n < 0.7 ? r[2] : r[3];
        if (e >= 1.8 && n > 0.82 && pulse > 0.6) col = r[4];
      } else {
        const r = P.poison;
        const n = vnoise(X / 7, Y / 7, 321, 0);
        col = n < 0.45 ? r[1] : r[2];
        const crest = Math.sin(TAU * (X / 20 + Y / 28) + ph + Math.sin(TAU * Y / 64) * 2);
        if (crest > 0.985) col = r[3];
      }
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1);
    }
    if (id === T.POISON) {
      // bubbles: grow over the cycle then pop
      for (let k = 0; k < 2; k++) {
        const bx = 2 + Math.floor(hash2(qx, qy, 330 + k) * 12), by = 2 + Math.floor(hash2(qx, qy, 340 + k) * 12);
        const st = (f + k * 4 + qx + qy) % LIQ_FRAMES;
        if (st < 5) { const rr = st < 2 ? 0 : 1; disc(c, bx, by, rr, P.poison[3]); px(c, bx - rr, by - rr, P.poison[5]); }
        else if (st === 5) { px(c, bx - 1, by, P.poison[5]); px(c, bx + 1, by, P.poison[5]); px(c, bx, by - 1, P.poison[4]); }
      }
    }
  });
}

/** Voronoi edge distance with period `per` px and roughly `cell`-px cells. */
function voronoiP(x, y, per, cell, seed) {
  const n = Math.max(1, Math.round(per / cell));
  const cs = per / n;
  const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
  let d1 = 1e9, d2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const fx = (cx + 0.2 + hash2(wx, wy, seed) * 0.6) * cs, fy = (cy + 0.2 + hash2(wx, wy, seed + 1) * 0.6) * cs;
    const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}

// tileable voronoi edge distance inside one 16px tile (period 16)
function voronoiT(x, y, s, seed) {
  const n = Math.round(16 / s);
  const cs = 16 / n;
  const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
  let d1 = 1e9, d2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const wx = ((cx % n) + n) % n, wy = ((cy % n) + n) % n;
    const fx = (cx + 0.2 + hash2(wx, wy, seed) * 0.6) * cs, fy = (cy + 0.2 + hash2(wx, wy, seed + 1) * 0.6) * cs;
    const d = Math.hypot(x + 0.5 - fx, y + 0.5 - fy);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}

/** Shoreline overlay for a liquid tile: mask bits 1=up 2=right 4=down 8=left are "land". */
function shoreFrame(id, mask, f, thName) {
  return cached(`shore:${id}:${mask}:${f}:${thName}`, 16, 16, (c) => {
    const lava = id === T.LAVA, poison = id === T.POISON;
    const bank = lava ? ['#1a0806', '#2e120c', '#4a1e14'] : poison ? ['#0e1a0a', '#1e2e14', '#2e4a1e'] : thName === 'academy' ? [P.dirt[0], P.dirt[1], P.dirt[2]] : [STONE_THEMES[thName]?.stone[0] || '#111', STONE_THEMES[thName]?.stone[1] || '#222', STONE_THEMES[thName]?.stone[2] || '#333'];
    const foam = lava ? [P.lava[4], P.lava[5]] : poison ? [P.poison[4], P.poison[5]] : ['#b8ecff', '#ffffff'];
    const wob = (k) => Math.round(Math.sin(k * 0.9 + f * 0.785) * 0.6 + Math.sin(k * 2.3 - f * 0.785) * 0.4);
    if (mask & 1) {
      // far bank: a dark wet lip with the land's edge, then foam
      for (let x = 0; x < 16; x++) {
        const h = 3 + wob(x);
        c.fillStyle = bank[0]; c.fillRect(x, 0, 1, h);
        c.fillStyle = bank[1]; c.fillRect(x, 0, 1, Math.max(1, h - 2));
        c.fillStyle = foam[(x + f) & 1]; c.fillRect(x, h, 1, 1);
      }
    }
    if (mask & 4) for (let x = 0; x < 16; x++) { const h = 1 + Math.max(0, wob(x + 5)); c.fillStyle = foam[(x + f + 1) & 1]; c.fillRect(x, 16 - h, 1, 1); c.fillStyle = bank[2]; c.fillRect(x, 15, 1, 1); }
    if (mask & 8) for (let y = 0; y < 16; y++) { const w = 1 + Math.max(0, wob(y + 9)); c.fillStyle = bank[1]; c.fillRect(0, y, 1, 1); c.fillStyle = foam[(y + f) & 1]; c.fillRect(w, y, 1, 1); }
    if (mask & 2) for (let y = 0; y < 16; y++) { const w = 1 + Math.max(0, wob(y + 3)); c.fillStyle = bank[1]; c.fillRect(15, y, 1, 1); c.fillStyle = foam[(y + f + 1) & 1]; c.fillRect(15 - w, y, 1, 1); }
  });
}

function drawLiquid(ctx, id, x, y, v, t, tx, ty, map) {
  const fps = id === T.LAVA ? 4 : id === T.POISON ? 5 : 6;
  const f = Math.floor(t * fps) % LIQ_FRAMES;
  ctx.drawImage(liquidFrame(id, f, tx & 3, ty & 3), x, y);
  if (!map) return;
  const land = (dx, dy) => { const n = map.getGround(tx + dx, ty + dy); return !isLiquid(n) && n !== T.BRIDGE ? 1 : 0; };
  const mask = land(0, -1) | (land(1, 0) << 1) | (land(0, 1) << 2) | (land(-1, 0) << 3);
  if (mask) ctx.drawImage(shoreFrame(id, mask, f, themeOf(map)), x, y);
}

// rune sigils: ['l', x0, y0, x1, y1] lines and ['c', cx, cy, r] circles
const RING = [['c', 8, 8, 6], ['d', 8, 2], ['d', 8, 14], ['d', 2, 8], ['d', 14, 8]];
const RUNE_GLYPHS = [
  [...RING, ['c', 8, 8, 2], ['l', 8, 4, 8, 6], ['l', 8, 10, 8, 12]],
  [...RING, ['l', 8, 4, 11, 10], ['l', 11, 10, 5, 10], ['l', 5, 10, 8, 4]],
  [...RING, ['l', 5, 5, 11, 11], ['l', 11, 5, 5, 11], ['c', 8, 8, 1]],
  [...RING, ['l', 8, 4, 12, 8], ['l', 12, 8, 8, 12], ['l', 8, 12, 4, 8], ['l', 4, 8, 8, 4], ['d', 8, 8]],
  [...RING, ['c', 8, 8, 3], ['l', 4, 8, 12, 8]],
  [...RING, ['l', 6, 4, 6, 12], ['l', 10, 4, 10, 12], ['l', 6, 8, 10, 8]].filter((g, i) => i < 5).concat([['c', 8, 8, 3], ['d', 8, 8], ['l', 5, 5, 6, 6], ['l', 11, 5, 10, 6], ['l', 5, 11, 6, 10], ['l', 11, 11, 10, 10]]),
];
function drawGlyph(c, glyph, col, dx = 0, dy = 0) {
  c.fillStyle = col;
  for (const g of glyph) {
    if (g[0] === 'l') line(c, g[1] + dx, g[2] + dy, g[3] + dx, g[4] + dy, col);
    else if (g[0] === 'd') c.fillRect(g[1] + dx, g[2] + dy, 1, 1);
    else {
      const [, cx, cy, r] = g;
      for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; c.fillRect(Math.round(cx + dx + Math.cos(a) * r), Math.round(cy + dy + Math.sin(a) * r), 1, 1); }
    }
  }
}
function runeFloorBase(v, thName) {
  return cached(`runefloor:${v % RUNE_GLYPHS.length}:${thName}`, 16, 16, (c) => {
    const th = STONE_THEMES[thName] || STONE_THEMES.tower;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      c.fillStyle = (x === 15 || y === 15) ? th.stone[0] : (x === 0 || y === 0) ? th.stone[3] : th.stone[1 + ((hash2(x, y, 401) < 0.15) ? 1 : 0)];
      c.fillRect(x, y, 1, 1);
    }
    rect(c, 1, 1, 14, 1, th.stone[0]); rect(c, 1, 14, 14, 1, th.stone[2]); rect(c, 1, 1, 1, 14, th.stone[0]); rect(c, 14, 1, 1, 14, th.stone[2]);
    drawGlyph(c, RUNE_GLYPHS[v % RUNE_GLYPHS.length], th.stone[0]);
  });
}
function runeFloorGlow(v, thName) {
  return cached(`runeglow:${v % RUNE_GLYPHS.length}:${thName}`, 16, 16, (c) => {
    const col = thName === 'boss' ? '#7aff5a' : '#c08aff';
    const gl = RUNE_GLYPHS[v % RUNE_GLYPHS.length];
    c.globalAlpha = 0.3;
    drawGlyph(c, gl, col, 1, 0); drawGlyph(c, gl, col, 0, 1);
    c.globalAlpha = 1;
    drawGlyph(c, gl, col);
    for (const g of gl) if (g[0] === 'd') px(c, g[1], g[2], '#ffffff');
  });
}

// ------------------------------------------------------------------ deco sprites (cached)

const decoCache = new Map();
function decoSprite(key, draw, doOutline = true) {
  let c = decoCache.get(key);
  if (!c) {
    const m = makeCanvas(16, 16);
    draw(m.ctx);
    if (doOutline) outline(m.canvas);
    decoCache.set(key, (c = m.canvas));
  }
  return c;
}

function bushShape(c, cx, cy, rx, ry, lf, seed) {
  ellipse(c, cx, cy + 1, rx, ry, lf[1]);
  ellipse(c, cx - 1, cy, rx - 1, ry - 1, lf[2]);
  ellipse(c, cx - 2, cy - 1, Math.max(1, rx - 3), Math.max(1, ry - 2), lf[3]);
  for (let i = 0; i < 10; i++) {
    const x = cx - rx + Math.floor(hash2(i, seed, 501) * rx * 2), y = cy - ry + Math.floor(hash2(i, seed, 502) * ry * 2);
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy < 0.8) px(c, x, y, i & 1 ? lf[4] : lf[3]);
  }
}

const DECO_DRAW = {
  [T.TREE]: (c, v) => {
    const lf = v % 5 === 4 ? ['#3a0e2a', '#6a1e4a', '#a83a6a', '#e070a0', '#ffb0d0'] : P.leaf;
    rect(c, 7, 11, 3, 5, P.wood[2]); px(c, 7, 11, P.wood[3]); rect(c, 9, 12, 1, 4, P.wood[1]); rect(c, 6, 15, 5, 1, P.wood[1]);
    bushShape(c, 8, 7, 7, 6, lf, v);
    if (v % 5 === 2) for (let i = 0; i < 4; i++) { px(c, 4 + ((i * 5 + v) % 9), 4 + ((i * 3 + v) % 6), '#ff4a4a'); }
  },
  [T.BUSH]: (c, v) => {
    bushShape(c, 8, 10, 6, 4, P.leaf, v);
    if (v & 1) for (let i = 0; i < 5; i++) px(c, 4 + ((i * 3 + v) % 9), 8 + ((i * 2 + v) % 4), (v & 2) ? '#ff7ab8' : '#5a8aff');
  },
  [T.ROCK]: (c, v) => {
    const s = P.stone;
    ellipse(c, 8, 11, 6, 4, s[2]); ellipse(c, 7, 10, 4, 3, s[3]); ellipse(c, 6, 9, 2, 1, s[4]);
    px(c, 11, 12, s[1]); line(c, 9, 9, 11, 12, s[1]);
    if (v & 1) { rect(c, 4, 8, 4, 1, P.grass[3]); px(c, 5, 7, P.grass[4]); }
  },
  [T.FLOWERS]: (c, v) => {
    const col = FLOWER_COLS[v % FLOWER_COLS.length];
    for (let i = 0; i < 9; i++) {
      const x = 2 + Math.floor(hash2(i, v, 513) * 12), y = 9 + Math.floor(hash2(i, v, 514) * 6);
      px(c, x, y, P.leaf[3]); px(c, x + 1, y - 1, P.leaf[4]); px(c, x, y + 1, P.leaf[1]);
    }
    for (let i = 0; i < 5; i++) {
      const x = 2 + Math.floor(hash2(i, v, 511) * 11), y = 5 + Math.floor(hash2(i, v, 512) * 8);
      rect(c, x, y + 1, 1, 3, P.grass[2]); px(c, x + 1, y + 3, P.grass[3]);
      px(c, x - 1, y, col[0]); px(c, x + 1, y, col[0]); px(c, x, y - 1, col[0]); px(c, x, y + 1, mix(col[0], '#000', 0.2)); px(c, x, y, col[1]);
    }
  },
  [T.BOOKSHELF]: (c, v) => {
    const w = P.woodDark;
    rect(c, 1, 0, 14, 16, w[2]); rect(c, 1, 0, 14, 1, w[4]); rect(c, 1, 0, 1, 16, w[3]); rect(c, 14, 0, 1, 16, w[1]);
    const books = ['#a83a3a', '#3a6aa8', '#3a8a4a', '#d8b04a', '#7a3aa8', '#2a7a7a', '#c86a2a'];
    for (let r = 0; r < 3; r++) {
      const sy = 1 + r * 5;
      rect(c, 2, sy, 12, 4, w[0]);
      let x = 2;
      let k = 0;
      while (x < 14) {
        const bw = 1 + Math.floor(hash2(k, r, v + 521) * 2);
        const bh = 3 + Math.floor(hash2(k, r, v + 522) * 2) - (hash2(k, r, v + 525) < 0.1 ? 1 : 0);
        if (hash2(k, r, v + 523) < 0.12 && r === 0 && v % 3 === 0) { px(c, x, sy + 2, '#7aff5a'); px(c, x, sy + 3, '#3aa01e'); x += 2; k++; continue; }
        const col = books[Math.floor(hash2(k, r, v + 524) * books.length)];
        rect(c, x, sy + 4 - bh, Math.min(bw, 14 - x), bh, col);
        px(c, x, sy + 4 - bh, shade(col, 0.3));
        if (bw > 1) px(c, x + 1, sy + 2, P.gold[3]);
        x += bw;
        k++;
      }
      rect(c, 2, sy + 4, 12, 1, w[3]);
    }
  },
  [T.TABLE]: (c, v) => {
    const w = P.wood;
    rect(c, 1, 5, 14, 6, w[3]); rect(c, 1, 5, 14, 1, w[4]); rect(c, 1, 10, 14, 1, w[1]);
    rect(c, 2, 11, 2, 5, w[1]); rect(c, 12, 11, 2, 5, w[1]);
    const k = v % 4;
    if (k === 0) { rect(c, 4, 6, 5, 3, '#c8c0a8'); rect(c, 4, 6, 5, 1, P.cream); line(c, 5, 7, 8, 7, '#6a5a4a'); px(c, 11, 4, P.cream); rect(c, 11, 5, 1, 2, P.cream); px(c, 11, 3, '#ffd25a'); }
    if (k === 1) { disc(c, 10, 6, 2, '#7a3aa8'); px(c, 10, 3, '#c8d8f0'); px(c, 9, 5, '#ffb8ff'); rect(c, 3, 6, 4, 2, '#7a2430'); }
    if (k === 2) { rect(c, 4, 6, 3, 2, P.cream); rect(c, 8, 6, 4, 2, '#d8c890'); px(c, 12, 5, '#5a3a20'); }
    if (k === 3) { disc(c, 8, 7, 2, '#5ad8ff'); px(c, 7, 6, '#ffffff'); rect(c, 6, 9, 5, 1, P.brass[2]); }
  },
  [T.PILLAR]: (c, v) => {
    const m = P.marble;
    rect(c, 4, 2, 8, 12, m[2]); rect(c, 4, 2, 2, 12, m[4]); rect(c, 6, 2, 2, 12, m[3]); rect(c, 10, 2, 2, 12, m[1]);
    rect(c, 3, 0, 10, 2, m[3]); rect(c, 3, 0, 10, 1, m[4]); rect(c, 3, 14, 10, 2, m[1]); rect(c, 3, 14, 10, 1, m[2]);
    for (let y = 3; y < 14; y += 1) px(c, 8, y, m[1]);
    if (v % 3 === 0) { line(c, 5, 10, 6, 3, P.leaf[3]); px(c, 4, 6, P.leaf[4]); px(c, 6, 8, P.leaf[2]); }
  },
  [T.STATUE]: (c, v) => {
    const m = P.marble;
    rect(c, 2, 12, 12, 4, m[1]); rect(c, 2, 12, 12, 1, m[3]);
    rect(c, 5, 6, 6, 6, m[2]); rect(c, 5, 6, 2, 6, m[3]); rect(c, 4, 10, 8, 2, m[2]);
    disc(c, 8, 4, 2, m[3]); poly(c, [5, 3, 11, 3, 8, -1], m[2]); rect(c, 4, 3, 8, 1, m[3]);
    rect(c, 11, 2, 1, 9, m[1]); disc(c, 11, 1, 1, '#5ad8ff');
  },
  [T.BANNER]: (c, v) => {
    const cols = [['#3a1670', '#5e2aa8', '#8a4ad8'], ['#5a1420', '#9a2432', '#cc3a44'], ['#164030', '#24644a', '#3a9068'], ['#141040', '#251f78', '#3d36b0']];
    const [d, b, l] = cols[v % cols.length];
    rect(c, 2, 1, 12, 1, P.brass[3]); px(c, 1, 1, P.brass[4]); px(c, 14, 1, P.brass[4]);
    rect(c, 3, 2, 10, 11, b); rect(c, 3, 2, 2, 11, l); rect(c, 11, 2, 2, 11, d);
    poly(c, [3, 13, 13, 13, 13, 15, 8, 12, 3, 15], b);
    rect(c, 3, 3, 10, 1, P.gold[3]); rect(c, 3, 11, 10, 1, P.gold[2]);
    // crest: star + book
    px(c, 8, 5, P.gold[4]); rect(c, 7, 6, 3, 1, P.gold[3]); px(c, 8, 7, P.gold[3]); rect(c, 6, 8, 5, 2, P.gold[2]); px(c, 8, 8, d);
  },
  [T.RUBBLE]: (c, v) => {
    const s = P.stone;
    for (let i = 0; i < 6; i++) {
      const x = 2 + Math.floor(hash2(i, v, 531) * 11), y = 6 + Math.floor(hash2(i, v, 532) * 8), r = hash2(i, v, 533) < 0.4 ? 2 : 1;
      rect(c, x, y, r + 1, r, s[3]); px(c, x, y, s[4]); px(c, x + r, y + r - 1, s[1]);
    }
  },
  [T.MUSHROOMS]: (c, v, th) => {
    const cap = th === 'magma' ? ['#8a2a0e', '#ff7a3a', '#ffd25a'] : th === 'frost' ? ['#2a4a8a', '#7ab4ff', '#e6fbff'] : th === 'crystal' ? ['#6a1a7a', '#e070e0', '#ffd0ff'] : ['#0e6a5a', '#3ae0b0', '#c8fff0'];
    const ms = [[5, 12, 3], [10, 13, 2], [8, 9, 2], [12, 10, 1]];
    for (const [x, y, r] of ms.slice(0, 2 + (v % 3))) {
      rect(c, x, y, 1, r + 2, '#d8d0c0'); px(c, x, y + r + 1, '#9a9080');
      ellipse(c, x, y, r, Math.max(1, r - 1), cap[1]);
      rect(c, x - r, y, r * 2 + 1, 1, cap[0]);
      px(c, x - 1, y - 1, cap[2]); if (r > 1) px(c, x + 1, y - 1, cap[2]);
    }
    px(c, 3, 8, cap[2]); px(c, 13, 7, cap[2]);
  },
  [T.FENCE]: (c, v) => {
    const w = P.wood;
    rect(c, 2, 5, 2, 10, w[3]); rect(c, 12, 5, 2, 10, w[3]); px(c, 2, 5, w[4]); px(c, 12, 5, w[4]);
    rect(c, 0, 7, 16, 2, w[2]); rect(c, 0, 11, 16, 2, w[2]); rect(c, 0, 7, 16, 1, w[4]); rect(c, 0, 11, 16, 1, w[3]);
    rect(c, 3, 5, 1, 10, w[1]); rect(c, 13, 5, 1, 10, w[1]);
  },
  [T.BARREL]: (c, v) => {
    const w = P.wood;
    ellipse(c, 8, 9, 5, 6, w[2]); rect(c, 3, 5, 10, 9, w[2]);
    rect(c, 3, 5, 2, 9, w[3]); rect(c, 11, 5, 2, 9, w[1]);
    rect(c, 3, 6, 10, 1, P.steel[2]); rect(c, 3, 12, 10, 1, P.steel[2]);
    ellipse(c, 8, 4, 5, 1, w[3]); ellipse(c, 8, 4, 3, 0, w[1]);
    if (v & 1) { px(c, 6, 9, '#7aff5a'); }
  },
  [T.CRATE]: (c, v) => {
    const w = P.wood;
    rect(c, 2, 4, 12, 11, w[3]); rect(c, 2, 4, 12, 1, w[4]); rect(c, 2, 14, 12, 1, w[1]);
    rect(c, 2, 4, 1, 11, w[4]); rect(c, 13, 4, 1, 11, w[1]);
    line(c, 3, 5, 12, 13, w[1]); line(c, 3, 6, 11, 13, w[2]);
    rect(c, 2, 8, 12, 1, w[1]);
  },
  [T.CHAIR]: (c, v) => {
    const w = P.wood;
    rect(c, 4, 2, 8, 6, w[2]); rect(c, 4, 2, 8, 1, w[4]); rect(c, 5, 3, 6, 4, '#7a2430');
    rect(c, 3, 8, 10, 3, w[3]); rect(c, 3, 8, 10, 1, w[4]);
    rect(c, 4, 11, 1, 4, w[1]); rect(c, 11, 11, 1, 4, w[1]);
  },
  [T.POTTED_PLANT]: (c, v) => {
    const pot = v & 1 ? ['#6a2a1a', '#a84a2a', '#d8703a'] : ['#2a3a6a', '#3a5aa8', '#6a8ad8'];
    rect(c, 5, 10, 6, 5, pot[1]); rect(c, 4, 9, 8, 2, pot[2]); rect(c, 5, 10, 2, 5, pot[2]); rect(c, 9, 11, 2, 4, pot[0]);
    const lf = P.leaf;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.45;
      const len = 4 + (i % 3);
      line(c, 8, 9, 8 + Math.cos(a) * len, 9 + Math.sin(a) * len, i & 1 ? lf[3] : lf[4]);
    }
    if (v % 3 === 0) { px(c, 8, 2, '#ff7ab8'); px(c, 5, 4, '#ff7ab8'); }
  },
  [T.BONES]: (c, v) => {
    const b = P.marble;
    disc(c, 6, 10, 2, b[3]); rect(c, 5, 10, 1, 1, P.ink); rect(c, 7, 10, 1, 1, P.ink); rect(c, 5, 12, 3, 1, b[2]);
    line(c, 9, 13, 14, 10, b[3]); px(c, 9, 12, b[4]); px(c, 14, 11, b[4]);
    line(c, 2, 14, 5, 14, b[2]);
  },
  [T.COBWEB]: (c, v) => {
    const col = 'rgba(220,220,240,0.7)';
    c.fillStyle = col;
    for (let i = 0; i < 16; i++) { c.fillRect(i, 0, 1, 1); c.fillRect(0, i, 1, 1); }
    line(c, 0, 0, 12, 12, col); line(c, 0, 0, 15, 6, col); line(c, 0, 0, 6, 15, col);
    for (const r of [4, 8, 12]) { line(c, r, 0, 0, r, col); }
  },
  [T.RUG]: null, // autotiled below
};

function drawRug(ctx, x, y, v, tx, ty, map) {
  const same = (dx, dy) => map && map.getDeco(tx + dx, ty + dy) === T.RUG;
  const up = same(0, -1), dn = same(0, 1), lf = same(-1, 0), rt = same(1, 0);
  const key = `rug:${up}${dn}${lf}${rt}:${v % 2}`;
  const can = decoSprite(key, (c) => {
    const base = v % 2 ? ['#123a5a', '#1e5a8a', '#3a8ac0'] : ['#3a1a5a', '#5a2a8a', '#8a4ac0'];
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
      const e = Math.min(up ? 99 : ly - 1, dn ? 99 : 14 - ly, lf ? 99 : lx - 1, rt ? 99 : 14 - lx);
      if (e < 0) continue;
      let col = base[1];
      if (e === 0) col = P.gold[2];
      else if (e === 1) col = base[0];
      else if ((lx + ly) % 4 === 0 && e > 2) col = base[2];
      c.fillStyle = col; c.fillRect(lx, ly, 1, 1);
    }
    if (!up) for (let lx = 1; lx < 15; lx += 2) px(c, lx, 0, P.cream);
    if (!dn) for (let lx = 1; lx < 15; lx += 2) px(c, lx, 15, P.cream);
  }, false);
  ctx.drawImage(can, x, y);
}

function drawStaticDeco(ctx, id, x, y, v, tx, ty, map, thName) {
  if (id === T.RUG) return drawRug(ctx, x, y, v, tx, ty, map);
  const draw = DECO_DRAW[id];
  if (!draw) {
    rect(ctx, x + 5, y + 5, 6, 6, '#ff00ff');
    return;
  }
  const nv = id === T.BOOKSHELF ? v % 12 : id === T.TREE || id === T.BUSH ? v % 10 : v % 8;
  const key = `deco:${id}:${nv}:${id === T.MUSHROOMS ? thName : ''}`;
  if (id === T.COBWEB) {
    // web sits in the corner closest to walls
    const lw = map && isWall(map.getGround(tx - 1, ty)), rw = map && isWall(map.getGround(tx + 1, ty));
    const can = decoSprite(key, (c) => draw(c, nv, thName), false);
    ctx.save();
    if (rw && !lw) { ctx.translate(x + 16, y); ctx.scale(-1, 1); ctx.drawImage(can, 0, 0); }
    else ctx.drawImage(can, x, y);
    ctx.restore();
    return;
  }
  // a small contact shadow anchors props to the ground
  if (id !== T.FLOWERS && id !== T.BANNER && id !== T.RUBBLE && id !== T.BONES) {
    ctx.fillStyle = 'rgba(10,6,24,0.3)';
    ctx.fillRect(x + 3, y + 14, 10, 2);
  }
  ctx.drawImage(decoSprite(key, (c) => draw(c, nv, thName), id !== T.FLOWERS), x, y);
}

// ---- animated deco (pre-rendered frames)

function flameFrames(f, big) {
  return (c, ox, oy) => {
    const h = big ? 7 : 5;
    const sway = [0, 1, 0, -1, 0, 1][f % 6];
    for (let i = 0; i < h; i++) {
      const t = i / h;
      const w = Math.max(0, Math.round((big ? 3 : 2) * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.1))));
      const xx = ox + Math.round(sway * t);
      c.fillStyle = t > 0.7 ? '#ff6a1f' : '#ff8a2a';
      c.fillRect(xx - w, oy - i, w * 2 + 1, 1);
      if (w > 0) { c.fillStyle = '#ffd25a'; c.fillRect(xx - w + 1, oy - i, Math.max(1, w * 2 - 1), 1); }
      if (i < h * 0.45) { c.fillStyle = '#fff8d0'; c.fillRect(xx, oy - i, 1, 1); }
    }
    if (f % 3 === 0) { c.fillStyle = '#ffd25a'; c.fillRect(ox + sway, oy - h - 1, 1, 1); }
  };
}

function animDeco(id, f, v, thName) {
  const key = `adeco:${id}:${f}:${v}:${thName}`;
  let can = decoCache.get(key);
  if (can) return can;
  const m = makeCanvas(16, 16);
  const c = m.ctx;
  switch (id) {
    case T.TORCH_WALL: {
      rect(c, 6, 9, 4, 2, P.steel[2]); rect(c, 7, 11, 2, 3, P.steel[1]); px(c, 6, 9, P.steel[3]);
      rect(c, 7, 7, 2, 2, P.wood[2]);
      flameFrames(f, false)(c, 8, 7);
      break;
    }
    case T.BRAZIER: {
      rect(c, 3, 9, 10, 3, P.steel[1]); rect(c, 3, 9, 10, 1, P.steel[3]); rect(c, 4, 12, 1, 4, P.steel[1]); rect(c, 11, 12, 1, 4, P.steel[1]); rect(c, 7, 12, 2, 4, P.steel[0]);
      rect(c, 4, 8, 8, 1, '#ff5a10');
      flameFrames(f, true)(c, 8, 8);
      flameFrames((f + 3) % 6, false)(c, 5, 8);
      flameFrames((f + 1) % 6, false)(c, 11, 8);
      break;
    }
    case T.CANDLES: {
      for (const [cx, h, o] of [[5, 6, 0], [9, 8, 2], [12, 5, 4]]) {
        rect(c, cx, 15 - h, 2, h, P.cream); px(c, cx, 15 - h, '#ffffff'); rect(c, cx + 1, 16 - h, 1, h - 1, '#d8c8a0');
        const fl = (f + o) % 4;
        px(c, cx, 13 - h - (fl & 1), '#ffd25a'); px(c, cx, 14 - h, '#ff8a2a'); if (fl < 2) px(c, cx, 12 - h, '#fff8d0');
      }
      rect(c, 3, 15, 11, 1, '#d8c8a0');
      break;
    }
    case T.LANTERN: {
      rect(c, 7, 6, 2, 10, P.steel[1]); px(c, 7, 6, P.steel[3]); rect(c, 5, 15, 6, 1, P.steel[1]);
      rect(c, 5, 1, 6, 6, P.steel[1]); rect(c, 4, 0, 8, 1, P.steel[2]);
      const glow = ['#ffe9a0', '#fff4c8', '#ffd890', '#fff4c8'][f % 4];
      rect(c, 6, 2, 4, 4, glow); px(c, 7, 3, '#ffffff'); rect(c, 8, 2, 1, 4, P.steel[1]);
      break;
    }
    case T.CRYSTAL: {
      const cr = thName === 'magma' ? ['#5a1a08', '#c8501a', '#ff9a3a', '#ffe0a0'] : thName === 'crystal' || thName === 'tower' ? ['#4a1a6a', '#a03ac0', '#ff7af0', '#ffe0ff'] : thName === 'boss' ? ['#1a4a12', '#3aa01e', '#7aff5a', '#e0ffd0'] : ['#145a8a', '#2a96c8', '#5ad8ff', '#e0fbff'];
      const pulse = Math.sin((f / 8) * Math.PI * 2) * 0.5 + 0.5;
      const shard = (x0, base, h, w) => {
        poly(c, [x0, base, x0 + w / 2, base - h, x0 + w, base], cr[1]);
        line(c, x0 + 1, base - 1, x0 + w / 2, base - h + 1, cr[2]);
        px(c, Math.round(x0 + w / 2), base - h, pulse > 0.5 ? '#ffffff' : cr[3]);
      };
      shard(2, 15, 7, 4); shard(9, 15, 8, 4); shard(5, 15, 12, 5);
      if (pulse > 0.6) { px(c, 3, 3 + (f % 3), cr[3]); px(c, 13, 5, cr[3]); }
      outline(m.canvas);
      break;
    }
    case T.CAULDRON: {
      ellipse(c, 8, 11, 6, 4, '#24202c'); rect(c, 2, 8, 12, 4, '#24202c'); ellipse(c, 6, 10, 2, 2, '#3a3448');
      ellipse(c, 8, 7, 6, 2, '#3a3448');
      ellipse(c, 8, 7, 5, 1, '#5aff4a');
      rect(c, 4, 7, 8, 1, '#7aff5a');
      const bx = 4 + ((f * 3) % 8);
      px(c, bx, 6 - (f % 2), '#c8ffb0'); px(c, 12 - ((f * 5) % 8), 6, '#b8ff9a');
      if (f % 3 === 0) px(c, 7, 3 - (f % 2), '#9aff7a');
      rect(c, 4, 14, 2, 2, '#1a1820'); rect(c, 10, 14, 2, 2, '#1a1820');
      rect(c, 6, 15, 4, 1, f & 1 ? '#ff8a2a' : '#ffd25a');
      break;
    }
    case T.FOUNTAIN: {
      const m2 = P.marble;
      ellipse(c, 8, 11, 7, 4, m2[1]); ellipse(c, 8, 10, 7, 3, m2[3]); ellipse(c, 8, 10, 5, 2, P.water[3]);
      rect(c, 7, 4, 2, 6, m2[2]); rect(c, 7, 4, 1, 6, m2[3]); ellipse(c, 8, 4, 2, 1, m2[3]);
      const sp = ['#b8ecff', '#ffffff'];
      const k = f % 6;
      px(c, 8, 1, sp[k & 1]); px(c, 7, 2, sp[(k + 1) & 1]); px(c, 9, 2, sp[k & 1]);
      px(c, 5 - (k % 2), 3 + k % 3, sp[0]); px(c, 11 + (k % 2), 3 + (k + 1) % 3, sp[0]);
      px(c, 4 + (k % 3), 9, '#ffffff'); px(c, 11 - (k % 3), 10, '#b8ecff');
      break;
    }
    case T.RUNE_CIRCLE: break; // drawn by drawRuneCircle
    default: rect(c, 5, 5, 6, 6, '#ff00ff');
  }
  decoCache.set(key, (can = m.canvas));
  return can;
}

/** Rune circles merge into one big magic circle across a contiguous block of RUNE_CIRCLE tiles. */
function drawRuneCircle(ctx, x, y, v, t, tx, ty, map, thName) {
  let x0 = tx, x1 = tx, y0 = ty, y1 = ty;
  if (map) {
    while (x0 > 0 && map.getDeco(x0 - 1, ty) === T.RUNE_CIRCLE && tx - x0 < 8) x0--;
    while (map.getDeco(x1 + 1, ty) === T.RUNE_CIRCLE && x1 - tx < 8) x1++;
    while (y0 > 0 && map.getDeco(tx, y0 - 1) === T.RUNE_CIRCLE && ty - y0 < 8) y0--;
    while (map.getDeco(tx, y1 + 1) === T.RUNE_CIRCLE && y1 - ty < 8) y1++;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ox = tx - x0, oy = ty - y0;
  const col = thName === 'boss' ? '#7aff5a' : '#c08aff';
  const key = `runecirc:${bw}x${bh}:${ox},${oy}:${col}`;
  const can = decoSprite(key, (c) => {
    const W = bw * 16, H = bh * 16;
    const cx = W / 2 - ox * 16, cy = H / 2 - oy * 16;
    const R = Math.min(W, H) / 2 - 1;
    c.fillStyle = col;
    for (let ly = 0; ly < 16; ly++) for (let lx = 0; lx < 16; lx++) {
      const dx = lx + 0.5 - cx, dy = ly + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let on = Math.abs(d - R) < 0.6 || Math.abs(d - R * 0.78) < 0.5;
      if (!on && d < R * 0.78 && d > R * 0.3) {
        // hexagram
        for (let k = 0; k < 6; k++) {
          const a1 = (k / 6) * Math.PI * 2 - Math.PI / 2, a2 = ((k + 2) / 6) * Math.PI * 2 - Math.PI / 2;
          const ax = Math.cos(a1) * R * 0.78, ay = Math.sin(a1) * R * 0.78, bx = Math.cos(a2) * R * 0.78, by = Math.sin(a2) * R * 0.78;
          const l = Math.hypot(bx - ax, by - ay);
          const dist = Math.abs((bx - ax) * (ay - dy) - (ax - dx) * (by - ay)) / l;
          if (dist < 0.55) { on = true; break; }
        }
      }
      if (!on && d > R * 0.8 && d < R * 0.97 && Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 3 === 0 && Math.abs(d - R * 0.88) < 0.6) on = true;
      if (on) c.fillRect(lx, ly, 1, 1);
    }
  }, false);
  const pulse = 0.55 + 0.35 * Math.sin(t * 2 + (tx + ty) * 0.2);
  ctx.globalAlpha = pulse;
  ctx.drawImage(can, x, y);
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ entry

export function drawTileImpl(ctx, id, def, x, y, v, t, tx = 0, ty = 0, map = null) {
  const thName = themeOf(map);
  const th = STONE_THEMES[thName] || STONE_THEMES.academy;
  if (id < 60) {
    if (isLiquid(id)) return drawLiquid(ctx, id, x, y, v, t, tx, ty, map);
    if (id === T.RUNE_FLOOR) {
      ctx.drawImage(runeFloorBase(v, thName), x, y);
      ctx.globalAlpha = 0.3 + 0.25 * Math.sin(t * 2.2 + (tx * 0.7 + ty * 0.5));
      ctx.drawImage(runeFloorGlow(v, thName), x, y);
      ctx.globalAlpha = 1;
      return;
    }
    return drawGround(ctx, id, x, y, v, tx, ty, map, th, thName);
  }
  // deco
  if (def?.animated) {
    if (id === T.RUNE_CIRCLE) return drawRuneCircle(ctx, x, y, v, t, tx, ty, map, thName);
    if (id === T.TORCH_WALL && map && !isWall(map.getGround(tx, ty))) {
      // torch placed on open ground: give it a wall face to hang on
      const wallId = thName === 'tower' || thName === 'boss' ? T.TOWER_WALL : thName === 'academy' ? T.STONE_WALL : T.DUNGEON_WALL;
      drawGround(ctx, wallId, x, y, v, tx, ty, { getGround: (gx, gy) => (gy > ty ? T.STONE_FLOOR : wallId) }, th, thName);
    }
    const n = id === T.CRYSTAL ? 8 : id === T.CANDLES || id === T.LANTERN ? 4 : 6;
    const fps = id === T.CRYSTAL ? 5 : id === T.LANTERN ? 3 : 10;
    const f = Math.floor(t * fps + (v & 7) * 0.7) % n;
    if (id === T.CRYSTAL || id === T.CAULDRON || id === T.FOUNTAIN || id === T.BRAZIER || id === T.LANTERN) {
      ctx.fillStyle = 'rgba(10,6,24,0.3)'; ctx.fillRect(x + 3, y + 14, 10, 2);
    }
    ctx.drawImage(animDeco(id, f, id === T.CRYSTAL ? 0 : 0, id === T.CRYSTAL ? thName : ''), x, y);
    return;
  }
  drawStaticDeco(ctx, id, x, y, v, tx, ty, map, thName);
}

export const THEMES = Object.keys(STONE_THEMES);
