// ART public API (team: art+fx). PLACEHOLDER implementation - replace freely, keep signatures.
// Contract: ARCHITECTURE.md §4.1. All art is generated procedurally at init into offscreen
// canvases; nothing is loaded from files. Every lookup has a visible fallback (never throws).
import { ELEMENT_COLORS } from '../core/config.js';
import { TILE_DEFS } from '../core/tiles.js';
import { hashString } from '../core/rng.js';
import { makeCanvas, rect, disc, px, shade, silhouette } from './pixel.js';
import { drawTileImpl } from './tiles.js';

/** Master palette (art team may extend). */
export const PALETTE = Object.freeze({
  ink: '#140c1c', night: '#0b0716', shadow: 'rgba(0,0,0,0.35)',
  white: '#f4f0ff', gold: '#ffd25a', purple: '#7a4aff', violet: '#b05aff',
  skin: '#f2c49b', robe: '#4a3aa8', robeDark: '#2d2370', hat: '#3b2f8f',
});

/** @type {Map<string, SpriteSheet>} */
const sprites = new Map();

/**
 * SpriteSheet: { canvas, fw, fh, ax, ay, anims: { [name]: { frames: number[], fps, loop } }, flashCanvas? }
 * Frames are laid out horizontally; (ax, ay) is the anchor (feet) inside a frame.
 */
function sheet(fw, fh, frameCount, drawFrame, anims, ax = fw / 2, ay = fh - 1) {
  const { canvas, ctx } = makeCanvas(fw * frameCount, fh);
  for (let i = 0; i < frameCount; i++) {
    ctx.save();
    ctx.translate(i * fw, 0);
    drawFrame(ctx, i);
    ctx.restore();
  }
  return { canvas, fw, fh, ax: Math.round(ax), ay: Math.round(ay), anims, flashCanvas: null };
}

// --------------------------------------------------------------- placeholder generators

const HUMANOID_ANIMS = {
  idle: { frames: [0, 1], fps: 2, loop: true },
  walk: { frames: [2, 3, 4, 5], fps: 8, loop: true },
  cast: { frames: [6], fps: 1, loop: false },
  hurt: { frames: [7], fps: 1, loop: false },
  die: { frames: [7], fps: 1, loop: false },
  attack: { frames: [6], fps: 1, loop: false },
};

function wizard(robe, hat, trim = PALETTE.gold, skin = PALETTE.skin, eyes = PALETTE.ink) {
  return sheet(12, 18, 8, (c, f) => {
    const bob = f === 1 ? 1 : 0;
    const step = f >= 2 && f <= 5 ? [0, 1, 0, -1][f - 2] : 0;
    // legs/feet
    rect(c, 3 + step, 16, 2, 2, PALETTE.ink);
    rect(c, 7 - step, 16, 2, 2, PALETTE.ink);
    // robe
    rect(c, 2, 8 + bob, 8, 8 - bob, robe);
    rect(c, 1, 12, 10, 4, robe);
    rect(c, 2, 15, 8, 1, shade(robe, -0.3));
    rect(c, 5, 8 + bob, 2, 8 - bob, trim);
    // head
    rect(c, 3, 4 + bob, 6, 5, skin);
    px(c, 4, 6 + bob, eyes); px(c, 7, 6 + bob, eyes);
    // hat
    rect(c, 1, 3 + bob, 10, 2, hat);
    rect(c, 3, 1 + bob, 6, 2, hat);
    rect(c, 5, 0 + bob, 3, 1, hat);
    // cast frame: raised glowing hand; hurt: tint
    if (f === 6) { rect(c, 10, 7, 2, 2, skin); px(c, 11, 6, '#fff'); }
    if (f === 7) { c.globalCompositeOperation = 'source-atop'; rect(c, 0, 0, 12, 18, 'rgba(255,60,60,0.5)'); }
  }, HUMANOID_ANIMS, 6, 17);
}

