// Global engine constants. Owned by core. Teams import read-only.

/** World tile size in world pixels. 1 world unit == 1 virtual (low-res) pixel. */
export const TILE_SIZE = 16;

/** Fixed simulation timestep (seconds). All update(dt) calls receive exactly this. */
export const FIXED_DT = 1 / 60;
/** Longest real frame we will simulate (prevents spiral of death after tab switches). */
export const MAX_FRAME_DT = 0.25;
/** Max fixed steps per rendered frame. */
export const MAX_STEPS_PER_FRAME = 8;

/** Virtual resolution: the short side aims for this many pixels (integer scaled). */
export const TARGET_SHORT_SIDE = 270;
/** Never let the short side drop below this (raises scale granularity otherwise). */
export const MIN_SHORT_SIDE = 200;
/** Cap on the long side so ultra-wide screens do not reveal half the map. */
export const MAX_LONG_SIDE = 720;

/** Element ids. The first three are the core trio; arcane/earth are optional extras. */
export const ELEMENTS = Object.freeze(['fire', 'ice', 'lightning', 'arcane', 'earth']);
export const CORE_ELEMENTS = Object.freeze(['fire', 'ice', 'lightning']);

/** Canonical element colours [main, highlight]. Art/FX/UI should use these for consistency. */
export const ELEMENT_COLORS = Object.freeze({
  fire: ['#ff6a1f', '#ffd25a'],
  ice: ['#4fc8ff', '#e6fbff'],
  lightning: ['#ffe14a', '#ffffff'],
  arcane: ['#b05aff', '#ffb8ff'],
  earth: ['#8fb83a', '#e8d08a'],
  physical: ['#c8c8d0', '#ffffff'],
});

/** Number of normal Mage Tower floors; floor TOWER_FLOORS's exit leads to the boss scene. */
export const TOWER_FLOORS = 5;

/** Scene names (the only valid arguments to scenes.go / TRAVEL_REQUEST.to). */
export const SCENES = Object.freeze({
  TITLE: 'title',
  HUB: 'hub',
  DUNGEON: 'dungeon',
  TOWER: 'tower',
  BOSS: 'boss',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
});

export const SAVE_KEY = 'arcania-academy:save:v1';
export const SETTINGS_KEY = 'arcania-academy:settings:v1';
