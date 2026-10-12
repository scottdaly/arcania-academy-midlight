// Level builders: hub, procedural dungeon, tower floors, boss arena (team: world). Placeholder.
// Each builder returns a Level (ARCHITECTURE.md §7.5) and populates game.entities.
import { TileMap } from '../core/tilemap.js';
import { TILE } from '../core/tiles.js';
import { RNG } from '../core/rng.js';
import { EV } from '../core/events.js';
import { TILE_SIZE, TOWER_FLOORS, CORE_ELEMENTS } from '../core/config.js';
import { setFlag } from '../core/state.js';
import { Npc, Door, Station, Pickup } from './entities.js';
import { NPCS, openNpcDialogue } from './dialogue.js';

const C = (tx, ty) => TileMap.tileCenter(tx, ty);
const at = (tx, ty) => ({ x: tx * TILE_SIZE, y: ty * TILE_SIZE }); // tile corner (use for 2-wide centring)

// ===================================================================== HUB

export function buildHub(game, spec) {
  const W = 44, H = 32;
  const rng = new RNG('hub');
  const map = new TileMap(W, H, TILE.GRASS);
  map.fillRect('ground', 0, 0, W, 1, TILE.HEDGE);
  map.fillRect('ground', 0, H - 1, W, 1, TILE.HEDGE);
  map.fillRect('ground', 0, 0, 1, H, TILE.HEDGE);
  map.fillRect('ground', W - 1, 0, 1, H, TILE.HEDGE);

  // Academy hall (west)
  map.fillRect('ground', 3, 3, 16, 12, TILE.STONE_WALL);
  map.fillRect('ground', 4, 4, 14, 10, TILE.STONE_FLOOR);
  map.fillRect('ground', 10, 5, 2, 9, TILE.CARPET);
  for (let x = 4; x < 18; x++) if (x < 9 || x > 12) map.setDeco(x, 4, TILE.BOOKSHELF);
  map.setDeco(4, 9, TILE.CANDLES); map.setDeco(17, 9, TILE.CANDLES);
  map.setDeco(6, 11, TILE.TABLE); map.setDeco(15, 11, TILE.TABLE);
  map.fillRect('ground', 10, 14, 2, 1, TILE.PATH); // doorway

  // Paths & plaza
  map.fillRect('ground', 10, 15, 2, 5, TILE.PATH);
  map.fillRect('ground', 10, 19, 30, 3, TILE.PATH);
  map.setDeco(22, 20, TILE.FOUNTAIN);
  for (const x of [14, 18, 26, 34]) { map.setDeco(x, 18, TILE.LANTERN); map.setDeco(x, 22, TILE.LANTERN); }

  // Mage Tower base (north-east)
  map.fillRect('ground', 26, 2, 8, 7, TILE.TOWER_WALL);
  map.fillRect('ground', 29, 9, 2, 10, TILE.PATH);
  map.setDeco(28, 9, TILE.BRAZIER); map.setDeco(31, 9, TILE.BRAZIER);

  // Portal clearing (east)
  map.fillRect('ground', 39, 18, 3, 5, TILE.RUNE_FLOOR);

  // Pond (south-west)
  map.fillRect('ground', 4, 23, 7, 5, TILE.WATER);
  map.fillRect('ground', 5, 22, 5, 1, TILE.WATER);

  // Flowers and trees on free grass
  for (let i = 0; i < 70; i++) {
    const tx = rng.int(1, W - 2), ty = rng.int(1, H - 2);
    if (map.getGround(tx, ty) !== TILE.GRASS || map.getDeco(tx, ty)) continue;
    if (Math.abs(tx - 22) < 5 && Math.abs(ty - 21) < 5) continue;
    if (i % 3 === 0) map.setDeco(tx, ty, TILE.TREE);
    else map.setGround(tx, ty, TILE.GRASS_FLOWERS);
  }
  map.randomizeVariants(rng);

  const E = game.entities;
  const npc = (id, tx, ty) => E.add(new Npc(NPCS[id], C(tx, ty).x, C(tx, ty).y, openNpcDialogue));
  npc('headmaster', 10.5, 6.5);
  npc('librarian', 6, 6);
  npc('alchemist', 36, 16);
  npc('student', 17, 24);
  E.add(new Station(C(34, 16).x, C(34, 16).y, { sprite: 'prop_forge', prompt: 'Craft', onInteract: (g) => g.ui.open('crafting') }));
  E.add(new Door(at(30, 9).x, at(30, 9).y + 4, {
    sprite: 'prop_tower_door', to: 'tower', prompt: 'Climb', params: { floor: Math.max(1, game.state.tower.currentFloor) },
    requires: { flags: { metHeadmaster: true } }, lockedText: 'Speak with the Headmaster first.',
  }));
  const portal = C(40, 20);
  E.add(new Door(portal.x, portal.y + 6, {
    sprite: 'prop_portal', to: 'dungeon', prompt: 'Descend',
    params: { depth: Math.min(3, game.state.dungeon.deepest + 1) },
    light: { radius: 48, color: '#b05aff' },
  }));

  const spawns = {
    dungeon: { x: portal.x - 20, y: portal.y + 6 },
    tower: { x: at(30, 11).x, y: at(30, 11).y },
  };
  return {
    kind: 'hub', id: 'hub', name: 'Arcania Academy', map,
    playerSpawn: spawns[spec.from] || C(22, 23),
    music: 'hub', bgColor: '#0b0716', ambient: { darkness: 0.15, color: '#100a30' },
  };
}

