// Spell-crafting tables (team: combat).
//
// A crafted spell = ESSENCE (what it is made of: 1-3 elements) x FORM (how it is delivered).
// Every (essence, form) pair is a distinct spell with its own id `${essence}_${form}` (a few
// starter spells keep legacy ids). Essences carry real behaviour - clouds, explosions, chains,
// lava pools, meteors, gravity wells, splitting shards - that the form triggers at its impact
// points, so combinations play differently, not just in a different colour.
//
// Generated into SPELLS / RECIPES (contract shapes in ARCHITECTURE.md 7.2 / 7.3) by data.js.

/** Delivery shapes. kind = contract kind; stat multipliers apply on top of the essence. */
export const FORMS = {
  bolt: {
    id: 'bolt', name: 'Bolt', kind: 'projectile', order: 0,
    blurb: 'A fast single missile.',
    dmg: 1.0, mana: 1.0, cd: 0.32, cost: 1.0,
    speed: 230, range: 220, radius: 3, count: 1, spread: 0.04, pierce: 0, impactScale: 0.8,
  },
  volley: {
    id: 'volley', name: 'Volley', kind: 'projectile', order: 1,
    blurb: 'A fan of five short-range shards.',
    dmg: 0.5, mana: 1.6, cd: 0.6, cost: 1.2,
    speed: 210, range: 140, radius: 2, count: 5, spread: 0.32, pierce: 0, impactScale: 0.4,
  },
  orb: {
    id: 'orb', name: 'Orb', kind: 'projectile', order: 2,
    blurb: 'A slow, heavy orb that bursts on impact.',
    dmg: 0.5, burst: 1.5, mana: 2.4, cd: 1.1, cost: 1.3,
    speed: 105, range: 170, radius: 5, count: 1, spread: 0, pierce: 0, aoeRadius: 30, impactScale: 1.25,
  },
  arc: {
    id: 'arc', name: 'Arc', kind: 'projectile', order: 3, instant: true,
    blurb: 'An instant arc that leaps between nearby foes.',
    dmg: 0.85, mana: 1.5, cd: 0.7, cost: 1.3,
    range: 125, jumps: 2, jumpRange: 64, falloff: 0.8, impactScale: 0.6, cone: 0.7,
  },
  nova: {
    id: 'nova', name: 'Nova', kind: 'nova', order: 4,
    blurb: 'A burst around you that hurls foes back.',
    dmg: 1.25, mana: 2.6, cd: 2.2, cost: 1.5,
    aoeRadius: 50, knockback: 260, impactScale: 0.5,
  },
  rune: {
    id: 'rune', name: 'Glyph', kind: 'aoe', order: 5,
    blurb: 'A trap glyph that arms, then erupts when a foe steps on it (max 3).',
    dmg: 2.0, mana: 2.2, cd: 1.4, cost: 1.4,
    range: 90, aoeRadius: 34, delay: 0.55, life: 14, trigger: 13, max: 3, impactScale: 1.0,
  },
  seekers: {
    id: 'seekers', name: 'Seekers', kind: 'projectile', order: 6,
    blurb: 'Three motes that hunt down the nearest foes.',
    dmg: 0.55, mana: 2.0, cd: 1.2, cost: 1.5,
    speed: 150, range: 320, radius: 2, count: 3, spread: 1.2, pierce: 0, homing: 7, impactScale: 0.4,
  },
};

const S = (type, duration, power) => ({ type, duration, power });

/**
 * Essences. elements = crafting multiset (pure essences use a single element).
 * element = damage type / colour. statuses = applied on every hit.
 * Modifiers: dmg, mana, cd, speed, radius, knock (knockback), poise (stagger), pierce (extra),
 * homing (rad/s), jump (lightning-style hop to 1 extra foe on projectile hit),
 * impact = special effect at impact points: 'cloud' | 'explode' | 'pool' | 'split' | 'meteor' | 'well' | 'frost' | 'chainstorm'
 * orbAura = what an orb of this essence does while flying.
 */
