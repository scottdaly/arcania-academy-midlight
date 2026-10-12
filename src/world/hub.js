// Arcania Academy hub (team: world). Handcrafted: each building is an ASCII stamp placed on a
// grass canvas, joined by paths; gardens, trees and flowers are scattered with a FIXED seed so
// the hub looks identical every visit. buildHubMap() is pure (used by scripts/dungeon-test.mjs).
//
//   Library (NW)      Great Hall (N)        Mage Tower (NE)
//   Dormitory (W)     Courtyard + fountain  Forge & Quartermaster (E)
//   Herb garden, pond (SW)   South gate     Dungeon portal circle (SE)
import { TileMap } from '../core/tilemap.js';
import { TILE } from '../core/tiles.js';
import { RNG } from '../core/rng.js';
import { EV } from '../core/events.js';
import { C, corner, stamp } from './util.js';
import { Npc, Wanderer, Door, Station, Sign, TowerSpire } from './entities.js';
import { NPCS, openNpcDialogue, openDialogue } from './dialogue.js';
import { flag, getObjective, nextTowerFloor, wardRequirement, craftedCount } from './story.js';

export const HUB_W = 64, HUB_H = 48;

const G = TILE;
const LEGEND = {
  '.': { ground: G.GRASS }, ',': { ground: G.GRASS_FLOWERS }, ':': { ground: G.PATH }, '_': { ground: G.STONE_FLOOR },
  '=': { ground: G.WOOD_FLOOR }, c: { ground: G.CARPET }, m: { ground: G.MARBLE }, '~': { ground: G.WATER },
  r: { ground: G.RUNE_FLOOR }, d: { ground: G.DIRT },
  '#': { ground: G.STONE_WALL }, B: { ground: G.BRICK_WALL }, W: { ground: G.WOOD_WALL }, T: { ground: G.TOWER_WALL },
  H: { ground: G.HEDGE },
  '^': { ground: G.STONE_WALL, deco: G.TORCH_WALL }, N: { ground: G.STONE_WALL, deco: G.BANNER },
  // garden
  t: { ground: G.GRASS, deco: G.TREE }, u: { ground: G.GRASS, deco: G.BUSH }, f: { ground: G.GRASS, deco: G.FLOWERS },
  o: { ground: G.GRASS, deco: G.ROCK }, s: { ground: G.GRASS, deco: G.STATUE }, y: { ground: G.GRASS, deco: G.LANTERN },
  n: { ground: G.PATH, deco: G.LANTERN }, Z: { ground: G.PATH, deco: G.BRAZIER }, j: { ground: G.PATH, deco: G.CHAIR },
  // wooden interiors (library, dormitory)
  L: { ground: G.WOOD_FLOOR, deco: G.BOOKSHELF }, A: { ground: G.WOOD_FLOOR, deco: G.TABLE }, h: { ground: G.WOOD_FLOOR, deco: G.CHAIR },
  g: { ground: G.WOOD_FLOOR, deco: G.RUG }, '*': { ground: G.WOOD_FLOOR, deco: G.CANDLES }, p: { ground: G.WOOD_FLOOR, deco: G.POTTED_PLANT },
  X: { ground: G.WOOD_FLOOR, deco: G.CRATE },
  // marble hall
  P: { ground: G.MARBLE, deco: G.PILLAR }, S: { ground: G.MARBLE, deco: G.STATUE }, a: { ground: G.MARBLE, deco: G.TABLE },
  k: { ground: G.MARBLE, deco: G.CHAIR }, q: { ground: G.MARBLE, deco: G.POTTED_PLANT }, l: { ground: G.MARBLE, deco: G.CANDLES },
  // stone (forge, portal circle)
  O: { ground: G.STONE_FLOOR, deco: G.BARREL }, x: { ground: G.STONE_FLOOR, deco: G.CRATE }, U: { ground: G.STONE_FLOOR, deco: G.CAULDRON },
  z: { ground: G.STONE_FLOOR, deco: G.BRAZIER }, b: { ground: G.STONE_FLOOR, deco: G.TABLE }, I: { ground: G.STONE_FLOOR, deco: G.PILLAR },
  F: { ground: G.STONE_FLOOR, deco: G.FOUNTAIN },
  // markers (NPCs, props, spawns)
  1: { ground: G.CARPET, marker: 'headmaster' }, 2: { ground: G.WOOD_FLOOR, deco: G.RUG, marker: 'librarian' },
  3: { ground: G.STONE_FLOOR, marker: 'artificer' }, 5: { ground: G.WOOD_FLOOR, marker: 'shy' },
  7: { ground: G.STONE_FLOOR, marker: 'quartermaster' }, 9: { ground: G.MARBLE, marker: 'archmage' },
  '&': { ground: G.STONE_FLOOR, marker: 'forge' }, '%': { ground: G.RUNE_FLOOR, marker: 'portal' }, $: { ground: G.PATH, marker: 'towerDoor' },
};

