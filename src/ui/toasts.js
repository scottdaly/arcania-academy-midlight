// Toast notifications (team: ui). Slide in from the top-centre, stack, merge by `key`
// (e.g. rapid fragment pickups update one toast instead of spamming new ones).
// While a full-screen panel (crafting, inventory, pause...) is open, toasts are held (they neither
// age nor draw) and appear once the panel closes, so they never cover a menu.
import { drawText, measureText, wrapText, LINE_HEIGHT } from './font.js';
import { COL, rrect, drawEmblem, easeOutBack, clamp } from './theme.js';

const MAX = 4;
/** Panels that toasts may draw over (they only cover the bottom of the screen). */
const SHOW_OVER = new Set(['dialogue']);

export function createToasts(game, ui) {
  const list = [];

  function push(text, color = COL.text, duration = 2.2, opts = {}) {
    if (!text) return;
    const key = opts?.key;
    if (key) {
      const ex = list.find((t) => t.key === key && t.life > 0.3);
      if (ex) {
        ex.text = String(text);
        ex.color = color || ex.color;
        ex.life = Math.max(ex.life, duration ?? 2.2);
        ex.bump = 1;
        return;
      }
    }
    list.push({ text: String(text), color: color || COL.text, life: duration ?? 2.2, age: 0, y: null, bump: 0, key, icon: opts?.icon || null, emblem: opts?.emblem || null });
    while (list.length > MAX) list.shift();
  }

  /** True while toasts should wait (a covering panel is open). */
  function held() {
    const cur = ui.current;
    return !!cur && !SHOW_OVER.has(cur);
  }

  function update(dt) {
    if (held()) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.age += dt;
      t.life -= dt;
      t.bump = Math.max(0, t.bump - dt * 5);
      if (t.life <= 0) list.splice(i, 1);
    }
  }

  function render(ctx) {
    if (!list.length || held()) return;
    const W = game.display.width, s = game.display.safe;
    const hudY = game.isGameplay() && game.player ? ui.hud?.toastY : null;
    let y = hudY ?? s.top + (game.isGameplay() ? (W < 360 ? 44 : 30) : 8);
    const maxTextW = Math.max(60, W - s.left - s.right - 34);
    for (const t of list) {
      const iconW = t.icon || t.emblem ? 11 : 0;
      const lines = measureText(t.text) > maxTextW - iconW ? wrapText(t.text, maxTextW - iconW) : [t.text];
      let tw = 0;
      for (const l of lines) tw = Math.max(tw, measureText(l));
      const w = tw + 12 + iconW;
      const h = 13 + (lines.length - 1) * LINE_HEIGHT;
      const intro = easeOutBack(t.age / 0.3);
      const outro = clamp(t.life / 0.25, 0, 1);
      t.y = t.y == null ? y - 10 : t.y + (y - t.y) * 0.3;
      const x = Math.round(s.left + (W - s.left - s.right) / 2 - w / 2);
      const ty = Math.round(t.y - (1 - intro) * 8 - t.bump * 2);
      const a = Math.min(1, t.age / 0.12) * outro;
      ctx.save();
      ctx.globalAlpha = a;
      rrect(ctx, x - 1, ty - 1, w + 2, h + 2, COL.ink);
      rrect(ctx, x, ty, w, h, 'rgba(28,18,48,0.94)');
      ctx.fillStyle = t.color;
      ctx.fillRect(x + 1, ty + 1, 2, h - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 3, ty + 1, w - 4, 5);
      if (t.emblem) drawEmblem(ctx, t.emblem, x + 6, ty + 3);
      else if (t.icon) game.art.drawIcon(ctx, t.icon, x + 5, ty + 3, { size: 8 });
      ctx.restore();
      lines.forEach((l, i) => drawText(ctx, l, x + 7 + iconW, ty + 4 + i * LINE_HEIGHT, { color: t.color, alpha: a }));
      y += h + 3;
    }
  }

  return { push, update, render, list };
}
