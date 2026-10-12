// TileMap: the level grid. Two layers of tile ids (ground + deco) plus a per-cell visual
// variant byte (0..255) that art uses to pick tile variations deterministically.
// Coordinates: (tx, ty) tile coords; world px = tile * TILE_SIZE. Out-of-bounds is solid.
import { TILE_SIZE } from './config.js';
import { TILE, TILE_DEFS } from './tiles.js';

export class TileMap {
  constructor(w, h, fillGround = TILE.EMPTY) {
    this.w = w | 0;
    this.h = h | 0;
    this.tileSize = TILE_SIZE;
    this.ground = new Uint8Array(this.w * this.h).fill(fillGround);
    this.deco = new Uint8Array(this.w * this.h);
    this.variant = new Uint8Array(this.w * this.h);
    /** Incremented on every edit; renderers use it to invalidate caches. */
    this.version = 0;
    /** Set of chunk keys "cx,cy" (16x16-tile chunks) edited since the renderer last looked. */
    this.dirty = new Set();
    /** Free-form metadata for the world team (rooms, regions...). */
    this.meta = {};
  }

  get widthPx() { return this.w * TILE_SIZE; }
  get heightPx() { return this.h * TILE_SIZE; }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }
  idx(tx, ty) {
    return ty * this.w + tx;
  }

  getGround(tx, ty) {
    return this.inBounds(tx, ty) ? this.ground[ty * this.w + tx] : TILE.EMPTY;
  }
  getDeco(tx, ty) {
    return this.inBounds(tx, ty) ? this.deco[ty * this.w + tx] : TILE.EMPTY;
  }
  setGround(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return;
    this.ground[ty * this.w + tx] = id;
    this._touch(tx, ty);
  }
  setDeco(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return;
    this.deco[ty * this.w + tx] = id;
    this._touch(tx, ty);
  }
  setVariant(tx, ty, v) {
    if (!this.inBounds(tx, ty)) return;
    this.variant[ty * this.w + tx] = v;
    this._touch(tx, ty);
  }
  _touch(tx, ty) {
    this.version++;
    this.dirty.add(`${tx >> 4},${ty >> 4}`);
  }

  /** Fill a rectangle of tiles on a layer ('ground' | 'deco'). */
  fillRect(layer, tx, ty, w, h, id) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (layer === 'deco') this.setDeco(x, y, id); else this.setGround(x, y, id);
    }
  }

  /** mask: 'walk' (default) -> TILE_DEFS.solid ; 'shot' -> TILE_DEFS.blocksShot */
  isSolid(tx, ty, mask = 'walk') {
    if (!this.inBounds(tx, ty)) return true;
    const i = ty * this.w + tx;
    const key = mask === 'shot' ? 'blocksShot' : 'solid';
    const g = TILE_DEFS[this.ground[i]];
    if (g[key]) return true;
    const d = this.deco[i];
    return d !== 0 && TILE_DEFS[d][key];
  }

  isSolidAt(px, py, mask = 'walk') {
    return this.isSolid(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE), mask);
  }

  /** Tile defs at a world position: {ground, deco} (deco may be TILE_DEFS[0] = empty). */
  defsAt(px, py) {
    const tx = Math.floor(px / TILE_SIZE), ty = Math.floor(py / TILE_SIZE);
    return { ground: TILE_DEFS[this.getGround(tx, ty)], deco: TILE_DEFS[this.getDeco(tx, ty)] };
  }

  static toTile(px) {
    return Math.floor(px / TILE_SIZE);
  }
  /** World-pixel centre of a tile. */
  static tileCenter(tx, ty) {
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
  }

  /** Fill variant bytes from a seeded RNG (call once after generation). */
  randomizeVariants(rng) {
    for (let i = 0; i < this.variant.length; i++) this.variant[i] = (rng.next() * 256) | 0;
    this.version++;
    this.dirty.add('*');
  }

  /** Iterate all cells: fn(tx, ty, groundId, decoId). */
  forEach(fn) {
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      const i = ty * this.w + tx;
      fn(tx, ty, this.ground[i], this.deco[i]);
    }
  }

  /** All tile coords whose layer has `id`. */
  findTiles(id, layer = 'ground') {
    const arr = layer === 'deco' ? this.deco : this.ground;
    const out = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] === id) out.push({ tx: i % this.w, ty: (i / this.w) | 0 });
    return out;
  }

  /**
   * Build a map from ASCII rows. legend: { char: { ground: id, deco?: id, marker?: string } }.
   * Rows shorter than the longest row are padded with EMPTY. Returns { map, markers } where
   * markers[name] = [{tx, ty, x, y}] (x,y = tile centre in world px).
   */
  static fromStrings(rows, legend) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const map = new TileMap(w, h, TILE.EMPTY);
    const markers = {};
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const ch = rows[ty][tx] ?? ' ';
        const def = legend[ch];
        if (!def) continue;
        const i = ty * w + tx;
        map.ground[i] = def.ground ?? TILE.EMPTY;
        map.deco[i] = def.deco ?? 0;
        if (def.marker) (markers[def.marker] ||= []).push({ tx, ty, ...TileMap.tileCenter(tx, ty) });
      }
    }
    map.version++;
    map.dirty.add('*');
    return { map, markers };
  }
}
