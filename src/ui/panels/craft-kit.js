// Shared helpers for the crafting + inventory panels (team: ui). Internal to src/ui/panels.
// Pixel form glyphs, close button, panel intro, tabs, requirement text, tiny screen-space
// particle system, stat formatting.
import { ELEMENTS } from '../../core/config.js';
import { checkRequirements } from '../../core/state.js';
import { COL, rrect, mix, rgba, clamp, easeOutCubic, elColor, drawDisc, drawRing, sparkle } from '../theme.js';
import { drawText, measureText } from '../font.js';

// ------------------------------------------------------------------ layout helpers

/** Usable screen rect inside the safe area with a margin. */
export function safeRect(game, m = 3) {
  const d = game.display, s = d.safe || { top: 0, right: 0, bottom: 0, left: 0 };
  const x = s.left + m, y = s.top + m;
  return { x, y, w: Math.max(40, d.width - s.left - s.right - m * 2), h: Math.max(40, d.height - s.top - s.bottom - m * 2) };
}

/** Panel intro: slide up + fade over ~0.22 s. Returns {dy, alpha}. */
export function intro(age) {
  const k = easeOutCubic(clamp(age / 0.22, 0, 1));
  return { dy: Math.round((1 - k) * 14), alpha: 0.25 + 0.75 * k, k };
}

