// FX public API (team: art+fx). WORKING PLACEHOLDER - replace internals freely, keep the API.
// Contract: ARCHITECTURE.md §4.2. Particles are cosmetic: use Math.random, not the seeded RNG.
import { EV } from '../core/events.js';
import { ELEMENT_COLORS, TILE_SIZE } from '../core/config.js';
import { TILE_DEFS } from '../core/tiles.js';

const MAX_PARTICLES = 1200;

/** Preset table: (opts) -> particle spawn params. `opts.element` picks colours. */
const PRESETS = {
  cast: { count: 14, speed: [20, 60], life: [0.25, 0.5], size: [1, 2], drag: 3, gravity: 0 },
  trail: { count: 2, speed: [0, 12], life: [0.15, 0.35], size: [1, 2], drag: 2, gravity: 0 },
  impact: { count: 18, speed: [30, 90], life: [0.2, 0.45], size: [1, 2], drag: 4, gravity: 0 },
  aoe: { count: 40, speed: [30, 120], life: [0.3, 0.7], size: [1, 3], drag: 3, gravity: 0 },
  death: { count: 30, speed: [20, 70], life: [0.4, 0.9], size: [1, 3], drag: 2, gravity: -20 },
  pickup: { count: 12, speed: [10, 40], life: [0.3, 0.6], size: [1, 1], drag: 2, gravity: -30 },
  heal: { count: 16, speed: [5, 25], life: [0.5, 0.9], size: [1, 2], drag: 1, gravity: -40, colors: ['#5aff8a', '#e0ffe8'] },
  portal: { count: 3, speed: [5, 20], life: [0.6, 1.2], size: [1, 1], drag: 0.5, gravity: -15, colors: ['#b05aff', '#ffb8ff'] },
  dust: { count: 6, speed: [5, 20], life: [0.3, 0.6], size: [1, 2], drag: 3, gravity: 0, colors: ['#8a8070', '#b8a890'], additive: false },
  sparkle: { count: 8, speed: [5, 30], life: [0.3, 0.8], size: [1, 1], drag: 1, gravity: 0 },
  hit: { count: 8, speed: [30, 70], life: [0.1, 0.25], size: [1, 1], drag: 6, gravity: 0, colors: ['#ffffff', '#ffe8b0'] },
};

const rnd = (a, b) => a + Math.random() * (b - a);

