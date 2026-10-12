// Fixed-timestep game loop with interpolated rendering.
// update(dt) is always called with dt === FIXED_DT; render(alpha, frameDt) gets the
// interpolation factor alpha in [0,1) between the previous and current simulation state.
import { FIXED_DT, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from './config.js';

export class GameLoop {
  constructor({ update, render, dt = FIXED_DT }) {
    this.update = update;
    this.render = render;
    this.dt = dt;
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.fps = 60;
    this.frameCount = 0;
    this.tickCount = 0;
    this._raf = 0;
    this._frame = this._frame.bind(this);
    document.addEventListener('visibilitychange', () => {
      // Avoid a giant catch-up step when the tab returns.
      this.last = performance.now();
      this.acc = 0;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);
    let frameDt = (now - this.last) / 1000;
    this.last = now;
    if (!(frameDt >= 0)) frameDt = 0;
    if (frameDt > MAX_FRAME_DT) frameDt = MAX_FRAME_DT;
    if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.05;

    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.dt && steps < MAX_STEPS_PER_FRAME) {
      this.update(this.dt);
      this.acc -= this.dt;
      this.tickCount++;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    this.frameCount++;
    this.render(this.acc / this.dt, frameDt);
  }
}
