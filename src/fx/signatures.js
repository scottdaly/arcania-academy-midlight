// Element particle signatures (team: art+fx).
// Each element knows how to draw itself as a trail, a cast flash, an impact burst, an expanding
// nova and a lingering aura. Combined spells call several signatures (scaled down) and add a
// combo flourish (steam, plasma, storm, magma, prismatic) on top.
import { SH, F } from './particles.js';

const R = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** Spray `n` particles in a cone. */
function cone(e, n, x, y, ang, spread, sp0, sp1, life0, life1, size, c1, c2, shape, drag, grav, flags, swirl = 0) {
  for (let i = 0; i < n; i++) {
    const a = ang + (Math.random() - 0.5) * spread;
    const sp = R(sp0, sp1);
    e.p(x, y, Math.cos(a) * sp, Math.sin(a) * sp, R(life0, life1), typeof size === 'number' ? size : R(size[0], size[1]), c1, c2, shape, drag, grav, flags, swirl);
  }
}
const radial = (e, n, x, y, ...rest) => cone(e, n, x, y, 0, TAU, ...rest);

/** Particles spawned on a circle of radius r, moving outward. */
function ringOut(e, n, x, y, r, sp0, sp1, life0, life1, size, c1, c2, shape, drag, grav, flags, swirl = 0) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random() * 0.3;
    const sp = R(sp0, sp1);
    e.p(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, Math.cos(a) * sp, Math.sin(a) * sp * 0.85, R(life0, life1), typeof size === 'number' ? size : R(size[0], size[1]), c1, c2, shape, drag, grav, flags, swirl);
  }
}

const A = F.ADD;

