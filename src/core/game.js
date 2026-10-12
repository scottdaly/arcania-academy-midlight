// Builds the `game` context object that is passed to every team module, wires the loop,
// and implements the core game flow (new game, continue, travel, death, respawn, victory).
// See ARCHITECTURE.md §3 for the full list of `game` fields teams may use.
import { Display } from './display.js';
import { EventBus, EV } from './events.js';
import { Input } from './input.js';
import { Camera } from './camera.js';
import { GameLoop } from './loop.js';
import { SceneManager } from './scenes.js';
import { EntityList } from './entity.js';
import { RNG } from './rng.js';
import { TileMapRenderer } from './tilemap-renderer.js';
import { SCENES } from './config.js';
import { createNewState, setFlag, clampVitals } from './state.js';
import { saveGame, loadGame, loadSettings, saveSettings } from './save.js';

export const VERSION = '0.1.0';
export const GAMEPLAY_SCENES = Object.freeze([SCENES.HUB, SCENES.DUNGEON, SCENES.TOWER, SCENES.BOSS]);

/** Wraps a team call so one bug logs (at most `limit` times per site) instead of killing the loop. */
function makeGuard() {
  const counts = new Map();
  return function guard(label, fn, limit = 3) {
    try {
      return fn();
    } catch (err) {
      const n = (counts.get(label) || 0) + 1;
      counts.set(label, n);
      if (n <= limit) console.error(`[game] ${label} threw${n === limit ? ' (further errors suppressed)' : ''}:`, err);
      return undefined;
    }
  };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{art, createFx, combat, world, createUI, createAudio, scenes: Record<string, object>}} modules
 */
export async function createGame(canvas, modules) {
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  const display = new Display(canvas);
  const bus = new EventBus();
  const input = new Input(display);
  const camera = new Camera();
  const guard = makeGuard();
  const timers = [];

  const game = {
    VERSION,
    params,
    debug: params.has('debug'),
    canvas,
    display,
    bus,
    input,
    camera,
    guard,
    /** Low-res virtual context (same as display.ctx). */
    get ctx() { return display.ctx; },
    /** Saved game state. REPLACED on new game/load - always read game.state fresh. */
    state: createNewState(),
    /** Persistent settings (volumes, touch controls). Call game.saveSettings() after edits. */
    settings: loadSettings(),
    /** Session RNG for non-reproducible-but-seedable rolls (?seed=123 makes runs repeatable). */
    rng: new RNG(seedParam == null ? undefined : (isNaN(+seedParam) ? seedParam : +seedParam)),
    /** True once a game was started/loaded (enables saving). */
    inSession: false,
    entities: null,
    scenes: null,
    loop: null,
    tileRenderer: null,
    /** Current Level (see ARCHITECTURE.md §7.5) or null outside gameplay scenes. */
    level: null,
    /** Current player Entity or null. */
    player: null,
    /** Nearest interactable entity in range of the player (maintained by core), or null. */
    interactTarget: null,
    /** Seconds of simulated gameplay time (advances only while the world updates). */
    time: 0,
    /** Seconds since boot (always advances; use for UI/title animation). */
    realTime: 0,
    hitStopTimer: 0,
    // Team modules (filled below).
    art: modules.art,
    combat: modules.combat,
    world: modules.world,
    fx: null,
    ui: null,
    audio: null,

    /** Schedule fn after `seconds` of scene time. Cleared on scene change. */
    after(seconds, fn) {
      timers.push({ t: seconds, fn });
    },
    clearTimers() {
      timers.length = 0;
    },
    updateTimers(dt) {
      for (let i = timers.length - 1; i >= 0; i--) {
        const tm = timers[i];
        tm.t -= dt;
        if (tm.t <= 0) {
          timers.splice(i, 1);
          guard('timer', tm.fn);
        }
      }
    },
    /** Freeze world simulation briefly for impact (max 0.2s). */
    hitStop(duration = 0.05) {
      game.hitStopTimer = Math.max(game.hitStopTimer, Math.min(0.2, duration));
    },
    isGameplay() {
      return GAMEPLAY_SCENES.includes(game.scenes?.currentName);
    },
    save() {
      if (!game.inSession) return false;
      clampVitals(game.state);
      const ok = saveGame(game.state);
      bus.emit(EV.GAME_SAVED, { ok });
      return ok;
    },
    saveSettings() {
      return saveSettings(game.settings);
    },
  };

  game.entities = new EntityList(game);
  game.scenes = new SceneManager(game);
  bus.debug = params.has('debugbus');

  // ---- team modules -------------------------------------------------------------
  await modules.art.initArt(game);
  game.tileRenderer = new TileMapRenderer(modules.art);
  game.fx = modules.createFx(game);
  game.audio = modules.createAudio(game);
  game.ui = modules.createUI(game);
  modules.combat.initCombat(game);
  modules.world.initWorld(game);

  input.onGesture(() => guard('audio.unlock', () => game.audio.unlock()));

  for (const [name, scene] of Object.entries(modules.scenes)) game.scenes.register(name, scene);
  installFlow(game);
  installDebug(game);

  // ---- loop ------------------------------------------------------------------------
  const tick = (dt) => {
    game.realTime += dt;
    input.update(dt);
    guard('ui.update', () => game.ui.update(dt));
    guard('scenes.update', () => game.scenes.update(dt));
    guard('audio.update', () => game.audio.update?.(dt));
  };

  const render = (alpha, frameDt) => {
    const ctx = display.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    camera.setView(display.width, display.height);
    guard('scenes.render', () => game.scenes.render(ctx, alpha));
    resetCtx(ctx);
    guard('fx.renderScreen', () => game.fx.renderScreen(ctx));
    resetCtx(ctx);
    guard('ui.render', () => game.ui.render(ctx));
    resetCtx(ctx);
    game.scenes.renderFade(ctx);
    if (game.debug) drawDebug(game, ctx, frameDt);
    display.present();
  };

  game.loop = new GameLoop({ update: tick, render });
  return game;
}

