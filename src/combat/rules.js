// Damage, status effects, elemental reactions, derived stats, crafting, items (team: combat).
import { EV } from '../core/events.js';
import { spendFragments, hasFragments, learnSpell, removeItem, checkRequirements, clampVitals, setFlag } from '../core/state.js';
import { SPELLS, RECIPES, ITEMS } from './data.js';
import { Zone, FloatText, burst } from './effects.js';
import { fx, sfx, shake, hitStop, colorsOf, isTarget } from './util.js';

// ------------------------------------------------------------------ stats

/** Recompute derived player stats from base + equipped items. Mutates state.player. */
export function computeStats(state) {
  const p = state.player;
  const b = p.base || { maxHp: 100, maxMana: 100, manaRegen: 5, spellPower: 1, moveSpeed: 80 };
  const out = {
    maxHp: b.maxHp, maxMana: b.maxMana, manaRegen: b.manaRegen, spellPower: b.spellPower, moveSpeed: b.moveSpeed,
    cooldownMult: 1, elementPower: {},
  };
  for (const id of Object.values(state.equipped || {})) {
    const s = id && ITEMS[id]?.stats;
    if (!s) continue;
    out.maxHp += s.maxHp || 0;
    out.maxMana += s.maxMana || 0;
    out.manaRegen += s.manaRegen || 0;
    out.spellPower += s.spellPower || 0;
    out.moveSpeed += s.moveSpeed || 0;
    out.cooldownMult += s.cooldownMult || 0;
    for (const [el, v] of Object.entries(s.elementPower || {})) out.elementPower[el] = (out.elementPower[el] || 0) + v;
  }
  out.cooldownMult = Math.max(0.5, out.cooldownMult);
  out.manaRegen = Math.max(0, out.manaRegen);
  Object.assign(p, out);
  clampVitals(state);
  return out;
}

/** Player damage multiplier for a spell: spellPower x (1 + best matching element affinity). */
export function spellPowerFor(state, spell) {
  const st = state.player;
  let aff = 0;
  for (const el of new Set(spell.elements || [spell.element])) aff = Math.max(aff, st.elementPower?.[el] || 0);
  // Combos get a share of every matching affinity, so a Prism staff rewards triple spells.
  if ((spell.elements || []).length > 1) {
    let sum = 0;
    for (const el of new Set(spell.elements)) sum += st.elementPower?.[el] || 0;
    aff = Math.max(aff, sum * 0.6);
  }
  return (st.spellPower || 1) * (1 + aff);
}

// ------------------------------------------------------------------ damage

const STATUS_ELEMENT = { burn: 'fire', chill: 'ice', freeze: 'ice', shock: 'lightning' };

const statusOf = (e, type) => e.statuses?.find((s) => s.type === type) || null;
function removeStatus(game, e, type) {
  const i = e.statuses?.findIndex((s) => s.type === type) ?? -1;
  if (i < 0) return;
  const [s] = e.statuses.splice(i, 1);
  game.bus.emit(EV.STATUS_EXPIRED, { target: e, status: s });
}

export function floatText(game, e, text, color = '#ffffff', big = false) {
  if (!e || !game.entities) return;
  game.entities.add(new FloatText(e.x, e.y - (e.def?.boss ? 30 : 20), text, color, big));
}

/**
 * Apply a hit. hit = {
 *   amount, element='physical', source=null, status?, statuses?, knockback=0 (px/s), from?: {x,y},
 *   elements?: [] (all elements of the spell, for reactions/wards), spell?, poise?, shieldBreak?,
 *   dot? (damage-over-time tick: ignores i-frames, no knockback), reactionless?, crit?, ignoreInvuln? }
 * Returns damage actually dealt.
 */