const GREAT_HALL = [
  '#^###N##^##^##N###^#',
  '#qlmmmmmSccSmmmmmlq#',
  '#mmmmmmmm1cmmmmmmmm#',
  '#mmmmmmmmccmmm9mmmm#',
  '#mPmmmmmmccmmmmmmPm#',
  '#mmakammmccmmmakamm#',
  '#mPmmmmmmccmmmmmmPm#',
  '#mmakammmccmmmakamm#',
  '#mPmmmmmmccmmmmmmPm#',
  '#mmmmmmmmccmmmmmmmm#',
  '#qmmmmmmmccmmmmmmmq#',
  '#lmmmmmmmccmmmmmmml#',
  '#mPmmmmmmccmmmmmmPm#',
  '#########cc#########',
];
const LIBRARY = [
  'BBBBBBBBBBBBBBBB',
  'BLLLLL*==*LLLLLB',
  'B==============B',
  'B=LL==gggg==LL=B',
  'B=LL==g2gg==LL=B',
  'B=====gggg=====B',
  'B=AhA======AhA=B',
  'B==============B',
  'B=LL=LL==LL=LL=B',
  'B=LL=LL==LL=LL=B',
  'Bp============pB',
  'B*====A==A====*B',
  'BBBBBBB==BBBBBBB',
];
const DORMITORY = [
  'WWWWWWWWWWWWWW',
  'WXg=Xg==Xg=XgW',
  'W=g==g===g==gW',
  'W============W',
  'Wp==========pW',
  'W==AhA==5===*W',
  'W=============',
  'W=============',
  'W*==========*W',
  'WXg=Xg==Xg=XgW',
  'W=g==g===g==gW',
  'Wp====h=====pW',
  'WWWWWWWWWWWWWW',
];
const FORGE = [
  'BBBBBBBBBBBBBB',
  'BO_U__z__U_OxB',
  'B____________B',
  'B_x________x_B',
  'B_____&______B',
  'B______3_____B',
  '_____________B',
  '_____________B',
  'B____________B',
  'B_bbb___7____B',
  'B____________B',
  'BxOx__z__xOx_B',
  'BBBBBBBBBBBBBB',
];
// The spire itself is an entity (TowerSpire, ~72x150 px) standing on this 4x4 solid footprint.
const TOWER = [
  '.y......y.',
  '..........',
  '..........',
  '..........',
  '...TTTT...',
  '...TTTT...',
  '...TTTT...',
  '.Z.TTTT.Z.',
  '..y:$::y..',
  '...::::...',
];
const PLAZA = [
  ',u,f.:::.f,u,',
  'n,..:::::..,n',
  '.::::~~~::::.',
  '::::~~~~~::::',
  ':::~~~~~~~:::',
  ':::~~~F~~~:::',
  ':::~~~~~~~:::',
  '::::~~~~~::::',
  '.::::~~~::::.',
  'n,..:::::..,n',
  ',u,f.:::.f,u,',
];
const PORTAL = [
  '.,.I___I.,.',
  '.I_______I.',
  'I__rrrrr__I',
  '__rrrrrrr__',
  '__rrr%rrr__',
  '__rrrrrrr__',
  'I__rrrrr__I',
  '.I_______I.',
  '.,.I...I.,.',
];

/** Building origins (tile coords of each stamp's top-left). */
export const HUB_LAYOUT = {
  library: { x: 2, y: 2, rows: LIBRARY },
  hall: { x: 22, y: 2, rows: GREAT_HALL },
  tower: { x: 48, y: 2, rows: TOWER },
  dorm: { x: 2, y: 20, rows: DORMITORY },
  forge: { x: 48, y: 20, rows: FORGE },
  plaza: { x: 26, y: 20, rows: PLAZA },
  portal: { x: 47, y: 36, rows: PORTAL },
};