export const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Truncate text with an ellipsis to fit maxW px. */
export function ellipsize(text, maxW) {
  text = String(text ?? '');
  if (measureText(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && measureText(s + '…') > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

export const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

/** Format a number compactly (integers stay integers, else 1-2 decimals). */
export function fmt(n, d = 1) {
  if (n == null || !Number.isFinite(+n)) return '-';
  n = +n;
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  const s = n.toFixed(d);
  return s.replace(/\.?0+$/, '') || '0';
}

// ------------------------------------------------------------------ chrome

/** Close (X) button. (x,y) top-left, size s. */
export function drawClose(ctx, x, y, s, hot = false, pressed = false) {
  x = Math.round(x); y = Math.round(y) + (pressed ? 1 : 0);
  rrect(ctx, x - 1, y - 1, s + 2, s + 2, COL.ink);
  rrect(ctx, x, y, s, s, hot ? COL.bad : '#7a3050');
  ctx.fillStyle = hot ? '#5a1a30' : '#3a1630';
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x + 1, y + 1, s - 2, Math.floor((s - 2) / 2));
  // pixel X
  const c = hot ? '#ffffff' : '#ffb0c0';
  const n = Math.max(3, Math.floor(s / 2) - 2);
  const ox = x + Math.floor((s - n) / 2), oy = y + Math.floor((s - n) / 2);
  ctx.fillStyle = c;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(ox + i, oy + i, 1, 1);
    ctx.fillRect(ox + n - 1 - i, oy + i, 1, 1);
    if (s >= 14) { ctx.fillRect(ox + i + 1, oy + i, 1, 1); ctx.fillRect(ox + n - 2 - i, oy + i, 1, 1); }
  }
}

/** Tab strip. tabs [{id, label}], returns rects [{id,x,y,w,h}] (caller registers hits). */
export function drawTabs(ctx, tabs, x, y, h, active, focusId, t, out = []) {
  out.length = 0;
  let cx = Math.round(x);
  for (const tb of tabs) {
    const w = measureText(tb.label) + 16;
    const on = tb.id === active, foc = tb.id === focusId;
    const yy = on ? y : y + 2;
    rrect(ctx, cx - 1, yy - 1, w + 2, h + 2 - (on ? 0 : 2), COL.ink);
    rrect(ctx, cx, yy, w, h - (on ? 0 : 2), foc ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : on ? COL.edge : COL.edgeLo);
    ctx.fillStyle = on ? COL.bg3 : COL.bg;
    ctx.fillRect(cx + 1, yy + 1, w - 2, h - 2 - (on ? 0 : 2));
    if (on) { ctx.fillStyle = COL.gold; ctx.fillRect(cx + 2, yy + 1, w - 4, 1); }
    drawText(ctx, tb.label, cx + w / 2, yy + Math.round((h - (on ? 0 : 2) - 5) / 2), { align: 'center', color: on ? COL.goldHi : foc ? COL.text : COL.dim });
    out.push({ id: tb.id, x: cx, y, w, h });
    cx += w + 3;
  }
  return out;
}

/** Small section caption with a rule. */
export function caption(ctx, text, x, y, w, color = COL.dim) {
  drawText(ctx, text, x, y, { color });
  const tw = measureText(text);
  if (w - tw - 4 > 2) {
    ctx.fillStyle = COL.edgeLo;
    ctx.fillRect(Math.round(x + tw + 4), Math.round(y + 2), Math.round(w - tw - 4), 1);
  }
}

/** Tier stars. Returns width. */
export function drawStars(ctx, n, x, y, max = 3, color = COL.gold) {
  n = Math.max(0, Math.min(max, n | 0));
  for (let i = 0; i < max; i++) drawText(ctx, '★', x + i * 6, y, { color: i < n ? color : COL.dimmer });
  return max * 6;
}

/** Pill badge. Returns width. */
export function badge(ctx, text, x, y, color, fill = null, align = 'left') {
  const w = measureText(text) + 6;
  if (align === 'right') x -= w;
  x = Math.round(x); y = Math.round(y);
  rrect(ctx, x - 1, y - 1, w + 2, 11, COL.ink);
  rrect(ctx, x, y, w, 9, color);
  ctx.fillStyle = fill || mix(color, COL.ink, 0.65);
  ctx.fillRect(x + 1, y + 1, w - 2, 7);
  drawText(ctx, text, x + 3, y + 2, { color: mix(color, '#ffffff', 0.5), shadow: null });
  return w;
}

// ------------------------------------------------------------------ form glyphs (7x7)

const FORM_PIX = {
  bolt: ['.......', '...#...', '....#..', '#######', '....#..', '...#...', '.......'],
  volley: ['......#', '....#..', '.......', '#.#.#.#', '.......', '....#..', '......#'],
  orb: ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'],
  arc: ['.......', '#......', '.#...#.', '..#.#.#', '...#...', '.......', '.......'],
  nova: ['..###..', '.#...#.', '#.....#', '#..#..#', '#.....#', '.#...#.', '..###..'],
  rune: ['...#...', '..#.#..', '.#...#.', '#..#..#', '.#...#.', '..#.#..', '...#...'],
  seekers: ['....##.', '....##.', '.......', '.##....', '.##..#.', '.....#.', '.......'],
  burst: ['#..#..#', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '#..#..#'],
  ward: ['#######', '#.....#', '#######', '#######', '.#####.', '..###..', '...#...'],
  mystery: ['..###..', '.#...#.', '.....#.', '....#..', '...#...', '.......', '...#...'],
};

const FORM_NAMES = { bolt: 'Bolt', volley: 'Volley', orb: 'Orb', arc: 'Arc', nova: 'Nova', rune: 'Glyph', seekers: 'Seekers', burst: 'Burst', ward: 'Ward' };
const FORM_ORDER = ['bolt', 'volley', 'orb', 'arc', 'nova', 'rune', 'seekers', 'burst', 'ward'];
const KIND_FORM = { projectile: 'bolt', aoe: 'burst', nova: 'nova', self: 'ward' };

export const formLabel = (f) => FORM_NAMES[f] || cap(String(f || '?').replace(/[_-]+/g, ' '));
export const formOrder = (f) => { const i = FORM_ORDER.indexOf(f); return i < 0 ? 99 : i; };

/** Form id of a recipe: recipe.form, else derived from the result spell's kind. */
export function formOf(recipe, spell) {
  if (recipe?.form) return String(recipe.form);
  const k = spell?.kind;
  return KIND_FORM[k] || (k ? String(k) : 'mystery');
}

const glyphCache = new Map();
export function drawFormGlyph(ctx, form, x, y, color = COL.text, outline = COL.ink) {
  const key = form + '|' + color + '|' + outline;
  let c = glyphCache.get(key);
  if (!c) {
    const rows = FORM_PIX[form] || FORM_PIX.mystery;
    c = document.createElement('canvas');
    c.width = 9; c.height = 9;
    const g = c.getContext('2d');
    const on = (cx, cy) => cy >= 0 && cy < 7 && cx >= 0 && cx < 7 && rows[cy][cx] === '#';
    if (outline) {
      g.fillStyle = outline;
      for (let yy = -1; yy <= 7; yy++) for (let xx = -1; xx <= 7; xx++) {
        if (!on(xx, yy) && (on(xx - 1, yy) || on(xx + 1, yy) || on(xx, yy - 1) || on(xx, yy + 1))) g.fillRect(xx + 1, yy + 1, 1, 1);
      }
    }
    for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) {
      if (!on(xx, yy)) continue;
      g.fillStyle = !on(xx, yy - 1) ? mix(color, '#ffffff', 0.45) : color;
      g.fillRect(xx + 1, yy + 1, 1, 1);
    }
    glyphCache.set(key, c);
    if (glyphCache.size > 300) glyphCache.delete(glyphCache.keys().next().value);
  }
  ctx.drawImage(c, Math.round(x) - 1, Math.round(y) - 1);
}

