// Shared building blocks for the menu panels (title, settings, pause, game over, victory) and the
// dialogue box (team: ui). Buttons + keyboard/pointer focus, confirm prompts, pixel logos,
// ambient particles and small formatting helpers. Everything draws at integer coordinates.
import { drawText, measureText } from '../font.js';
import { COL, button, panel, rrect, mix, rgba, clamp, easeOutCubic, sparkle, elColor } from '../theme.js';

// ------------------------------------------------------------------ small helpers

/** Play a UI sound; never throws. */
export function sfx(game, name, opts) {
  try { game.audio?.sfx?.(name, opts); } catch { /* audio is optional */ }
}

/** Seconds -> 'h:mm:ss' (or 'm:ss' when under an hour if short=true). */
export function fmtTime(sec, short = false) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return short && h === 0 ? `${m}:${ss}` : `${h}:${mm}:${ss}`;
}

/** Cheap string hash -> uint32. */
export function hash32(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const R = Math.round;

/** True for any "activate" key this tick. */
export const confirmPressed = (inp) => inp.pressed('confirm') || inp.pressed('interact');

// ------------------------------------------------------------------ button menus

/**
 * Vertical (or horizontal) button list with keyboard + mouse + touch focus handling.
 * items: [{id, label, onSelect(), disabled?, accent?}]. The panel owns a createHits() registry;
 * call menu.handle(game, events) in update with the events from hits.poll(), and
 * menu.place(hits, i, x, y, w, h) + menu.draw(ctx, game, i, x, y, w, h, opts) in render.
 */
export function createMenu(items, { focus = 0, horizontal = false, wrap = true, keys = true } = {}) {
  const m = {
    items,
    focus: clamp(focus, 0, Math.max(0, items.length - 1)),
    flash: -1, // index of the button that was just activated (visual pop)
    flashT: 0,
    /** Index of an item id or -1. */
    indexOf(id) { return m.items.findIndex((it) => it.id === id); },
    setFocus(i) { m.focus = clamp(i, 0, m.items.length - 1); },
    move(game, d) {
      const n = m.items.length;
      if (!n) return;
      let i = m.focus;
      for (let k = 0; k < n; k++) {
        i += d;
        if (wrap) i = (i + n) % n;
        else i = clamp(i, 0, n - 1);
        if (!m.items[i].disabled) break;
      }
      if (i !== m.focus) { m.focus = i; sfx(game, 'ui_move'); }
    },
    activate(game, i) {
      const it = m.items[i];
      if (!it) return false;
      if (it.disabled) { sfx(game, 'ui_error'); return false; }
      m.focus = i;
      m.flash = i;
      m.flashT = game.realTime;
      if (!it.silent) sfx(game, 'ui_select');
      it.onSelect?.();
      return true;
    },
    /** Process pointer events + keys. Returns true if something was activated. */
    handle(game, events, { allowKeys = keys } = {}) {
      for (const e of events) {
        const i = m.indexOf(e.id);
        if (i < 0) continue;
        if (e.type === 'hover' && i !== m.focus && !m.items[i].disabled) { m.focus = i; sfx(game, 'ui_hover'); }
        else if (e.type === 'press' && !m.items[i].disabled) m.focus = i;
        else if (e.type === 'click') return m.activate(game, i);
      }
      if (!allowKeys) return false;
      const inp = game.input;
      if (inp.pressed(horizontal ? 'left' : 'up')) m.move(game, -1);
      else if (inp.pressed(horizontal ? 'right' : 'down')) m.move(game, 1);
      if (confirmPressed(inp)) return m.activate(game, m.focus);
      return false;
    },
    place(hits, i, x, y, w, h) {
      const it = m.items[i];
      if (it) hits.add(it.id, R(x), R(y), w, h, i);
    },
    /** Draw button i. opts {t, hits, ox (anim offset), alpha, accent, arrows} */
    draw(ctx, game, i, x, y, w, h, opts = {}) {
      const it = m.items[i];
      if (!it) return;
      drawButton(ctx, x + (opts.ox || 0), y + (opts.oy || 0), w, h, it.label, {
        focus: i === m.focus,
        pressed: !!opts.hits?.isPressed(it.id),
        disabled: !!it.disabled,
        accent: it.accent || opts.accent,
        t: game.realTime,
        alpha: opts.alpha ?? 1,
        arrows: opts.arrows ?? true,
        pop: m.flash === i ? clamp(1 - (game.realTime - m.flashT) / 0.35, 0, 1) : 0,
      });
    },
  };
  return m;
}

/** theme.button + focus shimmer, side arrows and an activation pop. */
export function drawButton(ctx, x, y, w, h, label, st = {}) {
  x = R(x); y = R(y);
  const { focus = false, alpha = 1, t = 0, arrows = true, pop = 0 } = st;
  ctx.save();
  ctx.globalAlpha *= alpha;
  button(ctx, x, y, w, h, label, { focus, pressed: st.pressed, disabled: st.disabled, accent: st.accent || COL.edge, t, textColor: st.textColor });
  if (focus && !st.disabled) {
    // diagonal shimmer sweeping across the face
    const period = 1.8, k = (t % period) / period;
    const sx = R(x - 8 + k * (w + 16));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let r = 1; r < h - 2; r++) {
      const px = sx + (h - r) * 0.5;
      const a = R(Math.max(x + 1, px)), b = R(Math.min(x + w - 1, px + 3));
      if (b > a) ctx.fillRect(a, y + r + (st.pressed ? 1 : 0), b - a, 1);
    }
    if (arrows) {
      const bob = R(Math.sin(t * 7) * 1.5 + 1.5);
      const cy = y + R((h - 1 - 5) / 2) + (st.pressed ? 1 : 0);
      drawText(ctx, '▶', x - 7 - bob, cy, { color: COL.gold });
      drawText(ctx, '◀', x + w + 4 + bob, cy, { color: COL.gold });
    }
  }
  if (pop > 0) {
    ctx.globalAlpha = alpha * pop * 0.7;
    ctx.fillStyle = COL.goldHi;
    rrect(ctx, x - 1, y - 1, w + 2, h + 1, COL.goldHi);
    const g = R((1 - pop) * 6);
    ctx.globalAlpha = alpha * pop;
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2 - g + 0.5, y - 2 - g + 0.5, w + 3 + g * 2, h + 3 + g * 2);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ confirm prompt

/**
 * Small modal yes/no prompt owned by a panel. confirm.open(text, onYes, onNo?) then, while
 * confirm.active, route update to confirm.update(game, events) and render via confirm.render.
 * Hit ids: 'confirm-yes', 'confirm-no' (+ 'confirm-block' swallowing taps elsewhere).
 */
export function createConfirm() {
  let text = '', onYes = null, onNo = null, openedAt = 0, yesLabel = 'Yes', noLabel = 'No';
  const menu = createMenu([
    { id: 'confirm-yes', label: 'Yes', onSelect: () => { c.active = false; onYes?.(); } },
    { id: 'confirm-no', label: 'No', silent: true, onSelect: () => c.cancel() },
  ], { focus: 1, horizontal: true });
  const c = {
    active: false,
    game: null,
    open(game, msg, yes, no = null, opts = {}) {
      text = msg; onYes = yes; onNo = no; openedAt = game.realTime;
      yesLabel = opts.yes || 'Yes'; noLabel = opts.no || 'No';
      menu.items[0].label = yesLabel; menu.items[1].label = noLabel;
      menu.focus = opts.focusYes ? 0 : 1;
      menu.flash = -1;
      c.game = game;
      c.active = true;
      sfx(game, 'ui_open');
    },
    cancel() {
      if (!c.active) return;
      c.active = false;
      sfx(c.game, 'ui_back');
      onNo?.();
    },
    /** Returns true (the confirm consumed the tick). */
    update(game, events) {
      const inp = game.input;
      if (inp.pressed('cancel')) { c.cancel(); return true; }
      if (inp.pressed('up') || inp.pressed('down')) menu.move(game, 1);
      menu.handle(game, events);
      return true;
    },
    render(ctx, game, hits) {
      const W = game.display.width, H = game.display.height;
      const a = easeOutCubic((game.realTime - openedAt) / 0.18);
      ctx.save();
      ctx.fillStyle = `rgba(5,3,10,${0.55 * a})`;
      ctx.fillRect(0, 0, W, H);
      hits.add('confirm-block', 0, 0, W, H);
      const lines = String(text).split('\n');
      const tw = Math.max(...lines.map((l) => measureText(l)));
      const bw = 52, gap = 8;
      const w = Math.min(W - 16, Math.max(tw + 28, bw * 2 + gap + 28));
      const h = 22 + lines.length * 9 + 22;
      const x = R((W - w) / 2), y = R((H - h) / 2 + (1 - a) * 10);
      ctx.globalAlpha = a;
      panel(ctx, x, y, w, h, { glow: 'rgba(122,90,255,0.25)' });
      lines.forEach((l, i) => drawText(ctx, l, x + w / 2, y + 10 + i * 9, { align: 'center', color: COL.text }));
      const by = y + h - 24, bx = R(x + w / 2 - bw - gap / 2);
      for (let i = 0; i < 2; i++) {
        const xx = bx + i * (bw + gap);
        menu.place(hits, i, xx, by, bw, 16);
        menu.draw(ctx, game, i, xx, by, bw, 16, { hits, arrows: false, accent: i === 0 ? COL.bad : COL.edge });
      }
      ctx.restore();
    },
  };
  return c;
}

// ------------------------------------------------------------------ pixel logo

const logoCache = new Map();
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/**
 * Pre-rendered big pixel word: vertical colour ramp per pixel row, 1px ink outline, 1px outer rim
 * and a drop shadow. Returns {canvas, fill, w, h, pad, chars:[{x,w}], scratch}.
 */
export function getLogo(text, scale, ramp, { rim = '#3a1a6a', ink = COL.ink } = {}) {
  const key = `${text}|${scale}|${ramp.join(',')}|${rim}|${ink}`;
  let L = logoCache.get(key);
  if (L) return L;
  const s = scale, pad = 3;
  const tw = measureText(text, s), th = 5 * s;
  const w = tw + pad * 2, h = th + pad * 2 + 1;
  // fill layer with the per-row ramp
  const [fill, fg] = mkCanvas(w, h);
  drawText(fg, text, pad, pad, { scale: s, color: '#ffffff', shadow: null });
  fg.globalCompositeOperation = 'source-atop';
  for (let r = 0; r < th; r++) {
    fg.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor((r / th) * ramp.length))];
    fg.fillRect(0, pad + r, w, 1);
  }
  // highlight: first pixel row of every glyph cell row gets a lighter tint
  fg.globalCompositeOperation = 'source-atop';
  fg.fillStyle = 'rgba(255,255,255,0.22)';
  for (let r = 0; r < 5; r++) fg.fillRect(0, pad + r * s, w, 1);
  fg.globalCompositeOperation = 'source-over';
  const sil = (color) => {
    const [c, g] = mkCanvas(w, h);
    g.drawImage(fill, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    return c;
  };
  const inkC = sil(ink), rimC = sil(rim);
  const [out, og] = mkCanvas(w, h);
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 1], [2, 1], [-1, 2], [1, 2], [0, 3]]) og.drawImage(rimC, dx, dy);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 2], [1, 2]]) og.drawImage(inkC, dx, dy);
  og.drawImage(fill, 0, 0);
  // char columns (for per-letter wave slices)
  const chars = [];
  let cx = 0;
  const str = [...text];
  for (let i = 0; i < str.length; i++) {
    const cw = measureText(str[i], s);
    chars.push({ x: pad + cx, w: cw, ch: str[i] });
    cx += cw + s;
  }
  const [scratch, sg] = mkCanvas(w, h);
  L = { canvas: out, fill, w, h, pad, chars, scale: s, scratch, sg };
  logoCache.set(key, L);
  if (logoCache.size > 40) logoCache.delete(logoCache.keys().next().value);
  return L;
}

