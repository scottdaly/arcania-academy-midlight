// Shared tile vocabulary. IDs are stable numbers stored in Uint8Array map layers (0..255).
// world generates maps with these ids, art draws them, physics reads solid/blocksShot.
// Need a new tile? Add a line to requests/<team>.md - core will assign an id here.
//
// Ranges:   0       EMPTY (void)
//           1-19    floors          20-39  liquids & hazards
//           40-59   walls           60-119 decorations (deco layer)
//           120-199 reserved        200-255 free for experiments (ask core before shipping)

export const TILE = Object.freeze({
  EMPTY: 0,
  // floors
  GRASS: 1, GRASS_FLOWERS: 2, DIRT: 3, PATH: 4, STONE_FLOOR: 5, WOOD_FLOOR: 6, CARPET: 7,
  MARBLE: 8, DUNGEON_FLOOR: 9, DUNGEON_FLOOR_MOSSY: 10, TOWER_FLOOR: 11, RUNE_FLOOR: 12,
  BRIDGE: 13, SAND: 14,
  // liquids / hazards
  WATER: 20, DEEP_WATER: 21, LAVA: 22, ICE_FLOOR: 23, CHASM: 24, POISON: 25,
  // walls
  STONE_WALL: 40, BRICK_WALL: 41, DUNGEON_WALL: 42, TOWER_WALL: 43, HEDGE: 44, CRYSTAL_WALL: 45,
  WOOD_WALL: 46,
  // decorations (deco layer, drawn over ground; 16x16 max)
  TREE: 60, BUSH: 61, ROCK: 62, FLOWERS: 63, BOOKSHELF: 64, TABLE: 65, PILLAR: 66, STATUE: 67,
  TORCH_WALL: 68, BANNER: 69, CRYSTAL: 70, RUBBLE: 71, MUSHROOMS: 72, FENCE: 73, BARREL: 74,
  CRATE: 75, CAULDRON: 76, RUG: 77, LANTERN: 78, FOUNTAIN: 79, CANDLES: 80, BONES: 81,
  COBWEB: 82, CHAIR: 83, POTTED_PLANT: 84, BRAZIER: 85, RUNE_CIRCLE: 86,
});

/**
 * Per-tile properties.
 *  solid       blocks walking (mask 'walk')
 *  blocksShot  blocks projectiles & line of sight (mask 'shot')
 *  liquid      true for water-like tiles (art may animate; combat may apply effects)
 *  hazard      {element, dps} damage per second while standing on it (combat applies)
 *  slow        movement multiplier while on tile (combat applies), e.g. 0.6
 *  light       {radius, color, flicker?} static light source (fx scans the map on LEVEL_READY)
 *  animated    art should redraw it every frame via drawTile(..., time)
 */
const D = (name, props = {}) => ({
  name, solid: false, blocksShot: false, liquid: false, hazard: null, slow: 1, light: null, animated: false, ...props,
});
const WALL = { solid: true, blocksShot: true };
const PROP = { solid: true, blocksShot: false };
const PROP_TALL = { solid: true, blocksShot: true };

