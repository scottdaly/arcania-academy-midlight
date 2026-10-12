// `node scripts/dungeon-test.mjs [seeds=300] [maxDepth=9]` - headless world-generation test (team: world).
// Generates many dungeons and asserts determinism, connectivity and spawn validity; also checks
// the hub, all tower floors, the boss arena and dialogue text lengths. Exits non-zero on failure.
import { generateDungeon } from '../src/world/dungeon-gen.js';
import { generateTowerFloor, generateBossArena } from '../src/world/tower.js';
import { buildHubMap, HUB_SPOTS } from '../src/world/hub.js';
import { DIALOGUES } from '../src/world/dialogue.js';
import { TILE, TILE_DEFS } from '../src/core/tiles.js';
import { TOWER_FLOORS } from '../src/core/config.js';

const SEEDS = Number(process.argv[2]) || 300;
const MAX_DEPTH = Number(process.argv[3]) || 9;
const failures = [];
const fail = (ctx, msg) => { if (failures.length < 60) failures.push(`${ctx}: ${msg}`); else failures.length++; };

const solid = (map, x, y) => map.isSolid(x, y, 'walk');
const hazard = (map, x, y) => !!(TILE_DEFS[map.getGround(x, y)].hazard || TILE_DEFS[map.getDeco(x, y)].hazard);
const safe = (map, x, y) => !solid(map, x, y) && !hazard(map, x, y);