// ------------------------------------------------------------------ requirements

const FLAG_TEXT = {
  dungeonCleared: 'Clear the Dungeon',
  archmageDefeated: 'Defeat the Archmage',
  metHeadmaster: 'Meet the Headmaster',
  alchemistGift: 'Visit the Alchemist',
};

function flagText(k, v) {
  const m = /^towerFloor(\d+)Cleared$/.exec(k);
  if (m) return v === false ? `Before Tower floor ${m[1]}` : `Clear Tower floor ${m[1]}`;
  if (FLAG_TEXT[k] && v !== false) return FLAG_TEXT[k];
  return v === false ? `Requires: not ${k}` : `Requires: ${k}`;
}

/** Human-readable UNMET requirement lines (all lines if `all`). */
export function requirementLines(game, req, all = false) {
  const out = [];
  if (!req || typeof req !== 'object') return out;
  const st = game.state;
  const pass = (r) => { try { return checkRequirements(st, r); } catch { return false; } };
  const push = (r, text) => { if (all || !pass(r)) out.push(text); };
  if (req.towerFloor != null) push({ towerFloor: req.towerFloor }, `Reach Tower floor ${req.towerFloor}`);
  for (const [k, v] of Object.entries(req.flags || {})) push({ flags: { [k]: v } }, flagText(k, v));
  for (const k of req.notFlags || []) push({ notFlags: [k] }, `Not after: ${k}`);
  for (const [id, n] of Object.entries(req.items || {})) {
    const it = game.combat.getItem?.(id);
    push({ items: { [id]: n } }, `Bring ${it?.name || id}${n > 1 ? ' x' + n : ''}`);
  }
  for (const id of req.spells || []) {
    const sp = game.combat.getSpell?.(id);
    push({ spells: [id] }, `Learn ${sp?.name || id}`);
  }
  for (const [el, n] of Object.entries(req.fragments || {})) push({ fragments: { [el]: n } }, `${n} ${cap(el)} fragments`);
  for (const k of Object.keys(req)) {
    if (!['towerFloor', 'flags', 'notFlags', 'items', 'spells', 'fragments'].includes(k)) out.push(`Requires: ${k}`);
  }
  return out;
}

// ------------------------------------------------------------------ status colours

const STATUS_COL = { burn: '#ff6a1f', chill: '#4fc8ff', freeze: '#e6fbff', shock: '#ffe14a', blind: '#c8c8d0', vulnerable: '#b05aff', stun: '#ffffff', poison: '#7aff5a', slow: '#8ab0ff' };
const STATUS_NAME = { vulnerable: 'Hexed', stun: 'Stun' };
export const statusColor = (type) => STATUS_COL[type] || COL.edgeHi;
export const statusName = (type) => STATUS_NAME[type] || cap(type);

/** All statuses of a spell (statuses[] or status). */
export function spellStatuses(spell) {
  if (Array.isArray(spell?.statuses) && spell.statuses.length) return spell.statuses.filter(Boolean);
  return spell?.status ? [spell.status] : [];
}

// ------------------------------------------------------------------ elements

export const orderedElements = (list) => {
  const set = new Set(list);
  const out = ELEMENTS.filter((e) => set.has(e));
  for (const e of set) if (!out.includes(e)) out.push(e);
  return out;
};

// ------------------------------------------------------------------ particles (screen space)