/** Fixed points (tile coords) for things placed in code rather than stamps. */
export const HUB_SPOTS = {
  spawn: { tx: 32, ty: 17 },          // new game / continue: outside the Great Hall
  respawn: { tx: 21, ty: 31 },        // in front of Nurse Marigold
  fromDungeon: { tx: 52, ty: 42 },
  fromTower: { tx: 52, ty: 12 },
  healer: { tx: 21, ty: 29 },
  rival: { tx: 44, ty: 32 },
  signCourtyard: { tx: 27, ty: 16 },
  signPortal: { tx: 46, ty: 33 },
  signTower: { tx: 50, ty: 13 },
};

/** Wander zones (tiles, inclusive). */
export const HUB_ZONES = {
  courtyard: { x0: 18, y0: 22, x1: 46, y1: 33 },
  garden: { x0: 16, y0: 34, x1: 30, y1: 45 },
  east: { x0: 34, y0: 28, x1: 46, y1: 35 },
};

/** Pure: build the hub TileMap + markers. */
export function buildHubMap() {
  const W = HUB_W, H = HUB_H;
  const rng = new RNG('arcania-hub');
  const map = new TileMap(W, H, TILE.GRASS);
  const rect = (x, y, w, h, id) => map.fillRect('ground', x, y, w, h, id);

  // Lawn texture: patches of flowery grass.
  for (let i = 0; i < 26; i++) {
    const cx = rng.int(2, W - 3), cy = rng.int(2, H - 3), r = rng.int(1, 3);
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && rng.chance(0.7)) map.setGround(x, y, TILE.GRASS_FLOWERS);
    }
  }

  // Paths (drawn first; stamps overwrite where they overlap).
  rect(31, 16, 2, 4, TILE.PATH);    // Great Hall -> plaza
  rect(9, 17, 46, 2, TILE.PATH);    // north avenue: library <-> hall <-> tower
  rect(9, 15, 2, 3, TILE.PATH);     // library door
  rect(52, 12, 2, 6, TILE.PATH);    // tower door
  rect(16, 26, 10, 2, TILE.PATH);   // dormitory <-> plaza
  rect(39, 26, 9, 2, TILE.PATH);    // plaza <-> forge
  rect(31, 31, 3, 16, TILE.PATH);   // south gate
  rect(34, 34, 20, 2, TILE.PATH);   // -> portal
  rect(15, 40, 16, 2, TILE.PATH);   // -> pond
  rect(16, 28, 2, 4, TILE.PATH);    // infirmary corner
  rect(18, 30, 6, 2, TILE.PATH);

  // Pond with a little wooden dock.
  for (let y = 36; y <= 45; y++) for (let x = 3; x <= 15; x++) {
    const dx = (x - 9) / 6, dy = (y - 40.5) / 4;
    const d = dx * dx + dy * dy;
    if (d <= 0.55) map.setGround(x, y, TILE.DEEP_WATER);
    else if (d <= 1) map.setGround(x, y, TILE.WATER);
    else if (d <= 1.25) map.setGround(x, y, TILE.SAND);
  }
  rect(12, 40, 3, 2, TILE.BRIDGE);

  // Herb garden (fenced dirt beds) west of the south path.
  rect(19, 36, 9, 3, TILE.DIRT);
  for (let x = 19; x < 28; x++) { map.setDeco(x, 35, TILE.FENCE); if (x !== 23) map.setDeco(x, 39, TILE.FENCE); }
  for (let x = 20; x < 27; x += 2) map.setDeco(x, 37, TILE.FLOWERS);

  // Buildings.
  const markers = {};
  for (const b of Object.values(HUB_LAYOUT)) stamp(map, b.x, b.y, b.rows, LEGEND, markers);

  // Flowerbeds around the plaza.
  for (const [x0, y0] of [[20, 20], [40, 20], [20, 29], [40, 29]]) {
    for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 4; x++) {
      if (map.getGround(x, y) !== TILE.GRASS && map.getGround(x, y) !== TILE.GRASS_FLOWERS) continue;
      map.setGround(x, y, TILE.GRASS_FLOWERS);
      map.setDeco(x, y, (x + y) % 2 ? TILE.FLOWERS : 0);
    }
  }
  // Lanterns along the avenues, statues by the gate, benches on the plaza.
  for (const x of [13, 19, 25, 38, 44, 49]) { map.setDeco(x, 16, TILE.LANTERN); map.setDeco(x, 19, TILE.LANTERN); }
  for (const y of [33, 38, 43]) { map.setDeco(30, y, TILE.LANTERN); map.setDeco(34, y, TILE.LANTERN); }
  map.setDeco(30, 46, TILE.STATUE); map.setDeco(34, 46, TILE.STATUE);
  map.setDeco(19, 25, TILE.STATUE); map.setDeco(45, 25, TILE.STATUE);
  for (const [x, y] of [[27, 22], [37, 22], [27, 28], [37, 28]]) map.setDeco(x, y, TILE.CHAIR);

  // Hedge border with corner topiary.
  rect(0, 0, W, 1, TILE.HEDGE); rect(0, H - 1, W, 1, TILE.HEDGE);
  rect(0, 0, 1, H, TILE.HEDGE); rect(W - 1, 0, 1, H, TILE.HEDGE);

  // Trees, bushes, rocks and mushrooms on open lawn (never next to paths or buildings).
  const keepClear = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const g = map.getGround(x + dx, y + dy);
      if (g !== TILE.GRASS && g !== TILE.GRASS_FLOWERS && g !== TILE.HEDGE) return true;
      if (map.getDeco(x + dx, y + dy) && (dx || dy) && map.getDeco(x + dx, y + dy) !== TILE.FLOWERS) return true;
    }
    for (const s of Object.values(HUB_SPOTS)) if (Math.abs(s.tx - x) <= 2 && Math.abs(s.ty - y) <= 2) return true;
    return false;
  };
  for (let i = 0; i < 900; i++) {
    const x = rng.int(1, W - 2), y = rng.int(1, H - 2);
    const g = map.getGround(x, y);
    if ((g !== TILE.GRASS && g !== TILE.GRASS_FLOWERS) || map.getDeco(x, y) || keepClear(x, y)) continue;
    const edge = x < 3 || y < 3 || x > W - 4 || y > H - 4;
    const r = rng.next();
    if (r < (edge ? 0.5 : 0.14)) map.setDeco(x, y, TILE.TREE);
    else if (r < 0.22) map.setDeco(x, y, TILE.BUSH);
    else if (r < 0.27) map.setDeco(x, y, TILE.ROCK);
    else if (r < 0.33) map.setDeco(x, y, TILE.MUSHROOMS);
    else if (r < 0.6) map.setDeco(x, y, TILE.FLOWERS);
  }
  map.randomizeVariants(rng);
  return { map, markers };
}

