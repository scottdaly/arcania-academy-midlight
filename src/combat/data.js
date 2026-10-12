// Combat data tables (team: combat). Shapes are contracts - see ARCHITECTURE.md §7.
// Other teams READ these through the getters exported from combat/index.js.

/** @typedef {'fire'|'ice'|'lightning'|'arcane'|'earth'|'physical'} Element */

/** Spell definitions. kind: 'projectile' | 'aoe' (at target point) | 'nova' (around caster) | 'self'. */
export const SPELLS = {
  firebolt: {
    id: 'firebolt', name: 'Firebolt', elements: ['fire'], element: 'fire', tier: 1, kind: 'projectile',
    manaCost: 6, cooldown: 0.35, damage: 12, speed: 220, range: 220, radius: 3, count: 1, spread: 0, pierce: 0,
    status: { type: 'burn', duration: 2, power: 3 }, icon: 'spell_firebolt', sfx: 'cast_fire',
    description: 'A searing bolt that sets foes ablaze.',
  },
  frost_shard: {
    id: 'frost_shard', name: 'Frost Shards', elements: ['ice'], element: 'ice', tier: 1, kind: 'projectile',
    manaCost: 8, cooldown: 0.5, damage: 8, speed: 200, range: 180, radius: 2, count: 3, spread: 0.3, pierce: 0,
    status: { type: 'chill', duration: 1.5, power: 0.5 }, icon: 'spell_frost_shard', sfx: 'cast_ice',
    description: 'Three icy shards that slow their target.',
  },
  spark: {
    id: 'spark', name: 'Spark', elements: ['lightning'], element: 'lightning', tier: 1, kind: 'projectile',
    manaCost: 4, cooldown: 0.18, damage: 6, speed: 330, range: 200, radius: 2, count: 1, spread: 0.08, pierce: 1,
    status: { type: 'shock', duration: 0.25, power: 1 }, icon: 'spell_spark', sfx: 'cast_lightning',
    description: 'A fast crackling spark that pierces one enemy.',
  },
  // ---- crafted ----
  steam_burst: {
    id: 'steam_burst', name: 'Steam Burst', elements: ['fire', 'ice'], element: 'fire', tier: 2, kind: 'aoe',
    manaCost: 18, cooldown: 1.2, damage: 22, range: 120, aoeRadius: 32, delay: 0.35,
    status: { type: 'burn', duration: 2, power: 4 }, icon: 'spell_steam_burst', sfx: 'cast_fire',
    description: 'Scalding steam erupts at the target point.',
  },
  plasma_lance: {
    id: 'plasma_lance', name: 'Plasma Lance', elements: ['fire', 'lightning'], element: 'lightning', tier: 2, kind: 'projectile',
    manaCost: 16, cooldown: 0.9, damage: 20, speed: 420, range: 260, radius: 3, count: 1, spread: 0, pierce: 4,
    status: { type: 'burn', duration: 2, power: 4 }, icon: 'spell_plasma_lance', sfx: 'cast_lightning',
    description: 'A white-hot lance that pierces everything in a line.',
  },
  glacial_storm: {
    id: 'glacial_storm', name: 'Glacial Storm', elements: ['ice', 'lightning'], element: 'ice', tier: 2, kind: 'nova',
    manaCost: 22, cooldown: 2, damage: 16, aoeRadius: 52, delay: 0,
    status: { type: 'chill', duration: 2.5, power: 0.6 }, icon: 'spell_glacial_storm', sfx: 'cast_ice',
    description: 'A freezing shockwave bursts out around you.',
  },
  meteor: {
    id: 'meteor', name: 'Meteor', elements: ['fire', 'earth'], element: 'fire', tier: 2, kind: 'aoe',
    manaCost: 28, cooldown: 2.5, damage: 45, range: 140, aoeRadius: 40, delay: 0.8,
    status: { type: 'burn', duration: 3, power: 5 }, icon: 'spell_meteor', sfx: 'cast_fire',
    description: 'Call down a burning stone from the sky.',
  },
  prism_nova: {
    id: 'prism_nova', name: 'Prismatic Nova', elements: ['fire', 'ice', 'lightning'], element: 'arcane', tier: 3, kind: 'nova',
    manaCost: 40, cooldown: 4, damage: 40, aoeRadius: 72, delay: 0,
    status: null, icon: 'spell_prism_nova', sfx: 'cast_arcane',
    description: 'All three elements detonate at once.',
  },
  // ---- enemy-only (hidden: true => never shown in UI or craftable) ----
  boss_bolt: {
    id: 'boss_bolt', name: 'Corrupted Bolt', elements: ['arcane'], element: 'arcane', tier: 0, kind: 'projectile', hidden: true,
    manaCost: 0, cooldown: 0, damage: 10, speed: 110, range: 320, radius: 3, count: 1, spread: 0, pierce: 0,
    status: null, icon: 'spell_boss_bolt', sfx: 'cast_arcane', description: '',
  },
};

