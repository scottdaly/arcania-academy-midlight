// AUDIO sound-effect recipes + voice manager (team: ui+audio).
// Each recipe is { fn(v, opts), max, gap, pv, vv, send, duck, vol }:
//   max  = max concurrent voices of this sound (oldest is stolen)
//   gap  = minimum retrigger interval in seconds (per sound / throttle key)
//   pv   = random pitch variation (+- semitones), vv = random volume variation (+- fraction)
//   send = echo send level, duck = seconds to duck the music under it, vol = base gain
// `v` is a Voice: v.tone / v.noise / v.fm / v.bus build sources relative to the voice start time,
// with the per-call pitch multiplier applied to oscillator frequencies.
import { osc, noise, fm, bus, lfo, mtof, clamp } from './synth.js';

const N = mtof;
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

class Voice {
  constructor(E, t, pitch, vol, pan, send) {
    const { ctx } = E;
    this.E = E;
    this.t = t;
    this.p = pitch;
    this.end = t;
    this.srcs = [];
    this.out = ctx.createGain();
    this.out.gain.value = vol;
    let last = this.out;
    if (pan && E.hasPanner) {
      this.pan = ctx.createStereoPanner();
      this.pan.pan.value = pan;
      this.out.connect(this.pan);
      last = this.pan;
    }
    last.connect(E.sfxBus);
    if (send > 0) {
      this.send = ctx.createGain();
      this.send.gain.value = send;
      last.connect(this.send);
      this.send.connect(E.sfxSend);
    }
    this.live = 0;
    this.reg = (src, end) => {
      this.srcs.push(src);
      this.live++;
      if (end > this.end) this.end = end;
      const prev = src.onended;
      src.onended = (e) => {
        prev?.(e);
        if (--this.live === 0) this.dispose();
      };
    };
  }
  _o(o, extra) {
    return Object.assign({ out: this.out }, o, extra, { t: this.t + (o.at || 0) });
  }
  /** Oscillator; f0/f1 are scaled by the voice pitch. */
  tone(type, f0, f1, dur, o = {}) {
    return osc(this.E, this._o(o, { type, f: f0 * this.p, f1: f1 ? f1 * this.p : 0, dur, out: o.to || this.out }), this.reg);
  }
  /** Noise; filter cutoffs are scaled by the voice pitch. */
  noise(dur, o = {}) {
    return noise(this.E, this._o(o, { dur, fScale: this.p, out: o.to || this.out }), this.reg);
  }
  fm(f, ratio, index, dur, o = {}) {
    return fm(this.E, this._o(o, { f: f * this.p, f1: o.f1 ? o.f1 * this.p : 0, ratio, index, dur, out: o.to || this.out }), this.reg);
  }
  /** Processing bus (filter sweep / distortion shared by several sources). */
  bus(dur, o = {}) {
    return bus(this.E, this._o(o, { dur, out: o.to || this.out }), this.reg);
  }
  lfo(param, dur, rate, depth, o = {}) {
    return lfo(this.E, param, this.t + (o.at || 0), dur, rate, depth, o.type, o.rate1);
  }
  /** Quickly fade out and stop (voice stealing). */
  kill() {
    const now = this.E.ctx.currentTime;
    const g = this.out.gain;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.03);
    } catch { /* ignore */ }
    for (const s of this.srcs) {
      try { s.stop(now + 0.04); } catch { /* already stopped */ }
    }
    this.end = now + 0.04;
  }
  dispose() {
    for (const n of [this.out, this.pan, this.send]) {
      try { n?.disconnect(); } catch { /* ignore */ }
    }
  }
}

// --------------------------------------------------------------------------- shared bits

function chime(v, f, at, dur = 0.5, peak = 0.18) {
  v.fm(f, 3.5, 1.6, dur, { at, peak });
  v.tone('sine', f * 2, 0, dur * 0.6, { at, peak: peak * 0.35 });
}
function thump(v, f0, f1, dur, peak, at = 0, dist = 0) {
  v.tone('sine', f0, f1, dur, { at, peak, a: 0.002, glide: dur * 0.5, dist });
}
function gravel(v, count, span, peak, lo = 300, hi = 1400, at = 0) {
  for (let i = 0; i < count; i++) {
    const f = lo + Math.random() * (hi - lo);
    v.noise(0.03 + Math.random() * 0.05, { at: at + Math.random() * span, peak: peak * (0.5 + Math.random() * 0.5), color: 'pink', filter: { type: 'bandpass', f, q: 2.5 } });
  }
}
function swish(v, f0, f1, dur, peak, at = 0, q = 1.2) {
  v.noise(dur, { at, a: dur * 0.4, peak, color: 'pink', filter: { type: 'bandpass', f: f0, f1, q } });
}
function arp(v, notes, step, type = 'triangle', peak = 0.18, dur = 0.25, at = 0) {
  notes.forEach((m, i) => v.tone(type, N(m), 0, dur, { at: at + i * step, peak }));
}

