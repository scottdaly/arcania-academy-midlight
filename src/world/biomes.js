// Dungeon biomes by depth (team: world). Pure data.
// Each biome favours certain fragment elements and enemy types, and drives the generator's
// layout style (room shapes, caves, liquids) and decoration palette.
//
// Enemy ids are combat's (ENEMIES in src/combat). Ids combat does not define are filtered out
// at spawn time (generateDungeon opts.enemyFilter), so the pools always resolve.
import { TILE } from '../core/tiles.js';

export const BIOMES = {
  catacombs: {
    id: 'catacombs', name: 'Overgrown Catacombs', depths: [1, 2],
    blurb: 'Roots split the old ossuary walls. Earth and fire fragments glimmer in the moss.',
    wall: TILE.DUNGEON_WALL, wallAlt: TILE.BRICK_WALL, wallAltChance: 0.06,
    floor: TILE.DUNGEON_FLOOR, floorAlt: TILE.DUNGEON_FLOOR_MOSSY, floorAltChance: 0.35,
    patch: TILE.GRASS, patchChance: 0.5, // overgrown grass patches in rooms
    liquid: TILE.POISON, liquidChance: 0.35, liquidSolid: false,
    obstacle: TILE.WATER, // solid pools (connectivity-checked)
    deco: [[TILE.MUSHROOMS, 4], [TILE.BONES, 3], [TILE.COBWEB, 3], [TILE.RUBBLE, 2], [TILE.BUSH, 1]],
    props: [TILE.PILLAR, TILE.STATUE, TILE.BARREL],
    caveChance: 0.35, corridorWidth: 1, extraLoops: 2,
    fragments: { earth: 4, fire: 3, lightning: 1, ice: 1 },
    enemies: [['armor_knight', 5], ['golem_stone', 3], ['armor_lancer', 2], ['wisp_ember', 2]],
    ambient: { darkness: 0.8, color: '#06100a' }, bgColor: '#040805', music: 'dungeon',
    torchChance: 0.07,
  },
  crypts: {
    id: 'crypts', name: 'Frozen Crypts', depths: [3, 4],
    blurb: 'Rime coats the sarcophagi. Ice and arcane fragments sleep in the frost.',
    wall: TILE.BRICK_WALL, wallAlt: TILE.CRYSTAL_WALL, wallAltChance: 0.025,
    floor: TILE.STONE_FLOOR, floorAlt: TILE.ICE_FLOOR, floorAltChance: 0.3,
    patch: TILE.ICE_FLOOR, patchChance: 0.6,
    liquid: TILE.DEEP_WATER, liquidChance: 0.3, liquidSolid: true,
    obstacle: TILE.DEEP_WATER,
    deco: [[TILE.CRYSTAL, 2], [TILE.BONES, 3], [TILE.COBWEB, 2], [TILE.CANDLES, 1], [TILE.RUBBLE, 2]],
    props: [TILE.PILLAR, TILE.STATUE, TILE.CRYSTAL],
    caveChance: 0.15, corridorWidth: 2, extraLoops: 2,
    fragments: { ice: 4, arcane: 3, lightning: 1, fire: 1 },
    enemies: [['golem_frost', 4], ['wisp_frost', 3], ['golem_crystal', 2], ['armor_knight', 2], ['armor_sentinel', 1]],
    ambient: { darkness: 0.78, color: '#050a18' }, bgColor: '#03060e', music: 'dungeon',
    torchChance: 0.05,
  },
  vaults: {
    id: 'vaults', name: 'Storm Vaults', depths: [5, 6],
    blurb: 'Lightning arcs between ancient pylons. Lightning and arcane fragments crackle here.',
    wall: TILE.TOWER_WALL, wallAlt: TILE.STONE_WALL, wallAltChance: 0.1,
    floor: TILE.MARBLE, floorAlt: TILE.TOWER_FLOOR, floorAltChance: 0.4,
    patch: TILE.RUNE_FLOOR, patchChance: 0.35,
    liquid: TILE.CHASM, liquidChance: 0.4, liquidSolid: true,
    obstacle: TILE.CHASM,
    deco: [[TILE.RUBBLE, 3], [TILE.CANDLES, 1], [TILE.COBWEB, 1], [TILE.BONES, 1]],
    props: [TILE.PILLAR, TILE.BRAZIER, TILE.STATUE],
    caveChance: 0.05, corridorWidth: 2, extraLoops: 3,
    fragments: { lightning: 4, arcane: 3, ice: 1, fire: 1 },
    enemies: [['wisp_storm', 3], ['armor_knight', 3], ['armor_captain', 2], ['armor_sentinel', 2], ['armor_lancer', 2]],
    ambient: { darkness: 0.74, color: '#0c0620' }, bgColor: '#06030f', music: 'dungeon',
    torchChance: 0.06,
  },
  magma: {
    id: 'magma', name: 'Magma Depths', depths: [7, Infinity],
    blurb: 'The Academy\'s roots touch the world\'s molten heart. Fire and earth run thick.',
    wall: TILE.STONE_WALL, wallAlt: TILE.DUNGEON_WALL, wallAltChance: 0.15,
    floor: TILE.DIRT, floorAlt: TILE.SAND, floorAltChance: 0.25,
    patch: TILE.DUNGEON_FLOOR, patchChance: 0.3,
    liquid: TILE.LAVA, liquidChance: 0.55, liquidSolid: false,
    obstacle: TILE.CHASM,
    deco: [[TILE.RUBBLE, 4], [TILE.ROCK, 2], [TILE.BONES, 1], [TILE.CRYSTAL, 1]],
    props: [TILE.ROCK, TILE.BRAZIER, TILE.PILLAR],
    caveChance: 0.7, corridorWidth: 2, extraLoops: 2,
    fragments: { fire: 4, earth: 4, lightning: 1, arcane: 1 },
    enemies: [['golem_ember', 4], ['wisp_ember', 3], ['golem_stone', 2], ['armor_captain', 2]],
    ambient: { darkness: 0.7, color: '#1a0602' }, bgColor: '#0c0302', music: 'dungeon',
    torchChance: 0.04,
  },
};

export const BIOME_ORDER = ['catacombs', 'crypts', 'vaults', 'magma'];

export function biomeForDepth(depth) {
  for (const id of BIOME_ORDER) {
    const b = BIOMES[id];
    if (depth >= b.depths[0] && depth <= b.depths[1]) return b;
  }
  return BIOMES.magma;
}

/** First depth of each biome (for the portal's waystone menu). */
export const BIOME_START_DEPTHS = BIOME_ORDER.map((id) => ({ depth: BIOMES[id].depths[0], biome: BIOMES[id] }));
