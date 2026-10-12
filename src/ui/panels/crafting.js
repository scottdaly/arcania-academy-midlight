// Arcane Forge - spell crafting panel (team: ui).
//
// Combine element fragments in the forge slots, pick a form, preview the resulting spell, craft it
// with a flourish, then bind it to a loadout slot. Everything is read from combat data at runtime
// (listRecipes / getSpell / canCraft / craft), so new elements, forms and recipes just appear.
//
// Controls: arrows move between rows (palette, slots, forms, buttons, book); Enter/Space activates;
// Backspace removes the last element; Esc / C closes; 1-4 bind in the assign step. Mouse hover
// focuses, click activates, the book drag/wheel scrolls. Touch: tap everything.
//
// hits ids: craft-close, craft-el-<el>, craft-slot-<i>, craft-form-<form>, craft-go, craft-clear,
//           craft-recipe-<recipeId>, craft-assign-<i>, craft-assign-later, craft-booktab
import { ELEMENTS } from '../../core/config.js';
import { setLoadoutSlot } from '../../core/state.js';
import {
  COL, panel, inset, ribbon, button, rrect, drawEmblem, keycap, sparkle, mix, rgba, clamp,
  easeOutCubic, easeOutBack, easeInCubic, elColor, dim, drawDisc, drawRing,
} from '../theme.js';
import { drawText, measureText, wrapText } from '../font.js';
import { createHits, drawPrompt } from '../widgets.js';
import * as K from './craft-kit.js';

const CHARGE = 0.8; // flourish length before combat.craft() is called
const RESULT_LOCK = 0.45; // result card ignores input this long (no accidental binds)
const ROW_H = 17;

