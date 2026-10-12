// Placeholder tile painter (art team owns). Replace with real procedural pixel art.
// drawTileImpl is called by core's TileMapRenderer via art.drawTile:
//   static tiles once into a cache (time = 0); TILE_DEFS[id].animated tiles every frame.
import { TILE } from '../core/tiles.js';
import { rect, px, disc, shade } from './pixel.js';

const T = TILE;
const BASE = {
  [T.EMPTY]: '#05030a',
  [T.GRASS]: '#3f8f3a', [T.GRASS_FLOWERS]: '#3f8f3a', [T.DIRT]: '#7a5a3a', [T.PATH]: '#b8a07a',
  [T.STONE_FLOOR]: '#6a6478', [T.WOOD_FLOOR]: '#8a5a32', [T.CARPET]: '#7a2a4a', [T.MARBLE]: '#c8c4d8',
  [T.DUNGEON_FLOOR]: '#3a3448', [T.DUNGEON_FLOOR_MOSSY]: '#3a4440', [T.TOWER_FLOOR]: '#4a3a6a',
  [T.RUNE_FLOOR]: '#2a2048', [T.BRIDGE]: '#8a6a42', [T.SAND]: '#d8c08a',
  [T.WATER]: '#2a6ab8', [T.DEEP_WATER]: '#1a3a7a', [T.LAVA]: '#d8401a', [T.ICE_FLOOR]: '#a8d8f0',
  [T.CHASM]: '#05030a', [T.POISON]: '#4a8a2a',
  [T.STONE_WALL]: '#4a4458', [T.BRICK_WALL]: '#6a3a3a', [T.DUNGEON_WALL]: '#2a2238', [T.TOWER_WALL]: '#3a2a5a',
  [T.HEDGE]: '#235a2a', [T.CRYSTAL_WALL]: '#3a7aa8', [T.WOOD_WALL]: '#5a3a22',
};
const DECO = {
  [T.TREE]: '#2a6a2a', [T.BUSH]: '#3a7a32', [T.ROCK]: '#7a7484', [T.FLOWERS]: '#ff7ab8',
  [T.BOOKSHELF]: '#5a3a1a', [T.TABLE]: '#7a4a22', [T.PILLAR]: '#a8a0b8', [T.STATUE]: '#b8b4c8',
  [T.TORCH_WALL]: '#ffae4a', [T.BANNER]: '#8a2a4a', [T.CRYSTAL]: '#5ad8ff', [T.RUBBLE]: '#5a5468',
  [T.MUSHROOMS]: '#5affb0', [T.FENCE]: '#8a6a42', [T.BARREL]: '#7a4a22', [T.CRATE]: '#9a6a32',
  [T.CAULDRON]: '#2a2a32', [T.RUG]: '#8a3a5a', [T.LANTERN]: '#ffd08a', [T.FOUNTAIN]: '#a8a0b8',
  [T.CANDLES]: '#ffe8b0', [T.BONES]: '#e8e0d0', [T.COBWEB]: '#d8d8e8', [T.CHAIR]: '#7a4a22',
  [T.POTTED_PLANT]: '#3a8a3a', [T.BRAZIER]: '#ff9a3a', [T.RUNE_CIRCLE]: '#b05aff',
};

function speckle(ctx, x, y, v, color, n = 3) {
  for (let i = 0; i < n; i++) {
    const h = (v * 31 + i * 57) & 255;
    px(ctx, x + (h % 14) + 1, y + ((h >> 4) % 14) + 1, color);
  }
}

export function drawTileImpl(ctx, id, def, x, y, v, t) {
  if (id >= 40 && id < 60) {
    // walls: body + lit top edge + dark base
    const c = BASE[id] || '#444';
    rect(ctx, x, y, 16, 16, c);
    rect(ctx, x, y, 16, 3, shade(c, 0.25));
    rect(ctx, x, y + 14, 16, 2, shade(c, -0.35));
    if (id === T.BRICK_WALL || id === T.STONE_WALL) {
      rect(ctx, x, y + 8, 16, 1, shade(c, -0.25));
      rect(ctx, x + ((v & 1) ? 4 : 10), y + 3, 1, 5, shade(c, -0.25));
    }
    return;
  }
  if (id >= 60) {
    drawDeco(ctx, id, x, y, v, t);
    return;
  }
  const c = BASE[id] || '#ff00ff';
  rect(ctx, x, y, 16, 16, c);
  if (def.liquid) {
    const o = Math.floor(t * 6 + (x + y) / 8) % 16;
    rect(ctx, x + o, y + 4, 4, 1, shade(c, 0.35));
    rect(ctx, x + ((o + 8) % 16), y + 11, 3, 1, shade(c, 0.25));
    return;
  }
  if (id === T.RUNE_FLOOR) {
    const a = 0.4 + 0.3 * Math.sin(t * 3 + x * 0.1);
    ctx.globalAlpha = a;
    rect(ctx, x + 4, y + 7, 8, 2, '#b05aff');
    rect(ctx, x + 7, y + 4, 2, 8, '#b05aff');
    ctx.globalAlpha = 1;
    return;
  }
  speckle(ctx, x, y, v, shade(c, (v & 1) ? 0.12 : -0.12), 4);
  if (id === T.GRASS_FLOWERS) speckle(ctx, x, y, v + 7, '#ffe14a', 2);
  if (id === T.STONE_FLOOR || id === T.DUNGEON_FLOOR || id === T.TOWER_FLOOR) {
    rect(ctx, x, y + 15, 16, 1, shade(c, -0.2));
    rect(ctx, x + 15, y, 1, 16, shade(c, -0.2));
  }
}

