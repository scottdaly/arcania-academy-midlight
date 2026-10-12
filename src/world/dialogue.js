// NPCs, dialogue content and dialogue action handling (team: world). Formats: ARCHITECTURE.md §7.7.
//
// Each NPC's dialogue(state) picks a dialogue id for the current story stage. Ids found in
// DIALOGUES are static trees; ids found in BUILDERS are generated on open from live data
// (recipes, enemy resistances, shop stock...), so lore always matches what combat ships.
// Node text stays under ~125 chars so it fits the 2-line box on a portrait phone.
import { EV } from '../core/events.js';

import { setFlag, addItem, addFragments, learnSpell, spendFragments, hasFragments, countItem, checkRequirements } from '../core/state.js';
import { flag, stage, canUnlockTower, craftedCount } from './story.js';
import { BIOME_START_DEPTHS } from './biomes.js';
import { itemName } from './loot.js';

const dlg = (id, nodes, start = 'a') => ({ id, start, nodes });
const HEAL = { type: 'heal' };
const say = (speaker, text, next = null, actions) => (actions ? { speaker, text, next, actions } : { speaker, text, next });

// ===================================================================== NPC roster

const newsIf = (cond) => (cond ? '!' : null);

/** NPC defs. dialogue(state, game) -> dialogueId; marker(state) -> '!' | '?' | null. */
export const NPCS = {
  headmaster: {
    id: 'headmaster', name: 'Headmaster Elowen', sprite: 'npc_headmaster', portrait: 'portrait_headmaster',
    dialogue: (s) => ({ intro: 'headmaster_intro', learn: 'headmaster_learn', delve: 'headmaster_delve', tower: 'headmaster_tower', epilogue: 'headmaster_epilogue' })[stage(s)],
    marker: (s) => newsIf(!flag(s, 'metHeadmaster') || canUnlockTower(s)),
  },
  librarian: {
    id: 'librarian', name: 'Archivist Quill', sprite: 'npc_librarian', portrait: 'portrait_librarian',
    dialogue: (s) => (flag(s, 'visitedLibrary') ? 'librarian_main' : 'librarian_intro'),
    marker: (s) => (flag(s, 'visitedLibrary') ? null : flag(s, 'metHeadmaster') ? '?' : null),
  },
  artificer: {
    id: 'artificer', name: 'Forge-Master Brindle', sprite: 'npc_artificer', fallbackSprite: 'npc_alchemist', portrait: 'portrait_artificer',
    dialogue: (s) => (flag(s, 'forgeGift') ? 'artificer_main' : 'artificer_intro'),
    marker: (s) => newsIf((flag(s, 'metHeadmaster') && !flag(s, 'forgeGift')) || (flag(s, 'towerFloor3Cleared') && !flag(s, 'artificerGift2'))),
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster Tobbin', sprite: 'npc_quartermaster', fallbackSprite: 'npc_alchemist', portrait: 'portrait_quartermaster',
    prompt: 'Trade',
    dialogue: () => 'quartermaster_shop',
  },
  rival: {
    id: 'rival', name: 'Cassius Vane', sprite: 'npc_rival', fallbackSprite: 'npc_duelmaster', portrait: 'portrait_rival',
    dialogue: (s) => {
      if (stage(s) === 'epilogue') return 'rival_epilogue';
      if (!flag(s, 'rivalMet')) return 'rival_intro';
      if (!flag(s, 'rivalBetWon')) return 'rival_bet';
      if (flag(s, 'towerUnlocked')) return 'rival_tower';
      return 'rival_mid';
    },
    marker: (s) => newsIf(flag(s, 'rivalBet') && !flag(s, 'rivalBetWon') && flag(s, 'reachedDepth2')),
  },
  shy: {
    id: 'shy', name: 'Wren', sprite: 'npc_student_shy', fallbackSprite: 'npc_student', portrait: 'portrait_shy',
    dialogue: (s) => {
      if (stage(s) === 'epilogue' && flag(s, 'shyQuestDone')) return 'shy_epilogue';
      if (flag(s, 'shyQuestDone')) return 'shy_after';
      if (flag(s, 'foundTome')) return 'shy_return';
      if (flag(s, 'shyQuest')) return 'shy_waiting';
      return 'shy_intro';
    },
    marker: (s) => newsIf((flag(s, 'metHeadmaster') && !flag(s, 'shyQuest')) || (flag(s, 'foundTome') && !flag(s, 'shyQuestDone'))),
  },
  cat: {
    id: 'cat', name: 'Mote', sprite: 'npc_cat', fallbackSprite: 'npc_student', portrait: 'portrait_cat', small: true,
    prompt: 'Pet',
    dialogue: () => 'cat',
  },
  healer: {
    id: 'healer', name: 'Nurse Marigold', sprite: 'npc_healer', fallbackSprite: 'npc_librarian', portrait: 'portrait_healer',
    dialogue: () => 'healer_main',
  },
  student: {
    id: 'student', name: 'Pip', sprite: 'npc_student', portrait: 'portrait_student',
    dialogue: () => 'pip',
  },
  archmage: {
    id: 'archmage', name: 'Archmage Corvin', sprite: 'npc_archmage', fallbackSprite: 'npc_headmaster', portrait: 'portrait_archmage',
    dialogue: () => 'archmage_epilogue',
    marker: (s) => newsIf(!flag(s, 'corvinGift')),
  },
  wanderer: {
    id: 'wanderer', name: 'Student', sprite: 'npc_student', portrait: 'portrait_wanderer',
    dialogue: () => 'wanderer_bark',
  },
};

