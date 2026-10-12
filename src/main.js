// Arcania Academy - entry point. Owned by core.
//
// URL parameters (handy for each team to jump straight to their content):
//   ?debug=1                 debug overlay (also toggled with F3); exposes window.game
//   ?scene=hub|dungeon|tower|boss   skip the title, start a fresh game in that scene
//   ?depth=2  ?floor=3       dungeon depth / tower floor for ?scene
//   ?seed=1234               seed the session RNG (reproducible dungeons)
//   ?continue=1              skip the title and continue the saved game
//   ?touch=1                 force on-screen touch controls on desktop (ui honours this)
//   ?mute=1                  start muted (audio honours this)
import { createGame, startNewGame, continueGame, GAMEPLAY_SCENES } from './core/game.js';
import { sceneRegistry } from './scenes/index.js';
import * as art from './art/index.js';
import { createFx } from './fx/index.js';
import * as combat from './combat/index.js';
import * as world from './world/index.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';

function showError(text) {
  const el = document.getElementById('boot-error');
  if (!el) return;
  el.hidden = false;
  el.textContent += (el.textContent ? '\n' : '') + text;
}

async function boot() {
  const canvas = document.getElementById('game');
  const game = await createGame(canvas, {
    art, createFx, combat, world, createUI, createAudio, scenes: sceneRegistry,
  });
  window.game = game; // for console debugging and the smoke test

  if (game.debug) {
    window.addEventListener('error', (e) => showError(`Error: ${e.message} @ ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => showError(`Unhandled rejection: ${e.reason}`));
  }

  const p = game.params;
  const scene = p.get('scene');
  if (p.has('continue')) continueGame(game);
  else if (scene && GAMEPLAY_SCENES.includes(scene)) {
    startNewGame(game, scene, { from: 'debug', depth: p.get('depth'), floor: p.get('floor'), seed: p.get('seed') });
  } else game.scenes.go('title');

  game.loop.start();
}

boot().catch((err) => {
  console.error('[boot] failed:', err);
  showError(`Arcania Academy failed to start:\n${err && err.stack ? err.stack : err}`);
});
