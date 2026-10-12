// Shared, JSON-serialisable game state (what gets saved). Lives at game.state.
// IMPORTANT: game.state is REPLACED on new game / load. Never cache it; always read game.state.
//
// Prefer the helper functions below for mutations: they validate and emit bus events that
// the UI/audio/fx react to. Direct writes are allowed for hot values owned by combat
// (player.hp, player.mana) - combat emits its own events for those.
import { EV } from './events.js';
import { ELEMENTS, TOWER_FLOORS } from './config.js';

export const SAVE_VERSION = 1;
export const LOADOUT_SLOTS = 4;
export const EQUIP_SLOTS = Object.freeze(['staff', 'robe']);

/** Fresh state. Starting gear/spells are seeded by combat on EV.GAME_NEW, story flags by world. */
export function createNewState() {
  const fragments = {};
  for (const e of ELEMENTS) fragments[e] = 0;
  return {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    savedAt: 0,
    player: {
      // Current values (combat mutates hp/mana directly).
      hp: 100,
      mana: 100,
      // Derived values, recomputed by combat.computeStats(state) from base + equipment.
      maxHp: 100,
      maxMana: 100,
      manaRegen: 5, // mana per second
      spellPower: 1, // damage multiplier
      moveSpeed: 80, // px per second
      // Unmodified base values (level-ups / permanent upgrades change these).
      base: { maxHp: 100, maxMana: 100, manaRegen: 5, spellPower: 1, moveSpeed: 80 },
    },
    /** Elemental fragments by element id. */
    fragments,
    /** [{id: itemId, qty}] - stackable by id. Equipped items stay in the inventory too. */
    inventory: [],
    /** slot -> itemId | null */
    equipped: { staff: null, robe: null },
    spells: {
      /** All spell ids the player can slot (base + crafted). */
      known: [],
      /** Recipe ids already crafted (subset bookkeeping for the crafting UI). */
      crafted: [],
    },
    /** Spell ids bound to keys 1-4 (null = empty). */
    loadout: [null, null, null, null],
    /** Story / progression flags (world owns the keys; see ARCHITECTURE.md §7.6). */
    flags: {},
    tower: { floors: TOWER_FLOORS, currentFloor: 1, highestFloor: 0 },
    dungeon: { runs: 0, deepest: 0, lastSeed: 0 },
    stats: { deaths: 0, kills: 0, spellsCast: 0, playTime: 0 },
  };
}

// ------------------------------------------------------------------ fragments

export function addFragments(game, element, amount = 1) {
  const f = game.state.fragments;
  if (!(element in f)) { console.warn('[state] unknown element', element); return; }
  f[element] = Math.max(0, f[element] + amount);
  game.bus.emit(EV.FRAGMENTS_CHANGED, { element, delta: amount, total: f[element] });
}

/** cost: {fire: 3, ice: 2} */
export function hasFragments(state, cost = {}) {
  return Object.entries(cost).every(([el, n]) => (state.fragments[el] ?? 0) >= n);
}

export function spendFragments(game, cost = {}) {
  if (!hasFragments(game.state, cost)) return false;
  for (const [el, n] of Object.entries(cost)) if (n) addFragments(game, el, -n);
  return true;
}

// ------------------------------------------------------------------ inventory

export function countItem(state, itemId) {
  return state.inventory.find((s) => s.id === itemId)?.qty ?? 0;
}

export function hasItem(state, itemId, qty = 1) {
  return countItem(state, itemId) >= qty;
}

export function addItem(game, itemId, qty = 1) {
  const inv = game.state.inventory;
  let slot = inv.find((s) => s.id === itemId);
  if (!slot) inv.push((slot = { id: itemId, qty: 0 }));
  slot.qty += qty;
  game.bus.emit(EV.INVENTORY_CHANGED, { itemId, delta: qty, qty: slot.qty });
}