export const SPEAKERS = {
  player: { name: 'You', portrait: 'portrait_player' },
  ...Object.fromEntries(Object.values(NPCS).map((n) => [n.id, { name: n.name, portrait: n.portrait }])),
  portal: { name: 'Delving Portal', portrait: 'portrait_portal' },
  sign: { name: 'Signpost', portrait: 'portrait_sign' },
  narrator: { name: '', portrait: null },
};

// ===================================================================== static dialogues

export const DIALOGUES = {
  // ---------------------------------------------------------------- Headmaster
  // Kept to four nodes, flag on the first node: the smoke test skims it with ~10 key presses.
  headmaster_intro: dlg('headmaster_intro', {
    a: say('headmaster', 'Ah, you made it! Welcome to Arcania Academy. I am Headmaster Elowen.', 'b', [{ type: 'setFlag', key: 'metHeadmaster', value: true }]),
    b: say('headmaster', 'I wish it were a gentler welcome. Archmage Corvin touched a Void Shard, and it corrupted him utterly.', 'c'),
    c: say('headmaster', 'He has sealed himself atop the Mage Tower, and his taint seeps into the dungeons beneath us.', 'd'),
    d: say('headmaster', 'See Forge-Master Brindle in the east wing to craft your first spell. Take these potions - and be brave.', null,
      [{ type: 'giveItem', itemId: 'potion_health', qty: 2 }]),
  }),
  headmaster_learn: dlg('headmaster_learn', {
    a: { speaker: 'headmaster', text: 'Have you visited the Forge yet? A mage without crafted spells is a candle in a storm.', choices: [
      { text: 'What should I do?', next: 'r1' },
      { text: 'Tell me about the Archmage.', next: 'arch' },
      { text: 'Please restore me.', next: 'heal', actions: [HEAL] },
      { text: 'Farewell.', next: null },
    ] },
    r1: say('headmaster', 'Brindle is in the east wing. Fragments go in, spells come out. Use the Forge, or press C.', 'r2'),
    r2: say('headmaster', 'Then take the portal in the south-east down into the dungeons. Fragments are plentiful there. So is danger.', 'a'),
    arch: say('headmaster', 'Corvin was the finest of us. He reached for the Void Shard to seal the dungeons... and the shard reached back.', 'arch2'),
    arch2: say('headmaster', 'His tower seethes with corrupted guardians. But somewhere in that madness, my old friend is still there.', 'a'),
    heal: say('headmaster', 'There. Mind the stairs on the way out - they have been grumpy since the corruption.', 'a'),
  }),
  headmaster_delve: dlg('headmaster_delve', {
    a: { speaker: 'headmaster', text: 'I felt the Forge sing when you crafted your spell! Now, the dungeons. Their depths are where the corruption pools.', choices: [
      { text: 'I reached the Frozen Crypts!', next: 'unlock', requires: { flags: { reachedDepth3: true }, notFlags: ['towerUnlocked'] } },
      { text: 'What lies below?', next: 'below' },
      { text: 'Tell me about the tower.', next: 'tower' },
      { text: 'Please restore me.', next: 'heal', actions: [HEAL] },
      { text: 'Farewell.', next: null },
    ] },
    below: say('headmaster', 'First the Overgrown Catacombs. Below them the Frozen Crypts, the Storm Vaults, and the Magma Depths.', 'below2'),
    below2: say('headmaster', 'The tower seal answers only to proven mages. Reach the Frozen Crypts - depth 3 - and come back to me.', 'a'),
    tower: say('headmaster', 'Five floors of guardians, then Corvin himself. The stair-wards test your craft: bring spells you made yourself.', 'a'),
    heal: say('headmaster', 'There. Go carefully - and bring back fragments for the Forge.', 'a'),
    unlock: say('headmaster', 'The Crypts! Then you are ready. I lift the seal on the Tower door. May the elements guard you.', 'unlock2',
      [{ type: 'setFlag', key: 'towerUnlocked', value: true }]),
    unlock2: say('headmaster', 'Climb floor by floor; cleared floors stay cleared. And as you rise, the Forge will learn new combinations.', null),
  }),
  headmaster_tower: dlg('headmaster_tower', {
    a: { speaker: 'headmaster', text: 'The tower door stands open for you. How goes the climb?', choices: [
      { text: 'Any advice?', next: 'adv' },
      { text: 'Tell me about Corvin.', next: 'arch' },
      { text: 'Please restore me.', next: 'heal', actions: [HEAL] },
      { text: 'Farewell.', next: null },
    ] },
    adv: say('headmaster', 'Learn what each guardian fears - Quill keeps notes. Freeze the brutes, shock the armoured ones.', 'adv2'),
    adv2: say('headmaster', 'And mind the stair-wards: the upper floors only open to mages who have crafted spells of their own.', 'a'),
    arch: say('headmaster', 'He taught me my first fireball, you know. Bring him back to us. Whatever it takes.', 'a'),
    heal: say('headmaster', 'There. Up you go.', 'a'),
  }),
  headmaster_epilogue: dlg('headmaster_epilogue', {
    a: say('headmaster', 'You did it. Corvin is himself again - sheepish, and drinking a truly alarming amount of tea.', 'b'),
    b: { speaker: 'headmaster', text: 'The Academy owes you everything. The dungeons still churn with echoes of the Void - delve whenever you like.', choices: [
      { text: 'Please restore me.', next: 'heal', actions: [HEAL] },
      { text: 'Thank you, Headmaster.', next: null },
    ] },
    heal: say('headmaster', 'Always, my dear hero.', null),
  }),

  // ---------------------------------------------------------------- Librarian
  librarian_intro: dlg('librarian_intro', {
    a: say('librarian', 'Shh! Oh - a new student. I am Archivist Quill. Every spell ever woven here is catalogued on these shelves.', 'b',
      [{ type: 'setFlag', key: 'visitedLibrary', value: true }]),
    b: say('librarian', 'Spells are woven from fragments. One element makes a simple spell; pairs and triples make wonders.', 'c'),
    c: say('librarian', 'Talk to me again for pairings, spell forms, or what each monster fears. Knowledge is the sharpest staff.', null),
  }),

  // ---------------------------------------------------------------- Artificer
  artificer_intro: dlg('artificer_intro', {
    a: say('artificer', 'Ho there! Brindle, Forge-Master. You will be wanting a spell, I wager. Everyone does.', 'b',
      [{ type: 'setFlag', key: 'metArtificer', value: true }]),
    b: say('artificer', 'Crafting is simple: choose elements, choose a form, pay in fragments. Here - some starter kindling.', 'c', [
      { type: 'setFlag', key: 'forgeGift', value: true },
      { type: 'giveFragments', element: 'fire', amount: 3 },
      { type: 'giveFragments', element: 'ice', amount: 3 },
    ]),
    c: say('artificer', 'Fire and ice together make Steam. Use the Forge behind me, or press C. Then slot your spell on keys 1-4.', 'd'),
    d: { speaker: 'artificer', text: 'Staves sharpen spells; robes keep you standing. Equip finds from your inventory (I). Ready?', choices: [
      { text: 'Fire up the Forge!', next: null, actions: [{ type: 'openPanel', panel: 'crafting' }] },
      { text: 'Later.', next: null },
    ] },
  }),

  // ---------------------------------------------------------------- Rival
  rival_intro: dlg('rival_intro', {
    a: say('rival', 'Well, well. The new transfer. Cassius Vane, top of the class. Remember the name - you will hear it a lot.', 'b',
      [{ type: 'setFlag', key: 'rivalMet', value: true }]),
    b: { speaker: 'rival', text: 'I bet you can not even reach depth 2 of the catacombs. If you do, I will pay you. In fragments.', choices: [
      { text: 'You are on.', next: 'c', actions: [{ type: 'setFlag', key: 'rivalBet', value: true }] },
      { text: 'Whatever, Cassius.', next: 'd', actions: [{ type: 'setFlag', key: 'rivalBet', value: true }] },
    ] },
    c: say('rival', 'Ha! Bold. The portal is south-east. Try not to cry.', null),
    d: say('rival', 'Whatever?! Nobody says whatever to a Vane. The bet stands. Depth 2!', null),
  }),
  rival_mid: dlg('rival_mid', {
    a: { speaker: 'rival', text: 'I have been practising. My Plasma Lance pierces three knights in a row. Can yours?', choices: [
      { text: 'Mine pierces four.', next: 'b' },
      { text: 'Want to team up?', next: 'c' },
      { text: 'Any tips?', next: 'd' },
    ] },
    b: say('rival', '...Liar. Probably. Ugh.', null),
    c: say('rival', 'Team up? Me? Hmph. Ask me again after you have climbed that tower.', null),
    d: say('rival', 'Fine, one: armour hates lightning. Every spark leaps to a second target. You did not hear it from me.', null),
  }),
  rival_tower: dlg('rival_tower', {
    a: { speaker: 'rival', text: 'You got into the tower before me?! Unbelievable. ...Is it scary up there? Not that I would be scared.', choices: [
      { text: 'Terrifying.', next: 'b' },
      { text: 'I cleared floor three.', next: 'c', requires: { flags: { towerFloor3Cleared: true } } },
    ] },
    b: say('rival', 'Good. I mean - bad! Be careful. Hmph.', null),
    c: say('rival', 'Floor three. Fine. You are good. There, I said it. Do not tell anyone.', null),
  }),
  rival_epilogue: dlg('rival_epilogue', {
    a: say('rival', 'You actually beat the Archmage. I am... proud to call you my rival.', 'b'),
    b: say('rival', 'Next year I am beating you at everything. Count on it. ...Want to practise together sometime?', null),
  }),

  // ---------------------------------------------------------------- Shy student
  shy_intro: dlg('shy_intro', {
    a: say('shy', 'Oh! Um. Hi. I am Wren. Sorry, I was just... hiding. From everything.', 'b'),
    b: { speaker: 'shy', text: 'I dropped my Tome of Small Lights in the dungeon when the armour started moving. I c-can not go back.', choices: [
      { text: 'I will find it for you.', next: 'yes', actions: [{ type: 'setFlag', key: 'shyQuest', value: true }] },
      { text: 'Maybe later.', next: 'no' },
    ] },
    yes: say('shy', 'R-really? It glows a little. It will be where treasure piles up - in quiet rooms with chests.', null),
    no: say('shy', 'Oh. Okay. That is... okay.', null),
  }),
  shy_waiting: dlg('shy_waiting', {
    a: say('shy', 'Any luck with my tome? It glows faintly. Look in treasure rooms - the ones with chests.', null),
  }),
  shy_return: dlg('shy_return', {
    a: say('shy', 'You found it! Oh, it is still warm. Thank you, thank you, thank you!', 'b'),
    b: say('shy', 'Take this robe - I enchanted the cuffs myself. It helps with mana. Is that weird? That is weird.', 'c', [
      { type: 'giveItem', itemId: 'robe_scholar', qty: 1 },
      { type: 'giveFragments', element: 'arcane', amount: 3 },
      { type: 'setFlag', key: 'shyQuestDone', value: true },
    ]),
    c: say('shy', 'Tip! Chill a foe enough and it freezes solid. Then hit it with something heavy. Like a boulder. Or a friend.', null),
  }),
  shy_epilogue: dlg('shy_epilogue', {
    a: say('shy', 'I went down to depth 1 all by myself today! I only cried a little. Your tome trick helped.', null),
  }),

  // ---------------------------------------------------------------- Archmage (restored)
  archmage_epilogue: dlg('archmage_epilogue', {
    a: say('archmage', 'Ah. The one who brought me back. I remember everything. The Shard whispering... I am so sorry.', 'b'),
    b: { speaker: 'archmage', text: 'The Shard is dust now, thanks to you. Please - take my old vestments. I will not need them for a while.', choices: [
      { text: 'Thank you, Archmage.', next: 'c', requires: { notFlags: ['corvinGift'] }, actions: [
        { type: 'giveItem', itemId: 'robe_archmage', qty: 1 }, { type: 'setFlag', key: 'corvinGift', value: true }] },
      { text: 'How are you feeling?', next: 'd' },
      { text: 'Farewell.', next: null },
    ] },
    c: say('archmage', 'Wear them well. And if you keep training, the dungeons will always have fragments to find.', null),
    d: say('archmage', 'Tired. Grateful. Very, very fond of tea. Elowen will not stop fussing.', 'b'),
  }),
};