export const ESSENCES = {
  // ---- tier 1 (pure) ----
  fire: {
    id: 'fire', name: 'Flame', elements: ['fire'], element: 'fire', tier: 1, base: 12, colors: ['#ff6a1f', '#ffd25a'],
    dmg: 1.0, statuses: [S('burn', 3, 1.5)], impact: 'embers', orbAura: 'embers',
    blurb: 'Sets foes ablaze.',
  },
  ice: {
    id: 'ice', name: 'Frost', elements: ['ice'], element: 'ice', tier: 1, base: 12, colors: ['#4fc8ff', '#e6fbff'],
    dmg: 0.85, speed: 0.9, statuses: [S('chill', 3, 34)], impact: 'frost', orbAura: 'frost',
    blurb: 'Chills; enough chill freezes solid.',
  },
  lightning: {
    id: 'lightning', name: 'Storm', elements: ['lightning'], element: 'lightning', tier: 1, base: 12, colors: ['#ffe14a', '#ffffff'],
    dmg: 0.72, mana: 0.8, cd: 0.75, speed: 1.45, statuses: [S('shock', 1.2, 1)], jump: 1, orbAura: 'zap',
    blurb: 'Shocks and leaps to a second foe. Strong against armour.',
  },
  earth: {
    id: 'earth', name: 'Stone', elements: ['earth'], element: 'earth', tier: 1, base: 12, colors: ['#8fb83a', '#e8d08a'],
    dmg: 1.35, cd: 1.25, speed: 0.72, radius: 1.5, knock: 2.6, poise: 2.5, pierce: 1, shieldBreak: true, statuses: [],
    blurb: 'Heavy: staggers, smashes shields, knocks foes flying.',
  },
  arcane: {
    id: 'arcane', name: 'Arcane', elements: ['arcane'], element: 'arcane', tier: 1, base: 12, colors: ['#b05aff', '#ffb8ff'],
    dmg: 0.85, mana: 0.7, homing: 3.5, statuses: [S('vulnerable', 3, 0.15)],
    blurb: 'Cheap, gently homing; hexed foes take +15% damage.',
  },
  // ---- tier 2 (pairs) ----
  steam: {
    id: 'steam', name: 'Steam', elements: ['fire', 'ice'], element: 'fire', tier: 2, base: 15, colors: ['#e8e4f0', '#ffb08a'],
    dmg: 0.8, statuses: [S('burn', 2, 1.5)], impact: 'cloud', orbAura: 'mist',
    blurb: 'Impacts billow into scalding clouds that blind and slow foes inside.',
  },
  plasma: {
    id: 'plasma', name: 'Plasma', elements: ['fire', 'lightning'], element: 'lightning', tier: 2, base: 15, colors: ['#ff8ae0', '#ffffff'],
    dmg: 1.05, speed: 1.6, pierce: 99, statuses: [S('burn', 2, 2), S('shock', 0.8, 1)], impact: 'explode', orbAura: 'zap',
    blurb: 'Pierces everything in its path and detonates at the end.',
  },
  shatter: {
    id: 'shatter', name: 'Shatterstorm', elements: ['ice', 'lightning'], element: 'ice', tier: 2, base: 15, colors: ['#9ae8ff', '#fff6a0'],
    dmg: 0.9, speed: 1.2, statuses: [S('chill', 3, 45), S('shock', 0.8, 1)], jump: 3, impact: 'chainstorm', orbAura: 'zap',
    blurb: 'Chains between foes, freezing as it goes. Frozen foes shatter.',
  },
  magma: {
    id: 'magma', name: 'Magma', elements: ['fire', 'earth'], element: 'fire', tier: 2, base: 15, colors: ['#ff4a1a', '#ffb03a'],
    dmg: 1.2, speed: 0.8, knock: 1.8, poise: 1.8, statuses: [S('burn', 3, 2)], impact: 'pool', orbAura: 'embers',
    blurb: 'Heavy molten rock that leaves pools of lava.',
  },
  // ---- tier 3 (triples, rare & powerful) ----
  prismatic: {
    id: 'prismatic', name: 'Prismatic', elements: ['fire', 'ice', 'lightning'], element: 'arcane', tier: 3, base: 20, colors: ['#ffffff', '#ff8ad0'],
    dmg: 1.15, statuses: [S('burn', 3, 2), S('chill', 3, 40), S('shock', 1, 1)], impact: 'split', orbAura: 'zap',
    blurb: 'Burns, chills and shocks at once, then splits into three elemental shards.',
  },
  cataclysm: {
    id: 'cataclysm', name: 'Cataclysm', elements: ['fire', 'earth', 'lightning'], element: 'earth', tier: 3, base: 20, colors: ['#ffb03a', '#fff6a0'],
    dmg: 1.2, speed: 0.9, knock: 2, poise: 2, shieldBreak: true, statuses: [S('burn', 3, 2)], impact: 'meteor', orbAura: 'embers',
    blurb: 'Every impact calls a meteor down from the sky.',
  },
  singularity: {
    id: 'singularity', name: 'Void', elements: ['arcane', 'arcane', 'arcane'], element: 'arcane', tier: 3, base: 20, colors: ['#6a2aff', '#ffb8ff'],
    dmg: 1.0, homing: 2, statuses: [S('vulnerable', 4, 0.25)], impact: 'well', orbAura: 'pull',
    blurb: 'Tears open gravity wells that drag foes together, then implode.',
  },
};

