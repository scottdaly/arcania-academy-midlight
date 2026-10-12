// Mage Tower floors + summit boss arena (team: world).
// Each floor is a handcrafted arena layout with a theme (painted in code, symmetric), plus
// seeded variation in decoration and wave spawn points. generateTowerFloor() is pure.
//
//   1 Hall of Echoes          marble hall, pillars           enchanted armour
//   2 Overgrown Conservatory  grass, trees, poison beds      golems, lancers, wisps
//   3 Frost Gallery           ice, frozen pools, crystals    frost golems, crystal golems, wisps
//   4 Ember Foundry           lava channel + bridges          magma golems, captains
//   5 Storm Spire             chasm ring + bridges, runes     elite armour, storm wisps
//   Summit                    the Corrupted Archmage
import { TileMap } from '../core/tilemap.js';
import { TILE } from '../core/tiles.js';
import { RNG } from '../core/rng.js';
import { EV } from '../core/events.js';
import { TOWER_FLOORS } from '../core/config.js';
import { setFlag } from '../core/state.js';
import { C } from './util.js';
import { Door, Chest } from './entities.js';
import { rollChest } from './loot.js';
import { flag, wardRequirement, craftedCount } from './story.js';

export const TOWER_W = 28, TOWER_H = 22;

export const FLOORS = {
  1: {
    name: 'Hall of Echoes', floor: TILE.MARBLE, ambient: { darkness: 0.5, color: '#0a0520' },
    intro: 'Hollow armour stirs in the Hall of Echoes.',
    waves: [[['armor_knight', 3]], [['armor_knight', 2], ['armor_lancer', 1]]],
    reward: 2,
  },
  2: {
    name: 'Overgrown Conservatory', floor: TILE.GRASS, ambient: { darkness: 0.45, color: '#06140a' },
    intro: 'The tower\'s garden has gone wild. Mind the poison beds.',
    waves: [[['golem_stone', 1], ['armor_lancer', 2]], [['golem_stone', 2], ['wisp_ember', 2]]],
    reward: 2,
  },
  3: {
    name: 'Frost Gallery', floor: TILE.TOWER_FLOOR, ambient: { darkness: 0.5, color: '#050a1a' },
    intro: 'Frozen statues line the gallery. Some of them are not statues.',
    waves: [[['golem_frost', 2], ['wisp_frost', 2]], [['golem_crystal', 1], ['golem_frost', 1], ['armor_knight', 2]]],
    reward: 3,
  },
  4: {
    name: 'Ember Foundry', floor: TILE.DIRT, ambient: { darkness: 0.5, color: '#1a0602' },
    intro: 'The foundry still burns. Cross the lava by the bridges.',
    waves: [[['golem_ember', 2], ['wisp_ember', 2]], [['armor_captain', 1], ['golem_ember', 1], ['wisp_ember', 2]], [['armor_sentinel', 1, true], ['golem_ember', 1, true]]],
    reward: 3,
  },
  5: {
    name: 'Storm Spire', floor: TILE.MARBLE, ambient: { darkness: 0.58, color: '#0c0620' },
    intro: 'Lightning howls around the spire. The summit is close.',
    waves: [[['wisp_storm', 3], ['armor_knight', 2]], [['armor_captain', 2], ['armor_lancer', 2]], [['armor_sentinel', 1, true], ['armor_captain', 1, true], ['golem_stone', 1]]],
    reward: 4,
  },
};

