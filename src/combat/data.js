// Combat data tables (team: combat). Shapes are contracts - see ARCHITECTURE.md §7.
// Other teams READ these through the getters exported from combat/index.js.
import { buildSpellbook } from './spellbook.js';

/** @typedef {'fire'|'ice'|'lightning'|'arcane'|'earth'|'physical'} Element */

const book = buildSpellbook();

/** Enemy-only spells (hidden: true => never shown in UI or craftable). Fired as simple projectiles. */
const ENEMY_SPELLS = {
  boss_bolt: { name: 'Corrupted Bolt', element: 'arcane', damage: 10, speed: 82, range: 420, radius: 3 },
  boss_bolt_fire: { name: 'Corrupted Flame', element: 'fire', damage: 10, speed: 82, range: 420, radius: 3, status: { type: 'burn', duration: 2, power: 1 } },
  boss_bolt_ice: { name: 'Corrupted Frost', element: 'ice', damage: 9, speed: 76, range: 420, radius: 3, status: { type: 'chill', duration: 2, power: 30 } },
  boss_bolt_lightning: { name: 'Corrupted Spark', element: 'lightning', damage: 9, speed: 105, range: 420, radius: 3, status: { type: 'shock', duration: 1, power: 1 } },
  boss_seeker: { name: 'Hungering Mote', element: 'arcane', damage: 8, speed: 70, range: 380, radius: 3, homing: 1.6 },
  crystal_shard: { name: 'Crystal Shard', element: 'ice', damage: 9, speed: 165, range: 230, radius: 2, status: { type: 'chill', duration: 2, power: 20 } },
  frost_mote: { name: 'Frost Mote', element: 'ice', damage: 6, speed: 95, range: 200, radius: 2, status: { type: 'chill', duration: 2, power: 25 } },
};
for (const [id, s] of Object.entries(ENEMY_SPELLS)) {
  Object.assign(s, {
    id, hidden: true, elements: [s.element], tier: 0, kind: 'projectile', manaCost: 0, cooldown: 0,
    count: 1, spread: 0, pierce: 0, status: s.status || null, statuses: s.status ? [s.status] : [],
    icon: `spell_${id}`, sfx: `cast_${s.element === 'physical' ? 'arcane' : s.element}`, description: '', knockback: 40,
  });
}

/**
 * Spell definitions (ARCHITECTURE 7.2) + crafting extras:
 *   form ('bolt'|'volley'|'orb'|'arc'|'nova'|'rune'|'seekers'), essence, colors [main, highlight],
 *   statuses [] (all statuses applied per hit; `status` = the first), impact, burstDamage (orbs) ...
 */
export const SPELLS = { ...book.spells, ...ENEMY_SPELLS };

/**
 * Crafting recipes (ARCHITECTURE 7.3) + extras for the crafting UI:
 *   form, essence, tier, name. Several recipes share the same `inputs` (one per form), so use
 *   findRecipe(elements, form) to pick one.
 */
export const RECIPES = book.recipes;

/**
 * Items. slot: 'staff' | 'robe' | 'consumable' | 'key' | 'material'.
 * stats (equipment, all optional, additive): maxHp, maxMana, manaRegen, spellPower (+0.1 = +10%),
 *   moveSpeed, cooldownMult (-0.1 = 10% faster), elementPower: {fire: 0.25} (+25% fire damage)
 * use (consumable): { heal?, mana? }
 */
