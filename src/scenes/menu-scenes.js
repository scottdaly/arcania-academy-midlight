// Non-gameplay scenes: title, game over, victory. Their visuals are a backdrop from art
// (art.drawBackdrop) plus a UI panel (ui.open('title'|'gameover'|'victory')). The UI panel emits
// menu events (EV.MENU_*) which core handles in core/game.js.
import { hasSave } from '../core/save.js';

function menuScene(panel, music, backdrop, dataFn = () => ({})) {
  return {
    name: panel,
    enter(game) {
      game.level = null;
      game.player = null;
      game.guard('fx.clear', () => game.fx.clear());
      game.guard('ui.open', () => game.ui.open(panel, dataFn(game)));
      game.guard('audio.music', () => game.audio.music(music));
    },
    exit(game) {
      game.guard('ui.close', () => game.ui.close(panel));
    },
    update(game, dt) {
      game.updateTimers(dt);
      game.guard('fx.update', () => game.fx.update(dt));
    },
    render(game, ctx) {
      const { width: W, height: H } = game.display;
      game.guard('art.drawBackdrop', () => game.art.drawBackdrop(ctx, backdrop, W, H, game.realTime));
    },
  };
}

export const titleScene = menuScene('title', 'title', 'title', () => ({ canContinue: hasSave() }));
export const gameOverScene = menuScene('gameover', 'gameover', 'gameover', (game) => ({ deaths: game.state.stats.deaths }));
export const victoryScene = menuScene('victory', 'victory', 'victory', (game) => ({ stats: { ...game.state.stats } }));
