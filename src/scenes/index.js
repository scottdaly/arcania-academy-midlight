// Scene registry (owned by core).
import { SCENES } from '../core/config.js';
import { createWorldScene } from './world-scene.js';
import { titleScene, gameOverScene, victoryScene } from './menu-scenes.js';

export const sceneRegistry = {
  [SCENES.TITLE]: titleScene,
  [SCENES.HUB]: createWorldScene(SCENES.HUB),
  [SCENES.DUNGEON]: createWorldScene(SCENES.DUNGEON),
  [SCENES.TOWER]: createWorldScene(SCENES.TOWER),
  [SCENES.BOSS]: createWorldScene(SCENES.BOSS),
  [SCENES.GAMEOVER]: gameOverScene,
  [SCENES.VICTORY]: victoryScene,
};
