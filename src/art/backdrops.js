// Full-screen menu backdrops (team: art+fx): 'title' | 'gameover' | 'victory'.
// The static layers (sky gradient, mountains, the Academy and the Mage Tower) are rendered once
// per (name, size) into a cached canvas; only stars, aurora, the tower beacon and motes animate.
import { makeCanvas, hash2, mix, rgba } from './pixel.js';

const SCHEMES = {
  title: {
    sky: ['#05030f', '#120a2e', '#2a1452', '#4a1e6a'], far: '#1a1238', mid: '#110b26', near: '#07050f',
    moon: '#f4ecd0', moonGlow: '#b8a0ff', window: '#ffd27a', beacon: '#c08aff', aurora: ['#3affc0', '#7a5aff'],
  },
  gameover: {
    sky: ['#050106', '#1a0410', '#3a0818', '#5a1020'], far: '#2a0812', mid: '#18050c', near: '#060205',
    moon: '#ff6a5a', moonGlow: '#ff2a4a', window: '#7aff5a', beacon: '#7aff5a', aurora: ['#7aff5a', '#a02aa8'],
  },
  victory: {
    sky: ['#1a1440', '#5a2a7a', '#d0587a', '#ffb060'], far: '#4a2a6a', mid: '#2e1a4a', near: '#140c24',
    moon: '#fff4c0', moonGlow: '#ffd25a', window: '#ffe9a0', beacon: '#ffd25a', aurora: ['#ffd25a', '#ff8ab8'],
  },
};

const cache = new Map();

function ridge(c, w, h, base, amp, freq, seed, color) {
  c.fillStyle = color;
  for (let x = 0; x < w; x++) {
    const y = base + Math.sin(x * freq + seed) * amp * 0.6 + Math.sin(x * freq * 2.7 + seed * 3) * amp * 0.3 + (hash2(x >> 2, 0, seed) - 0.5) * amp * 0.2;
    c.fillRect(x, Math.round(y), 1, h - Math.round(y));
  }
}

