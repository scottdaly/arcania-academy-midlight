// Input abstraction: named actions + a move vector, fed by keyboard and pluggable sources
// (touch controls, gamepad...). Sampled once per fixed tick by core (`input.update(dt)`),
// so pressed()/released() are exact per-tick edges and quick taps are never lost.
//
// Pointer data (mouse + touch) is exposed raw in VIRTUAL screen pixels for the UI team:
//   input.pointers       Map<id, Pointer>  currently down pointers
//   input.pointerEvents  PointerEvt[]      events that arrived since the previous tick
//   input.mouse          {x, y, inside, down, moved}  last known mouse position
// See ARCHITECTURE.md §5 for the InputSource contract.

/** All action names. */
export const ACTIONS = Object.freeze([
  'up', 'down', 'left', 'right',
  'spell1', 'spell2', 'spell3', 'spell4',
  'interact', 'confirm', 'cancel',
  'inventory', 'craft', 'pause',
]);

/** KeyboardEvent.code -> action(s). */
export const KEYMAP = Object.freeze({
  KeyW: ['up'], ArrowUp: ['up'],
  KeyS: ['down'], ArrowDown: ['down'],
  KeyA: ['left'], ArrowLeft: ['left'],
  KeyD: ['right'], ArrowRight: ['right'],
  Digit1: ['spell1'], Digit2: ['spell2'], Digit3: ['spell3'], Digit4: ['spell4'],
  Numpad1: ['spell1'], Numpad2: ['spell2'], Numpad3: ['spell3'], Numpad4: ['spell4'],
  KeyE: ['interact'],
  Space: ['interact', 'confirm'],
  Enter: ['confirm'], NumpadEnter: ['confirm'],
  Backspace: ['cancel'],
  KeyI: ['inventory'], Tab: ['inventory'],
  KeyC: ['craft'],
  Escape: ['pause', 'cancel'], KeyP: ['pause'],
});

export class Input {
  /** @param {import('./display.js').Display} display */
  constructor(display) {
    this.display = display;
    /** @type {Array<object>} pluggable InputSources */
    this.sources = [];
    /** 'keyboard' | 'mouse' | 'touch' | 'gamepad' - device used most recently. */
    this.lastDevice = 'keyboard';
    /** True if the device looks touch-first (coarse pointer). */
    this.isTouchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

    this._codesDown = new Set();
    this._tapLatch = new Set();
    this._down = Object.create(null);
    this._prev = Object.create(null);
    this._pressed = Object.create(null);
    this._released = Object.create(null);
    for (const a of ACTIONS) this._down[a] = this._prev[a] = this._pressed[a] = this._released[a] = false;

    /** Combined movement vector, magnitude <= 1. */
    this.move = { x: 0, y: 0 };

    this.pointers = new Map();
    this.pointerEvents = [];
    this._pointerQueue = [];
    /** Mouse in virtual screen px. `inside` = over the canvas; lastMoveTime = performance.now() ms. */
    this.mouse = { x: 0, y: 0, inside: false, down: false, moved: false, lastMoveTime: 0 };

    this._gestureFns = new Set();
    this._keyFns = new Set();
    this._bind();
  }

  // ------------------------------------------------------------------ public API

  /** Action held this tick. */
  down(action) {
    return !!this._down[action];
  }
  /** Action went down this tick (edge). */
  pressed(action) {
    return !!this._pressed[action];
  }
  /** Action went up this tick (edge). */
  released(action) {
    return !!this._released[action];
  }
  /** Swallow a press so later code in the same tick does not also react (UI uses this). */
  consume(action) {
    this._pressed[action] = false;
  }
  consumeAll() {
    for (const a of ACTIONS) this._pressed[a] = false;
  }

  /**
   * Register an InputSource. Returns a function that removes it.
   * Source shape: { id, poll?(input, dt), getMove?() -> {x,y}|null, isDown?(action) -> bool,
   *                 getAim?() -> {x,y}|null }
   */
  addSource(source) {
    this.sources.push(source);
    return () => this.removeSource(source);
  }
  removeSource(source) {
    const i = this.sources.indexOf(source);
    if (i >= 0) this.sources.splice(i, 1);
  }

  /** Aim direction from a source (e.g. touch aim stick), or null. Unit vector. */
  getAim() {
    for (const s of this.sources) {
      const a = s.getAim?.();
      if (a && (a.x || a.y)) return a;
    }
    return null;
  }

  /** fn() is called on every user gesture (key/pointer). Used by audio to unlock WebAudio. */
  onGesture(fn) {
    this._gestureFns.add(fn);
    return () => this._gestureFns.delete(fn);
  }

  /** Raw keydown hook fn(KeyboardEvent) for debug keys etc. */
  onKey(fn) {
    this._keyFns.add(fn);
    return () => this._keyFns.delete(fn);
  }

