// Small shared helpers for the world team (pure; safe to import from Node test scripts).
import { TileMap } from '../core/tilemap.js';
import { TILE, TILE_DEFS } from '../core/tiles.js';
import { TILE_SIZE } from '../core/config.js';

export const C = (tx, ty) => TileMap.tileCenter(tx, ty);
/** Tile corner in world px (use for centring 2-wide props between two tiles). */
export const corner = (tx, ty) => ({ x: tx * TILE_SIZE, y: ty * TILE_SIZE });

/** Walkable for pathing / connectivity purposes (not solid, not a damaging hazard). */
export function walkable(map, tx, ty) {
  return !map.isSolid(tx, ty, 'walk');
}

export function isHazard(map, tx, ty) {
  return !!(TILE_DEFS[map.getGround(tx, ty)].hazard || TILE_DEFS[map.getDeco(tx, ty)].hazard);
}

/**
 * Flood fill over walkable tiles from (sx, sy). Returns Int32Array of BFS distances (-1 unreachable).
 * `blocked` (optional Set of tile indices) is treated as solid (e.g. tiles under solid props).
 */
export function floodDistances(map, sx, sy, blocked = null) {
  const { w, h } = map;
  const dist = new Int32Array(w * h).fill(-1);
  if (!walkable(map, sx, sy)) return dist;
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  const s = sy * w + sx;
  dist[s] = 0;
  q[tail++] = s;
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0;
    const d = dist[i] + 1;
    if (x > 0) visit(i - 1, x - 1, y);
    if (x < w - 1) visit(i + 1, x + 1, y);
    if (y > 0) visit(i - w, x, y - 1);
    if (y < h - 1) visit(i + w, x, y + 1);
    function visit(j, nx, ny) {
      if (dist[j] !== -1 || (blocked && blocked.has(j)) || !walkable(map, nx, ny)) return;
      dist[j] = d;
      q[tail++] = j;
    }
  }
  return dist;
}

export function countReachable(dist) {
  let n = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) n++;
  return n;
}

/**
 * Stamp an ASCII block onto a map at (ox, oy).
 * legend: { ch: { ground?, deco?, marker? } }. Unknown chars (and ' ') are skipped.
 * Markers are appended to `markers[name] = [{tx, ty, x, y}]`.
 */
export function stamp(map, ox, oy, rows, legend, markers = {}) {
  const width = rows[0].length;
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`stamp: row ${y} has length ${row.length}, expected ${width}: "${row}"`);
    for (let x = 0; x < row.length; x++) {
      const def = legend[row[x]];
      if (!def) continue;
      const tx = ox + x, ty = oy + y;
      if (def.ground != null) map.setGround(tx, ty, def.ground);
      map.setDeco(tx, ty, def.deco ?? 0);
      if (def.marker) (markers[def.marker] ||= []).push({ tx, ty, ...C(tx, ty) });
    }
  });
  return markers;
}

/** Pick a sprite key that art actually drew, else a fallback (avoids magenta placeholders). */
export function spriteOr(game, key, fallback) {
  try {
    return game.art.hasSprite(key) ? key : fallback;
  } catch {
    return fallback;
  }
}

export const isFloorTile = (id) => id > 0 && id < 20;
export { TILE };
