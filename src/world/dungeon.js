// Dungeon level (team: world): turns generateDungeon() output into a live Level.
//   - enemies via game.combat.spawnEnemy (never constructed here)
//   - ambush rooms: arcane seals slam shut when you step inside; waves spawn; seals lift on clear
//   - chests (depth-scaled loot), fragment geodes, shrines, loose fragments and orbs
//   - secret rooms behind loose stones (interact, or blast them with a spell)
//   - return portal + stairs deeper; DUNGEON_CLEARED when every foe and ambush is done
import { TILE } from '../core/tiles.js';
import { TILE_SIZE } from '../core/config.js';
import { EV } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { setFlag } from '../core/state.js';
import { generateDungeon } from './dungeon-gen.js';
import { BIOMES } from './biomes.js';
import { C } from './util.js';
import { Door, Pickup, Chest, Geode, Shrine, Barrier, SecretWall, QuestItem } from './entities.js';
import { rollChest } from './loot.js';
import { flag } from './story.js';

const toast = (game, text, color, duration) => game.bus.emit(EV.TOAST, { text, color, duration });

export function buildDungeon(game, spec) {
  const depth = spec.depth;
  const enemyFilter = (id) => !!game.combat?.getEnemyDef?.(id);
  const gen = generateDungeon(spec.seed, depth, { enemyFilter, element: spec.element });
  const { map, rooms, spawns, ambushes, secret } = gen;
  const biome = BIOMES[gen.biome];
  const E = game.entities;
  // Separate stream for runtime rolls (loot), so generation stays reproducible.
  const lootRng = new RNG(`${spec.seed}:${depth}:loot`);
  const owner = { level: `dungeon:${spec.seed}:${depth}` };
  const enemies = new Set();

  const spawnEnemy = (id, tx, ty, elite) => {
    const p = C(tx, ty);
    const e = game.combat.spawnEnemy(game, id, p.x, p.y, elite ? { elite: true } : {});
    if (e) enemies.add(e);
    return e;
  };

  // ---- static spawns ----------------------------------------------------------
  for (const sp of spawns) {
    const p = C(sp.tx, sp.ty);
    switch (sp.type) {
      case 'enemy': spawnEnemy(sp.id, sp.tx, sp.ty, sp.elite); break;
      case 'fragment': E.add(new Pickup('fragment', p.x, p.y, { element: sp.element, amount: sp.amount })); break;
      case 'health': case 'mana': E.add(new Pickup(sp.type, p.x, p.y, { amount: sp.amount })); break;
      case 'chest': E.add(new Chest(p.x, p.y + 3, { drops: rollChest(game, lootRng, sp.tier, biome.fragments), onOpen: sp.secret ? () => setFlag(game, 'secretFound', true) : null })); break;
      case 'geode': E.add(new Geode(p.x, p.y + 4, { element: sp.element, amount: sp.amount })); break;
      case 'shrine': E.add(new Shrine(p.x, p.y + 4)); break;
      default: break;
    }
  }

  // Wren's lost tome waits in a treasure room until found.
  if (flag(game.state, 'shyQuest') && !flag(game.state, 'foundTome') && gen.questSpot) {
    const q = C(gen.questSpot.tx, gen.questSpot.ty);
    E.add(new QuestItem(q.x, q.y, { flag: 'foundTome', sprite: 'prop_tome', text: 'You found Wren\'s Tome of Small Lights! Bring it back to her.' }));
  }

  // ---- exit portal + stairs ---------------------------------------------------
  const exit = C(gen.exit.tx, gen.exit.ty);
  E.add(new Door(exit.x, exit.y + 6, {
    sprite: 'prop_portal', to: 'hub', prompt: 'Return', params: { from: 'dungeon' }, light: { radius: 56, color: '#b05aff' },
  }));
  if (gen.stairs) {
    const st = C(gen.stairs.tx, gen.stairs.ty);
    const nextBiome = BIOMES[gen.biome].depths[1] === depth;
    E.add(new Door(st.x, st.y + 6, {
      sprite: 'prop_stairs_down', to: 'dungeon', prompt: nextBiome ? 'Descend (new region)' : 'Deeper', params: { depth: depth + 1 },
      light: { radius: 28, color: '#ffae4a' },
    }));
  }

  // ---- secret room ------------------------------------------------------------
  let secretWall = null;
  if (secret) {
    const w = C(secret.wall.tx, secret.wall.ty);
    secretWall = E.add(new SecretWall(w.x, w.y, { tx: secret.wall.tx, ty: secret.wall.ty, floor: biome.floor, onOpen: () => setFlag(game, 'secretFound', true) }));
  }

  // ---- ambush rooms -----------------------------------------------------------
  const ambushState = ambushes.map((a) => ({ ...a, state: 'armed', wave: 0, live: new Set(), barriers: [], saved: [] }));
  const reward = (a) => {
    if (!a.reward) return;
    const p = C(a.reward.tx, a.reward.ty);
    const chest = E.add(new Chest(p.x, p.y + 3, { drops: rollChest(game, lootRng, a.reward.tier, biome.fragments) }));
    game.fx.emit('portal', chest.x, chest.y - 6, { count: 20 });
    game.fx.ring(chest.x, chest.y - 4, 24, '#ffd25a', 0.5);
  };
  const seal = (a) => {
    a.state = 'sealed';
    for (const o of a.openings) {
      const i = o.ty * map.w + o.tx;
      a.saved.push({ tx: o.tx, ty: o.ty, deco: map.deco[i] });
      map.setDeco(o.tx, o.ty, TILE.FENCE);
      const p = C(o.tx, o.ty);
      a.barriers.push(E.add(new Barrier(p.x, p.y + 8)));
    }
    game.bus.emit(EV.CAMERA_SHAKE, { intensity: 3, duration: 0.3 });
    game.bus.emit(EV.SFX, { name: 'door' });
    toast(game, 'Arcane seals slam shut. Ambush!', '#ff8aff', 2.5);
    spawnWave(a);
  };
  const spawnWave = (a) => {
    const wave = a.waves[a.wave] || [];
    const tiles = a.spawnTiles.length ? a.spawnTiles : [{ tx: a.rect.x + (a.rect.w >> 1), ty: a.rect.y + (a.rect.h >> 1) }];
    wave.forEach((w, k) => {
      const t = tiles[(k + a.wave * 3) % tiles.length];
      const p = C(t.tx, t.ty);
      game.fx.emit('portal', p.x, p.y - 4, { count: 14 });
      const e = spawnEnemy(w.id, t.tx, t.ty, w.elite);
      if (e) a.live.add(e);
    });
    if (a.wave > 0) toast(game, `Wave ${a.wave + 1}!`, '#ff8aff', 1.5);
  };
  const release = (a) => {
    a.state = 'done';
    for (const s of a.saved) map.setDeco(s.tx, s.ty, s.deco);
    for (const b of a.barriers) b.release();
    game.bus.emit(EV.SFX, { name: 'door' });
    toast(game, 'The seals fade. Treasure shimmers into being!', '#ffd25a', 2.5);
    reward(a);
  };

  // Spells that hit the loose stone break it open.
  const onProjectileHit = ({ projectile, target, x, y } = {}) => {
    if (!secretWall || secretWall.dead || target) return;
    if (projectile?.team !== 'player' && projectile?.caster !== game.player) return;
    const tx = Math.floor(x / TILE_SIZE), ty = Math.floor(y / TILE_SIZE);
    if (Math.abs(tx - secretWall.tx) <= 1 && Math.abs(ty - secretWall.ty) <= 1 && Math.hypot(x - secretWall.x, y - secretWall.y) < 14) secretWall.open(game);
  };
  const onAoe = ({ x, y, radius } = {}) => {
    if (!secretWall || secretWall.dead) return;
    if (Math.hypot(x - secretWall.x, y - secretWall.y) < (radius || 0) + 4) secretWall.open(game);
  };

  let cleared = false;
  const tileOf = (v) => Math.floor(v / TILE_SIZE);
  return {
    kind: 'dungeon', id: `dungeon_${spec.seed}_${depth}`, name: `${biome.name} - Depth ${depth}`, map,
    playerSpawn: C(gen.start.tx, gen.start.ty), music: biome.music, bgColor: biome.bgColor,
    ambient: biome.ambient,
    data: { biome: biome.id, biomeName: biome.name, depth, seed: spec.seed, rooms, element: spec.element || null },
    onEnter(g) {
      const d = g.state.dungeon;
      d.runs++;
      d.deepest = Math.max(d.deepest, depth);
      d.lastSeed = spec.seed;
      const firstVisit = !flag(g.state, `reachedDepth${depth}`);
      for (let k = 1; k <= depth; k++) setFlag(g, `reachedDepth${k}`, true);
      const isBiomeStart = biome.depths[0] === depth;
      if (isBiomeStart && firstVisit) g.after(2.5, () => toast(g, biome.blurb, '#c8b8ff', 4));
      g.bus.on(EV.PROJECTILE_HIT, onProjectileHit, owner);
      g.bus.on(EV.AOE_TRIGGERED, onAoe, owner);
    },
    onExit(g) {
      g.bus.offOwner(owner);
    },
    update(g) {
      const p = g.player;
      // Ambush triggers / waves.
      for (const a of ambushState) {
        if (a.state === 'armed' && p && g.state.player.hp > 0) {
          const tx = tileOf(p.x), ty = tileOf(p.y), r = a.rect;
          if (tx >= r.x + 1 && ty >= r.y + 1 && tx < r.x + r.w - 1 && ty < r.y + r.h - 1) seal(a);
        } else if (a.state === 'sealed') {
          for (const e of a.live) if (e.dead) a.live.delete(e);
          if (!a.live.size) {
            a.wave++;
            if (a.wave < a.waves.length) spawnWave(a);
            else release(a);
          }
        }
      }
      if (cleared) return;
      for (const e of enemies) if (e.dead) enemies.delete(e);
      if (!enemies.size && ambushState.every((a) => a.state === 'done')) {
        cleared = true;
        setFlag(g, 'dungeonCleared', true);
        setFlag(g, `clearedDepth${depth}`, true);
        g.bus.emit(EV.DUNGEON_CLEARED, { depth, seed: spec.seed });
        toast(g, 'The depth falls silent. A bonus cache materialises at your feet!', '#ffd25a', 3);
        if (p) {
          const els = Object.keys(biome.fragments);
          for (let k = 0; k < 3 + Math.floor(depth / 2); k++) {
            g.world.spawnPickup(g, 'fragment', p.x, p.y, { element: lootRng.pick(els), amount: 1 + Math.floor(depth / 3), burst: true });
          }
        }
      }
    },
  };
}