function knight(body = '#8a93a8', glow = '#5ad8ff') {
  return sheet(14, 20, 8, (c, f) => {
    const step = f >= 2 && f <= 5 ? [0, 1, 0, -1][f - 2] : 0;
    rect(c, 3 + step, 17, 3, 3, shade(body, -0.4));
    rect(c, 8 - step, 17, 3, 3, shade(body, -0.4));
    rect(c, 2, 8, 10, 9, body);
    rect(c, 2, 8, 10, 1, shade(body, 0.3));
    rect(c, 3, 1, 8, 7, shade(body, 0.1));
    rect(c, 4, 4, 6, 1, glow);
    rect(c, 6, 0, 2, 2, '#c03040');
    rect(c, 12, 5 + (f === 6 ? -3 : 0), 2, 11, '#d8dce8');
    if (f === 7) { c.globalCompositeOperation = 'source-atop'; rect(c, 0, 0, 14, 20, 'rgba(255,60,60,0.5)'); }
  }, HUMANOID_ANIMS, 7, 19);
}

function golem(body = '#7a7268', glow = '#ff8a3a') {
  return sheet(20, 20, 8, (c, f) => {
    const bob = f === 1 || f === 3 || f === 5 ? 1 : 0;
    disc(c, 10, 11 + bob, 8, body);
    rect(c, 3, 16, 5, 4, shade(body, -0.3));
    rect(c, 12, 16, 5, 4, shade(body, -0.3));
    rect(c, 0, 8 + bob + (f === 6 ? -4 : 0), 4, 7, shade(body, -0.15));
    rect(c, 16, 8 + bob + (f === 6 ? -4 : 0), 4, 7, shade(body, -0.15));
    rect(c, 7, 8 + bob, 2, 2, glow);
    rect(c, 11, 8 + bob, 2, 2, glow);
    if (f === 7) { c.globalCompositeOperation = 'source-atop'; rect(c, 0, 0, 20, 20, 'rgba(255,60,60,0.5)'); }
  }, HUMANOID_ANIMS, 10, 19);
}

function archmage() {
  return sheet(20, 28, 8, (c, f) => {
    const bob = f === 1 ? 1 : 0;
    rect(c, 3, 12 + bob, 14, 16 - bob, '#3a1450');
    rect(c, 1, 20, 18, 8, '#2a0a3a');
    rect(c, 9, 12 + bob, 2, 16 - bob, '#ff3a8a');
    rect(c, 6, 6 + bob, 8, 7, '#b8a8c8');
    rect(c, 7, 9 + bob, 2, 1, '#ff3a3a'); rect(c, 11, 9 + bob, 2, 1, '#ff3a3a');
    rect(c, 3, 4 + bob, 14, 3, '#2a0a3a');
    rect(c, 6, 0 + bob, 8, 4, '#2a0a3a');
    rect(c, 9, 0 + bob, 2, 1, '#ff3a8a');
    if (f === 6) disc(c, 17, 10, 2, '#ff6ad0');
    if (f === 7) { c.globalCompositeOperation = 'source-atop'; rect(c, 0, 0, 20, 28, 'rgba(255,255,255,0.5)'); }
  }, HUMANOID_ANIMS, 10, 27);
}

function single(w, h, draw, ax = w / 2, ay = h - 1, frames = 1, fps = 6) {
  const list = Array.from({ length: frames }, (_, i) => i);
  return sheet(w, h, frames, draw, { idle: { frames: list, fps, loop: true } }, ax, ay);
}

function placeholder(key) {
  const hue = hashString(key) % 360;
  return single(12, 12, (c) => {
    rect(c, 0, 0, 12, 12, `hsl(${hue},70%,25%)`);
    rect(c, 1, 1, 10, 10, `hsl(${hue},70%,55%)`);
    rect(c, 4, 4, 4, 4, '#ff00ff');
  }, 6, 11);
}

