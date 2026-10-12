// Loot tables (team: world). Combat OWNS item definitions and stats (ITEMS in src/combat);
// world owns WHERE and HOW OFTEN gear appears (chests, secret rooms, tower rewards, shop).
// Ids combat does not define are skipped, so loot always resolves to real items.
import { countItem } from '../core/state.js';

/** Equipment by tier: 1 common/early, 2 rare, 3 epic, 4 legendary. */
export const GEAR_TIERS = {
  1: ['staff_oak', 'robe_scholar'],
  2: ['staff_ember', 'staff_frostbite', 'staff_geode', 'robe_emberweave', 'robe_frostweave', 'robe_stormweave'],
  3: ['staff_stormcaller', 'staff_prism', 'robe_battlemage'],
  4: ['staff_archmage', 'robe_archmage'],
};

export const RARITY_COLORS = { common: '#d8d8e0', rare: '#5ab8ff', epic: '#c87aff', legendary: '#ffb03a' };

const itemExists = (game, id) => !!game.combat?.getItem?.(id);
const owned = (game, id) => countItem(game.state, id) > 0;

/** Pick an equipment id of about `tier` the player does not own yet (or null). */
export function pickGear(game, rng, tier) {
  const order = [tier, tier + 1, tier - 1, tier + 2, tier - 2].filter((t) => GEAR_TIERS[t]);
  for (const t of order) {
    const options = GEAR_TIERS[t].filter((id) => itemExists(game, id) && !owned(game, id));
    if (options.length) return rng.pick(options);
  }
  return null;
}

/**
 * Roll a chest. Returns drops: [{kind:'fragment', element, amount} | {kind:'item', itemId, amount}
 *   | {kind:'health'|'mana', amount}]. `fragTable` = {element: weight} (biome-flavoured).
 */
export function rollChest(game, rng, tier, fragTable = { fire: 1, ice: 1, lightning: 1 }) {
  tier = Math.max(1, Math.min(4, tier | 0));
  const drops = [];
  const pickEl = () => rng.weighted(Object.entries(fragTable).map(([k, weight]) => ({ k, weight }))).k;
  // Fragments: the crafting currency. Always generous.
  const piles = 2 + (tier >= 3 ? 1 : 0);
  for (let i = 0; i < piles; i++) drops.push({ kind: 'fragment', element: pickEl(), amount: rng.int(2, 3) + tier });
  // Gear.
  const gearChance = [0, 0.4, 0.6, 0.75, 1][tier];
  if (rng.chance(gearChance)) {
    let t = tier;
    const r = rng.next();
    if (r < 0.15) t = tier + 1; else if (r < 0.35) t = tier - 1;
    const id = pickGear(game, rng, Math.max(1, Math.min(4, t)));
    if (id) drops.push({ kind: 'item', itemId: id, amount: 1 });
    else drops.push({ kind: 'fragment', element: 'arcane', amount: 2 + tier * 2 }); // "salvage"
  }
  // Consumables.
  if (rng.chance(0.55)) {
    const pot = tier >= 3 && rng.chance(0.35) ? 'elixir' : rng.chance(0.5) ? 'potion_health' : 'potion_mana';
    if (itemExists(game, pot)) drops.push({ kind: 'item', itemId: pot, amount: 1 });
    else drops.push({ kind: rng.chance(0.5) ? 'health' : 'mana', amount: 30 });
  }
  return drops;
}

/** Display name for an item id (falls back to the id). */
export function itemName(game, id) {
  return game.combat?.getItem?.(id)?.name || id;
}

export function itemColor(game, id) {
  return RARITY_COLORS[game.combat?.getItem?.(id)?.rarity] || RARITY_COLORS.common;
}