  /** Release everything (window blur, scene change). */
  reset() {
    this._codesDown.clear();
    this._tapLatch.clear();
    for (const a of ACTIONS) this._down[a] = this._prev[a] = this._pressed[a] = this._released[a] = false;
    this.move.x = this.move.y = 0;
  }

  /** Called by core exactly once at the start of every fixed tick. */
  update(dt) {
    this.pointerEvents = this._pointerQueue;
    this._pointerQueue = [];
    this.mouse.moved = false;
    for (const e of this.pointerEvents) if (e.pointerType === 'mouse' && e.type === 'move') this.mouse.moved = true;

    for (const s of this.sources) {
      try {
        s.poll?.(this, dt);
      } catch (err) {
        console.error(`[input] source "${s.id}" poll threw:`, err);
      }
    }

    const kbAction = Object.create(null);
    for (const code of this._codesDown) for (const a of KEYMAP[code] || []) kbAction[a] = true;

    for (const a of ACTIONS) {
      let cur = !!kbAction[a] || this._tapLatch.has(a);
      if (!cur) for (const s of this.sources) if (s.isDown?.(a)) { cur = true; break; }
      this._pressed[a] = cur && !this._prev[a];
      this._released[a] = !cur && this._prev[a];
      this._down[a] = cur;
      this._prev[a] = cur;
    }
    this._tapLatch.clear();

    // Movement: keyboard digital vector, overridden by the strongest analog source.
    let mx = (kbAction.right ? 1 : 0) - (kbAction.left ? 1 : 0);
    let my = (kbAction.down ? 1 : 0) - (kbAction.up ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    let best = mx * mx + my * my;
    for (const s of this.sources) {
      const m = s.getMove?.();
      if (!m) continue;
      const l2 = m.x * m.x + m.y * m.y;
      if (l2 > best) {
        best = l2;
        const l = Math.sqrt(l2);
        mx = l > 1 ? m.x / l : m.x;
        my = l > 1 ? m.y / l : m.y;
      }
    }
    this.move.x = mx;
    this.move.y = my;
  }

  // ------------------------------------------------------------------ DOM wiring

  _gesture() {
    for (const fn of this._gestureFns) {
      try { fn(); } catch (err) { console.error('[input] gesture fn threw:', err); }
    }
  }

  _bind() {
    const canvas = this.display.canvas;

    window.addEventListener('keydown', (e) => {
      for (const fn of this._keyFns) fn(e);
      const acts = KEYMAP[e.code];
      if (acts) {
        e.preventDefault();
        if (!e.repeat) for (const a of acts) this._tapLatch.add(a);
        this._codesDown.add(e.code);
      }
      this.lastDevice = 'keyboard';
      this._gesture();
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.code]) e.preventDefault();
      this._codesDown.delete(e.code);
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });

    const push = (type, e) => {
      const p = this.display.clientToVirtual(e.clientX, e.clientY);
      const evt = { type, id: e.pointerId, x: p.x, y: p.y, pointerType: e.pointerType || 'mouse', button: e.button };
      this._pointerQueue.push(evt);
      if (this._pointerQueue.length > 256) this._pointerQueue.shift();
      return evt;
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.focus?.({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const evt = push('down', e);
      this.pointers.set(e.pointerId, {
        id: e.pointerId, x: evt.x, y: evt.y, startX: evt.x, startY: evt.y,
        startTime: performance.now(), pointerType: evt.pointerType, claimedBy: null,
      });
      this.lastDevice = evt.pointerType === 'touch' || evt.pointerType === 'pen' ? 'touch' : 'mouse';
      if (evt.pointerType === 'mouse') this.mouse.down = true;
      this._gesture();
    }, { passive: false });

    canvas.addEventListener('pointermove', (e) => {
      const evt = push('move', e);
      const p = this.pointers.get(e.pointerId);
      if (p) { p.x = evt.x; p.y = evt.y; }
      if (evt.pointerType === 'mouse') {
        this.mouse.x = evt.x; this.mouse.y = evt.y; this.mouse.inside = true;
        this.mouse.lastMoveTime = performance.now();
        if (this.lastDevice !== 'keyboard') this.lastDevice = 'mouse';
      }
    });

    const end = (type) => (e) => {
      push(type, e);
      this.pointers.delete(e.pointerId);
      if ((e.pointerType || 'mouse') === 'mouse') this.mouse.down = false;
      this._gesture();
    };
    canvas.addEventListener('pointerup', end('up'));
    canvas.addEventListener('pointercancel', end('cancel'));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.mouse.inside = false; });

    // No context menu / long-press menu, no pinch, no double-tap zoom, no scroll.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  }
}