export function createFx(game) {
  const particles = [];
  const rings = [];
  let pendingLights = [];
  let frameLights = [];
  const attached = new Set();
  let staticLights = [];
  const flash = { color: '#fff', t: 0, dur: 0, alpha: 0 };
  let lightCanvas = null, lightCtx = null;

  function colorsFor(preset, opts) {
    if (opts.color) return [opts.color, opts.color2 || opts.color];
    if (preset.colors && !opts.element) return preset.colors;
    return ELEMENT_COLORS[opts.element] || preset.colors || ELEMENT_COLORS.arcane;
  }

  const fx = {
    /**
     * Spawn a particle burst. preset: key of PRESETS (unknown -> 'sparkle').
     * opts: { element, color, color2, count, angle (rad), spread (rad), speed, life, size, additive }
     */
    emit(presetName, x, y, opts = {}) {
      const p = PRESETS[presetName] || PRESETS.sparkle;
      const [c1, c2] = colorsFor(p, opts);
      const n = opts.count ?? p.count;
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        const a = opts.angle != null ? opts.angle + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2) : Math.random() * Math.PI * 2;
        const sp = opts.speed ?? rnd(p.speed[0], p.speed[1]);
        const life = opts.life ?? rnd(p.life[0], p.life[1]);
        particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life,
          size: opts.size ?? Math.round(rnd(p.size[0], p.size[1])),
          color: Math.random() < 0.6 ? c1 : c2, drag: p.drag, gravity: p.gravity,
          additive: opts.additive ?? p.additive ?? true,
        });
      }
    },

    /** Expanding ring/shockwave in world space. */
    ring(x, y, radius, color = '#fff', duration = 0.35) {
      rings.push({ x, y, radius, color, t: 0, dur: duration });
    },

    /** Transient light for the next rendered frame. Call every tick to keep it alive. */
    addLight(x, y, radius, color = '#ffffff', intensity = 1) {
      pendingLights.push({ x, y, radius, color, intensity });
    },

    /** Persistent light following `target` ({x,y}) until removed or target.dead. */
    attachLight(target, radius, color = '#ffffff', intensity = 1) {
      const h = { target, radius, color, intensity, remove: () => attached.delete(h) };
      attached.add(h);
      return h;
    },

    /** Full-screen flash. */
    flash(color = '#ffffff', duration = 0.15, alpha = 0.6) {
      Object.assign(flash, { color, t: duration, dur: duration, alpha });
    },

    update(dt) {
      frameLights = pendingLights;
      pendingLights = [];
      let w = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy = p.vy * k + p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        particles[w++] = p;
      }
      particles.length = w;
      for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].t += dt) >= rings[i].dur) rings.splice(i, 1);
      for (const h of attached) if (h.target.dead) attached.delete(h);
      if (flash.t > 0) flash.t = Math.max(0, flash.t - dt);
    },

    /** Ground decals / telegraphs under entities (world space). */
    renderGround(ctx, camera) {},

    /** Darkness + light mask (SCREEN space). ambient: {darkness 0..1, color} or null. */
    renderLighting(ctx, camera, ambient) {
      const darkness = ambient?.darkness ?? 0;
      const W = camera.viewW, H = camera.viewH;
      const t = game.time;
      const lights = [...frameLights];
      for (const h of attached) lights.push({ x: h.target.x, y: h.target.y, radius: h.radius, color: h.color, intensity: h.intensity });
      for (const s of staticLights) {
        if (!camera.isVisible(s.x, s.y, s.radius)) continue;
        const fl = s.flicker ? 0.9 + 0.1 * Math.sin(t * 13 + s.x) * Math.sin(t * 7 + s.y) : 1;
        lights.push({ x: s.x, y: s.y, radius: s.radius * fl, color: s.color, intensity: 0.8 });
      }
      if (darkness > 0) {
        if (!lightCanvas || lightCanvas.width !== W || lightCanvas.height !== H) {
          lightCanvas = document.createElement('canvas');
          lightCanvas.width = W;
          lightCanvas.height = H;
          lightCtx = lightCanvas.getContext('2d');
        }
        const lc = lightCtx;
        lc.globalCompositeOperation = 'source-over';
        lc.clearRect(0, 0, W, H);
        lc.globalAlpha = darkness;
        lc.fillStyle = ambient.color || '#05030a';
        lc.fillRect(0, 0, W, H);
        lc.globalAlpha = 1;
        lc.globalCompositeOperation = 'destination-out';
        for (const l of lights) {
          const x = l.x - camera.left, y = l.y - camera.top;
          const g = lc.createRadialGradient(x, y, 0, x, y, l.radius);
          g.addColorStop(0, `rgba(0,0,0,${Math.min(1, l.intensity)})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          lc.fillStyle = g;
          lc.fillRect(x - l.radius, y - l.radius, l.radius * 2, l.radius * 2);
        }
        ctx.drawImage(lightCanvas, 0, 0);
      }
      // Coloured additive tint from lights (cheap glow).
      ctx.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const x = l.x - camera.left, y = l.y - camera.top;
        if (x < -l.radius || y < -l.radius || x > W + l.radius || y > H + l.radius) continue;
        const g = ctx.createRadialGradient(x, y, 0, x, y, l.radius);
        g.addColorStop(0, hexA(l.color, 0.18 * l.intensity));
        g.addColorStop(1, hexA(l.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - l.radius, y - l.radius, l.radius * 2, l.radius * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    },

    /** Particles and rings (world space, drawn after lighting so they glow). */
    renderWorld(ctx, camera) {
      for (const r of rings) {
        const k = r.t / r.dur;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(Math.round(r.x), Math.round(r.y), r.radius * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const p of particles) {
        if (!camera.isVisible(p.x, p.y, 4)) continue;
        ctx.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
        ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    /** Screen-space overlays (flash, vignette). */
    renderScreen(ctx) {
      if (flash.t <= 0) return;
      ctx.globalAlpha = flash.alpha * (flash.t / flash.dur);
      ctx.fillStyle = flash.color;
      ctx.fillRect(0, 0, game.display.width, game.display.height);
      ctx.globalAlpha = 1;
    },

    clear() {
      particles.length = 0;
      rings.length = 0;
      pendingLights = [];
      frameLights = [];
      attached.clear();
      flash.t = 0;
    },

    count() {
      return particles.length;
    },
  };

  // ---- automatic reactions to gameplay events --------------------------------------
  const { bus } = game;
  bus.on(EV.SCREEN_FLASH, ({ color, duration, alpha } = {}) => fx.flash(color, duration, alpha));
  bus.on(EV.SPELL_CAST, ({ x, y, spell, dirX, dirY }) => fx.emit('cast', x, y, { element: spell?.element, angle: Math.atan2(dirY || 0, dirX || 1), spread: 1.2 }));
  bus.on(EV.PROJECTILE_HIT, ({ x, y, element }) => fx.emit('impact', x, y, { element }));
  bus.on(EV.AOE_TRIGGERED, ({ x, y, radius, element }) => {
    fx.emit('aoe', x, y, { element });
    fx.ring(x, y, radius, (ELEMENT_COLORS[element] || ELEMENT_COLORS.arcane)[1]);
  });
  bus.on(EV.ENTITY_DAMAGED, ({ x, y }) => fx.emit('hit', x, y - 6));
  bus.on(EV.ENTITY_KILLED, ({ x, y, target }) => fx.emit('death', x, y - 6, { element: target?.element || 'arcane' }));
  bus.on(EV.PICKUP_COLLECTED, ({ x, y, element }) => fx.emit('pickup', x, y, { element: element || 'lightning' }));
  bus.on(EV.PLAYER_HEALED, () => game.player && fx.emit('heal', game.player.x, game.player.y - 6));
  bus.on(EV.PLAYER_DAMAGED, () => fx.flash('#ff2040', 0.15, 0.25));
  bus.on(EV.LEVEL_READY, ({ level }) => {
    staticLights = [];
    level.map.forEach((tx, ty, g, d) => {
      for (const id of [g, d]) {
        const L = id && TILE_DEFS[id].light;
        if (L) staticLights.push({ x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 8, ...L });
      }
    });
  });

  return fx;
}

function hexA(hex, a) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return `rgba(255,255,255,${a})`;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
