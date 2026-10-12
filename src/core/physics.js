// Collision helpers. Bodies are circles: anything with {x, y, radius}. Units: world px.
// Tile masks: 'walk' (TILE_DEFS.solid) for walkers, 'shot' (TILE_DEFS.blocksShot) for
// projectiles and line of sight.
import { TILE_SIZE } from './config.js';

/** Does a circle overlap any solid tile? */
export function circleHitsTiles(map, x, y, r, mask = 'walk') {
  const tx0 = Math.floor((x - r) / TILE_SIZE), tx1 = Math.floor((x + r) / TILE_SIZE);
  const ty0 = Math.floor((y - r) / TILE_SIZE), ty1 = Math.floor((y + r) / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!map.isSolid(tx, ty, mask)) continue;
      const cx = Math.max(tx * TILE_SIZE, Math.min(x, tx * TILE_SIZE + TILE_SIZE));
      const cy = Math.max(ty * TILE_SIZE, Math.min(y, ty * TILE_SIZE + TILE_SIZE));
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return true;
    }
  }
  return false;
}

/** Push a circle body out of solid tiles. Returns {hit, nx, ny} (last push normal). */
function resolveTiles(map, body, r, mask) {
  let hit = false, nx = 0, ny = 0;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const tx0 = Math.floor((body.x - r) / TILE_SIZE), tx1 = Math.floor((body.x + r) / TILE_SIZE);
    const ty0 = Math.floor((body.y - r) / TILE_SIZE), ty1 = Math.floor((body.y + r) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!map.isSolid(tx, ty, mask)) continue;
        const left = tx * TILE_SIZE, top = ty * TILE_SIZE;
        const cx = Math.max(left, Math.min(body.x, left + TILE_SIZE));
        const cy = Math.max(top, Math.min(body.y, top + TILE_SIZE));
        let dx = body.x - cx, dy = body.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) {
          // Centre inside the tile: push out along the axis of least penetration.
          const pl = body.x - left, pr = left + TILE_SIZE - body.x;
          const pt = body.y - top, pb = top + TILE_SIZE - body.y;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) { dx = -1; dy = 0; d = pl; body.x = left - r; }
          else if (m === pr) { dx = 1; dy = 0; d = pr; body.x = left + TILE_SIZE + r; }
          else if (m === pt) { dx = 0; dy = -1; d = pt; body.y = top - r; }
          else { dx = 0; dy = 1; d = pb; body.y = top + TILE_SIZE + r; }
          nx = dx; ny = dy;
        } else {
          const push = r - d;
          nx = dx / d; ny = dy / d;
          body.x += nx * push;
          body.y += ny * push;
        }
        hit = moved = true;
      }
    }
    if (!moved) break;
  }
  return { hit, nx, ny };
}

/**
 * Move a circle body by (dx, dy) with sliding collision against the tilemap.
 * Sub-steps so fast bodies cannot tunnel. Mutates body.x/body.y.
 * Returns {hit, nx, ny}: whether any wall was touched and the last contact normal.
 */
export function moveCircle(map, body, dx, dy, mask = 'walk') {
  const r = body.radius ?? 4;
  const maxStep = Math.max(1, Math.min(r, TILE_SIZE / 2));
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / maxStep));
  const sx = dx / steps, sy = dy / steps;
  let hit = false, nx = 0, ny = 0;
  for (let i = 0; i < steps; i++) {
    body.x += sx;
    body.y += sy;
    const res = resolveTiles(map, body, r, mask);
    if (res.hit) { hit = true; nx = res.nx; ny = res.ny; }
  }
  return { hit, nx, ny };
}

/**
 * Grid raycast (DDA) from (x0,y0) to (x1,y1). Returns {hit, x, y, tx, ty, dist} where x,y is
 * the first solid contact point (or the end point if clear).
 */
export function raycastTiles(map, x0, y0, x1, y1, mask = 'shot') {
  const dx = x1 - x0, dy = y1 - y0;
  const length = Math.sqrt(dx * dx + dy * dy);
  let tx = Math.floor(x0 / TILE_SIZE), ty = Math.floor(y0 / TILE_SIZE);
  if (map.isSolid(tx, ty, mask)) return { hit: true, x: x0, y: y0, tx, ty, dist: 0 };
  if (length < 1e-9) return { hit: false, x: x1, y: y1, tx, ty, dist: 0 };
  const dirX = dx / length, dirY = dy / length;
  const stepX = dirX > 0 ? 1 : -1, stepY = dirY > 0 ? 1 : -1;
  const tDeltaX = dirX !== 0 ? Math.abs(TILE_SIZE / dirX) : Infinity;
  const tDeltaY = dirY !== 0 ? Math.abs(TILE_SIZE / dirY) : Infinity;
  let tMaxX = dirX !== 0 ? ((dirX > 0 ? (tx + 1) * TILE_SIZE - x0 : x0 - tx * TILE_SIZE) / Math.abs(dirX)) : Infinity;
  let tMaxY = dirY !== 0 ? ((dirY > 0 ? (ty + 1) * TILE_SIZE - y0 : y0 - ty * TILE_SIZE) / Math.abs(dirY)) : Infinity;
  let t = 0;
  while (t <= length) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t > length) break;
    if (map.isSolid(tx, ty, mask)) return { hit: true, x: x0 + dirX * t, y: y0 + dirY * t, tx, ty, dist: t };
  }
  return { hit: false, x: x1, y: y1, tx: Math.floor(x1 / TILE_SIZE), ty: Math.floor(y1 / TILE_SIZE), dist: length };
}

export function hasLineOfSight(map, x0, y0, x1, y1) {
  return !raycastTiles(map, x0, y0, x1, y1, 'shot').hit;
}

export function circlesOverlap(a, b) {
  const r = (a.radius ?? 0) + (b.radius ?? 0);
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy < r * r;
}

export function pointInCircle(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Push two overlapping circle bodies apart, split by inverse mass (mass Infinity = immovable).
 * If `map` is given, the push respects walls. Returns true if they overlapped.
 */
export function separateCircles(a, b, map = null) {
  const r = (a.radius ?? 0) + (b.radius ?? 0);
  let dx = b.x - a.x, dy = b.y - a.y;
  let d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  let d = Math.sqrt(d2);
  if (d < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy) || 1; }
  const overlap = r - d;
  const ima = a.mass === Infinity ? 0 : 1 / (a.mass || 1);
  const imb = b.mass === Infinity ? 0 : 1 / (b.mass || 1);
  const sum = ima + imb;
  if (sum === 0) return true;
  const nx = dx / d, ny = dy / d;
  const pa = (overlap * ima) / sum, pb = (overlap * imb) / sum;
  if (map) {
    if (pa) moveCircle(map, a, -nx * pa, -ny * pa);
    if (pb) moveCircle(map, b, nx * pb, ny * pb);
  } else {
    a.x -= nx * pa; a.y -= ny * pa;
    b.x += nx * pb; b.y += ny * pb;
  }
  return true;
}