function flood(map, sx, sy, blocked = new Set(), { allowHazard = false } = {}) {
  const { w, h } = map;
  const d = new Int32Array(w * h).fill(-1);
  const ok = (x, y) => (allowHazard ? !solid(map, x, y) : safe(map, x, y)) && !blocked.has(y * w + x);
  if (!ok(sx, sy)) return d;
  const q = [sy * w + sx];
  d[q[0]] = 0;
  for (let head = 0; head < q.length; head++) {
    const i = q[head], x = i % w, y = (i / w) | 0;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (d[j] !== -1 || !ok(nx, ny)) continue;
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return d;
}

// ------------------------------------------------------------------ dungeons
const stats = { maps: 0, ms: 0, rooms: 0, enemies: 0, fragments: 0, chests: 0, geodes: 0, ambush: 0, secrets: 0, shrines: 0, bridges: 0, biomes: {} };
for (let depth = 1; depth <= MAX_DEPTH; depth++) {
  for (let s = 0; s < SEEDS; s++) {
    const seed = (Math.imul(s + 1, 2654435761) ^ (depth * 977)) >>> 0;
    const ctx = `seed=${seed} depth=${depth}`;
    let g;
    const t0 = performance.now();
    try { g = generateDungeon(seed, depth); } catch (e) { fail(ctx, `threw ${e.stack}`); continue; }
    stats.ms += performance.now() - t0;
    stats.maps++;
    const { map, start, exit, stairs, spawns, ambushes, secret, rooms } = g;
    const W = map.w;

    // Determinism.
    const g2 = generateDungeon(seed, depth);
    if (Buffer.compare(Buffer.from(map.ground), Buffer.from(g2.map.ground)) || Buffer.compare(Buffer.from(map.deco), Buffer.from(g2.map.deco))
      || JSON.stringify(spawns) !== JSON.stringify(g2.spawns)) fail(ctx, 'not deterministic');

    // Border must be solid (no walking off the map).
    for (let x = 0; x < W; x++) if (!solid(map, x, 0) || !solid(map, x, map.h - 1)) { fail(ctx, `open border at x=${x}`); break; }
    for (let y = 0; y < map.h; y++) if (!solid(map, 0, y) || !solid(map, W - 1, y)) { fail(ctx, `open border at y=${y}`); break; }

    // Solid spawn props (chests, geodes, shrines) count as blocked for walking.
    const blocked = new Set(spawns.filter((p) => p.type === 'chest' || p.type === 'geode' || p.type === 'shrine').map((p) => p.ty * W + p.tx));
    for (const a of ambushes) if (a.reward) blocked.add(a.reward.ty * W + a.reward.tx);
    if (!safe(map, start.tx, start.ty)) fail(ctx, 'start tile not safe');
    const dist = flood(map, start.tx, start.ty, blocked);
    const reach = (t) => dist[t.ty * W + t.tx] >= 0;
    if (!reach(exit)) fail(ctx, 'exit unreachable');
    if (stairs && !reach(stairs)) fail(ctx, 'stairs unreachable');
    if (!stairs) fail(ctx, 'no stairs down');

    // Secret room tiles are excluded until opened.
    const secretRoom = secret ? rooms[secret.room] : null;
    const inSecret = (x, y) => secretRoom && x >= secretRoom.x - 1 && y >= secretRoom.y - 1 && x <= secretRoom.x + secretRoom.w && y <= secretRoom.y + secretRoom.h;

    // No orphan safe pockets.
    let orphans = 0;
    for (let y = 1; y < map.h - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (safe(map, x, y) && dist[y * W + x] < 0 && !blocked.has(y * W + x) && !inSecret(x, y)) orphans++;
    }
    if (orphans) fail(ctx, `${orphans} safe tiles unreachable from start`);

    // Spawn validity.
    const seen = new Set();
    for (const p of spawns) {
      const i = p.ty * W + p.tx;
      if (seen.has(i)) fail(ctx, `two spawns on tile ${p.tx},${p.ty}`);
      seen.add(i);
      if (!safe(map, p.tx, p.ty)) { fail(ctx, `${p.type} on unsafe tile ${p.tx},${p.ty}`); continue; }
      if (p.room === secretRoom?.id) continue;
      const isBlocker = blocked.has(i);
      const ok = isBlocker
        ? [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => dist[(p.ty + dy) * W + p.tx + dx] >= 0)
        : dist[i] >= 0;
      if (!ok) fail(ctx, `${p.type} unreachable at ${p.tx},${p.ty}`);
      if (p.type === 'enemy' && Math.hypot(p.tx - start.tx, p.ty - start.ty) < 10) fail(ctx, `enemy too close to start (${p.tx},${p.ty})`);
    }
    if (!spawns.some((p) => p.type === 'chest')) fail(ctx, 'no chest');
    if (!spawns.some((p) => p.type === 'fragment')) fail(ctx, 'no fragments');

    // Ambush rooms: openings walkable & reachable; spawn tiles inside and reachable.
    for (const a of ambushes) {
      if (!a.openings.length) fail(ctx, `ambush room ${a.room} has no openings`);
      for (const o of a.openings) if (solid(map, o.tx, o.ty)) fail(ctx, `ambush opening solid at ${o.tx},${o.ty}`);
      if (!a.openings.some((o) => dist[o.ty * W + o.tx] >= 0)) fail(ctx, `ambush room ${a.room} openings unreachable`);
      for (const t of a.spawnTiles) if (dist[t.ty * W + t.tx] < 0) fail(ctx, `ambush spawn unreachable ${t.tx},${t.ty}`);
      if (!a.waves.length || !a.waves[0].length) fail(ctx, 'ambush with no waves');
    }

    // Secret room opens into the dungeon.
    if (secret) {
      const { wall } = secret;
      if (!solid(map, wall.tx, wall.ty)) fail(ctx, 'secret wall is not solid');
      const saved = map.ground[wall.ty * W + wall.tx];
      map.ground[wall.ty * W + wall.tx] = TILE.DUNGEON_FLOOR;
      const d2 = flood(map, start.tx, start.ty, blocked);
      const inner = spawns.filter((p) => p.room === secretRoom.id);
      for (const p of inner) {
        const i = p.ty * W + p.tx;
        const ok = blocked.has(i) ? [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => d2[(p.ty + dy) * W + p.tx + dx] >= 0) : d2[i] >= 0;
        if (!ok) fail(ctx, `secret ${p.type} unreachable after opening`);
      }
      if (d2[secretRoom.cy * W + secretRoom.cx] < 0 && !blocked.has(secretRoom.cy * W + secretRoom.cx)) fail(ctx, 'secret room unreachable after opening');
      map.ground[wall.ty * W + wall.tx] = saved;
      stats.secrets++;
    }

    stats.rooms += rooms.length;
    stats.ambush += ambushes.length;
    for (const p of spawns) {
      if (p.type === 'enemy') stats.enemies++;
      else if (p.type === 'fragment') stats.fragments += p.amount;
      else if (p.type === 'chest') stats.chests++;
      else if (p.type === 'geode') { stats.geodes++; stats.fragments += p.amount; }
      else if (p.type === 'shrine') stats.shrines++;
    }
    for (let i = 0; i < map.ground.length; i++) if (map.ground[i] === TILE.BRIDGE) stats.bridges++;
    stats.biomes[g.biome] = (stats.biomes[g.biome] || 0) + 1;
  }
}

// ------------------------------------------------------------------ tower floors + summit
for (let f = 1; f <= TOWER_FLOORS; f++) {
  const ctx = `tower floor ${f}`;
  const t = generateTowerFloor(f);
  const W = t.map.w;
  const d = flood(t.map, t.spawn.tx, t.spawn.ty);
  for (const [name, p] of [['up', t.up], ['down', t.down]]) if (d[p.ty * W + p.tx] < 0) fail(ctx, `${name} stairs unreachable`);
  if (!t.waves.length) fail(ctx, 'no waves');
  for (const wave of t.waves) for (const e of wave) {
    if (!safe(t.map, e.tx, e.ty)) fail(ctx, `wave spawn unsafe ${e.tx},${e.ty}`);
    else if (d[e.ty * W + e.tx] < 0) fail(ctx, `wave spawn unreachable ${e.tx},${e.ty}`);
    if (Math.hypot(e.tx - t.spawn.tx, e.ty - t.spawn.ty) < 6) fail(ctx, 'wave spawn too close to player');
  }
  if (d[t.chest.ty * W + t.chest.tx] < 0) fail(ctx, 'reward chest spot unreachable');
}
{
  const b = generateBossArena();
  const d = flood(b.map, b.spawn.tx, b.spawn.ty);
  if (d[b.boss.ty * b.map.w + b.boss.tx] < 0) fail('boss arena', 'boss unreachable');
  if (d[b.exit.ty * b.map.w + b.exit.tx] < 0) fail('boss arena', 'exit unreachable');
}

// ------------------------------------------------------------------ hub
{
  const { map, markers } = buildHubMap();
  const s = HUB_SPOTS.spawn;
  const d = flood(map, s.tx, s.ty);
  const near = (p) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => d[(p.ty + dy) * map.w + p.tx + dx] >= 0);
  for (const [name, p] of Object.entries(HUB_SPOTS)) if (!near(p)) fail('hub', `spot ${name} unreachable`);
  for (const [name, list] of Object.entries(markers)) for (const p of list) if (!near(p)) fail('hub', `marker ${name} unreachable at ${p.tx},${p.ty}`);
  for (const need of ['headmaster', 'librarian', 'artificer', 'quartermaster', 'shy', 'archmage', 'forge', 'portal', 'towerDoor']) if (!markers[need]) fail('hub', `missing marker ${need}`);
}