/** Recipe unlock requirements per essence (Requirement shape, ARCHITECTURE 7.1). */
export const ESSENCE_REQUIRES = {
  prismatic: { towerFloor: 2 },
  cataclysm: { towerFloor: 3 },
  singularity: { towerFloor: 4 },
};

/** Spell id overrides (starter spells keep their legacy ids). */
const ID_OVERRIDE = { fire_bolt: 'firebolt', ice_volley: 'frost_shard', lightning_bolt: 'spark' };

/** Hand-picked names; everything else is "<Essence> <Form>". */
const NAME_OVERRIDE = {
  fire_bolt: 'Firebolt', fire_orb: 'Fireball', fire_seekers: "Will-o'-Wisps", fire_nova: 'Inferno Ring', fire_arc: 'Flame Lash',
  ice_volley: 'Frost Shards', ice_nova: 'Frost Nova', ice_orb: 'Hailstone', ice_rune: 'Frost Glyph',
  lightning_bolt: 'Spark', lightning_arc: 'Chain Lightning', lightning_orb: 'Ball Lightning', lightning_nova: 'Thunderclap',
  earth_bolt: 'Boulder', earth_nova: 'Quake', earth_volley: 'Gravel Burst', earth_rune: 'Spike Trap',
  arcane_bolt: 'Arcane Missile', arcane_seekers: 'Magic Missiles',
  steam_orb: 'Steam Burst', steam_nova: 'Scalding Veil', plasma_bolt: 'Plasma Lance', plasma_arc: 'Plasma Whip',
  shatter_arc: 'Shatterstorm', shatter_nova: 'Glacial Storm', magma_orb: 'Lava Bomb', magma_rune: 'Volcanic Vent',
  prismatic_nova: 'Prismatic Nova', prismatic_bolt: 'Prism Ray', cataclysm_orb: 'Meteor', cataclysm_rune: 'Doomsday Glyph',
  singularity_orb: 'Black Hole', singularity_seekers: 'Void Motes',
};

const SFX_FOR = { fire: 'cast_fire', ice: 'cast_ice', lightning: 'cast_lightning', earth: 'cast_earth', arcane: 'cast_arcane' };

const round2 = (v) => Math.round(v * 100) / 100;

function makeSpell(ess, form) {
  const key = `${ess.id}_${form.id}`;
  const id = ID_OVERRIDE[key] || key;
  const tierMana = ess.tier === 1 ? 5 : ess.tier === 2 ? 7 : 10;
  const sp = {
    id,
    name: NAME_OVERRIDE[key] || `${ess.name} ${form.name}`,
    description: `${form.blurb} ${ess.blurb}`,
    icon: `spell_${id}`,
    sfx: SFX_FOR[ess.element] || 'cast_arcane',
    elements: ess.elements.slice(),
    element: ess.element,
    tier: ess.tier,
    kind: form.kind,
    form: form.id,
    essence: ess.id,
    colors: ess.colors.slice(),
    manaCost: Math.max(2, Math.round(tierMana * form.mana * (ess.mana || 1))),
    cooldown: round2(form.cd * (ess.cd || 1)),
    damage: Math.round(ess.base * form.dmg * (ess.dmg || 1)),
    status: null, // filled below from `statuses` (contract field: the primary status)
    // Multi-projectile forms apply less chill per hit so a point-blank volley doesn't insta-freeze.
    statuses: ess.statuses.map((s) => (s.type === 'chill' && form.count > 1 ? { ...s, power: Math.round(s.power * 0.55) } : { ...s })),
    knockback: Math.round(70 * (ess.knock || 1)),
    poise: ess.poise || 1,
    shieldBreak: !!ess.shieldBreak,
    impact: ess.impact || null,
    impactScale: form.impactScale,
    jump: ess.jump || 0,
  };
  sp.status = sp.statuses[0] || null;
  if (form.kind === 'projectile' && !form.instant) {
    Object.assign(sp, {
      speed: Math.round(form.speed * (ess.speed || 1)),
      range: form.range,
      radius: Math.max(1, Math.round(form.radius * (ess.radius || 1))),
      count: form.count,
      spread: form.spread,
      pierce: Math.min(99, form.pierce + (ess.pierce || 0)),
      homing: Math.max(form.homing || 0, ess.homing || 0),
    });
    if (form.id === 'orb') {
      sp.aoeRadius = Math.round(form.aoeRadius * (ess.radius ? 1.15 : 1));
      sp.burstDamage = Math.round(ess.base * form.burst * (ess.dmg || 1));
      sp.orbAura = ess.orbAura || null;
      sp.pierce = 0;
    }
  }
  if (form.instant) Object.assign(sp, { range: form.range, jumps: form.jumps + Math.min(2, ess.jump || 0), jumpRange: form.jumpRange, falloff: form.falloff, cone: form.cone });
  if (form.id === 'nova') Object.assign(sp, { aoeRadius: Math.round(form.aoeRadius * (ess.radius ? 1.1 : 1)), delay: 0, knockback: Math.round(form.knockback * Math.max(1, (ess.knock || 1) * 0.7)) });
  if (form.id === 'rune') Object.assign(sp, { range: form.range, aoeRadius: form.aoeRadius, delay: form.delay, life: form.life, trigger: form.trigger, max: form.max });
  return sp;
}

