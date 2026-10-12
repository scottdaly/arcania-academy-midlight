// FX public API (team: art+fx). Contract: ARCHITECTURE.md §4.2. Particles are cosmetic: they use
// Math.random, never the seeded RNG.
//
// What lives here:
//  - a pooled, capped, adaptive particle system (particles.js) with additive glow sprites
//  - per-element particle signatures + combo blending for multi-element spells (signatures.js)
//  - rings/shockwaves, jagged lightning arcs, ground decals, AoE telegraphs
//  - dynamic lighting (darkness mask + coloured additive light, cached gradients only)
//  - emissive sprite pass (art records glowing pixels while drawing sprites; we replay them
//    additively after the lighting so eyes, runes and gems glow in the dark)
//  - ambient life per level (fireflies, dust, embers, snow, floating runes, corruption ash)
//    and per-tile emitters (torches, lava, crystals, mushrooms, fountains, cauldrons)
//  - automatic visuals from bus events AND automatic projectile trails / AoE telegraphs / status
//    auras by observing entities (combat needs no extra calls; see requests/art-fx.md)
//
// Extra API on top of the contract (documented in requests/art-fx.md):
//   fx.spellCast(elements, shape, x, y, {dirX, dirY, power})
//   fx.spellTrail(elements, shape, x, y, {dirX, dirY, power})
//   fx.spellImpact(elements, shape, x, y, {radius, power})
//   fx.telegraph(x, y, radius, elements, duration)
//   fx.arc(x0, y0, x1, y1, elements|color, {life, branches})
//   fx.decal(x, y, elements|type, radius)
//   fx.aura(target, elements, {rate}) -> {remove()}
//   fx.drawSpellOrb(ctx, x, y, elements, radius, t)
//   fx.dissolve(spriteKey, x, y, {frame, flip, elements})
//   fx.shine(x, y, color)  ·  fx.lightPulse(x, y, radius, color, intensity, duration)
//   fx.setQuality(0..1) / fx.quality
import { EV } from '../core/events.js';
import { ELEMENT_COLORS, TILE_SIZE } from '../core/config.js';
import { TILE, TILE_DEFS } from '../core/tiles.js';
import { Particles, SH, F, cid } from './particles.js';
import { SIGS, elementsOf, comboFx } from './signatures.js';
import { glowSprite, decalSprite, vignetteSprite, rgba, rgbOf } from './sprites.js';

const MAX_PARTICLES = 1200;
const LIGHT_DIV = 4; // lightmap / tint buffers are 1/LIGHT_DIV of the virtual resolution
// Radial falloff lookup tables indexed by (d / radius)^2 * LUT_N, matching the colour stops of the
// former lightMaskSprite / lightTintSprite gradients (piecewise linear in d).
const LUT_N = 1024;
function makeLut(stops) {
  const lut = new Float32Array(LUT_N);
  for (let i = 0; i < LUT_N; i++) {
    const d = Math.sqrt((i + 0.5) / LUT_N);
    let s = 1;
    while (s < stops.length - 1 && stops[s][0] < d) s++;
    const [d0, v0] = stops[s - 1], [d1, v1] = stops[s];
    lut[i] = v0 + (v1 - v0) * Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  }
  return lut;
}
const MASK_LUT = makeLut([[0, 1], [0.35, 0.85], [0.7, 0.35], [1, 0]]);
const TINT_LUT = makeLut([[0, 1], [0.4, 0.45], [1, 0]]);
const rgbMemo = new Map();
const rgbCached = (c) => { let v = rgbMemo.get(c); if (!v) rgbMemo.set(c, (v = rgbOf(c))); return v; };
const TAU = Math.PI * 2;
const R = (a, b) => a + Math.random() * (b - a);
const A = F.ADD;

// Legacy preset table (fx.emit). Each maps onto shapes from the new system.
const PRESETS = {
  cast: { count: 14, speed: [20, 70], life: [0.25, 0.5], size: [1, 2], drag: 3, grav: -10, shape: SH.GLOW, flags: A | F.SHRINK },
  trail: { count: 2, speed: [0, 14], life: [0.18, 0.4], size: [1, 2], drag: 2, grav: -10, shape: SH.GLOW, flags: A | F.SHRINK },
  impact: { count: 18, speed: [30, 100], life: [0.2, 0.45], size: [1, 2], drag: 4, grav: 0, shape: SH.GLOW, flags: A | F.SHRINK },
  aoe: { count: 40, speed: [30, 130], life: [0.3, 0.7], size: [1, 3], drag: 3, grav: 0, shape: SH.GLOW, flags: A | F.SHRINK },
  death: { count: 30, speed: [20, 70], life: [0.4, 0.9], size: [1, 2.5], drag: 2, grav: -20, shape: SH.GLOW, flags: A | F.SHRINK },
  pickup: { count: 12, speed: [10, 40], life: [0.4, 0.7], size: [1, 1.5], drag: 2, grav: -30, shape: SH.STAR, flags: A | F.TWINKLE },
  heal: { count: 16, speed: [5, 25], life: [0.6, 1], size: [1, 1.5], drag: 1, grav: -40, shape: SH.STAR, flags: A | F.TWINKLE, colors: ['#e0ffe8', '#5aff8a'] },
  portal: { count: 3, speed: [5, 20], life: [0.6, 1.2], size: [1, 1.5], drag: 0.5, grav: -15, shape: SH.MOTE, flags: A, colors: ['#ffb8ff', '#b05aff'], swirl: 3 },
  dust: { count: 6, speed: [5, 22], life: [0.35, 0.7], size: [2, 3.5], drag: 3, grav: -4, shape: SH.SMOKE, flags: F.GROW, colors: ['#a89a88', '#7a7060'] },
  sparkle: { count: 8, speed: [5, 30], life: [0.4, 0.9], size: [1, 1.5], drag: 1, grav: -4, shape: SH.STAR, flags: A | F.TWINKLE },
  hit: { count: 8, speed: [50, 120], life: [0.08, 0.2], size: [1, 1], drag: 6, grav: 30, shape: SH.SPARK, flags: A, colors: ['#ffffff', '#ffe8b0'] },
  smoke: { count: 4, speed: [4, 14], life: [0.6, 1.1], size: [2, 3.5], drag: 1.5, grav: -14, shape: SH.SMOKE, flags: F.GROW, colors: ['#4a4450', '#2a2430'] },
  ember: { count: 4, speed: [5, 20], life: [0.5, 0.9], size: [1, 1.8], drag: 1.5, grav: -30, shape: SH.GLOW, flags: A | F.FLICKER | F.SHRINK, colors: ['#ffd25a', '#ff4a10'] },
  snow: { count: 4, speed: [2, 8], life: [1, 1.6], size: [1, 1], drag: 0.5, grav: 8, shape: SH.STAR, flags: A | F.TWINKLE, colors: ['#ffffff', '#9af0ff'] },
  rune: { count: 2, speed: [2, 6], life: [0.8, 1.2], size: [1, 1], drag: 1, grav: -10, shape: SH.RUNE, flags: A | F.FADEIN, colors: ['#ffb8ff', '#b05aff'] },
};

function hexA(color, a) {
  return rgba(color || '#ffffff', a);
}