function resetCtx(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
}

// ===================================================================== game flow

export function startNewGame(game, scene = SCENES.HUB, params = { from: 'newGame' }) {
  game.state = createNewState();
  game.inSession = true;
  game.bus.emit(EV.GAME_NEW, { state: game.state });
  clampVitals(game.state);
  game.state.player.hp = game.state.player.maxHp;
  game.state.player.mana = game.state.player.maxMana;
  game.save();
  game.scenes.go(scene, params);
}

export function continueGame(game) {
  const loaded = loadGame();
  if (!loaded) return startNewGame(game);
  game.state = loaded;
  game.inSession = true;
  game.bus.emit(EV.GAME_LOADED, { state: loaded });
  game.scenes.go(SCENES.HUB, { from: 'continue' });
}

function installFlow(game) {
  const { bus } = game;

  bus.on(EV.MENU_NEW_GAME, () => startNewGame(game));
  bus.on(EV.MENU_CONTINUE, () => continueGame(game));
  bus.on(EV.MENU_QUIT_TO_TITLE, () => {
    if (game.isGameplay()) game.save();
    game.scenes.go(SCENES.TITLE);
  });
  bus.on(EV.MENU_RESPAWN, () => {
    const p = game.state.player;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    bus.emit(EV.PLAYER_RESPAWNED, {});
    game.save();
    game.scenes.go(SCENES.HUB, { from: 'respawn' });
  });

  bus.on(EV.TRAVEL_REQUEST, ({ to, params } = {}) => {
    if (!GAMEPLAY_SCENES.includes(to)) {
      console.error(`[flow] TRAVEL_REQUEST to invalid scene "${to}"`);
      return;
    }
    if (game.state.player.hp <= 0) return; // dying players cannot leave
    game.save();
    game.scenes.go(to, params || {});
  });

  bus.on(EV.PLAYER_DIED, () => {
    game.state.stats.deaths++;
    game.after(1.6, () => {
      bus.emit(EV.GAME_OVER, {});
      game.scenes.go(SCENES.GAMEOVER);
    });
  });

  bus.on(EV.BOSS_DEFEATED, () => {
    setFlag(game, 'archmageDefeated', true);
    game.save();
    game.after(3, () => {
      bus.emit(EV.VICTORY, {});
      game.scenes.go(SCENES.VICTORY);
    });
  });

  bus.on(EV.SAVE_REQUEST, () => game.save());
  bus.on(EV.CAMERA_SHAKE, ({ intensity = 3, duration = 0.25 } = {}) => {
    if (game.settings.screenShake) game.camera.shake(intensity, duration);
  });
  bus.on(EV.HIT_STOP, ({ duration = 0.05 } = {}) => game.hitStop(duration));

  // Auto-pause when the tab is hidden during gameplay.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.isGameplay() && !game.ui.blocksWorld()) {
      game.guard('ui.open(pause)', () => game.ui.open('pause'));
    }
    if (document.hidden) game.guard('audio.suspend', () => game.audio.suspend?.());
    else game.guard('audio.resume', () => game.audio.resume?.());
  });
}

// ===================================================================== debug

function installDebug(game) {
  game.input.onKey((e) => {
    if (e.code === 'F3') {
      e.preventDefault();
      game.debug = !game.debug;
    }
  });
}

function drawDebug(game, ctx, frameDt) {
  const lines = [
    `fps ${game.loop.fps.toFixed(0)}  ${game.display.width}x${game.display.height} @${game.display.scale}x`,
    `scene ${game.scenes.currentName}  ent ${game.entities.count}  fx ${game.fx.count?.() ?? '?'}`,
    game.player ? `player ${game.player.x.toFixed(0)},${game.player.y.toFixed(0)}  hp ${game.state.player.hp.toFixed(0)}` : '',
  ];
  const draw = game.ui?.drawText;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, game.display.height - 26, 230, 26);
  lines.forEach((l, i) => {
    if (!l) return;
    if (draw) draw(ctx, l, 3, game.display.height - 24 + i * 8, { color: '#9f9' });
    else {
      ctx.fillStyle = '#9f9';
      ctx.font = '7px monospace';
      ctx.fillText(l, 3, game.display.height - 18 + i * 8);
    }
  });
  ctx.restore();
}