function makeRecipe(ess, form, spell) {
  // Base fragment cost per element slot, scaled by form complexity.
  const per = ess.tier === 1 ? 3 : ess.tier === 2 ? 3 : 4;
  const cost = {};
  for (const el of ess.elements) cost[el] = (cost[el] || 0) + per;
  for (const el in cost) cost[el] = Math.max(2, Math.round(cost[el] * form.cost * (ess.elements.length === 3 && ess.elements[0] === ess.elements[2] ? 0.6 : 1)));
  const r = {
    id: `r_${spell.id}`,
    inputs: ess.elements.slice(),
    form: form.id,
    essence: ess.id,
    tier: ess.tier,
    name: spell.name,
    cost,
    result: spell.id,
    hint: `${ess.blurb} ${form.blurb}`,
  };
  if (ESSENCE_REQUIRES[ess.id]) r.requires = { ...ESSENCE_REQUIRES[ess.id] };
  return r;
}

/** Build {spells, recipes}. Order: tier, essence, form. */
export function buildSpellbook() {
  const spells = {};
  const recipes = [];
  for (const ess of Object.values(ESSENCES)) {
    for (const form of Object.values(FORMS)) {
      const sp = makeSpell(ess, form);
      spells[sp.id] = sp;
      recipes.push(makeRecipe(ess, form, sp));
    }
  }
  recipes.sort((a, b) => a.tier - b.tier);
  return { spells, recipes };
}

/** Elemental reactions (documentation for the UI / codex). */
export const REACTIONS = [
  { id: 'shatter', name: 'Shatter', trigger: 'Lightning or Stone hits a FROZEN foe', effect: 'x2.5 critical damage and an ice-shard burst.' },
  { id: 'melt', name: 'Melt', trigger: 'Fire hits a chilled or frozen foe', effect: 'x1.3 (chilled) / x1.6 (frozen) damage; releases steam.' },
  { id: 'overload', name: 'Overload', trigger: 'Fire meets Shock, or Lightning meets Burn', effect: 'Explosion that damages and knocks back nearby foes.' },
  { id: 'superconduct', name: 'Superconduct', trigger: 'Ice meets Shock, or Lightning meets Chill', effect: 'Foe takes +30% damage for 4s.' },
  { id: 'quench', name: 'Quench', trigger: 'Ice hits a burning foe', effect: 'Puts out the fire in a blinding burst of steam.' },
];

/** Status effects (documentation for the UI / codex). */
export const STATUS_INFO = {
  burn: { name: 'Burn', color: '#ff6a1f', text: 'Takes fire damage over time.' },
  chill: { name: 'Chill', color: '#4fc8ff', text: 'Slowed. Builds up; at full chill the foe FREEZES.' },
  freeze: { name: 'Frozen', color: '#e6fbff', text: 'Cannot act. Lightning or Stone shatters it.' },
  shock: { name: 'Shock', color: '#ffe14a', text: 'Brief stun on hit; takes +20% damage.' },
  blind: { name: 'Blind', color: '#c8c8d0', text: 'Lost in steam: cannot target you.' },
  vulnerable: { name: 'Hexed', color: '#b05aff', text: 'Takes increased damage.' },
  stun: { name: 'Stunned', color: '#ffffff', text: 'Cannot act.' },
};