/** Pure: build a tower floor map + spawn points. */
export function generateTowerFloor(floor, opts = {}) {
  floor = Math.max(1, Math.min(TOWER_FLOORS, floor | 0));
  const def = FLOORS[floor] || FLOORS[1];
  const W = TOWER_W, H = TOWER_H;
  const rng = new RNG(`tower:${floor}`);
  const map = new TileMap(W, H, TILE.TOWER_WALL);
  const cx = W >> 1; // 14: the arena is symmetric about x = 13.5 (tiles 13 and 14 are the centre pair)
  map.fillRect('ground', 1, 1, W - 2, H - 2, def.floor);
  const mirror = (x, y, fn) => { fn(x, y); fn(W - 1 - x, y); };
  const deco = (x, y, id) => mirror(x, y, (a, b) => map.setDeco(a, b, id));
  const ground = (x, y, id) => mirror(x, y, (a, b) => map.setGround(a, b, id));
  /** Mirrored blob patches of a floor variant (only over the base floor). */
  const patches = (id, count, rmin, rmax) => {
    for (let k = 0; k < count; k++) {
      const px = rng.int(2, cx - 1), py = rng.int(2, H - 3), r = rng.int(rmin, rmax);
      for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) {
        if (x < 1 || y < 1 || x >= cx || y >= H - 1) continue;
        if ((x - px) ** 2 + (y - py) ** 2 > r * r + 1) continue;
        if (map.getGround(x, y) === def.floor) ground(x, y, id);
      }
    }
  };
  // Torches and banners on the north wall.
  for (let x = 3; x < W - 3; x += 4) map.setDeco(x, 0, rng.chance(0.5) ? TILE.TORCH_WALL : TILE.BANNER);
  map.setDeco(2, 0, TILE.TORCH_WALL); map.setDeco(W - 3, 0, TILE.TORCH_WALL);

  switch (floor) {
    case 1: {
      map.fillRect('ground', 13, 1, 2, H - 2, TILE.CARPET);
      for (const y of [5, 10, 15]) { deco(6, y, TILE.PILLAR); deco(10, y + 1, TILE.STATUE); }
      map.fillRect('ground', 11, 9, 6, 4, TILE.RUNE_FLOOR);
      map.setDeco(13, 10, TILE.RUNE_CIRCLE);
      for (let y = 2; y < H - 2; y += 3) deco(1, y, TILE.CANDLES);
      break;
    }
    case 2: {
      patches(TILE.GRASS_FLOWERS, 5, 1, 3);
      for (const [x, y] of [[4, 4], [4, 9], [9, 6]]) { ground(x, y, TILE.POISON); ground(x + 1, y, TILE.POISON); ground(x, y + 1, TILE.POISON); ground(x + 1, y + 1, TILE.POISON); }
      for (const [x, y] of [[7, 3], [3, 13], [9, 12], [6, 16]]) deco(x, y, TILE.TREE);
      for (const [x, y] of [[11, 4], [2, 7], [11, 15], [4, 18]]) deco(x, y, TILE.BUSH);
      for (let k = 0; k < 14; k++) { const x = rng.int(2, 12), y = rng.int(2, H - 3); if (!map.getDeco(x, y) && map.getGround(x, y) !== TILE.POISON) deco(x, y, TILE.FLOWERS); }
      map.fillRect('ground', 13, 1, 2, H - 2, TILE.PATH);
      break;
    }
    case 3: {
      patches(TILE.ICE_FLOOR, 6, 1, 3);
      for (let y = 6; y <= 13; y++) { ground(4, y, TILE.DEEP_WATER); ground(5, y, TILE.DEEP_WATER); }
      for (const [x, y] of [[9, 4], [9, 15], [2, 3], [2, 17]]) deco(x, y, TILE.CRYSTAL);
      for (const y of [5, 14]) deco(11, y, TILE.PILLAR);
      for (const y of [8, 11]) deco(8, y, TILE.STATUE);
      map.fillRect('ground', 12, 8, 4, 4, TILE.RUNE_FLOOR);
      break;
    }
    case 4: {
      patches(TILE.STONE_FLOOR, 6, 1, 2);
      map.fillRect('ground', 1, 10, W - 2, 2, TILE.LAVA);
      for (const x of [5, 13]) { ground(x, 10, TILE.BRIDGE); ground(x, 11, TILE.BRIDGE); ground(x + 1, 10, TILE.BRIDGE); ground(x + 1, 11, TILE.BRIDGE); }
      for (const [x, y] of [[3, 3], [3, 17], [9, 7], [9, 14]]) deco(x, y, TILE.BRAZIER);
      for (const [x, y] of [[7, 4], [11, 17], [2, 8]]) deco(x, y, TILE.RUBBLE);
      for (const [x, y] of [[10, 3], [10, 18]]) deco(x, y, TILE.BARREL);
      break;
    }
    case 5: {
      // Outer marble ring, chasm moat, rune platform, four bridges.
      map.fillRect('ground', 5, 4, W - 10, H - 8, TILE.CHASM);
      map.fillRect('ground', 8, 7, W - 16, H - 14, TILE.RUNE_FLOOR);
      map.fillRect('ground', 13, 4, 2, 3, TILE.BRIDGE);
      map.fillRect('ground', 13, H - 7, 2, 3, TILE.BRIDGE);
      map.fillRect('ground', 5, 10, 3, 2, TILE.BRIDGE);
      map.fillRect('ground', W - 8, 10, 3, 2, TILE.BRIDGE);
      map.setDeco(13, 10, TILE.RUNE_CIRCLE);
      for (const [x, y] of [[2, 2], [2, H - 3]]) deco(x, y, TILE.BRAZIER);
      for (const [x, y] of [[3, 7], [3, 14]]) deco(x, y, TILE.PILLAR);
      break;
    }
    default: break;
  }
  // Keep the stair landings and spawn clear.
  const up = { tx: 13, ty: 2 }, down = { tx: 13, ty: H - 2 }, spawn = { tx: 13, ty: H - 4 };
  for (const t of [up, down, spawn]) for (let dx = -1; dx <= 2; dx++) {
    map.setDeco(t.tx + dx, t.ty, 0);
    const g = map.getGround(t.tx + dx, t.ty);
    if (g === TILE.LAVA || g === TILE.POISON || g === TILE.CHASM || g === TILE.DEEP_WATER) map.setGround(t.tx + dx, t.ty, def.floor);
  }

  // Wave spawn points: upper two thirds, safe tiles, spread out (mirrored pairs).
  const points = [];
  const candidates = [];
  for (let y = 3; y < H - 7; y++) for (let x = 2; x < cx; x++) {
    const ok = (a, b) => !map.isSolid(a, b) && map.getGround(a, b) !== TILE.LAVA && map.getGround(a, b) !== TILE.POISON;
    if (Math.hypot(x - spawn.tx, y - spawn.ty) < 7 || Math.hypot(W - 1 - x - spawn.tx, y - spawn.ty) < 7) continue;
    if (ok(x, y) && ok(W - 1 - x, y)) candidates.push({ tx: x, ty: y });
  }
  rng.shuffle(candidates);
  for (const c of candidates) {
    if (points.length >= 12) break;
    if (points.some((p) => Math.abs(p.tx - c.tx) + Math.abs(p.ty - c.ty) < 4)) continue;
    points.push(c, { tx: W - 1 - c.tx, ty: c.ty });
  }
  const waves = def.waves.map((wave, wi) => {
    const list = [];
    for (const [id, n, elite] of wave) for (let k = 0; k < n; k++) list.push({ id, elite: !!elite });
    return list.filter((w) => !opts.enemyFilter || opts.enemyFilter(w.id)).map((w, k) => ({ ...w, ...points[(k + wi * 5) % points.length] }));
  });
  map.randomizeVariants(rng);
  return { floor, def, map, up, down, spawn, waves, chest: { tx: 13, ty: 5 } };
}

