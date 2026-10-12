// Procedural dungeon generator (team: world). PURE and DETERMINISTIC: same (seed, depth, opts)
// gives the same map and spawn list. No game/DOM access, so scripts/dungeon-test.mjs can run it
// headless in Node.
//
// Pipeline
//   1. BSP-partition the map; one room per leaf. Room shapes: rect, pillared, round, cross, cave
//      (cellular automata, biome-weighted).
//   2. Connect rooms along the BSP tree (sibling subtrees -> closest room pair), which guarantees
//      a spanning tree, then add a few extra loop corridors so maps are not pure trees.
//   3. Connectivity repair #1: flood from the start; tunnel to (or fill) any orphaned floor region.
//   4. Biome features: liquid pools (poison/lava/deep water/chasm), magma rivers, vault rifts,
//      ground patches.
//   5. Connectivity repair #2 ("safe" walking = not solid and not a damaging hazard): any safe
//      floor that is cut off gets a BRIDGE (or plain floor over poison) along the cheapest path.
//   6. Roles: start, exit (farthest by BFS), treasure (dead ends preferred), ambush (sealable
//      rooms), cache (fragment geode clusters), shrine, monster rooms. Occasional secret room
//      behind a loose wall (excluded from connectivity until opened).
//   7. Solid props (pillars, statues...) placed one by one, each checked not to cut connectivity;
//      then cosmetic deco and wall torches.
//   8. Spawn list (pure data): enemies, ambush waves, chests, geodes, fragments, orbs, shrine,
//      portal, stairs. Every spawn sits on a safe, reachable tile.
import { TileMap } from '../core/tilemap.js';
import { TILE, TILE_DEFS } from '../core/tiles.js';
import { RNG, hashString } from '../core/rng.js';
import { biomeForDepth } from './biomes.js';
import { floodDistances, isHazard } from './util.js';

const WALL_MIN = 40, WALL_MAX = 59;
const isWallId = (id) => id === TILE.EMPTY || (id >= WALL_MIN && id <= WALL_MAX);
const LIQUID_TO_BRIDGE = new Set([TILE.WATER, TILE.DEEP_WATER, TILE.LAVA, TILE.CHASM]);

/** Safe = walkable and not a damaging hazard. */
function safe(map, tx, ty) {
  return !map.isSolid(tx, ty, 'walk') && !isHazard(map, tx, ty);
}

function safeFlood(map, sx, sy, blocked = null) {
  const { w, h } = map;
  const dist = new Int32Array(w * h).fill(-1);
  if (!safe(map, sx, sy)) return dist;
  const q = new Int32Array(w * h);
  let head = 0, tail = 0;
  dist[sy * w + sx] = 0;
  q[tail++] = sy * w + sx;
  while (head < tail) {
    const i = q[head++];
    const x = i % w, y = (i / w) | 0, d = dist[i] + 1;
    const n4 = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of n4) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (dist[j] !== -1 || (blocked && blocked.has(j)) || !safe(map, nx, ny)) continue;
      dist[j] = d;
      q[tail++] = j;
    }
  }
  return dist;
}

/** Count safe tiles reachable from start (used to validate prop placement). */
function reachCount(map, sx, sy, blocked) {
  const d = safeFlood(map, sx, sy, blocked);
  let n = 0;
  for (let i = 0; i < d.length; i++) if (d[i] >= 0) n++;
  return n;
}

// ------------------------------------------------------------------ BSP

function bspSplit(rng, node, minW, minH, level) {
  const canV = node.w >= minW * 2, canH = node.h >= minH * 2;
  const big = node.w > minW * 3 || node.h > minH * 3;
  if ((!canV && !canH) || level > 6 || (!big && level >= 3 && rng.chance(0.18))) return node;
  let vertical;
  if (canV && !canH) vertical = true;
  else if (canH && !canV) vertical = false;
  else if (node.w / node.h > 1.25) vertical = true;
  else if (node.h / node.w > 1.25) vertical = false;
  else vertical = rng.chance(0.5);
  if (vertical) {
    const s = rng.int(minW, node.w - minW);
    node.a = bspSplit(rng, { x: node.x, y: node.y, w: s, h: node.h }, minW, minH, level + 1);
    node.b = bspSplit(rng, { x: node.x + s, y: node.y, w: node.w - s, h: node.h }, minW, minH, level + 1);
  } else {
    const s = rng.int(minH, node.h - minH);
    node.a = bspSplit(rng, { x: node.x, y: node.y, w: node.w, h: s }, minW, minH, level + 1);
    node.b = bspSplit(rng, { x: node.x, y: node.y + s, w: node.w, h: node.h - s }, minW, minH, level + 1);
  }
  return node;
}

function leaves(node, out = []) {
  if (!node.a) out.push(node);
  else { leaves(node.a, out); leaves(node.b, out); }
  return out;
}

// ------------------------------------------------------------------ carving

