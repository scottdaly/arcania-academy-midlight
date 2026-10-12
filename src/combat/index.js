// COMBAT public API (team: combat). Contract: ARCHITECTURE.md §4.3.
// Other teams may import ONLY from this file (never from combat internals), or use game.combat.
import { EV } from '../core/events.js';
import { addItem, addFragments, equip, learnSpell, setLoadoutSlot } from '../core/state.js';
import { SPELLS, RECIPES, ITEMS, ENEMIES, STARTING_LOADOUT, GEAR_DROPS } from './data.js';
import { FORMS, ESSENCES, REACTIONS, STATUS_INFO } from './spellbook.js';
import { computeStats, damage, applyStatus, findRecipe, canCraft, craft, useItem, spellPowerFor } from './rules.js';
import { Player } from './player.js';
import { createEnemyEntity } from './enemies.js';
import { Archmage, WARD_COUNTER } from './boss.js';
import { castSpell } from './spells.js';
import { difficulty } from './util.js';

export { SPELLS, RECIPES, ITEMS, ENEMIES };
export { computeStats, damage, applyStatus, findRecipe, canCraft, craft, useItem, castSpell };
/** Crafting extras for the UI: delivery forms, essences (element combos), reactions, statuses. */
export { FORMS, ESSENCES, REACTIONS, STATUS_INFO, WARD_COUNTER, GEAR_DROPS };

/** Called once at boot. Subscribe to bus events here. */
export function initCombat(game) {
  const { bus } = game;
  bus.on(EV.GAME_NEW, () => {
    const s = game.state;
    for (const [id, n] of STARTING_LOADOUT.inventory) addItem(game, id, n);
    for (const [slot, id] of Object.entries(STARTING_LOADOUT.equipped)) equip(game, slot, id);
    for (const id of STARTING_LOADOUT.spells) learnSpell(game, id, { autoSlot: false });
    STARTING_LOADOUT.loadout.forEach((id, i) => setLoadoutSlot(game, i, id));
    for (const [el, n] of Object.entries(STARTING_LOADOUT.fragments || {})) if (n) addFragments(game, el, n);
    computeStats(s);
    s.player.hp = s.player.maxHp;
    s.player.mana = s.player.maxMana;
  });
  const recompute = () => {
    if (!game.state) return;
    computeStats(game.state);
    bus.emit(EV.STATS_CHANGED, { stats: game.state.player });
  };
  bus.on(EV.GAME_LOADED, () => {
    // Drop unknown spell ids from old saves so the spell bar never shows ghosts.
    const s = game.state;
    s.spells.known = s.spells.known.filter((id) => SPELLS[id]);
    s.loadout = s.loadout.map((id) => (id && SPELLS[id] ? id : null));
    recompute();
  });
  bus.on(EV.EQUIPMENT_CHANGED, recompute);
  bus.on(EV.PLAYER_RESPAWNED, () => { if (game.state) game.state.player.mana = game.state.player.maxMana; });
}

/** Create (not add) the player entity. Core adds it to game.entities. */
export function createPlayer(game, x, y) {
  return new Player(game, x, y);
}

/**
 * Create AND add an enemy. Unknown ids fall back to armor_knight.
 * opts: {hpMult?, dmgMult?, elite?, affix? ('swift'|'warded'|'volatile'|'frenzied'), noDrops?, aggro?,
 *        autoElite? (roll elite by depth), variety? (let a base id become a family member)}
 *
 * Difficulty comes from the scene being entered (dungeon depth / tower floor): HP +20% and
 * damage +8% per level (elites: x2.2 HP, x1.25 dmg, an affix, bonus loot). Passing `hpMult`
 * overrides the HP scaling.
 *
 * {variety: true}: ids with `variants` (armor_knight, armor_captain, golem_stone, golem_ember,
 * golem_frost) may become a family member (lancer, sentinel, crystal golem, wisp pack...).
 */