// ===================================================================== dynamic dialogues

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]; // cosmetic variety only
/** Longest node text that still fits the 2-line dialogue box on a portrait phone. */
const MAX_TEXT = 125;

/** Group combat recipes by their element multiset -> one lore line per combination. */
function comboLore(game) {
  const recipes = game.combat?.listRecipes?.() || [];
  const seen = new Map();
  for (const r of recipes) {
    const key = [...r.inputs].sort().join('+');
    if (!seen.has(key)) seen.set(key, r);
  }
  const lines = [];
  for (const [key, r] of seen) {
    if (!key.includes('+')) continue;
    const sp = game.combat.getSpell?.(r.result);
    const essence = sp?.essence ? sp.essence[0].toUpperCase() + sp.essence.slice(1) : (sp?.name || r.result);
    const hint = String(r.hint || '').split('.')[0];
    const gate = r.requires?.towerFloor ? ` [Unlocks at tower floor ${r.requires.towerFloor}]` : '';
    const head = `${essence} (${key.replace(/\+/g, ' + ')}): `;
    const room = MAX_TEXT - head.length - gate.length - 1;
    lines.push(`${head}${hint.length > room ? hint.slice(0, room - 3).trimEnd() + '...' : hint + '.'}${gate}`);
  }
  return lines;
}

