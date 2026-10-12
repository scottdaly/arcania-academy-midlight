// WORLD public API (team: world). Contract: ARCHITECTURE.md §4.4.
//   hub.js          handcrafted Academy hub (buildHubMap is pure)
//   dungeon-gen.js  pure seeded dungeon generator (BSP + caves, biomes, roles, spawns)
//   dungeon.js      dungeon Level: ambush seals, chests, geodes, secrets, clear rewards
//   tower.js        five themed tower floors + summit boss arena
//   dialogue.js     NPC roster, dialogue trees/builders, dialogue actions, shop
//   story.js        story flags, objective text, progression listeners
//   entities.js     NPCs, wanderers, doors, pickups (magnet), chests, geodes, shrines...
//   loot.js         chest loot tables by tier (combat owns item stats)
import { buildHub } from './hub.js';
import { buildDungeon } from './dungeon.js';
import { buildTowerFloor, buildBossArena } from './tower.js';
import { generateDungeon, tierForDepth } from './dungeon-gen.js';
import { pickGear } from './loot.js';
import { Pickup } from './entities.js';
import { NPCS, DIALOGUES, SPEAKERS, installDialogueActions, openNpcDialogue, openDialogue, getDialogue } from './dialogue.js';
import { installStory, getObjective as objectiveFor } from './story.js';

export { NPCS, DIALOGUES, SPEAKERS, generateDungeon, openNpcDialogue, openDialogue, getDialogue };

/** Called once at boot. */
export function initWorld(game) {
  installDialogueActions(game);
  installStory(game);
}

/**
 * Build the level for a LevelSpec and populate game.entities (NPCs, doors, pickups, enemies via
 * game.combat.spawnEnemy, boss via game.combat.spawnBoss). Core spawns the player afterwards at
 * level.playerSpawn. Must return a Level (ARCHITECTURE.md §7.5).
 */
export function buildLevel(game, spec) {
  switch (spec.kind) {
    case 'hub': return buildHub(game, spec);
    case 'dungeon': return buildDungeon(game, spec);
    case 'tower': return buildTowerFloor(game, spec);
    case 'boss': return buildBossArena(game, spec);
    default: throw new Error(`world.buildLevel: unknown kind "${spec.kind}"`);
  }
}

/** Per-tick world logic (after entities + combat). Level-specific logic lives in level.update. */
export function update(game, dt) {}

/**
 * Create AND add a pickup. kind: 'fragment' | 'health' | 'mana' | 'item'.
 * data: { element? (fragment), itemId? (item), amount=1, burst? (pop out with a little hop) }
 */
export function spawnPickup(game, kind, x, y, data = {}) {
  if (kind === 'gear') {
    // Lenient: resolve a generic "gear" drop to an unowned staff/robe of the current tier.
    const lvl = game.level?.data?.depth || game.level?.data?.floor + 2 || 1;
    const itemId = data.itemId || pickGear(game, game.rng, tierForDepth(lvl));
    if (!itemId) return game.entities.add(new Pickup('fragment', x, y, { element: 'arcane', amount: 3, burst: true }));
    kind = 'item';
    data = { ...data, itemId, amount: 1 };
  }
  if (kind !== 'fragment' && kind !== 'health' && kind !== 'mana' && kind !== 'item') {
    console.warn('[world] spawnPickup: unknown kind', kind);
    return null;
  }
  if (kind === 'item' && !game.combat?.getItem?.(data.itemId)) {
    console.warn('[world] spawnPickup: unknown item', data.itemId);
    return null;
  }
  return game.entities.add(new Pickup(kind, x, y, data));
}

/** Current story objective (one line) for HUD / pause menu. */
export function getObjective(game) {
  return objectiveFor(game.state);
}