export function damage(game, target, hit) {
  if (!target || target.dead || !hit) return 0;
  if (target.tags?.has('player')) return damagePlayer(game, target, hit);
  if (target.dying || !(target.hp > 0)) return 0;
  const element = hit.element || 'physical';
  const src = hit.source || null;
  const def = target.def || {};
  if (target.invulnerable) {
    if (!hit.dot && (target._immuneT || 0) < game.time) { target._immuneT = game.time + 0.5; floatText(game, target, 'IMMUNE', '#c8c8d0'); }
    return 0;
  }

  // fusion spells resist as the average of their elements (Steam still scalds a fire-immune wisp)
  const resOf = (el) => (def.resist?.[el] ?? 1) * (target.resistMod?.[el] ?? 1);
  const els = hit.elements?.length > 1 && !hit.dot ? hit.elements : null;
  let mult = els ? els.reduce((a, el) => a + resOf(el), 0) / els.length : resOf(element);
  if (mult <= 0) {
    if (!hit.dot && (target._immuneT || 0) < game.time) { target._immuneT = game.time + 0.6; floatText(game, target, 'IMMUNE', '#c8c8d0'); }
    target.onHurt?.(game, hit, 0);
    return 0;
  }
  if (def.armored && element === 'lightning') mult *= 1.4;
  if (def.armored && element === 'earth') mult *= 1.15;
  if (statusOf(target, 'shock')) mult *= 1.2;
  let vuln = 0;
  for (const s of target.statuses || []) if (s.type === 'vulnerable') vuln = Math.max(vuln, s.power);
  mult *= 1 + vuln;
  if (target.damageTakenMult) mult *= target.damageTakenMult(game, hit);

  let blocked = false;
  if (!hit.dot && target.blockCheck) {
    const b = target.blockCheck(game, hit);
    if (b < 1) { mult *= b; blocked = true; }
  }

  let reaction = null;
  if (!blocked && !hit.dot && !hit.reactionless) reaction = react(game, target, hit);
  if (reaction) mult *= reaction.mult;
  const crit = !!(hit.crit || reaction?.crit);

  let amount = hit.amount * mult;
  if (target.wardFilter) amount = target.wardFilter(game, hit, amount);
  amount = amount > 0.05 ? Math.max(1, Math.round(amount)) : 0;

  // knockback & stagger
  if (!hit.dot && hit.knockback && target.mass !== Infinity && !(target.superArmorNow?.())) {
    const ox = hit.from?.x ?? src?.x ?? target.x, oy = hit.from?.y ?? src?.y ?? target.y;
    let dx = target.x - ox, dy = target.y - oy;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) { dx = 0; dy = 1; } else { dx /= d; dy /= d; }
    const k = (blocked ? 0.4 : 1) * hit.knockback / Math.max(0.6, target.mass || 1);
    target.kbx = (target.kbx || 0) * 0.3 + dx * k;
    target.kby = (target.kby || 0) * 0.3 + dy * k;
  }
  if (!hit.dot && amount > 0 && target.addPoise) target.addPoise(game, amount * (hit.poise || 1) * (blocked ? 0.5 : 1), hit);

  // statuses (after reactions, so a hit never reacts with itself)
  if (!blocked && amount > 0) {
    const list = hit.statuses || (hit.status ? [hit.status] : null);
    if (list) for (const s of list) {
      const el = STATUS_ELEMENT[s.type];
      if (el && (def.resist?.[el] ?? 1) <= 0) continue;
      applyStatus(game, target, { ...s, source: src });
    }
  }

  target.hp -= amount;
  if (amount > 0) target.hurtFlash = hit.dot ? 0.05 : 0.12;
  target.onHurt?.(game, hit, amount);
  game.bus.emit(EV.ENTITY_DAMAGED, {
    target, amount, element, source: src, crit, x: target.x, y: target.y,
    reaction: reaction?.name || null, blocked, dot: !!hit.dot,
  });
  if (blocked) {
    floatText(game, target, 'BLOCK', '#c8c8d0');
    fx(game, 'emit', 'hit', target.x, target.y - 8, { color: '#ffffff', color2: '#c8c8d0', count: 6 });
    sfx(game, 'hit', 0.6, 0.6);
    // teach the counterplay the first time a player's spell bounces off a shield
    if (src?.team === 'player' && !game.state.flags.shieldHint && ((target._blockedN = (target._blockedN || 0) + 1) >= 2)) {
      setFlag(game, 'shieldHint', true);
      game.bus.emit(EV.TOAST, { text: 'Shields block head-on hits! Strike its side or back, punish its swing, or use Lightning / heavy spells.', color: '#e8d08a', duration: 5 });
    }
  }
  if (crit && !hit.dot) hitStop(game, 0.06);
  if (target.hp <= 0) {
    target.hp = 0;
    if (src?.team === 'player' && !hit.dot) hitStop(game, target.def?.boss ? 0.2 : 0.045);
    target.die?.(game, src);
  }
  return amount;
}