export function spawnEnemy(game, enemyId, x, y, opts = {}) {
  let def = ENEMIES[enemyId];
  if (!def) {
    console.warn(`[combat] unknown enemy "${enemyId}", using armor_knight`);
    def = ENEMIES.armor_knight;
  }
  if (def.boss) return spawnBoss(game, x, y);
  const ctx = difficulty(game);
  const rng = game.rng;
  let group = 1;
  if (opts.variety && !opts.exact && def.variants) {
    const pool = def.variants.filter((v) => (v.minLevel || 0) <= ctx.level && ENEMIES[v.id]);
    const pick = rng.weighted(pool);
    if (pick) { def = ENEMIES[pick.id]; group = pick.group || 1; }
  }
  const elite = opts.elite ?? (!!opts.autoElite && ctx.kind !== 'hub' && ctx.kind !== 'boss' && rng.chance(Math.min(0.3, 0.03 + 0.05 * (ctx.level - 1))));
  const o = { ...opts, elite, difficulty: ctx };
  const e = createEnemyEntity(game, def, x, y, o);
  game.entities.add(e);
  game.bus.emit(EV.ENEMY_SPAWNED, { enemy: e, defId: e.defId });
  // packs (wisps) spawn their friends around the first one
  for (let i = 1; i < group; i++) {
    const a = rng.float(0, Math.PI * 2);
    const px = x + Math.cos(a) * 12, py = y + Math.sin(a) * 12;
    if (game.level?.map?.isSolidAt?.(px, py)) continue;
    const f = createEnemyEntity(game, def, px, py, { ...o, elite: false });
    game.entities.add(f);
    game.bus.emit(EV.ENEMY_SPAWNED, { enemy: f, defId: f.defId });
  }
  return e;
}

/** Create AND add the Corrupted Archmage. */
export function spawnBoss(game, x, y) {
  const b = new Archmage(game, ENEMIES.corrupted_archmage, x, y);
  game.entities.add(b);
  game.bus.emit(EV.ENEMY_SPAWNED, { enemy: b, defId: b.defId });
  game.bus.emit(EV.BOSS_SPAWNED, { boss: b });
  return b;
}

/** Per-tick global combat logic (runs after entities update). */
export function update(game, dt) {
  // Safety net: the player must die exactly once even if HP was zeroed by someone else.
  const p = game.player;
  if (p && !p.dying && game.state.player.hp <= 0 && typeof p.die === 'function') p.die(game, null);
}

// ---- read-only lookups for other teams --------------------------------------------
export const getSpell = (id) => SPELLS[id] || null;
export const getItem = (id) => ITEMS[id] || null;
export const getEnemyDef = (id) => ENEMIES[id] || null;
export const listSpells = () => Object.values(SPELLS).filter((s) => !s.hidden);
export const listRecipes = () => RECIPES.slice();
export const listItems = () => Object.values(ITEMS);
/** Seconds of cooldown left for the player's spell (for the spell bar). */
export const getCooldown = (game, spellId) => game.player?.cooldowns?.get(spellId) || 0;

// ---- extras (optional for other teams) ---------------------------------------------
/** Recipes grouped for a grid UI: [{essence, recipes: [one per form, FORMS order]}]. */
export function recipeGrid() {
  const forms = Object.keys(FORMS);
  return Object.values(ESSENCES).map((ess) => ({
    essence: ess,
    recipes: forms.map((f) => RECIPES.find((r) => r.essence === ess.id && r.form === f) || null),
  }));
}
/** Player's effective damage multiplier for a spell (spellPower x element affinity). */
export const getSpellPower = (game, spellId) => (SPELLS[spellId] ? spellPowerFor(game.state, SPELLS[spellId]) : 1);
/** Player dash cooldown 0..1 remaining (for a HUD/touch button). */
export const getDashCooldown = (game) => Math.min(1, (game.player?.dashCd || 0) / 0.85);
/** Ask the player to dash (touch button / gamepad until core adds a 'dash' action). */
export function requestDash(game) {
  const p = game.player;
  if (p && !p.dying && p.dashCd <= 0 && p.dashT <= 0) { p.startDash(game); return true; }
  return false;
}
