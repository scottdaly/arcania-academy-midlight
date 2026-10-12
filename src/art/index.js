// ART public API (team: art+fx). Contract: ARCHITECTURE.md §4.1.
// All art is generated procedurally at init into offscreen canvases; nothing is loaded from files.
// Every lookup has a visible fallback (never throws).
//
// Extras beyond the contract (all optional for callers):
//  - drawSprite opts.dir: 'down'|'up'|'side' picks directional anims (`walk_up` ...) on sheets with
//    `dirs`. For the 'player' key, if dir is omitted it is derived from game.player.facingX/Y.
//  - drawSprite opts.phase: 2 picks `<anim>_p2` on sheets with `phases` (the boss). If omitted for
//    'boss_archmage', the live boss entity's `phase` field is used.
//  - Emissive layers: sprites with glowing parts (eyes, runes, gems) record their glow pass while
//    drawn; fx replays it additively after the lighting pass so it glows through darkness.
//  - getSpritePixels(key, frame) -> sampled coloured pixels (fx death dissolves).
import { ELEMENT_COLORS, ELEMENTS } from '../core/config.js';
import { TILE_DEFS } from '../core/tiles.js';
import { hashString } from '../core/rng.js';
import { makeCanvas, rect, silhouette } from './pixel.js';
import { P } from './palette.js';
import { frame, assemble } from './sheet.js';
import { drawTileImpl, setThemeResolver } from './tiles.js';
import { wizardSheet, CHARACTERS, randomWizardSpec, catSheet, portraitSheet, PORTRAIT_BG, specialPortrait } from './characters.js';
import { knightSheet, golemSheet, archmageSheet, wispSheet, GOLEMS } from './enemies.js';
import { buildObjects, fragmentSheet } from './objects.js';
import { buildIcon } from './icons.js';
import { drawBackdropImpl } from './backdrops.js';

/** Master palette (named colours; art also uses the ramps in palette.js internally). */
export const PALETTE = Object.freeze({
  ink: P.ink, night: P.night, shadow: P.shadow,
  white: P.white, gold: P.gold[3], purple: '#7a4aff', violet: '#b05aff',
  skin: P.skin[2], robe: P.robeViolet[2], robeDark: P.robeViolet[1], hat: P.robeBlue[2],
  fel: '#7aff5a', corrupt: '#a02aa8', ghost: '#9af4ff', ember: '#ff8a2a', frost: '#e6fbff',
  ...Object.fromEntries(Object.entries(ELEMENT_COLORS).map(([k, v]) => [k, v[0]])),
});

/** @type {Map<string, any>} */
const sprites = new Map();
let gameRef = null;

// ------------------------------------------------------------------ emissive queue (read by fx)

const glowQueue = [];
const GLOW_MAX = 160;
/** Called by fx after lighting: draws queued emissive layers additively, then clears the queue. */
export function flushGlow(ctx, strength = 1) {
  if (!glowQueue.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const q of glowQueue) {
    ctx.setTransform(q.m);
    ctx.globalAlpha = q.alpha * strength;
    ctx.drawImage(q.s.glowCanvas, q.frame * q.s.fw, 0, q.s.fw, q.s.fh, q.dx, q.dy, q.dw, q.dh);
    // soft bloom: the same glow, slightly offset
    if (q.s.glowBloom !== false) {
      ctx.globalAlpha = q.alpha * strength * 0.35;
      ctx.drawImage(q.s.glowCanvas, q.frame * q.s.fw, 0, q.s.fw, q.s.fh, q.dx - 1, q.dy, q.dw, q.dh);
      ctx.drawImage(q.s.glowCanvas, q.frame * q.s.fw, 0, q.s.fw, q.s.fh, q.dx + 1, q.dy, q.dw, q.dh);
      ctx.drawImage(q.s.glowCanvas, q.frame * q.s.fw, 0, q.s.fw, q.s.fh, q.dx, q.dy - 1, q.dw, q.dh);
    }
  }
  ctx.restore();
  glowQueue.length = 0;
}
export function clearGlow() { glowQueue.length = 0; }

// ------------------------------------------------------------------ build

