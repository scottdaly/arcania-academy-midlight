// Sprite-sheet assembly (team: art+fx).
// Frames are painted one by one into small canvases (base + optional emissive "glow" layer),
// outlined, then packed into one horizontal strip. The emissive strip is drawn additively by fx
// after the lighting pass, so eyes/runes/gems glow in dark dungeons.
import { makeCanvas, outline, hash2 } from './pixel.js';
import { INK } from './palette.js';

/**
 * Create one frame. draw(c, g) paints the base into `c` and emissive pixels into `g`
 * (emissive pixels should usually be painted into both).
 */
export function frame(fw, fh, draw, { outlineColor = INK, doOutline = true } = {}) {
  const { canvas: base, ctx: c } = makeCanvas(fw, fh);
  const { canvas: glow, ctx: g } = makeCanvas(fw, fh);
  draw(c, g);
  if (doOutline) outline(base, outlineColor);
  return { base, glow };
}

/** Pack frames into a SpriteSheet. frames: [{base, glow}] */
export function assemble(frames, anims, ax, ay, extra = {}) {
  const fw = frames[0].base.width, fh = frames[0].base.height;
  const { canvas, ctx } = makeCanvas(fw * frames.length, fh);
  const { canvas: gcan, ctx: gctx } = makeCanvas(fw * frames.length, fh);
  frames.forEach((f, i) => {
    ctx.drawImage(f.base, i * fw, 0);
    if (f.glow) gctx.drawImage(f.glow, i * fw, 0);
  });
  // keep the glow strip only if something was painted into it
  let hasGlow = false;
  const d = gctx.getImageData(0, 0, gcan.width, gcan.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { hasGlow = true; break; }
  return {
    canvas, fw, fh, ax: Math.round(ax), ay: Math.round(ay), anims,
    flashCanvas: null, glowCanvas: hasGlow ? gcan : null, ...extra,
  };
}

/**
 * Build "dissolve" death frames from a source frame: pixels drop out in a seeded order while the
 * remainder brightens towards `tint` and drifts upward. Returns `n` frames.
 */
export function dissolveFrames(src, n = 5, tint = [200, 160, 255], seed = 7) {
  const fw = src.base.width, fh = src.base.height;
  const sctx = src.base.getContext('2d');
  const sd = sctx.getImageData(0, 0, fw, fh).data;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1);
    const { canvas, ctx } = makeCanvas(fw, fh);
    const { canvas: glow, ctx: gctx } = makeCanvas(fw, fh);
    const img = ctx.createImageData(fw, fh);
    const gimg = gctx.createImageData(fw, fh);
    const d = img.data, gd = gimg.data;
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const i = (y * fw + x) * 4;
      if (sd[i + 3] < 10) continue;
      // dissolve from the top down plus noise
      const r = hash2(x, y, seed) * 0.7 + (1 - y / fh) * 0.3;
      if (r < t) continue;
      const edge = r < t + 0.12;
      const lift = Math.round(t * 3 * hash2(x, 0, seed + 3));
      const ty = y - lift;
      if (ty < 0) continue;
      const j = (ty * fw + x) * 4;
      if (edge) {
        d[j] = tint[0]; d[j + 1] = tint[1]; d[j + 2] = tint[2]; d[j + 3] = 255;
        gd[j] = tint[0]; gd[j + 1] = tint[1]; gd[j + 2] = tint[2]; gd[j + 3] = 200;
      } else {
        const m = t * 0.6;
        d[j] = sd[i] + (tint[0] - sd[i]) * m; d[j + 1] = sd[i + 1] + (tint[1] - sd[i + 1]) * m;
        d[j + 2] = sd[i + 2] + (tint[2] - sd[i + 2]) * m; d[j + 3] = sd[i + 3] * (1 - t * 0.5);
      }
    }
    ctx.putImageData(img, 0, 0);
    gctx.putImageData(gimg, 0, 0);
    out.push({ base: canvas, glow });
  }
  return out;
}

/** Red-tinted copy of a frame (hurt pose). */
export function tinted(src, color = 'rgba(255,70,80,0.45)') {
  const fw = src.base.width, fh = src.base.height;
  const { canvas, ctx } = makeCanvas(fw, fh);
  ctx.drawImage(src.base, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, fw, fh);
  return { base: canvas, glow: src.glow };
}

/** Shifted copy of a frame (dx, dy). */
export function shifted(src, dx, dy) {
  const fw = src.base.width, fh = src.base.height;
  const a = makeCanvas(fw, fh), b = makeCanvas(fw, fh);
  a.ctx.drawImage(src.base, dx, dy);
  if (src.glow) b.ctx.drawImage(src.glow, dx, dy);
  return { base: a.canvas, glow: b.canvas };
}
