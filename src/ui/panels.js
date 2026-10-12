// Modal panels (team: ui). Placeholder visuals; behaviour matches the contract.
// Panel shape: { update(game, dt) -> void, render(game, ctx) -> void }  (created per open()).
import { EV } from '../core/events.js';
import { equip, setLoadoutSlot, checkRequirements } from '../core/state.js';
import { ELEMENTS, ELEMENT_COLORS } from '../core/config.js';
import { drawText, wrapText, LINE_HEIGHT } from './font.js';

const COL = { text: '#f4f0ff', dim: '#8a80a8', gold: '#ffd25a', bad: '#ff6a6a', panel: 'rgba(20,12,40,0.92)', edge: '#7a5aff' };

export function box(ctx, x, y, w, h) {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COL.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Pointer taps (virtual px) that arrived this tick, not claimed by touch controls. */
function taps(game) {
  return game.input.pointerEvents.filter((e) => e.type === 'down');
}

/**
 * Vertical menu. items: [{label, onSelect, disabled?}]. Keyboard: up/down + confirm. Touch/mouse: tap.
 */
function createMenu(items, { title = '', subtitle = '', y = null, onCancel = null } = {}) {
  let sel = Math.max(0, items.findIndex((i) => !i.disabled));
  let rects = [];
  return {
    update(game) {
      const inp = game.input;
      const move = (d) => {
        for (let k = 0; k < items.length; k++) {
          sel = (sel + d + items.length) % items.length;
          if (!items[sel].disabled) break;
        }
        game.audio.sfx('ui_move');
      };
      if (inp.pressed('up')) move(-1);
      if (inp.pressed('down')) move(1);
      if (inp.pressed('confirm') || inp.pressed('interact')) { game.audio.sfx('ui_select'); items[sel]?.onSelect?.(); return; }
      if (onCancel && inp.pressed('cancel')) { game.audio.sfx('ui_back'); onCancel(); return; }
      for (const t of taps(game)) {
        const i = rects.findIndex((r) => t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
        if (i >= 0 && !items[i].disabled) { sel = i; game.audio.sfx('ui_select'); items[i].onSelect?.(); return; }
      }
    },
    render(game, ctx) {
      const W = game.display.width, H = game.display.height;
      let cy = y ?? Math.round(H * 0.3);
      if (title) { drawText(ctx, title, W / 2, cy, { scale: 3, align: 'center', color: COL.gold }); cy += 26; }
      if (subtitle) { drawText(ctx, subtitle, W / 2, cy, { align: 'center', color: COL.dim }); cy += 14; }
      cy += 8;
      rects = items.map((it, i) => {
        const r = { x: W / 2 - 60, y: cy + i * 18 - 4, w: 120, h: 15 };
        if (i === sel) { ctx.fillStyle = 'rgba(122,90,255,0.35)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
        drawText(ctx, (i === sel ? '> ' : '') + it.label, W / 2, cy + i * 18, { align: 'center', scale: 1, color: it.disabled ? COL.dim : i === sel ? COL.gold : COL.text });
        return r;
      });
    },
  };
}

// ------------------------------------------------------------------ panel factories

export const PANELS = {
  title(game, ui, data) {
    const items = [];
    if (data.canContinue) items.push({ label: 'Continue', onSelect: () => game.bus.emit(EV.MENU_CONTINUE, {}) });
    items.push({ label: 'New Game', onSelect: () => game.bus.emit(EV.MENU_NEW_GAME, {}) });
    const menu = createMenu(items, { title: 'Arcania Academy', subtitle: 'A spell-crafting adventure' });
    return {
      update: (g) => menu.update(g),
      render(g, ctx) {
        menu.render(g, ctx);
        const hint = g.input.isTouchDevice ? 'Tap to choose' : 'Arrows + Enter  |  WASD move  1-4 cast  E talk';
        drawText(ctx, hint, g.display.width / 2, g.display.height - 16 - g.display.safe.bottom, { align: 'center', color: COL.dim });
      },
    };
  },

  pause(game, ui) {
    const menu = createMenu([
      { label: 'Resume', onSelect: () => { ui.close('pause'); game.bus.emit(EV.MENU_RESUME, {}); } },
      { label: 'Inventory', onSelect: () => { ui.close('pause'); ui.open('inventory'); } },
      { label: 'Quit to Title', onSelect: () => { ui.close('pause'); game.bus.emit(EV.MENU_QUIT_TO_TITLE, {}); } },
    ], { title: 'Paused', onCancel: () => ui.close('pause') });
    return {
      update(g) {
        if (g.input.pressed('pause')) { ui.close('pause'); return; }
        menu.update(g);
      },
      render(g, ctx) {
        ctx.fillStyle = 'rgba(5,3,10,0.6)';
        ctx.fillRect(0, 0, g.display.width, g.display.height);
        menu.render(g, ctx);
      },
    };
  },

  gameover(game, ui, data) {
    const menu = createMenu([{ label: 'Respawn at the Academy', onSelect: () => game.bus.emit(EV.MENU_RESPAWN, {}) }],
      { title: 'You have fallen', subtitle: `Deaths: ${data.deaths ?? 0}` });
    return { update: (g) => menu.update(g), render: (g, ctx) => menu.render(g, ctx) };
  },

  victory(game, ui, data) {
    const s = data.stats || {};
    const menu = createMenu([{ label: 'Return to Title', onSelect: () => game.bus.emit(EV.MENU_QUIT_TO_TITLE, {}) }],
      { title: 'Victory!', subtitle: `The Archmage is free.  Kills ${s.kills ?? 0}  Deaths ${s.deaths ?? 0}` });
    return { update: (g) => menu.update(g), render: (g, ctx) => menu.render(g, ctx) };
  },

  inventory(game, ui) {
    let sel = 0;
    const entries = () => [
      ...game.state.inventory.map((s) => ({ type: 'item', id: s.id, qty: s.qty })),
      ...game.state.spells.known.map((id) => ({ type: 'spell', id })),
    ];
    return {
      update(g) {
        const inp = g.input;
        const list = entries();
        if (inp.pressed('inventory') || inp.pressed('cancel') || inp.pressed('pause')) { ui.close('inventory'); return; }
        if (inp.pressed('up')) sel = (sel - 1 + list.length) % Math.max(1, list.length);
        if (inp.pressed('down')) sel = (sel + 1) % Math.max(1, list.length);
        const e = list[sel];
        if (!e) return;
        if (e.type === 'item' && (inp.pressed('confirm') || inp.pressed('interact'))) {
          const item = g.combat.getItem(e.id);
          if (item?.slot === 'staff' || item?.slot === 'robe') equip(g, item.slot, e.id);
          else if (item?.use) g.combat.useItem(g, e.id);
        }
        if (e.type === 'spell') for (let i = 0; i < 4; i++) if (inp.pressed('spell' + (i + 1))) setLoadoutSlot(g, i, e.id);
        for (const t of taps(g)) if (t.y < 20) ui.close('inventory');
      },
      render(g, ctx) {
        const W = g.display.width, H = g.display.height;
        const x = 16, y = 16, w = W - 32, h = H - 32;
        box(ctx, x, y, w, h);
        drawText(ctx, 'Inventory & Spells  (Enter: equip/use, 1-4: bind spell, Esc: close)', x + 6, y + 6, { color: COL.gold });
        const list = entries();
        sel = Math.min(sel, Math.max(0, list.length - 1));
        list.forEach((e, i) => {
          const ly = y + 20 + i * 10;
          if (ly > y + h - 12) return;
          let label;
          if (e.type === 'item') {
            const it = g.combat.getItem(e.id);
            const eq = Object.values(g.state.equipped).includes(e.id) ? ' [E]' : '';
            label = `${it?.name || e.id} x${e.qty}${eq}`;
          } else {
            const sp = g.combat.getSpell(e.id);
            const slot = g.state.loadout.indexOf(e.id);
            label = `* ${sp?.name || e.id}${slot >= 0 ? `  [${slot + 1}]` : ''}`;
          }
          drawText(ctx, (i === sel ? '> ' : '  ') + label, x + 8, ly, { color: i === sel ? COL.gold : COL.text });
        });
        const p = g.state.player;
        drawText(ctx, `HP ${Math.ceil(p.hp)}/${p.maxHp}\nMANA ${Math.floor(p.mana)}/${p.maxMana}\nREGEN ${p.manaRegen.toFixed(1)}/S\nPOWER ${Math.round(p.spellPower * 100)}%`, x + w - 90, y + 20, { color: COL.text });
      },
    };
  },

  crafting(game, ui) {
    let sel = 0;
    return {
      update(g) {
        const inp = g.input;
        const recipes = g.combat.listRecipes();
        if (inp.pressed('cancel') || inp.pressed('craft') || inp.pressed('pause')) { ui.close('crafting'); return; }
        if (inp.pressed('up')) sel = (sel - 1 + recipes.length) % recipes.length;
        if (inp.pressed('down')) sel = (sel + 1) % recipes.length;
        if (inp.pressed('confirm') || inp.pressed('interact')) g.combat.craft(g, recipes[sel].id);
        for (const t of taps(g)) if (t.y < 20) ui.close('crafting');
      },
      render(g, ctx) {
        const W = g.display.width, H = g.display.height;
        const x = 16, y = 16, w = W - 32, h = H - 32;
        box(ctx, x, y, w, h);
        drawText(ctx, 'Arcane Forge  (Enter: craft, Esc: close)', x + 6, y + 6, { color: COL.gold });
        let fx = x + 6;
        for (const el of ELEMENTS) {
          drawText(ctx, `${el} ${g.state.fragments[el]}`, fx, y + 16, { color: ELEMENT_COLORS[el][0] });
          fx += 70;
        }
        g.combat.listRecipes().forEach((r, i) => {
          const spell = g.combat.getSpell(r.result);
          const chk = g.combat.canCraft(g.state, r.id);
          const cost = Object.entries(r.cost).map(([k, v]) => `${v} ${k}`).join(', ');
          const status = chk.ok ? 'READY' : chk.reason.toUpperCase();
          drawText(ctx, `${i === sel ? '> ' : '  '}${r.inputs.join(' + ')} = ${spell?.name || r.result}   (${cost})  ${status}`,
            x + 8, y + 32 + i * 10, { color: i === sel ? COL.gold : chk.ok ? COL.text : COL.dim });
        });
      },
    };
  },

  dialogue(game, ui, data) {
    const { dialogue, npcId, dialogueId, speakers = {} } = data;
    let node = null, nodeId = null, chars = 0, choiceSel = 0;
    const visibleChoices = () => (node?.choices || []).filter((c) => checkRequirements(game.state, c.requires));
    /** Box geometry shared by update (tap hit-test) and render. */
    const layout = (g) => {
      const n = chars >= (node?.text.length ?? 0) ? visibleChoices().length : 0;
      const W = g.display.width, bottom = g.display.height - g.display.safe.bottom - 6;
      const h = 30 + n * 9, x = 12, w = W - 24, y = bottom - h;
      return { x, y, w, h, choiceY: y + 28 };
    };
    const enter = (id) => {
      if (id == null || !dialogue.nodes[id]) {
        ui.close('dialogue');
        game.bus.emit(EV.DIALOGUE_CLOSED, { npcId, dialogueId });
        return;
      }
      nodeId = id;
      node = dialogue.nodes[id];
      chars = 0;
      choiceSel = 0;
      for (const action of node.actions || []) game.bus.emit(EV.DIALOGUE_ACTION, { action, npcId, dialogueId });
    };
    enter(dialogue.start);
    return {
      update(g, dt) {
        if (!node) return;
        chars += dt * 60;
        const inp = g.input;
        const choices = visibleChoices();
        const advance = inp.pressed('confirm') || inp.pressed('interact') || taps(g).length > 0;
        if (chars < node.text.length) { if (advance) chars = node.text.length; return; }
        if (choices.length) {
          if (inp.pressed('up')) choiceSel = (choiceSel - 1 + choices.length) % choices.length;
          if (inp.pressed('down')) choiceSel = (choiceSel + 1) % choices.length;
          for (const t of taps(g)) {
            const i = Math.floor((t.y - layout(g).choiceY + 2) / 9);
            if (i >= 0 && i < choices.length) { choiceSel = i; pick(); return; }
          }
          if (inp.pressed('confirm') || inp.pressed('interact')) pick();
          if (inp.pressed('cancel')) enter(null);
          return;
        }
        if (advance || inp.pressed('cancel')) enter(node.next ?? null);
        function pick() {
          const c = choices[choiceSel];
          for (const action of c.actions || []) g.bus.emit(EV.DIALOGUE_ACTION, { action, npcId, dialogueId });
          enter(c.next ?? null);
        }
      },
      render(g, ctx) {
        if (!node) return;
        const { x, y, w, h, choiceY } = layout(g);
        box(ctx, x, y, w, h);
        const sp = speakers[node.speaker] || { name: node.speaker || '' };
        drawText(ctx, sp.name, x + 6, y + 4, { color: COL.gold });
        const lines = wrapText(node.text.slice(0, Math.floor(chars)), w - 12);
        lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, x + 6, y + 13 + i * LINE_HEIGHT));
        if (chars >= node.text.length) {
          const choices = visibleChoices();
          choices.forEach((c, i) => drawText(ctx, (i === choiceSel ? '> ' : '  ') + c.text, x + 10, choiceY + i * 9, { color: i === choiceSel ? COL.gold : COL.text }));
          if (!choices.length && Math.floor(g.realTime * 2) % 2) drawText(ctx, 'v', x + w - 10, y + h - 9, { color: COL.gold });
        }
      },
    };
  },
};
