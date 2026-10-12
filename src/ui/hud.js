// In-game HUD (team: ui). Screen space: vitals, fragment counters, spell bar, boss bar, area
// banners, minimap, save indicator and first-run hints. World space (hud-world.js): floating
// combat text, enemy HP bars and the interact prompt.
//
// createHud(game, ui) -> { update(dt), render(ctx), renderWorld(ctx, camera), banner(title, sub, color),
//                          layout, toastY, minimap, world }
// Layout adapts to display.width/height/safe each frame and keeps clear of the touch controls'
// reserved rects (ui.touch.reserved) whenever they are visible.
import { EV } from '../core/events.js';
import { ELEMENTS, CORE_ELEMENTS, TOWER_FLOORS } from '../core/config.js';
import { drawText, measureText } from './font.js';
import {
  COL, bar, drawEmblem, drawSweep, keycap, elColor, rarityOf, clamp, easeOutBack, easeOutCubic, mix, rrect,
} from './theme.js';
import { promptDevice } from './widgets.js';
import { createWorldOverlay } from './hud-world.js';
import { createMinimap } from './minimap.js';
import { drawMask, plate } from './hud-icons.js';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const EL_NAME = { fire: 'Fire', ice: 'Ice', lightning: 'Lightning', arcane: 'Arcane', earth: 'Earth' };
const SLOT = 22;
const GAP = 5;
const FRAG_H = 11;
const MARGIN = 5;
const CRAFT_REASONS = {
  fragments: 'Not enough fragments', locked: 'That recipe is still locked', known: 'You already know that spell',
  unknown: 'Unknown combination', mana: 'Not enough mana',
};
const HINTS = [['WASD', 'move'], ['MOUSE', 'aim'], ['1-4', 'cast'], ['E', 'interact'], ['I', 'bag'], ['C', 'craft']];

const isPlayer = (game, c) => !!c && (c === game.player || !!c.tags?.has?.('player'));

function vital() {
  return { init: false, prevF: 0, trail: 0, hold: 0, shown: 0, flash: 0, gain: 0, shimmer: 0, red: 0 };
}

function stepVital(v, cur, max, dt, flashOnLoss) {
  const f = max > 0 ? clamp(cur / max, 0, 1) : 0;
  if (!v.init) { v.init = true; v.prevF = v.trail = v.shown = f; }
  const d = f - v.prevF;
  if (d < -0.0005) {
    v.trail = Math.max(v.trail, v.prevF);
    v.hold = 0.4;
    if (flashOnLoss || d < -0.06) v.flash = 1;
    v.shown = f;
  } else if (d > 0.015) {
    v.gain = 1;
    v.shimmer = 0;
  }
  v.prevF = f;
  if (v.hold > 0) v.hold -= dt;
  else v.trail = Math.max(f, v.trail - dt * 0.55);
  if (v.trail < f) v.trail = f;
  if (v.shown < f) v.shown = Math.min(f, v.shown + dt * (v.gain > 0 ? 0.9 : 6));
  else v.shown = f;
  v.flash = Math.max(0, v.flash - dt * 5);
  v.gain = Math.max(0, v.gain - dt * 1.1);
  v.shimmer += dt * 1.6;
  v.red = Math.max(0, v.red - dt * 3);
  return f;
}

