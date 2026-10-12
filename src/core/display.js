// Low-res pixel-art render target, integer-scaled to fill the screen.
//
// Everything is drawn into `display.ctx` (the virtual buffer, width x height virtual pixels,
// imageSmoothingEnabled = false). At the end of each frame `present()` blits the buffer to the
// real canvas with an integer scale factor. The virtual size adapts to the screen's aspect ratio:
// the short side is ~TARGET_SHORT_SIDE px (e.g. 480x270 on 1080p, ~633x292 on a landscape phone,
// ~292x633 portrait). The buffer may overhang the screen by < `scale` device pixels on the
// right/bottom edge; keep important UI a few px away from the edges (use `display.safe`).
import { TARGET_SHORT_SIDE, MIN_SHORT_SIDE, MAX_LONG_SIDE } from './config.js';

export class Display {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.screenCtx = canvas.getContext('2d', { alpha: false });
    this.buffer = document.createElement('canvas');
    /** The virtual low-res context everyone draws into. */
    this.ctx = this.buffer.getContext('2d');
    /** Virtual size in pixels. */
    this.width = 480;
    this.height = 270;
    /** Integer device-pixels per virtual pixel. */
    this.scale = 1;
    this.dpr = 1;
    /** Safe-area insets in VIRTUAL pixels (notches, home indicator). */
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.orientation = 'landscape';
    this._listeners = new Set();
    this._probe = document.getElementById('safe-probe');

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => setTimeout(this.resize, 100));
    window.visualViewport?.addEventListener('resize', this.resize);
    this.resize();
  }

  /** Register fn(display) to be called after every resize. Returns unsubscribe. */
  onResize(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const devW = Math.round(cssW * dpr);
    const devH = Math.round(cssH * dpr);
    const short = Math.min(devW, devH);
    const long = Math.max(devW, devH);

    let scale = Math.max(1, Math.round(short / TARGET_SHORT_SIDE));
    while (scale > 1 && short / scale < MIN_SHORT_SIDE) scale--;
    while (long / scale > MAX_LONG_SIDE) scale++;

    this.dpr = dpr;
    this.scale = scale;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.canvas.width = devW;
    this.canvas.height = devH;
    this.width = Math.ceil(devW / scale);
    this.height = Math.ceil(devH / scale);
    this.buffer.width = this.width;
    this.buffer.height = this.height;
    this.orientation = this.width >= this.height ? 'landscape' : 'portrait';
    // Context state resets when a canvas is resized.
    this.ctx.imageSmoothingEnabled = false;
    this.screenCtx.imageSmoothingEnabled = false;

    if (this._probe) {
      const cs = getComputedStyle(this._probe);
      const k = dpr / scale;
      this.safe = {
        top: Math.ceil(parseFloat(cs.paddingTop || '0') * k),
        right: Math.ceil(parseFloat(cs.paddingRight || '0') * k),
        bottom: Math.ceil(parseFloat(cs.paddingBottom || '0') * k),
        left: Math.ceil(parseFloat(cs.paddingLeft || '0') * k),
      };
    }
    for (const fn of this._listeners) {
      try {
        fn(this);
      } catch (err) {
        console.error('[display] resize listener threw:', err);
      }
    }
  }

  /** Blit the virtual buffer to the screen. Called once per frame by core. */
  present() {
    const c = this.screenCtx;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.buffer, 0, 0, this.width * this.scale, this.height * this.scale);
  }

  /** Convert a DOM clientX/clientY to virtual pixel coordinates. */
  clientToVirtual(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.dpr / this.scale;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  }
}
