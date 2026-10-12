// Bag: inventory, equipment and spell loadout panel (team: ui).
//
// Items tab: item grid (rarity borders, qty, equipped badge), staff/robe slots, character stats
// with live stat comparison for the focused gear, detail box with an action button.
// Spells tab: known spells grid, the 4 loadout slots (keys 1-4), detail box. Bind with 1-4 while a
// spell is focused, Enter/tap a spell then a slot, or drag a spell onto a slot.
//
// Keys: arrows navigate (tab row: left/right switches tab), Enter/Space/E acts, 1-4 binds,
// Backspace drops a held spell, I/Tab/Esc closes. Touch: first tap focuses, second tap acts.
//
// hits ids: inv-close, inv-tab-items, inv-tab-spells, inv-item-<index>, inv-equip-staff,
//           inv-equip-robe, inv-action, inv-spell-<spellId>, inv-slot-<i>
import { equip, unequip, setLoadoutSlot } from '../../core/state.js';
import { COL, RARITY, rarityOf, panel, inset, button, rrect, drawEmblem, keycap, sparkle, mix, rgba, clamp, easeOutBack, elColor, dim, drawRing } from '../theme.js';
import { drawText, measureText, wrapText } from '../font.js';
import { createHits, drawPrompt, promptDevice } from '../widgets.js';
import * as K from './craft-kit.js';

const CELL = 20, PITCH = 22;
const EQUIP = ['staff', 'robe'];
const TABS = [{ id: 'items', label: 'ITEMS' }, { id: 'spells', label: 'SPELLS' }];