// ===================================================================== DUNGEON

/** Rooms-and-corridors generator. Deterministic for a given seed. */
export function generateDungeon(seed, depth) {
  const rng = new RNG(seed);
  const W = 48 + depth * 4, H = 36 + depth * 2;
  const map = new TileMap(W, H, TILE.DUNGEON_WALL);
  const rooms = [];
  for (let tries = 0; tries < 200 && rooms.length < 8 + depth; tries++) {
    const w = rng.int(5, 10), h = rng.int(5, 8);
    const x = rng.int(1, W - w - 2), y = rng.int(1, H - h - 2);
    if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  if (!rooms.length) rooms.push({ x: (W >> 1) - 3, y: (H >> 1) - 3, w: 6, h: 6, cx: W >> 1, cy: H >> 1 });
  const carve = (x, y) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) map.setGround(x, y, rng.chance(0.15) ? TILE.DUNGEON_FLOOR_MOSSY : TILE.DUNGEON_FLOOR); };
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) carve(x, y);
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    let x = a.cx, y = a.cy;
    const horizFirst = rng.chance(0.5);
    const stepX = () => { while (x !== b.cx) { carve(x, y); carve(x, y + 1); x += Math.sign(b.cx - x); } };
    const stepY = () => { while (y !== b.cy) { carve(x, y); carve(x + 1, y); y += Math.sign(b.cy - y); } };
    if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    carve(x, y);
  }
  // Decorate: torches on walls that face a floor below, rubble/mushrooms on floors.
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const g = map.getGround(x, y);
    if (g === TILE.DUNGEON_WALL && map.getGround(x, y + 1) !== TILE.DUNGEON_WALL && rng.chance(0.08)) map.setDeco(x, y, TILE.TORCH_WALL);
    else if (g !== TILE.DUNGEON_WALL && rng.chance(0.03)) map.setDeco(x, y, rng.pick([TILE.RUBBLE, TILE.MUSHROOMS, TILE.BONES, TILE.CRYSTAL]));
  }
  map.randomizeVariants(rng);
  return { map, rooms, rng };
}

export function buildDungeon(game, spec) {
  const { map, rooms, rng } = generateDungeon(spec.seed, spec.depth);
  const first = rooms[0], last = rooms[rooms.length - 1];
  // Keep spawn/exit tiles clear of decorations.
  map.setDeco(first.cx, first.cy, 0);
  map.setDeco(last.cx, last.cy, 0);
  const element = spec.element || rng.pick(CORE_ELEMENTS);
  const pool = depth => depth >= 3 ? ['armor_knight', 'armor_captain', 'golem_stone', 'golem_ember', 'golem_frost'] : depth >= 2 ? ['armor_knight', 'golem_stone', 'golem_ember', 'golem_frost'] : ['armor_knight', 'golem_stone'];
  let enemyCount = 0;
  for (const r of rooms.slice(1)) {
    const n = rng.int(1, 1 + spec.depth);
    for (let i = 0; i < n; i++) {
      const p = C(rng.int(r.x + 1, r.x + r.w - 2), rng.int(r.y + 1, r.y + r.h - 2));
      if (map.isSolidAt(p.x, p.y)) continue;
      game.combat.spawnEnemy(game, rng.pick(pool(spec.depth)), p.x, p.y);
      enemyCount++;
    }
    if (rng.chance(0.7)) {
      const p = C(rng.int(r.x + 1, r.x + r.w - 2), rng.int(r.y + 1, r.y + r.h - 2));
      if (!map.isSolidAt(p.x, p.y)) game.entities.add(new Pickup('fragment', p.x, p.y, { element, amount: rng.int(1, 2) }));
    }
  }
  const exit = C(last.cx, last.cy);
  game.entities.add(new Door(exit.x, exit.y, { sprite: 'prop_portal', to: 'hub', prompt: 'Return', params: { from: 'dungeon' }, light: { radius: 48, color: '#b05aff' } }));
  if (spec.depth < 5) {
    const down = C(last.cx + 2 < last.x + last.w ? last.cx + 2 : last.cx - 2, last.cy);
    game.entities.add(new Door(down.x, down.y, { sprite: 'prop_stairs_down', to: 'dungeon', prompt: 'Deeper', params: { depth: spec.depth + 1 } }));
  }

  let cleared = enemyCount === 0;
  game.state.dungeon.lastSeed = spec.seed;
  return {
    kind: 'dungeon', id: `dungeon_${spec.seed}_${spec.depth}`, name: `Dungeon depth ${spec.depth}`, map,
    playerSpawn: C(first.cx, first.cy), music: 'dungeon', bgColor: '#05030a',
    ambient: { darkness: 0.82, color: '#05030a' },
    data: { element, rooms },
    onEnter(g) {
      g.state.dungeon.runs++;
      g.state.dungeon.deepest = Math.max(g.state.dungeon.deepest, spec.depth);
    },
    update(g) {
      if (cleared) return;
      if (!g.entities.list.some((e) => e.team === 'enemy' && !e.dead)) {
        cleared = true;
        setFlag(g, 'dungeonCleared', true);
        g.bus.emit(EV.DUNGEON_CLEARED, { depth: spec.depth, seed: spec.seed });
        g.bus.emit(EV.TOAST, { text: 'The dungeon falls silent.' });
      }
    },
  };
}