export function buildTowerFloor(game, spec) {
  const floor = Math.max(1, Math.min(TOWER_FLOORS, spec.floor | 0));
  const enemyFilter = (id) => !!game.combat?.getEnemyDef?.(id);
  const gen = generateTowerFloor(floor, { enemyFilter });
  const { map, def } = gen;
  const s = game.state;
  const already = flag(s, `towerFloor${floor}Cleared`);
  const E = game.entities;

  const top = floor >= TOWER_FLOORS;
  const upPos = C(gen.up.tx, gen.up.ty);
  const nextFloor = floor + 1;
  const stairs = E.add(new Door(upPos.x + 8, upPos.y + 6, {
    sprite: 'prop_stairs_up', prompt: top ? 'To the summit' : 'Ascend', lockedText: 'Defeat the guardians first.',
    to: top ? 'boss' : 'tower', params: top ? {} : { floor: nextFloor },
    check: (g) => {
      const need = wardRequirement(nextFloor);
      return craftedCount(g.state) < need
        ? `A ward of woven elements bars the stair. Craft ${need} spell${need > 1 ? 's' : ''} of your own at the Forge.`
        : null;
    },
    light: { radius: 36, color: '#b05aff' },
  }));
  stairs.locked = !already;
  const downPos = C(gen.down.tx, gen.down.ty);
  E.add(new Door(downPos.x + 8, downPos.y + 6, { sprite: 'prop_stairs_down', to: 'hub', prompt: 'Leave tower', params: { from: 'tower' } }));

  let wave = -1;
  const live = new Set();
  let cleared = already;
  const spawnWave = (g, w) => {
    const list = gen.waves[w] || [];
    for (const e of list) {
      const p = C(e.tx, e.ty);
      g.fx.emit('portal', p.x, p.y - 4, { count: 16 });
      const ent = g.combat.spawnEnemy(g, e.id, p.x, p.y, e.elite ? { elite: true } : {});
      if (ent) live.add(ent);
    }
    g.bus.emit(EV.TOAST, { text: w === 0 ? 'The guardians awaken!' : `Wave ${w + 1} of ${gen.waves.length}!`, color: '#ff8aff', duration: 1.8 });
  };

  return {
    kind: 'tower', id: `tower_${floor}`, name: `Mage Tower ${floor}F - ${def.name}`, map,
    playerSpawn: { x: C(gen.spawn.tx, gen.spawn.ty).x + 8, y: C(gen.spawn.tx, gen.spawn.ty).y }, music: 'tower', bgColor: '#0b0716',
    ambient: def.ambient,
    data: { floor, theme: def.name, waves: gen.waves.length },
    onEnter(g) {
      g.state.tower.currentFloor = floor;
      if (already) {
        g.after(2.6, () => g.bus.emit(EV.TOAST, { text: 'This floor is already cleared. The stairs are open.', color: '#c8b8ff', duration: 2.5 }));
      } else {
        g.after(2.6, () => g.bus.emit(EV.TOAST, { text: def.intro, color: '#c8b8ff', duration: 3 }));
        g.after(1.2, () => { wave = 0; spawnWave(g, 0); });
      }
    },
    update(g) {
      if (cleared || wave < 0) return;
      for (const e of live) if (e.dead) live.delete(e);
      if (live.size) return;
      wave++;
      if (wave < gen.waves.length) { spawnWave(g, wave); return; }
      cleared = true;
      stairs.locked = false;
      const t = g.state.tower;
      t.highestFloor = Math.max(t.highestFloor, floor);
      t.currentFloor = Math.min(TOWER_FLOORS, floor + 1);
      setFlag(g, `towerFloor${floor}Cleared`, true);
      g.bus.emit(EV.TOWER_FLOOR_CLEARED, { floor });
      g.bus.emit(EV.SFX, { name: 'door' });
      g.bus.emit(EV.TOAST, { text: top ? 'The way to the summit is open...' : 'Floor cleared! The stairs unseal.', color: '#ffd25a', duration: 3 });
      const cp = C(gen.chest.tx, gen.chest.ty);
      const chest = g.entities.add(new Chest(cp.x + 8, cp.y + 3, { drops: rollChest(g, new RNG(`tower-loot:${floor}:${t.highestFloor}`), def.reward, { fire: 1, ice: 1, lightning: 1, arcane: 1, earth: 1 }) }));
      g.fx.ring(chest.x, chest.y - 4, 28, '#ffd25a', 0.6);
      g.save();
    },
  };
}