function drawDeco(ctx, id, x, y, v, t) {
  const c = DECO[id] || '#ff00ff';
  switch (id) {
    case T.TREE:
      rect(ctx, x + 7, y + 10, 2, 6, '#5a3a1a');
      disc(ctx, x + 8, y + 7, 6, c);
      disc(ctx, x + 6, y + 5, 2, shade(c, 0.2));
      return;
    case T.BOOKSHELF:
      rect(ctx, x + 1, y, 14, 16, c);
      for (let r = 0; r < 3; r++) for (let b = 0; b < 5; b++) {
        rect(ctx, x + 2 + b * 2.5, y + 1 + r * 5, 2, 4, ['#a83a3a', '#3a6aa8', '#3a8a4a', '#d8b04a'][(v + r + b) & 3]);
      }
      return;
    case T.PILLAR:
    case T.STATUE:
      rect(ctx, x + 4, y + 1, 8, 15, c);
      rect(ctx, x + 3, y, 10, 2, shade(c, 0.2));
      rect(ctx, x + 3, y + 14, 10, 2, shade(c, -0.2));
      return;
    case T.TORCH_WALL:
    case T.BRAZIER:
    case T.CANDLES:
    case T.LANTERN: {
      if (id === T.TORCH_WALL) {
        rect(ctx, x, y, 16, 16, '#2a2238');
        rect(ctx, x, y, 16, 3, shade('#2a2238', 0.25));
      }
      rect(ctx, x + 7, y + 8, 2, 6, '#5a3a1a');
      const f = Math.floor(t * 10 + v) % 3;
      rect(ctx, x + 6, y + 4 + f % 2, 4, 4, '#ff8a2a');
      rect(ctx, x + 7, y + 5 + f % 2, 2, 2, '#ffe14a');
      return;
    }
    case T.CRYSTAL: {
      const g = 0.2 * Math.sin(t * 2 + v);
      rect(ctx, x + 6, y + 2, 4, 13, shade(c, g));
      rect(ctx, x + 3, y + 7, 3, 8, shade(c, -0.2 + g));
      rect(ctx, x + 10, y + 6, 3, 9, shade(c, -0.1 + g));
      return;
    }
    case T.FOUNTAIN:
      disc(ctx, x + 8, y + 8, 7, c);
      disc(ctx, x + 8, y + 8, 5, '#2a6ab8');
      rect(ctx, x + 7, y + 3 + (Math.floor(t * 6) % 2), 2, 4, '#e6fbff');
      return;
    case T.CAULDRON:
      disc(ctx, x + 8, y + 10, 5, c);
      rect(ctx, x + 4, y + 6, 8, 2, '#7aff5a');
      px(ctx, x + 6 + (Math.floor(t * 4) % 4), y + 4, '#b8ffa8');
      return;
    case T.RUNE_CIRCLE:
    case T.RUG:
    case T.FLOWERS:
    case T.RUBBLE:
    case T.BONES:
    case T.COBWEB:
    case T.MUSHROOMS:
      ctx.globalAlpha = id === T.RUNE_CIRCLE ? 0.5 + 0.3 * Math.sin(t * 2) : 1;
      speckle(ctx, x, y, v, c, id === T.RUG ? 0 : 6);
      if (id === T.RUG || id === T.RUNE_CIRCLE) {
        rect(ctx, x + 1, y + 1, 14, 1, c); rect(ctx, x + 1, y + 14, 14, 1, c);
        rect(ctx, x + 1, y + 1, 1, 14, c); rect(ctx, x + 14, y + 1, 1, 14, c);
      }
      ctx.globalAlpha = 1;
      return;
    default:
      disc(ctx, x + 8, y + 9, 5, c);
      disc(ctx, x + 7, y + 7, 2, shade(c, 0.25));
  }
}
