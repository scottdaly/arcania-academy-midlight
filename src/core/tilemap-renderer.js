// Draws a TileMap using art.drawTile(), caching static tiles into 16x16-tile chunk canvases.
// Animated tiles (TILE_DEFS[id].animated) are redrawn every frame on top of the cache.
// Owned by core; art only needs to implement drawTile (see ARCHITECTURE.md §4.1).
import { TILE_SIZE } from './config.js';
import { TILE_DEFS } from './tiles.js';

const CHUNK = 16; // tiles per chunk side
const CHUNK_PX = CHUNK * TILE_SIZE;

export class TileMapRenderer {
  constructor(art) {
    this.art = art;
    this.map = null;
    this.chunks = new Map(); // key "layer:cx,cy" -> {canvas, animated: [{tx,ty,id}]}
  }

  setMap(map) {
    this.map = map;
    this.chunks.clear();
    if (map) map.dirty.clear();
  }

  /** Drop all cached chunks (e.g. after art regenerates tiles). */
  invalidate() {
    this.chunks.clear();
  }

  _syncDirty() {
    const map = this.map;
    if (!map.dirty.size) return;
    if (map.dirty.has('*')) this.chunks.clear();
    else for (const key of map.dirty) {
      this.chunks.delete('ground:' + key);
      this.chunks.delete('deco:' + key);
    }
    map.dirty.clear();
  }

  _bake(layer, cx, cy) {
    const map = this.map;
    const canvas = document.createElement('canvas');
    canvas.width = CHUNK_PX;
    canvas.height = CHUNK_PX;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const data = layer === 'deco' ? map.deco : map.ground;
    const animated = [];
    for (let y = 0; y < CHUNK; y++) {
      const ty = cy * CHUNK + y;
      if (ty >= map.h) break;
      for (let x = 0; x < CHUNK; x++) {
        const tx = cx * CHUNK + x;
        if (tx >= map.w) break;
        const i = ty * map.w + tx;
        const id = data[i];
        if (layer === 'deco' && id === 0) continue;
        if (TILE_DEFS[id].animated) { animated.push({ tx, ty, id, v: map.variant[i] }); continue; }
        try {
          this.art.drawTile(ctx, id, x * TILE_SIZE, y * TILE_SIZE, map.variant[i], 0, tx, ty, map);
        } catch (err) {
          console.error('[tiles] art.drawTile threw for id', id, err);
        }
      }
    }
    const chunk = { canvas, animated };
    this.chunks.set(`${layer}:${cx},${cy}`, chunk);
    return chunk;
  }

  /** Draw one layer. ctx must already be in world space (camera.apply). */
  renderLayer(ctx, camera, layer, time) {
    const map = this.map;
    if (!map) return;
    this._syncDirty();
    const cx0 = Math.max(0, Math.floor(camera.left / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor(camera.top / CHUNK_PX));
    const cx1 = Math.min(Math.ceil(map.w / CHUNK) - 1, Math.floor((camera.left + camera.viewW) / CHUNK_PX));
    const cy1 = Math.min(Math.ceil(map.h / CHUNK) - 1, Math.floor((camera.top + camera.viewH) / CHUNK_PX));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.chunks.get(`${layer}:${cx},${cy}`) || this._bake(layer, cx, cy);
        ctx.drawImage(chunk.canvas, cx * CHUNK_PX, cy * CHUNK_PX);
        for (const a of chunk.animated) {
          const px = a.tx * TILE_SIZE, py = a.ty * TILE_SIZE;
          if (!camera.isVisible(px + 8, py + 8, 16)) continue;
          try {
            this.art.drawTile(ctx, a.id, px, py, a.v, time, a.tx, a.ty, map);
          } catch (err) {
            console.error('[tiles] art.drawTile threw for id', a.id, err);
            a.id = 0; // stop spamming
          }
        }
      }
    }
  }
}