function damagePlayer(game, target, hit) {
  const st = game.state.player;
  if (st.hp <= 0 || target.dying) return 0;
  const env = !hit.source || hit.dot;
  if (!env && !hit.ignoreInvuln && (target.invuln || 0) > 0) return 0;
  if (!hit.dot && (target.dashInvuln || 0) > 0) { target.onDodge?.(game, hit); return 0; }
  const element = hit.element || 'physical';
  const src = hit.source || null;
  const amount = Math.max(hit.amount > 0 ? 1 : 0, Math.round(hit.amount * (target.damageTakenMult || 1)));
  if (amount <= 0) return 0;
  st.hp = Math.max(0, st.hp - amount);

  if (!hit.dot) {
    target.invuln = 0.8;
    target.hurtT = 0.25;
    target.hurtFlash = 0.15;
    target.lastHurtTime = game.time;
    if (hit.knockback) {
      const ox = hit.from?.x ?? src?.x ?? target.x, oy = hit.from?.y ?? src?.y ?? target.y + 1;
      let dx = target.x - ox, dy = target.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      target.kbx = (dx / d) * hit.knockback;
      target.kby = (dy / d) * hit.knockback;
    }
    shake(game, amount >= 15 ? 4 : 2.5, 0.2);
    hitStop(game, amount >= 15 ? 0.08 : 0.05);
  } else {
    target.hurtFlash = Math.max(target.hurtFlash || 0, 0.05);
  }
  const list = hit.statuses || (hit.status ? [hit.status] : null);
  if (list) for (const s of list) applyStatus(game, target, { ...s, source: src });
  game.bus.emit(EV.PLAYER_DAMAGED, { amount, element, source: src, hp: st.hp, maxHp: st.maxHp, dot: !!hit.dot });
  if (st.hp <= 0) target.die?.(game, src);
  return amount;
}

// ------------------------------------------------------------------ reactions

const REACT_COLOR = { SHATTER: '#e6fbff', OVERLOAD: '#ffb03a', MELT: '#ff8a5a', SUPERCONDUCT: '#c8a0ff', QUENCH: '#e8e4f0' };

function react(game, target, hit) {
  if ((target.reactCd || 0) > game.time) return null;
  const els = hit.elements || [hit.element || 'physical'];
  const has = (el) => els.includes(el);
  const frozen = statusOf(target, 'freeze'), chill = statusOf(target, 'chill');
  const burn = statusOf(target, 'burn'), shock = statusOf(target, 'shock');
  const team = hit.source?.team || (target.team === 'enemy' ? 'player' : 'enemy');
  let r = null;

  if (frozen && (has('lightning') || has('earth'))) {
    removeStatus(game, target, 'freeze');
    r = { name: 'SHATTER', mult: 2.5, crit: true };
    burst(game, target.x, target.y - 4, 30, {
      team, source: hit.source, amount: Math.max(6, hit.amount * 0.6), element: 'ice', exclude: target,
      statuses: [{ type: 'chill', duration: 2, power: 30 }], knockback: 120, reactionless: true, ring: '#e6fbff', preset: 'impact',
    });
    shake(game, 3, 0.2);
    sfx(game, 'hit', 1, 1.6);
  } else if ((shock && has('fire')) || (burn && has('lightning'))) {
    removeStatus(game, target, 'shock');
    removeStatus(game, target, 'burn');
    r = { name: 'OVERLOAD', mult: 1.1, crit: false };
    burst(game, target.x, target.y - 4, 32, {
      team, source: hit.source, amount: Math.max(8, hit.amount * 0.9), element: 'fire', exclude: target,
      knockback: 220, reactionless: true, ring: '#ffb03a', preset: 'aoe', spellId: 'reaction_overload',
    });
    shake(game, 4, 0.25);
  } else if ((frozen || chill) && has('fire')) {
    removeStatus(game, target, 'freeze');
    removeStatus(game, target, 'chill');
    r = { name: 'MELT', mult: frozen ? 1.6 : 1.3, crit: !!frozen };
    game.entities.add(new Zone(game, 'cloud', target.x, target.y, { team, source: hit.source, radius: 16, life: 1.6, power: 1 }));
  } else if ((shock && has('ice')) || (chill && has('lightning'))) {
    removeStatus(game, target, 'shock');
    r = { name: 'SUPERCONDUCT', mult: 1.1, crit: false };
    applyStatus(game, target, { type: 'vulnerable', duration: 4, power: 0.3 });
  } else if (burn && has('ice')) {
    removeStatus(game, target, 'burn');
    r = { name: 'QUENCH', mult: 1.15, crit: false };
    game.entities.add(new Zone(game, 'cloud', target.x, target.y, { team, source: hit.source, radius: 22, life: 2.5, power: 1 }));
  }
  if (r) {
    target.reactCd = game.time + 0.35;
    floatText(game, target, r.name + '!', REACT_COLOR[r.name], true);
    game.bus.emit('combat:reaction', { target, reaction: r.name, x: target.x, y: target.y });
  }
  return r;
}