function buildSprites() {
  sprites.set('player', wizard(PALETTE.robe, PALETTE.hat));
  sprites.set('npc_headmaster', wizard('#e8e4f0', '#3a6aff', '#5ad8ff'));
  sprites.set('npc_librarian', wizard('#3a7a4a', '#2a5a3a'));
  sprites.set('npc_alchemist', wizard('#a8642a', '#6a3a1a', '#7aff5a'));
  sprites.set('npc_duelmaster', wizard('#a82a3a', '#5a1a2a'));
  sprites.set('npc_student', wizard('#3a5aa8', '#2a3a7a', '#ffffff'));
  sprites.set('enemy_knight', knight());
  sprites.set('enemy_knight_captain', knight('#b8a050', '#ff5a3a'));
  sprites.set('enemy_golem_stone', golem());
  sprites.set('enemy_golem_ember', golem('#6a3020', '#ffb03a'));
  sprites.set('enemy_golem_frost', golem('#6a8aa8', '#e6fbff'));
  sprites.set('boss_archmage', archmage());

  for (const [el, [c1, c2]] of Object.entries(ELEMENT_COLORS)) {
    sprites.set(`pickup_fragment_${el}`, single(8, 10, (c, f) => {
      const o = f % 2;
      rect(c, 3, 1 + o, 2, 8, c1); rect(c, 2, 3 + o, 4, 4, c1); rect(c, 3, 3 + o, 1, 3, c2);
    }, 4, 9, 2, 3));
  }
  sprites.set('pickup_health', single(8, 8, (c) => { disc(c, 4, 4, 3, '#ff3a5a'); px(c, 3, 3, '#fff'); }, 4, 7));
  sprites.set('pickup_mana', single(8, 8, (c) => { disc(c, 4, 4, 3, '#3a8aff'); px(c, 3, 3, '#fff'); }, 4, 7));
  sprites.set('pickup_item', single(10, 10, (c) => { rect(c, 1, 3, 8, 6, '#a86a2a'); rect(c, 1, 3, 8, 2, '#d8a050'); px(c, 5, 6, PALETTE.gold); }, 5, 9));
  sprites.set('prop_portal', single(16, 24, (c, f) => {
    rect(c, 2, 2, 12, 22, '#2a1a4a');
    rect(c, 4, 4, 8, 18, f ? '#7a4aff' : '#b05aff');
    rect(c, 6, 6, 4, 14, '#e8d0ff');
  }, 8, 23, 2, 4));
  sprites.set('prop_tower_door', single(16, 20, (c) => { rect(c, 1, 0, 14, 20, '#4a3a5a'); rect(c, 3, 3, 10, 17, '#5a3a20'); px(c, 11, 12, PALETTE.gold); }, 8, 19));
  sprites.set('prop_stairs_up', single(16, 16, (c) => { for (let i = 0; i < 4; i++) rect(c, 1, i * 4, 14, 3, shade('#8a8098', -i * 0.15)); }, 8, 15));
  sprites.set('prop_stairs_down', single(16, 16, (c) => { for (let i = 0; i < 4; i++) rect(c, 1, i * 4, 14, 3, shade('#8a8098', -0.6 + i * 0.15)); }, 8, 15));
  sprites.set('prop_forge', single(16, 16, (c, f) => { rect(c, 1, 6, 14, 10, '#4a4058'); rect(c, 3, 2, 10, 5, '#2a2438'); rect(c, 5, 8, 6, 4, f ? '#ff8a3a' : '#ffd25a'); }, 8, 15, 2, 5));
  sprites.set('prop_chest', single(14, 12, (c) => { rect(c, 1, 2, 12, 10, '#7a4a20'); rect(c, 1, 2, 12, 3, '#a86a2a'); rect(c, 6, 5, 2, 3, PALETTE.gold); }, 7, 11));
}

// --------------------------------------------------------------- public API

/** Generate all art. Called once by core before anything renders. May be async. */
export async function initArt(game) {
  sprites.clear();
  buildSprites();
}

export function hasSprite(key) {
  return sprites.has(key);
}

/** Always returns a SpriteSheet (placeholder for unknown keys, cached). */
export function getSprite(key) {
  let s = sprites.get(key);
  if (!s) sprites.set(key, (s = placeholder(key)));
  return s;
}

/**
 * Draw a sprite with its anchor at world/screen (x, y).
 * opts: { anim='idle', t=0 (seconds into anim), frame (overrides anim), flip=false,
 *         alpha=1, flash=0 (0..1 white overlay for hits), scale=1 }
 */
