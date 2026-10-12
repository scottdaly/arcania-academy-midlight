// UI public API (team: ui+audio). Contract: ARCHITECTURE.md §4.5. Placeholder implementation.
import { EV } from '../core/events.js';
import { ELEMENTS, ELEMENT_COLORS } from '../core/config.js';
import { drawText, measureText, wrapText } from './font.js';
import { PANELS } from './panels.js';
import { createTouchControls } from './touch.js';

export { drawText, measureText, wrapText };

/** Panels that do NOT pause the world (none yet; e.g. a future minimap). */
const NON_BLOCKING = new Set();

export function createUI(game) {
  /** Stack of open panels: [{name, data, impl}] - the top one receives input. */
  const stack = [];
  const toasts = [];
  const floaters = []; // world-space damage numbers
  let touch = null;

  const ui = {
    drawText,
    measureText,
    wrapText,

    /** Open a panel by name (see PANELS). Re-opening an open panel brings it to the top. */
    open(name, data = {}) {
      const factory = PANELS[name];
      if (!factory) { console.warn(`[ui] unknown panel "${name}"`); return; }
      ui.close(name, true);
      const entry = { name, data, impl: null };
      stack.push(entry);
      entry.impl = factory(game, ui, data);
      game.bus.emit(EV.UI_OPENED, { panel: name, data });
    },
    /** Close a panel (or the top one if name omitted). */
    close(name, silent = false) {
      const i = name ? stack.findIndex((p) => p.name === name) : stack.length - 1;
      if (i < 0) return;
      const [p] = stack.splice(i, 1);
      if (!silent) game.bus.emit(EV.UI_CLOSED, { panel: p.name });
    },
    isOpen(name) {
      return stack.some((p) => p.name === name);
    },
    /** Name of the top panel or null. */
    get current() {
      return stack.length ? stack[stack.length - 1].name : null;
    },
    /** True if gameplay should be frozen (any blocking panel open). */
    blocksWorld() {
      return stack.some((p) => !NON_BLOCKING.has(p.name));
    },
    toast(text, color = '#f4f0ff', duration = 2.2) {
      toasts.push({ text, color, t: duration });
      if (toasts.length > 4) toasts.shift();
    },

    update(dt) {
      const inp = game.input;
      for (let i = toasts.length - 1; i >= 0; i--) if ((toasts[i].t -= dt) <= 0) toasts.splice(i, 1);
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t -= dt;
        f.y -= 18 * dt;
        if (f.t <= 0) floaters.splice(i, 1);
      }
      const top = stack[stack.length - 1];
      if (top) {
        top.impl.update?.(game, dt);
        inp.consumeAll(); // panels own input while open; nothing leaks into gameplay this tick
        return;
      }
      if (!game.isGameplay()) return;
      if (inp.pressed('pause')) { inp.consume('pause'); ui.open('pause'); }
      else if (inp.pressed('inventory')) { inp.consume('inventory'); ui.open('inventory'); }
      else if (inp.pressed('craft') && game.level?.kind === 'hub') { inp.consume('craft'); ui.open('crafting'); }
    },

    /** World-space overlay (camera already applied). */
    renderWorld(ctx) {
      for (const f of floaters) drawText(ctx, f.text, Math.round(f.x), Math.round(f.y), { color: f.color, align: 'center', alpha: Math.min(1, f.t * 2) });
      const t = game.interactTarget;
      if (t && !ui.blocksWorld()) {
        const key = game.input.lastDevice === 'touch' ? '' : 'E ';
        drawText(ctx, key + t.interactPrompt, Math.round(t.x), Math.round(t.y) - 30, { align: 'center', color: '#ffd25a' });
      }
      for (const e of game.entities.list) {
        if (e.team !== 'enemy' || e.dead || e.hp >= e.maxHp || e.tags.has('boss')) continue;
        const w = 12, x = Math.round(e.x - w / 2), y = Math.round(e.y + 3);
        ctx.fillStyle = '#140c1c';
        ctx.fillRect(x - 1, y - 1, w + 2, 3);
        ctx.fillStyle = '#ff4a5a';
        ctx.fillRect(x, y, Math.max(0, Math.round(w * e.hp / e.maxHp)), 1);
      }
    },

    /** Screen-space: HUD (gameplay only), touch controls, panels, toasts. */
    render(ctx) {
      const W = game.display.width, H = game.display.height, s = game.display.safe;
      if (game.isGameplay() && game.player) renderHud(ctx, W, H, s);
      if (touch) touch.render(ctx);
      for (const p of stack) p.impl.render?.(game, ctx);
      toasts.forEach((t, i) => drawText(ctx, t.text, W / 2, s.top + 30 + i * 9, { align: 'center', color: t.color, alpha: Math.min(1, t.t * 2) }));
    },
  };

  function bar(ctx, x, y, w, h, frac, color) {
    ctx.fillStyle = '#140c1c';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#2a2040';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, frac))), h);
  }

  function renderHud(ctx, W, H, s) {
    const p = game.state.player;
    const x = 6 + s.left, y = 6 + s.top;
    bar(ctx, x, y, 70, 5, p.hp / p.maxHp, '#ff4a5a');
    drawText(ctx, `${Math.ceil(p.hp)}`, x + 74, y, { color: '#ffb0b8' });
    bar(ctx, x, y + 8, 70, 4, p.mana / p.maxMana, '#4a8aff');
    drawText(ctx, `${Math.floor(p.mana)}`, x + 74, y + 8, { color: '#b0c8ff' });
    // fragments
    let fx = W - s.right - 6;
    const fy = touch?.visible ? y + 22 : y; // keep clear of the touch INV/pause buttons
    for (const el of [...ELEMENTS].reverse()) {
      const txt = String(game.state.fragments[el]);
      const w = measureText(txt) + 10;
      fx -= w;
      ctx.fillStyle = ELEMENT_COLORS[el][0];
      ctx.fillRect(fx, fy + 1, 4, 4);
      drawText(ctx, txt, fx + 6, fy, { color: ELEMENT_COLORS[el][1] });
    }
    if (touch?.visible) return; // touch buttons double as the spell bar
    // spell bar
    const slotW = 20, total = slotW * 4;
    const bx = Math.round(W / 2 - total / 2), by = H - s.bottom - 22;
    for (let i = 0; i < 4; i++) {
      const id = game.state.loadout[i];
      const spell = id && game.combat.getSpell(id);
      const sx = bx + i * slotW;
      ctx.fillStyle = 'rgba(20,12,40,0.8)';
      ctx.fillRect(sx, by, 18, 18);
      if (spell) {
        game.art.drawIcon(ctx, spell.icon, sx + 1, by + 1, { disabled: p.mana < spell.manaCost });
        const cd = game.combat.getCooldown(game, id);
        if (cd > 0) {
          const frac = Math.min(1, cd / Math.max(0.01, spell.cooldown));
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(sx, by + 18 - Math.round(18 * frac), 18, Math.round(18 * frac));
        }
      }
      drawText(ctx, String(i + 1), sx + 1, by - 7, { color: '#ffd25a' });
    }
    // boss bar
    const boss = game.entities.list.find((e) => e.tags.has('boss') && !e.dead);
    if (boss) {
      const bw = Math.min(200, W - 120);
      drawText(ctx, boss.def?.name || 'Boss', W / 2, y + 14, { align: 'center', color: '#ff8ad0' });
      bar(ctx, Math.round(W / 2 - bw / 2), y + 22, bw, 4, boss.hp / boss.maxHp, '#ff3a8a');
    }
  }

  // ---- event wiring ------------------------------------------------------------------
  const { bus } = game;
  bus.on(EV.TOAST, ({ text, color, duration }) => ui.toast(text, color, duration));
  bus.on(EV.DIALOGUE_OPEN, (payload) => ui.open('dialogue', payload));
  bus.on(EV.ENTITY_DAMAGED, ({ x, y, amount }) => floaters.push({ x, y: y - 16, text: String(amount), color: '#ffffff', t: 0.8 }));
  bus.on(EV.PLAYER_DAMAGED, ({ amount }) => game.player && floaters.push({ x: game.player.x, y: game.player.y - 18, text: String(amount), color: '#ff6a6a', t: 0.8 }));
  bus.on(EV.FRAGMENTS_CHANGED, ({ element, delta }) => { if (delta > 0) ui.toast(`+${delta} ${element} fragment`, ELEMENT_COLORS[element]?.[1]); });
  bus.on(EV.SPELL_CRAFTED, ({ spellId }) => ui.toast(`Crafted ${game.combat.getSpell(spellId)?.name || spellId}!`, '#ffd25a'));
  bus.on(EV.CRAFT_FAILED, ({ reason }) => ui.toast(`Cannot craft: ${reason}`, '#ff8a8a'));
  bus.on(EV.SPELL_FAILED, ({ reason, caster }) => { if (caster?.tags?.has('player') && reason === 'mana') ui.toast('Not enough mana', '#8ab0ff', 0.8); });
  bus.on(EV.SCENE_CHANGED, () => { floaters.length = 0; });

  touch = createTouchControls(game);
  return ui;
}