/** Floor painter: the alternate floor forms smooth patches (value noise), not per-tile speckle. */
function makeFloorPainter(map, rng, biome) {
  const cell = 5, gw = Math.ceil(map.w / cell) + 2, gh = Math.ceil(map.h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const noise = (x, y) => {
    const fx = x / cell, fy = y / cell, x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1], c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const thr = 0.5 + (0.5 - biome.floorAltChance) * 0.8;
  return (x, y) => {
    if (x <= 0 || y <= 0 || x >= map.w - 1 || y >= map.h - 1) return;
    const n = noise(x, y) + (rng.next() - 0.5) * 0.1;
    map.setGround(x, y, n > thr ? biome.floorAlt : biome.floor);
  };
}

function carveRoom(map, rng, room, paint) {
  const { x, y, w, h } = room;
  if (room.shape === 'round') {
    const rx = w / 2, ry = h / 2, cx = x + rx - 0.5, cy = y + ry - 0.5;
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
      const dx = (tx - cx) / rx, dy = (ty - cy) / ry;
      if (dx * dx + dy * dy <= 1.05) paint(tx, ty);
    }
  } else if (room.shape === 'cross') {
    const bw = Math.max(3, Math.round(w / 2)), bh = Math.max(3, Math.round(h / 2));
    const ox = x + ((w - bw) >> 1), oy = y + ((h - bh) >> 1);
    for (let ty = oy; ty < oy + bh; ty++) for (let tx = x; tx < x + w; tx++) paint(tx, ty);
    for (let ty = y; ty < y + h; ty++) for (let tx = ox; tx < ox + bw; tx++) paint(tx, ty);
  } else if (room.shape === 'cave') {
    // Cellular automata confined to the room rect.
    let cells = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
      cells[j * w + i] = edge ? (rng.chance(0.7) ? 1 : 0) : (rng.chance(0.42) ? 1 : 0); // 1 = wall
    }
    for (let it = 0; it < 4; it++) {
      const next = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= w || b >= h || cells[b * w + a]) n++;
        }
        next[j * w + i] = n >= 5 ? 1 : 0;
      }
      cells = next;
    }
    // Force an open heart, then keep only the region connected to it.
    const ci = w >> 1, cj = h >> 1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) cells[(cj + dj) * w + ci + di] = 0;
    const keep = new Uint8Array(w * h);
    const stack = [cj * w + ci];
    keep[cj * w + ci] = 1;
    while (stack.length) {
      const k = stack.pop();
      const i = k % w, j = (k / w) | 0;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= w || b >= h) continue;
        const kk = b * w + a;
        if (keep[kk] || cells[kk]) continue;
        keep[kk] = 1;
        stack.push(kk);
      }
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (keep[j * w + i]) paint(x + i, y + j);
  } else {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) paint(tx, ty);
  }
}

function carveCorridor(map, rng, a, b, width, paint) {
  let x = a.cx, y = a.cy;
  const horizFirst = rng.chance(0.5);
  const cells = [];
  // A width-w corridor: paint a w x w brush at every step so both legs stay wide.
  const brush = (px, py) => { for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) cells.push([px + i, py + j]); };
  const stepX = () => { while (x !== b.cx) { brush(x, y); x += Math.sign(b.cx - x); } };
  const stepY = () => { while (y !== b.cy) { brush(x, y); y += Math.sign(b.cy - y); } };
  if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  brush(x, y);
  for (const [cx, cy] of cells) {
    if (cx <= 0 || cy <= 0 || cx >= map.w - 1 || cy >= map.h - 1) continue;
    if (isWallId(map.getGround(cx, cy))) paint(cx, cy);
  }
}

/** Tunnel/fill any floor region not connected (by plain walking) to the start. */
function repairWalls(map, rng, sx, sy, paint) {
  for (let iter = 0; iter < 80; iter++) {
    const dist = floodDistances(map, sx, sy);
    let orphan = -1;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0 && !isWallId(map.ground[i])) { orphan = i; break; }
    }
    if (orphan < 0) return;
    // Collect the orphan region.
    const region = [];
    const seen = new Uint8Array(dist.length);
    const stack = [orphan];
    seen[orphan] = 1;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      const x = i % map.w, y = (i / map.w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (!map.inBounds(nx, ny)) continue;
        const j = ny * map.w + nx;
        if (seen[j] || isWallId(map.ground[j])) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (region.length < 8) {
      for (const i of region) { map.ground[i] = TILE.DUNGEON_WALL; map.deco[i] = 0; }
      continue;
    }
    // Tunnel from a region tile to the nearest reachable tile.
    const r = region[(region.length / 2) | 0];
    const rx = r % map.w, ry = (r / map.w) | 0;
    let best = -1, bd = Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] < 0) continue;
      const dx = (i % map.w) - rx, dy = ((i / map.w) | 0) - ry, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    carveCorridor(map, rng, { cx: rx, cy: ry }, { cx: best % map.w, cy: (best / map.w) | 0 }, 1, paint);
  }
}