export const TILE_DEFS = (() => {
  const t = new Array(256);
  const T = TILE;
  t[T.EMPTY] = D('empty', WALL);
  t[T.GRASS] = D('grass');
  t[T.GRASS_FLOWERS] = D('grass_flowers');
  t[T.DIRT] = D('dirt');
  t[T.PATH] = D('path');
  t[T.STONE_FLOOR] = D('stone_floor');
  t[T.WOOD_FLOOR] = D('wood_floor');
  t[T.CARPET] = D('carpet');
  t[T.MARBLE] = D('marble');
  t[T.DUNGEON_FLOOR] = D('dungeon_floor');
  t[T.DUNGEON_FLOOR_MOSSY] = D('dungeon_floor_mossy');
  t[T.TOWER_FLOOR] = D('tower_floor');
  t[T.RUNE_FLOOR] = D('rune_floor', { light: { radius: 18, color: '#7a5aff' }, animated: true });
  t[T.BRIDGE] = D('bridge');
  t[T.SAND] = D('sand');

  t[T.WATER] = D('water', { solid: true, liquid: true, animated: true });
  t[T.DEEP_WATER] = D('deep_water', { solid: true, liquid: true, animated: true });
  t[T.LAVA] = D('lava', { liquid: true, animated: true, hazard: { element: 'fire', dps: 20 }, slow: 0.6, light: { radius: 28, color: '#ff6a1f', flicker: true } });
  t[T.ICE_FLOOR] = D('ice_floor', { slow: 1.15 });
  t[T.CHASM] = D('chasm', { solid: true });
  t[T.POISON] = D('poison', { liquid: true, animated: true, hazard: { element: 'earth', dps: 8 }, slow: 0.7 });

  t[T.STONE_WALL] = D('stone_wall', WALL);
  t[T.BRICK_WALL] = D('brick_wall', WALL);
  t[T.DUNGEON_WALL] = D('dungeon_wall', WALL);
  t[T.TOWER_WALL] = D('tower_wall', WALL);
  t[T.HEDGE] = D('hedge', WALL);
  t[T.CRYSTAL_WALL] = D('crystal_wall', { ...WALL, light: { radius: 24, color: '#5ad8ff' } });
  t[T.WOOD_WALL] = D('wood_wall', WALL);

  t[T.TREE] = D('tree', PROP_TALL);
  t[T.BUSH] = D('bush', PROP);
  t[T.ROCK] = D('rock', PROP);
  t[T.FLOWERS] = D('flowers');
  t[T.BOOKSHELF] = D('bookshelf', PROP_TALL);
  t[T.TABLE] = D('table', PROP);
  t[T.PILLAR] = D('pillar', PROP_TALL);
  t[T.STATUE] = D('statue', PROP_TALL);
  t[T.TORCH_WALL] = D('torch_wall', { ...WALL, animated: true, light: { radius: 56, color: '#ffae4a', flicker: true } });
  t[T.BANNER] = D('banner', WALL);
  t[T.CRYSTAL] = D('crystal', { ...PROP, animated: true, light: { radius: 40, color: '#5ad8ff' } });
  t[T.RUBBLE] = D('rubble');
  t[T.MUSHROOMS] = D('mushrooms', { light: { radius: 14, color: '#5affb0' } });
  t[T.FENCE] = D('fence', PROP);
  t[T.BARREL] = D('barrel', PROP);
  t[T.CRATE] = D('crate', PROP);
  t[T.CAULDRON] = D('cauldron', { ...PROP, animated: true, light: { radius: 24, color: '#7aff5a' } });
  t[T.RUG] = D('rug');
  t[T.LANTERN] = D('lantern', { ...PROP, animated: true, light: { radius: 48, color: '#ffd08a', flicker: true } });
  t[T.FOUNTAIN] = D('fountain', { ...PROP, animated: true });
  t[T.CANDLES] = D('candles', { animated: true, light: { radius: 28, color: '#ffcf7a', flicker: true } });
  t[T.BONES] = D('bones');
  t[T.COBWEB] = D('cobweb');
  t[T.CHAIR] = D('chair');
  t[T.POTTED_PLANT] = D('potted_plant', PROP);
  t[T.BRAZIER] = D('brazier', { ...PROP, animated: true, light: { radius: 64, color: '#ff9a3a', flicker: true } });
  t[T.RUNE_CIRCLE] = D('rune_circle', { animated: true, light: { radius: 32, color: '#b05aff' } });

  // Unassigned ids behave as plain non-solid floor so bad data never crashes.
  for (let i = 0; i < 256; i++) if (!t[i]) t[i] = D(`unknown_${i}`);
  return Object.freeze(t);
})();

export function tileDef(id) {
  return TILE_DEFS[id & 255];
}