// ===================================================================== summit

export const BOSS_W = 30, BOSS_H = 26;

export function generateBossArena() {
  const W = BOSS_W, H = BOSS_H;
  const rng = new RNG('summit');
  const map = new TileMap(W, H, TILE.TOWER_WALL);
  map.fillRect('ground', 1, 1, W - 2, H - 2, TILE.MARBLE);
  // Great rune circle.
  const cx = W / 2 - 0.5, cy = 10.5;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const d = Math.hypot(x - cx, (y - cy) * 1.1);
    if (d < 9 && d > 7.6) map.setGround(x, y, TILE.RUNE_FLOOR);
  }
  map.fillRect('ground', 14, 12, 2, H - 13, TILE.CARPET);
  for (const [x, y] of [[4, 4], [W - 5, 4], [4, H - 6], [W - 5, H - 6]]) map.setDeco(x, y, TILE.BRAZIER);
  for (const [x, y] of [[8, 16], [W - 9, 16], [7, 6], [W - 8, 6]]) map.setDeco(x, y, TILE.PILLAR);
  for (let x = 3; x < W - 3; x += 4) map.setDeco(x, 0, rng.chance(0.5) ? TILE.TORCH_WALL : TILE.BANNER);
  map.setDeco(14, 3, TILE.RUNE_CIRCLE);
  map.randomizeVariants(rng);
  return { map, boss: { tx: 14, ty: 5 }, spawn: { tx: 14, ty: H - 4 }, exit: { tx: 14, ty: H - 2 } };
}