export function removeItem(game, itemId, qty = 1) {
  const inv = game.state.inventory;
  const i = inv.findIndex((s) => s.id === itemId);
  if (i < 0 || inv[i].qty < qty) return false;
  inv[i].qty -= qty;
  const left = inv[i].qty;
  if (left <= 0) {
    inv.splice(i, 1);
    for (const slot of EQUIP_SLOTS) if (game.state.equipped[slot] === itemId) unequip(game, slot);
  }
  game.bus.emit(EV.INVENTORY_CHANGED, { itemId, delta: -qty, qty: left });
  return true;
}

/** Equip an owned item into a slot. combat recomputes stats on EV.EQUIPMENT_CHANGED. */
export function equip(game, slot, itemId) {
  if (!EQUIP_SLOTS.includes(slot)) return false;
  if (itemId && !hasItem(game.state, itemId)) return false;
  const prev = game.state.equipped[slot] ?? null;
  if (prev === itemId) return true;
  game.state.equipped[slot] = itemId;
  game.bus.emit(EV.EQUIPMENT_CHANGED, { slot, itemId, prev });
  return true;
}

export function unequip(game, slot) {
  return equip(game, slot, null);
}

// ------------------------------------------------------------------ spells

export function knowsSpell(state, spellId) {
  return state.spells.known.includes(spellId);
}

/** Returns true if newly learned. Auto-slots into the first empty loadout slot. */
export function learnSpell(game, spellId, { crafted = false, autoSlot = true } = {}) {
  const s = game.state;
  if (s.spells.known.includes(spellId)) return false;
  s.spells.known.push(spellId);
  game.bus.emit(EV.SPELL_LEARNED, { spellId, crafted });
  if (autoSlot) {
    const empty = s.loadout.indexOf(null);
    if (empty >= 0) setLoadoutSlot(game, empty, spellId);
  }
  return true;
}

/** slot: 0..3 (key 1 = slot 0). spellId must be known (or null to clear). */
export function setLoadoutSlot(game, slot, spellId) {
  const s = game.state;
  if (slot < 0 || slot >= LOADOUT_SLOTS) return false;
  if (spellId && !s.spells.known.includes(spellId)) return false;
  // A spell may only occupy one slot: swap if already slotted elsewhere.
  const existing = spellId ? s.loadout.indexOf(spellId) : -1;
  if (existing >= 0 && existing !== slot) s.loadout[existing] = s.loadout[slot];
  s.loadout[slot] = spellId;
  game.bus.emit(EV.LOADOUT_CHANGED, { slot, spellId, loadout: [...s.loadout] });
  return true;
}

// ------------------------------------------------------------------ flags

export function getFlag(state, key, fallback = undefined) {
  return key in state.flags ? state.flags[key] : fallback;
}

export function setFlag(game, key, value = true) {
  if (game.state.flags[key] === value) return;
  game.state.flags[key] = value;
  game.bus.emit(EV.FLAG_CHANGED, { key, value });
}

// ------------------------------------------------------------------ requirements

/**
 * Generic requirement check used by dialogue choices, doors, recipes, shops.
 * req = { flags?: {key: value}, notFlags?: [key], items?: {itemId: qty},
 *         fragments?: {element: n}, spells?: [spellId], towerFloor?: n }
 * All present clauses must pass. null/undefined req passes.
 */
export function checkRequirements(state, req) {
  if (!req) return true;
  if (req.flags) for (const [k, v] of Object.entries(req.flags)) if ((state.flags[k] ?? false) !== v) return false;
  if (req.notFlags) for (const k of req.notFlags) if (state.flags[k]) return false;
  if (req.items) for (const [id, n] of Object.entries(req.items)) if (countItem(state, id) < n) return false;
  if (req.fragments && !hasFragments(state, req.fragments)) return false;
  if (req.spells) for (const id of req.spells) if (!state.spells.known.includes(id)) return false;
  if (req.towerFloor != null && state.tower.highestFloor < req.towerFloor) return false;
  return true;
}

/** Clamp hp/mana into [0, max]. */
export function clampVitals(state) {
  const p = state.player;
  p.hp = Math.max(0, Math.min(p.hp, p.maxHp));
  p.mana = Math.max(0, Math.min(p.mana, p.maxMana));
}