export const ITEMS = {
  // ---- staves ----
  staff_apprentice: { id: 'staff_apprentice', name: 'Apprentice Staff', slot: 'staff', rarity: 'common', stats: { manaRegen: 0.5 }, description: 'Standard issue. Smells of chalk.' },
  staff_oak: { id: 'staff_oak', name: 'Oaken Staff', slot: 'staff', rarity: 'common', stats: { manaRegen: 1.5, spellPower: 0.05 }, description: 'Sturdy and reliable.' },
  staff_ember: { id: 'staff_ember', name: 'Ember Staff', slot: 'staff', rarity: 'rare', stats: { manaRegen: 1, spellPower: 0.1, elementPower: { fire: 0.3 } }, description: 'Warm to the touch. +30% fire.' },
  staff_frostbite: { id: 'staff_frostbite', name: 'Frostbite Rod', slot: 'staff', rarity: 'rare', stats: { manaRegen: 1, cooldownMult: -0.08, elementPower: { ice: 0.3 } }, description: 'Rimed in eternal frost. +30% ice.' },
  staff_geode: { id: 'staff_geode', name: 'Geode Maul', slot: 'staff', rarity: 'rare', stats: { manaRegen: 1, maxHp: 20, spellPower: 0.05, elementPower: { earth: 0.35 } }, description: 'Half staff, half boulder. +35% earth.' },
  staff_stormcaller: { id: 'staff_stormcaller', name: 'Stormcaller', slot: 'staff', rarity: 'epic', stats: { manaRegen: 3, elementPower: { lightning: 0.3 } }, description: 'Hums before a storm. +30% lightning.' },
  staff_prism: { id: 'staff_prism', name: 'Prism Staff', slot: 'staff', rarity: 'epic', stats: { manaRegen: 2, spellPower: 0.15, cooldownMult: -0.1, elementPower: { fire: 0.1, ice: 0.1, lightning: 0.1 } }, description: 'Splits light, and spells, three ways.' },
  staff_archmage: { id: 'staff_archmage', name: 'Staff of the First Archmage', slot: 'staff', rarity: 'legendary', stats: { spellPower: 0.3, manaRegen: 3, cooldownMult: -0.15 }, description: 'It remembers every spell ever cast with it.' },
  // ---- robes ----
  robe_novice: { id: 'robe_novice', name: 'Novice Robe', slot: 'robe', rarity: 'common', stats: { manaRegen: 0.5 }, description: 'Academy blue.' },
  robe_scholar: { id: 'robe_scholar', name: 'Scholar Robe', slot: 'robe', rarity: 'rare', stats: { manaRegen: 2, maxMana: 20 }, description: 'Ink-stained but enchanted.' },
  robe_emberweave: { id: 'robe_emberweave', name: 'Emberweave Robe', slot: 'robe', rarity: 'rare', stats: { manaRegen: 1, maxHp: 15, elementPower: { fire: 0.15 } }, description: 'Never quite stops smouldering.' },
  robe_frostweave: { id: 'robe_frostweave', name: 'Frostweave Robe', slot: 'robe', rarity: 'rare', stats: { maxMana: 15, manaRegen: 1, elementPower: { ice: 0.15 } }, description: 'Cool, calm, collected.' },
  robe_stormweave: { id: 'robe_stormweave', name: 'Stormweave Cloak', slot: 'robe', rarity: 'rare', stats: { manaRegen: 1, moveSpeed: 10, cooldownMult: -0.05, elementPower: { lightning: 0.15 } }, description: 'Crackles when you run.' },
  robe_battlemage: { id: 'robe_battlemage', name: 'Battlemage Coat', slot: 'robe', rarity: 'epic', stats: { manaRegen: 1.5, maxHp: 40, spellPower: 0.08 }, description: 'Chainmail sewn into silk.' },
  robe_archmage: { id: 'robe_archmage', name: 'Archmage Vestments', slot: 'robe', rarity: 'legendary', stats: { manaRegen: 4, maxMana: 50, maxHp: 25 }, description: 'Woven from starlight.' },
  // ---- consumables ----
  potion_health: { id: 'potion_health', name: 'Health Potion', slot: 'consumable', rarity: 'common', use: { heal: 40 }, description: 'Restores 40 HP. (Q to quaff)' },
  potion_mana: { id: 'potion_mana', name: 'Mana Potion', slot: 'consumable', rarity: 'common', use: { mana: 60 }, description: 'Restores 60 mana.' },
  elixir: { id: 'elixir', name: 'Archmage Elixir', slot: 'consumable', rarity: 'rare', use: { heal: 100, mana: 100 }, description: 'Fully restores body and mind.' },
};
for (const it of Object.values(ITEMS)) it.icon = `item_${it.id}`;

/** Gear that enemies can drop, by minimum difficulty level (dungeon depth / tower floor + 1). */
export const GEAR_DROPS = [
  { itemId: 'staff_oak', minLevel: 1, weight: 4 },
  { itemId: 'robe_scholar', minLevel: 1, weight: 3 },
  { itemId: 'staff_ember', minLevel: 2, weight: 2 },
  { itemId: 'staff_frostbite', minLevel: 2, weight: 2 },
  { itemId: 'staff_geode', minLevel: 2, weight: 2 },
  { itemId: 'robe_emberweave', minLevel: 2, weight: 2 },
  { itemId: 'robe_frostweave', minLevel: 2, weight: 2 },
  { itemId: 'robe_stormweave', minLevel: 2, weight: 2 },
  { itemId: 'staff_stormcaller', minLevel: 3, weight: 1.5 },
  { itemId: 'staff_prism', minLevel: 4, weight: 1 },
  { itemId: 'robe_battlemage', minLevel: 3, weight: 1.5 },
  { itemId: 'elixir', minLevel: 2, weight: 2 },
];

const frag = (element, chance, min = 1, max = min) => ({ kind: 'fragment', element, chance, min, max });
const hp = (chance, amount = 15) => ({ kind: 'health', chance, min: amount, max: amount });
const mana = (chance, amount = 25) => ({ kind: 'mana', chance, min: amount, max: amount });