function foeLore(game) {
  const enemies = Object.values(game.combat?.ENEMIES || {}).filter((e) => !e.boss);
  const lines = [];
  for (const e of enemies) {
    const res = e.resist || {};
    const weak = Object.keys(res).filter((k) => res[k] > 1.05);
    const strong = Object.keys(res).filter((k) => res[k] < 0.95);
    let t = `${e.name}: `;
    t += weak.length ? `weak to ${weak.join(' and ')}` : 'no clear weakness';
    if (strong.length) t += `; resists ${strong.join(' and ')}`;
    lines.push(t + '.');
  }
  // Two foes per page when they fit in the box.
  const pages = [];
  for (const line of lines) {
    const last = pages.length - 1;
    if (last >= 0 && !pages[last].includes('. ') && pages[last].length + 1 + line.length <= MAX_TEXT) pages[last] += ' ' + line;
    else pages.push(line.slice(0, MAX_TEXT));
  }
  return pages;
}

function chain(nodes, speaker, prefix, texts, back) {
  texts.forEach((text, i) => { nodes[`${prefix}${i}`] = say(speaker, text, i + 1 < texts.length ? `${prefix}${i + 1}` : back); });
  return texts.length ? `${prefix}0` : back;
}

/** Shop stock: price in fragments, unlocked by story flags. */
export const SHOP_STOCK = [
  { itemId: 'potion_health', cost: { fire: 2, earth: 1 } },
  { itemId: 'potion_mana', cost: { ice: 2, lightning: 1 } },
  { itemId: 'elixir', cost: { arcane: 4, earth: 3 }, requires: { flags: { reachedDepth3: true } } },
  { itemId: 'staff_oak', cost: { earth: 3, fire: 2 }, gear: true },
  { itemId: 'robe_scholar', cost: { ice: 3, arcane: 2 }, gear: true },
  { itemId: 'staff_ember', cost: { fire: 8, earth: 3 }, gear: true, requires: { flags: { reachedDepth2: true } } },
  { itemId: 'robe_emberweave', cost: { fire: 6, earth: 4 }, gear: true, requires: { flags: { reachedDepth2: true } } },
  { itemId: 'staff_frostbite', cost: { ice: 8, arcane: 3 }, gear: true, requires: { flags: { reachedDepth3: true } } },
  { itemId: 'robe_frostweave', cost: { ice: 6, arcane: 4 }, gear: true, requires: { flags: { reachedDepth3: true } } },
  { itemId: 'staff_geode', cost: { earth: 8, fire: 3 }, gear: true, requires: { flags: { reachedDepth4: true } } },
  { itemId: 'robe_stormweave', cost: { lightning: 8, arcane: 4 }, gear: true, requires: { flags: { reachedDepth5: true } } },
  { itemId: 'staff_stormcaller', cost: { lightning: 12, arcane: 6 }, gear: true, requires: { flags: { towerFloor1Cleared: true } } },
  { itemId: 'robe_battlemage', cost: { earth: 10, fire: 6 }, gear: true, requires: { flags: { towerFloor2Cleared: true } } },
  { itemId: 'staff_prism', cost: { fire: 8, ice: 8, lightning: 8 }, gear: true, requires: { flags: { towerFloor3Cleared: true } } },
];

