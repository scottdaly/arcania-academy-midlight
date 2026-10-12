// Interaction helpers shared by all panels (team: ui): pointer hit regions (tap / click / hover /
// drag-scroll), device-aware prompts and keyboard grid navigation.
import { drawText, measureText } from './font.js';
import { keycap, tapGlyph, mouseGlyph, COL } from './theme.js';

/**
 * Hit-region registry. Panels call hits.begin() at the start of render() and hits.add(...) for
 * every interactive rect; update() calls hits.poll(input) to turn raw pointer events into
 * high-level events. Regions from the last render are used (one frame latency is invisible).
 *
 * poll() returns [{type:'press'|'click'|'hover'|'drag'|'release', id, data, x, y, dx?, dy?}]
 *   press   pointer went down on a region (instant feedback)
 *   click   pointer released over the SAME region it pressed (and did not drag)
 *   hover   mouse moved onto a region (mouse only)
 *   drag    pointer that started on a region flagged {drag:true} moved (dx/dy since last event)
 */
export function createHits() {
  const list = [];
  const active = new Map(); // pointerId -> {id, data, x, y, sx, sy, dragging, drag}
  let hoverId = null;
  const hits = {
    list,
    get hoverId() { return hoverId; },
    /** Region id currently held down by any pointer (for pressed visuals). */
    isPressed(id) {
      for (const a of active.values()) if (a.id === id && !a.dragging) return true;
      return false;
    },
    begin() { list.length = 0; },
    add(id, x, y, w, h, data = null, opts = {}) {
      list.push({ id, x, y, w, h, data, drag: !!opts.drag, pad: opts.pad ?? 0 });
    },
    find(x, y) {
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i], p = r.pad;
        if (x >= r.x - p && x < r.x + r.w + p && y >= r.y - p && y < r.y + r.h + p) return r;
      }
      return null;
    },
    get(id) { return list.find((r) => r.id === id) || null; },
    /** Centre of a region (virtual px) - used by the smoke test to tap real UI. */
    center(id) {
      const r = hits.get(id);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
    },
    poll(input) {
      const out = [];
      for (const e of input.pointerEvents) {
        const p = input.pointers.get(e.id);
        if (p?.claimedBy && !String(p.claimedBy).startsWith('ui:')) continue;
        if (e.type === 'down') {
          if (e.pointerType === 'mouse' && e.button !== 0) continue;
          const r = hits.find(e.x, e.y);
          active.set(e.id, { id: r?.id ?? null, data: r?.data, x: e.x, y: e.y, sx: e.x, sy: e.y, dragging: false, drag: !!r?.drag });
          if (r) out.push({ type: 'press', id: r.id, data: r.data, x: e.x, y: e.y });
        } else if (e.type === 'move') {
          const a = active.get(e.id);
          if (a) {
            if (!a.dragging && Math.hypot(e.x - a.sx, e.y - a.sy) > 5) a.dragging = true;
            if (a.dragging) out.push({ type: 'drag', id: a.id, data: a.data, x: e.x, y: e.y, dx: e.x - a.x, dy: e.y - a.y, scroll: a.drag });
            a.x = e.x; a.y = e.y;
          }
          if (e.pointerType === 'mouse') {
            const r = hits.find(e.x, e.y);
            const id = r?.id ?? null;
            if (id !== hoverId) {
              hoverId = id;
              if (r) out.push({ type: 'hover', id: r.id, data: r.data, x: e.x, y: e.y });
            }
          }
        } else if (e.type === 'up' || e.type === 'cancel') {
          const a = active.get(e.id);
          active.delete(e.id);
          if (!a) continue;
          out.push({ type: 'release', id: a.id, data: a.data, x: e.x, y: e.y });
          if (e.type === 'up' && a.id != null && !(a.dragging && a.drag)) {
            const r = hits.find(e.x, e.y);
            if (r && r.id === a.id) out.push({ type: 'click', id: r.id, data: r.data, x: e.x, y: e.y });
          }
        }
      }
      return out;
    },
    reset() { active.clear(); hoverId = null; },
  };
  return hits;
}

// ------------------------------------------------------------------ device-aware prompts