/**
 * Make every safe tile reachable from the start without touching hazards. Cut-off areas are
 * linked along the cheapest path (liquids cost more); liquids on that path become BRIDGE,
 * poison becomes plain floor.
 */
function repairSafe(map, sx, sy, biome) {
  const { w, h } = map;
  for (let iter = 0; iter < 80; iter++) {
    const dist = safeFlood(map, sx, sy);
    let target = -1;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= 0) continue;
      const x = i % w, y = (i / w) | 0;
      if (safe(map, x, y)) { target = i; break; }
    }
    if (target < 0) return;
    // Dijkstra over non-wall ground (liquids/hazards allowed at a high cost).
    const cost = new Float64Array(w * h).fill(Infinity);
    const prev = new Int32Array(w * h).fill(-1);
    const heap = [];
    const push = (i, c) => { heap.push([c, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = k * 2 + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const s = sy * w + sx;
    cost[s] = 0;
    push(s, 0);
    while (heap.length) {
      const [c, i] = pop();
      if (c > cost[i]) continue;
      if (i === target) break;
      const x = i % w, y = (i / w) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx <= 0 || ny <= 0 || nx >= w - 1 || ny >= h - 1) continue;
        const j = ny * w + nx;
        const g = map.ground[j];
        if (isWallId(g)) continue;
        const step = safe(map, nx, ny) ? 1 : 12;
        if (c + step < cost[j]) { cost[j] = c + step; prev[j] = i; push(j, c + step); }
      }
    }
    if (prev[target] < 0) {
      // Unreachable even through liquids: wall it off.
      map.ground[target] = biome.wall;
      map.deco[target] = 0;
      continue;
    }
    for (let i = target; i >= 0 && i !== s; i = prev[i]) {
      const x = i % w, y = (i / w) | 0;
      if (safe(map, x, y)) continue;
      const g = map.ground[i];
      if (LIQUID_TO_BRIDGE.has(g)) map.ground[i] = TILE.BRIDGE;
      else if (TILE_DEFS[g].hazard || TILE_DEFS[g].solid) map.ground[i] = biome.floor;
      if (TILE_DEFS[map.deco[i]].solid || TILE_DEFS[map.deco[i]].hazard) map.deco[i] = 0;
    }
  }
}

// ------------------------------------------------------------------ helpers

function roomCenterTile(map, room) {
  // Nearest safe tile to the room's centre (spiral search inside the bbox).
  for (let r = 0; r < Math.max(room.w, room.h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = room.cx + dx, y = room.cy + dy;
      if (x >= room.x && y >= room.y && x < room.x + room.w && y < room.y + room.h && safe(map, x, y)) return { tx: x, ty: y };
    }
  }
  return { tx: room.cx, ty: room.cy };
}

function openingsOf(map, room) {
  const out = [];
  const x0 = room.x - 1, y0 = room.y - 1, x1 = room.x + room.w, y1 = room.y + room.h;
  for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (!map.isSolid(x, y)) out.push({ tx: x, ty: y });
  for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) if (!map.isSolid(x, y)) out.push({ tx: x, ty: y });
  return out;
}

function weightedKey(rng, table) {
  const entries = Object.entries(table).map(([k, w]) => ({ k, weight: w }));
  return rng.weighted(entries)?.k;
}

// ------------------------------------------------------------------ main

/**
 * @param {number} seed uint32
 * @param {number} depth >= 1
 * @param {{enemyFilter?: (id)=>boolean, element?: string}} opts
 *   enemyFilter drops enemy ids combat does not define (keeps the result deterministic for a
 *   given filter). element biases fragment drops toward that element.
 */