const costText = (cost) => Object.entries(cost).map(([el, n]) => `${n} ${el}`).join(', ');

function shopAvailable(game) {
  const s = game.state;
  return SHOP_STOCK.filter((e) => game.combat?.getItem?.(e.itemId) && checkRequirements(s, e.requires) && !(e.gear && countItem(s, e.itemId) > 0));
}

export const BUILDERS = {
  librarian_main(game) {
    const nodes = {};
    const combos = chain(nodes, 'librarian', 'combo', [
      'Single elements first: fire burns, ice chills until foes freeze, lightning leaps between targets, earth staggers.',
      ...comboLore(game),
    ], 'a');
    const foes = chain(nodes, 'librarian', 'foe', foeLore(game), 'a');
    nodes.a = { speaker: 'librarian', text: 'What shall we research today?', choices: [
      { text: 'Element combinations', next: combos },
      { text: 'Spell forms', next: 'forms0' },
      { text: 'What do monsters fear?', next: foes },
      { text: 'Tell me about the dungeons.', next: 'dun0' },
      { text: 'The Archmage\'s history.', next: 'lore0' },
      { text: 'Goodbye.', next: null },
    ] };
    chain(nodes, 'librarian', 'forms', [
      'Every element can be shaped: a fast bolt, a volley of shards, a heavy orb, or an arc that leaps foe to foe.',
      'A nova blasts everything around you away. A glyph is a trap that waits for a foe. Seekers hunt on their own.',
      'Same fragments, very different fights. Swap forms at the Forge until one sings for you.',
    ], 'a');
    chain(nodes, 'librarian', 'dun', [
      'The Catacombs hoard earth and fire; the Frozen Crypts, ice and arcane. Deeper still, the Storm Vaults crackle with lightning.',
      'The Magma Depths run with fire and earth. Glowing geodes hold whole clusters of fragments - crack them open!',
      'Rooms that slam shut are ambushes. Survive the waves and the seal breaks - with a reward for your trouble.',
      'And some walls are not walls. A cobweb or a crack may hide a loose stone. Push it, or blast it with a spell.',
    ], 'a');
    chain(nodes, 'librarian', 'lore', [
      'Corvin was Archmage for forty years. He studied the Void - the nothing between the elements.',
      'He found a shard of it in the deepest vault and thought he could tame it. Hubris is the oldest spell of all.',
      'The Void hungers for fragments. That is why the dungeons swarm with them now. Corruption feeds corruption.',
    ], 'a');
    return dlg('librarian_main', nodes);
  },

  artificer_main(game) {
    const s = game.state;
    const giftId = game.combat?.getItem?.('robe_battlemage') ? 'robe_battlemage' : 'robe_scholar';
    const nodes = {
      a: { speaker: 'artificer', text: pick(['Back again? The Forge is warm.', 'Mind the sparks. What can I do for you?', 'Fragments in, wonders out. What will it be?']), choices: [
        { text: 'Use the Forge.', next: null, actions: [{ type: 'openPanel', panel: 'crafting' }] },
        { text: 'Tell me about staves.', next: 'st0' },
        { text: 'Tell me about robes.', next: 'rb0' },
        { text: 'Anything new?', next: 'gift', requires: { flags: { towerFloor3Cleared: true }, notFlags: ['artificerGift2'] } },
        { text: 'Farewell.', next: null },
      ] },
      gift: say('artificer', `Tower scrap makes fine armour. I hammered you a ${itemName(game, giftId)}. Do not scratch it.`, 'a',
        [{ type: 'giveItem', itemId: giftId, qty: 1 }, { type: 'setFlag', key: 'artificerGift2', value: true }]),
    };
    chain(nodes, 'artificer', 'st', [
      'Staves amplify. Some boost every spell; others favour one element. An Ember Staff makes every fire spell bite harder.',
      'Match your staff to the spells you love - and to what the dungeon fears. Equip it from your inventory with I.',
    ], 'a');
    chain(nodes, 'artificer', 'rb', [
      'Robes are your armour and your well: more health, more mana, faster regeneration. Some even quicken your step.',
      craftedCount(s) ? 'Chests in the deep hold the best ones. Tobbin trades gear for fragments, too - he drives a hard bargain.'
        : 'But first: craft something! A mage with only the starter trio will not last long below.',
    ], 'a');
    return dlg('artificer_main', nodes);
  },

  quartermaster_shop(game) {
    const avail = shopAvailable(game);
    const nodes = {};
    const buy = avail.map((e) => ({
      text: `${itemName(game, e.itemId)} (${costText(e.cost)})`,
      next: 'thanks',
      requires: { fragments: e.cost },
      actions: [{ type: 'emit', event: 'world:buy', payload: { itemId: e.itemId, cost: e.cost } }],
    }));
    const pages = [];
    for (let i = 0; i < avail.length; i += 2) {
      pages.push(avail.slice(i, i + 2).map((e) => `${itemName(game, e.itemId)}: ${costText(e.cost)}`).join('. ') + '.');
    }
    const browse = chain(nodes, 'quartermaster', 'list', pages.length ? pages : ['Shelves are bare. Come back after your next delve!'], 'a');
    nodes.a = { speaker: 'quartermaster', text: buy.some((b) => hasFragments(game.state, b.requires.fragments))
      ? 'Tobbin\'s Provisions! Fragments for gear, fair and square. You can afford:'
      : 'Tobbin\'s Provisions! Fragments for gear. Nothing in your price range yet, mind.', choices: [
      ...buy.slice(0, 6),
      { text: 'What do you stock?', next: browse },
      { text: 'Leave.', next: null },
    ] };
    nodes.thanks = say('quartermaster', pick(['Pleasure doing business!', 'Wear it in good health.', 'A fine choice. Mostly.']), 'a');
    return dlg('quartermaster_shop', nodes);
  },

  cat(game) {
    const s = game.state;
    const lines = {
      intro: ['Mrrp?', 'The cat regards you with ancient, unimpressed eyes.'],
      learn: ['Mote sniffs your sleeve. It smells of the Forge.', 'Mrrrow.'],
      delve: ['Mote sniffs your boots. Catacomb moss. She approves.', 'Mote is sitting exactly where you wanted to walk.'],
      tower: ['Mote stares up at the tower and flicks her tail.', 'Mote kneads your robe with tiny, needle-sharp paws.'],
      epilogue: ['Mote has fallen asleep on the warmest stone in the courtyard.', 'Purr. Purr. Purr.'],
    }[stage(s)];
    const nodes = {
      a: { speaker: 'cat', text: pick(lines), choices: [
        { text: 'Pet the cat.', next: 'gift', requires: { notFlags: ['catGift'] } },
        { text: 'Pet the cat.', next: 'pet', requires: { flags: { catGift: true } } },
        { text: 'Leave her be.', next: null },
      ] },
      gift: say('cat', 'Mote purrs, then bats something shiny out from under her paw. An arcane fragment!', null,
        [{ type: 'giveFragments', element: 'arcane', amount: 2 }, { type: 'setFlag', key: 'catGift', value: true }]),
      pet: say('cat', pick(['Mote purrs like a tiny thunderstorm.', 'Mote headbutts your hand. You feel weirdly lucky.', 'Mote tolerates exactly three pets, then leaves.']), null),
    };
    return dlg('cat', nodes);
  },

  healer_main(game) {
    const s = game.state;
    const hurt = s.player.hp < s.player.maxHp || s.player.mana < s.player.maxMana;
    return dlg('healer_main', {
      a: say('healer', hurt ? 'Oh, look at you! Hold still, dear.' : 'Healthy as a hippogriff! Still, a little extra never hurts.', 'b', [HEAL]),
      b: say('healer', pick([
        'Drink potions from your inventory when things look grim. Better a potion now than a visit to me later.',
        'Health and mana orbs drift to you when you need them. Monsters drop them - and shrines heal you completely.',
        'If you fall below, the Academy\'s wards bring you home to me. You keep everything you found. Clever wards.',
      ]), null),
    });
  },

  healer_respawn(game) {
    const deaths = game.state.stats?.deaths || 1;
    const opener = [
      'There you are! The wards carried you home. You gave us quite a fright.',
      'Back again? I am starting to keep a cot warm just for you.',
      'Shh, shh. You are safe. The dungeons will still be there tomorrow.',
      'Third time this week! I am naming a bandage after you.',
    ][(deaths - 1) % 4];
    const tip = pick([
      'Your fragments and gear are all still with you. Craft something stronger before you go back down.',
      'Ask Archivist Quill what those monsters fear. The right element can halve a fight.',
      'Rooms that seal shut are ambushes. Fight with your back to a wall, not in the middle.',
      'Mana runs dry fast. Mix cheap bolts with your big spells, and keep a mana potion handy.',
      'Tobbin trades gear for fragments. A better robe might be all you need.',
    ]);
    // never send a struggling student back out empty-handed: top up to 2 health potions
    const have = game.state.inventory.find((s) => s.id === 'potion_health')?.qty || 0;
    const gift = have < 2 ? [{ type: 'giveItem', itemId: 'potion_health', qty: 2 - have }] : [];
    return dlg('healer_respawn', {
      a: say('healer', gift.length ? `${opener} Here, take a potion or two for the road.` : opener, 'b', [HEAL, ...gift]),
      b: say('healer', tip, null),
    });
  },

  pip(game) {
    const touch = game.input?.isTouchDevice || game.input?.lastDevice === 'touch';
    const controls = touch
      ? 'Joystick on the left to move, spell buttons on the right. Tap the hand button to talk or use things.'
      : 'WASD or arrows to move, 1-4 to cast, E to talk or use things, I for inventory, C to craft.';
    return dlg('pip', {
      a: { speaker: 'student', text: 'Hiya! First week? I am Pip. Want to know what they do not tell you in orientation?', choices: [
        { text: 'Controls?', next: 'c' },
        { text: 'Spells and mana?', next: 's' },
        { text: 'Fragments?', next: 'f' },
        { text: 'Bye, Pip.', next: null },
      ] },
      c: say('student', controls, 'a'),
      s: say('student', 'Mana refills on its own. Use cheap spells to whittle, big ones to finish. Watch the cooldowns on your spell bar!', 'a'),
      f: say('student', 'Monsters drop fragments, geodes burst with them, chests hold piles. Walk near and they fly right to you!', 'a'),
    });
  },

  wanderer_bark(game) {
    const st = stage(game.state);
    const pool = {
      intro: ['Did you hear? The Headmaster wants to see every new student!', 'The Great Hall is just north of the fountain.'],
      learn: ['I tried crafting Steam once. My eyebrows grew back eventually.', 'Brindle\'s forge is in the east wing. You can hear the hammering from here.'],
      delve: ['The portal to the dungeons is south-east. I am NOT going down there.', 'Someone said the walls in the catacombs have secret doors. Spooky!'],
      tower: ['You are climbing the tower? Can I have your room if you do not come back?', 'Light keeps flickering at the top of the tower. Pink light. Bad light.'],
      epilogue: ['Is it true you beat the Archmage? Can I have your autograph?', 'The tower glows blue again. It is kind of pretty, actually.'],
    }[st];
    const extra = ['Have you seen the cat? She steals my quills.', 'Exams next week. Do not remind me.', 'The fountain water tastes like mint. Do not ask how I know.'];
    return dlg('wanderer_bark', { a: say('wanderer', pick([...pool, ...extra]), null) });
  },

  /** The hub portal's destination menu (waystones for each biome you have reached). */
  portal_menu(game) {
    const s = game.state;
    const choices = [];
    for (const { depth, biome } of BIOME_START_DEPTHS) {
      if (depth > 1 && !flag(s, `reachedDepth${depth}`)) continue;
      choices.push({ text: `Depth ${depth}: ${biome.name}`, next: null, actions: [{ type: 'travel', to: 'dungeon', params: { depth } }] });
    }
    const deepest = s.dungeon?.deepest || 0;
    if (deepest > 1 && !BIOME_START_DEPTHS.some((b) => b.depth === deepest)) {
      choices.push({ text: `Depth ${deepest} (deepest reached)`, next: null, actions: [{ type: 'travel', to: 'dungeon', params: { depth: deepest } }] });
    }
    choices.push({ text: 'Not yet.', next: null });
    return dlg('portal_menu', {
      a: { speaker: 'portal', text: 'The portal swirls. Waystones glow for every depth you have reached. Where will you descend?', choices },
    });
  },
};