function sheetFor(key) {
  if (key.startsWith('npc_')) {
    if (key.includes('cat')) return catSheet(key.includes('white') ? P.hairWhite : key.includes('ginger') ? P.hairRed : P.hairBlack, key.includes('white') ? '#5ad8ff' : '#7aff5a');
    const spec = CHARACTERS[key] || randomWizardSpec(hashString(key));
    return wizardSheet(spec, { defaultDir: 'down' });
  }
  if (key.startsWith('familiar_')) return catSheet();
  if (key.startsWith('portrait_')) {
    const id = key.slice(9);
    if (id === 'cat' || id === 'portal' || id === 'sign') return specialPortrait(id);
    const alias = { shy: 'student_shy', wanderer: 'student3', forge: 'artificer' }[id] || id;
    const spec = id === 'player' ? CHARACTERS.player : CHARACTERS['npc_' + alias] || randomWizardSpec(hashString('npc_' + id));
    return portraitSheet(spec, { bg: PORTRAIT_BG[id] });
  }
  if (key.startsWith('enemy_')) {
    const k = key.slice(6);
    if (k.includes('golem')) {
      const variant = k.includes('ember') || k.includes('magma') || k.includes('fire') ? 'ember'
        : k.includes('frost') || k.includes('ice') ? 'frost'
          : k.includes('crystal') || k.includes('arcane') ? 'crystal'
            : k.includes('moss') || k.includes('earth') ? 'moss' : 'stone';
      return golemSheet(variant, (hashString(key) % 50) + 3);
    }
    if (k.includes('wisp')) return wispSheet(k.includes('frost') || k.includes('ice') ? 'frost' : k.includes('storm') || k.includes('lightning') ? 'storm' : k.includes('fel') || k.includes('corrupt') ? 'fel' : k.includes('arcane') ? 'arcane' : 'ember');
    if (k.includes('lancer')) return knightSheet({ steel: P.steel, trim: P.brass, eye: '#9af4ff', plume: '#3a6ac0', weapon: 'spear' });
    if (k.includes('sentinel')) return knightSheet({ steel: ['#141420', '#2a2a3e', '#46485e', '#6c7088', '#a0a6be'], trim: P.gold, eye: '#ffd25a', big: true, weapon: 'halberd', towerShield: true, cape: P.robeBlue });
    if (k.includes('captain') || k.includes('champion')) return knightSheet({ steel: P.steel, trim: P.gold, eye: '#ff7a3a', plume: '#c02a3a', cape: P.robeRed, big: true, weapon: 'greatsword' });
    if (k.includes('knight') || k.includes('armor') || k.includes('armour')) {
      const el = ['fire', 'ice', 'lightning', 'arcane'].find((e) => k.includes(e));
      const eye = el === 'fire' ? '#ff8a3a' : el === 'lightning' ? '#ffe14a' : el === 'arcane' ? '#ff7af0' : '#5ad8ff';
      return knightSheet({ steel: P.steel, trim: null, eye, plume: null, shield: el === 'fire' ? '#8a2a1a' : '#2a3a7a' });
    }
    if (k.includes('cat')) return catSheet();
    // unknown enemy: a corrupted wizard
    return wizardSheet({ ...randomWizardSpec(hashString(key)), robe: P.corrupt, eyesGlow: '#7aff5a', hat: { style: 'hood', ramp: P.corrupt } }, { defaultDir: 'side', dieTint: [120, 255, 120] });
  }
  if (key.startsWith('boss_')) return archmageSheet();
  if (key.startsWith('pickup_fragment_')) return fragmentSheet(key.slice(16));
  return null;
}

function buildSprites() {
  sprites.set('player', wizardSheet(CHARACTERS.player, { defaultDir: 'side' }));
  for (const k of Object.keys(CHARACTERS)) if (k.startsWith('npc_')) sprites.set(k, sheetFor(k));
  sprites.set('npc_cat', catSheet());
  sprites.set('familiar_cat', sprites.get('npc_cat'));
  sprites.set('enemy_knight', knightSheet({ steel: P.steel, trim: null, eye: '#5ad8ff', plume: null }));
  sprites.set('enemy_knight_captain', sheetFor('enemy_knight_captain'));
  for (const v of Object.keys(GOLEMS)) sprites.set(`enemy_golem_${v}`, golemSheet(v, 3 + v.length));
  sprites.set('enemy_golem_magma', sprites.get('enemy_golem_ember'));
  sprites.set('enemy_golem_ice', sprites.get('enemy_golem_frost'));
  sprites.set('boss_archmage', archmageSheet());
  for (const k of ['ember', 'frost', 'storm']) sprites.set(`enemy_wisp_${k}`, wispSheet(k));
  sprites.set('enemy_lancer', sheetFor('enemy_lancer'));
  sprites.set('enemy_sentinel', sheetFor('enemy_sentinel'));
  buildObjects((k, s) => sprites.set(k, s), ELEMENTS);
  for (const id of ['player', 'headmaster', 'librarian', 'alchemist', 'duelmaster', 'student', 'artificer', 'archmage', 'rival', 'quartermaster', 'healer', 'shy', 'cat', 'portal', 'sign', 'wanderer']) sprites.set(`portrait_${id}`, sheetFor(`portrait_${id}`));
}