// ------------------------------------------------------------------ status effects

/**
 * status = { type: 'burn'|'chill'|'freeze'|'shock'|'blind'|'vulnerable'|'stun', duration, power, source? }
 *  burn: power = fire damage per 0.5 s     chill: power = chill build-up (100 => FREEZE)
 *  shock: brief flinch + takes +20% dmg    vulnerable: power = extra damage taken (0.3 = +30%)
 */
export function applyStatus(game, target, status) {
  if (!target || target.dead || !status?.type) return;
  target.statuses ||= [];
  const isPlayer = target.tags?.has('player');
  const def = target.def || {};
  let type = status.type;
  if (isPlayer && !['burn', 'chill', 'shock', 'slow'].includes(type)) return;
  const dur = status.duration ?? 1;
  let power = status.power ?? 1;

  if (type === 'freeze') {
    if (isPlayer || (def.freezeResist ?? 1) <= 0 || (target.freezeImmuneUntil || 0) > game.time) { type = 'chill'; power = 60; }
  }
  if (type === 'chill') {
    const fr = isPlayer ? 1 : (def.freezeResist ?? 1);
    const build = power * (fr > 0 ? fr : 0.6);
    const ex = statusOf(target, 'chill');
    const total = Math.min(100, (ex?.power || 0) + build);
    if (!isPlayer && fr > 0 && total >= 100 && !statusOf(target, 'freeze') && (target.freezeImmuneUntil || 0) <= game.time) {
      removeStatus(game, target, 'chill');
      return applyStatus(game, target, { type: 'freeze', duration: def.boss ? 0.8 : 1.8, power: 1, source: status.source });
    }
    if (ex) { ex.power = total; ex.time = Math.max(ex.time, dur); return; }
    power = total;
  }
  if (type === 'freeze') {
    target.freezeImmuneUntil = game.time + dur + 2.5;
    floatText(game, target, 'FROZEN', '#e6fbff');
    target.onFrozen?.(game);
  }
  if (type === 'shock' && !isPlayer) target.flinch = Math.max(target.flinch || 0, def.boss ? 0 : 0.22);

  const existing = statusOf(target, type);
  if (existing) {
    existing.time = Math.max(existing.time, dur);
    existing.power = Math.max(existing.power, power);
    if (status.source) existing.source = status.source;
    return;
  }
  const s = { type, time: dur, duration: dur, power, tick: 0, source: status.source || null };
  target.statuses.push(s);
  game.bus.emit(EV.STATUS_APPLIED, { target, status: s });
}

/** Call from an entity's update. Returns {slow, stunned, blind, frozen, regenStop}. */
const TICK = { slow: 1, stunned: false, blind: false, frozen: false, regenStop: false };
export function tickStatuses(game, e, dt) {
  TICK.slow = 1; TICK.stunned = false; TICK.blind = false; TICK.frozen = false; TICK.regenStop = false;
  const list = e.statuses;
  if (!list?.length) return TICK;
  const isPlayer = e.tags?.has('player');
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.time -= dt;
    switch (s.type) {
      case 'burn':
        s.tick += dt;
        if (s.tick >= 0.5) {
          s.tick -= 0.5;
          damage(game, e, { amount: s.power, element: 'fire', source: s.source, dot: true, reactionless: true });
          if (Math.random() < 0.8) fx(game, 'emit', 'trail', e.x + (Math.random() - 0.5) * 6, e.y - 8, { element: 'fire', count: 2 });
        }
        break;
      case 'chill':
        s.power = Math.max(0, s.power - 10 * dt);
        TICK.slow = Math.min(TICK.slow, 1 - Math.min(isPlayer ? 0.4 : 0.55, 0.2 + s.power / 100 * 0.45));
        break;
      case 'freeze':
        TICK.frozen = true; TICK.stunned = true;
        break;
      case 'stun':
        TICK.stunned = true;
        break;
      case 'shock':
        if (isPlayer) TICK.regenStop = true;
        break;
      case 'slow':
        TICK.slow = Math.min(TICK.slow, 1 - Math.min(0.6, s.power));
        break;
      case 'blind':
        TICK.blind = true;
        TICK.slow = Math.min(TICK.slow, 0.6);
        break;
      default: break;
    }
    if (s.time <= 0 || e.dead) {
      list.splice(i, 1);
      game.bus.emit(EV.STATUS_EXPIRED, { target: e, status: s });
    }
  }
  return TICK;
}