export const SIGS = {
  fire: {
    main: '#ff6a1f', hi: '#ffd25a', core: '#fff8d0', dark: '#8a1a08', light: '#ff8a3a', decal: 'scorch', flash: '#ff8a3a',
    trail(e, x, y, dx, dy, k) {
      cone(e, e.n(2 * k), x, y, Math.atan2(-dy, -dx), 1.4, 8, 26, 0.22, 0.45, [1, 2.4], '#ffd25a', '#ff4a10', SH.GLOW, 2.5, -40, A | F.FLICKER | F.SHRINK);
      if (Math.random() < 0.25 * k) e.p(x, y, R(-6, 6), R(-6, 2), R(0.4, 0.7), R(1.5, 2.5), '#3a2a2a', '#1a1214', SH.SMOKE, 1.5, -18, F.GROW);
    },
    cast(e, x, y, dx, dy, k) {
      const a = Math.atan2(dy, dx);
      cone(e, e.n(12 * k), x, y, a, 1.1, 30, 110, 0.18, 0.4, [1, 2.5], '#fff8d0', '#ff6a1f', SH.GLOW, 4, -30, A | F.SHRINK);
      e.p(x, y, 0, 0, 0.12, 5 * k, '#fff8d0', '#ffd25a', SH.GLOW, 0, 0, A);
      e.light(x, y, 44, '#ff8a3a', 1, 0.2);
    },
    burst(e, x, y, k) {
      radial(e, e.n(16 * k), x, y, 30, 120 * Math.sqrt(k), 0.3, 0.65, [1, 2.8], '#ffd25a', '#ff4a10', SH.GLOW, 3.5, -50, A | F.FLICKER | F.SHRINK);
      radial(e, e.n(7 * k), x, y, 90, 180, 0.12, 0.25, 1, '#fff8d0', '#ff8a2a', SH.SPARK, 5, 60, A);
      radial(e, e.n(4 * k), x, y, 5, 25, 0.5, 0.9, [2, 3.5], '#4a3434', '#1e1416', SH.SMOKE, 1.5, -22, F.GROW);
      e.p(x, y, 0, 0, 0.14, 7 * Math.sqrt(k), '#ffffff', '#ffd25a', SH.GLOW, 0, 0, A);
      e.ring(x, y, 12 * Math.sqrt(k), '#ffb040', 0.3, { width: 2 });
      e.light(x, y, 56 * Math.sqrt(k), '#ff8a3a', 1.2, 0.35);
    },
    nova(e, x, y, R0, k) {
      ringOut(e, e.n(R0 * 0.9 * k), x, y, 4, R0 * 2.2, R0 * 3.2, 0.35, 0.6, [1.5, 3], '#ffd25a', '#ff4a10', SH.GLOW, 3.2, -30, A | F.FLICKER | F.SHRINK);
      for (let i = 0, n = e.n(R0 * 0.5 * k); i < n; i++) {
        const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R0;
        e.p(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85, R(-8, 8), R(-60, -20), R(0.4, 0.9), R(1, 2.2), '#ffd25a', '#ff4a10', SH.GLOW, 1.5, -40, A | F.FLICKER | F.SHRINK);
      }
      e.ring(x, y, R0, '#ff8a2a', 0.45, { width: 3 });
      e.ring(x, y, R0 * 0.7, '#ffd25a', 0.35, { width: 2 });
      e.light(x, y, R0 * 1.8, '#ff8a3a', 1.4, 0.5);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.6 * k) e.p(x + R(-5, 5), y + R(-12, 0), R(-6, 6), R(-30, -12), R(0.3, 0.6), R(1, 2), '#ffd25a', '#ff4a10', SH.GLOW, 1.5, -30, A | F.FLICKER | F.SHRINK);
    },
  },

  ice: {
    main: '#4fc8ff', hi: '#e6fbff', core: '#ffffff', dark: '#1c4ea0', light: '#7ad8ff', decal: 'frost', flash: '#bff0ff',
    trail(e, x, y, dx, dy, k) {
      cone(e, e.n(1.6 * k), x, y, Math.atan2(-dy, -dx), 1.2, 6, 22, 0.25, 0.5, 1.5, '#ffffff', '#4fc8ff', SH.SHARD, 2, 40, A);
      if (Math.random() < 0.5 * k) e.p(x + R(-3, 3), y + R(-3, 3), R(-4, 4), R(2, 10), R(0.5, 0.9), 1, '#ffffff', '#9af0ff', SH.STAR, 1, 8, A | F.TWINKLE);
      if (Math.random() < 0.15 * k) e.p(x, y, R(-5, 5), R(-5, 5), R(0.4, 0.7), R(1.5, 2.5), '#cfefff', '#8ab8d8', SH.SMOKE, 2, -4, F.GROW);
    },
    cast(e, x, y, dx, dy, k) {
      const a = Math.atan2(dy, dx);
      cone(e, e.n(10 * k), x, y, a, 1.0, 40, 120, 0.2, 0.45, 1.5, '#ffffff', '#4fc8ff', SH.SHARD, 4, 30, A);
      cone(e, e.n(4 * k), x, y, a, 1.4, 10, 30, 0.4, 0.7, [2, 3], '#dff6ff', '#9ac8e8', SH.SMOKE, 2.5, -6, F.GROW);
      e.p(x, y, 0, 0, 0.12, 4.5 * k, '#ffffff', '#4fc8ff', SH.GLOW, 0, 0, A);
      e.light(x, y, 40, '#7ad8ff', 1, 0.2);
    },
    burst(e, x, y, k) {
      radial(e, e.n(14 * k), x, y, 40, 130 * Math.sqrt(k), 0.35, 0.7, [1, 2], '#ffffff', '#4fc8ff', SH.SHARD, 3, 90, A | F.BOUNCE);
      radial(e, e.n(6 * k), x, y, 6, 30, 0.6, 1.1, 1, '#ffffff', '#9af0ff', SH.STAR, 1.5, 6, A | F.TWINKLE);
      radial(e, e.n(4 * k), x, y, 6, 22, 0.5, 0.9, [2, 3.5], '#e6f8ff', '#9ac8e8', SH.SMOKE, 2, -6, F.GROW);
      e.p(x, y, 0, 0, 0.14, 6 * Math.sqrt(k), '#ffffff', '#9af0ff', SH.GLOW, 0, 0, A);
      e.ring(x, y, 11 * Math.sqrt(k), '#e6fbff', 0.3, { width: 1 });
      e.light(x, y, 48 * Math.sqrt(k), '#7ad8ff', 1.1, 0.35);
    },
    nova(e, x, y, R0, k) {
      ringOut(e, e.n(R0 * 0.9 * k), x, y, 4, R0 * 2.3, R0 * 3.2, 0.35, 0.6, [1, 2], '#ffffff', '#4fc8ff', SH.SHARD, 3.5, 20, A);
      ringOut(e, e.n(R0 * 0.3 * k), x, y, R0 * 0.3, R0 * 1.0, R0 * 1.6, 0.5, 0.9, [2.5, 4], '#e6f8ff', '#9ac8e8', SH.SMOKE, 2.5, -4, F.GROW);
      for (let i = 0, n = e.n(R0 * 0.35 * k); i < n; i++) {
        const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * R0;
        e.p(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.85 - 20, R(-6, 6), R(10, 25), R(0.7, 1.2), 1, '#ffffff', '#9af0ff', SH.STAR, 0.5, 6, A | F.TWINKLE);
      }
      e.ring(x, y, R0, '#e6fbff', 0.45, { width: 2 });
      e.ring(x, y, R0 * 0.8, '#4fc8ff', 0.5, { width: 3 });
      e.light(x, y, R0 * 1.7, '#7ad8ff', 1.3, 0.5);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.4 * k) e.p(x + R(-7, 7), y + R(-16, -8), R(-3, 3), R(6, 14), R(0.6, 1), 1, '#ffffff', '#9af0ff', SH.STAR, 0.5, 4, A | F.TWINKLE);
    },
  },

  lightning: {
    main: '#ffe14a', hi: '#ffffff', core: '#ffffff', dark: '#8a6a10', light: '#fff2a0', decal: 'burn', flash: '#fff6c0',
    trail(e, x, y, dx, dy, k) {
      radial(e, e.n(1.6 * k), x, y, 60, 140, 0.06, 0.14, 1, '#ffffff', '#ffe14a', SH.SPARK, 8, 0, A);
      if (Math.random() < 0.18 * k) { const a = Math.random() * TAU, d = R(5, 9); e.arc(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d, '#ffffff', '#ffe14a', 0.07, 0); }
    },
    cast(e, x, y, dx, dy, k) {
      const a = Math.atan2(dy, dx);
      for (let i = 0; i < Math.max(1, Math.round(2 * k)); i++) {
        const b = a + R(-0.6, 0.6), d = R(10, 18);
        e.arc(x, y, x + Math.cos(b) * d, y + Math.sin(b) * d, '#ffffff', '#ffe14a', 0.1, 1);
      }
      cone(e, e.n(10 * k), x, y, a, 1.6, 80, 200, 0.08, 0.2, 1, '#ffffff', '#ffe14a', SH.SPARK, 8, 0, A);
      e.p(x, y, 0, 0, 0.1, 5 * k, '#ffffff', '#fff2a0', SH.GLOW, 0, 0, A);
      e.light(x, y, 52, '#fff2a0', 1.3, 0.14);
    },
    burst(e, x, y, k) {
      const n = Math.max(2, Math.round(3 * Math.sqrt(k)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R(-0.4, 0.4), d = R(10, 20) * Math.sqrt(k);
        e.arc(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d, '#ffffff', '#ffe14a', R(0.1, 0.18), 1);
      }
      radial(e, e.n(14 * k), x, y, 90, 220, 0.08, 0.22, 1, '#ffffff', '#ffe14a', SH.SPARK, 7, 40, A);
      e.p(x, y, 0, 0, 0.12, 8 * Math.sqrt(k), '#ffffff', '#ffe14a', SH.GLOW, 0, 0, A);
      e.p(x, y, 0, 0, 0.2, 4, '#ffffff', '#ffe14a', SH.STAR, 0, 0, A);
      e.ring(x, y, 14 * Math.sqrt(k), '#fff6c0', 0.2, { width: 1 });
      e.light(x, y, 64 * Math.sqrt(k), '#fff2a0', 1.5, 0.18);
    },
    nova(e, x, y, R0, k) {
      const n = Math.max(5, Math.round(R0 / 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R(-0.2, 0.2);
        e.arc(x, y, x + Math.cos(a) * R0, y + Math.sin(a) * R0 * 0.85, '#ffffff', '#ffe14a', R(0.14, 0.24), 2);
      }
      ringOut(e, e.n(R0 * 0.8 * k), x, y, R0 * 0.2, R0 * 2.5, R0 * 4, 0.1, 0.25, 1, '#ffffff', '#ffe14a', SH.SPARK, 6, 0, A);
      e.ring(x, y, R0, '#fff6c0', 0.3, { width: 2 });
      e.light(x, y, R0 * 2, '#fff2a0', 1.6, 0.3);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.25 * k) { const a = Math.random() * TAU; e.arc(x + R(-4, 4), y - R(4, 12), x + Math.cos(a) * 8, y - 8 + Math.sin(a) * 8, '#ffffff', '#ffe14a', 0.07, 0); }
      if (Math.random() < 0.3 * k) e.p(x + R(-5, 5), y - R(2, 14), R(-60, 60), R(-60, 60), 0.1, 1, '#ffffff', '#ffe14a', SH.SPARK, 8, 0, A);
    },
  },

  arcane: {
    main: '#b05aff', hi: '#ffb8ff', core: '#fff0ff', dark: '#3a1a7a', light: '#c08aff', decal: 'glyph', flash: '#d0a0ff',
    trail(e, x, y, dx, dy, k) {
      cone(e, e.n(1.5 * k), x, y, Math.atan2(-dy, -dx), 2, 6, 24, 0.3, 0.6, 1.5, '#fff0ff', '#b05aff', SH.STAR, 2, 0, A | F.TWINKLE, R(-5, 5));
      if (Math.random() < 0.5 * k) e.p(x + R(-2, 2), y + R(-2, 2), R(-8, 8), R(-8, 8), R(0.3, 0.6), 1, '#ffb8ff', '#7a3ac0', SH.MOTE, 2, -6, A, R(-6, 6));
    },
    cast(e, x, y, dx, dy, k) {
      radial(e, e.n(12 * k), x, y, 20, 70, 0.3, 0.6, 1.5, '#fff0ff', '#b05aff', SH.STAR, 3, 0, A | F.TWINKLE, R(-6, 6));
      for (let i = 0, n = Math.max(1, Math.round(2 * k)); i < n; i++) e.p(x + R(-6, 6), y + R(-6, 2), R(-6, 6), R(-24, -12), R(0.6, 0.9), 1, '#ffb8ff', '#b05aff', SH.RUNE, 1.5, -6, A | F.FADEIN);
      e.p(x, y, 0, 0, 0.14, 5 * k, '#fff0ff', '#b05aff', SH.GLOW, 0, 0, A);
      e.ring(x, y, 10, '#c08aff', 0.25, { implode: true });
      e.light(x, y, 44, '#c08aff', 1, 0.25);
    },
    burst(e, x, y, k) {
      radial(e, e.n(16 * k), x, y, 30, 110 * Math.sqrt(k), 0.35, 0.7, [1, 2], '#fff0ff', '#b05aff', SH.STAR, 3.5, 0, A | F.TWINKLE, R(-8, 8));
      radial(e, e.n(8 * k), x, y, 20, 60, 0.3, 0.6, [1, 2], '#ffb8ff', '#6a3ac0', SH.GLOW, 3, 0, A | F.SHRINK, 8);
      for (let i = 0, n = Math.max(1, Math.round(2 * k)); i < n; i++) e.p(x + R(-8, 8), y + R(-8, 4), 0, R(-18, -8), R(0.6, 1), 1, '#ffb8ff', '#b05aff', SH.RUNE, 1, 0, A | F.FADEIN);
      e.p(x, y, 0, 0, 0.16, 7 * Math.sqrt(k), '#fff0ff', '#b05aff', SH.GLOW, 0, 0, A);
      e.ring(x, y, 12 * Math.sqrt(k), '#ffb8ff', 0.35, { width: 1 });
      e.ring(x, y, 7 * Math.sqrt(k), '#b05aff', 0.3, { width: 2 });
      e.light(x, y, 52 * Math.sqrt(k), '#c08aff', 1.2, 0.35);
    },
    nova(e, x, y, R0, k) {
      ringOut(e, e.n(R0 * 1.1 * k), x, y, 3, R0 * 2, R0 * 3, 0.4, 0.7, 1.5, '#fff0ff', '#b05aff', SH.STAR, 3, 0, A | F.TWINKLE, 3);
      const nr = Math.max(4, Math.round(R0 / 8));
      for (let i = 0; i < nr; i++) { const a = (i / nr) * TAU; e.p(x + Math.cos(a) * R0 * 0.8, y + Math.sin(a) * R0 * 0.7, 0, -12, R(0.6, 0.9), 1, '#ffb8ff', '#b05aff', SH.RUNE, 1, 0, A | F.FADEIN); }
      e.ring(x, y, R0, '#ffb8ff', 0.5, { width: 2 });
      e.ring(x, y, R0 * 0.75, '#b05aff', 0.45, { width: 2 });
      e.light(x, y, R0 * 1.8, '#c08aff', 1.3, 0.5);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.4 * k) { const a = Math.random() * TAU; e.p(x + Math.cos(a) * 8, y - 6 + Math.sin(a) * 4, -Math.sin(a) * 16, Math.cos(a) * 8 - 6, R(0.4, 0.8), 1, '#fff0ff', '#b05aff', SH.STAR, 1, -4, A | F.TWINKLE); }
    },
  },

  earth: {
    main: '#8fb83a', hi: '#e8d08a', core: '#fff4c8', dark: '#4a3a1a', light: '#c8d07a', decal: 'crack', flash: '#e8d08a',
    trail(e, x, y, dx, dy, k) {
      if (Math.random() < 0.7 * k) e.p(x + R(-2, 2), y + R(-2, 2), R(-8, 8), R(-4, 4), R(0.3, 0.6), R(1.5, 3), '#9a8a6a', '#6a5a3a', SH.SMOKE, 2, 8, F.GROW);
      if (Math.random() < 0.4 * k) e.p(x, y, R(-15, 15), R(-20, 0), R(0.4, 0.7), R(1, 2), '#8a6a4a', '#4a3424', SH.CHUNK, 1, 120, F.BOUNCE);
      if (Math.random() < 0.2 * k) e.p(x, y, R(-10, 10), R(-10, 10), R(0.6, 1), 1, '#8fb83a', '#5a8a2a', SH.PX, 1, 15, F.WOBBLE);
    },
    cast(e, x, y, dx, dy, k) {
      const a = Math.atan2(dy, dx);
      cone(e, e.n(8 * k), x, y, a, 1.4, 20, 70, 0.4, 0.7, [2, 3.5], '#a89a7a', '#6a5a3a', SH.SMOKE, 3, 0, F.GROW);
      cone(e, e.n(6 * k), x, y, a, 1.6, 20, 60, 0.6, 1, 1, '#8fb83a', '#5a8a2a', SH.PX, 1, 20, F.WOBBLE);
      e.light(x, y, 36, '#c8d07a', 0.8, 0.2);
    },
    burst(e, x, y, k) {
      radial(e, e.n(12 * k), x, y - 2, 30, 100 * Math.sqrt(k), 0.5, 0.9, [1, 2.5], '#9a7a5a', '#4a3424', SH.CHUNK, 1.5, 200, F.BOUNCE);
      radial(e, e.n(6 * k), x, y, 10, 40, 0.6, 1, [2.5, 4], '#a89a7a', '#6a5a3a', SH.SMOKE, 2, -6, F.GROW);
      radial(e, e.n(5 * k), x, y, 20, 50, 0.6, 1.1, 1, '#8fb83a', '#5a8a2a', SH.PX, 1.5, 20, F.WOBBLE);
      e.ring(x, y, 12 * Math.sqrt(k), '#e8d08a', 0.3, { width: 2 });
      e.light(x, y, 44 * Math.sqrt(k), '#c8d07a', 0.9, 0.3);
    },
    nova(e, x, y, R0, k) {
      ringOut(e, e.n(R0 * 0.7 * k), x, y, R0 * 0.5, 30, 80, 0.5, 0.9, [1, 3], '#9a7a5a', '#4a3424', SH.CHUNK, 1.5, 200, F.BOUNCE);
      ringOut(e, e.n(R0 * 0.4 * k), x, y, R0 * 0.3, R0 * 1.2, R0 * 1.8, 0.6, 1, [3, 4.5], '#a89a7a', '#6a5a3a', SH.SMOKE, 2.5, -4, F.GROW);
      e.ring(x, y, R0, '#e8d08a', 0.45, { width: 3 });
      e.light(x, y, R0 * 1.5, '#c8d07a', 1, 0.45);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.3 * k) e.p(x + R(-6, 6), y - R(0, 10), R(-10, 10), R(-10, 0), R(0.6, 1), 1, '#8fb83a', '#5a8a2a', SH.PX, 1, 10, F.WOBBLE);
    },
  },

  physical: {
    main: '#c8c8d0', hi: '#ffffff', core: '#ffffff', dark: '#4a4a5a', light: '#ffffff', decal: null, flash: '#ffffff',
    trail(e, x, y) { if (Math.random() < 0.3) e.p(x, y, R(-5, 5), R(-5, 5), 0.2, 1, '#ffffff', '#c8c8d0', SH.PX, 2, 0, A); },
    cast(e, x, y, dx, dy, k) { cone(e, e.n(6 * k), x, y, Math.atan2(dy, dx), 1.2, 40, 100, 0.1, 0.2, 1, '#ffffff', '#c8c8d0', SH.SPARK, 6, 0, A); },
    burst(e, x, y, k) {
      radial(e, e.n(10 * k), x, y, 60, 150, 0.08, 0.2, 1, '#ffffff', '#ffe8b0', SH.SPARK, 6, 60, A);
      e.p(x, y, 0, 0, 0.1, 4, '#ffffff', '#ffe8b0', SH.STAR, 0, 0, A);
    },
    nova(e, x, y, R0, k) { ringOut(e, e.n(R0 * 0.6 * k), x, y, 3, R0 * 2, R0 * 3, 0.2, 0.35, 1, '#ffffff', '#c8c8d0', SH.SPARK, 4, 0, A); e.ring(x, y, R0, '#ffffff', 0.3, { width: 2 }); },
    aura() {},
  },

  corrupt: {
    main: '#a02aa8', hi: '#7aff5a', core: '#e0ffd0', dark: '#24082e', light: '#b05aff', decal: 'corrupt', flash: '#7aff5a',
    trail(e, x, y, dx, dy, k) {
      cone(e, e.n(1.8 * k), x, y, Math.atan2(-dy, -dx), 1.6, 6, 20, 0.3, 0.6, [1, 2], pick(['#7aff5a', '#c05aff']), '#5a1a7a', SH.GLOW, 2, -10, A | F.SHRINK, R(-4, 4));
      if (Math.random() < 0.3 * k) e.p(x, y, R(-6, 6), R(-6, 6), R(0.5, 0.8), R(1.5, 2.5), '#2a0a34', '#14061a', SH.SMOKE, 1.5, -6, F.GROW);
    },
    cast(e, x, y, dx, dy, k) {
      radial(e, e.n(12 * k), x, y, 20, 80, 0.35, 0.6, [1, 2], '#7aff5a', '#a02aa8', SH.GLOW, 3, -10, A | F.SHRINK, R(-6, 6));
      e.ring(x, y, 14, '#7aff5a', 0.3, { implode: true });
      e.light(x, y, 48, '#b05aff', 1.1, 0.25);
    },
    burst(e, x, y, k) {
      radial(e, e.n(14 * k), x, y, 30, 100, 0.4, 0.7, [1, 2.4], '#7aff5a', '#a02aa8', SH.GLOW, 3, -20, A | F.SHRINK | F.FLICKER, R(-8, 8));
      radial(e, e.n(5 * k), x, y, 8, 30, 0.6, 1, [2.5, 4], '#2a0a34', '#14061a', SH.SMOKE, 2, -8, F.GROW);
      e.ring(x, y, 12 * Math.sqrt(k), '#7aff5a', 0.35, { width: 2 });
      e.light(x, y, 56 * Math.sqrt(k), '#b05aff', 1.2, 0.35);
    },
    nova(e, x, y, R0, k) {
      ringOut(e, e.n(R0 * 1 * k), x, y, 4, R0 * 2, R0 * 3, 0.4, 0.7, [1, 2.5], '#7aff5a', '#a02aa8', SH.GLOW, 3, -10, A | F.SHRINK, 2);
      e.ring(x, y, R0, '#7aff5a', 0.5, { width: 3 });
      e.ring(x, y, R0 * 0.7, '#c05aff', 0.45, { width: 2 });
      e.light(x, y, R0 * 1.8, '#b05aff', 1.4, 0.5);
    },
    aura(e, x, y, k) {
      if (Math.random() < 0.6 * k) { const a = Math.random() * TAU, d = R(6, 14); e.p(x + Math.cos(a) * d, y - 10 + Math.sin(a) * d * 0.6, -Math.sin(a) * 12, -Math.cos(a) * 6 - 10, R(0.6, 1.1), R(1, 2), pick(['#7aff5a', '#c05aff', '#ff5ad8']), '#3a0a4a', SH.GLOW, 1, -8, A | F.SHRINK); }
      if (Math.random() < 0.15 * k) e.p(x + R(-8, 8), y - R(0, 6), R(-4, 4), R(-10, -4), R(0.8, 1.3), R(2, 3.5), '#2a0a34', '#14061a', SH.SMOKE, 1, -6, F.GROW);
    },
  },
};

