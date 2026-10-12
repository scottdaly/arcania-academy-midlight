// Pooled particle system (team: art+fx). Structure-of-arrays typed buffers, zero allocations per
// particle, swap-remove on death, hard cap. Colours are interned to small ints.
import { glowSprite, smokeSprite, runeSprite, RUNE_COUNT } from './sprites.js';

export const SH = { PX: 0, GLOW: 1, SPARK: 2, SHARD: 3, SMOKE: 4, RUNE: 5, STAR: 6, CHUNK: 7, MOTE: 8 };
export const F = { ADD: 1, FLICKER: 2, FADEIN: 4, GROW: 8, SHRINK: 16, BOUNCE: 32, WOBBLE: 64, TWINKLE: 128 };

const colors = [];
const colorIdx = new Map();
export function cid(c) {
  let i = colorIdx.get(c);
  if (i === undefined) {
    i = colors.length;
    colors.push(c);
    colorIdx.set(c, i);
  }
  return i;
}

export class Particles {
  constructor(max) {
    this.max = max;
    this.cap = max;
    this.n = 0;
    const f = () => new Float32Array(max);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f();
    this.life = f(); this.maxLife = f(); this.size = f();
    this.drag = f(); this.grav = f(); this.swirl = f(); this.gy = f(); this.seed = f();
    this.c1 = new Uint16Array(max); this.c2 = new Uint16Array(max);
    this.shape = new Uint8Array(max); this.flags = new Uint8Array(max);
  }

  /** Spawn one particle. Returns false when the (adaptive) cap is reached. */
  spawn(x, y, vx, vy, life, size, c1, c2, shape, drag, grav, flags, swirl = 0) {
    if (this.n >= this.cap) return false;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.c1[i] = typeof c1 === 'number' ? c1 : cid(c1);
    this.c2[i] = typeof c2 === 'number' ? c2 : cid(c2);
    this.shape[i] = shape; this.drag[i] = drag; this.grav[i] = grav; this.flags[i] = flags;
    this.swirl[i] = swirl; this.gy[i] = y + 4 + Math.random() * 6; this.seed[i] = Math.random() * 100;
    return true;
  }

