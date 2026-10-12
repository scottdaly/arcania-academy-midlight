// Dungeon / tower minimap with fog of war (team: ui).
// A per-level canvas holds 1-2 px per tile. Tiles are painted incrementally as the player reveals
// them (radius ~6 tiles), so the per-frame cost is one drawImage + a few dots.
import { TILE_DEFS } from '../core/tiles.js';
import { TILE_SIZE } from '../core/config.js';
import { plate } from './hud-icons.js';

const REVEAL_R = 7;
const C_FLOOR = '#5a4a8c';
const C_FLOOR2 = '#56468a';
const C_WALL = '#d8ccff';
const C_PROP = '#3a2e60';
const C_WATER = '#2e5c9e';
const HAZARD = { fire: '#e0561c', ice: '#7ad8ff', lightning: '#e8d040', arcane: '#9a4ae0', earth: '#6a9a2a', poison: '#5aa040' };

export function createMinimap(game) {
  let map = null, fog = null, canvas = null, g = null, px = 1, timer = 0;

  const walkable = (tx, ty) => {
    if (!map.inBounds(tx, ty)) return false;
    const d = TILE_DEFS[map.getGround(tx, ty)];
    return !!d && (!d.solid || d.liquid);
  };

  function tileColor(tx, ty) {
    const d = TILE_DEFS[map.getGround(tx, ty)];
    if (!d) return null;
    if (d.hazard) return HAZARD[d.hazard.element] || '#c04a3a';
    if (d.liquid) return d.name === 'chasm' ? '#0b0716' : C_WATER;
    if (d.solid) {
      // only walls that border walkable space are drawn: crisp room outlines, no solid blobs
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && walkable(tx + dx, ty + dy)) return C_WALL;
      return null;
    }
    const deco = map.getDeco(tx, ty);
    if (deco && TILE_DEFS[deco]?.solid) return C_PROP;
    return (tx + ty) & 1 ? C_FLOOR : C_FLOOR2;
  }

  function reveal() {
    const p = game.player;
    if (!p || !map) return;
    const ptx = Math.floor(p.x / TILE_SIZE), pty = Math.floor(p.y / TILE_SIZE);
    const rr = REVEAL_R * REVEAL_R + REVEAL_R;
    for (let dy = -REVEAL_R; dy <= REVEAL_R; dy++) {
      const ty = pty + dy;
      if (ty < 0 || ty >= map.h) continue;
      for (let dx = -REVEAL_R; dx <= REVEAL_R; dx++) {
        const tx = ptx + dx;
        if (tx < 0 || tx >= map.w || dx * dx + dy * dy > rr) continue;
        const i = ty * map.w + tx;
        if (fog[i]) continue;
        fog[i] = 1;
        const c = tileColor(tx, ty);
        if (c) { g.fillStyle = c; g.fillRect(tx * px, ty * px, px, px); }
      }
    }
  }

  const mm = {
    get active() { return !!canvas; },
    get canvas() { return canvas; },
    get fog() { return fog; },
    rebuild(level) {
      map = null; canvas = null; g = null; fog = null;
      if (!level?.map || (level.kind !== 'dungeon' && level.kind !== 'tower')) return;
      map = level.map;
      px = map.w <= 120 && map.h <= 120 ? 2 : 1;
      fog = new Uint8Array(map.w * map.h);
      canvas = document.createElement('canvas');
      canvas.width = map.w * px;
      canvas.height = map.h * px;
      g = canvas.getContext('2d');
      timer = 0;
      reveal();
    },
    clear() { map = null; canvas = null; g = null; fog = null; },
    update(dt) {
      if (!canvas || game.level?.map !== map) return;
      timer -= dt;
      if (timer <= 0) { timer = 0.12; reveal(); }
    },
    /** Window size for layout (before drawing). */
    size(narrow) {
      if (!canvas) return { w: 0, h: 0 };
      return { w: Math.min(canvas.width, narrow ? 54 : 64), h: Math.min(canvas.height, narrow ? 40 : 44) };
    },
    /** Draw with the window's top-left at (x, y). */
    render(ctx, x, y, narrow) {
      if (!canvas || game.level?.map !== map || !game.player) return;
      const { w, h } = mm.size(narrow);
      const p = game.player;
      const pcx = (p.x / TILE_SIZE) * px, pcy = (p.y / TILE_SIZE) * px;
      const sx = Math.round(Math.max(0, Math.min(canvas.width - w, pcx - w / 2)));
      const sy = Math.round(Math.max(0, Math.min(canvas.height - h, pcy - h / 2)));
      x = Math.round(x); y = Math.round(y);
      plate(ctx, x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = 'rgba(5,3,12,0.55)';
      ctx.fillRect(x, y, w, h);
      ctx.drawImage(canvas, sx, sy, w, h, x, y, w, h);
      const t = game.realTime;
      const d = Math.max(1, px);
      for (const e of game.entities.list) {
        if (e.dead || e === p) continue;
        const isEnemy = e.team === 'enemy' && e.hp > 0;
        const isDoor = e.tags.has('door') || (e.interactable && e.tags.has('station'));
        if (!isEnemy && !isDoor) continue;
        const tx = Math.floor(e.x / TILE_SIZE), ty = Math.floor(e.y / TILE_SIZE);
        if (!map.inBounds(tx, ty) || !fog[ty * map.w + tx]) continue;
        const ex = Math.floor((e.x / TILE_SIZE) * px) - sx, ey = Math.floor((e.y / TILE_SIZE) * px) - sy;
        if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue;
        if (isDoor) {
          ctx.fillStyle = Math.sin(t * 3) > -0.3 ? '#ffd25a' : '#b07a20';
          ctx.fillRect(x + ex - 1, y + ey - 1, d + 1, d + 1);
        } else {
          ctx.fillStyle = e.tags.has('boss') ? '#ff3a8a' : '#ff4a5a';
          ctx.fillRect(x + ex, y + ey, d, d);
        }
      }
      const blink = Math.sin(t * 8) > -0.4;
      const ppx = x + Math.floor(pcx) - sx, ppy = y + Math.floor(pcy) - sy;
      ctx.fillStyle = '#140c1c';
      ctx.fillRect(ppx - 1, ppy - 1, d + 2, d + 2);
      ctx.fillStyle = blink ? '#ffffff' : '#7aff9a';
      ctx.fillRect(ppx, ppy, d, d);
    },
  };
  return mm;
}
