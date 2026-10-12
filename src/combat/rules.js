// Damage, status effects, derived stats, crafting (team: combat). Placeholder rules.
import { EV } from '../core/events.js';
import { spendFragments, hasFragments, learnSpell, removeItem, checkRequirements, clampVitals } from '../core/state.js';
import { SPELLS, RECIPES, ITEMS } from './data.js';

// ------------------------------------------------------------------ stats

/** Recompute derived player stats from base + equipped items. Mutates state.player. */
export function computeStats(state) {
  const p = state.player;
  const b = p.base;
  const out = { maxHp: b.maxHp, maxMana: b.maxMana, manaRegen: b.manaRegen, spellPower: b.spellPower, moveSpeed: b.moveSpeed, cooldownMult: 1, elementPower: {} };
  for (const id of Object.values(state.equipped)) {
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
  Object.assign(p, out);
  clampVitals(state);
  return out;
}

// ------------------------------------------------------------------ damage

/**
 * Apply a hit. hit = { amount, element='physical', source=null, status=null, knockback=0 (px/s) }
 * Returns damage actually dealt.
 */
export function damage(game, target, hit) {
  if (!target || target.dead) return 0;
  const element = hit.element || 'physical';
  const isPlayer = target.tags.has('player');
  if ((target.invuln || 0) > 0) return 0;
  const resist = target.def?.resist?.[element] ?? 1;
  const amount = Math.max(0, Math.round(hit.amount * resist));
  const src = hit.source;

  if (hit.knockback && src) {
    const dx = target.x - src.x, dy = target.y - src.y, d = Math.hypot(dx, dy) || 1;
    const k = hit.knockback / (target.mass === Infinity ? 1e9 : target.mass || 1);
    target.kbx = (dx / d) * k;
    target.kby = (dy / d) * k;
  }
  if (hit.status && amount > 0) applyStatus(game, target, hit.status);
  target.hurtFlash = 0.15;

  if (isPlayer) {
    const p = game.state.player;
    if (p.hp <= 0) return 0;
    p.hp = Math.max(0, p.hp - amount);
    target.invuln = 0.6;
    game.bus.emit(EV.PLAYER_DAMAGED, { amount, element, source: src, hp: p.hp, maxHp: p.maxHp });
    game.bus.emit(EV.CAMERA_SHAKE, { intensity: 3, duration: 0.2 });
    if (p.hp <= 0) target.die?.(game, src);
    return amount;
  }

  target.hp -= amount;
  game.bus.emit(EV.ENTITY_DAMAGED, { target, amount, element, source: src, crit: false, x: target.x, y: target.y });
  if (target.hp <= 0) target.die?.(game, src);
  return amount;
}

// ------------------------------------------------------------------ status effects

/** status = { type: 'burn'|'chill'|'shock', duration, power } */
export function applyStatus(game, target, status) {
  target.statuses ||= [];
  const existing = target.statuses.find((s) => s.type === status.type);
  if (existing) {
    existing.time = Math.max(existing.time, status.duration);
    existing.power = Math.max(existing.power, status.power);
    return;
  }
  const s = { type: status.type, time: status.duration, power: status.power, tick: 0 };
  target.statuses.push(s);
  game.bus.emit(EV.STATUS_APPLIED, { target, status: s });
}

/** Call from an entity's update. Returns {slow, stunned}. */
export function tickStatuses(game, e, dt) {
  let slow = 1, stunned = false;
  if (!e.statuses?.length) return { slow, stunned };
  for (let i = e.statuses.length - 1; i >= 0; i--) {
    const s = e.statuses[i];
    s.time -= dt;
    if (s.type === 'burn') {
      s.tick += dt;
      if (s.tick >= 0.5) { s.tick -= 0.5; damage(game, e, { amount: s.power, element: 'fire' }); }
    } else if (s.type === 'chill') slow = Math.min(slow, 1 - s.power);
    else if (s.type === 'shock') stunned = true;
    if (s.time <= 0) {
      e.statuses.splice(i, 1);
      game.bus.emit(EV.STATUS_EXPIRED, { target: e, status: s });
    }
  }
  return { slow, stunned };
}

// ------------------------------------------------------------------ crafting

const key = (els) => [...els].sort().join('+');

/** Recipe whose inputs match the element multiset, or null. */
export function findRecipe(elements) {
  const k = key(elements);
  return RECIPES.find((r) => key(r.inputs) === k) || null;
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
  game.state.spells.crafted.push(r.id);
  learnSpell(game, r.result, { crafted: true });
  game.bus.emit(EV.SPELL_CRAFTED, { spellId: r.result, recipeId: r.id });
  return { ok: true, spellId: r.result };
}

// ------------------------------------------------------------------ items

export function useItem(game, itemId) {
  const item = ITEMS[itemId];
  if (!item?.use) return false;
  if (!removeItem(game, itemId, 1)) return false;
  const p = game.state.player;
  if (item.use.heal) {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + item.use.heal);
    game.bus.emit(EV.PLAYER_HEALED, { amount: p.hp - before, hp: p.hp, maxHp: p.maxHp });
  }
  if (item.use.mana) p.mana = Math.min(p.maxMana, p.mana + item.use.mana);
  return true;
}

export function getSpell(id) {
  return SPELLS[id] || null;
}
