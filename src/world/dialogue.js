// NPC + dialogue data and dialogue action handling (team: world). Placeholder content.
// Formats: ARCHITECTURE.md §7.7.
import { EV } from '../core/events.js';
import { setFlag, addItem, addFragments, learnSpell, getFlag } from '../core/state.js';

/** NPC defs. dialogue(state) -> dialogueId chooses what they say right now. */
export const NPCS = {
  headmaster: {
    id: 'headmaster', name: 'Headmaster Elowen', sprite: 'npc_headmaster', portrait: 'portrait_headmaster',
    dialogue: (s) => (getFlag(s, 'metHeadmaster') ? 'headmaster_hub' : 'headmaster_intro'),
  },
  librarian: {
    id: 'librarian', name: 'Archivist Quill', sprite: 'npc_librarian', portrait: 'portrait_librarian',
    dialogue: () => 'librarian_elements',
  },
  alchemist: {
    id: 'alchemist', name: 'Alchemist Brindle', sprite: 'npc_alchemist', portrait: 'portrait_alchemist',
    dialogue: (s) => (getFlag(s, 'alchemistGift') ? 'alchemist_repeat' : 'alchemist_gift'),
  },
  student: {
    id: 'student', name: 'Pip the Student', sprite: 'npc_student', portrait: 'portrait_student',
    dialogue: () => 'student_chat',
  },
};

export const SPEAKERS = {
  player: { name: 'You', portrait: 'portrait_player' },
  ...Object.fromEntries(Object.values(NPCS).map((n) => [n.id, { name: n.name, portrait: n.portrait }])),
};

export const DIALOGUES = {
  headmaster_intro: {
    id: 'headmaster_intro', start: 'a',
    nodes: {
      a: { speaker: 'headmaster', text: 'Welcome to Arcania Academy, young mage. Dark days are upon us.', next: 'b' },
      b: { speaker: 'headmaster', text: 'The Archmage has been corrupted, and now rules from the top of the Mage Tower.', next: 'c' },
      c: { speaker: 'headmaster', text: 'Gather elemental fragments in the dungeons below. Combine them at the Arcane Forge to craft new spells.', next: 'd' },
      d: {
        speaker: 'headmaster', text: 'Take these. You will need them.', next: null,
        actions: [{ type: 'setFlag', key: 'metHeadmaster', value: true }, { type: 'giveItem', itemId: 'potion_health', qty: 2 }],
      },
    },
  },
  headmaster_hub: {
    id: 'headmaster_hub', start: 'a',
    nodes: {
      a: {
        speaker: 'headmaster', text: 'How fares your training?',
        choices: [
          { text: 'How do I craft spells?', next: 'craft' },
          { text: 'Tell me about the tower.', next: 'tower' },
          { text: 'Restore me, please.', next: 'heal', actions: [{ type: 'heal' }] },
          { text: 'Farewell.', next: null },
        ],
      },
      craft: { speaker: 'headmaster', text: 'Bring fragments to the Arcane Forge east of the fountain. Two elements make a new spell.', next: 'a' },
      tower: { speaker: 'headmaster', text: 'Five floors of enchanted guardians stand between you and the Archmage. Climb carefully.', next: 'a' },
      heal: { speaker: 'headmaster', text: 'There. Your strength is restored.', next: 'a' },
    },
  },
  librarian_elements: {
    id: 'librarian_elements', start: 'a',
    nodes: {
      a: { speaker: 'librarian', text: 'Enchanted armor fears lightning. Golems of ember fear ice, and frost golems fear fire.', next: null },
    },
  },
  alchemist_gift: {
    id: 'alchemist_gift', start: 'a',
    nodes: {
      a: {
        speaker: 'alchemist', text: 'A new face! Here, a mana draught and a few fragments to get you started.', next: null,
        actions: [
          { type: 'setFlag', key: 'alchemistGift', value: true },
          { type: 'giveItem', itemId: 'potion_mana', qty: 1 },
          { type: 'giveFragments', element: 'fire', amount: 3 },
          { type: 'giveFragments', element: 'ice', amount: 3 },
        ],
      },
    },
  },
  alchemist_repeat: {
    id: 'alchemist_repeat', start: 'a',
    nodes: { a: { speaker: 'alchemist', text: 'Fire and ice together make steam. Try it at the forge!', next: null } },
  },
  student_chat: {
    id: 'student_chat', start: 'a',
    nodes: {
      a: {
        speaker: 'student', text: 'Have you been down to the dungeons yet?',
        choices: [
          { text: 'Not yet.', next: 'b' },
          { text: 'Many times.', next: 'c', requires: { flags: { dungeonCleared: true } } },
        ],
      },
      b: { speaker: 'student', text: 'The portal by the east wall leads there. Bring potions!', next: null },
      c: { speaker: 'player', text: 'I have the fragments to prove it.', next: null },
    },
  },
};

/** Build the DIALOGUE_OPEN payload and emit it. */
export function openNpcDialogue(game, npcId) {
  const npc = NPCS[npcId];
  if (!npc) return;
  const dialogueId = npc.dialogue(game.state);
  const dialogue = DIALOGUES[dialogueId];
  if (!dialogue) { console.warn('[world] missing dialogue', dialogueId); return; }
  game.bus.emit(EV.DIALOGUE_OPEN, { dialogueId, dialogue, npcId, speakers: SPEAKERS });
}

/** Wire DIALOGUE_ACTION handling. Deferred actions (openPanel, travel) run after the box closes. */
export function installDialogueActions(game) {
  let deferred = [];
  game.bus.on(EV.DIALOGUE_ACTION, ({ action }) => {
    const a = action || {};
    const st = game.state;
    switch (a.type) {
      case 'setFlag': setFlag(game, a.key, a.value ?? true); break;
      case 'giveItem': addItem(game, a.itemId, a.qty ?? 1); game.bus.emit(EV.TOAST, { text: `Received ${a.itemId}` }); break;
      case 'giveFragments': addFragments(game, a.element, a.amount ?? 1); break;
      case 'learnSpell': learnSpell(game, a.spellId); break;
      case 'heal':
        st.player.hp = st.player.maxHp;
        st.player.mana = st.player.maxMana;
        game.bus.emit(EV.PLAYER_HEALED, { amount: 0, hp: st.player.hp, maxHp: st.player.maxHp });
        break;
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
      if (a.type === 'openPanel') game.ui.open(a.panel, a.data || {});
      else if (a.type === 'travel') game.bus.emit(EV.TRAVEL_REQUEST, { to: a.to, params: a.params || {} });
    }
  });
}
