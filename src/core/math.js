// Small math helpers shared by everyone. Pure functions, no state.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export const dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const len = (x, y) => Math.sqrt(x * x + y * y);

/** Returns a unit vector {x, y}; zero vector stays zero. */
export function normalize(x, y) {
  const l = Math.sqrt(x * x + y * y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

/** Move `cur` toward `target` by at most `step`. */
export function approach(cur, target, step) {
  return cur < target ? Math.min(cur + step, target) : Math.max(cur - step, target);
}

/** Frame-rate independent exponential smoothing. `rate` ~ 1/seconds-to-converge. */
export function damp(cur, target, rate, dt) {
  return lerp(cur, target, 1 - Math.exp(-rate * dt));
}

/** Wrap angle to [-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export const fromAngle = (a, l = 1) => ({ x: Math.cos(a) * l, y: Math.sin(a) * l });

/** Ease helpers (t in 0..1). */
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t) => t * t;
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
