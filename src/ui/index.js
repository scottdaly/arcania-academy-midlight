// UI public API (team: ui+audio). Contract: ARCHITECTURE.md §4.5.
//
// Layout of this folder:
//   font.js      bitmap pixel font (drawText / measureText / wrapText)
//   theme.js     palette, pixel frames, buttons, bars, sweeps, element emblems, key caps
//   widgets.js   hit regions (tap/click/hover/drag), device-aware prompts, grid navigation
//   hud.js       in-game HUD (vitals, fragments, spell bar, boss bar, banners, minimap) + world overlay
//   toasts.js    notification toasts
//   touch.js     on-screen touch controls (InputSource)
//   panels/      modal panels: title, settings, pause, gameover, victory, inventory, crafting, dialogue
//
// Panel factory contract (internal to ui):
//   PANELS[name](game, ui, data) -> { update(game, dt), render(game, ctx, age), hits?, onClose?() }
//   `age` = seconds since the panel opened (for intro animations). `hits` (createHits()) lets
//   ui.findTarget() locate buttons for automated tests.
import { EV } from '../core/events.js';
import { drawText, measureText, wrapText } from './font.js';
import { PANELS } from './panels/index.js';
import { createTouchControls } from './touch.js';
import { createHud } from './hud.js';
import { createToasts } from './toasts.js';

export { drawText, measureText, wrapText };

/** Panels that do NOT pause the world. */
const NON_BLOCKING = new Set();

export function createUI(game) {
  /** Stack of open panels: [{name, data, impl, age}] - the top one receives input. */
  const stack = [];
  let touch = null;
  let hud = null;
  let toasts = null;

  const ui = {
    drawText,
    measureText,
    wrapText,

    /** Open a panel by name (see PANELS). Re-opening an open panel brings it to the top. */
    open(name, data = {}) {
      const factory = PANELS[name];
      if (!factory) { console.warn(`[ui] unknown panel "${name}"`); return; }
      ui.close(name, true);
      const entry = { name, data, impl: null, age: 0 };
      stack.push(entry);
      entry.impl = factory(game, ui, data) || {};
      game.input.consumeAll();
      game.bus.emit(EV.UI_OPENED, { panel: name, data });
    },
    /** Close a panel (or the top one if name omitted). */
    close(name, silent = false) {
      const i = name ? stack.findIndex((p) => p.name === name) : stack.length - 1;
      if (i < 0) return;
      const [p] = stack.splice(i, 1);
      game.guard('ui.onClose', () => p.impl?.onClose?.(game));
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
    /** toast(text, color?, duration?, opts?) opts {icon: 'element_fire'|'item_x'|..., emblem: el, big} */
    toast(text, color, duration, opts) {
      toasts?.push(text, color, duration, opts);
    },
    /** Are the on-screen touch controls showing right now? */
    get touchVisible() {
      return !!touch?.visible;
    },
    /** HUD instance (banner(), shake...) for internal use. */
    get hud() { return hud; },
    /** Touch controls instance (layout, targets). */
    get touch() { return touch; },

    /**
     * Locate an interactive element by id, in virtual px: {x, y} centre or null.
     * Searches touch controls ('touch:spell1', 'touch:interact', ...) then the top panel's hits.
     * Used by scripts/smoke.mjs so tests tap real buttons instead of guessing geometry.
     */
    findTarget(id) {
      if (String(id).startsWith('touch:')) return touch?.target?.(id.slice(6)) || null;
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i].impl?.hits?.center?.(id);
        if (c) return c;
      }
      return null;
    },

    update(dt) {
      const inp = game.input;
      toasts.update(dt);
      game.guard('hud.update', () => hud.update(dt));
      const top = stack[stack.length - 1];
      for (const p of stack) p.age += dt;
      if (top) {
        game.guard(`ui.panel.${top.name}.update`, () => top.impl.update?.(game, dt));
        inp.consumeAll(); // panels own input while open; nothing leaks into gameplay this tick
        return;
      }
      if (!game.isGameplay() || game.scenes.transitioning) return;
      if (inp.pressed('pause')) { inp.consume('pause'); ui.open('pause'); }
      else if (inp.pressed('inventory')) { inp.consume('inventory'); ui.open('inventory'); }
      else if (inp.pressed('craft')) {
        inp.consume('craft');
        if (game.level?.kind === 'hub') ui.open('crafting');
        else ui.toast('Craft at the Arcane Forge in the Academy', '#c8b8ff', 1.6);
      }
    },

    /** World-space overlay (camera already applied). */
    renderWorld(ctx, camera) {
      hud.renderWorld(ctx, camera);
    },

    /** Screen-space: HUD (gameplay only), touch controls, panels, toasts. */
    render(ctx) {
      if (game.isGameplay() && game.player) game.guard('hud.render', () => hud.render(ctx));
      if (touch) game.guard('touch.render', () => touch.render(ctx));
      for (const p of stack) game.guard(`ui.panel.${p.name}.render`, () => p.impl.render?.(game, ctx, p.age));
      toasts.render(ctx);
    },
  };

  // ---- event wiring ------------------------------------------------------------------
  const { bus } = game;
  bus.on(EV.TOAST, ({ text, color, duration, icon, emblem } = {}) => {
    // world's dialogue 'giveItem' toasts the raw id ('Received potion_health'); the HUD already shows a
    // nicer 'item found' toast from INVENTORY_CHANGED, so drop the duplicate.
    const m = /^Received (\w+)$/.exec(String(text || ''));
    if (m && game.combat.getItem?.(m[1])) return;
    ui.toast(text, color, duration, { icon, emblem });
  });
  bus.on(EV.DIALOGUE_OPEN, (payload) => ui.open('dialogue', payload));
  bus.on(EV.SCENE_CHANGED, () => {
    // Gameplay panels never survive a scene change (menu scenes manage their own).
    for (const n of ['pause', 'inventory', 'crafting', 'dialogue', 'settings']) if (ui.isOpen(n)) ui.close(n, true);
  });

  toasts = createToasts(game, ui);
  hud = createHud(game, ui);
  touch = createTouchControls(game, ui);
  return ui;
}