/**
 * Draw a logo with optional per-letter wave and a shimmer sweep.
 * (x, y) = top-left of the cap height. opts { wave(i)->dy, shimmer 0..1 (-1 = off), alpha, letterAlpha(i) }
 */
export function drawLogo(ctx, L, x, y, opts = {}) {
  const { wave = null, shimmer = -1, alpha = 1, letterAlpha = null } = opts;
  x = R(x - L.pad); y = R(y - L.pad);
  let over = null;
  if (shimmer >= 0 && shimmer <= 1) {
    // band masked by the fill layer only (outline stays dark)
    const g = L.sg;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, L.w, L.h);
    g.drawImage(L.fill, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    const bx = -L.h + shimmer * (L.w + L.h * 2), bw = Math.max(2, L.scale);
    for (let r = 0; r < L.h; r++) {
      const px = R(bx + (L.h - r) * 0.6);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(px, r, bw, 1);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(px + bw, r, bw, 1);
    }
    // drop the untouched fill pixels: keep only the band
    // (one path: destination-in clears everything outside the drawn shape)
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    for (let r = 0; r < L.h; r++) g.rect(R(bx + (L.h - r) * 0.6), r, bw * 2, 1);
    g.fillStyle = '#fff';
    g.fill();
    g.globalCompositeOperation = 'source-over';
    over = L.scratch;
  }
  const src = L.canvas;
  const prevA = ctx.globalAlpha;
  if (!wave && !letterAlpha) {
    ctx.globalAlpha = prevA * alpha;
    ctx.drawImage(src, x, y);
    if (over) ctx.drawImage(over, x, y);
    ctx.globalAlpha = prevA;
    return;
  }
  const half = Math.floor(L.scale / 2);
  for (let i = 0; i < L.chars.length; i++) {
    const c = L.chars[i];
    if (c.ch === ' ') continue;
    const sx0 = i === 0 ? 0 : c.x - half;
    const sx1 = i === L.chars.length - 1 ? L.w : c.x + c.w + (L.scale - half);
    const dy = wave ? R(wave(i)) : 0;
    ctx.globalAlpha = prevA * alpha * (letterAlpha ? clamp(letterAlpha(i), 0, 1) : 1);
    if (ctx.globalAlpha <= 0) continue;
    ctx.drawImage(src, sx0, 0, sx1 - sx0, L.h, x + sx0, y + dy, sx1 - sx0, L.h);
    if (over) ctx.drawImage(over, sx0, 0, sx1 - sx0, L.h, x + sx0, y + dy, sx1 - sx0, L.h);
  }
  ctx.globalAlpha = prevA;
}

