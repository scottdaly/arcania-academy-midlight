// Panel registry (team: ui). Each panel lives in its own module; see ../index.js for the contract.
import { titlePanel, settingsPanel, pausePanel, gameoverPanel, victoryPanel } from './menus.js';
import { dialoguePanel } from './dialogue.js';
import { inventoryPanel } from './inventory.js';
import { craftingPanel } from './crafting.js';

export const PANELS = {
  title: titlePanel,
  settings: settingsPanel,
  pause: pausePanel,
  gameover: gameoverPanel,
  victory: victoryPanel,
  dialogue: dialoguePanel,
  inventory: inventoryPanel,
  crafting: craftingPanel,
};