/** Crafting recipes. inputs: multiset of elements (order-insensitive). cost: fragments spent. */
export const RECIPES = [
  { id: 'r_steam_burst', inputs: ['fire', 'ice'], cost: { fire: 3, ice: 3 }, result: 'steam_burst', hint: 'Fire meets frost.' },
  { id: 'r_plasma_lance', inputs: ['fire', 'lightning'], cost: { fire: 3, lightning: 3 }, result: 'plasma_lance', hint: 'Flame given a spine of lightning.' },
  { id: 'r_glacial_storm', inputs: ['ice', 'lightning'], cost: { ice: 4, lightning: 4 }, result: 'glacial_storm', hint: 'A storm that freezes.' },
  { id: 'r_meteor', inputs: ['fire', 'earth'], cost: { fire: 5, earth: 3 }, result: 'meteor', hint: 'Burning stone.' },
  { id: 'r_prism_nova', inputs: ['fire', 'ice', 'lightning'], cost: { fire: 6, ice: 6, lightning: 6 }, result: 'prism_nova', hint: 'All three in harmony.', requires: { flags: { towerFloor3Cleared: true } } },
];

/**
 * Items. slot: 'staff' | 'robe' | 'consumable' | 'key' | 'material'.
 * stats (equipment, all optional, additive): maxHp, maxMana, manaRegen, spellPower (+0.1 = +10%),
 *   moveSpeed, cooldownMult (-0.1 = 10% faster), elementPower: {fire: 0.25}
 * use (consumable): { heal?, mana? }
 */
export const ITEMS = {
  staff_apprentice: { id: 'staff_apprentice', name: 'Apprentice Staff', slot: 'staff', rarity: 'common', icon: 'item_staff_apprentice', stats: { manaRegen: 0.5 }, description: 'Standard issue. Smells of chalk.' },
  staff_oak: { id: 'staff_oak', name: 'Oaken Staff', slot: 'staff', rarity: 'common', icon: 'item_staff_oak', stats: { manaRegen: 1.5, spellPower: 0.05 }, description: 'Sturdy and reliable.' },
  staff_ember: { id: 'staff_ember', name: 'Ember Staff', slot: 'staff', rarity: 'rare', icon: 'item_staff_ember', stats: { spellPower: 0.1, elementPower: { fire: 0.3 } }, description: 'Warm to the touch.' },
  staff_stormcaller: { id: 'staff_stormcaller', name: 'Stormcaller', slot: 'staff', rarity: 'epic', icon: 'item_staff_stormcaller', stats: { manaRegen: 3, elementPower: { lightning: 0.3 } }, description: 'Hums before a storm.' },
  robe_novice: { id: 'robe_novice', name: 'Novice Robe', slot: 'robe', rarity: 'common', icon: 'item_robe_novice', stats: { manaRegen: 0.5 }, description: 'Academy blue.' },
  robe_scholar: { id: 'robe_scholar', name: 'Scholar Robe', slot: 'robe', rarity: 'rare', icon: 'item_robe_scholar', stats: { manaRegen: 2, maxMana: 20 }, description: 'Ink-stained but enchanted.' },
  robe_archmage: { id: 'robe_archmage', name: 'Archmage Vestments', slot: 'robe', rarity: 'legendary', icon: 'item_robe_archmage', stats: { manaRegen: 4, maxMana: 50, maxHp: 25 }, description: 'Woven from starlight.' },
  potion_health: { id: 'potion_health', name: 'Health Potion', slot: 'consumable', rarity: 'common', icon: 'item_potion_health', use: { heal: 40 }, description: 'Restores 40 HP.' },
  potion_mana: { id: 'potion_mana', name: 'Mana Potion', slot: 'consumable', rarity: 'common', icon: 'item_potion_mana', use: { mana: 60 }, description: 'Restores 60 mana.' },
};