// ===================================================================== engine

/** Resolve a dialogue id to a dialogue object (static or built). */
export function getDialogue(game, id) {
  if (BUILDERS[id]) return game.guard ? game.guard(`world.dialogue:${id}`, () => BUILDERS[id](game)) : BUILDERS[id](game);
  return DIALOGUES[id] || null;
}

/** Emit DIALOGUE_OPEN for an explicit dialogue object/id. */
export function openDialogue(game, dialogueOrId, npcId = 'narrator') {
  const dialogue = typeof dialogueOrId === 'string' ? getDialogue(game, dialogueOrId) : dialogueOrId;
  if (!dialogue) { console.warn('[world] missing dialogue', dialogueOrId); return; }
  game.bus.emit(EV.DIALOGUE_OPEN, { dialogueId: dialogue.id, dialogue, npcId, speakers: SPEAKERS });
}

/** Build the DIALOGUE_OPEN payload for an NPC's current dialogue and emit it. */
export function openNpcDialogue(game, npcId) {
  const npc = NPCS[npcId];
  if (!npc) { console.warn('[world] unknown npc', npcId); return; }
  const id = npc.dialogue(game.state, game);
  openDialogue(game, id, npcId);
}

/** Wire DIALOGUE_ACTION handling. Deferred actions (openPanel, travel) run after the box closes. */
export function installDialogueActions(game) {
  let deferred = [];
  const toast = (text, color, duration) => game.bus.emit(EV.TOAST, { text, color, duration });
  game.bus.on(EV.DIALOGUE_ACTION, ({ action }) => {
    const a = action || {};
    const st = game.state;
    switch (a.type) {
      case 'setFlag': setFlag(game, a.key, a.value ?? true); break;
      case 'giveItem': {
        if (!game.combat?.getItem?.(a.itemId)) { console.warn('[world] giveItem: unknown item', a.itemId); break; }
        addItem(game, a.itemId, a.qty ?? 1);
        // (the HUD toasts "Found: <name>" from INVENTORY_CHANGED)
        break;
      }
      case 'giveFragments':
        addFragments(game, a.element, a.amount ?? 1);
        break;
      case 'learnSpell': learnSpell(game, a.spellId); break;
      case 'heal': {
        const before = st.player.hp;
        st.player.hp = st.player.maxHp;
        st.player.mana = st.player.maxMana;
        game.bus.emit(EV.PLAYER_HEALED, { amount: st.player.hp - before, hp: st.player.hp, maxHp: st.player.maxHp });
        break;
      }
      case 'openPanel':
      case 'travel':
        deferred.push(a);
        break;
      case 'emit': game.bus.emit(a.event, a.payload || {}); break;
      default: console.warn('[world] unknown dialogue action', a);
    }
  });
  game.bus.on(EV.DIALOGUE_CLOSED, () => {
    const list = deferred;
    deferred = [];
    for (const a of list) {
      if (a.type === 'openPanel') game.guard('world.openPanel', () => game.ui.open(a.panel, a.data || {}));
      else if (a.type === 'travel') game.bus.emit(EV.TRAVEL_REQUEST, { to: a.to, params: a.params || {} });
    }
  });
  // Shop purchases (world-private event fired by the quartermaster's 'emit' actions).
  game.bus.on('world:buy', ({ itemId, cost } = {}) => {
    if (!itemId || !game.combat?.getItem?.(itemId)) return;
    if (!spendFragments(game, cost || {})) { toast('Not enough fragments.', '#ff8a8a'); return; }
    addItem(game, itemId, 1);
    game.bus.emit(EV.SFX, { name: 'craft' });
    toast(`Bought ${itemName(game, itemId)}!`, '#ffd25a');
  });
}