export function buildBossArena(game) {
  const gen = generateBossArena();
  const { map } = gen;
  const W = BOSS_W, H = BOSS_H;
  const b = C(gen.boss.tx, gen.boss.ty);
  const boss = game.combat.spawnBoss(game, b.x + 8, b.y);
  const ex = C(gen.exit.tx, gen.exit.ty);
  game.entities.add(new Door(ex.x + 8, ex.y + 6, { sprite: 'prop_stairs_down', to: 'hub', prompt: 'Flee', params: { from: 'tower' } }));
  const owner = { level: 'boss' };
  const orbs = (g) => {
    for (const [x, y] of [[3, 3], [W - 4, 3], [3, H - 5], [W - 4, H - 5]]) {
      const p = C(x, y);
      g.world.spawnPickup(g, (x + y) % 2 ? 'health' : 'mana', p.x, p.y, { amount: 35 });
    }
  };
  return {
    kind: 'boss', id: 'boss', name: 'Tower Summit', map,
    playerSpawn: { x: C(gen.spawn.tx, gen.spawn.ty).x + 8, y: C(gen.spawn.tx, gen.spawn.ty).y }, music: 'boss', bgColor: '#05030a',
    ambient: { darkness: 0.62, color: '#14051a' },
    data: { boss },
    onEnter(g) {
      g.after(0.8, () => g.bus.emit(EV.TOAST, { text: 'Corvin: "Another student, come to take my power? Come, then!"', color: '#ff8aff', duration: 3.5 }));
      g.bus.on(EV.BOSS_PHASE, ({ phase } = {}) => {
        g.bus.emit(EV.TOAST, { text: phase >= 3 ? 'Corvin: "Please... end it... break the shard!"' : 'Corvin: "Help... me... the Void... it will not let go!"', color: '#ffb8ff', duration: 3.5 });
        orbs(g);
      }, owner);
      g.bus.on(EV.BOSS_DEFEATED, () => {
        g.bus.emit(EV.TOAST, { text: 'The Void Shard shatters. Corvin falls to his knees - free at last.', color: '#7ad8ff', duration: 4 });
      }, owner);
    },
    onExit(g) { g.bus.offOwner(owner); },
  };
}
