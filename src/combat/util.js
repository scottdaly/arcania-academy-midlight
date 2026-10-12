// Small shared helpers for the combat folder (team: combat). Internal - not a contract.
import { EV } from '../core/events.js';
import { ELEMENT_COLORS } from '../core/config.js';

export const isHostile = (a, b) => a.team !== b.team && a.team !== 'neutral' && b.team !== 'neutral';

/** Can `e` be hit by something on `team`? (alive, hostile, not a projectile/zone) */
export function isTarget(e, team) {
  if (e.dead || e.team === team || e.team === 'neutral' || e.team == null) return false;
  if (e.tags.has('projectile') || e.tags.has('aoe') || e.tags.has('fxonly')) return false;
  if (e.tags.has('player')) return !e.dying;
  return e.hp > 0 && !e.dying;
}

export const colorsOf = (el) => ELEMENT_COLORS[el] || ELEMENT_COLORS.arcane;

/** Call an fx method if it exists (fx team may extend/rename; degrade gracefully). */
export function fx(game, method, ...args) {
  const f = game.fx?.[method];
  if (typeof f === 'function') {
    try { return f.apply(game.fx, args); } catch (err) { console.warn(`[combat] fx.${method} threw`, err); }
  }
  return null;
}

export function sfx(game, name, volume = 1, pitch = 1) {
  game.bus.emit(EV.SFX, { name, volume, pitch });
}

export function shake(game, intensity, duration) {
  game.bus.emit(EV.CAMERA_SHAKE, { intensity, duration });
}

export function hitStop(game, sec) {
  if (typeof game.hitStop === 'function') game.hitStop(sec);
  else game.bus.emit(EV.HIT_STOP, { duration: sec });
}

/**
 * Difficulty context for enemies spawned right now. Read from the scene being entered
 * (core sets scenes.currentName/params before world.buildLevel runs).
 * level: 1 = dungeon depth 1 ... ~6 = boss.
 */
export function difficulty(game) {
  const name = game.scenes?.currentName;
  const params = game.scenes?.params || {};
  if (name === 'dungeon') {
    const depth = Math.max(1, Number(params.depth) || 1);
    return { kind: 'dungeon', depth, level: depth };
  }
  if (name === 'tower') {
    const floor = Math.max(1, Number(params.floor) || game.state?.tower?.currentFloor || 1);
    return { kind: 'tower', floor, level: 1 + floor * 0.8 };
  }
  if (name === 'boss') return { kind: 'boss', level: 5 };
  return { kind: name || 'hub', level: 1 };
}

/** Pure-data angle difference in [0, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}

/** Rotate angle `a` toward `b` by at most `step`. */
export function turnToward(a, b, step) {
  let d = (b - a) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

/** Draw text via the UI bitmap font if available. */
export function drawText(game, ctx, text, x, y, opts) {
  const f = game.ui?.drawText;
  if (typeof f === 'function') {
    try { f.call(game.ui, ctx, text, x, y, opts); } catch { /* ui mid-refactor: skip text */ }
  }
}

/** Pixel-ish filled circle (cheap: horizontal spans). */
export function fillDisc(ctx, cx, cy, r, squash = 1) {
  cx = Math.round(cx); cy = Math.round(cy);
  const ry = Math.max(1, Math.round(r * squash));
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(r * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    if (w > 0) ctx.fillRect(cx - w, cy + y, w * 2, 1);
  }
}

/** Pixel-ish circle outline. */
export function strokeDisc(ctx, cx, cy, r, squash = 1, step = 1) {
  cx = Math.round(cx); cy = Math.round(cy);
  const n = Math.max(12, Math.round(r * 6.4));
  for (let i = 0; i < n; i += step) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * squash), 1, 1);
  }
}
