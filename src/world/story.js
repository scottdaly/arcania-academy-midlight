// Story progression (team: world). World owns the story flags (ARCHITECTURE.md §7.6).
//
// Campaign arc:
//   intro      metHeadmaster                       Headmaster explains the corrupted Archmage
//   learn      forgeGift -> firstCraft              Forge-Master's starter fragments, first craft
//   delve      reachedDepth<N>, dungeonCleared      Dungeons; reach depth 3 (Frozen Crypts)
//   tower      towerUnlocked                        Headmaster lifts the seal
//   climb      towerFloor<N>Cleared (1..5)          Floors stay cleared; wards need crafted spells
//   finale     archmageDefeated (set by core)       Victory; hub epilogue with Corvin restored
// Side flags: visitedLibrary, metArtificer, rivalMet, rivalBet, rivalBetWon, shyQuest, foundTome,
//   shyQuestDone, catGift, corvinGift, artificerGift2, clearedDepth<N>, secretFound.
import { EV } from '../core/events.js';
import { TOWER_FLOORS } from '../core/config.js';
import { getFlag, setFlag } from '../core/state.js';

export const flag = (s, k) => !!getFlag(s, k, false);

/** Number of spells the player crafted (recipes). */
export const craftedCount = (s) => s.spells?.crafted?.length || 0;

/** Story stage id from state. */
export function stage(s) {
  if (flag(s, 'archmageDefeated')) return 'epilogue';
  if (flag(s, 'towerUnlocked')) return 'tower';
  if (flag(s, 'firstCraft')) return 'delve';
  if (flag(s, 'metHeadmaster')) return 'learn';
  return 'intro';
}

export const canUnlockTower = (s) => !flag(s, 'towerUnlocked') && flag(s, 'firstCraft') && flag(s, 'reachedDepth3');

/** Next uncleared tower floor (TOWER_FLOORS if all cleared). */
export function nextTowerFloor(s) {
  for (let f = 1; f <= TOWER_FLOORS; f++) if (!flag(s, `towerFloor${f}Cleared`)) return f;
  return TOWER_FLOORS;
}

/** Wards on the tower stairs: crafted spells needed to ENTER a floor. */
export function wardRequirement(floor) {
  if (floor >= 5) return 2;
  if (floor >= 3) return 1;
  return 0;
}

/** One-line current objective (UI may show it in the HUD/pause menu via game.world.getObjective). */
export function getObjective(s) {
  switch (stage(s)) {
    case 'intro': return 'Speak with Headmaster Elowen in the Great Hall (north).';
    case 'learn':
      return flag(s, 'forgeGift')
        ? 'Craft a new spell at the Arcane Forge in the east wing (or press C).'
        : 'Visit Forge-Master Brindle in the east wing.';
    case 'delve':
      if (flag(s, 'reachedDepth3')) return 'Return to the Headmaster: the tower seal can be lifted.';
      return 'Take the portal (south-east) down to depth 3, the Frozen Crypts.';
    case 'tower': {
      const all = flag(s, `towerFloor${TOWER_FLOORS}Cleared`);
      return all ? 'Ascend to the summit and face the Corrupted Archmage.' : `Climb the Mage Tower: floor ${nextTowerFloor(s)} of ${TOWER_FLOORS}.`;
    }
    default: return 'The Academy is saved. Delve for fragments, or visit your friends.';
  }
}

/** Global story listeners (installed once from initWorld). */
export function installStory(game) {
  const { bus } = game;
  bus.on(EV.SPELL_CRAFTED, () => {
    if (flag(game.state, 'firstCraft')) return;
    setFlag(game, 'firstCraft', true);
    bus.emit(EV.TOAST, { text: 'Your first crafted spell! Slot it on keys 1-4, then test it in the dungeons.', color: '#ffd25a', duration: 4 });
  });
  bus.on(EV.GAME_LOADED, ({ state }) => {
    // Migrate older saves: infer flags from state.
    const s = state || game.state;
    if (craftedCount(s) > 0 && !s.flags.firstCraft) s.flags.firstCraft = true;
    for (let d = 1; d <= (s.dungeon?.deepest || 0); d++) s.flags[`reachedDepth${d}`] = true;
  });
  bus.on(EV.TOWER_FLOOR_CLEARED, ({ floor }) => {
    if (floor === 2 || floor === 3 || floor === 4) {
      bus.emit(EV.TOAST, { text: 'The Forge hums: new elemental combinations are now possible.', color: '#b05aff', duration: 3.5 });
    }
  });
}