// ===================================================================== level

export function buildHub(game, spec) {
  const { map, markers } = buildHubMap();
  const s = game.state;
  const E = game.entities;
  const M = (name) => markers[name]?.[0];
  const rng = new RNG(`hub-npcs:${Math.floor(game.time)}`);

  const npcAt = (id, p) => p && E.add(new Npc(NPCS[id], p.x, p.y, openNpcDialogue));
  npcAt('headmaster', M('headmaster'));
  npcAt('librarian', M('librarian'));
  npcAt('artificer', M('artificer'));
  npcAt('quartermaster', M('quartermaster'));
  npcAt('shy', M('shy'));
  npcAt('healer', C(HUB_SPOTS.healer.tx, HUB_SPOTS.healer.ty));
  npcAt('rival', C(HUB_SPOTS.rival.tx, HUB_SPOTS.rival.ty));
  if (flag(s, 'archmageDefeated')) npcAt('archmage', M('archmage'));

  // Ambient life: wandering students, Pip, and Mote the cat.
  const wander = (id, zone, opts = {}) => {
    const z = HUB_ZONES[zone];
    for (let tries = 0; tries < 30; tries++) {
      const tx = rng.int(z.x0, z.x1), ty = rng.int(z.y0, z.y1);
      if (map.isSolid(tx, ty)) continue;
      const p = C(tx, ty);
      const npc = opts.def || NPCS[id];
      return E.add(new Wanderer(npc, p.x, p.y, openNpcDialogue, { zone: z, rng: rng.fork(`${id}${tries}${zone}`), ...opts }));
    }
    return null;
  };
  const variants = ['npc_student', 'npc_student_b', 'npc_student_c', 'npc_student_b'];
  for (let i = 0; i < 4; i++) {
    const def = { ...NPCS.wanderer, sprite: variants[i], fallbackSprite: 'npc_student' };
    wander('wanderer', i < 3 ? 'courtyard' : 'garden', { def, speed: 18 + i * 3 });
  }
  wander('student', 'east', { speed: 24 });
  wander('cat', 'garden', { speed: 34, pauseMin: 2, pauseMax: 6 });

  // The Arcane Forge.
  const forge = M('forge');
  if (forge) E.add(new Station(forge.x, forge.y + 4, { sprite: 'prop_forge', prompt: 'Craft', onInteract: (g) => g.ui.open('crafting') }));

  // Mage Tower: decorative spire + door.
  const td = M('towerDoor');
  const tb = HUB_LAYOUT.tower;
  E.add(new TowerSpire((tb.x + 5) * 16, (tb.y + 8) * 16));
  if (td) {
    const floor = nextTowerFloor(s);
    const door = E.add(new Door(td.x + 8, td.y - 6, {
      sprite: 'prop_tower_door', to: flag(s, `towerFloor5Cleared`) ? 'boss' : 'tower', prompt: 'Climb', params: { floor },
      requires: { flags: { towerUnlocked: true } },
      lockedText: flag(s, 'metHeadmaster') ? 'The tower door is sealed by the Headmaster\'s ward.' : 'Sealed. Perhaps the Headmaster knows why.',
      check: (g) => (craftedCount(g.state) < wardRequirement(floor) ? 'A ward of woven elements bars the way. Craft more spells at the Forge.' : null),
      light: { radius: 40, color: flag(s, 'archmageDefeated') ? '#7ad8ff' : '#ff3a8a' },
    }));
    door.layer = 1;
    door.sortOffset = 2;
    // The spire sprite has its own doorway; only draw the door prop if art has no tower sprite.
    if (game.art.hasSprite('prop_mage_tower')) door.visible = false;
    if (flag(s, `towerFloor5Cleared`)) door.params = {};
  }

  // Dungeon portal: opens the waystone menu.
  const portal = M('portal');
  if (portal) {
    E.add(new Door(portal.x, portal.y + 6, {
      sprite: 'prop_portal', to: 'dungeon', prompt: 'Descend', params: { depth: 1 },
      requires: { flags: { metHeadmaster: true } }, lockedText: 'The portal flickers weakly. Speak with the Headmaster first.',
      onUse: (g) => openDialogue(g, 'portal_menu', 'portal'),
      light: { radius: 56, color: '#b05aff' },
    }));
  }

  // Signposts.
  const sign = (spot, lines) => {
    const p = C(spot.tx, spot.ty);
    E.add(new Sign(p.x, p.y + 4, { onRead: (g) => openDialogue(g, { id: 'sign', start: 'a', nodes: lines(g) }, 'sign') }));
  };
  sign(HUB_SPOTS.signCourtyard, () => ({
    a: { speaker: 'sign', text: 'ARCANIA ACADEMY. North: Great Hall. North-west: Library. East: Forge. West: Dormitory.', next: 'b' },
    b: { speaker: 'sign', text: 'South-east: Dungeon Portal. North-east: the Mage Tower. Please do not feed the cat after midnight.', next: null },
  }));
  sign(HUB_SPOTS.signPortal, () => ({
    a: { speaker: 'sign', text: 'DUNGEON PORTAL. Carry potions. Fragments found below are yours to keep. Beware rooms that seal shut!', next: null },
  }));
  sign(HUB_SPOTS.signTower, (g) => ({
    a: { speaker: 'sign', text: flag(g.state, 'towerUnlocked')
      ? 'THE MAGE TOWER. Five floors. One Archmage. Stair-wards admit only mages who craft their own spells.'
      : 'THE MAGE TOWER. Sealed by order of Headmaster Elowen. Trespassers will be turned into newts.', next: null },
  }));

  const spot = (p) => C(p.tx, p.ty);
  const spawns = {
    dungeon: spot(HUB_SPOTS.fromDungeon),
    tower: spot(HUB_SPOTS.fromTower),
    respawn: spot(HUB_SPOTS.respawn),
  };
  const from = spec.from;
  const victory = flag(s, 'archmageDefeated');
  return {
    kind: 'hub', id: 'hub', name: 'Arcania Academy', map,
    playerSpawn: spawns[from] || spot(HUB_SPOTS.spawn),
    music: 'hub', bgColor: '#0b0716',
    ambient: { darkness: victory ? 0.06 : 0.16, color: victory ? '#1a2a40' : '#100a30' },
    data: { objective: getObjective(s), markers },
    onEnter(g) {
      if (from === 'respawn') {
        g.after(0.7, () => openDialogue(g, 'healer_respawn', 'healer'));
      } else if (from === 'newGame' || from === 'continue' || from === 'debug' || from == null) {
        g.after(1.2, () => g.bus.emit(EV.TOAST, { text: getObjective(g.state), color: '#ffd25a', duration: 4 }));
      }
    },
  };
}

export { corner };