function placeholder(key) {
  const hue = hashString(key) % 360;
  const f = frame(12, 12, (c) => {
    rect(c, 1, 1, 10, 10, `hsl(${hue},70%,25%)`);
    rect(c, 2, 2, 8, 8, `hsl(${hue},70%,55%)`);
    rect(c, 4, 4, 4, 4, '#ff00ff');
  });
  return assemble([f], { idle: { frames: [0], fps: 1, loop: true } }, 6, 11);
}

// ------------------------------------------------------------------ public API

/** Generate all art. Called once by core before anything renders. */
export async function initArt(game) {
  gameRef = game;
  sprites.clear();
  iconCache.clear();
  setThemeResolver(resolveTheme);
  buildSprites();
}

/** Tile theme for the current map: map.meta.biome/theme wins, else derived from the level. */
const BIOME_THEME = {
  academy: 'academy', hub: 'academy', crypt: 'crypt', magma: 'magma', frost: 'frost', crystal: 'crystal', tower: 'tower', boss: 'boss',
  catacombs: 'crypt', crypts: 'frost', vaults: 'crystal', volcano: 'magma', ice: 'frost', glacier: 'frost', caverns: 'crystal',
};
function themeOf(b) {
  const id = typeof b === 'string' ? b : b?.theme || b?.id;
  if (!id) return null;
  return BIOME_THEME[id] || BIOME_THEME[String(id).toLowerCase()] || null;
}
function resolveTheme(map) {
  const meta = map?.meta;
  const mt = meta && (themeOf(meta.theme) || themeOf(meta.biome));
  if (mt) return mt;
  const lvl = gameRef?.level;
  if (!lvl || (map && lvl.map !== map)) return 'academy';
  const lt = themeOf(lvl.data?.theme) || themeOf(lvl.data?.biome);
  if (lt) return lt;
  switch (lvl.kind) {
    case 'hub': return 'academy';
    case 'tower': return 'tower';
    case 'boss': return 'boss';
    case 'dungeon': {
      const el = lvl.data?.element;
      return el === 'fire' ? 'magma' : el === 'ice' ? 'frost' : el === 'lightning' ? 'crystal' : 'crypt';
    }
    default: return 'academy';
  }
}
export { resolveTheme as tileTheme };

const GENERATED = /^(npc_|portrait_|enemy_|boss_|familiar_|pickup_fragment_|prop_geode_)/;
/** True for prebuilt sprites AND for keys this module can generate (any npc_/enemy_/portrait_... key). */
export function hasSprite(key) {
  return sprites.has(key) || (typeof key === 'string' && GENERATED.test(key));
}

/** Always returns a SpriteSheet (generated on demand for known families; placeholder otherwise). */
export function getSprite(key) {
  let s = sprites.get(key);
  if (!s) {
    try { s = sheetFor(key); } catch (err) { console.warn('[art] sprite build failed', key, err); }
    if (!s) s = placeholder(key);
    sprites.set(key, s);
  }
  return s;
}

function pickDir(key, opts) {
  if (opts.dir) return opts.dir;
  if (key !== 'player') return null;
  const p = gameRef?.player;
  if (!p) return null;
  const fx = p.facingX ?? 1, fy = p.facingY ?? 0;
  if (Math.abs(fy) > Math.abs(fx) * 1.2) return fy < 0 ? 'up' : 'down';
  return 'side';
}

function pickPhase(key, opts) {
  if (opts.phase != null) return opts.phase;
  if (key !== 'boss_archmage' || !gameRef?.entities) return 1;
  for (const e of gameRef.entities.list) if (e.tags?.has('boss') && !e.dead) return e.phase || 1;
  return 1;
}

/**
 * Draw a sprite with its anchor at world/screen (x, y).
 * opts: { anim='idle', t=0, frame, flip=false, alpha=1, flash=0, scale=1, dir?, phase?, glow=true }
 */