export function createFx(game) {
  const P = new Particles(MAX_PARTICLES);
  const rings = [];
  const arcs = [];
  const decals = [];
  const telegraphs = [];
  const pulses = []; // timed lights
  const timers = [];
  const auras = new Set();
  let pendingLights = [];
  let frameLights = [];
  const attached = new Set();
  let staticLights = [];
  let emitters = []; // tile emitters {x, y, kind}
  const flash = { color: '#fff', t: 0, dur: 0, alpha: 0 };
  let dmgVignette = 0;
  let lightBuf = null;
  const lightPool = []; // reused {x, y, radius, color, intensity} records (collectLights)
  let quality = 1;
  let qualityCap = 1; // user setting ceiling (settings.particleQuality); the adaptive loop stays below it
  let frameEma = 16.7, lastFrame = 0;
  let levelKind = null, levelTheme = 'academy';
  let ambientAcc = 0;
  let footAcc = 0, lastPX = 0, lastPY = 0;
  const statusAuras = [];

  // ------------------------------------------------------------- emitter facade for signatures
  const E = {
    n(count) {
      const c = count * quality;
      const i = Math.floor(c);
      return i + (Math.random() < c - i ? 1 : 0);
    },
    p(x, y, vx, vy, life, size, c1, c2, shape, drag, grav, flags, swirl = 0) {
      return P.spawn(x, y, vx, vy, life, size, c1, c2, shape, drag, grav, flags, swirl);
    },
    ring(x, y, r, color, dur = 0.35, o = {}) { addRing(x, y, r, color, dur, o); },
    light(x, y, r, color, intensity = 1, dur = 0.25) { pulses.push({ x, y, r, color, i: intensity, t: 0, dur }); if (pulses.length > 48) pulses.shift(); },
    arc(x0, y0, x1, y1, c1, c2, life = 0.12, branches = 0) { addArc(x0, y0, x1, y1, c1, c2, life, branches); },
    decal(x, y, type, r) { addDecal(x, y, type, r); },
  };

  function addRing(x, y, radius, color = '#fff', duration = 0.35, o = {}) {
    if (rings.length > 40) rings.shift();
    rings.push({ x, y, radius, color, t: -(o.delay || 0), dur: duration, width: o.width || 1, implode: !!o.implode, rainbow: !!o.rainbow });
  }

  function jag(x0, y0, x1, y1, out) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const n = Math.max(2, Math.min(10, Math.round(len / 5)));
    const nx = -dy / (len || 1), ny = dx / (len || 1);
    out.length = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = i === 0 || i === n ? 0 : (Math.random() - 0.5) * Math.min(8, len * 0.25);
      out.push(x0 + dx * t + nx * off, y0 + dy * t + ny * off);
    }
    return out;
  }

  function addArc(x0, y0, x1, y1, c1 = '#ffffff', c2 = '#ffe14a', life = 0.12, branches = 0) {
    if (arcs.length > 48) arcs.shift();
    const a = { x0, y0, x1, y1, c1, c2, life, max: life, pts: jag(x0, y0, x1, y1, []), re: 0 };
    arcs.push(a);
    for (let b = 0; b < branches; b++) {
      const k = R(0.3, 0.7);
      const i = Math.floor((a.pts.length / 2) * k) * 2;
      const bx = a.pts[i], by = a.pts[i + 1];
      const ang = Math.atan2(y1 - y0, x1 - x0) + R(-1.2, 1.2);
      const l = Math.hypot(x1 - x0, y1 - y0) * R(0.3, 0.5);
      arcs.push({ x0: bx, y0: by, x1: bx + Math.cos(ang) * l, y1: by + Math.sin(ang) * l, c1, c2, life: life * 0.7, max: life * 0.7, pts: jag(bx, by, bx + Math.cos(ang) * l, by + Math.sin(ang) * l, []), re: 0 });
    }
  }

  function addDecal(x, y, type, r = 10) {
    if (!type) return;
    if (decals.length > 36) decals.shift();
    decals.push({ x, y, type, r, t: 0, dur: 5 + Math.random() * 2 });
  }

  function sigs(els) { return elementsOf(els).map((k) => SIGS[k]); }
  function mainColors(els) {
    const list = elementsOf(els);
    const s = SIGS[list[0]];
    return [s.main, s.hi, s.light];
  }

  // ------------------------------------------------------------- high level spell API
  function spellCast(els, shape = 'projectile', x, y, o = {}) {
    const list = elementsOf(els);
    const k = (o.power || 1) / Math.sqrt(list.length);
    const dx = o.dirX ?? 1, dy = o.dirY ?? 0;
    for (const el of list) SIGS[el].cast(E, x, y, dx, dy, k);
    if (shape === 'nova') {
      for (const el of list) E.ring(x, y, 22, SIGS[el].hi, 0.25, { implode: true, width: 2 });
    } else if (shape === 'self') {
      for (let i = 0; i < 10; i++) for (const el of list) SIGS[el].aura(E, x, y + 4, 2);
      E.ring(x, y, 14, SIGS[list[0]].hi, 0.4, { width: 1 });
    }
    if (list.length > 1) comboFx(E, list, x, y, 0);
  }

  function spellTrail(els, shape, x, y, o = {}) {
    if (typeof shape === 'number') { o = y || {}; y = x; x = shape; shape = 'projectile'; }
    const list = elementsOf(els);
    const k = (o.power || 1) / Math.sqrt(list.length);
    const dx = o.dirX ?? 0, dy = o.dirY ?? 0;
    const len = Math.hypot(dx, dy) || 1;
    for (const el of list) SIGS[el].trail(E, x, y, dx / len, dy / len, k);
    if (list.length >= 3 && Math.random() < 0.5 * quality) {
      const c = ['#ff6a1f', '#ffe14a', '#4fc8ff', '#b05aff'][(Math.random() * 4) | 0];
      P.spawn(x, y, R(-10, 10), R(-10, 10), 0.4, 1, '#ffffff', c, SH.STAR, 2, 0, A | F.TWINKLE);
    }
  }

  function spellImpact(els, shape = 'projectile', x, y, o = {}) {
    const list = elementsOf(els);
    const k = (o.power || 1) / Math.sqrt(list.length);
    if (shape === 'aoe' || shape === 'nova') {
      const r = o.radius || 32;
      for (const el of list) {
        SIGS[el].nova(E, x, y, r, k);
        SIGS[el].burst(E, x, y, k * 0.8);
        if (SIGS[el].decal) addDecal(x, y, SIGS[el].decal, r * 0.7);
      }
      comboFx(E, list, x, y, r);
    } else {
      for (const el of list) SIGS[el].burst(E, x, y, k);
      if (list.length > 1) comboFx(E, list, x, y, 0);
      const d = SIGS[list[0]].decal;
      if (d && o.decal !== false) addDecal(x, y + 3, d, 6);
    }
  }

  function dissolve(key, x, y, o = {}) {
    const art = game.art;
    const pixels = art?.getSpritePixels ? art.getSpritePixels(key, o.frame || 0, Math.round(90 * quality + 10)) : [];
    const s = SIGS[elementsOf(o.elements || 'arcane')[0]];
    const flip = o.flip ? -1 : 1;
    for (const p of pixels) {
      const px = x + p.x * flip, py = y + p.y;
      const up = R(10, 40);
      P.spawn(px, py, (px - x) * R(1, 3) + R(-8, 8), -up + (py - y) * 0.6, R(0.5, 1.1), 1, cid(p.c), s.hi, SH.PX, 1.5, -30, F.FADEIN);
    }
    const n = E.n(10);
    for (let i = 0; i < n; i++) P.spawn(x + R(-6, 6), y - R(0, 16), R(-10, 10), R(-40, -10), R(0.6, 1), R(1, 2), s.hi, s.main, SH.GLOW, 1, -20, A | F.SHRINK);
  }

  function shine(x, y, color = '#ffd25a') {
    const n = E.n(26);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      P.spawn(x + Math.cos(a) * 7, y + Math.sin(a) * 3 - R(0, 6), -Math.sin(a) * 8, R(-70, -30), R(0.5, 1), 1.5, '#ffffff', color, SH.STAR, 1.5, -10, A | F.TWINKLE);
    }
    P.spawn(x, y - 8, 0, 0, 0.3, 8, '#ffffff', color, SH.GLOW, 0, 0, A);
    addRing(x, y, 16, color, 0.5, { width: 2 });
    addRing(x, y - 2, 10, '#ffffff', 0.35);
    E.light(x, y - 8, 64, color, 1.4, 0.6);
  }

  // ------------------------------------------------------------- the fx object
  const fx = {
    /**
     * Spawn a particle burst. preset: 'cast','trail','impact','aoe','death','pickup','heal','portal',
     * 'dust','sparkle','hit' (+ 'smoke','ember','snow','rune'); unknown -> 'sparkle'.
     * opts: { element, color, color2, count, angle (rad), spread (rad), speed, life, size, additive }
     */
    emit(presetName, x, y, opts = {}) {
      // with an element and a spell-ish preset, use that element's signature
      if (opts.element && !opts.color && opts.count == null) {
        const s = SIGS[elementsOf(opts.element)[0]];
        const dx = opts.angle != null ? Math.cos(opts.angle) : 1, dy = opts.angle != null ? Math.sin(opts.angle) : 0;
        if (presetName === 'impact') return s.burst(E, x, y, 1);
        if (presetName === 'cast') return s.cast(E, x, y, dx, dy, 1);
        if (presetName === 'trail') return s.trail(E, x, y, -dx, -dy, 0.6);
        if (presetName === 'aoe') { s.nova(E, x, y, 32, 1); return; }
      }
      const p = PRESETS[presetName] || PRESETS.sparkle;
      let c1, c2;
      if (opts.color) { c1 = opts.color; c2 = opts.color2 || opts.color; }
      else if (opts.element) { const s = SIGS[elementsOf(opts.element)[0]]; c1 = s.hi; c2 = s.main; }
      else if (p.colors) [c1, c2] = p.colors;
      else [c1, c2] = [SIGS.arcane.hi, SIGS.arcane.main];
      const n = opts.count != null ? Math.max(opts.count > 0 ? 1 : 0, Math.round(opts.count * quality)) : E.n(p.count);
      const flags = opts.additive === false ? p.flags & ~A : opts.additive === true ? p.flags | A : p.flags;
      for (let i = 0; i < n; i++) {
        const a = opts.angle != null ? opts.angle + (Math.random() - 0.5) * (opts.spread ?? TAU) : Math.random() * TAU;
        const sp = opts.speed ?? R(p.speed[0], p.speed[1]);
        if (!P.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, opts.life ?? R(p.life[0], p.life[1]), opts.size ?? R(p.size[0], p.size[1]),
          Math.random() < 0.5 ? c1 : '#ffffff', Math.random() < 0.6 ? c2 : c1, p.shape, p.drag, p.grav, flags, p.swirl ? R(-p.swirl, p.swirl) : 0)) break;
      }
    },

    /** Expanding ring/shockwave in world space. */
    ring(x, y, radius, color = '#fff', duration = 0.35) { addRing(x, y, radius, color, duration, { width: 1 }); },

    /** Transient light for the next rendered frame. Call every tick to keep it alive. */
    addLight(x, y, radius, color = '#ffffff', intensity = 1) {
      if (pendingLights.length < 96) pendingLights.push({ x, y, radius, color, intensity });
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

    // ---- extended API (see requests/art-fx.md)
    spellCast, spellTrail, spellImpact, dissolve, shine,
    telegraph(x, y, radius, els, duration = 0.6) {
      if (telegraphs.length > 24) telegraphs.shift();
      telegraphs.push({ x, y, r: radius, els: elementsOf(els), t: 0, dur: duration });
    },
    arc(x0, y0, x1, y1, els = 'lightning', o = {}) {
      const isColor = typeof els === 'string' && els[0] === '#';
      const s = isColor ? null : SIGS[elementsOf(els)[0]];
      addArc(x0, y0, x1, y1, isColor ? '#ffffff' : s.core, isColor ? els : s.main, o.life ?? 0.12, o.branches ?? 1);
    },
    decal(x, y, els, radius = 10) {
      const known = ['scorch', 'frost', 'burn', 'glyph', 'crack', 'corrupt'];
      addDecal(x, y, known.includes(els) ? els : SIGS[elementsOf(els)[0]].decal, radius);
    },
    aura(target, els, o = {}) {
      const h = { target, els: elementsOf(els), rate: o.rate ?? 1, until: o.duration ? game.time + o.duration : Infinity, remove: () => auras.delete(h) };
      auras.add(h);
      return h;
    },
    lightPulse(x, y, radius, color = '#ffffff', intensity = 1, duration = 0.3) { E.light(x, y, radius, color, intensity, duration); },
    /** Draw a glowing spell orb (for combat's renderGlow; composite 'lighter' expected). */
    drawSpellOrb(ctx, x, y, els, radius = 3, t = 0) {
      const list = elementsOf(els);
      const X = Math.round(x), Y = Math.round(y);
      for (let i = 0; i < list.length; i++) {
        const s = SIGS[list[i]];
        const r = Math.round(radius * 2.2 + Math.sin(t * 20 + i) * 0.8);
        ctx.drawImage(glowSprite(s.main, r), X - r, Y - r);
      }
      const s0 = SIGS[list[0]];
      ctx.fillStyle = s0.hi;
      ctx.fillRect(X - 1, Y - 1, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(X, Y, 1, 1);
    },
    setQuality(q) { quality = Math.max(0.25, Math.min(qualityCap, q)); P.cap = Math.round(MAX_PARTICLES * quality); },
    /** Upper bound for quality (0.25..1), from settings.particleQuality. */
    setQualityCap(c) { qualityCap = Math.max(0.25, Math.min(1, c)); fx.setQuality(Math.min(quality, qualityCap)); },
    get qualityCap() { return qualityCap; },
    get quality() { return quality; },

    update(dt) {
      frameLights = pendingLights;
      pendingLights = [];
      P.update(dt);
      for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].t += dt) >= rings[i].dur) rings.splice(i, 1);
      for (let i = arcs.length - 1; i >= 0; i--) {
        const a = arcs[i];
        a.life -= dt;
        if (a.life <= 0) { arcs.splice(i, 1); continue; }
        if ((a.re += dt) > 0.035) { a.re = 0; jag(a.x0, a.y0, a.x1, a.y1, a.pts); }
      }
      for (let i = decals.length - 1; i >= 0; i--) if ((decals[i].t += dt) >= decals[i].dur) decals.splice(i, 1);
      for (let i = telegraphs.length - 1; i >= 0; i--) if ((telegraphs[i].t += dt) >= telegraphs[i].dur) telegraphs.splice(i, 1);
      for (let i = pulses.length - 1; i >= 0; i--) if ((pulses[i].t += dt) >= pulses[i].dur) pulses.splice(i, 1);
      for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; if ((tm.t -= dt) <= 0) { timers.splice(i, 1); try { tm.fn(); } catch (err) { console.warn('[fx] timer', err); } } }
      for (const h of attached) if (h.target.dead) attached.delete(h);
      if (flash.t > 0) flash.t = Math.max(0, flash.t - dt);
      dmgVignette = Math.max(0, dmgVignette - dt * 1.6);
      observeEntities(dt);
      for (const h of auras) {
        if (h.target.dead || game.time > h.until) { auras.delete(h); continue; }
        if (!game.camera.isVisible(h.target.x, h.target.y, 24)) continue;
        for (const el of h.els) SIGS[el].aura(E, h.target.x, h.target.y, h.rate);
      }
      for (let i = statusAuras.length - 1; i >= 0; i--) {
        const s = statusAuras[i];
        if (s.target.dead || game.time > s.until) { statusAuras.splice(i, 1); continue; }
        if (game.camera.isVisible(s.target.x, s.target.y, 24)) SIGS[s.el].aura(E, s.target.x, s.target.y, 0.8);
      }
      ambient(dt);
      tileEmitters(dt);
    },

    /** Ground decals / telegraphs under entities (world space). */
    renderGround(ctx, camera) {
      game.art?.clearGlow?.(); // entities are about to draw: start a fresh emissive queue
      for (const d of decals) {
        const k = d.t / d.dur;
        if (!camera.isVisible(d.x, d.y, d.r + 4)) continue;
        const spr = decalSprite(d.type, d.r);
        ctx.globalAlpha = Math.min(1, (1 - k) * 2) * (d.t < 0.1 ? d.t / 0.1 : 1);
        ctx.drawImage(spr, Math.round(d.x - spr.width / 2), Math.round(d.y - spr.height / 2));
      }
      ctx.globalAlpha = 1;
      // AoE telegraph fills (explicit + combat AoE entities still charging)
      forEachTelegraph((x, y, r, prog, color) => {
        ctx.globalAlpha = 0.12 + prog * 0.18;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), r * prog, r * prog * 0.85, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.ellipse(Math.round(x), Math.round(y), r, r * 0.85, 0, 0, TAU); ctx.fill();
      });
      ctx.globalAlpha = 1;
    },

    /** Darkness + light mask (SCREEN space). ambient: {darkness 0..1, color} or null.
     *  The darkness mask and the coloured tint are soft radial falloffs, so they are rasterised in
     *  JS into 1/LIGHT_DIV-resolution float buffers (same falloff curves as the old cached gradient
     *  sprites), uploaded with putImageData, smoothed up 2x and blitted at 1/2 resolution: two
     *  full-screen blits per frame instead of two scaled, filtered drawImage calls per light. */
    renderLighting(ctx, camera, ambient) {
      const darkness = ambient?.darkness ?? 0;
      const W = camera.viewW, H = camera.viewH;
      const L = camera.left, T = camera.top;
      const nl = collectLights(camera, game.time);
      const lb = lightBuffers(W, H);
      const { lw, lh, dark, tr, tg, tb } = lb;
      const k = 1 / LIGHT_DIV;
      const N = lw * lh;
      const doDark = darkness > 0;
      if (doDark) dark.fill(1);
      tr.fill(0); tg.fill(0); tb.fill(0);
      const tintK = doDark ? 0.2 + darkness * 0.12 : 0.12;
      let anyTint = false;
      for (let li = 0; li < nl; li++) {
        const l = lightPool[li];
        const sx = l.x - L, sy = l.y - T, r = l.radius;
        if (!(r > 0) || sx < -r || sy < -r || sx > W + r || sy > H + r) continue;
        const xl = sx * k - 0.5, yl = sy * k - 0.5; // light centre in buffer pixel-centre coordinates
        if (doDark) {
          const a = Math.min(1, l.intensity);
          if (a > 0) stamp(lb, xl, yl, r * 1.25 * k, MASK_LUT, a, dark, null, null, 0, 0, 0);
        }
        const g = Math.min(1, tintK * l.intensity);
        if (g > 0) {
          const c = rgbCached(l.color || '#ffffff');
          stamp(lb, xl, yl, r * k, TINT_LUT, g, null, tr, tg, tb, c);
          anyTint = true;
        }
      }
      const DW = lw * LIGHT_DIV, DH = lh * LIGHT_DIV;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      if (doDark) {
        const [R, G, B] = rgbCached(ambient.color || '#05030a');
        const d = lb.darkImg.data, A = darkness * 255;
        for (let i = 0, j = 0; i < N; i++, j += 4) { d[j] = R; d[j + 1] = G; d[j + 2] = B; d[j + 3] = A * dark[i]; }
        ctx.drawImage(upscale(lb, lb.darkImg), 0, 0, DW, DH);
      }
      if (anyTint) {
        const d = lb.tintImg.data;
        for (let i = 0, j = 0; i < N; i++, j += 4) { d[j] = tr[i]; d[j + 1] = tg[i]; d[j + 2] = tb[i]; d[j + 3] = 255; }
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(upscale(lb, lb.tintImg), 0, 0, DW, DH);
      }
      ctx.imageSmoothingEnabled = smooth;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    /** Particles, rings, arcs and emissive sprite layers (world space, after lighting). */
    renderWorld(ctx, camera) {
      measure();
      const art = game.art;
      // emissive sprite pixels (eyes, runes, gems) glow through the darkness
      const dark = game.level?.ambient?.darkness ?? 0;
      art?.flushGlow?.(ctx, 0.55 + dark * 0.6);
      const left = camera.left, top = camera.top, right = left + camera.viewW, bottom = top + camera.viewH;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // projectile halos
      for (const e of game.entities.list) {
        if (e.dead || !e.tags.has('projectile') || e.noAutoFx) continue;
        if (e.rx < left - 8 || e.rx > right + 8 || e.ry < top - 8 || e.ry > bottom + 8) continue;
        const list = elementsOf(e.spell?.elements?.length ? e.spell.elements : e.element);
        const r = Math.round((e.radius || 3) * 2.4 + Math.sin(game.time * 25 + e.id) * 0.8);
        for (const el of list) {
          ctx.globalAlpha = 0.7 / Math.sqrt(list.length);
          ctx.drawImage(glowSprite(SIGS[el].main, r), Math.round(e.rx) - r, Math.round(e.ry - (e.drawHeight ?? 0)) - r);
        }
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = SIGS[list[0]].core;
        ctx.fillRect(Math.round(e.rx) - 1, Math.round(e.ry - (e.drawHeight ?? 0)) - 1, 2, 2);
      }
      // telegraph rims
      forEachTelegraph((x, y, r, prog, color, hi) => {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(game.time * 18);
        ctx.strokeStyle = hi;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(Math.round(x) + 0.5, Math.round(y) + 0.5, r, r * 0.85, 0, 0, TAU); ctx.stroke();
        // rotating rune ticks
        const n = 8;
        ctx.fillStyle = hi;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + game.time * 2;
          ctx.fillRect(Math.round(x + Math.cos(a) * r * prog), Math.round(y + Math.sin(a) * r * 0.85 * prog), 2, 1);
        }
      });
      // rings
      for (const r of rings) {
        if (r.t < 0) continue;
        const k = r.t / r.dur;
        const e = 1 - (1 - k) * (1 - k);
        const rad = r.implode ? r.radius * (1 - e) + 1 : r.radius * (0.15 + 0.85 * e);
        const w = Math.max(1, Math.round(r.width * (1 - k * 0.6)));
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = r.rainbow ? `hsl(${(game.time * 400) % 360},100%,70%)` : r.color;
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.ellipse(Math.round(r.x), Math.round(r.y), rad, rad * 0.85, 0, 0, TAU); ctx.stroke();
        ctx.globalAlpha = (1 - k) * 0.25;
        ctx.lineWidth = w + 2;
        ctx.stroke();
      }
      // lightning arcs: soft glow pass + crisp core
      for (const a of arcs) {
        const k = a.life / a.max;
        ctx.globalAlpha = 0.35 * k;
        ctx.strokeStyle = a.c2;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.pts[0], a.pts[1]);
        for (let i = 2; i < a.pts.length; i += 2) ctx.lineTo(a.pts[i], a.pts[i + 1]);
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = a.c1;
        for (let i = 0; i < a.pts.length - 2; i += 2) pxLine(ctx, a.pts[i], a.pts[i + 1], a.pts[i + 2], a.pts[i + 3]);
      }
      ctx.restore();
      P.render(ctx, left, top, right, bottom, game.time);
    },

    /** Screen-space overlays (vignette, damage pulse, low-HP heartbeat, flash). */
    renderScreen(ctx) {
      const W = game.display.width, H = game.display.height;
      art_clearGlowIfMenu();
      if (game.isGameplay?.() && game.level) {
        const dark = game.level.ambient?.darkness ?? 0;
        const base = levelKind === 'hub' ? 0.28 : 0.35 + dark * 0.35;
        ctx.globalAlpha = base;
        ctx.drawImage(vignetteSprite(W, H, game.level.ambient?.color || '#05030a'), 0, 0);
        const st = game.state?.player;
        let red = dmgVignette;
        if (st && st.maxHp > 0 && st.hp > 0 && st.hp / st.maxHp < 0.3) {
          const k = 1 - st.hp / (st.maxHp * 0.3);
          red = Math.max(red, k * (0.35 + 0.25 * Math.sin(game.realTime * 6)));
        }
        if (red > 0.01) {
          ctx.globalAlpha = Math.min(0.85, red);
          ctx.drawImage(vignetteSprite(W, H, '#c0102a'), 0, 0);
        }
        ctx.globalAlpha = 1;
      }
      if (flash.t > 0) {
        ctx.globalAlpha = flash.alpha * (flash.t / flash.dur);
        ctx.fillStyle = flash.color;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },

    clear() {
      P.clear();
      rings.length = 0; arcs.length = 0; decals.length = 0; telegraphs.length = 0; pulses.length = 0; timers.length = 0;
      statusAuras.length = 0;
      auras.clear();
      pendingLights = [];
      frameLights = [];
      attached.clear();
      flash.t = 0;
      dmgVignette = 0;
      emitters = [];
      staticLights = [];
    },

    count() {
      return P.n;
    },
  };

  function art_clearGlowIfMenu() {
    if (!game.isGameplay?.()) game.art?.clearGlow?.();
  }

  // ------------------------------------------------------------- helpers
  function pxLine(ctx, x0, y0, x1, y1) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let i = 0; i < 64; i++) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function forEachTelegraph(fn) {
    for (const tg of telegraphs) {
      const s = SIGS[tg.els[0]];
      fn(tg.x, tg.y, tg.r, Math.min(1, tg.t / tg.dur), s.main, s.hi);
    }
    for (const e of game.entities.list) {
      if (e.dead || !e.tags.has('aoe') || e.fired || !(e.delay > 0) || e.noAutoFx) continue;
      const s = SIGS[elementsOf(e.spell?.elements?.length ? e.spell.elements : e.element)[0]];
      fn(e.x, e.y, e.radius || 24, Math.min(1, (e.age || 0) / e.delay), s.main, s.hi);
    }
  }

  // ------------------------------------------------------------- lighting buffers (renderLighting)
  /** Quarter-res float accumulators + ImageData + a half-res smoothing canvas, (re)made on resize. */
  function lightBuffers(W, H) {
    const lw = Math.ceil(W / LIGHT_DIV) + 1, lh = Math.ceil(H / LIGHT_DIV) + 1;
    if (lightBuf && lightBuf.lw === lw && lightBuf.lh === lh) return lightBuf;
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const small = mk(lw, lh), mid = mk(lw * 2, lh * 2);
    const sctx = small.getContext('2d'), mctx = mid.getContext('2d');
    mctx.imageSmoothingEnabled = true;
    mctx.globalCompositeOperation = 'copy';
    const N = lw * lh;
    lightBuf = {
      lw, lh, small, sctx, mid, mctx,
      dark: new Float32Array(N), tr: new Float32Array(N), tg: new Float32Array(N), tb: new Float32Array(N),
      darkImg: sctx.createImageData(lw, lh), tintImg: sctx.createImageData(lw, lh),
      mids: [mid, mk(lw * 2, lh * 2)], flip: 0,
    };
    lightBuf.mids[1].getContext('2d').imageSmoothingEnabled = true;
    return lightBuf;
  }
  /** Upload a quarter-res ImageData and smooth it up 2x (bilinear); returns the half-res canvas. */
  function upscale(lb, img) {
    lb.sctx.putImageData(img, 0, 0);
    const mid = lb.mids[lb.flip ^= 1];
    const mc = mid.getContext('2d');
    mc.globalCompositeOperation = 'copy';
    mc.drawImage(lb.small, 0, 0, mid.width, mid.height);
    return mid;
  }
  /** Add one radial light to the buffers. rad in buffer px; lut indexed by (d/rad)^2.
   *  Darkness: dark *= 1 - lut*a (destination-out). Tint: t += colour * lut * a (additive). */
  function stamp(lb, xl, yl, rad, lut, a, dark, tr, tg, tb, c) {
    const { lw, lh } = lb;
    const i0 = Math.max(0, Math.ceil(xl - rad)), i1 = Math.min(lw - 1, Math.floor(xl + rad));
    const j0 = Math.max(0, Math.ceil(yl - rad)), j1 = Math.min(lh - 1, Math.floor(yl + rad));
    if (i0 > i1 || j0 > j1) return;
    const inv = LUT_N / (rad * rad);
    const cr = c ? c[0] * a : 0, cg = c ? c[1] * a : 0, cb = c ? c[2] * a : 0;
    for (let j = j0; j <= j1; j++) {
      const dy = j - yl, dy2 = dy * dy * inv;
      let idx = j * lw + i0;
      for (let i = i0; i <= i1; i++, idx++) {
        const dx = i - xl;
        const q = (dx * dx * inv + dy2) | 0;
        if (q >= LUT_N) continue;
        const v = lut[q];
        if (dark) dark[idx] *= 1 - v * a;
        else { tr[idx] += cr * v; tg[idx] += cg * v; tb[idx] += cb * v; }
      }
    }
  }

  /** Fills lightPool with this frame's lights; returns the count (no per-frame allocations). */
  function collectLights(camera, t) {
    let n = 0;
    const put = (x, y, radius, color, intensity) => {
      const l = lightPool[n] || (lightPool[n] = { x: 0, y: 0, radius: 0, color: '', intensity: 0 });
      l.x = x; l.y = y; l.radius = radius; l.color = color; l.intensity = intensity;
      n++;
    };
    for (const l of frameLights) put(l.x, l.y, l.radius, l.color, l.intensity);
    for (const h of attached) put(h.target.x, h.target.y - 4, h.radius, h.color, h.intensity);
    for (const p of pulses) {
      const k = 1 - p.t / p.dur;
      put(p.x, p.y, p.r * (0.7 + 0.3 * k), p.color, p.i * k);
    }
    for (const s of staticLights) {
      if (!camera.isVisible(s.x, s.y, s.radius)) continue;
      const fl = s.flicker ? 0.88 + 0.07 * Math.sin(t * 11 + s.ph) + 0.05 * Math.sin(t * 23 + s.ph * 3) : 0.95 + 0.05 * Math.sin(t * 1.5 + s.ph);
      put(s.x, s.y, s.radius * fl, s.color, s.intensity * (s.flicker ? 0.9 + 0.1 * Math.sin(t * 17 + s.ph) : 1));
    }
    return n;
  }

  function measure() {
    const now = performance.now();
    if (lastFrame) {
      const dt = Math.min(100, now - lastFrame);
      frameEma = frameEma * 0.95 + dt * 0.05;
      if (frameEma > 21) fx.setQuality(quality - 0.01);
      else if (frameEma < 17.5 && quality < qualityCap) fx.setQuality(quality + 0.002);
    }
    lastFrame = now;
  }

  // ------------------------------------------------------------- entity observation (auto visuals)
  function observeEntities(dt) {
    const cam = game.camera;
    const p = game.player;
    for (const e of game.entities.list) {
      if (e.dead || e.noAutoFx) continue;
      const tags = e.tags;
      if (tags.has('projectile')) {
        if (!cam.isVisible(e.x, e.y, 16)) continue;
        const els = e.spell?.elements?.length ? e.spell.elements : e.element;
        spellTrail(els, 'projectile', e.x, e.y - (e.drawHeight ?? 0), { dirX: e.vx || e.dirX || 0, dirY: e.vy || e.dirY || 0, power: e.spell?.tier >= 2 ? 1.25 : 1 });
        continue;
      }
      if (tags.has('enemy') && !tags.has('boss')) {
        if (!cam.isVisible(e.x, e.y, 20)) continue;
        const key = e.def?.sprite || '';
        const el = e.element || e.def?.element;
        const r = Math.random() / quality;
        if (key.includes('wisp')) {
          const s = SIGS[elementsOf(el)[0]];
          if (r < 0.5) P.spawn(e.x + R(-2, 2), e.y - 8 + R(-2, 2), R(-6, 6), R(-14, -4), R(0.3, 0.6), R(1, 2), s.hi, s.main, SH.GLOW, 2, -10, A | F.SHRINK);
        } else if (key.includes('golem')) {
          if (r < 0.06) {
            if (el === 'fire' || key.includes('ember')) P.spawn(e.x + R(-6, 6), e.y - R(8, 18), R(-4, 4), R(-20, -8), R(0.5, 0.9), R(1, 1.6), '#ffd25a', '#ff4a10', SH.GLOW, 1, -20, A | F.FLICKER | F.SHRINK);
            else if (el === 'ice' || key.includes('frost')) P.spawn(e.x + R(-8, 8), e.y - R(10, 20), R(-3, 3), R(4, 10), R(0.8, 1.2), 1, '#ffffff', '#9af0ff', SH.STAR, 0.5, 6, A | F.TWINKLE);
            else if (key.includes('crystal')) P.spawn(e.x + R(-8, 8), e.y - R(8, 20), 0, R(-8, -2), R(0.5, 0.8), 1, '#ffffff', '#ff7af0', SH.STAR, 1, 0, A | F.TWINKLE);
            else P.spawn(e.x + R(-6, 6), e.y - R(0, 4), R(-6, 6), R(-4, 0), R(0.4, 0.7), R(1.5, 2.5), '#8a8070', '#5a5048', SH.SMOKE, 2, -2, F.GROW);
          }
        } else if (key.includes('knight') || key.includes('lancer') || key.includes('sentinel')) {
          if (r < 0.05) P.spawn(e.x + R(-3, 3), e.y - R(14, 18), R(-4, 4), R(-10, -4), R(0.5, 0.9), 1, '#e0fbff', '#3ac8e8', SH.MOTE, 1, -6, A);
        }
        continue;
      }
      if (tags.has('boss')) {
        if (!cam.isVisible(e.x, e.y, 32)) continue;
        SIGS.corrupt.aura(E, e.x, e.y - 4, (e.phase || 1) >= 2 ? 1.6 : 1);
        fx.addLight(e.x, e.y - 14, (e.phase || 1) >= 2 ? 72 : 56, (e.phase || 1) >= 2 ? '#7aff5a' : '#b05aff', 0.8);
      }
    }
    // player footsteps
    if (p && !p.dead) {
      const moved = Math.hypot(p.x - lastPX, p.y - lastPY);
      lastPX = p.x; lastPY = p.y;
      if (moved > 0.4 && moved < 8) {
        footAcc += dt;
        if (footAcc > 0.24) {
          footAcc = 0;
          const map = game.level?.map;
          const g = map ? map.getGround(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)) : 0;
          const col = g === TILE.GRASS || g === TILE.GRASS_FLOWERS ? ['#74c050', '#2a6e30'] : g === TILE.SAND ? ['#e0c890', '#a08050'] : g === TILE.ICE_FLOOR ? ['#ffffff', '#a8d8f4'] : ['#a89a88', '#6a6070'];
          for (let i = 0; i < 2; i++) P.spawn(p.x + R(-3, 3), p.y, R(-10, 10), R(-8, -2), R(0.25, 0.45), R(1.5, 2.5), col[0], col[1], g === TILE.GRASS || g === TILE.GRASS_FLOWERS ? SH.PX : SH.SMOKE, 3, 20, g === TILE.GRASS || g === TILE.GRASS_FLOWERS ? 0 : F.GROW);
        }
      }
    }
  }

  // ------------------------------------------------------------- ambient life
  function ambient(dt) {
    if (!game.level || !levelKind) return;
    const cam = game.camera;
    const area = cam.viewW * cam.viewH;
    const rate = (area / 2600) * quality; // particles per second
    ambientAcc += dt * rate;
    let n = Math.floor(ambientAcc);
    ambientAcc -= n;
    if (P.n > P.cap * 0.7) n = 0;
    const L = cam.left, T = cam.top, W = cam.viewW, H = cam.viewH;
    for (let i = 0; i < n; i++) {
      const x = L + Math.random() * W, y = T + Math.random() * H;
      switch (levelKind) {
        case 'hub':
          if (Math.random() < 0.55) P.spawn(x, y, R(-6, 6), R(-6, 6), R(2.5, 4.5), 1, '#fff8a0', '#c8ff5a', SH.MOTE, 0.2, -1, A | F.FADEIN | F.WOBBLE | F.TWINKLE);
          else if (Math.random() < 0.5) P.spawn(x, y, R(4, 10), R(2, 6), R(3, 5), 1, '#fff4f8', '#ffb0d0', SH.PX, 0, 0, F.FADEIN | F.WOBBLE);
          else P.spawn(x, y, R(-3, 3), R(-4, -1), R(3, 5), 1, '#ffffff', '#d0c8ff', SH.MOTE, 0, 0, A | F.FADEIN);
          break;
        case 'tower':
          if (Math.random() < 0.08) P.spawn(x, y, R(-2, 2), R(-8, -3), R(2, 3.5), 1, '#a070e0', '#5a3aa0', SH.RUNE, 0, 0, A | F.FADEIN);
          else if (Math.random() < 0.5) P.spawn(x, y, R(-3, 3), R(-6, -2), R(2, 4), 0.6, '#ffffff', '#b08aff', SH.STAR, 0, 0, A | F.FADEIN | F.TWINKLE);
          else P.spawn(x, y, R(-2, 2), R(-6, -2), R(2.5, 4), 1, '#9a7ad8', '#5a3aa0', SH.MOTE, 0, 0, A | F.FADEIN);
          break;
        case 'boss':
          if (Math.random() < 0.5) P.spawn(x, y - 20, R(-6, 2), R(8, 18), R(2, 4), 1, '#5a4a60', '#2a2030', SH.PX, 0, 0, F.FADEIN | F.WOBBLE);
          else P.spawn(x, y, R(-4, 4), R(-10, -3), R(2, 3.5), 1, Math.random() < 0.5 ? '#7aff5a' : '#c05aff', '#3a0a4a', SH.MOTE, 0, 0, A | F.FADEIN);
          break;
        default: { // dungeon by theme
          if (levelTheme === 'magma') P.spawn(x, y, R(-5, 5), R(-18, -6), R(1.5, 3), R(1, 1.6), '#ffd25a', '#ff4a10', SH.GLOW, 0.3, -4, A | F.FADEIN | F.FLICKER);
          else if (levelTheme === 'frost') P.spawn(x, y - 30, R(-6, 2), R(8, 16), R(3, 5), 1, '#ffffff', '#9af0ff', SH.STAR, 0, 0, A | F.FADEIN | F.WOBBLE);
          else if (levelTheme === 'crystal') P.spawn(x, y, R(-2, 2), R(-4, 4), R(1.5, 3), 1, '#ffffff', Math.random() < 0.5 ? '#5ad8ff' : '#ff7af0', SH.STAR, 0, 0, A | F.FADEIN | F.TWINKLE);
          else if (Math.random() < 0.5) P.spawn(x, y, R(-3, 3), R(-3, 3), R(3, 5), 1, '#6a645a', '#3a3632', SH.PX, 0, 0, A | F.FADEIN | F.WOBBLE);
          else P.spawn(x, y, R(-2, 2), R(-6, -2), R(2.5, 4), 1, '#5aa880', '#1e5a40', SH.MOTE, 0, 0, A | F.FADEIN);
        }
      }
    }
  }

  function tileEmitters(dt) {
    if (!emitters.length) return;
    const cam = game.camera;
    const q = quality * dt;
    for (const em of emitters) {
      if (!cam.isVisible(em.x, em.y, 16)) continue;
      const r = Math.random();
      switch (em.kind) {
        case 'torch':
          if (r < 3 * q) P.spawn(em.x + R(-1, 1), em.y - 4, R(-4, 4), R(-28, -14), R(0.4, 0.8), 1, '#ffd25a', '#ff4a10', SH.GLOW, 1, -10, A | F.FLICKER | F.SHRINK);
          if (r > 1 - 0.6 * q) P.spawn(em.x, em.y - 8, R(-2, 2), R(-12, -6), R(0.8, 1.4), R(1.5, 2.5), '#3a3036', '#1a1418', SH.SMOKE, 0.5, -4, F.GROW);
          break;
        case 'brazier':
          if (r < 6 * q) P.spawn(em.x + R(-3, 3), em.y - 6, R(-6, 6), R(-36, -16), R(0.5, 1), R(1, 1.8), '#ffd25a', '#ff4a10', SH.GLOW, 1, -12, A | F.FLICKER | F.SHRINK);
          break;
        case 'lava':
          if (r < 0.5 * q) P.spawn(em.x + R(-7, 7), em.y + R(-7, 7), R(-4, 4), R(-24, -8), R(0.6, 1.2), R(1, 1.6), '#ffd25a', '#ff4a10', SH.GLOW, 0.8, -6, A | F.FLICKER | F.SHRINK);
          break;
        case 'crystal':
          if (r < 1.2 * q) P.spawn(em.x + R(-5, 5), em.y + R(-10, 2), 0, R(-6, -2), R(0.4, 0.8), 1, '#ffffff', em.color, SH.STAR, 1, 0, A | F.TWINKLE);
          break;
        case 'mushroom':
          if (r < 0.8 * q) P.spawn(em.x + R(-5, 5), em.y + R(-2, 4), R(-2, 2), R(-8, -3), R(1.2, 2), 1, '#c8fff0', em.color, SH.MOTE, 0.2, -2, A | F.FADEIN | F.WOBBLE);
          break;
        case 'fountain':
          if (r < 5 * q) P.spawn(em.x + R(-1, 1), em.y - 6, R(-14, 14), R(-26, -14), R(0.5, 0.7), 1, '#ffffff', '#5aaee8', SH.PX, 0.5, 70, 0);
          break;
        case 'cauldron':
          if (r < 2 * q) P.spawn(em.x + R(-4, 4), em.y - 6, R(-2, 2), R(-14, -6), R(0.6, 1), 1, '#c8ffb0', '#3aa01e', SH.GLOW, 0.5, -4, A | F.SHRINK);
          if (r > 1 - 0.8 * q) P.spawn(em.x, em.y - 8, R(-3, 3), R(-10, -5), R(1, 1.6), R(2, 3), '#7ac86a', '#2a5a2a', SH.SMOKE, 0.5, -3, F.GROW);
          break;
        case 'rune':
          if (r < 0.5 * q) P.spawn(em.x + R(-6, 6), em.y + R(-6, 6), 0, R(-12, -5), R(0.8, 1.4), 1, '#ffffff', em.color, SH.MOTE, 0.3, -3, A | F.FADEIN);
          break;
        case 'candle':
          if (r < 0.4 * q) P.spawn(em.x + R(-3, 3), em.y - 6, R(-1, 1), R(-8, -4), R(0.8, 1.2), 1, '#504848', '#302828', SH.SMOKE, 0.5, -2, F.GROW);
          break;
        case 'poison':
          if (r < 0.25 * q) P.spawn(em.x + R(-6, 6), em.y + R(-6, 6), R(-2, 2), R(-10, -4), R(0.6, 1), 1, '#e0ff9a', '#6ab02a', SH.MOTE, 0.5, -4, A | F.FADEIN);
          break;
      }
    }
  }

  // ------------------------------------------------------------- automatic reactions to gameplay events
  const { bus } = game;
  const spellOf = (id) => { try { return game.combat?.getSpell?.(id) || game.combat?.SPELLS?.[id] || null; } catch { return null; } };

  bus.on(EV.SCREEN_FLASH, ({ color, duration, alpha } = {}) => fx.flash(color, duration, alpha));
  bus.on(EV.SPELL_CAST, ({ x, y, spell, spellId, dirX, dirY, caster } = {}) => {
    const sp = spell || spellOf(spellId);
    const els = sp ? (sp.elements?.length ? sp.elements : [sp.element]) : 'arcane';
    const boss = caster?.tags?.has?.('boss');
    spellCast(boss ? ['corrupt', ...elementsOf(els).filter((e) => e !== 'arcane')] : els, sp?.kind || 'projectile', x ?? caster?.x ?? 0, y ?? (caster ? caster.y - 6 : 0), { dirX, dirY, power: caster?.tags?.has?.('player') ? 1 : 0.7 });
  });
  bus.on(EV.PROJECTILE_HIT, ({ x, y, element, projectile, target } = {}) => {
    const sp = projectile?.spell;
    const els = sp?.elements?.length ? sp.elements : element;
    spellImpact(els, 'projectile', x, y, { power: target ? 1 : 0.7, decal: !!target || Math.random() < 0.5 });
  });
  bus.on(EV.AOE_TRIGGERED, ({ x, y, radius, element, spellId } = {}) => {
    const sp = spellOf(spellId);
    const els = sp?.elements?.length ? sp.elements : element;
    spellImpact(els, sp?.kind === 'nova' ? 'nova' : 'aoe', x, y, { radius: radius || 32 });
  });
  bus.on(EV.ENTITY_DAMAGED, ({ x, y, element, crit, target } = {}) => {
    const s = SIGS[elementsOf(element || 'physical')[0]];
    const hx = x ?? target?.x ?? 0, hy = (y ?? target?.y ?? 0) - 6;
    const n = E.n(crit ? 12 : 6);
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = R(60, 150); P.spawn(hx, hy, Math.cos(a) * sp, Math.sin(a) * sp, R(0.08, 0.2), 1, '#ffffff', s.hi, SH.SPARK, 6, 40, A); }
    P.spawn(hx, hy, 0, 0, crit ? 0.18 : 0.1, crit ? 5 : 3, '#ffffff', s.hi, SH.STAR, 0, 0, A);
    if (crit) addRing(hx, hy, 10, '#ffffff', 0.2);
  });
  bus.on(EV.ENTITY_KILLED, ({ x, y, target } = {}) => {
    if (!target) return;
    const key = target.def?.sprite || target.sprite;
    const el = target.element || target.def?.element || 'arcane';
    const isBoss = target.tags?.has?.('boss');
    if (key && !isBoss) dissolve(key, x, y, { flip: target.facing < 0, elements: el });
    const s = SIGS[elementsOf(el)[0]];
    s.burst(E, x, y - 8, isBoss ? 3 : 0.8);
    addRing(x, y - 4, isBoss ? 48 : 18, s.hi, 0.45, { width: 2 });
    E.light(x, y - 8, isBoss ? 120 : 52, s.light, 1.3, 0.5);
    if (target.def?.sprite?.includes('golem')) for (let i = 0; i < E.n(10); i++) P.spawn(x + R(-6, 6), y - R(4, 16), R(-50, 50), R(-80, -20), R(0.6, 1), R(1.5, 2.5), '#8a8070', '#3a3430', SH.CHUNK, 1, 220, F.BOUNCE);
  });
  bus.on(EV.PICKUP_COLLECTED, ({ x, y, element, kind } = {}) => {
    if (kind === 'fragment' || element) {
      const s = SIGS[elementsOf(element || 'arcane')[0]];
      const n = E.n(18);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        P.spawn(x + Math.cos(a) * 6, y - 6 + Math.sin(a) * 3, -Math.sin(a) * 40, Math.cos(a) * 18 - 30, R(0.5, 0.8), 1.5, '#ffffff', s.hi, SH.STAR, 2, -30, A | F.TWINKLE, 6);
      }
      P.spawn(x, y - 6, 0, 0, 0.25, 7, '#ffffff', s.main, SH.GLOW, 0, 0, A);
      addRing(x, y - 4, 14, s.hi, 0.4, { width: 2 });
      E.light(x, y - 6, 56, s.light, 1.3, 0.4);
    } else if (kind === 'health') {
      fx.emit('heal', x, y - 6, { count: 16, color: '#ffb0c0', color2: '#ff3a5a' });
      addRing(x, y - 4, 12, '#ff6a8a', 0.35);
    } else if (kind === 'mana') {
      fx.emit('heal', x, y - 6, { count: 16, color: '#b0d8ff', color2: '#3a8aff' });
      addRing(x, y - 4, 12, '#5aaeff', 0.35);
    } else {
      shine(x, y, '#ffd25a');
    }
  });
  bus.on(EV.PLAYER_HEALED, () => {
    const p = game.player;
    if (!p) return;
    for (let i = 0; i < E.n(20); i++) { const a = Math.random() * TAU; P.spawn(p.x + Math.cos(a) * 7, p.y - R(0, 8), 0, R(-40, -15), R(0.6, 1), 1.5, '#e0ffe8', '#5aff8a', SH.STAR, 1, -10, A | F.TWINKLE); }
    addRing(p.x, p.y, 14, '#7affa8', 0.4, { width: 2 });
    E.light(p.x, p.y - 6, 48, '#7affa8', 1, 0.4);
  });
  bus.on(EV.PLAYER_DAMAGED, ({ element } = {}) => {
    dmgVignette = Math.min(0.9, dmgVignette + 0.55);
    fx.flash('#ff2040', 0.1, 0.12);
    const p = game.player;
    if (p) {
      const s = SIGS[elementsOf(element || 'physical')[0]];
      for (let i = 0; i < E.n(8); i++) { const a = Math.random() * TAU, sp = R(60, 140); P.spawn(p.x, p.y - 8, Math.cos(a) * sp, Math.sin(a) * sp, R(0.08, 0.2), 1, '#ffffff', s.hi === '#ffffff' ? '#ff6a6a' : s.hi, SH.SPARK, 6, 40, A); }
    }
  });
  bus.on(EV.PLAYER_DIED, () => {
    const p = game.player;
    if (!p) return;
    timers.push({ t: 0.3, fn: () => dissolve('player', p.x, p.y, { elements: 'arcane', flip: (p.facingX ?? 1) < 0 }) });
    addRing(p.x, p.y - 6, 30, '#c08aff', 0.6, { width: 2 });
  });
  const arrive = () => {
    const p = game.player;
    if (!p) return;
    for (let i = 0; i < E.n(24); i++) { const a = Math.random() * TAU, d = R(8, 18); P.spawn(p.x + Math.cos(a) * d, p.y - 6 + Math.sin(a) * d * 0.6, -Math.cos(a) * d * 2.5, -Math.sin(a) * d * 1.5, R(0.35, 0.5), 1.5, '#ffffff', '#b08aff', SH.STAR, 0.5, 0, A | F.TWINKLE); }
    addRing(p.x, p.y, 18, '#c08aff', 0.45, { implode: true, width: 2 });
    E.light(p.x, p.y - 6, 64, '#c08aff', 1.2, 0.5);
  };
  bus.on(EV.PLAYER_SPAWNED, () => timers.push({ t: 0.05, fn: arrive }));
  bus.on(EV.PLAYER_RESPAWNED, () => timers.push({ t: 0.1, fn: arrive }));
  const shinePlayer = (color) => () => { const p = game.player; if (p && game.isGameplay?.()) shine(p.x, p.y, color); };
  bus.on(EV.EQUIPMENT_CHANGED, shinePlayer('#ffd25a'));
  bus.on(EV.SPELL_CRAFTED, shinePlayer('#c08aff'));
  bus.on(EV.DUNGEON_CLEARED, shinePlayer('#7affc8'));
  bus.on(EV.TOWER_FLOOR_CLEARED, shinePlayer('#c08aff'));
  bus.on(EV.STATUS_APPLIED, ({ target, status } = {}) => {
    if (!target || !status) return;
    const type = status.type || '';
    const el = /burn|ignite|fire/.test(type) ? 'fire' : /chill|freeze|frost|slow/.test(type) ? 'ice' : /shock|stun|static/.test(type) ? 'lightning' : /poison|root/.test(type) ? 'earth' : /curse|corrupt|weak/.test(type) ? 'corrupt' : null;
    if (!el) return;
    const until = game.time + Math.min(10, status.duration || 1);
    const ex = statusAuras.find((s) => s.target === target && s.el === el);
    if (ex) ex.until = Math.max(ex.until, until);
    else if (statusAuras.length < 64) statusAuras.push({ target, el, until });
    if (el === 'ice') addRing(target.x, target.y - 6, 10, '#e6fbff', 0.3);
  });
  bus.on(EV.STATUS_EXPIRED, ({ target, status } = {}) => {
    for (let i = statusAuras.length - 1; i >= 0; i--) if (statusAuras[i].target === target && (!status || statusAuras[i].el)) {
      const type = status?.type || '';
      const el = /burn|ignite|fire/.test(type) ? 'fire' : /chill|freeze|frost|slow/.test(type) ? 'ice' : /shock|stun|static/.test(type) ? 'lightning' : /poison|root/.test(type) ? 'earth' : 'corrupt';
      if (statusAuras[i].el === el) statusAuras.splice(i, 1);
    }
  });
  bus.on(EV.BOSS_SPAWNED, ({ boss } = {}) => {
    if (!boss) return;
    SIGS.corrupt.nova(E, boss.x, boss.y - 10, 40, 1.5);
    fx.flash('#7a2aa8', 0.4, 0.35);
  });
  bus.on(EV.BOSS_PHASE, ({ boss } = {}) => {
    if (!boss) return;
    SIGS.corrupt.nova(E, boss.x, boss.y - 10, 72, 2);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; addArc(boss.x, boss.y - 14, boss.x + Math.cos(a) * 60, boss.y - 14 + Math.sin(a) * 50, '#e0ffd0', '#7aff5a', 0.3, 1); }
    addDecal(boss.x, boss.y, 'corrupt', 40);
    E.light(boss.x, boss.y - 14, 160, '#7aff5a', 1.6, 1);
  });
  bus.on(EV.BOSS_DEFEATED, ({ boss } = {}) => {
    if (!boss) return;
    const bx = boss.x, by = boss.y;
    for (let k = 0; k < 6; k++) {
      timers.push({ t: k * 0.35, fn: () => {
        const x = bx + R(-14, 14), y = by - R(4, 28);
        SIGS.corrupt.burst(E, x, y, 1.5);
        SIGS.arcane.burst(E, x, y, 1);
        addRing(x, y, 24 + k * 6, k & 1 ? '#7aff5a' : '#ffb8ff', 0.5, { width: 2 });
      } });
    }
    timers.push({ t: 2.2, fn: () => {
      dissolve('boss_archmage', bx, by, { elements: 'corrupt', frame: 7 });
      SIGS.arcane.nova(E, bx, by - 12, 96, 2);
      addRing(bx, by - 12, 140, '#ffffff', 0.9, { width: 4 });
      E.light(bx, by - 12, 220, '#ffffff', 2, 1.2);
      fx.flash('#ffffff', 0.6, 0.8);
    } });
  });
  bus.on(EV.LEVEL_READY, ({ level, spec } = {}) => {
    staticLights = [];
    emitters = [];
    levelKind = level?.kind || spec?.kind || null;
    try { levelTheme = game.art?.tileTheme?.(level.map) || 'academy'; } catch { levelTheme = 'academy'; }
    if (!level?.map) return;
    const crystalColor = levelTheme === 'magma' ? '#ff9a3a' : levelTheme === 'crystal' || levelTheme === 'tower' ? '#ff7af0' : levelTheme === 'boss' ? '#7aff5a' : '#5ad8ff';
    let lavaCount = 0;
    level.map.forEach((tx, ty, g, d) => {
      const cx = tx * TILE_SIZE + 8, cy = ty * TILE_SIZE + 8;
      for (const id of [g, d]) {
        if (!id) continue;
        const L = TILE_DEFS[id].light;
        if (L) {
          // lava fields: only every few tiles carries a light (keeps the light count sane)
          if (id === TILE.LAVA && (tx + ty * 3) % 3 !== 0) continue;
          let color = L.color;
          if (id === TILE.CRYSTAL || id === TILE.CRYSTAL_WALL) color = crystalColor;
          if (id === TILE.RUNE_FLOOR || id === TILE.RUNE_CIRCLE) color = levelTheme === 'boss' ? '#7aff5a' : L.color;
          staticLights.push({ x: cx, y: cy, radius: L.radius, color, flicker: !!L.flicker, intensity: id === TILE.TORCH_WALL ? 0.95 : 0.8, ph: Math.random() * 100 });
        }
      }
      if (emitters.length > 500) return;
      if (d === TILE.TORCH_WALL || d === TILE.LANTERN) emitters.push({ x: cx, y: cy, kind: 'torch' });
      else if (d === TILE.BRAZIER) emitters.push({ x: cx, y: cy, kind: 'brazier' });
      else if (d === TILE.CRYSTAL) emitters.push({ x: cx, y: cy, kind: 'crystal', color: crystalColor });
      else if (d === TILE.MUSHROOMS) emitters.push({ x: cx, y: cy, kind: 'mushroom', color: levelTheme === 'magma' ? '#ff7a3a' : '#3ae0b0' });
      else if (d === TILE.FOUNTAIN) emitters.push({ x: cx, y: cy, kind: 'fountain' });
      else if (d === TILE.CAULDRON) emitters.push({ x: cx, y: cy, kind: 'cauldron' });
      else if (d === TILE.CANDLES) emitters.push({ x: cx, y: cy, kind: 'candle' });
      else if (d === TILE.RUNE_CIRCLE || g === TILE.RUNE_FLOOR) { if ((tx + ty) % 2 === 0) emitters.push({ x: cx, y: cy, kind: 'rune', color: levelTheme === 'boss' ? '#7aff5a' : '#b08aff' }); }
      if (g === TILE.LAVA && (lavaCount++ % 2 === 0)) emitters.push({ x: cx, y: cy, kind: 'lava' });
      else if (g === TILE.POISON && (tx + ty) % 3 === 0) emitters.push({ x: cx, y: cy, kind: 'poison' });
    });
    if (staticLights.length > 220) staticLights.length = 220;
  });

  // phones start a little leaner; the adaptive loop raises it again if frames are fast
  if (game.input?.isTouchDevice) fx.setQuality(0.7);
  return fx;
}

export { hexA, ELEMENT_COLORS };