// ===================================================================== TOWER

export function buildTowerFloor(game, spec) {
  const floor = spec.floor;
  const rng = new RNG(`tower:${floor}`);
  const W = 24, H = 18;
  const map = new TileMap(W, H, TILE.TOWER_WALL);
  map.fillRect('ground', 1, 1, W - 2, H - 2, TILE.TOWER_FLOOR);
  for (const [x, y] of [[5, 5], [18, 5], [5, 12], [18, 12]]) map.setDeco(x, y, TILE.PILLAR);
  for (let x = 2; x < W - 2; x += 4) map.setDeco(x, 0, TILE.TORCH_WALL);
  map.fillRect('ground', 10, 7, 4, 4, TILE.RUNE_FLOOR);
  map.randomizeVariants(rng);

  const n = 2 + floor;
  const types = floor >= 4 ? ['armor_captain', 'golem_ember', 'golem_frost'] : ['armor_knight', 'golem_stone'];
  for (let i = 0; i < n; i++) {
    const p = C(rng.int(3, W - 4), rng.int(2, 8));
    if (!map.isSolidAt(p.x, p.y)) game.combat.spawnEnemy(game, rng.pick(types), p.x, p.y, { hpMult: 1 + floor * 0.15 });
  }

  const upTo = floor >= TOWER_FLOORS ? { to: 'boss', params: {} } : { to: 'tower', params: { floor: floor + 1 } };
  const stairs = new Door(at(12, 1).x, at(12, 1).y + 10, { sprite: 'prop_stairs_up', prompt: 'Ascend', lockedText: 'Defeat the guardians first.', ...upTo });
  stairs.locked = true;
  game.entities.add(stairs);
  game.entities.add(new Door(at(12, H - 2).x, at(12, H - 2).y + 8, { sprite: 'prop_stairs_down', to: 'hub', prompt: 'Leave', params: { from: 'tower' } }));

  let cleared = false;
  return {
    kind: 'tower', id: `tower_${floor}`, name: `Mage Tower - Floor ${floor}`, map,
    playerSpawn: at(12, H - 4), music: 'tower', bgColor: '#0b0716',
    ambient: { darkness: 0.55, color: '#0a0520' },
    onEnter(g) { g.state.tower.currentFloor = floor; },
    update(g) {
      if (cleared) return;
      if (!g.entities.list.some((e) => e.team === 'enemy' && !e.dead)) {
        cleared = true;
        stairs.locked = false;
        const t = g.state.tower;
        t.highestFloor = Math.max(t.highestFloor, floor);
        t.currentFloor = Math.min(TOWER_FLOORS, floor + 1);
        setFlag(g, `towerFloor${floor}Cleared`, true);
        g.bus.emit(EV.TOWER_FLOOR_CLEARED, { floor });
        g.bus.emit(EV.TOAST, { text: 'The way up is open.' });
      }
    },
  };
}

// ===================================================================== BOSS

export function buildBossArena(game) {
  const W = 26, H = 22;
  const map = new TileMap(W, H, TILE.TOWER_WALL);
  map.fillRect('ground', 1, 1, W - 2, H - 2, TILE.MARBLE);
  map.fillRect('ground', 8, 4, 10, 8, TILE.RUNE_FLOOR);
  for (const [x, y] of [[4, 4], [21, 4], [4, 16], [21, 16]]) map.setDeco(x, y, TILE.BRAZIER);
  map.randomizeVariants(new RNG('boss'));
  const b = at(13, 7);
  game.combat.spawnBoss(game, b.x, b.y);
  return {
    kind: 'boss', id: 'boss', name: 'Tower Summit', map,
    playerSpawn: at(13, H - 4), music: 'boss', bgColor: '#05030a',
    ambient: { darkness: 0.6, color: '#14051a' },
  };
}

export { Pickup };