function staticLayer(name, w, h) {
  const key = `${name}:${w}x${h}`;
  let can = cache.get(key);
  if (can) return can;
  const S = SCHEMES[name] || SCHEMES.title;
  const { canvas, ctx: c } = makeCanvas(w, h);
  // banded sky (dithered between bands for a pixel-art gradient)
  const bands = 24;
  for (let y = 0; y < h; y++) {
    const t = (y / h) * (S.sky.length - 1);
    const i = Math.min(S.sky.length - 2, Math.floor(t));
    const f = t - i;
    const q = Math.floor(f * bands) / bands;
    const q2 = Math.min(1, q + 1 / bands);
    for (let x = 0; x < w; x += 1) {
      const use = ((x + y) & 1) && hash2(x, y, 3) < (f * bands - Math.floor(f * bands)) ? q2 : q;
      c.fillStyle = mix(S.sky[i], S.sky[i + 1], use);
      c.fillRect(x, y, 1, 1);
    }
  }
  // moon / sun with halo
  const mx = Math.round(w * (name === 'victory' ? 0.72 : 0.22)), my = Math.round(h * (name === 'victory' ? 0.58 : 0.2));
  const mr = Math.round(Math.min(w, h) * (name === 'victory' ? 0.12 : 0.07));
  for (let r = mr * 4; r > mr; r -= 2) {
    c.fillStyle = rgba(S.moonGlow, 0.035);
    c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = S.moon;
  for (let y = -mr; y <= mr; y++) { const ww = Math.round(Math.sqrt(mr * mr - y * y)); c.fillRect(mx - ww, my + y, ww * 2 + 1, 1); }
  if (name !== 'victory') {
    // craters
    c.fillStyle = mix(S.moon, '#000000', 0.15);
    for (let i = 0; i < 5; i++) { const a = hash2(i, 1, 9) * 6.28, d = hash2(i, 2, 9) * mr * 0.7; const r = 1 + Math.floor(hash2(i, 3, 9) * mr * 0.25); c.fillRect(Math.round(mx + Math.cos(a) * d), Math.round(my + Math.sin(a) * d), r, r); }
    if (name === 'gameover') {
      // a jagged, branching crack (not a straight seam)
      c.fillStyle = '#1a0408';
      let x = mx + Math.round(mr * 0.15);
      for (let y = my - mr + 2; y <= my + mr - 3; y++) {
        x += Math.round((hash2(y, 4, 9) - 0.5) * 2.6);
        x = Math.max(mx - mr + 3, Math.min(mx + mr - 3, x));
        c.fillRect(x, y, 1, 1);
        if (y === my - 2 || y === my + Math.round(mr * 0.4)) {
          const dir = y < my ? -1 : 1;
          for (let k = 1; k < Math.round(mr * 0.45); k++) c.fillRect(x + dir * k, y + Math.round(k * 0.6), 1, 1);
        }
      }
    }
  }
  // mountain layers
  ridge(c, w, h, h * 0.62, h * 0.12, 0.012, 1, S.far);
  ridge(c, w, h, h * 0.72, h * 0.08, 0.02, 4, S.mid);

  // the Academy: a castle silhouette with lit windows (left/centre)
  const gx = Math.round(w * 0.38), gy = Math.round(h * 0.78);
  c.fillStyle = S.near;
  const towers = [[-60, 26, 9], [-42, 40, 11], [-20, 30, 14], [0, 52, 12], [20, 34, 14], [42, 44, 10], [60, 24, 9]];
  c.fillRect(gx - 70, gy - 22, 140, h);
  for (const [dx, th, tw] of towers) {
    c.fillRect(gx + dx - tw / 2, gy - th, tw, th + 2);
    for (let k = 0; k <= tw / 2 + 1; k++) c.fillRect(gx + dx - tw / 2 - 1 + k, Math.round(gy - th - k * 1.7), tw + 2 - k * 2, 2);
  }
  // lit windows
  for (const [dx, th, tw] of towers) {
    for (let k = 0; k < 4; k++) {
      if (hash2(dx, k, 7) < 0.35) continue;
      const wx = gx + dx - 1, wy = gy - th + 5 + k * 7;
      if (wy > gy - 2) continue;
      c.fillStyle = rgba(S.window, 0.25); c.fillRect(wx - 1, wy - 1, 4, 5);
      c.fillStyle = S.window; c.fillRect(wx, wy, 2, 3);
    }
  }
  for (let k = 0; k < 18; k++) {
    if (hash2(k, 9, 7) < 0.4) continue;
    const wx = gx - 64 + k * 7, wy = gy - 14 + (k & 1) * 6;
    c.fillStyle = S.window; c.fillRect(wx, wy, 1, 2);
  }

  // the Mage Tower (right): tall, tapering, with a crown
  const tx = Math.round(w * 0.78), ty = Math.round(h * 0.12);
  c.fillStyle = S.near;
  for (let y = ty; y < h; y++) {
    const t = (y - ty) / (h - ty);
    const half = Math.round(5 + t * 12);
    c.fillRect(tx - half, y, half * 2, 1);
  }
  for (let k = -3; k <= 3; k++) c.fillRect(tx + k * 3, ty - 6 - (k & 1) * 3, 2, 8);
  c.fillRect(tx - 9, ty - 2, 18, 3);
  for (let k = 0; k < 7; k++) {
    const wy = ty + 14 + k * Math.round((h - ty) / 9);
    c.fillStyle = S.beacon; c.fillRect(tx - 1, wy, 2, 3);
    c.fillStyle = rgba(S.beacon, 0.2); c.fillRect(tx - 2, wy - 1, 4, 5);
  }
  // near ground with trees
  ridge(c, w, h, h * 0.88, h * 0.03, 0.05, 8, S.near);
  for (let i = 0; i < w; i += 6) {
    const th = 6 + Math.floor(hash2(i, 0, 11) * 10);
    const base = h * 0.88 + Math.sin(i * 0.05 + 8) * h * 0.018;
    c.fillStyle = S.near;
    for (let k = 0; k < th; k++) c.fillRect(i + 3 - Math.floor(k / 2.5), Math.round(base - th + k), Math.floor(k / 2.5) * 2 + 1, 1);
  }
  cache.set(key, (can = canvas));
  if (cache.size > 12) cache.delete(cache.keys().next().value);
  return can;
}

export function drawBackdropImpl(ctx, name, w, h, t) {
  const S = SCHEMES[name] || SCHEMES.title;
  w = Math.max(1, w | 0); h = Math.max(1, h | 0);
  // 1. the sky + glowing aurora behind everything static
  ctx.drawImage(staticLayer(name, w, h), 0, 0);
  // 2. twinkling stars (upper sky only; drawn over the gradient but stars are sparse)
  const ns = Math.round((w * h) / 900);
  for (let i = 0; i < ns; i++) {
    const sx = Math.floor(hash2(i, 1, 77) * w), sy = Math.floor(hash2(i, 2, 77) * h * 0.55);
    const tw = 0.5 + 0.5 * Math.sin(t * (1 + hash2(i, 3, 77) * 3) + i);
    const big = hash2(i, 4, 77) < 0.08;
    ctx.fillStyle = rgba(name === 'gameover' ? '#ffb0b0' : '#ffffff', (name === 'victory' ? 0.15 : 0.25) + tw * 0.6);
    ctx.fillRect(sx, sy, 1, 1);
    if (big && tw > 0.7) { ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3); }
  }
  // 3. aurora ribbons (additive)
  ctx.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 2; b++) {
    const col = S.aurora[b];
    for (let x = 0; x < w; x += 2) {
      const y = h * (0.16 + b * 0.08) + Math.sin(x * 0.012 + t * 0.35 + b * 2) * h * 0.06 + Math.sin(x * 0.031 - t * 0.5) * h * 0.02;
      const len = h * (0.1 + 0.05 * Math.sin(x * 0.02 + t + b));
      const a = 0.05 + 0.04 * Math.sin(x * 0.05 + t * 1.3 + b);
      ctx.fillStyle = rgba(col, Math.max(0, a));
      ctx.fillRect(x, Math.round(y), 2, Math.round(len));
      ctx.fillStyle = rgba(col, Math.max(0, a * 1.6));
      ctx.fillRect(x, Math.round(y), 2, 1);
    }
  }
  // 4. tower beacon pulse
  const tx = Math.round(w * 0.78), ty = Math.round(h * 0.12) - 10;
  const p = 0.6 + 0.4 * Math.sin(t * 2.2);
  for (let r = 14; r > 0; r -= 3) {
    ctx.fillStyle = rgba(S.beacon, 0.06 * p);
    ctx.beginPath(); ctx.arc(tx, ty, r * (1 + p * 0.3), 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = S.beacon; ctx.fillRect(tx - 1, ty - 1, 3, 3);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(tx, ty, 1, 1);
  if (name === 'victory') {
    // rotating sun rays
    const sx = Math.round(w * 0.72), sy = Math.round(h * 0.58);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + t * 0.08;
      ctx.fillStyle = rgba('#ffd25a', 0.05);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a - 0.06) * w, sy + Math.sin(a - 0.06) * w);
      ctx.lineTo(sx + Math.cos(a + 0.06) * w, sy + Math.sin(a + 0.06) * w);
      ctx.fill();
    }
  }
  // 5. rising motes / falling ash
  const nm = 40;
  for (let i = 0; i < nm; i++) {
    const speed = 6 + hash2(i, 5, 88) * 14;
    const fall = name === 'gameover';
    let y = (hash2(i, 6, 88) * h + (fall ? 1 : -1) * t * speed) % h;
    if (y < 0) y += h;
    const x = (hash2(i, 7, 88) * w + Math.sin(t * 0.7 + i) * 6) % w;
    const col = name === 'gameover' ? (i % 3 ? '#ff5a3a' : '#7aff5a') : name === 'victory' ? (i % 2 ? '#ffd25a' : '#ffb8ff') : (i % 3 ? '#c08aff' : '#5ad8ff');
    const a = 0.35 + 0.35 * Math.sin(t * 3 + i);
    ctx.fillStyle = rgba(col, a * 0.35);
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    ctx.fillStyle = rgba(col, a);
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  ctx.globalCompositeOperation = 'source-over';
}
