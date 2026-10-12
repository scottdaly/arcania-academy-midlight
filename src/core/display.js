// Low-res pixel-art render target, integer-scaled to fill the screen.
//
// Everything is drawn into `display.ctx` (the virtual buffer, width x height virtual pixels,
// imageSmoothingEnabled = false). The buffer IS the on-screen canvas: its backing store has the
// virtual size and CSS (image-rendering: pixelated) scales it by an integer number of device
// pixels, so the upscale is done by the browser compositor instead of a per-frame full-screen
// drawImage into a device-resolution backbuffer (2532x1170 at DPR 3). The virtual size adapts to the screen's aspect ratio:
// the short side is ~TARGET_SHORT_SIDE px (e.g. 480x270 on 1080p, ~633x292 on a landscape phone,
// ~292x633 portrait). The buffer may overhang the screen by < `scale` device pixels on the
// right/bottom edge; keep important UI a few px away from the edges (use `display.safe`).
import { TARGET_SHORT_SIDE, MIN_SHORT_SIDE, MAX_LONG_SIDE } from './config.js';

export class Display {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    /** The on-screen canvas doubles as the virtual buffer (see header). */
    this.buffer = canvas;
    /** The virtual low-res context everyone draws into. */
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.screenCtx = this.ctx;
    canvas.style.imageRendering = 'pixelated';
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
    this.width = Math.ceil(devW / scale);
    this.height = Math.ceil(devH / scale);
    // backing store = virtual size; CSS size = virtual * scale device px (may overhang by < scale px)
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = (this.width * scale) / dpr + 'px';
    this.canvas.style.height = (this.height * scale) / dpr + 'px';
    this.orientation = this.width >= this.height ? 'landscape' : 'portrait';
    // Context state resets when a canvas is resized.
    this.ctx.imageSmoothingEnabled = false;

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

  /** End of frame. Called once per frame by core. Nothing to copy: the browser scales the canvas. */
  present() {}

  /** Convert a DOM clientX/clientY to virtual pixel coordinates. */
  clientToVirtual(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.dpr / this.scale;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  }
}
