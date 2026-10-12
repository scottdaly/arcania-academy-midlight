// Software additive layer (team: art+fx). Stands in for a CanvasRenderingContext2D in 'lighter'
// mode for the particle system's additive pass: fillRect / unscaled drawImage at integer positions
// are summed in JS into a screen-sized RGBA buffer, then the touched rectangle is uploaded and
// composited with ONE 'lighter' blit. Additive blending is order independent, so the result
// matches drawing every particle with globalCompositeOperation = 'lighter' (one rounding instead of
// one per draw), while costing a few array adds per pixel instead of a canvas raster op per
// particle (that per-op cost dominated frame time on phones / software rasterisers).
//
// Only the subset the particle renderer uses is implemented: fillStyle, globalAlpha,
// fillRect(x, y, w, h) and drawImage(img, x, y).

const colorCache = new Map();
let probe = null;
/** CSS colour -> [r, g, b, a] (0..255, a 0..1), via the canvas parser so any CSS colour works. */
function parseColor(c) {
  let v = colorCache.get(c);
  if (v) return v;
  probe ||= document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000';
  probe.fillStyle = c;
  const s = probe.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
  if (s[0] === '#') {
    const n = parseInt(s.slice(1, 7), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  } else {
    const m = s.match(/[\d.]+/g) || [];
    v = [+m[0] || 0, +m[1] || 0, +m[2] || 0, m[3] != null ? +m[3] : 1];
  }
  colorCache.set(c, v);
  return v;
}

const spriteCache = new WeakMap();
/** Premultiplied RGB (0..255) of a small cached sprite canvas, read back once. */
function spriteData(img) {
  let d = spriteCache.get(img);
  if (d) return d;
  const w = img.width, h = img.height;
  const src = img.getContext('2d').getImageData(0, 0, w, h).data;
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = src[j + 3] / 255;
    rgb[i * 3] = src[j] * a; rgb[i * 3 + 1] = src[j + 1] * a; rgb[i * 3 + 2] = src[j + 2] * a;
  }
  d = { w, h, rgb };
  spriteCache.set(img, d);
  return d;
}

export class AdditiveLayer {
  constructor() {
    this.w = 0; this.h = 0;
    this.canvas = null; this.cctx = null; this.img = null; this.px = null; this.u32 = null;
    this.ox = 0; this.oy = 0; // world -> buffer offset (buffer = world + o)
    this.globalAlpha = 1;
    this._rgba = null;
    // dirty rectangle of this frame (inclusive-exclusive)
    this.x0 = 0; this.y0 = 0; this.x1 = 0; this.y1 = 0;
  }

  set fillStyle(c) { this._rgba = parseColor(c); }

  /** Start a frame: w x h screen buffer, ox/oy = translation from world to screen px. */
  begin(w, h, ox, oy) {
    if (w !== this.w || h !== this.h) {
      this.w = w; this.h = h;
      this.canvas = document.createElement('canvas');
      this.canvas.width = w; this.canvas.height = h;
      this.cctx = this.canvas.getContext('2d');
      this.img = this.cctx.createImageData(w, h);
      this.px = this.img.data;
      this.u32 = new Uint32Array(this.px.buffer);
      this.u32.fill(0xff000000); // opaque black adds nothing under 'lighter'
    }
    this.ox = ox; this.oy = oy;
    this.globalAlpha = 1;
    this.x0 = w; this.y0 = h; this.x1 = 0; this.y1 = 0;
  }

  _mark(x0, y0, x1, y1) {
    if (x0 < this.x0) this.x0 = x0;
    if (y0 < this.y0) this.y0 = y0;
    if (x1 > this.x1) this.x1 = x1;
    if (y1 > this.y1) this.y1 = y1;
  }

  fillRect(x, y, w, h) {
    const c = this._rgba;
    const k = this.globalAlpha * c[3];
    if (!(k > 0)) return;
    // integer coords only: a fractional typed-array index would silently write nothing
    let X0 = (x + this.ox) | 0, Y0 = (y + this.oy) | 0, X1 = X0 + (w | 0), Y1 = Y0 + (h | 0);
    if (X0 < 0) X0 = 0;
    if (Y0 < 0) Y0 = 0;
    if (X1 > this.w) X1 = this.w;
    if (Y1 > this.h) Y1 = this.h;
    if (X0 >= X1 || Y0 >= Y1) return;
    const r = c[0] * k, g = c[1] * k, b = c[2] * k;
    const px = this.px, W = this.w;
    for (let yy = Y0; yy < Y1; yy++) {
      for (let j = (yy * W + X0) * 4, e = (yy * W + X1) * 4; j < e; j += 4) {
        px[j] += r; px[j + 1] += g; px[j + 2] += b;
      }
    }
    this._mark(X0, Y0, X1, Y1);
  }

  drawImage(img, x, y) {
    const k = this.globalAlpha;
    if (!(k > 0)) return;
    const d = spriteData(img);
    const bx = (x + this.ox) | 0, by = (y + this.oy) | 0;
    const X0 = Math.max(0, bx), Y0 = Math.max(0, by);
    const X1 = Math.min(this.w, bx + d.w), Y1 = Math.min(this.h, by + d.h);
    if (X0 >= X1 || Y0 >= Y1) return;
    const px = this.px, W = this.w, rgb = d.rgb, sw = d.w;
    for (let yy = Y0; yy < Y1; yy++) {
      let s = ((yy - by) * sw + (X0 - bx)) * 3;
      for (let j = (yy * W + X0) * 4, e = (yy * W + X1) * 4; j < e; j += 4, s += 3) {
        const r = rgb[s];
        const g = rgb[s + 1];
        const b = rgb[s + 2];
        if (r + g + b === 0) continue;
        px[j] += r * k; px[j + 1] += g * k; px[j + 2] += b * k;
      }
    }
    this._mark(X0, Y0, X1, Y1);
  }

  /** Composite this frame's sum onto ctx ('lighter') and reset the touched area. ctx is in world space. */
  flush(ctx) {
    const { x0, y0, x1, y1 } = this;
    if (x0 >= x1 || y0 >= y1) return;
    const w = x1 - x0, h = y1 - y0;
    this.cctx.putImageData(this.img, 0, 0, x0, y0, w, h);
    const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.canvas, x0, y0, w, h, x0 - this.ox, y0 - this.oy, w, h);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = ga;
    const u32 = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++) u32.fill(0xff000000, yy * W + x0, yy * W + x1);
  }
}