export function drawSprite(ctx, key, x, y, opts = {}) {
  const s = getSprite(key);
  const anim = s.anims[opts.anim || 'idle'] || s.anims.idle || { frames: [0], fps: 1, loop: true };
  let frame = opts.frame;
  if (frame == null) {
    const n = anim.frames.length;
    let i = Math.floor((opts.t || 0) * anim.fps);
    i = anim.loop === false ? Math.min(i, n - 1) : ((i % n) + n) % n;
    frame = anim.frames[i];
  }
  const scale = opts.scale || 1;
  const dw = s.fw * scale, dh = s.fh * scale;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.translate(Math.round(x), Math.round(y));
  if (opts.flip) ctx.scale(-1, 1);
  const dx = -s.ax * scale, dy = -s.ay * scale;
  ctx.drawImage(s.canvas, frame * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh);
  if (opts.flash > 0) {
    s.flashCanvas ||= silhouette(s.canvas);
    ctx.globalAlpha *= Math.min(1, opts.flash);
    ctx.drawImage(s.flashCanvas, frame * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh);
  }
  ctx.restore();
}

/** Soft oval shadow under an actor at feet position (x, y). */
export function drawShadow(ctx, x, y, w = 8) {
  ctx.fillStyle = PALETTE.shadow;
  const hw = Math.round(w / 2);
  ctx.fillRect(Math.round(x) - hw + 1, Math.round(y) - 1, hw * 2 - 2, 1);
  ctx.fillRect(Math.round(x) - hw, Math.round(y), hw * 2, 1);
  ctx.fillRect(Math.round(x) - hw + 1, Math.round(y) + 1, hw * 2 - 2, 1);
}

const iconCache = new Map();
/**
 * 16x16 icon, top-left at (x, y). Keys: 'element_<el>', 'spell_<spellId>', 'item_<itemId>',
 * 'ui_<name>'. opts: { size=16, alpha=1, disabled=false }
 */
export function drawIcon(ctx, key, x, y, opts = {}) {
  let c = iconCache.get(key);
  if (!c) {
    const { canvas, ctx: g } = makeCanvas(16, 16);
    const el = key.startsWith('element_') ? key.slice(8) : null;
    const [c1, c2] = ELEMENT_COLORS[el] || [`hsl(${hashString(key) % 360},70%,55%)`, '#fff'];
    rect(g, 1, 1, 14, 14, '#1a1428');
    if (el) { rect(g, 6, 2, 4, 12, c1); rect(g, 3, 5, 10, 6, c1); rect(g, 7, 4, 2, 6, c2); }
    else { disc(g, 8, 8, 5, c1); disc(g, 7, 7, 2, c2); }
    iconCache.set(key, (c = canvas));
  }
  const size = opts.size || 16;
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  if (opts.disabled) ctx.globalAlpha *= 0.35;
  ctx.drawImage(c, Math.round(x), Math.round(y), size, size);
  ctx.restore();
}

/** Draw one 16x16 tile (ground or deco layer) with its top-left at (px, py). See tiles.js. */
export function drawTile(ctx, tileId, px0, py0, variant = 0, time = 0, tx = 0, ty = 0, map = null) {
  drawTileImpl(ctx, tileId, TILE_DEFS[tileId], px0, py0, variant, time, tx, ty, map);
}

/** Full-screen backdrop for menu scenes. name: 'title' | 'gameover' | 'victory'. */
export function drawBackdrop(ctx, name, w, h, t) {
  const top = name === 'gameover' ? '#1a0408' : name === 'victory' ? '#1a1430' : '#0b0716';
  const bot = name === 'gameover' ? '#3a0a14' : name === 'victory' ? '#5a3a7a' : '#2a1a4a';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    const sx = (hashString('sx' + i) % 1000) / 1000 * w;
    const sy = (hashString('sy' + i) % 1000) / 1000 * h * 0.7;
    const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
    ctx.fillStyle = `rgba(255,255,255,${0.2 + tw * 0.6})`;
    ctx.fillRect(sx | 0, sy | 0, 1, 1);
  }
  // Mage Tower silhouette
  const cx = (w * 0.72) | 0;
  ctx.fillStyle = '#05030a';
  ctx.fillRect(cx - 10, (h * 0.25) | 0, 20, h);
  ctx.fillRect(cx - 14, (h * 0.25) | 0, 28, 4);
  ctx.fillRect(0, (h * 0.85) | 0, w, h);
  ctx.fillStyle = name === 'gameover' ? '#ff3a3a' : '#b05aff';
  ctx.fillRect(cx - 1, ((h * 0.25) | 0) - 6, 3, 3);
}
