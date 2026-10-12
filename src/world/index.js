// WORLD public API (team: world). Contract: ARCHITECTURE.md §4.4.
import { buildHub, buildDungeon, buildTowerFloor, buildBossArena, generateDungeon } from './levels.js';
import { Pickup } from './entities.js';
import { NPCS, DIALOGUES, SPEAKERS, installDialogueActions, openNpcDialogue } from './dialogue.js';

export { NPCS, DIALOGUES, SPEAKERS, generateDungeon, openNpcDialogue };

/** Called once at boot. */
export function initWorld(game) {
  installDialogueActions(game);
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

/** Per-tick world logic (after entities + combat). */
export function update(game, dt) {}

/**
 * Create AND add a pickup. kind: 'fragment' | 'health' | 'mana' | 'item'.
 * data: { element? (fragment), itemId? (item), amount=1 }
 */
export function spawnPickup(game, kind, x, y, data = {}) {
  return game.entities.add(new Pickup(kind, x, y, data));
}