export function craftingPanel(game, ui, data = {}) {
  const C = game.combat || {};
  const hits = createHits();
  const sparks = K.createSparks(260);
  const rings = [];
  const sfx = (name, opts) => { try { game.audio?.sfx?.(name, opts); } catch { /* ignore */ } };
  const call = (fn, fallback) => { try { return fn(); } catch (err) { console.warn('[crafting]', err); return fallback; } };

  // ---------------------------------------------------------------- data (read once per open)
  const recipes = call(() => (C.listRecipes?.() || []).filter((r) => r && r.id && Array.isArray(r.inputs) && r.inputs.length), []);
  const spellOf = (r) => (r ? call(() => C.getSpell?.(r.result), null) || null : null);
  const keyOf = (els) => els.slice().sort().join('+');
  const byKey = new Map();
  const formOfR = new Map();
  for (const r of recipes) {
    const k = keyOf(r.inputs);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
    formOfR.set(r.id, K.formOf(r, spellOf(r)));
  }
  const forms = [];
  for (const r of recipes) { const f = formOfR.get(r.id); if (!forms.includes(f)) forms.push(f); }
  forms.sort((a, b) => K.formOrder(a) - K.formOrder(b));
  const fragEls = () => Object.keys(game.state.fragments || {}).filter((e) => (game.state.fragments[e] || 0) > 0);
  const elements = K.orderedElements([...recipes.flatMap((r) => r.inputs).filter((e) => typeof e === 'string'), ...fragEls()]);
  if (!elements.length) elements.push(...ELEMENTS.slice(0, 3));
  const SLOTS = clamp(Math.max(3, ...recipes.map((r) => r.inputs.length)), 3, 4);

  const isKnown = (r) => !!r && (!!game.state.spells?.crafted?.includes(r.id) || !!game.state.spells?.known?.includes(r.result));
  const check = (r) => (r ? call(() => C.canCraft?.(game.state, r.id), null) || { ok: false, reason: 'unknown' } : { ok: false, reason: 'unknown' });
  const frags = (el) => game.state.fragments?.[el] ?? 0;

  // ---------------------------------------------------------------- panel state
  let T = 0;
  const sel = []; // elements in the forge slots (in order)
  const slotAnim = []; // per slot {t, x, y} fly-in source
  let formPref = null;
  let foc = { row: 'palette', i: 0 };
  let bookScroll = 0;
  let showBook = false; // tabs mode only
  let phase = 'idle'; // idle | charge | result
  let phaseT = 0;
  let pending = null; // {recipe, spell, els[]}
  let result = null; // {spellId, spell, recipe}
  let assignFoc = 3;
  let bound = -1, boundT = 0;
  let errMsg = '', errT = -9, shakeT = 0;
  let flash = 0, flashCol = '#ffffff';
  let wheel = 0;
  let L = null; // last layout
  const tabRects = [];
  const onWheel = (e) => { wheel += e.deltaY || 0; };
  window.addEventListener('wheel', onWheel, { passive: true });

  // current selection -> recipe (memoised)
  let memoKey = '', memo = null;
  function current() {
    const k = keyOf(sel) + '|' + formPref;
    if (k === memoKey && memo) return memo;
    const cands = sel.length ? byKey.get(keyOf(sel)) || [] : [];
    const avail = new Set(cands.map((r) => formOfR.get(r.id)));
    let form = formPref;
    if (!avail.has(form)) form = forms.find((f) => avail.has(f)) || formPref;
    const recipe = cands.find((r) => formOfR.get(r.id) === form) || null;
    memoKey = k;
    memo = { cands, avail, form, recipe, spell: spellOf(recipe) };
    return memo;
  }
  const invalidate = () => { memoKey = ''; };

  // partial matches for the "unknown combination" hint: recipes containing all selected elements
  function partials() {
    if (!sel.length) return [];
    const need = {};
    for (const e of sel) need[e] = (need[e] || 0) + 1;
    return recipes.filter((r) => {
      if (r.inputs.length <= sel.length) return false;
      const have = {};
      for (const e of r.inputs) have[e] = (have[e] || 0) + 1;
      return Object.entries(need).every(([e, n]) => (have[e] || 0) >= n);
    });
  }

  // ---------------------------------------------------------------- actions
  function error(msg) {
    errMsg = msg; errT = T; shakeT = 0.45;
    sfx('ui_error');
  }
  function close() {
    if (phase === 'charge') return;
    sfx('ui_close');
    ui.close('crafting');
  }
  function addEl(el, from) {
    if (sel.length >= SLOTS) { error('The forge holds ' + SLOTS + ' elements'); return; }
    sel.push(el);
    const i = sel.length - 1;
    slotAnim[i] = { t: T, x: from?.x ?? 0, y: from?.y ?? 0 };
    sfx('craft_add', { pitch: 1 + 0.14 * i });
    invalidate();
  }
  function removeAt(i) {
    if (i < 0 || i >= sel.length) return;
    sel.splice(i, 1);
    slotAnim.splice(i, 1);
    for (let k = i; k < sel.length; k++) slotAnim[k] = { t: T - 0.1, x: slotCenter(k + 1).x, y: slotCenter(k + 1).y };
    sfx('craft_remove');
    invalidate();
  }
  function clearSel() {
    if (!sel.length) return;
    sel.length = 0; slotAnim.length = 0;
    sfx('craft_remove', { pitch: 0.8 });
    invalidate();
  }
  function pickForm(f) {
    const cur = current();
    if (sel.length && !cur.avail.has(f)) {
      error(cur.cands.length ? `No ${K.formLabel(f)} for this mix` : 'Unknown combination');
      return;
    }
    formPref = f;
    invalidate();
    sfx('ui_select');
  }
  function loadRecipe(r, from) {
    if (!r) return;
    sel.length = 0; slotAnim.length = 0;
    r.inputs.slice(0, SLOTS).forEach((el, i) => { sel.push(el); slotAnim[i] = { t: T + i * 0.06, x: from?.x ?? 0, y: from?.y ?? 0 }; });
    formPref = formOfR.get(r.id);
    invalidate();
    sfx('craft_add', { pitch: 1.1 });
    if (L?.tabs) showBook = false;
  }
  function go() {
    const cur = current();
    if (!cur.recipe) { error(sel.length ? 'Unknown combination' : 'Add elements to the forge'); return; }
    const chk = check(cur.recipe);
    if (!chk.ok) { error(reasonText(chk.reason, cur.recipe)); return; }
    pending = { recipe: cur.recipe, spell: cur.spell, els: sel.slice() };
    phase = 'charge'; phaseT = 0;
    sfx('craft_charge');
  }
  function finishCharge() {
    const r = pending.recipe;
    const res = call(() => C.craft?.(game, r.id), null) || { ok: false, reason: 'unknown' };
    const c = crucible();
    if (res.ok) {
      const spellId = res.spellId || r.result;
      const spell = call(() => C.getSpell?.(spellId), null) || pending.spell;
      result = { spellId, spell, recipe: r };
      const cols = [];
      for (const e of pending.els) cols.push(elColor(e, 0), elColor(e, 1));
      cols.push('#ffffff', COL.gold);
      sparks.burst(c.x, c.y, 90, cols, 150, 1.0);
      for (let i = 0; i < 3; i++) rings.push({ x: c.x, y: c.y, r0: 4, r1: 40 + i * 22, t0: T + i * 0.08, dur: 0.5 + i * 0.12, color: i === 1 ? COL.goldHi : elColor(pending.els[i % pending.els.length], 1) });
      flash = 1; flashCol = '#ffffff';
      phase = 'result'; phaseT = 0;
      bound = -1;
      const empty = game.state.loadout.indexOf(null);
      const slotted = game.state.loadout.indexOf(spellId);
      assignFoc = slotted >= 0 ? slotted : empty >= 0 ? empty : 3;
    } else {
      phase = 'idle';
      sparks.burst(c.x, c.y, 24, ['#5a5078', '#8a80a8'], 60, 0.5);
      error(reasonText(res.reason, r));
    }
    pending = null;
  }
  function bind(i) {
    if (!result || bound >= 0) return;
    if (call(() => setLoadoutSlot(game, i, result.spellId), false)) {
      bound = i; boundT = T; assignFoc = i;
      sfx('ui_select', { pitch: 1.2 });
      const r = L?.assign?.[i];
      if (r) sparks.burst(r.x + r.w / 2, r.y + r.h / 2, 26, [COL.gold, COL.goldHi, elColor(result.spell?.element, 1)], 70, 0.6);
    } else error('Cannot bind that spell');
  }
  function later() {
    sfx('ui_back');
    phase = 'idle'; result = null;
  }
  function reasonText(reason, r) {
    if (reason === 'known') return 'Already known';
    if (reason === 'fragments') return 'Not enough fragments';
    if (reason === 'locked') return K.requirementLines(game, r?.requires)[0] || 'Locked';
    if (reason === 'unknown') return 'Unknown recipe';
    return reason ? K.cap(String(reason)) : 'The forge fizzles';
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    const R = K.safeRect(game, 3);
    const pad = 5;
    const cx = R.x + pad, cw = R.w - pad * 2;
    const o = { R, tabs: false };
    o.close = { x: R.x + R.w - 21, y: R.y + 4, w: 17, h: 17 };
    const headY = R.y + 5;
    o.head = { x: cx, y: headY, w: cw - 22, h: 15 };
    const bodyY = headY + 20;
    const bodyH = R.y + R.h - pad - bodyY;
    if (cw >= 380 && bodyH >= 170) {
      o.mode = 'wide';
      const bw = clamp(Math.round(cw * 0.27), 104, 168);
      const pw = clamp(Math.round(cw * 0.34), 138, 220);
      const fw = cw - bw - pw - 8;
      o.book = { x: cx, y: bodyY, w: bw, h: bodyH };
      o.forge = { x: cx + bw + 4, y: bodyY, w: fw, h: bodyH };
      o.card = { x: cx + bw + 4 + fw + 4, y: bodyY, w: pw, h: bodyH };
    } else {
      o.mode = 'tall';
      const forgeH = clamp(Math.round(bodyH * 0.3), 150, 190);
      const rest = bodyH - forgeH - 5;
      o.forge = { x: cx, y: bodyY, w: cw, h: forgeH };
      if (rest >= 150 + 5 + 100) {
        const cardH = clamp(Math.round(rest * 0.5), 150, 185);
        o.card = { x: cx, y: bodyY + forgeH + 5, w: cw, h: cardH };
        o.book = { x: cx, y: o.card.y + cardH + 5, w: cw, h: rest - cardH - 5 };
      } else {
        o.tabs = true;
        o.card = { x: cx, y: bodyY + forgeH + 5, w: cw, h: Math.max(60, rest) };
        o.book = { x: cx, y: bodyY, w: cw, h: bodyH };
        o.bookTab = { x: o.close.x - 46, y: o.close.y, w: 42, h: 17 };
        o.head.w = o.bookTab.x - 4 - cx;
      }
    }
    // forge internals
    const F = o.forge;
    const n = elements.length;
    const bs = clamp(Math.floor((F.w - (n - 1) * 3) / n), 18, 34);
    const ptotal = n * bs + (n - 1) * 3;
    const px0 = F.x + Math.floor((F.w - ptotal) / 2);
    o.pal = elements.map((el, i) => ({ el, x: px0 + i * (bs + 3), y: F.y + 1, w: bs, h: 28 }));
    const actH = 20, formsH = 29;
    const actY = F.y + F.h - actH - 1;
    const formsY = actY - 5 - formsH;
    o.well = { x: F.x, y: F.y + 34, w: F.w, h: Math.max(30, formsY - 4 - (F.y + 34)) };
    const W = o.well;
    const ss = clamp(Math.floor((W.w - 16 - (SLOTS - 1) * 12) / SLOTS), 18, 26);
    const stotal = SLOTS * ss + (SLOTS - 1) * 12;
    const sx0 = W.x + Math.floor((W.w - stotal) / 2);
    const tallWell = W.h >= 64;
    const sy = tallWell ? W.y + Math.round(W.h * 0.36 - ss / 2) : W.y + Math.round((W.h - ss) / 2);
    o.slots = [];
    for (let i = 0; i < SLOTS; i++) o.slots.push({ x: sx0 + i * (ss + 12), y: sy, w: ss, h: ss });
    o.cru = tallWell ? { x: W.x + Math.round(W.w / 2), y: Math.min(W.y + W.h - 12, sy + ss + Math.round((W.y + W.h - sy - ss) / 2)) } : { x: W.x + Math.round(W.w / 2), y: sy + Math.round(ss / 2) };
    o.cruBowl = tallWell;
    const k = Math.max(1, forms.length);
    const fbw = clamp(Math.floor((F.w - (k - 1) * 2) / k), 16, 30);
    const ftotal = k * fbw + (k - 1) * 2;
    const fx0 = F.x + Math.floor((F.w - ftotal) / 2);
    o.forms = forms.map((f, i) => ({ f, x: fx0 + i * (fbw + 2), y: formsY, w: fbw, h: 19 }));
    o.formsLabelY = formsY + 22;
    const clearW = 38;
    o.clear = { x: F.x, y: actY, w: clearW, h: actH };
    o.go = { x: F.x + clearW + 4, y: actY, w: F.w - clearW - 4, h: actH };
    // book list
    const B = o.book;
    const hintH = 30;
    o.list = { x: B.x + 2, y: B.y + 12, w: B.w - 4, h: Math.max(ROW_H, B.h - 12 - hintH - 2) };
    o.bookHint = { x: B.x, y: o.list.y + o.list.h + 2, w: B.w, h: hintH };
    o.listRows = Math.max(1, Math.floor(o.list.h / ROW_H));
    return o;
  }

  function slotCenter(i) {
    const r = L?.slots?.[i];
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0, y: 0 };
  }
  function crucible() { return L?.cru || { x: game.display.width / 2, y: game.display.height / 2 }; }
  const maxScroll = () => Math.max(0, recipes.length * ROW_H - (L?.list.h ?? 0));
  function ensureBookVisible(i) {
    if (!L) return;
    const top = i * ROW_H, bot = top + ROW_H;
    if (top < bookScroll) bookScroll = top;
    if (bot > bookScroll + L.list.h) bookScroll = bot - L.list.h;
    bookScroll = clamp(bookScroll, 0, maxScroll());
  }

  // ---------------------------------------------------------------- input
  const rowsOf = () => {
    if (L?.tabs && showBook) return ['book'];
    if (L?.tabs) return ['palette', 'slots', 'forms', 'actions'];
    return ['palette', 'slots', 'forms', 'actions', 'book'];
  };
  const rowLen = (row) => (row === 'palette' ? elements.length : row === 'slots' ? SLOTS : row === 'forms' ? forms.length : row === 'actions' ? 2 : recipes.length);

  function activate(row, i, from) {
    if (row === 'palette') { const el = elements[i]; if (el) addEl(el, from || palCenter(i)); }
    else if (row === 'slots') { if (i < sel.length) removeAt(i); else if (sel.length < SLOTS) { foc = { row: 'palette', i: foc.i }; sfx('ui_move'); } }
    else if (row === 'forms') { const f = forms[i]; if (f) pickForm(f); }
    else if (row === 'actions') { if (i === 0) clearSel(); else go(); }
    else if (row === 'book') { const r = recipes[i]; if (r) { loadRecipe(r, from || bookRowCenter(i)); } }
  }
  const palCenter = (i) => { const r = L?.pal?.[i]; return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null; };
  const bookRowCenter = (i) => (L ? { x: L.list.x + 14, y: clamp(L.list.y + i * ROW_H - bookScroll + ROW_H / 2, L.list.y, L.list.y + L.list.h) } : null);

  function setFocus(row, i, sound = true) {
    if (foc.row === row && foc.i === i) return;
    foc = { row, i };
    if (sound) sfx('ui_move');
    if (row === 'book') ensureBookVisible(i);
  }

  function navigate(inp) {
    const rows = rowsOf();
    if (!rows.includes(foc.row)) foc = { row: rows[0], i: 0 };
    const len = rowLen(foc.row);
    let { row, i } = foc;
    const ri = rows.indexOf(row);
    if (row === 'book') {
      if (inp.pressed('up')) { if (i > 0) i--; else if (ri > 0) { row = rows[ri - 1]; i = 1; } }
      else if (inp.pressed('down')) i = Math.min(len - 1, i + 1);
      else if (inp.pressed('right') && L?.mode === 'wide') { row = 'palette'; i = 0; }
      else return;
    } else if (inp.pressed('left')) {
      if (i > 0) i--; else if (L?.mode === 'wide' && rows.includes('book')) { row = 'book'; i = bookFocusIndex(); }
    } else if (inp.pressed('right')) {
      if (i < len - 1) i++;
    } else if (inp.pressed('up') || inp.pressed('down')) {
      const d = inp.pressed('up') ? -1 : 1;
      const nr = ri + d;
      if (nr < 0 || nr >= rows.length) return;
      const nrow = rows[nr];
      if (nrow === 'book') i = bookFocusIndex();
      else if (nrow === 'actions') i = row === 'forms' ? 1 : 1;
      else {
        const nl = rowLen(nrow);
        i = len > 1 ? Math.round((i / (len - 1)) * (nl - 1)) : 0;
        if (nrow === 'slots' && sel.length) i = Math.min(i, sel.length - 1);
        if (nrow === 'forms') { const cf = forms.indexOf(current().form); if (cf >= 0) i = cf; }
      }
      row = nrow;
    } else return;
    setFocus(row, clamp(i, 0, Math.max(0, rowLen(row) - 1)));
  }
  function bookFocusIndex() {
    const cur = current();
    if (cur.recipe) { const k = recipes.indexOf(cur.recipe); if (k >= 0) return k; }
    return clamp(Math.floor(bookScroll / ROW_H), 0, Math.max(0, recipes.length - 1));
  }

  // ---------------------------------------------------------------- update
  function update(g, dt) {
    T += dt;
    sparks.update(dt);
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.6);
    for (let i = rings.length - 1; i >= 0; i--) if (T - rings[i].t0 > rings[i].dur) rings.splice(i, 1);
    const inp = g.input;
    const events = hits.poll(inp);
    if (!L) return;

    if (phase === 'charge') {
      phaseT += dt;
      // spiral sparks into the crucible
      const c = crucible();
      if (Math.random() < 0.9) {
        const el = pending.els[Math.floor(Math.random() * pending.els.length)];
        const a = Math.random() * Math.PI * 2, rr = 26 + Math.random() * 20;
        sparks.spawn(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, -Math.cos(a) * rr * 2.2 - Math.sin(a) * 30, -Math.sin(a) * rr * 2.2 + Math.cos(a) * 30, 0.35, elColor(el, Math.random() < 0.5 ? 0 : 1), 1, 0.5);
      }
      if (phaseT >= CHARGE) finishCharge();
      wheel = 0;
      return; // input locked during the flourish
    }

    if (phase === 'result') {
      phaseT += dt;
      wheel = 0;
      if (bound >= 0) {
        if (T - boundT > 0.6) { phase = 'idle'; result = null; }
        return;
      }
      if (phaseT < RESULT_LOCK) return;
      for (const e of events) {
        if (e.type === 'hover' && e.data?.assign != null) { if (assignFoc !== e.data.assign) { assignFoc = e.data.assign; sfx('ui_hover'); } }
        if (e.type === 'click') {
          if (e.id === 'craft-assign-later') { later(); return; }
          if (e.data?.assign != null && e.data.assign < 4) { bind(e.data.assign); return; }
        }
      }
      for (let i = 0; i < 4; i++) if (inp.pressed('spell' + (i + 1))) { bind(i); return; }
      if (inp.pressed('pause') || inp.pressed('cancel')) { later(); return; }
      if (inp.pressed('left')) { assignFoc = (assignFoc + 4) % 5; sfx('ui_move'); }
      if (inp.pressed('right')) { assignFoc = (assignFoc + 1) % 5; sfx('ui_move'); }
      if (inp.pressed('down')) { assignFoc = 4; sfx('ui_move'); }
      if (inp.pressed('up') && assignFoc === 4) { assignFoc = 3; sfx('ui_move'); }
      if (inp.pressed('confirm') || inp.pressed('interact')) { if (assignFoc < 4) bind(assignFoc); else later(); }
      return;
    }

    // ---- idle
    if (inp.pressed('pause') || inp.pressed('craft')) { close(); return; }
    if (inp.pressed('cancel')) { // Backspace (Esc also sets 'pause' and was handled above)
      if (sel.length) removeAt(sel.length - 1);
      else if (L.tabs && showBook) { showBook = false; sfx('ui_back'); }
      else close();
      return;
    }
    if (wheel) {
      const m = inp.mouse;
      if (K.inRect(L.list, m.x, m.y) && (!L.tabs || showBook)) bookScroll = clamp(bookScroll + wheel * 0.3, 0, maxScroll());
      wheel = 0;
    }
    for (const e of events) {
      if (e.type === 'drag' && e.scroll && String(e.id).startsWith('craft-recipe-') || (e.type === 'drag' && e.id === 'craft-book')) {
        bookScroll = clamp(bookScroll - e.dy, 0, maxScroll());
        continue;
      }
      const d = e.data;
      if (e.type === 'hover' && d?.row) {
        if (d.row !== foc.row || d.i !== foc.i) { foc = { row: d.row, i: d.i }; sfx('ui_hover'); }
        continue;
      }
      if (e.type !== 'click') continue;
      if (e.id === 'craft-close') { close(); return; }
      if (e.id === 'craft-booktab') { showBook = !showBook; sfx('ui_tab'); foc = showBook ? { row: 'book', i: bookFocusIndex() } : { row: 'palette', i: 0 }; continue; }
      if (d?.row) {
        foc = { row: d.row, i: d.i };
        activate(d.row, d.i, d.row === 'book' ? { x: e.x, y: e.y } : null);
      }
    }
    navigate(inp);
    if (inp.pressed('confirm') || inp.pressed('interact')) activate(foc.row, foc.i);
  }

  // ---------------------------------------------------------------- render
  function render(g, ctx, age) {
    hits.begin();
    L = layout();
    const W = g.display.width, H = g.display.height;
    const io = K.intro(age);
    dim(ctx, W, H, 0.62 * io.k);
    const cur = current();
    const t = g.realTime ?? T;

    ctx.save();
    ctx.globalAlpha = io.alpha;
    ctx.translate(0, io.dy);
    const R = L.R;
    panel(ctx, R.x, R.y, R.w, R.h, { fill: '#170f2a', fill2: '#1a1130', glow: rgba(COL.edge, 0.25) });
    drawHeader(ctx, cur, t);
    const bookOnly = L.tabs && showBook;
    if (!bookOnly) {
      drawForge(ctx, cur, t);
      drawCard(ctx, L.card, cur, t);
    }
    if (!L.tabs || showBook) drawBook(ctx, cur, t);
    ctx.restore();

    // charge / result overlays (screen space)
    if (phase === 'charge') drawCharge(ctx, t);
    K.drawRings(ctx, rings, T);
    sparks.render(ctx);
    if (phase === 'result' && result) drawResult(ctx, t);
    if (flash > 0) { ctx.fillStyle = rgba(flashCol, flash * 0.75); ctx.fillRect(0, 0, W, H); }
  }

  function drawHeader(ctx, cur, t) {
    const Hd = L.head;
    // fragments, right-aligned before the close button
    const els = K.orderedElements([...elements, ...fragEls()]);
    let fw = 0;
    for (const el of els) fw += 9 + measureText(String(frags(el))) + 6;
    const fragLeft = Hd.x + Hd.w - fw;
    rrect(ctx, fragLeft - 3, Hd.y + 1, fw + 3, 13, rgba(COL.ink, 0.55));
    let fx = fragLeft;
    for (const el of els) {
      const txt = String(frags(el));
      drawEmblem(ctx, el, fx, Hd.y + 4);
      drawText(ctx, txt, fx + 9, Hd.y + 5, { color: frags(el) > 0 ? elColor(el, 1) : COL.dimmer });
      fx += 9 + measureText(txt) + 6;
    }
    // title
    const title = 'ARCANE FORGE';
    if (measureText(title) * 2 + 8 < fragLeft - Hd.x - 6) {
      drawText(ctx, title, Hd.x + 2, Hd.y + 2, { color: COL.gold, scale: 2, shadow: COL.goldLo });
    } else if (measureText(title) + 4 < fragLeft - Hd.x - 4) {
      drawText(ctx, title, Hd.x + 2, Hd.y + 5, { color: COL.gold });
    }
    // book tab toggle
    if (L.bookTab) {
      const b = L.bookTab;
      button(ctx, b.x, b.y, b.w, b.h, showBook ? 'FORGE' : 'BOOK', { focus: hits.hoverId === 'craft-booktab', pressed: hits.isPressed('craft-booktab'), t, accent: COL.edge });
      hits.add('craft-booktab', b.x, b.y, b.w, b.h, null, { pad: 2 });
    }
    const c = L.close;
    K.drawClose(ctx, c.x, c.y, c.w, hits.hoverId === 'craft-close', hits.isPressed('craft-close'));
    hits.add('craft-close', c.x, c.y, c.w, c.h, null, { pad: 3 });
  }

  function mixColor() {
    if (!sel.length) return COL.edge;
    let c = elColor(sel[0], 0);
    for (let i = 1; i < sel.length; i++) c = mix(c, elColor(sel[i], 0), 1 / (i + 1));
    return c;
  }

  function drawForge(ctx, cur, t) {
    const F = L.forge;
    const busy = phase !== 'idle';
    // ---- palette
    for (let i = 0; i < L.pal.length; i++) {
      const p = L.pal[i], el = p.el;
      const id = 'craft-el-' + el;
      const focus = foc.row === 'palette' && foc.i === i && !busy;
      const pressed = hits.isPressed(id);
      const n = frags(el);
      const oy = pressed ? 1 : 0;
      rrect(ctx, p.x - 1, p.y - 1, p.w + 2, p.h + 2, COL.ink);
      rrect(ctx, p.x, p.y + oy, p.w, p.h - oy, focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : mix(elColor(el, 0), COL.ink, 0.35));
      ctx.fillStyle = mix(elColor(el, 0), '#120a20', focus ? 0.62 : 0.78);
      ctx.fillRect(p.x + 1, p.y + 1 + oy, p.w - 2, p.h - 2 - oy);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(p.x + 1, p.y + 1 + oy, p.w - 2, 8);
      const bob = focus ? Math.round(Math.sin(t * 5) * 1) : 0;
      game.art?.drawIcon?.(ctx, 'element_' + el, p.x + Math.round((p.w - 16) / 2), p.y + 2 + oy + bob, { size: 16, alpha: n > 0 ? 1 : 0.55 });
      drawText(ctx, String(n), p.x + p.w / 2, p.y + 20 + oy, { align: 'center', color: n > 0 ? elColor(el, 1) : COL.bad });
      hits.add(id, p.x, p.y, p.w, p.h, { row: 'palette', i });
    }

    // ---- well (forge glow + slots + crucible)
    const Wl = L.well;
    inset(ctx, Wl.x, Wl.y, Wl.w, Wl.h, '#0d0818', COL.edgeLo);
    ctx.save();
    ctx.beginPath(); ctx.rect(Wl.x + 1, Wl.y + 1, Wl.w - 2, Wl.h - 2); ctx.clip();
    const mc = mixColor();
    const chargeK = phase === 'charge' ? clamp(phaseT / CHARGE, 0, 1) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const c = L.cru;
    const gr = Math.round(Math.min(Wl.w * 0.42, Wl.h * 0.5) + pulse * 2 + chargeK * 10);
    K.glow(ctx, c.x, c.y, gr, mix(mc, COL.edge, 0.35), 0.07 + 0.035 * sel.length + chargeK * 0.3);
    // concentric rune ring around the crucible
    ctx.globalAlpha = 0.35 + 0.15 * pulse;
    drawRing(ctx, c.x, c.y, Math.max(6, gr - 4), mix(mc, COL.edgeLo, 0.5));
    ctx.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const a = t * 0.4 + (i * Math.PI) / 3;
      ctx.fillStyle = rgba(sel.length ? elColor(sel[i % sel.length], 1) : COL.edgeHi, 0.5);
      ctx.fillRect(Math.round(c.x + Math.cos(a) * (gr - 4)), Math.round(c.y + Math.sin(a) * (gr - 4)), 1, 1);
    }
    // drifting embers
    for (let i = 0; i < 10; i++) {
      const ph = (t * 0.25 + i * 0.37) % 1;
      const ex = Wl.x + ((i * 53 + Math.floor(t * 0.25 + i * 0.37) * 31) % Math.max(1, Wl.w - 4)) + 2;
      const ey = Wl.y + Wl.h - 2 - ph * (Wl.h - 4);
      ctx.globalAlpha = (1 - ph) * 0.6;
      ctx.fillStyle = sel.length ? elColor(sel[i % sel.length], i % 2) : COL.edgeHi;
      ctx.fillRect(Math.round(ex + Math.sin(t * 2 + i) * 2), Math.round(ey), 1, 1);
    }
    ctx.globalAlpha = 1;
    // crucible bowl
    if (L.cruBowl) drawBowl(ctx, c.x, c.y, mc, t, chargeK);
    // slots
    for (let i = 0; i < SLOTS; i++) {
      const s = L.slots[i];
      const id = 'craft-slot-' + i;
      const focus = foc.row === 'slots' && foc.i === i && !busy;
      const filled = i < sel.length;
      const optional = i >= 2;
      if (i > 0) drawText(ctx, '+', s.x - 7, s.y + Math.round(s.h / 2) - 2, { align: 'center', color: i < sel.length ? COL.goldHi : COL.dimmer });
      const edge = focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : filled ? mix(elColor(sel[i], 0), COL.ink, 0.2) : optional ? '#2a2048' : COL.edgeLo;
      rrect(ctx, s.x - 1, s.y - 1, s.w + 2, s.h + 2, COL.ink);
      rrect(ctx, s.x, s.y, s.w, s.h, edge);
      ctx.fillStyle = filled ? mix(elColor(sel[i], 0), '#0b0716', 0.75) : '#0b0716';
      ctx.fillRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
      if (!filled) {
        // dotted inner border, '+' for the next free slot
        ctx.fillStyle = optional ? '#2a2048' : '#3a2a6a';
        for (let k = 2; k < s.w - 2; k += 3) { ctx.fillRect(s.x + k, s.y + 2, 1, 1); ctx.fillRect(s.x + k, s.y + s.h - 3, 1, 1); }
        for (let k = 2; k < s.h - 2; k += 3) { ctx.fillRect(s.x + 2, s.y + k, 1, 1); ctx.fillRect(s.x + s.w - 3, s.y + k, 1, 1); }
        if (i === sel.length) drawText(ctx, '+', s.x + s.w / 2, s.y + s.h / 2 - 2, { align: 'center', color: rgba(COL.edgeHi, 0.4 + 0.3 * pulse), shadow: null });
        else if (optional) drawText(ctx, 'OPT', s.x + s.w / 2, s.y + s.h / 2 - 2, { align: 'center', color: '#3a2a6a', shadow: null });
      }
      if (filled && !(phase === 'charge')) {
        const el = sel[i];
        const a = slotAnim[i];
        const k = a ? clamp((T - a.t) / 0.3, 0, 1) : 1;
        const tx = s.x + Math.round(s.w / 2), ty = s.y + Math.round(s.h / 2);
        let x = tx, y = ty;
        if (a && k < 1) {
          const e = easeOutBack(k);
          x = Math.round(a.x + (tx - a.x) * e);
          y = Math.round(a.y + (ty - a.y) * e - Math.sin(k * Math.PI) * 14);
          sparkle(ctx, x + Math.round(Math.random() * 4 - 2), y + 6, 1, elColor(el, 1));
        }
        if (k >= 1) K.glow(ctx, tx, ty, Math.round(s.w * 0.45 + pulse), elColor(el, 0), 0.22);
        const big = s.w >= 22;
        if (big) drawEmblem(ctx, el, x - 8, y - 8, { scale: 2 });
        else drawEmblem(ctx, el, x - 3, y - 3);
        if (k >= 1 && k < 1.01) { /* landed */ }
        const landT = a ? T - a.t - 0.3 : 9;
        if (landT >= 0 && landT < 0.25) drawRing(ctx, tx, ty, Math.round(6 + landT * 50), rgba(elColor(el, 1), 1 - landT * 4));
      }
      hits.add(id, s.x, s.y, s.w, s.h, { row: 'slots', i });
    }
    // charge: elements spiral from the slots into the crucible
    if (phase === 'charge' && pending) {
      const k = clamp(phaseT / CHARGE, 0, 1);
      pending.els.forEach((el, i) => {
        const s = L.slots[i] || L.slots[0];
        const sx = s.x + s.w / 2, sy = s.y + s.h / 2;
        const a0 = Math.atan2(sy - c.y, sx - c.x);
        const r0 = Math.hypot(sx - c.x, sy - c.y);
        const e = easeInCubic(k);
        const ang = a0 + e * Math.PI * 3;
        const r = r0 * (1 - e);
        const x = Math.round(c.x + Math.cos(ang) * r), y = Math.round(c.y + Math.sin(ang) * r);
        for (let tr = 1; tr <= 4; tr++) {
          const e2 = easeInCubic(clamp(k - tr * 0.03, 0, 1));
          const a2 = a0 + e2 * Math.PI * 3, r2 = r0 * (1 - e2);
          ctx.globalAlpha = 0.5 - tr * 0.1;
          ctx.fillStyle = elColor(el, 1);
          ctx.fillRect(Math.round(c.x + Math.cos(a2) * r2), Math.round(c.y + Math.sin(a2) * r2), 2, 2);
        }
        ctx.globalAlpha = 1;
        if (k < 0.92) drawEmblem(ctx, el, x - 3, y - 3);
      });
      const core = Math.round(2 + 10 * easeInCubic(k));
      K.glow(ctx, c.x, c.y, core + 6, mc, 0.5);
      drawDisc(ctx, c.x, c.y, core, mix(mc, '#ffffff', 0.4 + 0.5 * k));
      drawDisc(ctx, c.x, c.y, Math.max(1, Math.round(core * 0.5)), '#ffffff');
    }
    ctx.restore();
    // error message inside the well (bottom)
    if (T - errT < 2.2 && errMsg) {
      const a = clamp(2.2 - (T - errT), 0, 1);
      const sx = K.shakeX(shakeT);
      const tw = Math.min(Wl.w - 8, measureText(errMsg) + 8);
      const ex = Math.round(Wl.x + Wl.w / 2 - tw / 2 + sx), ey = Wl.y + Wl.h - 12;
      ctx.globalAlpha = a;
      rrect(ctx, ex, ey, tw, 10, '#3a0f1e');
      drawText(ctx, K.ellipsize(errMsg, tw - 6), ex + tw / 2, ey + 3, { align: 'center', color: '#ff9aa8' });
      ctx.globalAlpha = 1;
    }

    // ---- forms
    for (let i = 0; i < L.forms.length; i++) {
      const fr = L.forms[i], f = fr.f;
      const id = 'craft-form-' + f;
      const avail = sel.length > 0 && cur.avail.has(f);
      const active = cur.form === f && avail;
      const focus = foc.row === 'forms' && foc.i === i && !busy;
      const pressed = hits.isPressed(id);
      const oy = pressed ? 1 : 0;
      rrect(ctx, fr.x - 1, fr.y - 1, fr.w + 2, fr.h + 2, COL.ink);
      rrect(ctx, fr.x, fr.y + oy, fr.w, fr.h - oy, focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : active ? mix(mixColor(), '#ffffff', 0.2) : avail ? COL.edge : '#2a2048');
      ctx.fillStyle = active ? mix(mixColor(), '#120a20', 0.55) : avail ? COL.bg2 : '#130c22';
      ctx.fillRect(fr.x + 1, fr.y + 1 + oy, fr.w - 2, fr.h - 2 - oy);
      const gc = active ? '#ffffff' : avail ? COL.edgeHi : '#3e3260';
      K.drawFormGlyph(ctx, f, fr.x + Math.round((fr.w - 7) / 2), fr.y + 6 + oy, gc, active || avail ? COL.ink : null);
      if (active) { ctx.fillStyle = COL.gold; ctx.fillRect(fr.x + 3, fr.y + fr.h - 3 + oy, fr.w - 6, 1); }
      hits.add(id, fr.x, fr.y, fr.w, fr.h, { row: 'forms', i });
    }
    // form name under the row (focused or active)
    const shownForm = foc.row === 'forms' ? forms[foc.i] : cur.form;
    if (shownForm) {
      const avail = sel.length > 0 && cur.avail.has(shownForm);
      const label = K.formLabel(shownForm).toUpperCase();
      const txt = sel.length ? (avail ? label : label + ' - N/A') : 'FORM: ' + label;
      drawText(ctx, txt, F.x + F.w / 2, L.formsLabelY, { align: 'center', color: avail ? COL.goldHi : COL.dim });
    }

    // ---- actions
    const cl = L.clear;
    button(ctx, cl.x, cl.y, cl.w, cl.h, 'CLEAR', { focus: foc.row === 'actions' && foc.i === 0 && !busy, pressed: hits.isPressed('craft-clear'), disabled: !sel.length, t });
    hits.add('craft-clear', cl.x, cl.y, cl.w, cl.h, { row: 'actions', i: 0 });
    drawGo(ctx, cur, t);
  }

  function drawBowl(ctx, cx, cy, color, t, chargeK) {
    const w = 34;
    const x = Math.round(cx - w / 2), y = Math.round(cy - 3);
    // liquid surface
    const lc = mix(color, '#ffffff', 0.25 + 0.3 * chargeK);
    rrect(ctx, x - 1, y - 1, w + 2, 5, COL.ink);
    ctx.fillStyle = lc;
    ctx.fillRect(x + 1, y, w - 2, 3);
    for (let i = 0; i < 4; i++) {
      const bx = x + 3 + ((i * 9 + Math.floor(t * 6) * 3) % (w - 6));
      ctx.fillStyle = '#ffffff';
      if ((Math.floor(t * 4) + i) % 3 === 0) ctx.fillRect(bx, y, 1, 1);
    }
    // body
    const rows = 9;
    for (let r = 0; r < rows; r++) {
      const inset2 = Math.round((r * r) / 6);
      const rw = w - inset2 * 2;
      ctx.fillStyle = COL.ink;
      ctx.fillRect(x + inset2 - 1, y + 3 + r, rw + 2, 1);
      ctx.fillStyle = r < 2 ? '#6a5a8a' : r < 5 ? '#4a3a6a' : '#352850';
      ctx.fillRect(x + inset2, y + 3 + r, rw, 1);
    }
    ctx.fillStyle = COL.ink;
    ctx.fillRect(x + 12, y + 3 + rows, w - 24, 1);
    // rim
    ctx.fillStyle = COL.goldLo;
    ctx.fillRect(x - 1, y + 3, w + 2, 1);
    ctx.fillStyle = COL.gold;
    ctx.fillRect(x, y + 3, w, 1);
  }

  function drawGo(ctx, cur, t) {
    const b = L.go;
    const chk = cur.recipe ? check(cur.recipe) : null;
    const ok = !!chk?.ok && phase === 'idle';
    const focus = foc.row === 'actions' && foc.i === 1 && phase === 'idle';
    const pressed = hits.isPressed('craft-go');
    const sx = shakeT > 0 && focus ? K.shakeX(shakeT) : 0;
    let label = 'CRAFT';
    if (phase === 'charge') label = 'FORGING…';
    else if (!cur.recipe) label = sel.length ? 'NO RECIPE' : 'CRAFT';
    else if (chk?.reason === 'known') label = 'KNOWN';
    else if (chk?.reason === 'locked') label = 'LOCKED';
    else if (chk?.reason === 'fragments') label = 'NEED FRAGMENTS';
    const x = b.x + sx;
    if (ok) {
      // pulsing gold glow
      const gl = 0.25 + 0.2 * Math.sin(t * 4);
      ctx.fillStyle = rgba(COL.gold, gl);
      ctx.fillRect(x - 3, b.y - 2, b.w + 6, b.h + 4);
    }
    button(ctx, x, b.y, b.w, b.h, '', { focus, pressed, disabled: !ok && phase !== 'charge', accent: ok ? COL.gold : COL.edge, t });
    // content: label + cost
    const cost = cur.recipe?.cost || {};
    const parts = Object.entries(cost).filter(([, n]) => n > 0);
    const costW = parts.reduce((s, [, n]) => s + 10 + measureText(String(n)) + 3, 0);
    const lw = measureText(label);
    const showCost = ok && parts.length && lw + 8 + costW < b.w - 6;
    const total = showCost ? lw + 8 + costW : lw;
    let tx = Math.round(x + b.w / 2 - total / 2);
    const ty = b.y + (pressed ? 1 : 0) + Math.round((b.h - 1 - 5) / 2);
    drawText(ctx, label, tx, ty, { color: ok ? (focus ? '#ffffff' : COL.goldHi) : phase === 'charge' ? COL.goldHi : COL.dim });
    if (showCost) {
      tx += lw + 8;
      for (const [el, n] of parts) {
        drawEmblem(ctx, el, tx, ty - 1);
        drawText(ctx, String(n), tx + 9, ty, { color: elColor(el, 1) });
        tx += 10 + measureText(String(n)) + 3;
      }
    }
    if (ok) for (let i = 0; i < 2; i++) {
      const ph = (t * 0.7 + i * 0.5) % 1;
      sparkle(ctx, x + 4 + ph * (b.w - 8), b.y + (i ? b.h - 3 : 2), ph > 0.5 ? 1 : 0, COL.goldHi);
    }
    hits.add('craft-go', b.x, b.y, b.w, b.h, { row: 'actions', i: 1 });
  }

  // ---------------------------------------------------------------- preview card
  function drawCard(ctx, A, cur, t) {
    panel(ctx, A.x, A.y, A.w, A.h, { studs: false, fill: '#140c24', fill2: '#170e29', edge: cur.recipe ? mix(elColor(cur.spell?.element || cur.recipe.inputs[0], 0), COL.edgeLo, 0.4) : COL.edgeLo, edgeHi: COL.edge });
    ctx.save();
    ctx.beginPath(); ctx.rect(A.x + 2, A.y + 2, A.w - 4, A.h - 4); ctx.clip();
    if (cur.recipe) drawRecipeCard(ctx, A, cur, t);
    else drawUnknownCard(ctx, A, t);
    ctx.restore();
  }

  function drawRecipeCard(ctx, A, cur, t) {
    const r = cur.recipe, sp = cur.spell;
    const el = sp?.element || r.inputs[0];
    const ec = elColor(el, 0), eh = elColor(el, 1);
    const chk = check(r);
    const known = isKnown(r);
    const x = A.x + 6, w = A.w - 12;
    let y = A.y + 6;
    const shake = shakeT > 0 ? K.shakeX(shakeT) : 0;
    // icon frame
    const bob = Math.round(Math.sin(t * 2.4));
    K.glow(ctx, x + 18, y + 18, 18, ec, 0.22 + 0.06 * Math.sin(t * 3));
    inset(ctx, x, y, 36, 36, '#0b0716', mix(ec, COL.ink, 0.3));
    game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + r.result, x + 2, y + 2 + bob, { size: 32 });
    // name + tier
    const nx = x + 41, nw = w - 41;
    const name = sp?.name || r.name || r.result || '???';
    const lines = wrapText(name, nw).slice(0, 2);
    lines.forEach((ln, i) => drawText(ctx, ln, nx, y + 1 + i * 8, { color: mix(ec, '#ffffff', 0.3) }));
    let ny = y + 1 + lines.length * 8 + 1;
    const tier = sp?.tier ?? r.tier ?? 1;
    K.drawStars(ctx, tier, nx, ny, Math.max(3, tier));
    drawText(ctx, K.formLabel(cur.form).toUpperCase(), nx + Math.max(3, tier) * 6 + 3, ny, { color: COL.dim });
    ny += 10;
    // state badge
    const bx = nx + shake;
    if (known) K.badge(ctx, 'KNOWN', bx, ny, COL.good);
    else if (chk.reason === 'locked') K.badge(ctx, 'LOCKED', bx, ny, COL.bad);
    else if (chk.reason === 'fragments') K.badge(ctx, 'NEED FRAGMENTS', bx, ny, '#ff9a4a');
    else if (chk.ok) K.badge(ctx, Math.sin(t * 5) > -0.3 ? 'READY' : 'READY', bx, ny, COL.gold, mix(COL.gold, COL.ink, 0.7));
    y += 40;

    // ---- bottom block (always visible): combo line, cost, state text
    const msgLines = [];
    let msgCol = COL.dim;
    if (known) { msgLines.push('Already known - bind it in the Bag.'); msgCol = COL.good; }
    else if (chk.reason === 'locked') { msgLines.push(...K.requirementLines(game, r.requires).map((s) => '◆ ' + s)); if (!msgLines.length) msgLines.push('Locked'); msgCol = '#ff9aa8'; }
    else if (chk.reason === 'fragments') { msgLines.push('Gather more fragments.'); msgCol = '#ffb07a'; }
    else if (chk.ok) { msgLines.push('Ready to forge!'); msgCol = COL.goldHi; }
    const wrapped = [];
    for (const m of msgLines) wrapped.push(...wrapText(m, w));
    const msgShown = wrapped.slice(0, 3);
    const bottomH = 15 + 13 + msgShown.length * 8 + 2;
    const by0 = A.y + A.h - 5 - bottomH;
    let by = by0;
    ctx.fillStyle = COL.edgeLo;
    ctx.fillRect(x, by - 3, w, 1);
    // combo: emblems + emblems -> form = icon
    let cx = x;
    r.inputs.forEach((e, i) => {
      if (i > 0) { drawText(ctx, '+', cx + 1, by + 4, { color: COL.dim }); cx += 7; }
      drawEmblem(ctx, e, cx, by + 3);
      cx += 9;
    });
    drawText(ctx, '+', cx + 1, by + 4, { color: COL.dim });
    cx += 7;
    K.drawFormGlyph(ctx, cur.form, cx, by + 3, COL.edgeHi);
    cx += 10;
    drawText(ctx, '=', cx, by + 4, { color: COL.dim });
    cx += 6;
    game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + r.result, cx, by, { size: 16 });
    by += 15;
    // cost have/need
    drawText(ctx, 'COST', x, by + 2, { color: COL.dim });
    let kx = x + measureText('COST') + 5;
    for (const [e, n] of Object.entries(r.cost || {})) {
      if (!n) continue;
      const have = frags(e);
      const enough = have >= n;
      const txt = `${have}/${n}`;
      if (kx + 10 + measureText(txt) > x + w) break;
      drawEmblem(ctx, e, kx, by + 1);
      drawText(ctx, txt, kx + 9, by + 2, { color: enough ? COL.good : COL.bad });
      kx += 9 + measureText(txt) + 5;
    }
    by += 12;
    msgShown.forEach((ln, i) => drawText(ctx, ln, x + (i === 0 ? shake : 0), by + 1 + i * 8, { color: msgCol }));

    // ---- flowing middle block (clipped above the bottom block)
    ctx.save();
    ctx.beginPath(); ctx.rect(A.x + 2, y - 1, A.w - 4, Math.max(0, by0 - 4 - (y - 1))); ctx.clip();
    const limit = by0 - 4;
    const desc = sp?.description || '';
    if (desc) {
      const dl = wrapText(desc, w);
      const maxL = clamp(Math.floor((limit - y - 30) / 8), 2, 5);
      dl.slice(0, maxL).forEach((ln, i) => drawText(ctx, i === maxL - 1 && dl.length > maxL ? K.ellipsize(ln + '…', w) : ln, x, y + i * 8, { color: '#d8d0f0' }));
      y += Math.min(dl.length, maxL) * 8 + 3;
    }
    // stats (two columns)
    const stats = K.spellStats(sp);
    const colW = Math.min(76, Math.floor(w / 2));
    stats.forEach(([label, val], i) => {
      const sx2 = x + (i % 2) * colW, sy2 = y + Math.floor(i / 2) * 8;
      drawText(ctx, label, sx2, sy2, { color: COL.dim });
      drawText(ctx, val, sx2 + colW - 4, sy2, { color: COL.text, align: 'right' });
    });
    y += Math.ceil(stats.length / 2) * 8 + 2;
    // statuses
    const sts = K.spellStatuses(sp);
    if (sts.length) {
      let sx3 = x;
      for (const st of sts) {
        const txt = `${K.statusName(st.type).toUpperCase()}${st.duration ? ' ' + K.fmt(st.duration) + 'S' : ''}`;
        const tw = measureText(txt) + 6;
        if (sx3 + tw > x + w) { sx3 = x; y += 11; }
        K.badge(ctx, txt, sx3, y, K.statusColor(st.type));
        sx3 += tw + 3;
      }
      y += 12;
    }
    // recipe hint (if it adds something)
    const hintNew = r.hint && String(r.hint).split(/(?<=\.)\s+/).some((p) => p && !desc.includes(p.trim()));
    if (hintNew && y + 8 < limit) {
      const hl = wrapText(r.hint, w);
      hl.slice(0, Math.floor((limit - y) / 8)).forEach((ln, i) => drawText(ctx, ln, x, y + i * 8, { color: COL.dimmer }));
    }
    ctx.restore();
  }

  function drawUnknownCard(ctx, A, t) {
    const x = A.x + 6, w = A.w - 12;
    let y = A.y + 8;
    const cx = A.x + Math.round(A.w / 2);
    const empty = !sel.length;
    const mc = mixColor();
    K.glow(ctx, cx, y + 18, 20, mc, 0.18 + 0.08 * Math.sin(t * 2));
    inset(ctx, cx - 18, y, 36, 36, '#0b0716', COL.edgeLo);
    if (empty) {
      // three orbiting element motes
      for (let i = 0; i < 3; i++) {
        const a = t * 1.6 + (i * Math.PI * 2) / 3;
        drawEmblem(ctx, elements[i % elements.length], cx - 3 + Math.round(Math.cos(a) * 9), y + 15 + Math.round(Math.sin(a) * 9));
      }
    } else {
      const wob = Math.round(Math.sin(t * 3) * 1);
      drawText(ctx, '?', cx + 1, y + 8 + wob, { align: 'center', scale: 4, color: mix(mc, '#ffffff', 0.4 + 0.2 * Math.sin(t * 4)), shadow: COL.ink });
    }
    y += 42;
    const title = empty ? 'THE FORGE AWAITS' : 'UNKNOWN COMBINATION';
    drawText(ctx, K.ellipsize(title, w), cx, y, { align: 'center', color: empty ? COL.goldHi : COL.edgeHi });
    y += 11;
    const lines = [];
    let col = '#d8d0f0';
    if (empty) {
      lines.push('Pick elements from the palette above to fill the forge slots.');
      lines.push('');
      lines.push('Two or three elements, plus a form, make a spell.');
    } else {
      const part = partials();
      if (part.length) {
        const pick = part[Math.floor(t / 3.5) % part.length];
        lines.push(part.some((r) => r.inputs.length === sel.length + 1) ? 'The essences stir... one more element?' : 'The essences stir... add more.');
        lines.push('');
        if (pick?.hint) { lines.push('"' + pick.hint + '"'); col = '#c8c0e8'; }
      } else {
        lines.push('These essences refuse to bind.');
        lines.push('');
        lines.push('Try another mix, or browse the recipe book.');
      }
    }
    const hintY = y;
    let ly = hintY;
    const maxY = A.y + A.h - 8;
    for (const para of lines) {
      if (!para) { ly += 4; continue; }
      for (const ln of wrapText(para, w)) {
        if (ly + 6 > maxY) break;
        drawText(ctx, ln, cx, ly, { align: 'center', color: para.startsWith('"') ? col : '#d8d0f0' });
        ly += 8;
      }
    }
  }

  // ---------------------------------------------------------------- book
  function drawBook(ctx, cur, t) {
    const B = L.book;
    const known = recipes.filter(isKnown).length;
    K.caption(ctx, `RECIPES ${known}/${recipes.length}`, B.x + 1, B.y + 2, B.w - 2, COL.gold);
    const Ls = L.list;
    inset(ctx, Ls.x - 1, Ls.y - 1, Ls.w + 2, Ls.h + 2, '#0d0818', COL.edgeLo);
    bookScroll = clamp(bookScroll, 0, maxScroll());
    hits.add('craft-book', Ls.x, Ls.y, Ls.w, Ls.h, null, { drag: true });
    ctx.save();
    ctx.beginPath(); ctx.rect(Ls.x, Ls.y, Ls.w, Ls.h); ctx.clip();
    const first = Math.max(0, Math.floor(bookScroll / ROW_H));
    const last = Math.min(recipes.length - 1, Math.ceil((bookScroll + Ls.h) / ROW_H));
    const sbw = maxScroll() > 0 ? 4 : 0;
    const busy = phase !== 'idle';
    for (let i = first; i <= last; i++) {
      const r = recipes[i];
      const ry = Math.round(Ls.y + i * ROW_H - bookScroll);
      const rw = Ls.w - sbw;
      const id = 'craft-recipe-' + r.id;
      const focus = foc.row === 'book' && foc.i === i && !busy;
      const selected = cur.recipe === r;
      const kn = isKnown(r);
      const chk = kn ? { ok: false, reason: 'known' } : check(r);
      if (selected || focus) {
        ctx.fillStyle = selected ? rgba(elColor(spellOf(r)?.element || r.inputs[0], 0), 0.22) : 'rgba(122,90,255,0.18)';
        ctx.fillRect(Ls.x, ry, rw, ROW_H - 1);
      } else if (i % 2) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(Ls.x, ry, rw, ROW_H - 1); }
      if (focus) {
        ctx.fillStyle = Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi;
        ctx.fillRect(Ls.x, ry, 1, ROW_H - 1);
        ctx.fillRect(Ls.x + rw - 1, ry, 1, ROW_H - 1);
        ctx.fillRect(Ls.x, ry, rw, 1);
        ctx.fillRect(Ls.x, ry + ROW_H - 2, rw, 1);
      }
      if (chk.ok) {
        const gl = 0.35 + 0.35 * Math.sin(t * 4 + i);
        ctx.fillStyle = rgba(COL.gold, gl);
        ctx.fillRect(Ls.x + 1, ry + 2, 2, ROW_H - 5);
      }
      // emblems
      let ex = Ls.x + 5;
      for (const e of r.inputs) { drawEmblem(ctx, e, ex, ry + 4, { alpha: chk.reason === 'locked' ? 0.5 : 1 }); ex += 8; }
      ex = Ls.x + 5 + Math.max(3, SLOTS) * 8 + 1;
      K.drawFormGlyph(ctx, formOfR.get(r.id), ex, ry + 4, kn ? COL.edgeHi : COL.dim);
      ex += 11;
      // name or ???
      const sp = spellOf(r);
      const right = Ls.x + rw - 3;
      const iconW = 10;
      const nameW = right - iconW - ex;
      const name = kn ? sp?.name || r.name || r.result : '???';
      const ncol = kn ? mix(elColor(sp?.element || r.inputs[0], 0), '#ffffff', 0.35) : chk.reason === 'locked' ? COL.dimmer : chk.ok ? COL.goldHi : COL.dim;
      drawText(ctx, K.ellipsize(name, nameW), ex, ry + 5, { color: ncol });
      // status mark
      if (kn) drawText(ctx, '✓', right - 6, ry + 5, { color: COL.good });
      else if (chk.reason === 'locked') drawLock(ctx, right - 7, ry + 4);
      else if (chk.ok) sparkle(ctx, right - 4, ry + 7, Math.sin(t * 6 + i) > 0 ? 2 : 1, COL.goldHi);
      if (ry + ROW_H > Ls.y && ry < Ls.y + Ls.h) {
        const vy = Math.max(ry, Ls.y), vh = Math.min(ry + ROW_H - 1, Ls.y + Ls.h) - vy;
        if (vh >= 6) hits.add(id, Ls.x, vy, rw, vh, { row: 'book', i }, { drag: true });
      }
    }
    ctx.restore();
    // scrollbar
    if (sbw) {
      const track = Ls.h - 2;
      const thumb = Math.max(8, Math.round((Ls.h / (recipes.length * ROW_H)) * track));
      const ty = Ls.y + 1 + Math.round((bookScroll / maxScroll()) * (track - thumb));
      ctx.fillStyle = '#20163a';
      ctx.fillRect(Ls.x + Ls.w - 3, Ls.y + 1, 2, track);
      ctx.fillStyle = COL.edge;
      ctx.fillRect(Ls.x + Ls.w - 3, ty, 2, thumb);
    }
    // hint for focused / selected recipe
    const Hb = L.bookHint;
    const hr = foc.row === 'book' ? recipes[foc.i] : cur.recipe;
    if (hr) {
      const kn = isKnown(hr);
      const chk = check(hr);
      let text = hr.hint || '';
      if (!kn && chk.reason === 'locked') text = K.requirementLines(game, hr.requires).join('. ') || text;
      const lines = wrapText(text, Hb.w - 4).slice(0, 3);
      lines.forEach((ln, i) => drawText(ctx, ln, Hb.x + 2, Hb.y + 3 + i * 8, { color: !kn && chk.reason === 'locked' ? '#ff9aa8' : COL.dim }));
    } else {
      wrapText('Pick a recipe to load it into the forge.', Hb.w - 4).slice(0, 3).forEach((ln, i) => drawText(ctx, ln, Hb.x + 2, Hb.y + 3 + i * 8, { color: COL.dimmer }));
    }
  }

  function drawLock(ctx, x, y) {
    ctx.fillStyle = COL.dimmer;
    ctx.fillRect(x + 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 2); ctx.fillRect(x + 4, y + 1, 1, 2);
    ctx.fillStyle = COL.dim;
    ctx.fillRect(x - 1, y + 3, 7, 4);
    ctx.fillStyle = COL.ink;
    ctx.fillRect(x + 2, y + 4, 1, 2);
  }

  // ---------------------------------------------------------------- overlays
  function drawCharge(ctx, t) {
    const W = game.display.width, H = game.display.height;
    const k = clamp(phaseT / CHARGE, 0, 1);
    const col = pending ? (pending.els.length ? elColor(pending.els[0], 0) : COL.edge) : COL.edge;
    const pulse = 0.5 + 0.5 * Math.sin(phaseT * (10 + 20 * k));
    ctx.fillStyle = rgba(mix(col, '#ffffff', 0.3), 0.04 + 0.12 * k * pulse);
    ctx.fillRect(0, 0, W, H);
    // vignette bars closing in
    const b = Math.round(easeInCubic(k) * 10);
    ctx.fillStyle = 'rgba(5,3,10,0.5)';
    ctx.fillRect(0, 0, W, b);
    ctx.fillRect(0, H - b, W, b);
  }

  function drawResult(ctx, t) {
    const W = game.display.width, H = game.display.height;
    const k = easeOutBack(clamp(phaseT / 0.35, 0, 1));
    dim(ctx, W, H, 0.5 * clamp(phaseT / 0.2, 0, 1));
    const R = K.safeRect(game, 4);
    const cw = Math.min(236, R.w - 8), ch = Math.min(134, R.h - 8);
    const x = Math.round(R.x + (R.w - cw) / 2);
    // keep clear of the toasts at the top of the screen when there is room
    const y0 = Math.round(Math.max(R.y + (R.h - ch) / 2, Math.min(R.y + 54, R.y + R.h - ch - 2)));
    const y = y0 + Math.round((1 - clamp(phaseT / 0.3, 0, 1)) * 20);
    const sp = result.spell;
    const el = sp?.element || 'arcane';
    const ec = elColor(el, 0);
    ctx.globalAlpha = clamp(phaseT / 0.15, 0, 1);
    panel(ctx, x, y, cw, ch, { edge: COL.gold, edgeHi: COL.goldHi, edgeLo: COL.goldLo, fill: '#1a1030', fill2: mix(ec, '#1a1030', 0.88), glow: rgba(COL.gold, 0.3) });
    ctx.globalAlpha = 1;
    ribbon(ctx, x + cw / 2, y - 5, 'NEW SPELL!', { color: '#ffffff', fill: COL.goldLo, edge: COL.gold });
    // rotating rays + icon pop
    const icx = x + Math.round(cw / 2), icy = y + 30;
    for (let i = 0; i < 8; i++) {
      const a = t * 0.8 + (i * Math.PI) / 4;
      const r1 = 20 + (i % 2) * 4;
      ctx.globalAlpha = 0.5;
      for (let s = 12; s < r1; s += 2) {
        ctx.fillStyle = i % 2 ? COL.goldHi : elColor(el, 1);
        ctx.fillRect(Math.round(icx + Math.cos(a) * s), Math.round(icy + Math.sin(a) * s), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    K.glow(ctx, icx, icy, 18, ec, 0.35);
    const size = Math.max(2, Math.round(32 * clamp(k, 0, 1.25)));
    game.art?.drawIcon?.(ctx, sp?.icon || 'spell_' + result.spellId, icx - Math.round(size / 2), icy - Math.round(size / 2), { size });
    // name
    const name = sp?.name || result.spellId;
    const big = measureText(name) * 2 <= cw - 12;
    drawText(ctx, name, icx, y + 51, { align: 'center', scale: big ? 2 : 1, color: mix(ec, '#ffffff', 0.35), shadow: COL.ink });
    let yy = y + 51 + (big ? 14 : 9);
    // bind prompt
    drawText(ctx, bound >= 0 ? `BOUND TO SLOT ${bound + 1}!` : 'BIND TO A SPELL SLOT', icx, yy, { align: 'center', color: bound >= 0 ? COL.good : COL.gold });
    yy += 10;
    const ss = 24, gap = 8;
    const total = 4 * ss + 3 * gap;
    const sx0 = icx - Math.round(total / 2);
    L.assign = [];
    const locked = phaseT < RESULT_LOCK;
    for (let i = 0; i < 4; i++) {
      const sx = sx0 + i * (ss + gap);
      const id = 'craft-assign-' + i;
      const focus = assignFoc === i && !locked;
      const isBound = bound === i;
      const pressed = hits.isPressed(id);
      const oy = pressed ? 1 : 0;
      rrect(ctx, sx - 1, yy - 1, ss + 2, ss + 2, COL.ink);
      rrect(ctx, sx, yy + oy, ss, ss - oy, isBound ? COL.good : focus ? (Math.sin(t * 6) > 0 ? COL.gold : COL.goldHi) : COL.edge);
      ctx.fillStyle = '#0b0716';
      ctx.fillRect(sx + 1, yy + 1 + oy, ss - 2, ss - 2 - oy);
      const cur = isBound ? result.spellId : game.state.loadout[i];
      const csp = cur ? call(() => C.getSpell?.(cur), null) : null;
      if (cur) game.art?.drawIcon?.(ctx, csp?.icon || 'spell_' + cur, sx + 4, yy + 4 + oy, { size: 16, alpha: isBound || cur === result.spellId ? 1 : 0.55 });
      if (isBound) { const bt = T - boundT; if (bt < 0.4) drawRing(ctx, sx + ss / 2, yy + ss / 2, Math.round(10 + bt * 40), rgba(COL.goldHi, 1 - bt * 2.5)); }
      keycap(ctx, String(i + 1), sx + ss - 7, yy + ss - 6, { color: focus ? COL.goldHi : COL.text });
      L.assign.push({ x: sx, y: yy, w: ss, h: ss });
      hits.add(id, sx, yy, ss, ss, { assign: i }, { pad: 3 });
    }
    yy += ss + 7;
    const lw = 56;
    const lx = icx - Math.round(lw / 2);
    if (yy + 16 <= y + ch - 4) {
      button(ctx, lx, yy, lw, 15, 'LATER', { focus: assignFoc === 4 && !locked, pressed: hits.isPressed('craft-assign-later'), t });
      hits.add('craft-assign-later', lx, yy, lw, 15, { assign: 4 }, { pad: 3 });
    }
  }

  // preload from data (e.g. the Forge NPC could pass a recipe)
  if (data && data.recipeId) {
    const r = recipes.find((x) => x.id === data.recipeId);
    if (r) { r.inputs.slice(0, SLOTS).forEach((e) => sel.push(e)); formPref = formOfR.get(r.id); }
  }
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