export function generateDungeon(seed, depth, opts = {}) {
  depth = Math.max(1, depth | 0);
  const rng = new RNG((Number(seed) >>> 0) ^ hashString(`depth:${depth}`));
  const biome = biomeForDepth(depth);
  const d = Math.min(depth, 9);
  const W = 50 + d * 3, H = 38 + d * 2;
  const map = new TileMap(W, H, biome.wall);
  const paint = makeFloorPainter(map, rng, biome);

  // 1. BSP rooms ---------------------------------------------------------------
  const root = bspSplit(rng, { x: 1, y: 1, w: W - 2, h: H - 2 }, 12, 10, 0);
  const leafList = leaves(root);
  const rooms = [];
  for (const leaf of leafList) {
    const w = rng.int(Math.max(5, Math.floor(leaf.w * 0.55)), leaf.w - 2);
    const h = rng.int(Math.max(5, Math.floor(leaf.h * 0.55)), leaf.h - 2);
    const x = rng.int(leaf.x + 1, leaf.x + leaf.w - w - 1);
    const y = rng.int(leaf.y + 1, leaf.y + leaf.h - h - 1);
    let shape = 'rect';
    if (w >= 7 && h >= 7 && rng.chance(biome.caveChance)) shape = 'cave';
    else {
      const r = rng.next();
      if (r < 0.2 && w >= 7 && h >= 7) shape = 'pillared';
      else if (r < 0.35 && w >= 6 && h >= 6) shape = 'round';
      else if (r < 0.48 && w >= 7 && h >= 7) shape = 'cross';
    }
    const room = { id: rooms.length, x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1), shape, role: 'monster', edges: [] };
    leaf.room = room;
    rooms.push(room);
    carveRoom(map, rng, room, paint);
  }

  // 2. connect along the BSP tree, then extra loops --------------------------------
  const connect = (node) => {
    if (!node.a) return [node.room];
    const A = connect(node.a), B = connect(node.b);
    let best = null, bd = Infinity;
    for (const a of A) for (const b of B) {
      const dd = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
      if (dd < bd) { bd = dd; best = [a, b]; }
    }
    const width = rng.chance(0.3) ? 3 - biome.corridorWidth : biome.corridorWidth;
    carveCorridor(map, rng, best[0], best[1], width, paint);
    best[0].edges.push(best[1].id);
    best[1].edges.push(best[0].id);
    return A.concat(B);
  };
  connect(root);
  for (let i = 0; i < biome.extraLoops + (rooms.length > 10 ? 1 : 0); i++) {
    const a = rng.pick(rooms);
    let best = null, bd = Infinity;
    for (const b of rooms) {
      if (b === a || a.edges.includes(b.id)) continue;
      const dd = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
      if (dd < bd) { bd = dd; best = b; }
    }
    if (best && bd < 26 * 26) {
      carveCorridor(map, rng, a, best, biome.corridorWidth, paint);
      a.edges.push(best.id);
      best.edges.push(a.id);
    }
  }

  // 3. start room + wall repair ---------------------------------------------------
  const startRoom = rng.pick(rooms);
  startRoom.role = 'start';
  const st = roomCenterTile(map, startRoom);
  repairWalls(map, rng, st.tx, st.ty, paint);
  // Exit room = farthest room by walking distance. Chosen before hazards so it stays clean.
  let exitRoom = startRoom;
  {
    const wd = floodDistances(map, st.tx, st.ty);
    let best = -1;
    for (const room of rooms) {
      if (room === startRoom) continue;
      const c = roomCenterTile(map, room);
      const dd = wd[c.ty * W + c.tx];
      if (dd > best) { best = dd; exitRoom = room; }
    }
  }
  exitRoom.role = 'exit';
  const inExitRoom = (x, y) => x >= exitRoom.x - 1 && y >= exitRoom.y - 1 && x <= exitRoom.x + exitRoom.w && y <= exitRoom.y + exitRoom.h;

  // 4. biome features ----------------------------------------------------------
  const nearStart = (x, y, r) => Math.abs(x - st.tx) <= r && Math.abs(y - st.ty) <= r;
  for (const room of rooms) {
    if (room === startRoom || room === exitRoom) continue;
    // Ground patches (grass in the catacombs, ice in the crypts, runes in the vaults...).
    if (rng.chance(biome.patchChance)) blob(room, biome.patch, rng.int(1, 3), (g) => !isWallId(g) && !TILE_DEFS[g].liquid);
    // Liquid pools.
    if (rng.chance(biome.liquidChance)) blob(room, biome.liquid, rng.int(1, 3), (g) => !isWallId(g));
    // Vault rifts: a chasm in the heart of big rooms.
    if (biome.id === 'vaults' && room.w >= 9 && room.h >= 8 && rng.chance(0.45)) {
      for (let y = room.y + 3; y < room.y + room.h - 3; y++) for (let x = room.x + 3; x < room.x + room.w - 3; x++) {
        if (!isWallId(map.getGround(x, y))) map.setGround(x, y, TILE.CHASM);
      }
    }
  }
  // Magma rivers: a meandering band of lava across the map.
  if (biome.id === 'magma') {
    const rivers = 1 + (rng.chance(0.4) ? 1 : 0);
    for (let r = 0; r < rivers; r++) {
      let y = rng.int(6, H - 7);
      const width = rng.int(2, 3);
      for (let x = 1; x < W - 1; x++) {
        if (rng.chance(0.35)) y = Math.max(3, Math.min(H - 4, y + rng.sign()));
        for (let k = 0; k < width; k++) {
          if (nearStart(x, y + k, 3) || inExitRoom(x, y + k)) continue;
          if (!isWallId(map.getGround(x, y + k))) map.setGround(x, y + k, TILE.LAVA);
        }
      }
    }
  }
  // Keep the start area pristine.
  for (let y = st.ty - 2; y <= st.ty + 2; y++) for (let x = st.tx - 2; x <= st.tx + 2; x++) {
    const g = map.getGround(x, y);
    if (!isWallId(g) && (TILE_DEFS[g].liquid || TILE_DEFS[g].hazard || TILE_DEFS[g].solid)) map.setGround(x, y, biome.floor);
  }
  repairSafe(map, st.tx, st.ty, biome);

  function blob(room, tile, radius, canPaint) {
    const cx = rng.int(room.x + 1, room.x + room.w - 2), cy = rng.int(room.y + 1, room.y + room.h - 2);
    for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) continue;
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      if (dd > radius * radius + rng.int(0, radius)) continue;
      if (nearStart(x, y, 2)) continue;
      if (canPaint(map.getGround(x, y))) map.setGround(x, y, tile);
    }
  }

  // 5. roles -----------------------------------------------------------------------
  const dist0 = safeFlood(map, st.tx, st.ty);
  for (const room of rooms) {
    room.center = roomCenterTile(map, room);
    room.dist = dist0[room.center.ty * W + room.center.tx];
    room.openings = openingsOf(map, room);
  }
  const usable = rooms.filter((r) => r !== startRoom && r.dist > 0);
  usable.sort((a, b) => b.dist - a.dist);
  const free = () => usable.filter((r) => r.role === 'monster');
  // Treasure rooms: dead ends first, then far rooms.
  const treasureCount = 1 + (depth >= 3 ? 1 : 0) + (rng.chance(0.25) ? 1 : 0);
  const byDeadEnd = free().sort((a, b) => (a.openings.length - b.openings.length) || (b.dist - a.dist));
  for (const r of byDeadEnd.slice(0, treasureCount)) r.role = 'treasure';
  // Ambush rooms: rect-ish rooms with few, clear openings.
  const ambushCount = 1 + (depth >= 3 ? 1 : 0);
  const ambushCands = rng.shuffle(free().filter((r) => (r.shape === 'rect' || r.shape === 'pillared' || r.shape === 'cross') &&
    r.w >= 6 && r.h >= 6 && r.openings.length >= 1 && r.openings.length <= 8));
  for (const r of ambushCands.slice(0, ambushCount)) r.role = 'ambush';
  // Fragment caches.
  const cacheCount = 1 + (rooms.length >= 9 ? 1 : 0);
  for (const r of rng.shuffle(free()).slice(0, cacheCount)) r.role = 'cache';
  // Shrine.
  if (rng.chance(0.45)) { const r = rng.pick(free()); if (r) r.role = 'shrine'; }
  // A handful of rooms stay quiet so the pace breathes.
  for (const r of free()) if (rng.chance(0.15)) r.role = 'quiet';

  // 6. secret room -------------------------------------------------------------
  let secret = null;
  if (rng.chance(Math.min(0.85, 0.4 + depth * 0.06))) secret = placeSecret();
  function placeSecret() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const room = rng.pick(rooms);
      if (room === startRoom) continue;
      const dir = rng.pick(['n', 's', 'e', 'w']);
      const sw = rng.int(3, 5), sh = rng.int(3, 4), gap = rng.int(1, 2);
      let sx, sy, path = [];
      if (dir === 'e' || dir === 'w') {
        const py = rng.int(room.y + 1, room.y + room.h - 2);
        sy = Math.max(1, py - rng.int(0, sh - 1));
        if (dir === 'e') { sx = room.x + room.w + gap; for (let x = room.x + room.w; x < sx; x++) path.push([x, py]); path.unshift([room.x + room.w - 1, py]); }
        else { sx = room.x - gap - sw; for (let x = room.x - 1; x >= sx + sw; x--) path.push([x, py]); path.unshift([room.x, py]); }
      } else {
        const px = rng.int(room.x + 1, room.x + room.w - 2);
        sx = Math.max(1, px - rng.int(0, sw - 1));
        if (dir === 's') { sy = room.y + room.h + gap; for (let y = room.y + room.h; y < sy; y++) path.push([px, y]); path.unshift([px, room.y + room.h - 1]); }
        else { sy = room.y - gap - sh; for (let y = room.y - 1; y >= sy + sh; y--) path.push([px, y]); path.unshift([px, room.y]); }
      }
      // path[0] is the room-side floor tile; path[1..] are wall tiles to break through.
      const [fx, fy] = path[0];
      if (!safe(map, fx, fy)) continue;
      if (sx < 2 || sy < 2 || sx + sw > W - 2 || sy + sh > H - 2) continue;
      let ok = true;
      for (let y = sy - 1; y <= sy + sh && ok; y++) for (let x = sx - 1; x <= sx + sw && ok; x++) if (!isWallId(map.getGround(x, y))) ok = false;
      for (let k = 1; k < path.length && ok; k++) {
        const [x, y] = path[k];
        if (!isWallId(map.getGround(x, y))) ok = false;
        // The breakable wall must not touch other floor sideways (keeps it a clean 1-tile seal).
        if (k === 1) for (const [ax, ay] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (ax === fx && ay === fy) continue;
          if (ax >= sx && ax < sx + sw && ay >= sy && ay < sy + sh) continue;
          if (!isWallId(map.getGround(ax, ay)) && !path.some(([px2, py2]) => px2 === ax && py2 === ay)) ok = false;
        }
      }
      if (!ok || path.length < 2) continue;
      for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) paint(x, y);
      for (let k = 2; k < path.length; k++) paint(path[k][0], path[k][1]);
      const [wx, wy] = path[1];
      const sroom = { id: rooms.length, x: sx, y: sy, w: sw, h: sh, cx: sx + (sw >> 1), cy: sy + (sh >> 1), shape: 'rect', role: 'secret', edges: [room.id], secret: true };
      sroom.center = { tx: sroom.cx, ty: sroom.cy };
      sroom.openings = [];
      rooms.push(sroom);
      return { room: sroom.id, wall: { tx: wx, ty: wy }, from: { tx: fx, ty: fy } };
    }
    return null;
  }
  const secretWallIdx = secret ? secret.wall.ty * W + secret.wall.tx : -1;
  const secretRoom = secret ? rooms[secret.room] : null;
  const inRect = (r, x, y, m = 0) => x >= r.x + m && y >= r.y + m && x < r.x + r.w - m && y < r.y + r.h - m;

  // 7. props (connectivity-checked), deco, torches -------------------------------
  const blocked = new Set(); // tiles reserved for solid entities (chests, geodes, shrine)
  let reach = reachCount(map, st.tx, st.ty, blocked);
  const tryProp = (x, y, id) => {
    if (!safe(map, x, y) || map.getDeco(x, y) || nearStart(x, y, 2)) return false;
    if (secretRoom && inRect(secretRoom, x, y, -1)) return false;
    if (secret && Math.abs(x - secret.from.tx) + Math.abs(y - secret.from.ty) <= 1) return false;
    map.deco[y * W + x] = id;
    const n = reachCount(map, st.tx, st.ty, blocked);
    if (n !== reach - 1) { map.deco[y * W + x] = 0; return false; }
    reach = n;
    return true;
  };
  for (const room of rooms) {
    if (room.secret) continue;
    if (room.shape === 'pillared') {
      for (let y = room.y + 2; y < room.y + room.h - 2; y += 3) for (let x = room.x + 2; x < room.x + room.w - 2; x += 3) tryProp(x, y, TILE.PILLAR);
    } else if (room.role !== 'start' && room.w >= 7 && room.h >= 6 && rng.chance(0.5)) {
      const id = rng.pick(biome.props);
      for (const [x, y] of [[room.x + 1, room.y + 1], [room.x + room.w - 2, room.y + 1], [room.x + 1, room.y + room.h - 2], [room.x + room.w - 2, room.y + room.h - 2]]) {
        if (rng.chance(0.7)) tryProp(x, y, id);
      }
    }
    if (room.role !== 'start' && rng.chance(0.35)) {
      // A little clutter cluster against a wall.
      const id = rng.pick([TILE.BARREL, TILE.CRATE, TILE.RUBBLE, TILE.ROCK]);
      const x = rng.int(room.x, room.x + room.w - 1), y = room.y;
      for (let k = 0; k < 3; k++) tryProp(x + k, y, id);
    }
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const g = map.ground[i];
    if (isWallId(g)) {
      if (i === secretWallIdx) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1 && !edge; dx++) if (!isWallId(map.getGround(x + dx, y + dy))) edge = true;
      if (edge && rng.chance(biome.wallAltChance)) map.ground[i] = biome.wallAlt;
      if (safe(map, x, y + 1) && !map.getDeco(x - 1, y) && !map.getDeco(x - 2, y) && rng.chance(biome.torchChance)) map.deco[i] = TILE.TORCH_WALL;
      continue;
    }
    if (map.deco[i] || !safe(map, x, y) || nearStart(x, y, 1)) continue;
    if (rng.chance(0.045)) {
      const pick = rng.weighted(biome.deco.map(([id, weight]) => ({ id, weight })));
      if (!TILE_DEFS[pick.id].solid) map.deco[i] = pick.id;
    }
  }
  if (secret) {
    // Hint: a cobweb or bones in front of the loose stone.
    const f = secret.from;
    if (!map.getDeco(f.tx, f.ty)) map.setDeco(f.tx, f.ty, rng.chance(0.5) ? TILE.COBWEB : TILE.BONES);
  }

  // 8. spawns ----------------------------------------------------------------------
  const occupied = new Set();
  const spawns = [];
  const enemyPool = biome.enemies.filter(([id]) => !opts.enemyFilter || opts.enemyFilter(id));
  const pool = enemyPool.length ? enemyPool : [['armor_knight', 1]];
  const pickEnemy = () => rng.weighted(pool.map(([id, weight]) => ({ id, weight }))).id;
  const eliteChance = Math.min(0.4, 0.04 * depth);
  const fragTable = { ...biome.fragments };
  if (opts.element && fragTable[opts.element] != null) fragTable[opts.element] += 3;
  else if (opts.element) fragTable[opts.element] = 3;
  const pickElement = () => weightedKey(rng, fragTable);
  const fragAmount = () => rng.int(1, 1 + Math.floor(depth / 3));

  /** Free safe tiles in a room interior (margin m). `solid`: needs all 8 neighbours safe & unreserved. */
  function freeTiles(room, { margin = 1, solid = false, minStartDist = 0 } = {}) {
    const out = [];
    for (let y = room.y + margin; y < room.y + room.h - margin; y++) for (let x = room.x + margin; x < room.x + room.w - margin; x++) {
      const i = y * W + x;
      if (occupied.has(i) || !safe(map, x, y)) continue;
      if (!room.secret && dist0[i] < 0) continue;
      if (minStartDist && Math.hypot(x - st.tx, y - st.ty) < minStartDist) continue;
      if (solid) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
          const j = (y + dy) * W + x + dx;
          if ((dx || dy) && (!safe(map, x + dx, y + dy) || blocked.has(j))) ok = false;
        }
        if (!ok) continue;
      }
      out.push({ tx: x, ty: y });
    }
    return out;
  }
  const take = (t, solid = false) => {
    const i = t.ty * W + t.tx;
    occupied.add(i);
    if (solid) blocked.add(i);
    return t;
  };
  const place = (room, opts2 = {}) => {
    const list = freeTiles(room, opts2);
    if (!list.length) return null;
    return take(opts2.prefer === 'center'
      ? list.reduce((b, t) => ((t.tx - room.cx) ** 2 + (t.ty - room.cy) ** 2 < (b.tx - room.cx) ** 2 + (b.ty - room.cy) ** 2 ? t : b))
      : rng.pick(list), !!opts2.solid);
  };

  // Player start, exit portal and stairs.
  const start = take({ tx: st.tx, ty: st.ty });
  for (let y = st.ty - 1; y <= st.ty + 1; y++) for (let x = st.tx - 1; x <= st.tx + 1; x++) occupied.add(y * W + x);
  const exit = place(exitRoom, { prefer: 'center' }) || take(exitRoom.center);
  for (let y = exit.ty - 1; y <= exit.ty + 1; y++) for (let x = exit.tx - 1; x <= exit.tx + 1; x++) occupied.add(y * W + x);
  let stairs = null;
  {
    const cands = freeTiles(exitRoom, { margin: 0 }).filter((t) => Math.abs(t.tx - exit.tx) + Math.abs(t.ty - exit.ty) >= 3);
    cands.sort((a, b) => (Math.abs(a.tx - exit.tx) + Math.abs(a.ty - exit.ty)) - (Math.abs(b.tx - exit.tx) + Math.abs(b.ty - exit.ty)));
    if (!cands.length) {
      // Small cave exit rooms: look just outside the room instead.
      for (let r = 2; r <= 6 && !cands.length; r++) {
        for (let y = exit.ty - r; y <= exit.ty + r; y++) for (let x = exit.tx - r; x <= exit.tx + r; x++) {
          const i = y * W + x;
          if (map.inBounds(x, y) && !occupied.has(i) && safe(map, x, y) && dist0[i] >= 0 && Math.abs(x - exit.tx) + Math.abs(y - exit.ty) >= 2) cands.push({ tx: x, ty: y });
        }
      }
    }
    stairs = cands.length ? take(cands[0]) : null;
  }

  const ambushes = [];
  let questSpot = null;
  for (const room of rooms) {
    switch (room.role) {
      case 'monster': {
        const n = Math.min(5, rng.int(1, 2 + Math.floor(depth / 3)), Math.floor((room.w * room.h) / 12));
        for (let k = 0; k < n; k++) {
          const t = place(room, { minStartDist: 11 });
          if (t) spawns.push({ type: 'enemy', id: pickEnemy(), elite: rng.chance(eliteChance), room: room.id, ...t });
        }
        if (rng.chance(0.55)) {
          const t = place(room);
          if (t) spawns.push({ type: 'fragment', element: pickElement(), amount: fragAmount(), room: room.id, ...t });
        }
        if (rng.chance(0.2)) {
          const t = place(room);
          if (t) spawns.push({ type: rng.chance(0.6) ? 'health' : 'mana', amount: 20, room: room.id, ...t });
        }
        break;
      }
      case 'treasure': {
        const t = place(room, { solid: true, prefer: 'center' }) || place(room, { solid: true, margin: 0 });
        if (t) spawns.push({ type: 'chest', tier: tierForDepth(depth), room: room.id, ...t });
        for (let k = 0; k < 2; k++) {
          const f = place(room);
          if (f) spawns.push({ type: 'fragment', element: pickElement(), amount: fragAmount(), room: room.id, ...f });
        }
        if (!questSpot) questSpot = place(room);
        // Guardians.
        const g = Math.min(3, 1 + Math.floor(depth / 3));
        for (let k = 0; k < g; k++) {
          const e = place(room, { minStartDist: 11 });
          if (e) spawns.push({ type: 'enemy', id: pickEnemy(), elite: rng.chance(eliteChance * 1.5), room: room.id, ...e });
        }
        break;
      }
      case 'ambush': {
        room.openings = openingsOf(map, room);
        const waves = [];
        const waveCount = 1 + (depth >= 3 ? 1 : 0) + (depth >= 6 ? 1 : 0);
        for (let wv = 0; wv < waveCount; wv++) {
          const size = Math.min(5, 2 + Math.floor(depth / 2) + wv);
          const wave = [];
          for (let k = 0; k < size; k++) wave.push({ id: pickEnemy(), elite: rng.chance(eliteChance + 0.05 * wv) });
          waves.push(wave);
        }
        const reward = place(room, { solid: true, prefer: 'center' });
        const spots = freeTiles(room, { margin: 1 }).filter((t) => room.openings.every((o) => Math.abs(o.tx - t.tx) + Math.abs(o.ty - t.ty) > 2));
        rng.shuffle(spots);
        ambushes.push({
          room: room.id, rect: { x: room.x, y: room.y, w: room.w, h: room.h }, openings: room.openings, waves,
          spawnTiles: spots.slice(0, 12), reward: reward ? { tier: tierForDepth(depth), ...reward } : null,
        });
        break;
      }
      case 'cache': {
        const g = place(room, { solid: true, prefer: 'center' });
        const element = pickElement();
        if (g) {
          spawns.push({ type: 'geode', element, amount: 3 + Math.floor(depth / 2), room: room.id, ...g });
          const ring = freeTiles(room).filter((t) => Math.abs(t.tx - g.tx) <= 2 && Math.abs(t.ty - g.ty) <= 2);
          rng.shuffle(ring);
          for (const t of ring.slice(0, rng.int(3, 5))) {
            take(t);
            spawns.push({ type: 'fragment', element: rng.chance(0.7) ? element : pickElement(), amount: fragAmount(), room: room.id, ...t });
          }
        }
        const n = rng.int(0, 1 + Math.floor(depth / 3));
        for (let k = 0; k < n; k++) {
          const e = place(room, { minStartDist: 11 });
          if (e) spawns.push({ type: 'enemy', id: pickEnemy(), elite: false, room: room.id, ...e });
        }
        break;
      }
      case 'shrine': {
        const t = place(room, { solid: true, prefer: 'center' });
        if (t) spawns.push({ type: 'shrine', room: room.id, ...t });
        break;
      }
      case 'quiet': {
        if (rng.chance(0.6)) {
          const t = place(room);
          if (t) spawns.push({ type: 'fragment', element: pickElement(), amount: fragAmount(), room: room.id, ...t });
        }
        break;
      }
      case 'secret': {
        const t = place(room, { solid: true, prefer: 'center' }) || place(room, { margin: 0, solid: false, prefer: 'center' });
        if (t) spawns.push({ type: 'chest', tier: tierForDepth(depth) + 1, room: room.id, secret: true, ...t });
        const n = rng.int(3, 5);
        for (let k = 0; k < n; k++) {
          const f = place(room, { margin: 0 });
          if (f) spawns.push({ type: 'fragment', element: pickElement(), amount: fragAmount() + 1, room: room.id, ...f });
        }
        break;
      }
      default: break;
    }
  }
  // Every depth gets at least one chest.
  if (!spawns.some((p) => p.type === 'chest' && !p.secret)) {
    for (const room of [exitRoom, ...rng.shuffle(usable.slice())]) {
      const t = place(room, { solid: true, prefer: 'center' }) || place(room, { solid: true, margin: 0 });
      if (t) { spawns.push({ type: 'chest', tier: tierForDepth(depth), room: room.id, ...t }); break; }
    }
  }
  // A couple of fragments along the way in the start room to reward the first steps.
  if (rng.chance(0.6)) {
    const t = place(startRoom, { margin: 1 });
    if (t) spawns.push({ type: 'fragment', element: pickElement(), amount: 1, room: startRoom.id, ...t });
  }

  map.randomizeVariants(rng);
  map.meta = { biome: biome.id, depth, seed: Number(seed) >>> 0 };
  return {
    seed: Number(seed) >>> 0, depth, biome: biome.id, biomeName: biome.name, map, rooms,
    start, exit, stairs, spawns, ambushes, secret, questSpot, rng,
  };
}

/** Loot tier (1..4) for a dungeon depth. */
export function tierForDepth(depth) {
  return depth >= 7 ? 3 : depth >= 4 ? 2 : 1;
}