export function createSparks(max = 220) {
  const P = [];
  return {
    get count() { return P.length; },
    clear() { P.length = 0; },
    spawn(x, y, vx, vy, life, color, size = 1, drag = 2.5, grav = 0) {
      if (P.length >= max) P.shift();
      P.push({ x, y, vx, vy, life, max: life, color, size, drag, grav });
    },
    burst(x, y, n, colors, speed = 90, life = 0.8) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.8);
        this.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, life * (0.5 + Math.random() * 0.6), colors[i % colors.length], Math.random() < 0.25 ? 2 : 1, 2.2, 30);
      }
    },
    update(dt) {
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) { P.splice(i, 1); continue; }
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy = p.vy * k + p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    },
    render(ctx) {
      for (const p of P) {
        const f = p.life / p.max;
        ctx.globalAlpha = Math.min(1, f * 1.6);
        if (p.size >= 2 && f > 0.5) sparkle(ctx, p.x, p.y, 1, p.color);
        else { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
      }
      ctx.globalAlpha = 1;
    },
  };
}

/** Expanding ring list helper. */
export function drawRings(ctx, rings, t) {
  for (const r of rings) {
    const k = (t - r.t0) / r.dur;
    if (k < 0 || k > 1) continue;
    ctx.globalAlpha = 1 - k;
    drawRing(ctx, r.x, r.y, Math.max(1, Math.round(r.r0 + (r.r1 - r.r0) * easeOutCubic(k))), r.color, k < 0.5 ? 2 : 1);
    ctx.globalAlpha = 1;
  }
}

/** Soft glow: stacked translucent discs (cached canvases). */
export function glow(ctx, cx, cy, r, color, a = 0.25) {
  const prev = ctx.globalAlpha;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = prev * a * (0.45 + i * 0.3);
    drawDisc(ctx, cx, cy, Math.max(1, Math.round(r * (1 - i * 0.3))), color);
  }
  ctx.globalAlpha = prev;
}

/** Horizontal shake offset for an error wobble (t counts down from ~0.4). */
export const shakeX = (t) => (t > 0 ? Math.round(Math.sin(t * 60) * 3 * Math.min(1, t * 4)) : 0);

/** [label, value] stat pairs for a spell card (kind-specific). */
export function spellStats(sp) {
  const out = [];
  if (!sp) return out;
  const n = (v) => v != null && Number.isFinite(+v);
  if (n(sp.damage)) out.push(['DMG', sp.burstDamage ? `${fmt(sp.damage)}+${fmt(sp.burstDamage)}` : fmt(sp.damage)]);
  if (n(sp.manaCost)) out.push(['MANA', fmt(sp.manaCost)]);
  if (n(sp.cooldown)) out.push(['CD', fmt(sp.cooldown, 2) + 'S']);
  if (sp.kind === 'projectile') {
    if (sp.count > 1) out.push(['COUNT', 'x' + sp.count]);
    if (sp.jumps) out.push(['JUMPS', fmt(sp.jumps)]);
    if (sp.pierce > 0) out.push(['PIERCE', sp.pierce >= 99 ? 'ALL' : fmt(sp.pierce)]);
    if (n(sp.speed)) out.push(['SPEED', fmt(sp.speed)]);
    if (n(sp.range)) out.push(['RANGE', fmt(sp.range)]);
    if (n(sp.aoeRadius)) out.push(['BLAST', fmt(sp.aoeRadius)]);
    if (sp.homing) out.push(['HOMING', 'YES']);
  } else if (sp.kind === 'aoe' || sp.kind === 'nova') {
    if (n(sp.aoeRadius)) out.push(['RADIUS', fmt(sp.aoeRadius)]);
    if (sp.delay > 0) out.push(['DELAY', fmt(sp.delay, 2) + 'S']);
    if (sp.kind === 'aoe' && n(sp.range)) out.push(['RANGE', fmt(sp.range)]);
    if (sp.max) out.push(['MAX', fmt(sp.max)]);
  } else {
    if (n(sp.range)) out.push(['RANGE', fmt(sp.range)]);
    if (n(sp.duration)) out.push(['TIME', fmt(sp.duration) + 'S']);
  }
  return out.slice(0, 8);
}

export { rgba, elColor };