// --------------------------------------------------------------------------- recipes

/** @type {Record<string, {fn: Function, max?: number, gap?: number, pv?: number, vv?: number, send?: number, duck?: number, vol?: number}>} */
export const SFX = {
  // ---------------- spells ----------------
  cast_fire: {
    send: 0.15,
    fn(v) {
      // whoosh: noise through a sweeping bandpass + a low thump + a little crackle
      v.noise(0.38, { a: 0.05, peak: 0.55, color: 'pink', filter: { type: 'bandpass', f: 380, f1: 2600, q: 1.1, t: 0.22 } });
      v.noise(0.22, { at: 0.04, a: 0.02, peak: 0.18, filter: { type: 'highpass', f: 3000 } });
      thump(v, 140, 48, 0.2, 0.4);
      v.tone('sawtooth', 160, 70, 0.22, { peak: 0.08, filter: { type: 'lowpass', f: 900 } });
    },
  },
  cast_ice: {
    send: 0.4,
    fn(v) {
      // crystalline chime: bright FM bells + shimmer
      v.fm(N(91), 3.51, 2.2, 0.55, { peak: 0.16 });
      v.fm(N(96), 2.76, 1.4, 0.5, { at: 0.035, peak: 0.12 });
      v.fm(N(98) * 1.004, 4.1, 1, 0.35, { at: 0.07, peak: 0.07 });
      v.noise(0.3, { a: 0.02, peak: 0.12, filter: { type: 'highpass', f: 7000 } });
      v.tone('triangle', 2400, 3600, 0.08, { peak: 0.06 });
    },
  },
  cast_lightning: {
    send: 0.12,
    fn(v) {
      // crackle: random square bursts + distorted noise + a falling zap
      for (let i = 0; i < 6; i++) {
        const f = 700 + Math.random() * 2200;
        v.tone('square', f, f * 0.6, 0.018, { at: i * 0.018 + Math.random() * 0.01, peak: 0.12 });
      }
      v.noise(0.16, { peak: 0.3, dist: 20, filter: { type: 'highpass', f: 1800 } });
      v.tone('sawtooth', 2400, 120, 0.14, { peak: 0.14, filter: { type: 'lowpass', f: 5000, f1: 800 } });
      thump(v, 200, 80, 0.07, 0.15);
    },
  },
  cast_arcane: {
    send: 0.4,
    fn(v) {
      // sparkly glissando
      const base = 76 + Math.floor(Math.random() * 3);
      [0, 4, 7, 11, 14, 19].forEach((s, i) => {
        v.tone('sine', N(base + s), 0, 0.22, { at: i * 0.03, peak: 0.12 });
        v.tone('triangle', N(base + s + 12), 0, 0.1, { at: i * 0.03, peak: 0.03 });
      });
      v.tone('sine', 300, 600, 0.2, { peak: 0.1, vib: { rate: 18, depth: 40 } });
    },
  },
  cast_earth: {
    send: 0.08,
    fn(v) {
      // low thud + gravel
      thump(v, 110, 38, 0.32, 0.6, 0, 3);
      v.noise(0.3, { a: 0.01, peak: 0.3, color: 'brown', filter: { type: 'lowpass', f: 900, f1: 250 } });
      gravel(v, 7, 0.22, 0.25);
    },
  },
  cast_swell: {
    // internal: tier-3 bass swell layered under big combo spells
    duck: 0.3,
    fn(v) {
      v.tone('sawtooth', N(31), N(36), 0.7, { a: 0.18, peak: 0.22, filter: { type: 'lowpass', f: 200, f1: 900, t: 0.35 } });
      v.tone('sawtooth', N(43) * 1.006, N(48), 0.7, { a: 0.18, peak: 0.12, filter: { type: 'lowpass', f: 300, f1: 1400, t: 0.35 } });
      thump(v, 70, 35, 0.6, 0.45, 0.04);
    },
  },

  // ---------------- impacts ----------------
  hit: {
    max: 5,
    fn(v) {
      v.noise(0.06, { peak: 0.35, filter: { type: 'bandpass', f: 1600, q: 1 } });
      v.tone('square', 230, 90, 0.07, { peak: 0.14, filter: { type: 'lowpass', f: 1800 } });
    },
  },
  hit_flesh: {
    max: 5,
    fn(v) {
      v.noise(0.09, { peak: 0.4, color: 'pink', filter: { type: 'lowpass', f: 1100, f1: 300 } });
      thump(v, 190, 70, 0.09, 0.35);
    },
  },
  hit_armor: {
    max: 4,
    send: 0.15,
    fn(v) {
      // metal clang: inharmonic FM partials + click
      v.fm(520, 1.41, 3.5, 0.38, { peak: 0.2 });
      v.fm(1270, 1.93, 1.5, 0.22, { peak: 0.1 });
      v.noise(0.03, { peak: 0.35, filter: { type: 'highpass', f: 2500 } });
      thump(v, 160, 90, 0.06, 0.2);
    },
  },
  hit_stone: {
    max: 4,
    fn(v) {
      v.noise(0.22, { peak: 0.45, color: 'brown', filter: { type: 'lowpass', f: 700, f1: 200 } });
      thump(v, 85, 40, 0.18, 0.45, 0, 2);
      gravel(v, 5, 0.12, 0.22, 400, 1800);
    },
  },
  hit_boss: {
    max: 4,
    fn(v) {
      thump(v, 95, 40, 0.22, 0.55, 0, 4);
      v.noise(0.12, { peak: 0.4, color: 'pink', filter: { type: 'bandpass', f: 900, f1: 300, q: 0.8 } });
      v.fm(220, 1.5, 2, 0.25, { peak: 0.1 });
    },
  },
  enemy_die: {
    max: 4,
    send: 0.25,
    fn(v) {
      v.tone('sawtooth', 420, 55, 0.35, { peak: 0.2, filter: { type: 'lowpass', f: 2200, f1: 300 } });
      v.noise(0.25, { a: 0.01, peak: 0.25, color: 'pink', filter: { type: 'lowpass', f: 2500, f1: 400 } });
      v.tone('sine', 1200, 2600, 0.3, { at: 0.06, peak: 0.07 });
    },
  },
  enemy_die_armor: {
    max: 3,
    send: 0.2,
    fn(v) {
      // armour clatter collapse
      thump(v, 140, 60, 0.15, 0.35);
      for (let i = 0; i < 6; i++) {
        const at = 0.04 + i * 0.07 + Math.random() * 0.05;
        v.fm(700 - i * 60 + Math.random() * 200, 1.41 + Math.random() * 0.3, 2.5, 0.18, { at, peak: 0.12 * (1 - i * 0.1) });
        v.noise(0.025, { at, peak: 0.15, filter: { type: 'highpass', f: 3000 } });
      }
      thump(v, 100, 45, 0.2, 0.35, 0.45);
    },
  },
  enemy_die_golem: {
    max: 2,
    duck: 0.4,
    fn(v) {
      // heavy rumble crumble
      v.noise(1.0, { a: 0.03, peak: 0.55, color: 'brown', dist: 3, filter: { type: 'lowpass', f: 600, f1: 110 } });
      thump(v, 70, 28, 0.8, 0.6, 0, 3);
      gravel(v, 14, 0.75, 0.25, 250, 1500, 0.05);
      thump(v, 60, 30, 0.4, 0.35, 0.5);
    },
  },
  player_hurt: {
    max: 2,
    gap: 0.08,
    fn(v) {
      v.tone('square', 320, 110, 0.16, { peak: 0.18, dist: 4, filter: { type: 'lowpass', f: 2200 } });
      v.noise(0.1, { peak: 0.3, color: 'pink', filter: { type: 'bandpass', f: 1200, q: 0.8 } });
      thump(v, 150, 60, 0.15, 0.35);
    },
  },
  player_die: {
    max: 1,
    send: 0.35,
    duck: 1.2,
    fn(v) {
      v.tone('sawtooth', 440, 55, 1.3, { a: 0.01, peak: 0.22, filter: { type: 'lowpass', f: 3000, f1: 200 }, vib: { rate: 6, depth: 30 } });
      v.tone('sawtooth', 446, 54, 1.3, { a: 0.01, peak: 0.15, filter: { type: 'lowpass', f: 2500, f1: 200 } });
      v.noise(1.0, { a: 0.3, peak: 0.2, color: 'pink', filter: { type: 'lowpass', f: 1500, f1: 200 } });
      thump(v, 90, 35, 0.5, 0.5);
    },
  },

  // ---------------- pickups ----------------
  pickup: {
    max: 3,
    send: 0.2,
    fn(v) {
      v.tone('sine', N(84), 0, 0.12, { peak: 0.18 });
      v.tone('sine', N(91), 0, 0.18, { at: 0.06, peak: 0.18 });
    },
  },
  pickup_fragment: {
    max: 4,
    gap: 0.03,
    pv: 0,
    send: 0.35,
    fn(v, o) {
      // pentatonic chime whose pitch climbs with quick successive pickups
      const step = o._step || 0;
      const f = N(76 + PENTA[Math.min(step, PENTA.length - 1)]);
      v.tone('triangle', f, 0, 0.3, { peak: 0.18 });
      v.tone('sine', f * 2, 0, 0.2, { peak: 0.07 });
      v.fm(f * 2, 3.5, 0.8, 0.25, { at: 0.03, peak: 0.05 });
    },
  },
  pickup_health: {
    max: 2,
    send: 0.25,
    fn(v) {
      v.tone('triangle', N(72), 0, 0.18, { peak: 0.2 });
      v.tone('triangle', N(79), 0, 0.3, { at: 0.08, peak: 0.2 });
      v.tone('sine', 300, 700, 0.12, { at: 0.02, peak: 0.08 });
    },
  },
  pickup_mana: {
    max: 2,
    send: 0.35,
    fn(v) {
      v.tone('sine', 660, 1320, 0.22, { peak: 0.18, vib: { rate: 14, depth: 25 } });
      v.fm(N(88), 3, 1.2, 0.35, { at: 0.08, peak: 0.1 });
    },
  },
  pickup_item: {
    vol: 2.0,
    max: 2,
    send: 0.25,
    fn(v) {
      arp(v, [72, 76, 79, 84], 0.055, 'square', 0.07, 0.15);
      v.tone('triangle', N(84), 0, 0.4, { at: 0.17, peak: 0.15 });
    },
  },

  // ---------------- crafting / progression ----------------
  craft: {
    vol: 1.4,
    max: 1,
    send: 0.35,
    duck: 1.0,
    fn(v) {
      // rising arpeggio + shimmer + boom + bright resolving chord
      arp(v, [60, 64, 67, 71, 72, 76, 79, 83, 84], 0.045, 'triangle', 0.13, 0.3);
      v.noise(0.5, { a: 0.4, peak: 0.12, filter: { type: 'highpass', f: 5000, f1: 9000 } });
      thump(v, 120, 38, 0.7, 0.6, 0.42, 2);
      v.noise(0.4, { at: 0.42, peak: 0.3, color: 'pink', filter: { type: 'lowpass', f: 3000, f1: 300 } });
      [72, 76, 79, 84].forEach((m) => v.fm(N(m), 2, 1.2, 1.1, { at: 0.42, peak: 0.07 }));
      chime(v, N(96), 0.5, 0.8, 0.08);
    },
  },
  craft_add: {
    max: 3,
    send: 0.25,
    pv: 0.1,
    fn(v) {
      v.tone('triangle', 660, 0, 0.16, { peak: 0.2 });
      v.tone('sine', 1320, 0, 0.1, { peak: 0.06 });
      v.noise(0.02, { peak: 0.12, filter: { type: 'highpass', f: 4000 } });
    },
  },
  craft_remove: {
    max: 3,
    fn(v) {
      v.tone('triangle', 620, 340, 0.12, { peak: 0.16 });
      v.noise(0.05, { peak: 0.08, filter: { type: 'bandpass', f: 1500, f1: 600 } });
    },
  },
  craft_charge: {
    vol: 1.8,
    max: 1,
    send: 0.2,
    fn(v) {
      // ~0.7 s rising build-up with accelerating tremolo
      const g = v.bus(0.75, { filter: { type: 'lowpass', f: 400, f1: 5000, q: 4, t: 0.7 } });
      v.tone('sawtooth', 180, 720, 0.75, { a: 0.6, peak: 0.12, to: g });
      v.tone('sawtooth', 181.5, 726, 0.75, { a: 0.6, peak: 0.1, to: g });
      v.tone('triangle', 360, 1440, 0.75, { a: 0.6, peak: 0.1, to: g });
      v.noise(0.75, { a: 0.65, peak: 0.12, filter: { type: 'highpass', f: 2000, f1: 8000 } });
      v.lfo(g.gain, 0.75, 6, 0.45, { rate1: 24 });
    },
  },
  learn: {
    vol: 1.4,
    max: 1,
    send: 0.4,
    fn(v) {
      arp(v, [72, 76, 79], 0.09, 'triangle', 0.17, 0.25);
      v.tone('triangle', N(84), 0, 0.6, { at: 0.27, peak: 0.2 });
      chime(v, N(91), 0.3, 0.6, 0.1);
      v.noise(0.4, { at: 0.25, a: 0.05, peak: 0.06, filter: { type: 'highpass', f: 7000 } });
    },
  },
  fail: {
    max: 2,
    gap: 0.1,
    fn(v) {
      v.tone('square', 196, 0, 0.12, { peak: 0.1, filter: { type: 'lowpass', f: 1200 } });
      v.tone('square', 175, 150, 0.2, { at: 0.11, peak: 0.1, filter: { type: 'lowpass', f: 1000 } });
    },
  },
  mana_empty: {
    max: 1,
    gap: 0.3,
    fn(v) {
      // dull fizzle
      v.noise(0.28, { peak: 0.2, color: 'pink', filter: { type: 'lowpass', f: 1400, f1: 200 } });
      v.tone('sine', 240, 110, 0.2, { peak: 0.12 });
    },
  },
  cooldown: {
    max: 1,
    gap: 0.22,
    fn(v) {
      v.tone('square', 330, 0, 0.025, { peak: 0.06, filter: { type: 'lowpass', f: 1500 } });
    },
  },
  heal: {
    max: 1,
    gap: 0.15,
    send: 0.35,
    fn(v) {
      v.tone('sine', N(72), N(84), 0.35, { a: 0.05, peak: 0.12 });
      arp(v, [79, 84, 88], 0.06, 'sine', 0.08, 0.3, 0.05);
      v.noise(0.3, { a: 0.1, peak: 0.05, filter: { type: 'highpass', f: 6000 } });
    },
  },
  potion: {
    max: 1,
    send: 0.15,
    fn(v) {
      // gulp-gulp-gulp + bubbles
      for (let i = 0; i < 3; i++) {
        v.tone('sine', 180 + i * 20, 420 + i * 40, 0.07, { at: i * 0.11, peak: 0.28, filter: { type: 'lowpass', f: 900 } });
      }
      for (let i = 0; i < 4; i++) v.tone('sine', 700 + Math.random() * 600, 1400 + Math.random() * 600, 0.04, { at: 0.36 + i * 0.05, peak: 0.06 });
    },
  },
  respawn: {
    vol: 2.5,
    max: 1,
    send: 0.4,
    fn(v) {
      v.noise(0.6, { a: 0.5, peak: 0.15, filter: { type: 'bandpass', f: 600, f1: 5000, q: 1.5 } });
      [60, 67, 72, 76].forEach((m) => v.tone('triangle', N(m), 0, 0.8, { a: 0.5, hold: 0.05, peak: 0.07 }));
      chime(v, N(88), 0.55, 0.8, 0.12);
    },
  },
  equip: {
    vol: 1.6,
    max: 1,
    gap: 0.08,
    send: 0.1,
    fn(v) {
      // cloth swish + metal clink
      swish(v, 1200, 3500, 0.12, 0.18);
      v.fm(2400, 2.76, 1.2, 0.18, { at: 0.08, peak: 0.1 });
      v.fm(3100, 1.41, 0.8, 0.12, { at: 0.12, peak: 0.06 });
    },
  },
  unequip: {
    vol: 1.7,
    max: 1,
    gap: 0.08,
    fn(v) {
      swish(v, 3000, 900, 0.12, 0.15);
      v.fm(1600, 2.76, 1, 0.1, { at: 0.06, peak: 0.07 });
    },
  },

  // ---------------- UI ----------------
  ui_move: { max: 2, gap: 0.03, pv: 0.1, fn(v) { v.tone('square', 880, 0, 0.025, { peak: 0.05, filter: { type: 'lowpass', f: 3000 } }); } },
  ui_hover: { max: 1, gap: 0.05, pv: 0.2, vol: 0.6, fn(v) { v.tone('sine', 1800, 0, 0.018, { peak: 0.04 }); } },
  ui_select: {
    max: 2,
    pv: 0.05,
    fn(v) {
      v.tone('square', 880, 0, 0.04, { peak: 0.06, filter: { type: 'lowpass', f: 3500 } });
      v.tone('square', 1320, 0, 0.06, { at: 0.04, peak: 0.06, filter: { type: 'lowpass', f: 3500 } });
    },
  },
  ui_back: {
    max: 2,
    pv: 0.05,
    fn(v) {
      v.tone('square', 660, 0, 0.04, { peak: 0.05, filter: { type: 'lowpass', f: 2500 } });
      v.tone('square', 440, 0, 0.06, { at: 0.04, peak: 0.05, filter: { type: 'lowpass', f: 2500 } });
    },
  },
  ui_open: {
    max: 1,
    pv: 0.1,
    fn(v) {
      v.tone('triangle', 420, 840, 0.09, { peak: 0.1 });
      swish(v, 800, 3000, 0.1, 0.08);
    },
  },
  ui_close: {
    max: 1,
    pv: 0.1,
    fn(v) {
      v.tone('triangle', 800, 400, 0.09, { peak: 0.09 });
      swish(v, 3000, 800, 0.1, 0.07);
    },
  },
  ui_error: {
    max: 1,
    gap: 0.12,
    pv: 0,
    fn(v) {
      v.tone('square', 150, 0, 0.07, { peak: 0.08, filter: { type: 'lowpass', f: 1200 } });
      v.tone('square', 150, 0, 0.09, { at: 0.09, peak: 0.08, filter: { type: 'lowpass', f: 1200 } });
    },
  },
  ui_tab: {
    max: 1,
    pv: 0.1,
    fn(v) {
      v.tone('triangle', 1000, 0, 0.035, { peak: 0.08 });
      v.noise(0.015, { peak: 0.05, filter: { type: 'highpass', f: 5000 } });
    },
  },
  ui_slider: { max: 2, gap: 0.03, pv: 0, fn(v) { v.tone('sine', 1200, 0, 0.02, { peak: 0.07 }); } },
  type: {
    max: 2,
    gap: 0.025,
    pv: 0.6,
    vv: 0.2,
    fn(v) { v.tone('square', 520, 0, 0.028, { peak: 0.035, filter: { type: 'lowpass', f: 2200 } }); },
  },
  dialogue_open: {
    max: 1,
    send: 0.2,
    fn(v) {
      v.tone('triangle', N(72), 0, 0.12, { peak: 0.1 });
      v.tone('triangle', N(79), 0, 0.2, { at: 0.07, peak: 0.1 });
      swish(v, 600, 1800, 0.12, 0.05);
    },
  },
  toast: {
    max: 1,
    gap: 0.15,
    send: 0.3,
    fn(v) {
      v.tone('sine', N(84), 0, 0.2, { peak: 0.08 });
      v.tone('sine', N(91), 0, 0.3, { at: 0.07, peak: 0.07 });
    },
  },
  banner: {
    max: 1,
    send: 0.4,
    duck: 0.6,
    fn(v) {
      // area-name reveal: swelling minor chord + timpani boom + bell
      [50, 57, 62, 65].forEach((m, i) =>
        v.tone('sawtooth', N(m) * (1 + (i % 2 ? 0.003 : -0.003)), 0, 1.1, { a: 0.25, hold: 0.2, peak: 0.07, filter: { type: 'lowpass', f: 300, f1: 2400, t: 0.4 } }));
      thump(v, 90, 45, 0.6, 0.45);
      v.noise(0.5, { a: 0.01, peak: 0.12, color: 'pink', filter: { type: 'lowpass', f: 1200, f1: 200 } });
      chime(v, N(86), 0.15, 0.9, 0.08);
    },
  },
  save: {
    vol: 1.2,
    max: 1,
    gap: 0.5,
    send: 0.3,
    fn(v) {
      v.tone('sine', N(79), 0, 0.2, { peak: 0.1 });
      v.tone('sine', N(86), 0, 0.3, { at: 0.08, peak: 0.1 });
    },
  },
  title_start: {
    vol: 1.4,
    max: 1,
    send: 0.4,
    duck: 0.6,
    fn(v) {
      v.noise(0.4, { a: 0.3, peak: 0.15, filter: { type: 'bandpass', f: 500, f1: 6000, q: 1.2 } });
      arp(v, [62, 69, 74, 77, 81, 86], 0.04, 'triangle', 0.12, 0.35);
      thump(v, 110, 40, 0.5, 0.45, 0.28);
      chime(v, N(93), 0.28, 0.8, 0.1);
    },
  },
  door: {
    max: 1,
    gap: 0.4,
    send: 0.25,
    fn(v) {
      swish(v, 300, 1500, 0.35, 0.2, 0, 0.8);
      v.tone('triangle', 110, 165, 0.4, { a: 0.08, peak: 0.12 });
      v.tone('sine', 220, 330, 0.3, { at: 0.1, a: 0.1, peak: 0.06, vib: { rate: 7, depth: 20 } });
      v.noise(0.03, { at: 0.36, peak: 0.12, filter: { type: 'bandpass', f: 2500, q: 2 } });
    },
  },
  clear: {
    vol: 2.0,
    max: 1,
    send: 0.35,
    duck: 0.8,
    fn(v) {
      arp(v, [67, 72, 76], 0.1, 'square', 0.07, 0.2);
      [72, 76, 79, 84].forEach((m) => v.tone('triangle', N(m), 0, 0.8, { at: 0.3, peak: 0.08 }));
      chime(v, N(96), 0.3, 0.7, 0.07);
    },
  },
  footstep: {
    max: 2,
    gap: 0.12,
    pv: 2,
    vv: 0.3,
    vol: 1.2,
    fn(v) { v.noise(0.035, { peak: 0.08, color: 'pink', filter: { type: 'lowpass', f: 700 } }); },
  },
  dash: {
    vol: 1.4,
    max: 1,
    gap: 0.1,
    fn(v) {
      v.noise(0.17, { a: 0.02, peak: 0.3, color: 'pink', filter: { type: 'bandpass', f: 2400, f1: 500, q: 1.4 } });
      v.tone('sine', 320, 140, 0.12, { peak: 0.1 });
    },
  },

  // ---------------- boss & endings ----------------
  boss_roar: {
    max: 1,
    gap: 0.4,
    send: 0.3,
    duck: 1.5,
    fn(v) {
      // big distorted roar: detuned saws + noise + pitch dive, with a growl tremolo
      const g = v.bus(1.6, { dist: 12, filter: { type: 'lowpass', f: 2200, f1: 280, q: 2, t: 1.5 }, gain: 0.6 });
      for (const d of [0.985, 1, 1.013, 0.5]) v.tone('sawtooth', 120 * d, 38 * d, 1.6, { a: 0.08, peak: 0.25, glide: 1.4, to: g });
      v.noise(1.4, { a: 0.1, peak: 0.45, color: 'pink', filter: { type: 'bandpass', f: 700, f1: 250, q: 1.2 }, to: g });
      v.lfo(g.gain, 1.6, 28, 0.25, { rate1: 12 });
      thump(v, 70, 30, 0.9, 0.45);
    },
  },
  boss_phase: {
    max: 1,
    gap: 0.4,
    send: 0.3,
    duck: 1.0,
    fn(v) {
      thump(v, 65, 28, 0.9, 0.65, 0, 4);
      v.noise(0.9, { peak: 0.3, color: 'white', filter: { type: 'lowpass', f: 6000, f1: 400 } });
      // dissonant tritone stab
      for (const m of [38, 44, 50]) v.tone('sawtooth', N(m), N(m) * 0.94, 0.8, { a: 0.01, peak: 0.08, dist: 3, filter: { type: 'lowpass', f: 2500, f1: 300 } });
    },
  },
  boss_die: {
    max: 1,
    send: 0.45,
    duck: 2.5,
    fn(v) {
      thump(v, 90, 25, 1.4, 0.7, 0, 4);
      v.noise(2.2, { a: 0.02, peak: 0.45, color: 'pink', filter: { type: 'lowpass', f: 5000, f1: 120 } });
      for (const d of [1, 1.01, 0.5]) v.tone('sawtooth', 300 * d, 30 * d, 2.0, { peak: 0.12, filter: { type: 'lowpass', f: 2000, f1: 150 } });
      // released magic rising out of the wreck
      [72, 76, 79, 83, 86, 91, 95].forEach((m, i) => chime(v, N(m), 0.5 + i * 0.12, 1.0, 0.07));
    },
  },
  gameover: {
    vol: 1.4,
    max: 1,
    send: 0.4,
    duck: 2.0,
    fn(v) {
      // sad descending motif over a low minor drone
      [[69, 0], [67, 0.32], [64, 0.64], [60, 0.96]].forEach(([m, at], i) =>
        v.tone('triangle', N(m), 0, i === 3 ? 1.4 : 0.4, { at, a: 0.02, peak: 0.16, vib: { rate: 5, depth: 8 } }));
      v.tone('sawtooth', N(45), 0, 2.2, { a: 0.3, hold: 0.8, peak: 0.08, filter: { type: 'lowpass', f: 500 } });
      v.tone('sawtooth', N(52) * 1.004, 0, 2.2, { a: 0.3, hold: 0.8, peak: 0.05, filter: { type: 'lowpass', f: 500 } });
    },
  },
  victory: {
    vol: 1.8,
    max: 1,
    send: 0.4,
    duck: 2.0,
    fn(v) {
      // short triumphant brass sting
      const brass = (m, at, dur, peak = 0.08) => {
        for (const d of [-6, 6]) v.tone('sawtooth', N(m), 0, dur, { at, a: 0.02, hold: dur * 0.5, peak, detune: d, filter: { type: 'lowpass', f: 900, f1: 2600, t: 0.08 } });
      };
      brass(67, 0, 0.14);
      brass(67, 0.15, 0.14);
      brass(67, 0.3, 0.14);
      brass(72, 0.45, 1.2, 0.1);
      brass(76, 0.45, 1.2, 0.06);
      brass(79, 0.45, 1.2, 0.06);
      thump(v, 100, 45, 0.6, 0.45, 0.45);
      chime(v, N(96), 0.5, 1.0, 0.07);
    },
  },
};