/** Normalise an element list (string | string[] | spell) to known signature keys. */
export function elementsOf(x) {
  let list = x;
  if (!list) return ['arcane'];
  if (typeof list === 'string') list = [list];
  else if (!Array.isArray(list)) list = list.elements?.length ? list.elements : [list.element || 'arcane'];
  const out = [];
  for (const el of list) {
    const k = SIGS[el] ? el : el === 'void' || el === 'shadow' || el === 'corrupted' ? 'corrupt' : el === 'storm' ? 'lightning' : el === 'frost' ? 'ice' : el === 'nature' ? 'earth' : 'arcane';
    if (!out.includes(k)) out.push(k);
  }
  return out.length ? out : ['arcane'];
}

const PRISM = ['#ff6a1f', '#ffe14a', '#7aff5a', '#4fc8ff', '#b05aff', '#ff5ad8'];

/** Combo flourishes for mixed elements. `big` = AoE/nova scale (radius). */
export function comboFx(e, els, x, y, big) {
  if (els.length < 2) return;
  const has = (a) => els.includes(a);
  const s = big ? Math.max(1, big / 16) : 1;
  if (els.length >= 3) {
    // prismatic: rainbow starburst
    const n = e.n(18 * s);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, sp = R(60, 130) * Math.sqrt(s);
      const c = PRISM[i % PRISM.length];
      e.p(x, y, Math.cos(a) * sp, Math.sin(a) * sp, R(0.4, 0.7), 1.5, '#ffffff', c, SH.STAR, 3, 0, A | F.TWINKLE);
    }
    e.ring(x, y, 16 * Math.sqrt(s), '#ffffff', 0.4, { width: 2, rainbow: true });
  }
  if (has('fire') && has('ice')) {
    // steam
    radial(e, e.n(8 * s), x, y, 10, 40 * Math.sqrt(s), 0.7, 1.2, [3, 5], '#f0f4ff', '#a8b0c8', SH.SMOKE, 1.8, -24, F.GROW);
  }
  if (has('fire') && has('lightning')) {
    // plasma: white-magenta core and pink sparks
    e.p(x, y, 0, 0, 0.18, 7 * Math.sqrt(s), '#ffffff', '#ff5ad8', SH.GLOW, 0, 0, A);
    radial(e, e.n(8 * s), x, y, 100, 200, 0.1, 0.25, 1, '#ffffff', '#ff5ad8', SH.SPARK, 6, 0, A);
  }
  if (has('ice') && has('lightning')) {
    // storm: crackling arcs through falling snow
    for (let i = 0; i < Math.round(2 * Math.sqrt(s)); i++) { const a = Math.random() * TAU, d = R(8, 18) * Math.sqrt(s); e.arc(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d, '#e6fbff', '#4fc8ff', 0.15, 1); }
  }
  if (has('fire') && has('earth')) {
    // magma: glowing debris
    radial(e, e.n(8 * s), x, y - 2, 40, 110, 0.6, 1, [1.5, 2.5], '#ffb040', '#8a2a08', SH.CHUNK, 1.2, 220, A | F.BOUNCE);
  }
  if (has('arcane') && els.length === 2) {
    const other = els.find((x2) => x2 !== 'arcane');
    const c = SIGS[other]?.hi || '#ffffff';
    radial(e, e.n(6 * s), x, y, 20, 60, 0.4, 0.7, 1.5, '#ffffff', c, SH.STAR, 3, 0, A | F.TWINKLE, 8);
  }
}