// ------------------------------------------------------------------ dialogue
for (const dlg of Object.values(DIALOGUES)) {
  if (!dlg.nodes[dlg.start]) fail('dialogue', `${dlg.id} start node missing`);
  for (const [id, n] of Object.entries(dlg.nodes)) {
    if (n.text.length > 125) fail('dialogue', `${dlg.id}.${id} text too long (${n.text.length})`);
    const nexts = [n.next, ...(n.choices || []).map((c) => c.next)].filter((x) => x != null);
    for (const nx of nexts) if (!dlg.nodes[nx]) fail('dialogue', `${dlg.id}.${id} -> missing node ${nx}`);
  }
}

// ------------------------------------------------------------------ report
const n = stats.maps || 1;
console.log(`dungeons: ${stats.maps} maps (${SEEDS} seeds x depths 1-${MAX_DEPTH}), avg ${(stats.ms / n).toFixed(1)} ms/map`);
console.log(`  per map: ${(stats.rooms / n).toFixed(1)} rooms, ${(stats.enemies / n).toFixed(1)} enemies, ${(stats.fragments / n).toFixed(1)} fragments placed, `
  + `${(stats.chests / n).toFixed(2)} chests, ${(stats.geodes / n).toFixed(2)} geodes, ${(stats.ambush / n).toFixed(2)} ambush rooms, ${(stats.shrines / n).toFixed(2)} shrines`);
console.log(`  secret rooms in ${((stats.secrets / n) * 100).toFixed(0)}% of maps; ${(stats.bridges / n).toFixed(1)} bridge tiles/map; biomes ${JSON.stringify(stats.biomes)}`);
console.log(`tower floors 1-${TOWER_FLOORS}, boss arena, hub and ${Object.keys(DIALOGUES).length} static dialogues checked`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures.slice(0, 60)) console.error('  ' + f);
  process.exit(1);
}
console.log('DUNGEON TEST PASSED');