export function drawSprite(ctx, key, x, y, opts = {}) {
  const s = getSprite(key);
  let name = opts.anim || 'idle';
  if (s.dirs) {
    const d = pickDir(key, opts);
    if (d && s.anims[`${name}_${d}`]) name = `${name}_${d}`;
  }
  if (s.phases && pickPhase(key, opts) >= 2 && s.anims[`${name}_p2`]) name = `${name}_p2`;
  const anim = s.anims[name] || s.anims.idle || { frames: [0], fps: 1, loop: true };
  let fr = opts.frame;
  if (fr == null) {
    const n = anim.frames.length;
    let i = Math.floor((opts.t || 0) * anim.fps);
    i = anim.loop === false ? Math.min(i, n - 1) : ((i % n) + n) % n;
    fr = anim.frames[i];
  }
  const scale = opts.scale || 1;
  const dw = s.fw * scale, dh = s.fh * scale;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  const baseAlpha = ctx.globalAlpha;
  ctx.translate(Math.round(x), Math.round(y));
  // vertical-facing frames are symmetric enough; only flip side views
  if (opts.flip && !(name.endsWith('_up') || name.endsWith('_down'))) ctx.scale(-1, 1);
  const dx = -s.ax * scale, dy = -s.ay * scale;
  ctx.drawImage(s.canvas, fr * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh);
  if (opts.flash > 0) {
    s.flashCanvas ||= silhouette(s.canvas);
    ctx.globalAlpha *= Math.min(1, opts.flash);
    ctx.drawImage(s.flashCanvas, fr * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh);
  }
  if (s.glowCanvas && opts.glow !== false && glowQueue.length < GLOW_MAX && ctx.globalCompositeOperation === 'source-over') {
    glowQueue.push({ s, frame: fr, m: ctx.getTransform(), dx, dy, dw, dh, alpha: baseAlpha });
  }
  ctx.restore();
}

/** Soft oval shadow under an actor at feet position (x, y). */
export function drawShadow(ctx, x, y, w = 8) {
  const hw = Math.max(2, Math.round(w / 2));
  const X = Math.round(x), Y = Math.round(y);
  ctx.fillStyle = 'rgba(8,4,20,0.22)';
  ctx.fillRect(X - hw + 1, Y - 1, hw * 2 - 2, 3);
  ctx.fillRect(X - hw, Y, hw * 2, 1);
  ctx.fillStyle = 'rgba(8,4,20,0.25)';
  ctx.fillRect(X - hw + 2, Y - 1, hw * 2 - 4, 2);
}

const iconCache = new Map();
function iconLookup(kind, id) {
  try {
    const c = gameRef?.combat;
    if (!c) return null;
    return kind === 'spell' ? c.getSpell?.(id) || c.SPELLS?.[id] || null : c.getItem?.(id) || c.ITEMS?.[id] || null;
  } catch { return null; }
}
/**
 * 16x16 icon, top-left at (x, y). Keys: 'element_<el>', 'spell_<spellId>', 'item_<itemId>',
 * 'ui_<name>'. opts: { size=16, alpha=1, disabled=false }
 */
export function drawIcon(ctx, key, x, y, opts = {}) {
  if (!key) return;
  let c = iconCache.get(key);
  if (!c) {
    c = buildIcon(key, iconLookup);
    iconCache.set(key, c);
  }
  const size = opts.size || 16;
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  if (opts.disabled) {
    ctx.globalAlpha *= 0.4;
    if ('filter' in ctx) ctx.filter = 'grayscale(1)';
  }
  ctx.drawImage(c, Math.round(x), Math.round(y), size, size);
  ctx.restore();
}

/** Draw one 16x16 tile (ground or deco layer) with its top-left at (px, py). See tiles.js. */
export function drawTile(ctx, tileId, px0, py0, variant = 0, time = 0, tx = 0, ty = 0, map = null) {
  drawTileImpl(ctx, tileId, TILE_DEFS[tileId], px0, py0, variant, time, tx, ty, map);
}

/** Full-screen backdrop for menu scenes. name: 'title' | 'gameover' | 'victory'. */
export function drawBackdrop(ctx, name, w, h, t) {
  drawBackdropImpl(ctx, name, w, h, t);
}

// ------------------------------------------------------------------ helpers for fx

const pixelCache = new Map();
/**
 * Sample up to `max` opaque pixels of a sprite frame: [{x, y, c}] relative to the anchor.
 * Used by fx for pixel-dissolve deaths. Cached per (key, frame).
 */
export function getSpritePixels(key, frameIndex = 0, max = 90) {
  const ck = `${key}:${frameIndex}`;
  let out = pixelCache.get(ck);
  if (out) return out;
  out = [];
  try {
    const s = getSprite(key);
    const { ctx } = makeCanvas(s.fw, s.fh);
    ctx.drawImage(s.canvas, frameIndex * s.fw, 0, s.fw, s.fh, 0, 0, s.fw, s.fh);
    const d = ctx.getImageData(0, 0, s.fw, s.fh).data;
    const all = [];
    for (let y = 0; y < s.fh; y++) for (let x = 0; x < s.fw; x++) {
      const i = (y * s.fw + x) * 4;
      if (d[i + 3] > 128) all.push({ x: x - s.ax, y: y - s.ay, c: `rgb(${d[i]},${d[i + 1]},${d[i + 2]})` });
    }
    const step = Math.max(1, all.length / max);
    for (let i = 0; i < all.length && out.length < max; i += step) out.push(all[Math.floor(i)]);
  } catch { /* fall through with empty list */ }
  pixelCache.set(ck, out);
  return out;
}