/**
 * Enemy definitions (ARCHITECTURE 7.4) + combat extras:
 *   fallbackSprite  used when art has not drawn `sprite` yet
 *   armored         lightning deals +50% (stacks with resist)
 *   shield          'front' (blocks frontal hits unless attacking) | 'guard' (halves all hits while guarding)
 *   poise           a single hit this big interrupts a wind-up (stagger)
 *   freezeResist    multiplier on chill build-up (0 = cannot freeze)
 *   superArmor      ignores knockback while winding up / attacking
 *   variants        spawnEnemy(legacyId) may substitute a family member (see index.js)
 */
export const ENEMIES = {
  // ---------------- enchanted armour ----------------
  armor_knight: {
    id: 'armor_knight', name: 'Enchanted Armor', sprite: 'enemy_knight', hp: 55, speed: 40, radius: 6, mass: 2,
    damage: 11, attack: { type: 'melee', range: 16, cooldown: 1.2, windup: 0.5 }, aggroRange: 140, ai: 'knight',
    resist: { fire: 0.85, arcane: 1.15 }, element: 'physical', armored: true, shield: 'front', poise: 14, turnRate: 3.2,
    drops: [frag('lightning', 0.4, 1, 2), frag('arcane', 0.3), hp(0.12)],
    variants: [{ id: 'armor_knight', weight: 60 }, { id: 'armor_lancer', weight: 25, minLevel: 1 }, { id: 'armor_sentinel', weight: 15, minLevel: 2 }, { id: 'wisp_storm', weight: 10, minLevel: 1, group: 3 }],
  },
  armor_captain: {
    id: 'armor_captain', name: 'Armor Captain', sprite: 'enemy_knight_captain', hp: 150, speed: 46, radius: 7, mass: 3,
    damage: 13, attack: { type: 'melee', range: 18, cooldown: 1.3, windup: 0.42, combo: 3 }, aggroRange: 160, ai: 'knight',
    resist: { fire: 0.75, ice: 0.9 }, element: 'physical', armored: true, shield: 'front', poise: 30, turnRate: 3.8,
    drops: [frag('lightning', 1, 2, 3), frag('arcane', 0.6, 1, 2), { kind: 'item', itemId: 'potion_mana', chance: 0.3, min: 1, max: 1 }, { kind: 'gear', chance: 0.15 }],
    variants: [{ id: 'armor_captain', weight: 70 }, { id: 'armor_sentinel', weight: 30 }],
  },
  armor_lancer: {
    id: 'armor_lancer', name: 'Spear Lancer', sprite: 'enemy_lancer', fallbackSprite: 'enemy_knight', hp: 45, speed: 48, radius: 6, mass: 2,
    damage: 16, attack: { type: 'melee', range: 130, cooldown: 2.4, windup: 0.75 }, aggroRange: 170, ai: 'lancer',
    resist: { fire: 0.85 }, element: 'physical', armored: true, poise: 12, turnRate: 4,
    drops: [frag('lightning', 0.5, 1, 2), hp(0.12)],
  },
  armor_sentinel: {
    id: 'armor_sentinel', name: 'Halberd Sentinel', sprite: 'enemy_sentinel', fallbackSprite: 'enemy_knight_captain', hp: 120, speed: 26, radius: 7, mass: 6,
    damage: 15, attack: { type: 'melee', range: 42, cooldown: 2.4, windup: 0.85 }, aggroRange: 130, ai: 'sentinel',
    resist: { fire: 0.8 }, element: 'physical', armored: true, shield: 'guard', poise: 40, superArmor: true, leash: 90,
    drops: [frag('arcane', 0.8, 1, 2), frag('lightning', 0.4, 1), { kind: 'gear', chance: 0.08 }],
  },
  // ---------------- rogue golems ----------------
  golem_stone: {
    id: 'golem_stone', name: 'Rogue Stone Golem', sprite: 'enemy_golem_stone', hp: 120, speed: 24, radius: 8, mass: 6,
    damage: 18, attack: { type: 'melee', range: 24, cooldown: 2.2, windup: 0.9 }, aggroRange: 120, ai: 'golem',
    resist: { earth: 0.4, lightning: 0.6, ice: 1.3, arcane: 1.2 }, element: 'earth', poise: 50, superArmor: true, freezeResist: 0.7,
    drops: [frag('earth', 0.85, 1, 3), hp(0.15)],
    variants: [{ id: 'golem_stone', weight: 60 }, { id: 'golem_crystal', weight: 40, minLevel: 2 }],
  },
  golem_crystal: {
    id: 'golem_crystal', name: 'Crystal Golem', sprite: 'enemy_golem_crystal', fallbackSprite: 'enemy_golem_frost', hp: 85, speed: 26, radius: 8, mass: 5,
    damage: 9, attack: { type: 'ranged', range: 140, cooldown: 2.2, windup: 0.6, spellId: 'crystal_shard' }, aggroRange: 160, ai: 'crystal',
    resist: { ice: 0.5, lightning: 0.7, earth: 1.8, fire: 1.2 }, element: 'ice', poise: 30, freezeResist: 0.5,
    drops: [frag('ice', 0.6, 1, 2), frag('arcane', 0.5, 1, 2), mana(0.15)],
  },
  golem_ember: {
    id: 'golem_ember', name: 'Magma Golem', sprite: 'enemy_golem_ember', hp: 105, speed: 28, radius: 8, mass: 5,
    damage: 16, attack: { type: 'melee', range: 24, cooldown: 2.0, windup: 0.85 }, aggroRange: 130, ai: 'golem', trail: 'fire',
    resist: { fire: 0, earth: 0.6, ice: 1.6 }, element: 'fire', poise: 45, superArmor: true,
    drops: [frag('fire', 0.9, 1, 3), frag('earth', 0.4, 1)],
    variants: [{ id: 'golem_ember', weight: 75 }, { id: 'wisp_ember', weight: 25, group: 2 }],
  },
  golem_frost: {
    id: 'golem_frost', name: 'Frost Golem', sprite: 'enemy_golem_frost', hp: 105, speed: 28, radius: 8, mass: 5,
    damage: 16, attack: { type: 'melee', range: 24, cooldown: 2.0, windup: 0.85 }, aggroRange: 130, ai: 'golem', trail: 'frost',
    resist: { ice: 0, fire: 1.6, lightning: 0.9 }, element: 'ice', poise: 45, superArmor: true, freezeResist: 0,
    drops: [frag('ice', 0.9, 1, 3)],
    variants: [{ id: 'golem_frost', weight: 75 }, { id: 'wisp_frost', weight: 25, group: 2 }],
  },
  // ---------------- wisps (fodder) ----------------
  wisp_ember: {
    id: 'wisp_ember', name: 'Ember Wisp', sprite: 'enemy_wisp_ember', hp: 18, speed: 72, radius: 4, mass: 0.6,
    damage: 7, attack: { type: 'melee', range: 90, cooldown: 2.0, windup: 0.45 }, aggroRange: 150, ai: 'wisp',
    resist: { fire: 0, ice: 1.5 }, element: 'fire', poise: 1, flying: true,
    drops: [frag('fire', 0.6, 1)],
  },
  wisp_frost: {
    id: 'wisp_frost', name: 'Frost Wisp', sprite: 'enemy_wisp_frost', hp: 18, speed: 66, radius: 4, mass: 0.6,
    damage: 6, attack: { type: 'ranged', range: 120, cooldown: 2.0, windup: 0.45, spellId: 'frost_mote' }, aggroRange: 150, ai: 'wisp',
    resist: { ice: 0, fire: 1.5 }, element: 'ice', poise: 1, flying: true, freezeResist: 0,
    drops: [frag('ice', 0.6, 1)],
  },
  wisp_storm: {
    id: 'wisp_storm', name: 'Storm Wisp', sprite: 'enemy_wisp_storm', hp: 16, speed: 80, radius: 4, mass: 0.6,
    damage: 7, attack: { type: 'ranged', range: 110, cooldown: 2.2, windup: 0.5 }, aggroRange: 150, ai: 'wisp',
    resist: { lightning: 0, earth: 1.5 }, element: 'lightning', poise: 1, flying: true,
    drops: [frag('lightning', 0.6, 1)],
  },
  // ---------------- boss ----------------
  corrupted_archmage: {
    id: 'corrupted_archmage', name: 'The Corrupted Archmage', sprite: 'boss_archmage', hp: 1350, speed: 34, radius: 9, mass: Infinity,
    damage: 12, attack: { type: 'ranged', range: 300, cooldown: 1.2, windup: 0.6, spellId: 'boss_bolt' }, aggroRange: 400, ai: 'boss',
    resist: { arcane: 0.5 }, element: 'arcane', boss: true, poise: Infinity, freezeResist: 0,
    drops: [],
  },
};

/** Applied by combat on EV.GAME_NEW. */
export const STARTING_LOADOUT = {
  inventory: [['staff_apprentice', 1], ['robe_novice', 1], ['potion_health', 3], ['potion_mana', 1]],
  equipped: { staff: 'staff_apprentice', robe: 'robe_novice' },
  spells: ['firebolt', 'frost_shard', 'spark'],
  loadout: ['firebolt', 'frost_shard', 'spark', null],
  fragments: { fire: 4, ice: 4, lightning: 4 }, // enough for one starter craft at the Forge
};