/** Which glyph family to show: 'touch' | 'keyboard'. */
// input.lastDevice starts as 'keyboard' even on phones, so remember whether a key was ever pressed.
let sawKey = false;
if (typeof window !== 'undefined') window.addEventListener('keydown', () => { sawKey = true; }, { once: true, capture: true });

export function promptDevice(game) {
  const inp = game.input;
  if (inp.lastDevice === 'touch') return 'touch';
  if (inp.isTouchDevice && inp.lastDevice === 'keyboard' && !sawKey) return 'touch';
  if (game.ui?.touchVisible) return 'touch';
  if (inp.lastDevice === 'keyboard' || inp.lastDevice === 'mouse') return 'keyboard';
  return inp.isTouchDevice ? 'touch' : 'keyboard';
}

export const KEY_LABEL = Object.freeze({
  up: 'W', down: 'S', left: 'A', right: 'D',
  spell1: '1', spell2: '2', spell3: '3', spell4: '4',
  interact: 'E', confirm: 'ENTER', cancel: 'ESC', inventory: 'I', craft: 'C', pause: 'ESC',
});
export const TOUCH_LABEL = Object.freeze({
  interact: 'TAP', confirm: 'TAP', cancel: 'BACK', inventory: 'BAG', pause: 'II', craft: 'TAP',
});

/**
 * Draw "[key] text" with the correct device glyph. Returns total width.
 * (x, y) = top-left of the glyph (glyphs are 9 px tall; text sits at y+2).
 * opts { align: 'left'|'center'|'right', color, alpha, mouse: 'left'|'right' (show a mouse button instead) }
 */
export function drawPrompt(ctx, game, action, text, x, y, opts = {}) {
  const { align = 'left', color = COL.text, alpha = 1 } = opts;
  const dev = promptDevice(game);
  const label = dev === 'touch' ? (opts.touchLabel ?? TOUCH_LABEL[action] ?? null) : (opts.key ?? KEY_LABEL[action] ?? action.toUpperCase());
  const glyphW = dev === 'touch' ? (label && label !== 'TAP' ? Math.max(9, measureText(label) + 5) : 9) : opts.mouse ? 7 : Math.max(9, measureText(label) + 5);
  const tw = text ? measureText(text) + 3 : 0;
  const total = glyphW + tw;
  let sx = Math.round(align === 'center' ? x - total / 2 : align === 'right' ? x - total : x);
  if (dev === 'touch') {
    if (label && label !== 'TAP') keycap(ctx, label, sx, y, { alpha, face: '#2a4a3a' });
    else tapGlyph(ctx, sx, y, { alpha });
  } else if (opts.mouse) mouseGlyph(ctx, sx, y - 1, opts.mouse);
  else keycap(ctx, label, sx, y, { alpha });
  if (text) drawText(ctx, text, sx + glyphW + 3, y + 2, { color, alpha });
  return total;
}

// ------------------------------------------------------------------ keyboard navigation

/**
 * Move a selection index inside a grid of `count` cells with `cols` columns.
 * Returns the new index (or the same one). wrap: wrap around rows/cols.
 */
export function gridNav(input, index, count, cols, { wrap = true } = {}) {
  if (count <= 0) return 0;
  let i = index;
  const rows = Math.ceil(count / cols);
  const r = Math.floor(i / cols), c = i % cols;
  if (input.pressed('left')) i = c > 0 ? i - 1 : wrap ? Math.min(count - 1, r * cols + cols - 1) : i;
  else if (input.pressed('right')) i = c < cols - 1 && i + 1 < count ? i + 1 : wrap ? r * cols : i;
  else if (input.pressed('up')) i = r > 0 ? i - cols : wrap ? Math.min(count - 1, (rows - 1) * cols + c) : i;
  else if (input.pressed('down')) i = i + cols < count ? i + cols : wrap ? c % cols : r < rows - 1 ? count - 1 : i;
  return Math.max(0, Math.min(count - 1, i));
}

/** True if any of the directional actions was pressed this tick. */
export const navPressed = (input) => input.pressed('up') || input.pressed('down') || input.pressed('left') || input.pressed('right');
