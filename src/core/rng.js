// Seeded deterministic RNG (mulberry32). Use for ALL gameplay/procedural randomness so
// dungeons are reproducible from a seed. Math.random is fine for purely cosmetic jitter
// (particles, camera shake).

/** FNV-1a 32-bit string hash. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  /** @param {number|string} seed */
  constructor(seed = (Date.now() ^ 0x5bd1e995) >>> 0) {
    this.seed = (typeof seed === 'string' ? hashString(seed) : Number(seed)) >>> 0;
    this.s = this.seed || 0x9e3779b9;
  }

  /** Float in [0, 1). */
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  angle() {
    return this.next() * Math.PI * 2;
  }

  pick(arr) {
    return arr.length ? arr[Math.floor(this.next() * arr.length)] : undefined;
  }

  /** In-place Fisher-Yates; returns arr. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Weighted pick. `entries` is an array of {weight, ...} objects (returns the entry),
   * or pass a weightFn: weighted(items, it => it.w).
   */
  weighted(entries, weightFn = (e) => e.weight) {
    let total = 0;
    for (const e of entries) total += Math.max(0, weightFn(e));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const e of entries) {
      r -= Math.max(0, weightFn(e));
      if (r < 0) return e;
    }
    return entries[entries.length - 1];
  }

  /** Roughly normal distribution (mean 0, sd ~1). */
  gaussian() {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }

  /** Independent child stream derived from this seed + label (does not advance this RNG). */
  fork(label) {
    return new RNG(hashString(`${this.seed}:${label}`));
  }

  getState() {
    return this.s;
  }

  setState(s) {
    this.s = s >>> 0;
  }
}