// ------------------------------------------------------------------ ambient particles

/**
 * Drifting pixel motes in normalised coordinates (resolution independent).
 * opts { n, colors[], vy:[min,max] (px/s, negative = up), vx, size }
 */
export function createMotes(opts = {}) {
  const { n = 40, colors = [COL.gold, COL.edgeHi], vy = [-14, -5], sway = 6 } = opts;
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      x: Math.random(), y: Math.random(), vy: vy[0] + Math.random() * (vy[1] - vy[0]),
      ph: Math.random() * 6.28, sw: (0.4 + Math.random()) * sway, c: colors[i % colors.length],
      big: Math.random() < 0.18, tw: 1 + Math.random() * 3,
    });
  }
  let last = null;
  return {
    render(ctx, W, H, t) {
      const dt = last == null ? 0 : clamp(t - last, 0, 0.1);
      last = t;
      const prev = ctx.globalAlpha;
      for (const p of list) {
        p.y += (p.vy * dt) / H;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        if (p.y > 1.02) { p.y = -0.02; p.x = Math.random(); }
        const x = R(p.x * W + Math.sin(t * 0.8 + p.ph) * p.sw), y = R(p.y * H);
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * p.tw + p.ph));
        ctx.globalAlpha = prev * a;
        ctx.fillStyle = p.c;
        if (p.big && a > 0.85) sparkle(ctx, x, y, 2, p.c);
        else ctx.fillRect(x, y, p.big ? 2 : 1, p.big ? 2 : 1);
      }
      ctx.globalAlpha = prev;
    },
  };
}