export function inventoryPanel(game, ui, data = {}) {
  const C = game.combat || {};
  const hits = createHits();
  const sparks = K.createSparks(160);
  const sfx = (name, opts) => { try { game.audio?.sfx?.(name, opts); } catch { /* ignore */ } };
  const call = (fn, fb) => { try { return fn(); } catch (err) { console.warn('[inventory]', err); return fb; } };
  const getItem = (id) => (id ? call(() => C.getItem?.(id), null) : null);
  const getSpell = (id) => (id ? call(() => C.getSpell?.(id), null) : null);

  let T = 0;
  let tab = data?.tab === 'spells' ? 'spells' : 'items';
  let foc = { zone: 'grid', i: 0 };
  let held = null; // spell id picked up for binding
  let drag = null; // {spellId, x, y, active}
  let gridScroll = 0, listScroll = 0; // in rows
  const pop = { staff: -9, robe: -9 };
  const slotPop = [-9, -9, -9, -9];
  let msg = '', msgT = -9, shakeT = 0;
  let cmp = { key: '', rows: null };
  let L = null;
  let wheel = 0;
  const tabRects = [];
  const onWheel = (e) => { wheel += e.deltaY || 0; };
  window.addEventListener('wheel', onWheel, { passive: true });

  // ---------------------------------------------------------------- data
  const inv = () => game.state.inventory || [];
  /** Visible item entries: [{index, id, qty, item}] (index = position in state.inventory). */
  function items() {
    const out = [];
    inv().forEach((s, index) => { if (s && s.id && (s.qty ?? 1) > 0) out.push({ index, id: s.id, qty: s.qty ?? 1, item: getItem(s.id) }); });
    return out;
  }
  function spells() {
    const out = [];
    for (const id of game.state.spells?.known || []) {
      const sp = getSpell(id);
      if (sp && !sp.hidden) out.push({ id, spell: sp });
    }
    return out;
  }
  const equippedSlotOf = (id) => EQUIP.find((s) => game.state.equipped?.[s] === id) || null;
  const isGear = (it) => it && (it.slot === 'staff' || it.slot === 'robe');

  function focusedEntry() {
    if (foc.zone === 'tabs') {
      // preview the first entry while the tab row is focused
      if (tab === 'items') { const e = items()[0]; return e ? { kind: 'item', id: e.id, item: e.item, qty: e.qty, index: e.index } : null; }
      const e = spells()[0];
      return e ? { kind: 'spell', id: e.id, spell: e.spell } : null;
    }
    if (tab === 'items') {
      if (foc.zone === 'equip') {
        const slot = EQUIP[foc.i] || 'staff';
        const id = game.state.equipped?.[slot] || null;
        return { kind: 'item', id, item: getItem(id), slot, fromEquip: true, qty: id ? countOf(id) : 0 };
      }
      if (foc.zone === 'grid') {
        const e = items()[foc.i];
        return e ? { kind: 'item', id: e.id, item: e.item, qty: e.qty, index: e.index } : null;
      }
      return null;
    }
    if (foc.zone === 'slots') {
      const id = game.state.loadout?.[foc.i] || null;
      return id ? { kind: 'spell', id, spell: getSpell(id), slotIndex: foc.i } : { kind: 'slot', slotIndex: foc.i };
    }
    if (foc.zone === 'list') {
      const e = spells()[foc.i];
      return e ? { kind: 'spell', id: e.id, spell: e.spell } : null;
    }
    return null;
  }
  const countOf = (id) => inv().find((s) => s.id === id)?.qty ?? 0;

  function actionLabel(e) {
    if (!e || e.kind !== 'item' || !e.id || !e.item) return null;
    const it = e.item;
    if (isGear(it)) return equippedSlotOf(e.id) ? 'UNEQUIP' : 'EQUIP';
    if (it.use) return 'USE';
    return null;
  }

  // ---------------------------------------------------------------- actions
  function say(text, bad = false) {
    msg = text; msgT = T;
    if (bad) { shakeT = 0.45; sfx('ui_error'); }
  }
  function close() {
    sfx('ui_close');
    ui.close('inventory');
  }
  function equipBurst(slot) {
    pop[slot] = T;
    const r = L?.equip?.[slot];
    if (r) sparks.burst(r.x + r.w / 2, r.y + r.h / 2, 22, [COL.gold, COL.goldHi, '#ffffff'], 60, 0.55);
  }
  function act(e) {
    if (!e || e.kind !== 'item' || !e.id) return;
    const it = e.item;
    if (isGear(it)) {
      const slot = it.slot;
      const was = game.state.equipped?.[slot];
      const ok = was === e.id ? call(() => unequip(game, slot), false) : call(() => equip(game, slot, e.id), false);
      if (ok) equipBurst(slot); else say('Cannot equip that', true);
      cmp.key = '';
      return;
    }
    if (it?.use) {
      const ok = call(() => C.useItem?.(game, e.id), false);
      if (!ok) say('Cannot use now', true);
      else { const r = cellRect(e.index); if (r) sparks.burst(r.x + r.w / 2, r.y + r.h / 2, 14, ['#ff9aa4', '#a8d0ff', '#ffffff'], 45, 0.5); }
      return;
    }
    say(it ? `${it.name || 'It'} can't be used` : 'Nothing to do', true);
  }
  function bind(slot, spellId) {
    if (!spellId) return;
    if (call(() => setLoadoutSlot(game, slot, spellId), false)) {
      slotPop[slot] = T;
      sfx('ui_select', { pitch: 1.15 });
      const r = L?.slots?.[slot];
      const sp = getSpell(spellId);
      if (r) sparks.burst(r.x + r.w / 2, r.y + r.h / 2, 20, [COL.gold, elColor(sp?.element, 0), elColor(sp?.element, 1)], 60, 0.55);
      held = null;
    } else say('Cannot bind that', true);
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    const R = K.safeRect(game, 3);
    const o = { R };
    const pad = 5;
    const cx = R.x + pad, cw = R.w - pad * 2;
    o.close = { x: R.x + R.w - 21, y: R.y + 4, w: 17, h: 17 };
    o.tabsY = R.y + 4;
    const bodyY = R.y + 26;
    const bodyH = R.y + R.h - pad - bodyY;
    o.body = { x: cx, y: bodyY, w: cw, h: bodyH };
    o.wide = cw >= 360 && bodyH >= 150;
    if (o.wide) {
      const lw = clamp(Math.round(cw * 0.27), 104, 160);
      const dw = clamp(Math.round(cw * 0.33), 128, 200);
      const gw = cw - lw - dw - 8;
      o.left = { x: cx, y: bodyY, w: lw, h: bodyH };
      o.grid = { x: cx + lw + 4, y: bodyY + 11, w: gw, h: bodyH - 11 };
      o.detail = { x: cx + lw + 4 + gw + 4, y: bodyY, w: dw, h: bodyH };
    } else {
      // stacked: [left block (equip+stats | loadout)] [grid] [detail]
      const topH = tab === 'items' ? 92 : 56;
      o.left = { x: cx, y: bodyY, w: cw, h: topH };
      const detailH = clamp(Math.round(bodyH * 0.3), 110, 170);
      const gh = Math.max(PITCH * 2, bodyH - topH - 11 - 4 - detailH);
      o.grid = { x: cx, y: bodyY + topH + 11, w: cw, h: gh };
      o.detail = { x: cx, y: o.grid.y + gh + 4, w: cw, h: Math.max(50, R.y + R.h - pad - (o.grid.y + gh + 4)) };
    }
    const G = o.grid;
    o.cols = Math.max(1, Math.floor((G.w + 2) / PITCH));
    o.rows = Math.max(1, Math.floor((G.h + 2) / PITCH));
    o.gx = G.x + Math.floor((G.w - (o.cols * PITCH - 2)) / 2);
    // equipment / loadout slots
    const Lf = o.left;
    o.equip = {};
    o.slots = [];
    if (tab === 'items') {
      const es = 26;
      if (o.wide) {
        o.equip.staff = { x: Lf.x + 4, y: Lf.y + 11, w: es, h: es };
        o.equip.robe = { x: Lf.x + 4 + es + 18, y: Lf.y + 11, w: es, h: es };
        o.stats = { x: Lf.x, y: Lf.y + 11 + es + 14, w: Lf.w, h: Lf.h - (11 + es + 14) };
      } else {
        o.equip.staff = { x: Lf.x + 4, y: Lf.y + 11, w: es, h: es };
        o.equip.robe = { x: Lf.x + 4, y: Lf.y + 11 + es + 14, w: es, h: es };
        o.stats = { x: Lf.x + 50, y: Lf.y, w: Lf.w - 50, h: Lf.h };
      }
    } else {
      const ss = 26;
      if (o.wide) {
        for (let i = 0; i < 4; i++) o.slots.push({ x: Lf.x + 6 + (i % 2) * (ss + 12), y: Lf.y + 13 + Math.floor(i / 2) * (ss + 10), w: ss, h: ss });
      } else {
        const gap = 12, total = 4 * ss + 3 * gap;
        const x0 = Lf.x + Math.floor((Lf.w - total) / 2);
        for (let i = 0; i < 4; i++) o.slots.push({ x: x0 + i * (ss + gap), y: Lf.y + 13, w: ss, h: ss });
      }
    }
    return o;
  }
  function cellRect(invIndex) {
    if (!L) return null;
    const list = items();
    const k = list.findIndex((e) => e.index === invIndex);
    if (k < 0) return null;
    return cellAt(k, gridScroll);
  }
  function cellAt(k, scroll) {
    const row = Math.floor(k / L.cols) - scroll, col = k % L.cols;
    if (row < 0 || row >= L.rows) return null;
    return { x: L.gx + col * PITCH, y: L.grid.y + row * PITCH, w: CELL, h: CELL };
  }
  function ensureVisible(k) {
    if (!L) return;
    const row = Math.floor(k / L.cols);
    if (tab === 'items') {
      if (row < gridScroll) gridScroll = row;
      if (row >= gridScroll + L.rows) gridScroll = row - L.rows + 1;
    } else {
      if (row < listScroll) listScroll = row;
      if (row >= listScroll + L.rows) listScroll = row - L.rows + 1;
    }
  }
  const maxScrollRows = (n) => (L ? Math.max(0, Math.ceil(n / L.cols) - L.rows) : 0);

  // ---------------------------------------------------------------- input
  function setFocus(zone, i, sound = true) {
    if (foc.zone === zone && foc.i === i) return;
    foc = { zone, i };
    if (sound) sfx('ui_move');
    if (zone === 'grid' || zone === 'list') ensureVisible(i);
  }
  function switchTab(id) {
    if (id === tab) return;
    tab = id;
    held = null; drag = null; msgT = -9;
    sfx('ui_tab');
    L = layout();
  }

  function navigate(inp) {
    const n = tab === 'items' ? items().length : spells().length;
    const cols = L.cols;
    const { zone, i } = foc;
    const up = inp.pressed('up'), down = inp.pressed('down'), left = inp.pressed('left'), right = inp.pressed('right');
    if (!(up || down || left || right)) return;
    if (zone === 'tabs') {
      if (left || right) {
        const k = clamp(TABS.findIndex((t) => t.id === tab) + (left ? -1 : 1), 0, TABS.length - 1);
        switchTab(TABS[k].id);
        foc = { zone: 'tabs', i: k };
      } else if (down) setFocus(tab === 'items' ? (n ? 'grid' : 'equip') : 'slots', 0);
      return;
    }
    if (tab === 'items') {
      if (zone === 'equip') {
        if (L.wide) {
          if (left && i > 0) setFocus('equip', i - 1);
          else if (right) { if (i < 1) setFocus('equip', 1); else if (n) setFocus('grid', 0); }
          else if (up) setFocus('tabs', 0);
          else if (down && n) setFocus('grid', 0);
        } else {
          if (up) { if (i > 0) setFocus('equip', 0); else setFocus('tabs', 0); }
          else if (down) { if (i < 1) setFocus('equip', 1); else if (n) setFocus('grid', 0); }
          else if (right && n) setFocus('grid', 0);
        }
        return;
      }
      if (zone === 'grid') {
        const r = Math.floor(i / cols), c = i % cols;
        if (left) { if (c > 0) setFocus('grid', i - 1); else if (L.wide) setFocus('equip', 1); }
        else if (right) { if (c < cols - 1 && i + 1 < n) setFocus('grid', i + 1); }
        else if (up) { if (r > 0) setFocus('grid', i - cols); else setFocus(L.wide ? 'tabs' : 'equip', L.wide ? 0 : 1); }
        else if (down) { if (i + cols < n) setFocus('grid', i + cols); else if (r < Math.ceil(n / cols) - 1) setFocus('grid', n - 1); }
        return;
      }
    } else {
      if (zone === 'slots') {
        if (L.wide) {
          const r = Math.floor(i / 2), c = i % 2;
          if (left && c > 0) setFocus('slots', i - 1);
          else if (right) { if (c < 1) setFocus('slots', i + 1); else if (n) setFocus('list', 0); }
          else if (up) { if (r > 0) setFocus('slots', i - 2); else setFocus('tabs', 1); }
          else if (down) { if (r < 1) setFocus('slots', i + 2); else if (n) setFocus('list', 0); }
        } else {
          if (left && i > 0) setFocus('slots', i - 1);
          else if (right && i < 3) setFocus('slots', i + 1);
          else if (up) setFocus('tabs', 1);
          else if (down && n) setFocus('list', Math.min(n - 1, i));
        }
        return;
      }
      if (zone === 'list') {
        const r = Math.floor(i / cols), c = i % cols;
        if (left) { if (c > 0) setFocus('list', i - 1); else if (L.wide) setFocus('slots', 1); }
        else if (right) { if (c < cols - 1 && i + 1 < n) setFocus('list', i + 1); }
        else if (up) { if (r > 0) setFocus('list', i - cols); else setFocus(L.wide ? 'tabs' : 'slots', L.wide ? 1 : Math.min(3, c)); }
        else if (down) { if (i + cols < n) setFocus('list', i + cols); else if (r < Math.ceil(n / cols) - 1) setFocus('list', n - 1); }
      }
    }
  }

  function confirm() {
    const e = focusedEntry();
    if (tab === 'items') {
      if (foc.zone === 'tabs') { foc = { zone: items().length ? 'grid' : 'equip', i: 0 }; sfx('ui_select'); return; }
      if (e?.fromEquip && !e.id) { say('Nothing equipped'); sfx('ui_back'); return; }
      act(e);
      return;
    }
    if (foc.zone === 'tabs') { foc = { zone: 'slots', i: 0 }; sfx('ui_select'); return; }
    if (foc.zone === 'list' && e?.id) {
      held = held === e.id ? null : e.id;
      sfx(held ? 'ui_select' : 'ui_back');
      if (held) {
        const cur = game.state.loadout.indexOf(held);
        const empty = game.state.loadout.indexOf(null);
        foc = { zone: 'slots', i: cur >= 0 ? cur : empty >= 0 ? empty : 0 };
      }
      return;
    }
    if (foc.zone === 'slots') {
      if (held) { bind(foc.i, held); return; }
      const id = game.state.loadout[foc.i];
      if (id) { held = id; sfx('ui_select'); }
    }
  }

  // ---------------------------------------------------------------- update
  function update(g, dt) {
    T += dt;
    sparks.update(dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    const inp = g.input;
    const events = hits.poll(inp);
    if (!L) return;
    if (inp.pressed('inventory') || inp.pressed('pause')) { close(); return; }
    if (inp.pressed('cancel')) {
      if (held) { held = null; sfx('ui_back'); } else { close(); return; }
    }
    // clamp focus to data
    const n = tab === 'items' ? items().length : spells().length;
    if ((foc.zone === 'grid' || foc.zone === 'list') && foc.i >= n) foc = n ? { zone: foc.zone, i: n - 1 } : { zone: tab === 'items' ? 'equip' : 'slots', i: 0 };
    if (tab === 'items' && foc.zone === 'list') foc = { zone: 'grid', i: 0 };
    if (tab === 'spells' && (foc.zone === 'grid' || foc.zone === 'equip')) foc = { zone: 'list', i: 0 };

    if (wheel) {
      const m = inp.mouse;
      if (K.inRect(L.grid, m.x, m.y)) {
        const d = Math.sign(wheel);
        if (tab === 'items') gridScroll = clamp(gridScroll + d, 0, maxScrollRows(n));
        else listScroll = clamp(listScroll + d, 0, maxScrollRows(n));
      }
      wheel = 0;
    }

    for (const e of events) {
      const d = e.data;
      if (e.type === 'hover') {
        if (d?.zone && !(d.zone === foc.zone && d.i === foc.i)) { foc = { zone: d.zone, i: d.i }; sfx('ui_hover'); }
        continue;
      }
      if (e.type === 'press') {
        if (d?.spellId && tab === 'spells') drag = { spellId: d.spellId, x: e.x, y: e.y, active: false, from: e.id };
        continue;
      }
      if (e.type === 'drag') {
        if (drag) { drag.x = e.x; drag.y = e.y; drag.active = true; }
        else if (e.scroll && (e.id === 'inv-gridarea' || String(e.id).startsWith('inv-item-'))) {
          // drag-scroll the grid (rows)
          dragAcc += e.dy;
          while (dragAcc <= -PITCH) { dragAcc += PITCH; if (tab === 'items') gridScroll = clamp(gridScroll + 1, 0, maxScrollRows(n)); else listScroll = clamp(listScroll + 1, 0, maxScrollRows(n)); }
          while (dragAcc >= PITCH) { dragAcc -= PITCH; if (tab === 'items') gridScroll = clamp(gridScroll - 1, 0, maxScrollRows(n)); else listScroll = clamp(listScroll - 1, 0, maxScrollRows(n)); }
        }
        continue;
      }
      if (e.type === 'release') {
        dragAcc = 0;
        if (drag?.active) {
          const r = hits.find(e.x, e.y);
          const m = r && /^inv-slot-(\d)$/.exec(r.id);
          if (m) bind(+m[1], drag.spellId);
          drag = null;
          continue;
        }
        drag = null;
        continue;
      }
      if (e.type !== 'click') continue;
      onClick(e, d, inp);
      if (!ui.isOpen('inventory')) return;
    }
    navigate(inp);
    for (let i = 0; i < 4; i++) {
      if (!inp.pressed('spell' + (i + 1))) continue;
      const fe = focusedEntry();
      const id = held || (tab === 'spells' && fe?.kind === 'spell' ? fe.id : null);
      if (id) bind(i, id);
      else if (tab === 'items') { switchTab('spells'); foc = { zone: 'slots', i }; }
    }
    if (inp.pressed('confirm') || inp.pressed('interact')) confirm();
  }
  let dragAcc = 0;

  function onClick(e, d, inp) {
    const id = e.id;
    if (id === 'inv-close') { close(); return; }
    if (id === 'inv-tab-items' || id === 'inv-tab-spells') {
      switchTab(id.slice(8));
      const n = tab === 'items' ? items().length : spells().length;
      foc = n ? { zone: tab === 'items' ? 'grid' : 'list', i: 0 } : { zone: tab === 'items' ? 'equip' : 'slots', i: 0 };
      return;
    }
    if (id === 'inv-action') { act(focusedEntry()); return; }
    if (!d?.zone) return;
    const same = foc.zone === d.zone && foc.i === d.i;
    const mouse = inp.lastDevice === 'mouse';
    if (tab === 'items') {
      foc = { zone: d.zone, i: d.i };
      if (same || mouse) {
        const fe = focusedEntry();
        if (fe?.id) act(fe);
      } else sfx('ui_move');
      return;
    }
    // spells tab
    if (d.zone === 'list') {
      foc = { zone: 'list', i: d.i };
      const sp = spells()[d.i];
      if (!sp) return;
      held = held === sp.id ? null : sp.id;
      sfx(held ? 'ui_select' : 'ui_back');
      return;
    }
    if (d.zone === 'slots') {
      foc = { zone: 'slots', i: d.i };
      if (held) { bind(d.i, held); return; }
      const cur = game.state.loadout[d.i];
      if (cur) { held = cur; sfx('ui_select'); } else sfx('ui_move');
    }
  }

  // ---------------------------------------------------------------- render
  function render(g, ctx, age) {
    hits.begin();
    L = layout();
    const W = g.display.width, H = g.display.height;
    const io = K.intro(age);
    dim(ctx, W, H, 0.6 * io.k);
    const t = g.realTime ?? T;
    ctx.save();
    ctx.globalAlpha = io.alpha;
    ctx.translate(0, io.dy);
    const R = L.R;
    panel(ctx, R.x, R.y, R.w, R.h, { fill: '#170f2a', fill2: '#1a1130', glow: rgba(COL.edge, 0.25) });
    // header: tabs + title + close
    const focTab = foc.zone === 'tabs' ? TABS[foc.i]?.id : null;
    K.drawTabs(ctx, TABS, R.x + 6, L.tabsY, 15, tab, focTab, t, tabRects);
    for (const r of tabRects) hits.add('inv-tab-' + r.id, r.x, r.y, r.w, r.h, null, { pad: 2 });
    const tabsEnd = tabRects.length ? tabRects[tabRects.length - 1].x + tabRects[tabRects.length - 1].w : R.x + 60;
    const title = tab === 'items' ? 'BAG' : 'SPELLBOOK';
    if (tabsEnd + measureText(title) * 2 + 10 < L.close.x - 4) drawText(ctx, title, L.close.x - 6, L.tabsY + 2, { align: 'right', scale: 2, color: COL.gold, shadow: COL.goldLo });
    ctx.fillStyle = COL.edgeLo;
    ctx.fillRect(R.x + 4, L.tabsY + 16, R.w - 8, 1);
    K.drawClose(ctx, L.close.x, L.close.y, L.close.w, hits.hoverId === 'inv-close', hits.isPressed('inv-close'));
    hits.add('inv-close', L.close.x, L.close.y, L.close.w, L.close.h, null, { pad: 3 });

    if (tab === 'items') { drawEquip(ctx, t); drawStats(ctx, t); drawItemGrid(ctx, t); }
    else { drawLoadout(ctx, t); drawSpellGrid(ctx, t); }
    drawDetail(ctx, t);
    ctx.restore();
    sparks.render(ctx);
    // dragged spell follows the pointer
    if (drag?.active) {
      const sp = getSpell(drag.spellId);
      ctx.globalAlpha = 0.85;
      game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + drag.spellId, Math.round(drag.x) - 8, Math.round(drag.y) - 8, { size: 16 });
      ctx.globalAlpha = 1;
    }
  }

  // ---- items tab
  function drawSilhouette(ctx, slot, x, y, w, h) {
    ctx.fillStyle = '#2a2048';
    const cx = x + Math.round(w / 2), cy = y + Math.round(h / 2);
    if (slot === 'staff') {
      for (let i = 0; i < 12; i++) ctx.fillRect(cx - 5 + i, cy + 6 - i, 2, 1);
      ctx.fillRect(cx + 4, cy - 9, 4, 4);
      ctx.fillRect(cx + 5, cy - 10, 2, 6);
    } else {
      ctx.fillRect(cx - 3, cy - 8, 6, 3);
      ctx.fillRect(cx - 5, cy - 5, 10, 4);
      ctx.fillRect(cx - 6, cy - 1, 12, 5);
      ctx.fillRect(cx - 7, cy + 4, 14, 4);
      ctx.fillStyle = '#1c1434';
      ctx.fillRect(cx, cy - 5, 1, 13);
    }
  }

  function drawEquip(ctx, t) {
    K.caption(ctx, 'EQUIPPED', L.left.x + 1, L.left.y + 1, L.wide ? L.left.w - 2 : 44, COL.gold);
    for (let k = 0; k < 2; k++) {
      const slot = EQUIP[k];
      const r = L.equip[slot];
      const id = 'inv-equip-' + slot;
      const itemId = game.state.equipped?.[slot] || null;
      const it = getItem(itemId);
      const focus = tab === 'items' && foc.zone === 'equip' && foc.i === k;
      const rar = rarityOf(it?.rarity);
      const pk = clamp((T - pop[slot]) / 0.35, 0, 1);
      rrect(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, COL.ink);
      rrect(ctx, r.x, r.y, r.w, r.h, focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : it ? rar.color : COL.edgeLo);
      ctx.fillStyle = it ? mix(rar.color, '#0b0716', 0.82) : '#0b0716';
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      if (it) {
        const lift = pk < 1 ? Math.round(-Math.sin(pk * Math.PI) * 3) : 0;
        game.art?.drawIcon?.(ctx, it.icon || 'item_' + itemId, r.x + Math.round((r.w - 16) / 2), r.y + Math.round((r.h - 16) / 2) + lift, { size: 16 });
      } else drawSilhouette(ctx, slot, r.x, r.y, r.w, r.h);
      if (pk < 1) drawRing(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.round(8 + pk * 14), rgba(COL.goldHi, 1 - pk));
      drawText(ctx, slot.toUpperCase(), r.x + r.w / 2, r.y + r.h + 3, { align: 'center', color: focus ? COL.goldHi : COL.dim });
      hits.add(id, r.x, r.y, r.w, r.h, { zone: 'equip', i: k }, { pad: 2 });
    }
  }

  /** Comparison stats if the focused gear were equipped (cached per item + equipment). */
  function comparison() {
    const e = focusedEntry();
    if (!e || e.kind !== 'item' || !isGear(e.item) || e.fromEquip) return null;
    if (game.state.equipped?.[e.item.slot] === e.id) return null;
    const key = e.id + '|' + JSON.stringify(game.state.equipped || {}) + '|' + JSON.stringify(game.state.player?.base || {});
    if (cmp.key === key) return cmp.rows;
    cmp.key = key;
    cmp.rows = call(() => {
      const clone = structuredClone(game.state);
      clone.equipped[e.item.slot] = e.id;
      C.computeStats(clone);
      return clone.player;
    }, null);
    return cmp.rows;
  }

  function statRows(p, q) {
    const rows = [
      { label: 'MAX HP', v: p.maxHp, n: q?.maxHp, f: (v) => K.fmt(v), color: COL.hpHi },
      { label: 'MAX MANA', v: p.maxMana, n: q?.maxMana, f: (v) => K.fmt(v), color: COL.manaHi },
      { label: 'REGEN', v: p.manaRegen, n: q?.manaRegen, f: (v) => (+v).toFixed(1) + '/S', color: COL.manaHi },
      { label: 'POWER', v: p.spellPower, n: q?.spellPower, f: (v) => Math.round(v * 100) + '%', color: COL.gold },
      { label: 'SPEED', v: p.moveSpeed, n: q?.moveSpeed, f: (v) => K.fmt(v), color: COL.good },
    ];
    const cdm = p.cooldownMult ?? 1, cdn = q ? q.cooldownMult ?? 1 : undefined;
    if (Math.abs(cdm - 1) > 1e-6 || (cdn != null && Math.abs(cdn - 1) > 1e-6)) rows.push({ label: 'COOLDOWN', v: cdm, n: cdn, f: (v) => Math.round(v * 100) + '%', color: COL.edgeHi, lowerBetter: true });
    const els = new Set([...Object.keys(p.elementPower || {}), ...Object.keys(q?.elementPower || {})]);
    for (const el of K.orderedElements([...els])) {
      const v = p.elementPower?.[el] || 0, nv = q ? q.elementPower?.[el] || 0 : undefined;
      if (!v && !nv) continue;
      rows.push({ label: el.toUpperCase(), el, v, n: nv, f: (x) => '+' + Math.round(x * 100) + '%', color: elColor(el, 1) });
    }
    return rows;
  }

  function drawStats(ctx, t) {
    const S = L.stats;
    const p = game.state.player || {};
    const q = comparison();
    K.caption(ctx, q ? 'IF EQUIPPED' : 'STATS', S.x + 1, S.y + 1, S.w - 2, q ? COL.goldHi : COL.gold);
    const rows = statRows(p, q);
    let y = S.y + 11;
    const right = S.x + S.w - 2;
    for (const r of rows) {
      if (y + 6 > S.y + S.h) break;
      let lx = S.x + 2;
      if (r.el) { drawEmblem(ctx, r.el, lx, y - 1); lx += 9; }
      drawText(ctx, r.label, lx, y, { color: COL.dim });
      const changed = q && r.n != null && Math.abs(r.n - r.v) > 1e-6;
      if (changed) {
        const better = r.lowerBetter ? r.n < r.v : r.n > r.v;
        const col = better ? COL.good : COL.bad;
        const arrow = r.n > r.v ? '▲' : '▼';
        const nv = r.f(r.n) + arrow;
        const cv = r.f(r.v) + '→';
        const nw = measureText(nv);
        drawText(ctx, nv, right, y, { align: 'right', color: col });
        if (lx + measureText(r.label) + 4 + measureText(cv) < right - nw - 1) drawText(ctx, cv, right - nw - 1, y, { align: 'right', color: COL.dimmer });
      } else drawText(ctx, r.f(r.v), right, y, { align: 'right', color: r.color });
      y += 9;
    }
  }

  function drawCell(ctx, x, y, opts) {
    const { border, fill = '#0b0716', focus, t, glowCol } = opts;
    if (glowCol) {
      const a = 0.25 + 0.2 * Math.sin(t * 3 + x * 0.1);
      ctx.fillStyle = rgba(glowCol, a);
      ctx.fillRect(x - 2, y - 1, CELL + 4, CELL + 2);
      ctx.fillRect(x - 1, y - 2, CELL + 2, CELL + 4);
    }
    rrect(ctx, x - 1, y - 1, CELL + 2, CELL + 2, COL.ink);
    rrect(ctx, x, y, CELL, CELL, focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : border);
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }

  function drawItemGrid(ctx, t) {
    const G = L.grid;
    const list = items();
    K.caption(ctx, `ITEMS ${list.length}`, G.x + 1, G.y - 10, G.w - 2, COL.gold);
    gridScroll = clamp(gridScroll, 0, maxScrollRows(list.length));
    hits.add('inv-gridarea', G.x, G.y, G.w, G.h, null, { drag: true });
    // empty slots fill the visible area
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      const k = (r + gridScroll) * L.cols + c;
      if (k < list.length) continue;
      const x = L.gx + c * PITCH, y = G.y + r * PITCH;
      rrect(ctx, x, y, CELL, CELL, '#1a1230');
      ctx.fillStyle = '#0f0a1c';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
    if (!list.length) {
      const msgY = G.y + Math.min(G.h / 2 - 4, 24);
      drawText(ctx, 'Your bag is empty', G.x + G.w / 2, msgY, { align: 'center', color: COL.dim });
      drawText(ctx, 'Loot drops in the dungeon!', G.x + G.w / 2, msgY + 10, { align: 'center', color: COL.dimmer });
    }
    list.forEach((e, k) => {
      const r = cellAt(k, gridScroll);
      if (!r) return;
      const it = e.item;
      const rar = rarityOf(it?.rarity);
      const focus = foc.zone === 'grid' && foc.i === k;
      const eqSlot = equippedSlotOf(e.id);
      const fancy = it?.rarity === 'epic' || it?.rarity === 'legendary';
      const sx = focus && shakeT > 0 ? K.shakeX(shakeT) : 0;
      drawCell(ctx, r.x + sx, r.y, { border: rar.color, fill: mix(rar.color, '#0b0716', 0.86), focus, t, glowCol: fancy ? rar.hi : null });
      if (it) game.art?.drawIcon?.(ctx, it.icon || 'item_' + e.id, r.x + 2 + sx, r.y + 2, { size: 16 });
      else drawText(ctx, '?', r.x + 10, r.y + 7, { align: 'center', color: COL.dim });
      if (fancy && Math.sin(t * 2.5 + k) > 0.7) sparkle(ctx, r.x + 3 + ((k * 7 + Math.floor(t)) % 14), r.y + 3, 1, rar.hi);
      if (e.qty > 1) drawText(ctx, String(e.qty), r.x + CELL - 1, r.y + CELL - 6, { align: 'right', color: '#ffffff', outline: COL.ink, shadow: null });
      if (eqSlot) {
        rrect(ctx, r.x, r.y, 7, 7, COL.goldLo);
        ctx.fillStyle = COL.gold; ctx.fillRect(r.x + 1, r.y + 1, 5, 5);
        drawText(ctx, 'E', r.x + 2, r.y + 1, { color: COL.ink, shadow: null });
      }
      hits.add('inv-item-' + e.index, r.x, r.y, CELL, CELL, { zone: 'grid', i: k }, { pad: 1, drag: true });
    });
    drawScrollbar(ctx, G, gridScroll, maxScrollRows(list.length));
  }

  function drawScrollbar(ctx, G, s, max) {
    if (max <= 0) return;
    const x = G.x + G.w - 2;
    const th = Math.max(6, Math.round(G.h / (max + 1)));
    const ty = G.y + Math.round((s / max) * (G.h - th));
    ctx.fillStyle = '#20163a'; ctx.fillRect(x, G.y, 2, G.h);
    ctx.fillStyle = COL.edge; ctx.fillRect(x, ty, 2, th);
  }

  // ---- spells tab
  function drawLoadout(ctx, t) {
    const Lf = L.left;
    K.caption(ctx, 'LOADOUT', Lf.x + 1, Lf.y + 1, L.wide ? Lf.w - 2 : Lf.w - 2, COL.gold);
    for (let i = 0; i < 4; i++) {
      const r = L.slots[i];
      const id = 'inv-slot-' + i;
      const spId = game.state.loadout?.[i] || null;
      const sp = getSpell(spId);
      const focus = foc.zone === 'slots' && foc.i === i;
      const pk = clamp((T - slotPop[i]) / 0.35, 0, 1);
      const target = !!held || drag?.active;
      const hover = drag?.active && K.inRect(r, drag.x, drag.y);
      if (target) {
        const a = 0.25 + 0.25 * Math.sin(t * 6);
        ctx.fillStyle = rgba(COL.gold, hover ? 0.6 : a);
        ctx.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
      }
      rrect(ctx, r.x - 1, r.y - 1, r.w + 2, r.h + 2, COL.ink);
      rrect(ctx, r.x, r.y, r.w, r.h, focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : sp ? elColor(sp.element, 0) : COL.edgeLo);
      ctx.fillStyle = sp ? mix(elColor(sp.element, 0), '#0b0716', 0.82) : '#0b0716';
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      if (sp) {
        const lift = pk < 1 ? Math.round(-Math.sin(pk * Math.PI) * 3) : 0;
        game.art?.drawIcon?.(ctx, sp.icon || 'spell_' + spId, r.x + Math.round((r.w - 16) / 2), r.y + Math.round((r.h - 16) / 2) + lift, { size: 16, alpha: held === spId ? 0.5 : 1 });
      } else drawText(ctx, 'EMPTY', r.x + r.w / 2, r.y + r.h / 2 - 2, { align: 'center', color: COL.dimmer, shadow: null });
      if (pk < 1) drawRing(ctx, r.x + r.w / 2, r.y + r.h / 2, Math.round(8 + pk * 14), rgba(COL.goldHi, 1 - pk));
      keycap(ctx, String(i + 1), r.x - 4, r.y - 4, { color: focus ? COL.goldHi : COL.text });
      hits.add(id, r.x, r.y, r.w, r.h, { zone: 'slots', i, spellId: spId }, { pad: 3 });
    }
    // hint
    const dev = promptDevice(game);
    const hint = held ? (dev === 'touch' ? 'Tap a slot to bind' : 'Pick a slot: 1-4 / Enter') : dev === 'touch' ? 'Tap a spell, then a slot' : 'Focus a spell, press 1-4';
    if (L.wide) {
      const hy = L.slots[3].y + L.slots[3].h + 8;
      wrapText(hint, Lf.w - 4).slice(0, 3).forEach((ln, i) => drawText(ctx, ln, Lf.x + 2, hy + i * 8, { color: held ? COL.goldHi : COL.dim }));
      if (held) {
        const sp = getSpell(held);
        const hy2 = hy + 28;
        if (hy2 + 16 < Lf.y + Lf.h) {
          drawText(ctx, 'HOLDING', Lf.x + 2, hy2, { color: COL.dim });
          game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + held, Lf.x + 2, hy2 + 8, { size: 16 });
          drawText(ctx, K.ellipsize(sp?.name || held, Lf.w - 24), Lf.x + 21, hy2 + 13, { color: elColor(sp?.element, 1) });
        }
      }
    } else {
      drawText(ctx, hint, Lf.x + Lf.w / 2, L.slots[0].y + L.slots[0].h + 4, { align: 'center', color: held ? COL.goldHi : COL.dim });
    }
  }

  function drawSpellGrid(ctx, t) {
    const G = L.grid;
    const list = spells();
    K.caption(ctx, `KNOWN SPELLS ${list.length}`, G.x + 1, G.y - 10, G.w - 2, COL.gold);
    listScroll = clamp(listScroll, 0, maxScrollRows(list.length));
    hits.add('inv-gridarea', G.x, G.y, G.w, G.h, null, { drag: true });
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      if ((r + listScroll) * L.cols + c < list.length) continue;
      const x = L.gx + c * PITCH, y = G.y + r * PITCH;
      rrect(ctx, x, y, CELL, CELL, '#1a1230');
      ctx.fillStyle = '#0f0a1c';
      ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
    if (!list.length) drawText(ctx, 'No spells yet - visit the Forge', G.x + G.w / 2, G.y + 20, { align: 'center', color: COL.dim });
    list.forEach((e, k) => {
      const r = cellAt(k, listScroll);
      if (!r) return;
      const sp = e.spell;
      const focus = foc.zone === 'list' && foc.i === k;
      const isHeld = held === e.id;
      const slot = game.state.loadout?.indexOf(e.id) ?? -1;
      drawCell(ctx, r.x, r.y, { border: elColor(sp.element, 0), fill: mix(elColor(sp.element, 0), '#0b0716', 0.84), focus: focus || isHeld, t, glowCol: isHeld ? COL.gold : null });
      game.art?.drawIcon?.(ctx, sp.icon || 'spell_' + e.id, r.x + 2, r.y + 2 + (isHeld ? Math.round(Math.sin(t * 8)) : 0), { size: 16 });
      if (slot >= 0) {
        rrect(ctx, r.x + CELL - 7, r.y + CELL - 8, 7, 8, COL.ink);
        ctx.fillStyle = COL.gold; ctx.fillRect(r.x + CELL - 6, r.y + CELL - 7, 5, 6);
        drawText(ctx, String(slot + 1), r.x + CELL - 5, r.y + CELL - 7, { color: COL.ink, shadow: null });
      }
      hits.add('inv-spell-' + e.id, r.x, r.y, CELL, CELL, { zone: 'list', i: k, spellId: e.id }, { pad: 1 });
    });
    drawScrollbar(ctx, G, listScroll, maxScrollRows(list.length));
  }

  // ---- detail box
  function drawDetail(ctx, t) {
    const D = L.detail;
    panel(ctx, D.x, D.y, D.w, D.h, { studs: false, fill: '#140c24', fill2: '#170e29', edge: COL.edgeLo, edgeHi: COL.edge });
    ctx.save();
    ctx.beginPath(); ctx.rect(D.x + 2, D.y + 2, D.w - 4, D.h - 4); ctx.clip();
    const e = focusedEntry();
    const x = D.x + 6, w = D.w - 12;
    let y = D.y + 6;
    const shake = shakeT > 0 ? K.shakeX(shakeT) : 0;
    const label = actionLabel(e);
    const btnH = label ? 18 : 0;
    const bottom = D.y + D.h - 6 - (label ? btnH + 4 : 0) - (T - msgT < 1.8 ? 10 : 0);
    if (!e || (e.kind === 'item' && !e.id)) {
      const txt = tab === 'items' ? (e?.fromEquip ? `No ${e.slot} equipped` : 'Select an item') : 'Select a spell';
      drawText(ctx, txt, D.x + D.w / 2, D.y + 14, { align: 'center', color: COL.dim });
      if (e?.fromEquip) wrapText(`Equip a ${e.slot} from your bag to boost your stats.`, w).forEach((ln, i) => drawText(ctx, ln, D.x + D.w / 2, D.y + 26 + i * 8, { align: 'center', color: COL.dimmer }));
    } else if (e.kind === 'slot') {
      drawText(ctx, `SLOT ${e.slotIndex + 1} IS EMPTY`, D.x + D.w / 2, D.y + 14, { align: 'center', color: COL.dim });
      wrapText('Pick a spell, then this slot, to bind it.', w).forEach((ln, i) => drawText(ctx, ln, D.x + D.w / 2, D.y + 26 + i * 8, { align: 'center', color: COL.dimmer }));
    } else if (e.kind === 'item') {
      const it = e.item;
      const rar = rarityOf(it?.rarity);
      inset(ctx, x, y, 22, 22, mix(rar.color, '#0b0716', 0.8), rar.color);
      if (it) game.art?.drawIcon?.(ctx, it.icon || 'item_' + e.id, x + 3, y + 3, { size: 16 });
      const nx = x + 26, nw = w - 26;
      const nl = wrapText(it?.name || e.id, nw).slice(0, 2);
      nl.forEach((ln, i) => drawText(ctx, ln, nx + shake, y + 1 + i * 8, { color: rar.hi }));
      const sub = `${(rar.label || 'Common').toUpperCase()} ${it?.slot ? '· ' + String(it.slot).toUpperCase() : ''}${e.qty > 1 ? '  x' + e.qty : ''}`;
      drawText(ctx, K.ellipsize(sub, nw), nx, y + 2 + nl.length * 8, { color: rar.color });
      y += Math.max(26, 4 + nl.length * 8 + 10);
      if (equippedSlotOf(e.id)) { K.badge(ctx, 'EQUIPPED', x, y, COL.gold); y += 12; }
      if (it?.description) {
        for (const ln of wrapText(it.description, w)) { if (y + 6 > bottom) break; drawText(ctx, ln, x, y, { color: '#d8d0f0' }); y += 8; }
        y += 3;
      }
      for (const [txt, col] of itemLines(it)) { if (y + 6 > bottom) break; drawText(ctx, K.ellipsize(txt, w), x, y, { color: col }); y += 8; }
    } else if (e.kind === 'spell') {
      const sp = e.spell;
      const el = sp?.element || 'arcane';
      inset(ctx, x, y, 22, 22, mix(elColor(el, 0), '#0b0716', 0.8), elColor(el, 0));
      game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + e.id, x + 3, y + 3, { size: 16 });
      const nx = x + 26, nw = w - 26;
      const nl = wrapText(sp?.name || e.id, nw).slice(0, 2);
      nl.forEach((ln, i) => drawText(ctx, ln, nx, y + 1 + i * 8, { color: mix(elColor(el, 0), '#ffffff', 0.35) }));
      let sx = nx;
      const sy = y + 2 + nl.length * 8;
      sx += K.drawStars(ctx, sp?.tier ?? 1, sx, sy, Math.max(3, sp?.tier ?? 1)) + 3;
      for (const se of sp?.elements || [el]) { drawEmblem(ctx, se, sx, sy - 1); sx += 8; }
      if (sp?.form) drawText(ctx, K.formLabel(sp.form).toUpperCase(), sx + 3, sy, { color: COL.dim });
      y += Math.max(26, 4 + nl.length * 8 + 10);
      const slot = game.state.loadout?.indexOf(e.id) ?? -1;
      if (slot >= 0) { K.badge(ctx, `BOUND TO ${slot + 1}`, x, y, COL.gold); y += 12; }
      if (sp?.description) {
        for (const ln of wrapText(sp.description, w)) { if (y + 6 > bottom - 18) break; drawText(ctx, ln, x, y, { color: '#d8d0f0' }); y += 8; }
        y += 3;
      }
      const stats = K.spellStats(sp);
      const colW = Math.min(76, Math.floor(w / 2));
      for (let i = 0; i < stats.length; i++) {
        const sy2 = y + Math.floor(i / 2) * 8;
        if (sy2 + 6 > bottom) break;
        const sx2 = x + (i % 2) * colW;
        drawText(ctx, stats[i][0], sx2, sy2, { color: COL.dim });
        drawText(ctx, stats[i][1], sx2 + colW - 4, sy2, { align: 'right' });
      }
      y += Math.ceil(stats.length / 2) * 8 + 2;
      const sts = K.spellStatuses(sp);
      let bx = x;
      for (const st of sts) {
        const txt = `${K.statusName(st.type).toUpperCase()}${st.duration ? ' ' + K.fmt(st.duration) + 'S' : ''}`;
        const tw = measureText(txt) + 6;
        if (bx + tw > x + w) { bx = x; y += 11; }
        if (y + 9 > bottom) break;
        K.badge(ctx, txt, bx, y, K.statusColor(st.type));
        bx += tw + 3;
      }
    }
    // message line
    if (T - msgT < 1.8 && msg) {
      const a = clamp(1.8 - (T - msgT), 0, 1);
      drawText(ctx, K.ellipsize(msg, w), D.x + D.w / 2 + shake, D.y + D.h - 6 - (label ? btnH + 4 : 0) - 8, { align: 'center', color: '#ff9aa8', alpha: a });
    }
    ctx.restore();
    // action button
    if (label) {
      const bw = Math.min(w, 96), bx = Math.round(D.x + (D.w - bw) / 2), by = D.y + D.h - 6 - btnH;
      const pressed = hits.isPressed('inv-action');
      button(ctx, bx + shake, by, bw, btnH, '', { pressed, accent: label === 'UNEQUIP' ? COL.edge : COL.gold, t, focus: hits.hoverId === 'inv-action' });
      drawPrompt(ctx, game, 'confirm', label, bx + bw / 2 + shake, by + Math.round((btnH - 9) / 2) + (pressed ? 1 : 0), { align: 'center', color: COL.goldHi, key: 'ENTER' });
      hits.add('inv-action', bx, by, bw, btnH, null, { pad: 2 });
    }
  }

  function itemLines(it) {
    const out = [];
    if (!it) return out;
    const s = it.stats || {};
    const sign = (v) => (v >= 0 ? '+' : '');
    const G = COL.good, B = COL.bad;
    for (const [k, v] of Object.entries(s)) {
      if (k === 'elementPower' && v && typeof v === 'object') {
        for (const [el, p] of Object.entries(v)) out.push([`${sign(p)}${Math.round(p * 100)}% ${K.cap(el)} Power`, elColor(el, 1)]);
        continue;
      }
      if (typeof v !== 'number' || !v) continue;
      if (k === 'maxHp') out.push([`${sign(v)}${K.fmt(v)} Max HP`, v > 0 ? G : B]);
      else if (k === 'maxMana') out.push([`${sign(v)}${K.fmt(v)} Max Mana`, v > 0 ? G : B]);
      else if (k === 'manaRegen') out.push([`${sign(v)}${K.fmt(v)} Mana Regen`, v > 0 ? G : B]);
      else if (k === 'spellPower') out.push([`${sign(v)}${Math.round(v * 100)}% Spell Power`, v > 0 ? G : B]);
      else if (k === 'moveSpeed') out.push([`${sign(v)}${K.fmt(v)} Move Speed`, v > 0 ? G : B]);
      else if (k === 'cooldownMult') out.push([`${sign(v)}${Math.round(v * 100)}% Cooldowns`, v < 0 ? G : B]);
      else out.push([`${sign(v)}${K.fmt(v)} ${K.cap(k)}`, v > 0 ? G : B]);
    }
    const u = it.use || {};
    if (u.heal) out.push([`Heals ${K.fmt(u.heal)} HP`, COL.hpHi]);
    if (u.mana) out.push([`Restores ${K.fmt(u.mana)} Mana`, COL.manaHi]);
    return out;
  }

  // ---- mouse tooltip
  // initial focus
  if (tab === 'items') foc = items().length ? { zone: 'grid', i: 0 } : { zone: 'equip', i: 0 };
  else foc = spells().length ? { zone: 'list', i: 0 } : { zone: 'slots', i: 0 };
  sfx('ui_open');

  return {
    hits,
    update,
    render,
    onClose() {
      window.removeEventListener('wheel', onWheel);
      hits.reset();
    },
  };
}
