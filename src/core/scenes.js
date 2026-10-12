// Scene/state manager with a fade-to-black transition.
// A scene is { enter(game, params), exit(game), update(game, dt), render(game, ctx, alpha) }.
// Scenes are owned by core (src/scenes/). Teams never call scenes.go directly: they emit
// EV.TRAVEL_REQUEST / menu events and core decides.
import { EV } from './events.js';

const FADE_TIME = 0.3;

export class SceneManager {
  constructor(game) {
    this.game = game;
    this.scenes = Object.create(null);
    this.current = null;
    this.currentName = null;
    this.params = {};
    this._pending = null;
    /** 0 = fully visible, 1 = fully black. */
    this.fade = 0;
    this._phase = 'idle'; // 'idle' | 'out' | 'in'
  }

  register(name, scene) {
    this.scenes[name] = scene;
  }

  /** True while fading out/in. Gameplay scenes freeze during the fade-out. */
  get transitioning() {
    return this._phase === 'out';
  }

  go(name, params = {}, { instant = false } = {}) {
    if (!this.scenes[name]) {
      console.error(`[scenes] unknown scene "${name}"`);
      return;
    }
    this._pending = { name, params };
    if (!this.current) {
      // First scene: switch now and fade in from black.
      this._switch();
      this.fade = 1;
      this._phase = 'in';
    } else if (instant) {
      this._switch();
      this.fade = 0;
      this._phase = 'idle';
    } else if (this._phase !== 'out') {
      this._phase = 'out';
    }
  }

  _switch() {
    const { name, params } = this._pending;
    this._pending = null;
    const game = this.game;
    const from = this.currentName;
    if (this.current) {
      try { this.current.exit?.(game); } catch (err) { console.error(`[scenes] exit("${from}") threw`, err); }
    }
    game.clearTimers();
    game.input.reset();
    this.current = this.scenes[name];
    this.currentName = name;
    this.params = params;
    try {
      this.current.enter?.(game, params);
    } catch (err) {
      console.error(`[scenes] enter("${name}") threw`, err);
    }
    game.bus.emit(EV.SCENE_CHANGED, { from, to: name, params });
  }

  update(dt) {
    if (this._phase === 'out') {
      this.fade = Math.min(1, this.fade + dt / FADE_TIME);
      if (this.fade >= 1) {
        this._switch();
        this._phase = 'in';
      }
    } else if (this._phase === 'in') {
      this.fade = Math.max(0, this.fade - dt / FADE_TIME);
      if (this.fade <= 0) this._phase = 'idle';
    }
    if (this.current && this._phase !== 'out') this.current.update?.(this.game, dt);
  }

  render(ctx, alpha) {
    this.current?.render?.(this.game, ctx, alpha);
  }

  renderFade(ctx) {
    if (this.fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.fade);
    ctx.fillStyle = '#05030a';
    ctx.fillRect(0, 0, this.game.display.width, this.game.display.height);
    ctx.restore();
  }
}
