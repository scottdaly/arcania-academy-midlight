// 2D camera. (x, y) is the world point at the CENTRE of the view, in world pixels.
// Render code calls camera.begin(alpha) once per frame (core does this), then
// camera.apply(ctx) to switch the context into world space. After begin(),
// `left`/`top` are the integer world coords of the view's top-left corner.
import { damp, lerp, clamp } from './math.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.prevX = 0;
    this.prevY = 0;
    this.viewW = 480;
    this.viewH = 270;
    /** Entity (anything with x,y) to follow, or null. */
    this.target = null;
    /** Follow responsiveness (1/s). Higher = snappier. */
    this.followRate = 10;
    /** Optional look-ahead offset applied to the follow point (world px). */
    this.offsetX = 0;
    this.offsetY = 0;
    /** World bounds {x, y, w, h} the view is clamped to, or null. */
    this.bounds = null;
    this._shakeMag = 0;
    this._shakeTime = 0;
    this._shakeDur = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    /** Render-time values, valid after begin(). */
    this.left = 0;
    this.top = 0;
  }

  setView(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  follow(target, snap = false) {
    this.target = target;
    if (snap && target) this.snapTo(target.x, target.y);
  }

  snapTo(x, y) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this._clamp();
    this.prevX = this.x;
    this.prevY = this.y;
  }

  setBounds(x, y, w, h) {
    this.bounds = { x, y, w, h };
  }

  clearBounds() {
    this.bounds = null;
  }

  /** Screen shake. Magnitude in virtual px; the strongest active shake wins. */
  shake(intensity = 3, duration = 0.25) {
    if (intensity >= this._shakeMag * (this._shakeTime / (this._shakeDur || 1))) {
      this._shakeMag = intensity;
      this._shakeDur = this._shakeTime = duration;
    }
  }

  /** Fixed-tick update (core calls this in gameplay scenes). */
  update(dt) {
    this.prevX = this.x;
    this.prevY = this.y;
    if (this.target) {
      this.x = damp(this.x, this.target.x + this.offsetX, this.followRate, dt);
      this.y = damp(this.y, this.target.y + this.offsetY, this.followRate, dt);
    }
    this._clamp();
    if (this._shakeTime > 0) this._shakeTime = Math.max(0, this._shakeTime - dt);
  }

  _clamp() {
    const b = this.bounds;
    if (!b) return;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    this.x = b.w <= this.viewW ? b.x + b.w / 2 : clamp(this.x, b.x + hw, b.x + b.w - hw);
    this.y = b.h <= this.viewH ? b.y + b.h / 2 : clamp(this.y, b.y + hh, b.y + b.h - hh);
  }

  /** Compute interpolated, shaken, pixel-snapped view for this render frame. */
  begin(alpha = 1) {
    const k = this._shakeDur > 0 ? this._shakeTime / this._shakeDur : 0;
    const m = this._shakeMag * k * k;
    this.shakeX = m ? (Math.random() * 2 - 1) * m : 0;
    this.shakeY = m ? (Math.random() * 2 - 1) * m : 0;
    const cx = lerp(this.prevX, this.x, alpha) + this.shakeX;
    const cy = lerp(this.prevY, this.y, alpha) + this.shakeY;
    this.left = Math.round(cx - this.viewW / 2);
    this.top = Math.round(cy - this.viewH / 2);
  }

  /** Translate ctx into world space. Use inside ctx.save()/restore(). */
  apply(ctx) {
    ctx.translate(-this.left, -this.top);
  }

  worldToScreen(wx, wy) {
    return { x: wx - this.left, y: wy - this.top };
  }

  screenToWorld(sx, sy) {
    return { x: sx + this.left, y: sy + this.top };
  }

  /** Is a world-space circle/point within the view (+margin)? */
  isVisible(x, y, margin = 32) {
    return x >= this.left - margin && x <= this.left + this.viewW + margin &&
      y >= this.top - margin && y <= this.top + this.viewH + margin;
  }
}