/** Fireworks: bursts of element-coloured pixels with gravity. */
export function createFireworks() {
  const parts = [];
  const els = ['fire', 'ice', 'lightning', 'arcane', 'earth'];
  let last = null, next = 0.2;
  return {
    burst(x, y, el, n = 34) {
      const c1 = elColor(el, 0), c2 = elColor(el, 1);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
        const sp = 30 + Math.random() * 45;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.9 + Math.random() * 0.7, c: Math.random() < 0.4 ? c2 : c1 });
      }
      parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.25, c: '#ffffff', flash: true });
    },
    render(ctx, W, H, t, area = null) {
      const dt = last == null ? 0 : clamp(t - last, 0, 0.1);
      last = t;
      next -= dt;
      if (next <= 0 && parts.length < 600) {
        next = 0.35 + Math.random() * 0.5;
        const a = area || { x: 0, y: 0, w: W, h: H * 0.5 };
        this.burst(a.x + Math.random() * a.w, a.y + Math.random() * a.h, els[Math.floor(Math.random() * els.length)]);
      }
      const prev = ctx.globalAlpha;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.vx *= Math.exp(-1.6 * dt);
        p.vy = p.vy * Math.exp(-1.6 * dt) + 26 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const k = 1 - p.life / p.max;
        ctx.globalAlpha = prev * clamp(k * 1.4, 0, 1);
        ctx.fillStyle = p.c;
        if (p.flash) { const r = R((1 - k) * 6) + 1; ctx.fillRect(R(p.x - r), R(p.y), r * 2 + 1, 1); ctx.fillRect(R(p.x), R(p.y - r), 1, r * 2 + 1); }
        else {
          ctx.fillRect(R(p.x), R(p.y), 1, 1);
          if (k > 0.5) ctx.fillRect(R(p.x - p.vx * 0.04), R(p.y - p.vy * 0.04), 1, 1);
        }
      }
      ctx.globalAlpha = prev;
    },
  };
}

/** Soft additive glow ellipse (cheap: one radial gradient). */
export function glow(ctx, cx, cy, rx, ry, color, a) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(R(cx), R(cy));
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

/** Vertical gradient fade band (cosmetic). */
export function vignette(ctx, W, H, color = '#05030a', a = 0.6) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Decorative divider: line with a centre diamond. */
export function divider(ctx, cx, y, w, color = COL.goldLo, hi = COL.gold) {
  cx = R(cx); y = R(y);
  const hw = R(w / 2);
  ctx.fillStyle = color;
  ctx.fillRect(cx - hw, y, hw - 4, 1);
  ctx.fillRect(cx + 5, y, hw - 4, 1);
  ctx.fillStyle = hi;
  ctx.fillRect(cx - 1, y - 1, 3, 3);
  ctx.fillRect(cx, y - 2, 1, 5);
  ctx.fillRect(cx - 2, y, 5, 1);
  ctx.fillStyle = mix(color, '#000000', 0.3);
  ctx.fillRect(cx - hw - 1, y, 1, 1);
  ctx.fillRect(cx + hw, y, 1, 1);
}