export const hasStatus = (e, type) => !!statusOf(e, type);
export { removeStatus };

// ------------------------------------------------------------------ crafting

const key = (els) => [...els].sort().join('+');

/**
 * Recipe whose inputs match the element multiset (order-insensitive), or null.
 * `form` (optional) picks the delivery: 'bolt'|'volley'|'orb'|'arc'|'nova'|'rune'|'seekers'.
 * Without a form the essence's first recipe is returned. A repeated single element
 * (['fire','fire']) falls back to the pure essence.
 */
export function findRecipe(elements, form = null) {
  if (!Array.isArray(elements) || !elements.length) return null;
  let k = key(elements);
  let list = RECIPES.filter((r) => key(r.inputs) === k);
  if (!list.length && new Set(elements).size === 1) {
    k = key([elements[0]]);
    list = RECIPES.filter((r) => key(r.inputs) === k);
  }
  if (!list.length) return null;
  if (form) return list.find((r) => r.form === form) || null;
  return list[0];
}

/** Can the player craft this recipe now? Returns {ok, reason}. */
export function canCraft(state, recipeId) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return { ok: false, reason: 'unknown' };
  if (state.spells.known.includes(r.result)) return { ok: false, reason: 'known' };
  if (!checkRequirements(state, r.requires)) return { ok: false, reason: 'locked' };
  if (!hasFragments(state, r.cost)) return { ok: false, reason: 'fragments' };
  return { ok: true, reason: null };
}

export function craft(game, recipeId) {
  const chk = canCraft(game.state, recipeId);
  if (!chk.ok) {
    game.bus.emit(EV.CRAFT_FAILED, { recipeId, reason: chk.reason });
    return { ok: false, reason: chk.reason };
  }
  const r = RECIPES.find((x) => x.id === recipeId);
  spendFragments(game, r.cost);
  if (!game.state.spells.crafted.includes(r.id)) game.state.spells.crafted.push(r.id);
  learnSpell(game, r.result, { crafted: true });
  game.bus.emit(EV.SPELL_CRAFTED, { spellId: r.result, recipeId: r.id });
  return { ok: true, spellId: r.result };
}

// ------------------------------------------------------------------ items

export function useItem(game, itemId) {
  const item = ITEMS[itemId];
  if (!item?.use) return false;
  const p = game.state.player;
  const wantsHeal = item.use.heal && p.hp < p.maxHp;
  const wantsMana = item.use.mana && p.mana < p.maxMana;
  if (!wantsHeal && !wantsMana) {
    game.bus.emit(EV.TOAST, { text: 'Already full', color: '#c8c8d0', duration: 0.8 });
    return false;
  }
  if (p.hp <= 0) return false;
  if (!removeItem(game, itemId, 1)) return false;
  if (item.use.heal) {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + item.use.heal);
    game.bus.emit(EV.PLAYER_HEALED, { amount: p.hp - before, hp: p.hp, maxHp: p.maxHp });
  }
  if (item.use.mana) {
    p.mana = Math.min(p.maxMana, p.mana + item.use.mana);
    if (game.player) fx(game, 'emit', 'heal', game.player.x, game.player.y - 6, { color: '#5a8aff', color2: '#c8e0ff' });
  }
  return true;
}

export function getSpell(id) {
  return SPELLS[id] || null;
}

// Re-exported so effects can test targets without importing util separately.
export { isTarget, colorsOf };
