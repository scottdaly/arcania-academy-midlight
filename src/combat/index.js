// COMBAT public API (team: combat). Contract: ARCHITECTURE.md §4.3.
// Other teams may import ONLY from this file (never from combat internals), or use game.combat.
import { EV } from '../core/events.js';
import { addItem, equip, learnSpell, setLoadoutSlot } from '../core/state.js';
import { SPELLS, RECIPES, ITEMS, ENEMIES, STARTING_LOADOUT } from './data.js';
import { computeStats, damage, applyStatus, findRecipe, canCraft, craft, useItem } from './rules.js';
import { Player } from './player.js';
import { createEnemy } from './actors.js';
import { castSpell } from './spells.js';

export { SPELLS, RECIPES, ITEMS, ENEMIES };
export { computeStats, damage, applyStatus, findRecipe, canCraft, craft, useItem, castSpell };

/** Called once at boot. Subscribe to bus events here. */
export function initCombat(game) {
  const { bus } = game;
  bus.on(EV.GAME_NEW, () => {
    const s = game.state;
    for (const [id, n] of STARTING_LOADOUT.inventory) addItem(game, id, n);
    for (const [slot, id] of Object.entries(STARTING_LOADOUT.equipped)) equip(game, slot, id);
    for (const id of STARTING_LOADOUT.spells) learnSpell(game, id, { autoSlot: false });
    STARTING_LOADOUT.loadout.forEach((id, i) => setLoadoutSlot(game, i, id));
    computeStats(s);
    s.player.hp = s.player.maxHp;
    s.player.mana = s.player.maxMana;
  });
  const recompute = () => {
    computeStats(game.state);
    bus.emit(EV.STATS_CHANGED, { stats: game.state.player });
  };
  bus.on(EV.GAME_LOADED, recompute);
  bus.on(EV.EQUIPMENT_CHANGED, recompute);
}

/** Create (not add) the player entity. Core adds it to game.entities. */
export function createPlayer(game, x, y) {
  return new Player(game, x, y);
}

/** Create AND add an enemy. opts: {hpMult?, elite?}. Unknown ids fall back to armor_knight. */
export function spawnEnemy(game, enemyId, x, y, opts = {}) {
  const e = createEnemy(enemyId, x, y, opts);
  game.entities.add(e);
  game.bus.emit(EV.ENEMY_SPAWNED, { enemy: e, defId: e.defId });
  return e;
}

/** Create AND add the Corrupted Archmage. */
export function spawnBoss(game, x, y) {
  const b = createEnemy('corrupted_archmage', x, y);
  game.entities.add(b);
  game.bus.emit(EV.ENEMY_SPAWNED, { enemy: b, defId: b.defId });
  game.bus.emit(EV.BOSS_SPAWNED, { boss: b });
  return b;
}

/** Per-tick global combat logic (runs after entities update). */
export function update(game, dt) {}

// ---- read-only lookups for other teams --------------------------------------------
export const getSpell = (id) => SPELLS[id] || null;
export const getItem = (id) => ITEMS[id] || null;
export const getEnemyDef = (id) => ENEMIES[id] || null;
export const listSpells = () => Object.values(SPELLS).filter((s) => !s.hidden);
export const listRecipes = () => RECIPES.slice();
export const listItems = () => Object.values(ITEMS);
/** Seconds of cooldown left for the player's spell (for the spell bar). */
export const getCooldown = (game, spellId) => game.player?.cooldowns?.get(spellId) || 0;