  clear() { this.n = 0; }

  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      this.life[i] = l;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      let vx = this.vx[i] * k, vy = this.vy[i] * k + this.grav[i] * dt;
      const sw = this.swirl[i];
      if (sw !== 0) { const a = sw * dt; const c = Math.cos(a), s = Math.sin(a); const nx = vx * c - vy * s; vy = vx * s + vy * c; vx = nx; }
      const fl = this.flags[i];
      if (fl & 64) { vx += (Math.random() - 0.5) * 120 * dt; vy += (Math.random() - 0.5) * 120 * dt; }
      let y = this.y[i] + vy * dt;
      if ((fl & 32) && y > this.gy[i] && vy > 0) { y = this.gy[i]; vy = -vy * 0.35; vx *= 0.6; if (Math.abs(vy) < 8) { vy = 0; this.grav[i] = 0; } }
      this.vx[i] = vx; this.vy[i] = vy;
      this.x[i] += vx * dt; this.y[i] = y;
    }
    this.n = n;
  }

  _move(from, to) {
    this.x[to] = this.x[from]; this.y[to] = this.y[from]; this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from]; this.size[to] = this.size[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from]; this.swirl[to] = this.swirl[from];
    this.gy[to] = this.gy[from]; this.seed[to] = this.seed[from];
    this.c1[to] = this.c1[from]; this.c2[to] = this.c2[from]; this.shape[to] = this.shape[from]; this.flags[to] = this.flags[from];
  }

  /** Draw all particles (world space). Two passes: normal blend, then additive. */
  render(ctx, left, top, right, bottom, time) {
    if (!this.n) return;
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalCompositeOperation = pass ? 'lighter' : 'source-over';
      for (let i = 0; i < this.n; i++) {
        const fl = this.flags[i];
        if (((fl & 1) ? 1 : 0) !== pass) continue;
        const x = this.x[i], y = this.y[i];
        if (x < left - 12 || y < top - 12 || x > right + 12 || y > bottom + 12) continue;
        const t = this.life[i] / this.maxLife[i]; // 1 -> 0
        let a = t < 0.35 ? t / 0.35 : 1;
        if ((fl & 4) && t > 0.8) a *= (1 - t) / 0.2;
        if (fl & 2) a *= 0.55 + 0.45 * Math.random();
        if (fl & 128) a *= 0.5 + 0.5 * Math.sin(time * 14 + this.seed[i]);
        if (a <= 0.02) continue;
        let s = this.size[i];
        if (fl & 8) s *= 1 + (1 - t) * 1.6;
        else if (fl & 16) s = Math.max(1, s * (0.35 + t * 0.65));
        const col = colors[t > 0.5 ? this.c1[i] : this.c2[i]];
        ctx.globalAlpha = a;
        const X = Math.round(x), Y = Math.round(y);
        switch (this.shape[i]) {
          case 0: { // PX
            const si = Math.max(1, Math.round(s));
            ctx.fillStyle = col;
            ctx.fillRect(X - (si >> 1), Y - (si >> 1), si, si);
            break;
          }
          case 1: { // GLOW: soft halo + bright core
            const r = Math.max(1, Math.round(s * 1.6));
            const g = glowSprite(col, r);
            ctx.globalAlpha = a * 0.75;
            ctx.drawImage(g, X - r, Y - r);
            ctx.globalAlpha = a;
            ctx.fillStyle = t > 0.6 ? colors[this.c1[i]] : col;
            const cs = s >= 2.5 ? 2 : 1;
            ctx.fillRect(X - (cs >> 1), Y - (cs >> 1), cs, cs);
            break;
          }
          case 2: { // SPARK: streak along velocity
            const vx = this.vx[i], vy = this.vy[i];
            const sp = Math.hypot(vx, vy);
            const len = Math.min(7, Math.max(1, sp * 0.03 * s));
            const ux = sp > 0 ? vx / sp : 0, uy = sp > 0 ? vy / sp : 0;
            ctx.fillStyle = colors[this.c2[i]];
            for (let k = 1; k <= len; k++) ctx.fillRect(Math.round(x - ux * k), Math.round(y - uy * k), 1, 1);
            ctx.fillStyle = colors[this.c1[i]];
            ctx.fillRect(X, Y, 1, 1);
            break;
          }
          case 3: { // SHARD: little diamond pointing along velocity
            const vx = this.vx[i], vy = this.vy[i];
            const sp = Math.hypot(vx, vy) || 1;
            const ux = vx / sp, uy = vy / sp;
            ctx.fillStyle = colors[this.c2[i]];
            ctx.fillRect(Math.round(x - ux * 2), Math.round(y - uy * 2), 1, 1);
            ctx.fillRect(Math.round(x - ux), Math.round(y - uy), 1, 1);
            if (s > 1) ctx.fillRect(Math.round(x - ux - uy), Math.round(y - uy + ux), 1, 1);
            ctx.fillStyle = colors[this.c1[i]];
            ctx.fillRect(X, Y, 1, 1);
            break;
          }
          case 4: { // SMOKE puff
            const r = Math.max(1, Math.round(s));
            ctx.globalAlpha = a * 0.55;
            ctx.drawImage(smokeSprite(col, r), X - r, Y - r);
            break;
          }
          case 5: { // RUNE glyph
            ctx.drawImage(runeSprite(Math.floor(this.seed[i]) % RUNE_COUNT, colors[this.c1[i]]), X - 3, Y - 3);
            break;
          }
          case 6: { // STAR twinkle
            const arm = Math.max(0, Math.round(s * (0.4 + 0.6 * Math.abs(Math.sin(time * 9 + this.seed[i])))));
            ctx.fillStyle = col;
            if (arm > 0) { ctx.fillRect(X - arm, Y, arm * 2 + 1, 1); ctx.fillRect(X, Y - arm, 1, arm * 2 + 1); }
            ctx.fillStyle = colors[this.c1[i]];
            ctx.fillRect(X, Y, 1, 1);
            break;
          }
          case 7: { // CHUNK (rock / debris)
            const si = Math.max(1, Math.round(s));
            ctx.fillStyle = colors[this.c1[i]];
            ctx.fillRect(X, Y, si, si);
            ctx.fillStyle = colors[this.c2[i]];
            ctx.fillRect(X, Y + si - 1, si, 1);
            break;
          }
          case 8: { // MOTE: tiny glow, cheaper than GLOW
            ctx.globalAlpha = a * 0.35;
            ctx.fillStyle = col;
            ctx.fillRect(X - 1, Y - 1, 3, 3);
            ctx.globalAlpha = a;
            ctx.fillRect(X, Y, 1, 1);
            break;
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