// --------------------------------------------------------------------------- voice manager

/**
 * Creates the sfx player bound to an engine. `play(name, opts)` returns true if a voice started.
 * opts: {volume, pitch, pan, delay, key (throttle bucket), exact (no random variation)}
 */
export function createSfxPlayer(E) {
  const active = new Map(); // key -> Voice[]
  const lastAt = new Map(); // key -> ctx time
  let all = [];
  const frag = { t: -10, step: 0 };
  const MAX_TOTAL = 36;

  function prune(list, now) {
    let w = 0;
    for (let i = 0; i < list.length; i++) if (list[i].end > now) list[w++] = list[i];
    list.length = w;
  }

  return function play(name, opts = {}) {
    const rec = SFX[name];
    if (!rec) return false;
    const now = E.ctx.currentTime;
    const key = opts.key || name;
    const gap = rec.gap ?? 0.035;
    if (now - (lastAt.get(key) ?? -1) < gap) return false;
    lastAt.set(key, now);

    let list = active.get(key);
    if (!list) active.set(key, (list = []));
    prune(list, now);
    const max = rec.max ?? 4;
    while (list.length >= max) list.shift().kill();
    prune(all, now);
    if (all.length >= MAX_TOTAL) all.shift().kill();

    const exact = !!opts.exact;
    const pv = exact ? 0 : rec.pv ?? 0.4;
    const vv = exact ? 0 : rec.vv ?? 0.1;
    const pitch = clamp((opts.pitch ?? 1) * Math.pow(2, ((Math.random() * 2 - 1) * pv) / 12), 0.1, 8);
    const vol = clamp((opts.volume ?? 1) * (rec.vol ?? 1) * (1 + (Math.random() * 2 - 1) * vv), 0, 3);
    if (vol <= 0.001) return false;

    const fo = {};
    if (name === 'pickup_fragment') {
      frag.step = now - frag.t < 0.9 ? frag.step + 1 : 0;
      frag.t = now;
      fo._step = frag.step;
    }

    const t = now + 0.005 + Math.max(0, opts.delay || 0);
    const v = new Voice(E, t, pitch, vol, opts.pan || 0, rec.send || 0);
    rec.fn(v, fo);
    if (v.live === 0) {
      v.dispose();
      return false;
    }
    list.push(v);
    all.push(v);
    if (rec.duck) E.duck(rec.duck);
    return true;
  };
}