export function createHud(game, ui) {
  const world = createWorldOverlay(game, ui);
  const minimap = createMinimap(game);
  const hp = vital(), mana = vital();
  const frag = {};
  for (const el of ELEMENTS) frag[el] = { bump: 0, flash: 0, delta: 0, floatT: 0 };
  const seen = new Set();
  const slots = [0, 1, 2, 3].map(() => ({ pop: 0, shake: 0, red: 0, ready: 0, cdMax: 0, prevCd: 0, id: null }));
  let nameT = 0, nameText = '', nameColor = COL.gold;
  /** banner queue: {title, sub, color, t, dur, played} */
  const banners = [];
  const boss = { ent: null, trail: 1, hold: 0, lastF: 1, intro: 0, shake: 0, hit: 0, phase: 1, phaseFlash: 0, defeated: 0, name: '' };
  let saveT = 0;
  const fragToast = {};
  let manaToastAt = -9;
  let lowT = 0;

  const layout = {
    vitals: { x: 0, y: 0, w: 0, h: 0 },
    fragments: { x: 0, y: 0, w: 0, h: 0 },
    minimap: { x: 0, y: 0, w: 0, h: 0 },
    boss: { x: 0, y: 0, w: 0, h: 0 },
    spellbar: { x: 0, y: 0, w: 0, h: 0 },
    /** Suggested top y for toasts so they never cover the HUD's top rows. */
    toastY: 30,
  };
  const setRect = (r, x, y, w, h) => { r.x = x; r.y = y; r.w = w; r.h = h; };

  // ------------------------------------------------------------------ helpers

  const getSpell = (id) => (id ? game.combat.getSpell?.(id) || null : null);
  const cooldownOf = (id) => (id ? game.combat.getCooldown?.(game, id) || 0 : 0);
  const slotOf = (spellId) => (spellId ? game.state.loadout.indexOf(spellId) : -1);
  const toast = (text, color, dur, opts) => { if (game.isGameplay()) ui.toast(text, color, dur, opts); };
  const sfx = (name) => game.guard('hud.sfx', () => game.audio?.sfx?.(name));

  function banner(title, subtitle = '', color = COL.gold, opts = {}) {
    if (!title) return;
    banners.push({ title: String(title), sub: subtitle ? String(subtitle) : '', color, t: -(opts.delay ?? 0), dur: opts.duration ?? 2.9, played: false });
    while (banners.length > 3) banners.shift();
  }

  function visibleElements() {
    const st = game.state;
    for (const el of ELEMENTS) if ((st.fragments?.[el] ?? 0) > 0) seen.add(el);
    let n = 0;
    for (const el of ELEMENTS) if (CORE_ELEMENTS.includes(el) || seen.has(el)) visEls[n++] = el;
    visEls.length = n;
    return visEls;
  }
  const visEls = [];

  function findBoss() {
    for (const e of game.entities.list) if (!e.dead && e.tags.has('boss')) return e;
    return null;
  }

  // ------------------------------------------------------------------ events

  const { bus } = game;
  bus.on(EV.GAME_NEW, () => { seen.clear(); hp.init = mana.init = false; });
  bus.on(EV.GAME_LOADED, () => { seen.clear(); hp.init = mana.init = false; });
  bus.on(EV.PLAYER_RESPAWNED, () => { hp.init = mana.init = false; });

  bus.on(EV.LEVEL_READY, ({ level, spec } = {}) => {
    minimap.rebuild(level);
    banners.length = 0;
    boss.ent = null;
    for (const s of slots) { s.prevCd = 0; s.ready = 0; s.pop = 0; s.shake = 0; }
    const kind = level?.kind || spec?.kind;
    let sub = '', color = COL.gold;
    if (kind === 'hub') { sub = 'The Academy Grounds'; color = COL.goldHi; }
    else if (kind === 'dungeon') { sub = `Depth ${spec?.depth ?? 1}`; color = '#c8b8ff'; }
    else if (kind === 'tower') { sub = `Floor ${spec?.floor ?? 1} of ${TOWER_FLOORS}`; color = '#a8e0ff'; }
    else if (kind === 'boss') { sub = 'Face the Corrupted Archmage'; color = COL.bossHi; }
    const fallback = { hub: 'Arcania Academy', dungeon: 'The Dungeon', tower: 'The Mage Tower', boss: 'The Archmage\'s Sanctum' }[kind] || 'Unknown Lands';
    const title = level?.name || fallback;
    // avoid "Dungeon Depth 2 / Depth 2": swap a redundant subtitle for a flavour line
    if (sub && title.toLowerCase().includes(sub.toLowerCase())) sub = { dungeon: 'Clear the depths', tower: 'Ascend the Mage Tower' }[kind] || '';
    banner(title, sub, color, { delay: 0.45 });
  });
  bus.on(EV.SCENE_CHANGED, () => {
    if (!game.isGameplay()) { minimap.clear(); banners.length = 0; boss.ent = null; }
  });
  bus.on(EV.DUNGEON_CLEARED, ({ depth } = {}) => banner('Dungeon Cleared!', depth ? `Depth ${depth} purified` : '', COL.good));
  bus.on(EV.TOWER_FLOOR_CLEARED, ({ floor } = {}) => banner(floor ? `Floor ${floor} Cleared!` : 'Floor Cleared!', floor >= TOWER_FLOORS ? 'The way to the top is open' : 'The stairs are unsealed', COL.good));

  bus.on(EV.FRAGMENTS_CHANGED, ({ element, delta, total } = {}) => {
    const f = frag[element];
    if (!f || !delta) return;
    if (total > 0) seen.add(element);
    f.bump = 1;
    f.flash = 1;
    f.delta = f.floatT > 0.35 && Math.sign(f.delta) === Math.sign(delta) ? f.delta + delta : delta;
    f.floatT = 1;
    if (delta > 0 && game.isGameplay()) {
      const rec = fragToast[element];
      const n = rec && game.realTime < rec.until ? rec.n + delta : delta;
      fragToast[element] = { n, until: game.realTime + 1.9 };
      const name = EL_NAME[element] || element;
      toast(`+${n} ${name} Fragment${n === 1 ? '' : 's'}`, elColor(element, 1), 2.2, { emblem: element, key: 'frag:' + element });
    }
  });
  bus.on(EV.INVENTORY_CHANGED, ({ itemId, delta } = {}) => {
    if (!(delta > 0) || !game.isGameplay()) return;
    const item = game.combat.getItem?.(itemId);
    if (!item) return;
    toast(`Found: ${item.name}${delta > 1 ? ' x' + delta : ''}`, rarityOf(item.rarity).color, 2.6, { icon: item.icon, key: 'item:' + itemId });
    sfx('toast');
  });
  bus.on(EV.SPELL_CRAFTED, ({ spellId } = {}) => {
    const sp = getSpell(spellId);
    toast(`Spell crafted: ${sp?.name || spellId}!`, COL.gold, 3.2, { icon: sp?.icon, big: true });
    sfx('toast');
  });
  bus.on(EV.SPELL_LEARNED, ({ spellId, crafted } = {}) => {
    if (crafted) return;
    const sp = getSpell(spellId);
    toast(`Learned ${sp?.name || spellId}`, '#c8b8ff', 2.6, { icon: sp?.icon });
    sfx('toast');
  });
  bus.on(EV.CRAFT_FAILED, ({ reason } = {}) => toast(CRAFT_REASONS[reason] || String(reason || 'Crafting failed'), COL.bad, 2));
  bus.on(EV.LOADOUT_CHANGED, ({ slot, spellId } = {}) => {
    if (!game.isGameplay()) return;
    const sp = getSpell(spellId);
    if (slots[slot]) { slots[slot].pop = 1; slots[slot].ready = 1; }
    nameText = sp ? `${slot + 1}: ${sp.name}` : `Slot ${slot + 1} cleared`;
    nameColor = sp ? mix(elColor(sp.element, 0), '#ffffff', 0.35) : COL.dim;
    nameT = 1.8;
  });
  bus.on(EV.SPELL_CAST, ({ caster, spellId } = {}) => {
    if (!isPlayer(game, caster)) return;
    const i = slotOf(spellId);
    if (i >= 0) slots[i].pop = 1;
  });
  bus.on(EV.SPELL_FAILED, ({ caster, spellId, reason } = {}) => {
    if (!isPlayer(game, caster)) return;
    const i = slotOf(spellId);
    if (reason === 'mana') {
      if (i >= 0) { slots[i].shake = 1; slots[i].red = 1; }
      mana.red = 1;
      if (game.realTime - manaToastAt > 1) { manaToastAt = game.realTime; toast('Not enough mana', COL.manaHi, 1.1, { key: 'nomana' }); }
    } else if (reason === 'cooldown' && i >= 0) {
      slots[i].shake = Math.max(slots[i].shake, 0.5);
    }
  });
  bus.on(EV.BOSS_SPAWNED, ({ boss: b } = {}) => { if (b && b !== boss.ent) adoptBoss(b); });
  bus.on(EV.BOSS_PHASE, ({ boss: b, phase } = {}) => {
    if (b && b !== boss.ent) adoptBoss(b);
    boss.phase = phase || boss.phase + 1;
    boss.phaseFlash = 1;
    boss.shake = 1;
  });
  bus.on(EV.BOSS_DEFEATED, () => { if (boss.ent && !boss.defeated) boss.defeated = 0.0001; });
  bus.on(EV.GAME_SAVED, ({ ok } = {}) => { if (ok && game.isGameplay()) saveT = 1.4; });

  function adoptBoss(b) {
    boss.ent = b;
    boss.trail = boss.lastF = b.maxHp > 0 ? clamp(b.hp / b.maxHp, 0, 1) : 1;
    boss.hold = 0;
    boss.intro = 0;
    boss.shake = boss.hit = boss.phaseFlash = 0;
    boss.defeated = 0;
    boss.phase = b.phase || 1;
    boss.name = b.def?.name || b.name || 'Boss';
  }

  // ------------------------------------------------------------------ update

  function update(dt) {
    world.update(dt);
    const live = game.isGameplay() && game.player;
    if (live) {
      minimap.update(dt);
      const st = game.state.player;
      stepVital(hp, st.hp, st.maxHp, dt, true);
      stepVital(mana, st.mana, st.maxMana, dt, false);
      const lo = game.state.loadout;
      for (let i = 0; i < 4; i++) {
        const s = slots[i], id = lo[i];
        if (s.id !== id) { s.id = id; s.prevCd = 0; s.cdMax = 0; }
        const cd = cooldownOf(id);
        if (cd > s.prevCd + 0.05) s.cdMax = cd;
        if (s.prevCd > 0 && cd <= 0) s.ready = 1;
        s.prevCd = cd;
      }
      // boss
      if (!boss.ent || (boss.ent.dead && !boss.defeated)) {
        const b = findBoss();
        if (b && b !== boss.ent) adoptBoss(b);
      }
      if (boss.ent) {
        const e = boss.ent;
        const f = e.maxHp > 0 ? clamp(e.hp / e.maxHp, 0, 1) : 0;
        if (f < boss.lastF - 0.0001) {
          boss.trail = Math.max(boss.trail, boss.lastF);
          boss.hold = 0.5;
          boss.hit = 1;
          if (boss.lastF - f > 0.025) boss.shake = Math.max(boss.shake, Math.min(1, (boss.lastF - f) * 18));
        }
        boss.lastF = f;
        if (boss.hold > 0) boss.hold -= dt;
        else boss.trail = Math.max(f, boss.trail - dt * 0.35);
        if (e.phase && e.phase > boss.phase) { boss.phase = e.phase; boss.phaseFlash = 1; }
        if (!boss.defeated && (e.dead || e.hp <= 0)) boss.defeated = 0.0001;
      }
    }
    if (boss.ent) {
      boss.intro = Math.min(1, boss.intro + dt / 0.9);
      boss.shake = Math.max(0, boss.shake - dt * 3);
      boss.hit = Math.max(0, boss.hit - dt * 6);
      boss.phaseFlash = Math.max(0, boss.phaseFlash - dt * 1.2);
      if (boss.defeated > 0) { boss.defeated += dt; if (boss.defeated > 2.4) boss.ent = null; }
    }
    for (const s of slots) {
      s.pop = Math.max(0, s.pop - dt * 5);
      s.shake = Math.max(0, s.shake - dt * 3.2);
      s.red = Math.max(0, s.red - dt * 3);
      s.ready = Math.max(0, s.ready - dt * 3);
    }
    for (const el of ELEMENTS) {
      const f = frag[el];
      f.bump = Math.max(0, f.bump - dt * 4);
      f.flash = Math.max(0, f.flash - dt * 2.5);
      f.floatT = Math.max(0, f.floatT - dt / 1.1);
    }
    nameT = Math.max(0, nameT - dt);
    saveT = Math.max(0, saveT - dt);
    lowT += dt;
    const b = banners[0];
    if (b) {
      b.t += dt;
      if (!b.played && b.t >= 0) { b.played = true; sfx('banner'); }
      if (b.t >= b.dur) banners.shift();
    }
  }

  // ------------------------------------------------------------------ vitals

  function drawVitals(ctx, x, y, t) {
    const st = game.state.player;
    const maxHp = Math.max(1, Math.round(st.maxHp)), maxMana = Math.max(1, Math.round(st.maxMana));
    const hpW = clamp(Math.round(52 + (maxHp - 100) * 0.3), 44, 100);
    const mW = clamp(Math.round(52 + (maxMana - 100) * 0.3), 44, 100);
    const barMax = Math.max(hpW, mW);
    const numW = Math.max(measureText(`${maxHp}/${maxHp}`), measureText(`${maxMana}/${maxMana}`));
    const w = 15 + barMax + 4 + numW + 4, h = 22;
    plate(ctx, x, y, w, h);
    const hpF = hp.prevF;
    const low = st.hp > 0 && hpF < 0.25;
    const pulse = low ? 0.5 + 0.5 * Math.sin(lowT * 7.5) : 0;
    const bx = x + 15, numX = bx + barMax + 4;

    // HP row
    const heartY = y + 4 - (low && pulse > 0.8 ? 1 : 0);
    if (low) drawMask(ctx, 'heart', x + 4, heartY, mix('#ff3a50', '#ffd0d8', pulse * 0.7), '#fff0f4', '#8a1028');
    else drawMask(ctx, 'heart', x + 4, heartY, COL.hp, COL.hpHi, COL.hpLo);
    const healing = hp.shown < hpF - 0.001;
    bar(ctx, bx, y + 4, hpW, 6, healing ? hp.shown : hpF, healing ? hpF : hp.trail, {
      fill: low ? mix(COL.hp, '#ffb0bc', pulse * 0.6) : COL.hp, hi: COL.hpHi, lo: COL.hpLo, trailCol: healing ? '#9affb0' : COL.trail,
    }, { flash: hp.flash, shimmer: hp.gain > 0 ? hp.shimmer : 0 });
    if (hp.gain > 0) { ctx.fillStyle = `rgba(122,255,154,${(hp.gain * 0.35).toFixed(2)})`; ctx.fillRect(bx, y + 4, Math.round(hpW * hpF), 5); }
    drawText(ctx, `${Math.ceil(Math.max(0, st.hp))}/${maxHp}`, numX, y + 4, { color: low ? mix(COL.bad, '#ffffff', pulse * 0.5) : COL.hpHi });

    // Mana row
    const mF = mana.prevF;
    const mx = bx + (mana.red > 0 ? Math.round(Math.sin(t * 80) * 2 * mana.red) : 0);
    drawMask(ctx, 'drop', x + 5, y + 12, COL.mana, COL.manaHi, COL.manaLo);
    const mHeal = mana.shown < mF - 0.001;
    bar(ctx, mx, y + 13, mW, 5, mHeal ? mana.shown : mF, mHeal ? mF : mana.trail, {
      fill: COL.mana, hi: COL.manaHi, lo: COL.manaLo, trailCol: mHeal ? '#d8f0ff' : '#8ab0ff',
    }, { flash: mana.flash, shimmer: mana.gain > 0 ? mana.shimmer : 0 });
    if (mana.red > 0) { ctx.fillStyle = `rgba(255,70,90,${(mana.red * 0.7).toFixed(2)})`; ctx.fillRect(mx, y + 13, mW, 5); }
    drawText(ctx, `${Math.floor(Math.max(0, st.mana))}/${maxMana}`, numX, y + 13, { color: mana.red > 0.3 ? COL.bad : COL.manaHi });
    return { w, h };
  }

  function lowHpVignette(ctx, W, H) {
    const st = game.state.player;
    const f = st.maxHp > 0 ? st.hp / st.maxHp : 1;
    if (!(st.hp > 0) || f >= 0.25) return;
    const pulse = 0.5 + 0.5 * Math.sin(lowT * 7.5);
    const a = (0.3 + 0.25 * pulse) * (1.2 - (f / 0.25) * 0.4);
    ctx.save();
    ctx.fillStyle = '#c0102a';
    const BANDS = 9, BW = 3;
    for (let i = 0; i < BANDS; i++) {
      ctx.globalAlpha = a * (1 - i / BANDS) ** 1.5;
      const o = i * BW;
      ctx.fillRect(o, o, W - o * 2, BW);
      ctx.fillRect(o, H - o - BW, W - o * 2, BW);
      ctx.fillRect(o, o + BW, BW, H - o * 2 - BW * 2);
      ctx.fillRect(W - o - BW, o + BW, BW, H - o * 2 - BW * 2);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ fragments

  function fragWidth(els) {
    let w = 2;
    for (const el of els) w += 12 + measureText(String(game.state.fragments[el] ?? 0)) + 3;
    return w + 1;
  }

  function drawFragments(ctx, x, y, els, w) {
    plate(ctx, x, y, w, FRAG_H);
    let cx = x + 3;
    for (const el of els) {
      const f = frag[el];
      const txt = String(game.state.fragments[el] ?? 0);
      const tw = measureText(txt);
      const by = Math.round(Math.sin(f.bump * Math.PI) * 2);
      drawEmblem(ctx, el, cx, y + 2 - by);
      const hi = elColor(el, 1);
      drawText(ctx, txt, cx + 10, y + 3 - (f.bump > 0.6 ? 1 : 0), { color: f.flash > 0 ? mix(hi, '#ffffff', f.flash) : hi });
      if (f.floatT > 0 && f.delta) {
        const k = 1 - f.floatT;
        const s = (f.delta > 0 ? '+' : '') + f.delta;
        drawText(ctx, s, cx + 6 + tw / 2, y + FRAG_H + 2 + Math.round(easeOutCubic(k) * 5), {
          align: 'center', color: f.delta > 0 ? mix(hi, '#ffffff', 0.3) : '#ff8a9a', alpha: Math.min(1, f.floatT * 2.2), outline: COL.ink, shadow: null,
        });
      }
      cx += 12 + tw + 3;
    }
  }

  // ------------------------------------------------------------------ spell bar

  function drawSlot(ctx, i, x, y, t, keyboard) {
    const s = slots[i];
    const id = game.state.loadout[i];
    const spell = getSpell(id);
    x += s.shake > 0 ? Math.round(Math.sin(t * 85) * 2.5 * s.shake) : 0;
    y -= Math.round(Math.sin(s.pop * Math.PI * 0.5) * 2);
    if (!spell) {
      rrect(ctx, x, y, SLOT, SLOT, 'rgba(11,7,22,0.5)');
      ctx.fillStyle = 'rgba(138,128,168,0.55)';
      for (let k = 2; k < SLOT - 2; k += 3) {
        ctx.fillRect(x + k, y, 1, 1); ctx.fillRect(x + k, y + SLOT - 1, 1, 1);
        ctx.fillRect(x, y + k, 1, 1); ctx.fillRect(x + SLOT - 1, y + k, 1, 1);
      }
      ctx.fillStyle = 'rgba(138,128,168,0.35)';
      ctx.fillRect(x + SLOT / 2 - 2, y + SLOT / 2, 5, 1);
      ctx.fillRect(x + SLOT / 2, y + SLOT / 2 - 2, 1, 5);
      if (keyboard) keycap(ctx, String(i + 1), x + SLOT / 2 - 4, y - 5, { alpha: 0.5, color: COL.dim });
      return;
    }
    const st = game.state.player;
    const cost = spell.manaCost || 0;
    const noMana = st.mana < cost;
    const els = spell.elements?.length ? [...new Set(spell.elements)] : [spell.element];
    rrect(ctx, x - 1, y - 1, SLOT + 2, SLOT + 2, COL.ink);
    if (els.length > 1) {
      const segW = SLOT / els.length;
      for (let k = 0; k < els.length; k++) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + Math.round(k * segW), y, Math.round((k + 1) * segW) - Math.round(k * segW), SLOT);
        ctx.clip();
        rrect(ctx, x, y, SLOT, SLOT, noMana ? mix(elColor(els[k], 0), '#3a3058', 0.6) : elColor(els[k], 0));
        ctx.restore();
      }
    } else rrect(ctx, x, y, SLOT, SLOT, noMana ? mix(elColor(els[0], 0), '#3a3058', 0.6) : elColor(els[0], 0));
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + 1, y, SLOT - 2, 1);
    ctx.fillStyle = '#140c1c';
    ctx.fillRect(x + 2, y + 2, SLOT - 4, SLOT - 4);
    ctx.fillStyle = '#251a40';
    ctx.fillRect(x + 2, y + 2, SLOT - 4, 6);
    game.art.drawIcon(ctx, spell.icon, x + 3, y + 3, { alpha: noMana ? 0.45 : 1 });
    if (noMana) {
      ctx.fillStyle = 'rgba(70,40,150,0.35)';
      ctx.fillRect(x + 2, y + 2, SLOT - 4, SLOT - 4);
    }
    const cd = cooldownOf(id);
    if (cd > 0) {
      const max = Math.max(s.cdMax, spell.cooldown || 0.001, cd);
      drawSweep(ctx, x + 2, y + 2, SLOT - 4, SLOT - 4, cd / max);
      if (cd >= 0.95) drawText(ctx, String(Math.ceil(cd)), x + SLOT / 2 + 1, y + 8, { align: 'center', color: COL.text, outline: COL.ink, shadow: null });
    }
    if (s.ready > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(s.ready * 0.6).toFixed(2)})`;
      ctx.fillRect(x + 2, y + 2, SLOT - 4, SLOT - 4);
      const e = Math.round((1 - s.ready) * 5);
      ctx.save();
      ctx.globalAlpha = s.ready;
      ctx.strokeStyle = elColor(els[0], 1);
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 1 - e + 0.5, y - 1 - e + 0.5, SLOT + 1 + e * 2, SLOT + 1 + e * 2);
      ctx.restore();
    }
    if (s.pop > 0) { ctx.fillStyle = `rgba(255,255,255,${(s.pop * 0.3).toFixed(2)})`; ctx.fillRect(x + 2, y + 2, SLOT - 4, SLOT - 4); }
    if (s.red > 0) { ctx.fillStyle = `rgba(255,50,70,${(s.red * 0.55).toFixed(2)})`; ctx.fillRect(x + 2, y + 2, SLOT - 4, SLOT - 4); }
    if (cost > 0) drawText(ctx, String(Math.round(cost)), x + SLOT - 2, y + SLOT - 7, { align: 'right', color: noMana ? COL.bad : COL.manaHi, outline: COL.ink, shadow: null });
    if (keyboard) keycap(ctx, String(i + 1), x + SLOT / 2 - 4, y - 5, { color: s.pop > 0.3 ? COL.gold : COL.text, pressed: s.pop > 0.5 });
  }

  function drawHints(ctx, cx, y, alpha) {
    let total = 0;
    for (const [k, txt] of HINTS) total += Math.max(9, measureText(k) + 5) + 2 + measureText(txt) + 7;
    total -= 7;
    let x = Math.round(cx - total / 2);
    ctx.save();
    ctx.globalAlpha *= alpha;
    plate(ctx, x - 4, y - 2, total + 8, 13, 'rgba(255,210,90,0.18)', 0.85);
    for (const [k, txt] of HINTS) {
      x += keycap(ctx, k, x, y) + 2;
      drawText(ctx, txt, x, y + 2, { color: COL.dim });
      x += measureText(txt) + 7;
    }
    ctx.restore();
    return total;
  }

  // ------------------------------------------------------------------ boss bar

  function drawBoss(ctx, x, y, w, t) {
    const e = boss.ent;
    const f = e.maxHp > 0 ? clamp(e.hp / e.maxHp, 0, 1) : 0;
    const intro = easeOutCubic(boss.intro);
    const fadeOut = boss.defeated > 0.5 ? clamp(1 - (boss.defeated - 0.5) / 1.6, 0, 1) : 1;
    x += boss.shake > 0 ? Math.round(Math.sin(t * 70) * 2.5 * boss.shake) : 0;
    const h = 24;
    ctx.save();
    ctx.globalAlpha *= fadeOut * clamp(boss.intro * 3, 0, 1);
    plate(ctx, x - 4, y, w + 8, h, 'rgba(255,58,138,0.45)');
    // name row
    drawMask(ctx, 'skull', x, y + 3, '#e8dcf8', '#ffffff', '#8a80a8');
    drawText(ctx, boss.name, x + 10, y + 4, { color: COL.bossHi, alpha: intro });
    const maxPhase = Math.max(boss.phase, e.phaseCount ?? e.def?.phases ?? 3);
    const label = `PHASE ${ROMAN[boss.phase] || boss.phase}`;
    let px = x + w;
    for (let i = maxPhase; i >= 1; i--) {
      px -= 5;
      const on = i <= boss.phase;
      rrect(ctx, px, y + 4, 4, 5, COL.ink);
      ctx.fillStyle = on ? (i === boss.phase && boss.phaseFlash > 0 && Math.sin(t * 30) > 0 ? '#ffffff' : COL.boss) : '#3a2a50';
      ctx.fillRect(px + 1, y + 5, 2, 3);
    }
    drawText(ctx, label, px - 3, y + 4, { align: 'right', color: boss.phaseFlash > 0 ? mix(COL.bossHi, '#ffffff', boss.phaseFlash) : COL.dim, alpha: intro });
    // bar
    const bw = Math.max(2, Math.round(w * intro));
    const bx = x + Math.round((w - bw) / 2);
    const dead = boss.defeated > 0;
    bar(ctx, bx, y + 14, bw, 6, dead ? 0 : f, dead ? Math.max(0, 1 - boss.defeated * 2) * boss.trail : boss.trail, {
      fill: boss.phaseFlash > 0 ? mix(COL.boss, '#ffffff', boss.phaseFlash * 0.5) : COL.boss, hi: COL.bossHi, lo: '#8a1048', trailCol: '#fff0c0',
    }, { flash: dead ? clamp(1 - boss.defeated * 2, 0, 1) : boss.hit * 0.8, segments: 10 });
    ctx.restore();
    if (dead && boss.defeated < 2.2) {
      drawText(ctx, 'DEFEATED', x + w / 2, y + h + 4, { align: 'center', color: COL.goldHi, outline: COL.ink, shadow: null, alpha: fadeOut * clamp(boss.defeated * 3, 0, 1) });
    }
    return h;
  }

  // ------------------------------------------------------------------ banner

  function drawBanner(ctx, W, H) {
    const b = banners[0];
    if (!b || b.t < 0) return;
    const tin = 0.4, tout = 0.6;
    const a = b.t < tin ? b.t / tin : b.t > b.dur - tout ? clamp((b.dur - b.t) / tout, 0, 1) : 1;
    let scale = 2;
    let tw = measureText(b.title, 2);
    if (tw > Math.min(W - 40, W * 0.78)) { scale = 1; tw = measureText(b.title); }
    const cy = Math.round(H * (H > W ? 0.3 : 0.37));
    const cx = Math.round(W / 2);
    ctx.save();
    ctx.globalAlpha *= a;
    // soft dark band for readability
    const bandW = Math.min(W, tw + 150), bandH = b.sub ? 34 : 24;
    const bx0 = Math.round(cx - bandW / 2), by0 = cy - 7;
    ctx.fillStyle = '#0b0716';
    const STEPS = 8;
    for (let i = 0; i < STEPS; i++) {
      const inset = Math.round((i / STEPS) * (bandW / 2 - tw / 2 - 10));
      ctx.globalAlpha = a * 0.08;
      ctx.fillRect(bx0 + inset, by0, bandW - inset * 2, bandH);
    }
    ctx.globalAlpha = a;
    const drop = Math.round((1 - easeOutBack(b.t / 0.5)) * -6);
    drawText(ctx, b.title, cx, cy + drop, { align: 'center', scale, color: b.color, outline: COL.ink, shadow: COL.ink });
    // ornamental lines extending outward
    const L = Math.max(0, Math.min(64, (W - tw) / 2 - 18));
    const ext = Math.round(easeOutCubic((b.t - 0.1) / 0.8) * L);
    const ly = cy + (scale === 2 ? 4 : 2);
    if (ext > 1) {
      const l0 = cx - Math.round(tw / 2) - 7, r0 = cx + Math.round(tw / 2) + 6;
      ctx.fillStyle = COL.ink;
      ctx.fillRect(l0 - ext, ly - 1, ext + 1, 3);
      ctx.fillRect(r0, ly - 1, ext + 1, 3);
      ctx.fillStyle = b.color;
      ctx.fillRect(l0 - ext + 1, ly, ext - 1, 1);
      ctx.fillRect(r0 + 1, ly, ext - 1, 1);
      // diamonds at the ends + at the text side
      for (const dx of [l0 - ext, r0 + ext, l0 + 2, r0 - 2]) {
        ctx.fillStyle = COL.ink;
        ctx.fillRect(dx - 2, ly - 1, 5, 3);
        ctx.fillRect(dx - 1, ly - 2, 3, 5);
        ctx.fillStyle = dx === l0 + 2 || dx === r0 - 2 ? b.color : COL.goldHi;
        ctx.fillRect(dx - 1, ly, 3, 1);
        ctx.fillRect(dx, ly - 1, 1, 3);
      }
    }
    if (b.sub) {
      const sa = clamp((b.t - 0.25) / 0.4, 0, 1);
      drawText(ctx, b.sub, cx, cy + (scale === 2 ? 16 : 10), { align: 'center', color: '#e8e0ff', outline: COL.ink, shadow: null, alpha: sa });
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ save indicator

  function drawSave(ctx, x, y) {
    if (saveT <= 0) return;
    const a = Math.min(1, saveT / 0.4) * Math.min(1, (1.4 - saveT) / 0.15);
    const frame = Math.floor(game.realTime * 10) % 2;
    drawMask(ctx, frame ? 'rune1' : 'rune0', x, y, '#c8b8ff', '#ffffff', '#7a5aff', COL.ink, a * 0.9);
    drawText(ctx, 'SAVED', x + 10, y + 1, { color: COL.dim, alpha: a * 0.85 });
  }

  // ------------------------------------------------------------------ render

  function render(ctx) {
    const d = game.display, W = d.width, H = d.height, s = d.safe;
    const t = game.realTime;
    const touchOn = ui.touchVisible;
    const res = touchOn ? ui.touch?.reserved : null;
    const narrow = W < 360;

    lowHpVignette(ctx, W, H);

    // vitals (top-left)
    const vx = s.left + MARGIN, vy = s.top + MARGIN;
    const vb = drawVitals(ctx, vx, vy, t);
    setRect(layout.vitals, vx, vy, vb.w, vb.h);

    // fragments: top-right on desktop, stacked under the vitals otherwise
    const els = visibleElements();
    const fw = fragWidth(els);
    const rightLimit = W - s.right - MARGIN;
    const fragRight = !touchOn && vx + vb.w + 10 + fw <= rightLimit - (W < 420 ? 60 : 0);
    const fx = fragRight ? rightLimit - fw : vx;
    const fy = fragRight ? vy + 1 : vy + vb.h + 4;
    drawFragments(ctx, fx, fy, els, fw);
    setRect(layout.fragments, fx, fy, fw, FRAG_H);
    const leftBottom = fragRight ? vy + vb.h : fy + FRAG_H;

    // minimap (top-right, under the fragments or the touch buttons)
    const trRect = res?.topRight;
    let rightTop = trRect ? trRect.y + trRect.h + 3 : fragRight ? fy + FRAG_H + 5 : vy;
    let rightBottom = trRect ? trRect.y + trRect.h : fragRight ? fy + FRAG_H : vy;
    if (minimap.active) {
      const ms = minimap.size(narrow);
      const mx = rightLimit - ms.w - 1, my = rightTop + 2;
      minimap.render(ctx, mx, my, narrow);
      setRect(layout.minimap, mx, my, ms.w, ms.h);
      rightBottom = my + ms.h + 2;
    } else setRect(layout.minimap, 0, 0, 0, 0);

    // boss bar
    let topCentreBottom = vy;
    if (boss.ent) {
      let bw = clamp(Math.round(W * 0.42), 130, 230);
      const leftEdge = vx + vb.w + 10;
      let rightEdge = rightLimit;
      if (fragRight) rightEdge = Math.min(rightEdge, fx - 10);
      if (trRect) rightEdge = Math.min(rightEdge, trRect.x - 8);
      let bx = Math.round(W / 2 - bw / 2), by = vy - 1;
      if (bx < leftEdge || bx + bw > rightEdge) {
        // try to fit between the corners, else drop below everything at the top
        const span = rightEdge - leftEdge;
        if (span >= 130) { bw = Math.min(bw, span); bx = Math.round(leftEdge + (span - bw) / 2); }
        else {
          bw = Math.min(bw, W - s.left - s.right - 20);
          bx = Math.round(W / 2 - bw / 2);
          by = Math.max(leftBottom, minimap.active ? vy : rightBottom) + 6;
          if (minimap.active && bx + bw + 4 > layout.minimap.x && by < layout.minimap.y + layout.minimap.h + 4) by = Math.max(by, layout.minimap.y + layout.minimap.h + 6);
        }
      }
      const bh = drawBoss(ctx, bx, by, bw, t);
      setRect(layout.boss, bx, by, bw, bh);
      topCentreBottom = by + bh + (boss.defeated > 0 ? 12 : 0);
    } else setRect(layout.boss, 0, 0, 0, 0);
    layout.toastY = Math.max(s.top + (narrow ? 44 : 30), topCentreBottom + 5, narrow ? leftBottom + 5 : 0);

    // spell bar (keyboard / mouse only; touch buttons replace it)
    const keyboard = promptDevice(game) !== 'touch';
    let barTop = H - s.bottom;
    if (!touchOn) {
      const total = 4 * SLOT + 3 * GAP;
      const bx = Math.round(W / 2 - total / 2), by = H - s.bottom - SLOT - 6;
      plate(ctx, bx - 5, by - 3, total + 10, SLOT + 6, 'rgba(200,184,255,0.18)', 0.85);
      for (let i = 0; i < 4; i++) drawSlot(ctx, i, bx + i * (SLOT + GAP), by, t, keyboard);
      setRect(layout.spellbar, bx, by, total, SLOT);
      barTop = by - 6;
    } else setRect(layout.spellbar, 0, 0, 0, 0);

    // first-run hints (keyboard players in the hub)
    let aboveBar = barTop;
    if (!touchOn && keyboard && game.level?.kind === 'hub' && (game.state.stats?.spellsCast ?? 1) === 0 && W >= 300) {
      const a = clamp((game.time - 1.2) / 0.8, 0, 1);
      if (a > 0) { drawHints(ctx, Math.round(W / 2), barTop - 12, a); aboveBar = barTop - 16; }
    }

    // spell name after a loadout change
    if (nameT > 0) {
      const a = Math.min(1, nameT / 0.4) * Math.min(1, (1.8 - nameT) / 0.15);
      const y = touchOn ? Math.round(H * 0.62) : aboveBar - 9;
      drawText(ctx, nameText, Math.round(W / 2), y, { align: 'center', color: nameColor, outline: COL.ink, shadow: null, alpha: a });
    }

    // save indicator
    if (touchOn) drawSave(ctx, vx + 2, leftBottom + 5);
    else drawSave(ctx, s.left + MARGIN + 1, H - s.bottom - MARGIN - 8);

    drawBanner(ctx, W, H);
  }

  return {
    update,
    render,
    renderWorld(ctx, camera) {
      if (!game.isGameplay()) return;
      world.render(ctx, camera);
    },
    banner,
    layout,
    get toastY() { return layout.toastY; },
    minimap,
    world,
  };
}