/**
 * Enemy definitions.
 * resist: damage multipliers per element (missing = 1; 0 = immune; >1 = weak).
 * drops: [{kind:'fragment'|'health'|'mana'|'item', element?, itemId?, chance, min, max}]
 * ai: 'chaser' | 'brute' | 'ranged' | 'boss' (combat-internal behaviour ids)
 */
export const ENEMIES = {
  armor_knight: {
    id: 'armor_knight', name: 'Enchanted Armor', sprite: 'enemy_knight', hp: 40, speed: 38, radius: 6, mass: 2,
    damage: 10, attack: { type: 'melee', range: 10, cooldown: 1.1, windup: 0.3 }, aggroRange: 140, ai: 'chaser',
    resist: { lightning: 1.5, fire: 0.8 }, element: 'physical',
    drops: [{ kind: 'fragment', element: 'lightning', chance: 0.5, min: 1, max: 2 }, { kind: 'health', chance: 0.1, min: 15, max: 15 }],
  },
  armor_captain: {
    id: 'armor_captain', name: 'Armor Captain', sprite: 'enemy_knight_captain', hp: 110, speed: 44, radius: 7, mass: 3,
    damage: 16, attack: { type: 'melee', range: 12, cooldown: 1.0, windup: 0.35 }, aggroRange: 160, ai: 'chaser',
    resist: { lightning: 1.4, fire: 0.7, ice: 0.9 }, element: 'physical',
    drops: [{ kind: 'fragment', element: 'lightning', chance: 1, min: 2, max: 3 }, { kind: 'item', itemId: 'potion_mana', chance: 0.3, min: 1, max: 1 }],
  },
  golem_stone: {
    id: 'golem_stone', name: 'Rogue Stone Golem', sprite: 'enemy_golem_stone', hp: 90, speed: 24, radius: 8, mass: 6,
    damage: 18, attack: { type: 'melee', range: 12, cooldown: 1.6, windup: 0.5 }, aggroRange: 120, ai: 'brute',
    resist: { earth: 0.4, lightning: 0.6, ice: 1.3 }, element: 'earth',
    drops: [{ kind: 'fragment', element: 'earth', chance: 0.8, min: 1, max: 3 }],
  },
  golem_ember: {
    id: 'golem_ember', name: 'Ember Golem', sprite: 'enemy_golem_ember', hp: 75, speed: 28, radius: 8, mass: 5,
    damage: 16, attack: { type: 'melee', range: 12, cooldown: 1.4, windup: 0.45 }, aggroRange: 130, ai: 'brute',
    resist: { fire: 0, ice: 1.6 }, element: 'fire',
    drops: [{ kind: 'fragment', element: 'fire', chance: 0.9, min: 1, max: 3 }],
  },
  golem_frost: {
    id: 'golem_frost', name: 'Frost Golem', sprite: 'enemy_golem_frost', hp: 75, speed: 28, radius: 8, mass: 5,
    damage: 16, attack: { type: 'melee', range: 12, cooldown: 1.4, windup: 0.45 }, aggroRange: 130, ai: 'brute',
    resist: { ice: 0, fire: 1.6 }, element: 'ice',
    drops: [{ kind: 'fragment', element: 'ice', chance: 0.9, min: 1, max: 3 }],
  },
  corrupted_archmage: {
    id: 'corrupted_archmage', name: 'The Corrupted Archmage', sprite: 'boss_archmage', hp: 900, speed: 30, radius: 9, mass: Infinity,
    damage: 20, attack: { type: 'melee', range: 12, cooldown: 1.2, windup: 0.3 }, aggroRange: 400, ai: 'boss',
    resist: { arcane: 0.5 }, element: 'arcane', boss: true,
    drops: [],
  },
};

/** Applied by combat on EV.GAME_NEW. */
export const STARTING_LOADOUT = {
  inventory: [['staff_apprentice', 1], ['robe_novice', 1], ['potion_health', 2]],
  equipped: { staff: 'staff_apprentice', robe: 'robe_novice' },
  spells: ['firebolt', 'frost_shard', 'spark'],
  loadout: ['firebolt', 'frost_shard', 'spark', null],
};
