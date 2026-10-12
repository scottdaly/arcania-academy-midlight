// AUDIO procedural music (team: ui+audio).
// A tiny look-ahead step sequencer: each track is a 16th-note step function that schedules notes
// slightly ahead of ctx.currentTime (driven from audio.update(dt)). Every track renders into its
// own fade gain so switching tracks crossfades (~1.5 s). Variation is re-rolled each loop with a
// small PRNG so the pieces stay musical but never repeat exactly.
import { osc, noise, fm, mtof, rng } from './synth.js';

const LOOKAHEAD = 0.2; // s scheduled ahead of currentTime
const CROSSFADE = 1.5;

// ------------------------------------------------------------------ harmony helpers

const SC = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harm: [0, 2, 3, 5, 7, 8, 11],
};
/** MIDI note of scale degree d (may be negative / > 6) above root. */
const deg = (sc, root, d) => root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
/** Stacked-thirds chord of n notes on degree d. */
const chord = (sc, root, d, n = 3) => Array.from({ length: n }, (_, i) => deg(sc, root, d + 2 * i));

/** A one-bar melodic motif: [{pos, d (scale steps above chord root), len (steps)}]. */
function genMotif(r) {
  const rhythms = [
    [0, 3, 6, 8, 10, 12],
    [0, 2, 4, 6, 8, 11, 14],
    [0, 4, 6, 8, 12],
    [0, 3, 4, 7, 8, 12, 14],
    [0, 6, 8, 10, 12, 14],
  ];
  const pos = r.pick(rhythms);
  let d = r.pick([0, 2, 4, 7]);
  return pos.map((p, i) => {
    if (i > 0) d += r.pick([-2, -1, -1, 1, 1, 2, 3]);
    if (p === 0 || p === 8) d = Math.round(d / 2) * 2; // strong beats land on chord tones
    d = Math.max(-2, Math.min(9, d));
    const next = pos[i + 1] ?? 16;
    return { pos: p, d, len: next - p };
  });
}

// ------------------------------------------------------------------ instrument kit

function makeKit(E, out) {
  const f = mtof;
  return {
    pad(t, ms, dur, o = {}) {
      const a = o.a ?? 0.6, rel = o.rel ?? 0.8;
      for (const m of ms) {
        for (const d of o.det ?? [-7, 7]) {
          osc(E, {
            t, type: o.type || 'sawtooth', f: f(m), detune: d, dur, a, hold: Math.max(0, dur - a - rel), peak: o.peak ?? 0.03,
            filter: { type: 'lowpass', f: o.cutoff ?? 900, f1: o.cutoff1, q: 0.7 }, out,
          });
        }
      }
    },
    pluck(t, m, o = {}) {
      const c = o.cutoff ?? 2500;
      osc(E, { t, type: o.type || 'triangle', f: f(m), dur: o.dur ?? 0.35, a: 0.004, peak: o.peak ?? 0.08, filter: { type: 'lowpass', f: c, f1: c * 0.3 }, out, vib: o.vib });
      if (o.oct) osc(E, { t, type: 'sine', f: f(m + 12), dur: (o.dur ?? 0.35) * 0.6, a: 0.004, peak: (o.peak ?? 0.08) * o.oct, out });
    },
    bass(t, m, dur, o = {}) {
      const c = o.cutoff ?? 700;
      osc(E, { t, type: o.type || 'sawtooth', f: f(m), dur, a: 0.006, hold: dur * 0.4, peak: o.peak ?? 0.1, filter: { type: 'lowpass', f: c, f1: c * 0.45, q: o.q ?? 1 }, out });
      if (o.sub) osc(E, { t, type: 'sine', f: f(m - 12), dur, a: 0.006, hold: dur * 0.5, peak: o.sub, out });
    },
    bell(t, m, o = {}) {
      fm(E, { t, f: f(m), ratio: o.ratio ?? 3.5, index: o.index ?? 1.2, dur: o.dur ?? 0.8, peak: o.peak ?? 0.04, out });
    },
    lead(t, m, dur, o = {}) {
      osc(E, { t, type: o.type || 'sawtooth', f: f(m), dur, a: 0.02, hold: dur * 0.6, peak: o.peak ?? 0.03, filter: { type: 'lowpass', f: o.cutoff ?? 2200, q: 1 }, vib: { rate: 5.5, depth: 12 }, out });
    },
    brass(t, ms, dur, o = {}) {
      for (const m of ms) {
        for (const d of [-9, 9]) {
          osc(E, { t, type: 'sawtooth', f: f(m), detune: d, dur, a: 0.015, hold: dur * 0.55, peak: o.peak ?? 0.03, filter: { type: 'lowpass', f: 600, f1: o.bright ?? 2400, t: 0.06, q: 1.2 }, out });
        }
      }
    },
    stab(t, ms, dur, o = {}) {
      for (const m of ms) osc(E, { t, type: 'sawtooth', f: f(m), dur, a: 0.004, peak: o.peak ?? 0.03, dist: 2, filter: { type: 'lowpass', f: 2600, f1: 350 }, out });
    },
    drone(t, m, dur, o = {}) {
      for (const d of [-5, 5]) {
        osc(E, { t, type: o.type || 'sawtooth', f: f(m), detune: d, dur, a: dur * 0.3, hold: dur * 0.35, peak: o.peak ?? 0.05, filter: { type: 'lowpass', f: o.cutoff ?? 260, q: 2 }, out });
      }
    },
    kick(t, peak = 0.35) {
      osc(E, { t, type: 'sine', f: 150, f1: 42, glide: 0.09, dur: 0.32, a: 0.002, peak, out });
      noise(E, { t, dur: 0.015, peak: peak * 0.25, filter: { type: 'lowpass', f: 3000 }, out });
    },
    tom(t, m, peak = 0.2) {
      osc(E, { t, type: 'sine', f: f(m) * 1.6, f1: f(m), glide: 0.06, dur: 0.35, a: 0.002, peak, out });
    },
    snare(t, peak = 0.1) {
      noise(E, { t, dur: 0.16, peak, filter: { type: 'bandpass', f: 1900, q: 0.7 }, out });
      osc(E, { t, type: 'triangle', f: 200, f1: 160, dur: 0.08, a: 0.002, peak: peak * 0.6, out });
    },
    hat(t, peak = 0.02, open = false) {
      noise(E, { t, dur: open ? 0.2 : 0.04, peak, filter: { type: 'highpass', f: 7000 }, out });
    },
    crash(t, peak = 0.05) {
      noise(E, { t, dur: 1.4, peak, filter: { type: 'highpass', f: 3500 }, out });
    },
  };
}

// ------------------------------------------------------------------ tracks
// step(k, t, pos, bar, st, spb): pos = 16th within bar (0..15), bar counts from 0, st = per-play state
// (st.r is a PRNG), spb = seconds per 16th.

const TRACKS = {
  // Mystical, slow, sparkling arps over pads (D dorian).
  title: {
    bpm: 80, echo: 0.35, vol: 0.9,
    step(k, t, pos, bar, st, spb) {
      const sc = SC.dorian, root = 50, lb = bar % 4;
      if (pos === 0 && lb === 0) {
        st.prog = st.r.pick([[0, 3, 6, 0], [0, 4, 3, 6], [0, 5, 3, 4], [0, 2, 3, 4]]);
        st.shape = st.r.pick([[0, 1, 2, 3, 4, 5, 6, 7], [0, 2, 4, 6, 7, 5, 3, 1], [0, 1, 2, 4, 3, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1, 0]]);
      }
      const d = st.prog[lb];
      const ch = chord(sc, root, d, 4);
      if (pos === 0) {
        k.pad(t, ch.slice(0, 3), 16 * spb + 0.6, { peak: 0.028, cutoff: 650, cutoff1: 1100, a: 1.0, rel: 1.2 });
        k.bass(t, deg(sc, root - 12, d), 16 * spb, { type: 'sine', peak: 0.12, cutoff: 400 });
      }
      const tones = [...ch.map((m) => m + 12), ...ch.map((m) => m + 24)];
      if (pos % 2 === 0 || st.r.chance(0.35)) {
        const n = tones[st.shape[(pos >> 1) % 8] % tones.length];
        if (st.r.chance(0.85)) k.bell(t, n, { ratio: 2, index: 0.7, dur: 0.9, peak: pos % 4 === 0 ? 0.04 : 0.025 });
      }
      if (pos === 10 && st.r.chance(0.3)) k.bell(t, deg(sc, root + 36, st.r.int(0, 6)), { ratio: 3.5, index: 1.4, dur: 1.6, peak: 0.022 });
    },
  },

  // Calm, warm academy theme (F lydian): plucked melody, soft pad, light shaker.
  hub: {
    bpm: 90, echo: 0.22, vol: 0.85,
    step(k, t, pos, bar, st, spb) {
      const sc = SC.lydian, root = 53, lb = bar % 4;
      if (pos === 0 && lb === 0) {
        st.prog = st.r.pick([[0, 1, 4, 0], [0, 1, 2, 4], [5, 1, 0, 4], [0, 2, 5, 1], [0, 4, 5, 1]]);
        st.motif = genMotif(st.r);
        st.motif2 = genMotif(st.r);
      }
      const sw = pos % 2 ? spb * 0.14 : 0; // gentle swing
      const tt = t + sw;
      const d = st.prog[lb];
      if (pos === 0) k.pad(t, chord(sc, root, d, 3), 16 * spb + 0.4, { type: 'triangle', det: [0], peak: 0.05, cutoff: 1600, a: 0.4, rel: 0.6 });
      if (pos === 0) k.pluck(t, deg(sc, root - 12, d), { dur: 0.6, peak: 0.14, cutoff: 900 });
      if (pos === 8) k.pluck(t, deg(sc, root - 12, d + 4), { dur: 0.45, peak: 0.1, cutoff: 900 });
      if (pos === 14 && st.r.chance(0.4)) k.pluck(tt, deg(sc, root - 12, d + 2), { dur: 0.25, peak: 0.07, cutoff: 900 });
      const motif = lb === 3 ? st.motif2 : st.motif;
      for (const n of motif) {
        if (n.pos === pos) k.pluck(tt, deg(sc, root + 12, d + n.d), { type: 'triangle', dur: Math.min(0.9, n.len * spb + 0.15), peak: 0.07, cutoff: 3200, oct: 0.25 });
      }
      if (pos % 4 === 2) k.hat(tt, 0.012);
      if (pos === 0) k.kick(t, 0.12);
    },
  },

  // Tense, dark (E phrygian): low drones, sparse percussion, dissonant stabs.
  dungeon: {
    bpm: 100, echo: 0.3, vol: 0.9,
    step(k, t, pos, bar, st, spb) {
      const sc = SC.phrygian, root = 40, lb = bar % 4;
      if (pos === 0 && lb === 0) {
        st.stabBar = st.r.int(0, 3);
        st.stabPos = st.r.pick([3, 6, 11, 13]);
        st.kick2 = st.r.pick([6, 10, 11]);
        st.riff = st.r.pick([[1, 0], [3, 1], [-2, 0], [1, -1]]);
      }
      if (pos === 0 && lb % 2 === 0) {
        k.drone(t, 28, 32 * spb + 0.8, { peak: 0.09, cutoff: 200 });
        k.drone(t, 35, 32 * spb + 0.8, { peak: 0.035, cutoff: 300, type: 'triangle' });
      }
      if (pos === 0) k.tom(t, 33, 0.28);
      if (pos === st.kick2 && st.r.chance(0.6)) k.tom(t, 33, 0.16);
      if (pos % 4 === 2 && st.r.chance(0.55)) k.hat(t, 0.016);
      if (pos % 2 === 1 && st.r.chance(0.12)) k.hat(t, 0.008);
      if (lb === st.stabBar && pos === st.stabPos) k.stab(t, [52, 53, 58], 0.5, { peak: 0.035 });
      if (pos === 8 && lb % 2 === 1) k.bass(t, deg(sc, root, st.riff[lb >> 1]), 6 * spb, { peak: 0.09, cutoff: 500, sub: 0.05 });
      if (pos === 4 && lb === 2 && st.r.chance(0.45)) {
        k.bell(t, 88, { ratio: 1.41, index: 2.5, dur: 1.2, peak: 0.018 });
        k.bell(t + spb * 2, 89, { ratio: 1.41, index: 2.5, dur: 1.2, peak: 0.014 });
      }
    },
  },

  // Mysterious ascending harmonic-minor arps that build layer by layer (A harmonic minor).
  tower: {
    bpm: 110, echo: 0.25, vol: 1.2,
    step(k, t, pos, bar, st, spb) {
      const sc = SC.harm, root = 45, lb = bar % 4;
      if (pos === 0 && lb === 0) {
        st.loop = (st.loop ?? -1) + 1;
        st.int = [0, 1, 2, 3, 3, 1, 2, 3][st.loop % 8];
        st.prog = st.r.pick([[0, 5, 3, 4], [0, 3, 5, 4], [0, 5, 1, 4]]);
        st.lead = Array.from({ length: 16 }, () => st.r.pick([0, 2, 4, 7, 9]));
      }
      const d = st.prog[lb];
      const ch = chord(sc, root, d, 3);
      if (pos === 0) k.pad(t, ch.map((m) => m + 12), 16 * spb + 0.3, { peak: 0.03, cutoff: 600 + lb * 250, a: 0.5 });
      const tones = [...ch.map((m) => m + 12), ...ch.map((m) => m + 24), ch[0] + 36];
      const up = pos < 7 ? pos : pos < 14 ? 13 - pos : pos - 14; // up, down, up
      k.pluck(t, tones[up % tones.length], { type: 'square', dur: 0.18, peak: pos % 4 === 0 ? 0.05 : 0.038, cutoff: 900 + lb * 450 + st.int * 450 });
      if (st.int >= 1 && pos % 2 === 0) k.bass(t, deg(sc, root - 12, d) + (pos % 4 === 2 ? 12 : 0), spb * 1.6, { peak: 0.08, cutoff: 500 });
      if (st.int >= 2) {
        k.hat(t, pos % 2 ? 0.008 : 0.016);
        if (pos === 0 || pos === 8) k.kick(t, 0.26);
      }
      if (st.int >= 3) {
        if (pos === 4 || pos === 12) k.snare(t, 0.07);
        if (pos % 4 === 0) k.bell(t, deg(sc, root + 24, d + st.lead[lb * 4 + pos / 4]), { ratio: 2, index: 1, dur: 0.6, peak: 0.03 });
      }
    },
  },

  // Epic and driving (D minor): 8th-note bass, heavy drums, brassy detuned saw stabs.
  boss: {
    bpm: 140, echo: 0.12, vol: 0.75,
    step(k, t, pos, bar, st, spb) {
      const lb = bar % 4;
      const roots = [38, 46, 48, 45];
      const quals = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
      if (pos === 0 && lb === 0) {
        st.loop = (st.loop ?? -1) + 1;
        st.fill = st.r.chance(0.6);
        st.leadOn = st.loop % 2 === 1;
        st.lead = Array.from({ length: 16 }, (_, i) => st.r.pick([0, 0, 1, 2, 2]) + (i % 4 === 3 ? 1 : 0));
      }
      const r = roots[lb];
      const ch = quals[lb].map((iv) => r + 12 + iv);
      if (pos % 2 === 0) k.bass(t, r + (pos % 8 === 6 ? 12 : 0), spb * 1.7, { peak: 0.1, cutoff: 800, q: 3, sub: pos % 4 === 0 ? 0.06 : 0 });
      if (pos === 0 || pos === 8 || (pos === 10 && st.r.chance(0.5))) k.kick(t, 0.42);
      if (pos === 4 || pos === 12) k.snare(t, 0.13);
      if (lb === 3 && st.fill && pos >= 13) k.snare(t, 0.07 + (pos - 13) * 0.02);
      if (pos % 2 === 0) k.hat(t, 0.02);
      else if (lb >= 2) k.hat(t, 0.009);
      if (pos === 0 && lb === 0) k.crash(t, 0.05);
      // brass: 3-3-2 stabs, long hit on even bars
      if (pos === 0 || pos === 3 || pos === 6) k.brass(t, ch, spb * 2.2, { peak: 0.028 });
      if (pos === 8 && lb % 2 === 0) k.brass(t, ch, spb * 6, { peak: 0.024, bright: 1800 });
      if ((pos === 10 || pos === 12) && lb % 2 === 1) k.brass(t, ch, spb * 1.6, { peak: 0.024 });
      if (st.leadOn && pos % 4 === 0) {
        const n = ch[st.lead[lb * 4 + pos / 4] % 3] + 12;
        k.lead(t, n, spb * 3.5, { peak: 0.026, cutoff: 2600, type: 'square' });
      }
    },
  },

  // Short somber phrase, then a quiet drone.
  gameover: {
    bpm: 64, echo: 0.4, vol: 0.9, delay: 1.3,
    step(k, t, pos, bar, st, spb) {
      if (bar < 2) {
        const phrase = bar === 0
          ? [[0, 69, 4], [4, 67, 4], [8, 64, 4], [12, 65, 4]]
          : [[0, 64, 6], [6, 62, 2], [8, 57, 8]];
        for (const [p, m, len] of phrase) if (p === pos) k.pluck(t, m, { dur: len * spb + 0.4, peak: 0.1, cutoff: 1800, vib: { rate: 5, depth: 8 } });
        if (pos === 0) k.pad(t, bar === 0 ? [50, 53, 57] : [45, 52, 57, 60], 16 * spb + 0.8, { type: 'triangle', det: [-4, 4], peak: 0.035, cutoff: 900, a: 0.5 });
        if (pos === 0) k.bass(t, bar === 0 ? 38 : 33, 16 * spb, { type: 'sine', peak: 0.1 });
        return;
      }
      if (pos === 0 && bar % 2 === 0) {
        k.drone(t, 45, 32 * spb + 1, { peak: 0.04, cutoff: 380, type: 'triangle' });
        k.drone(t, 52, 32 * spb + 1, { peak: 0.022, cutoff: 500, type: 'triangle' });
      }
      if (pos === 8 && st.r.chance(0.25)) k.bell(t, st.r.pick([69, 72, 76, 64]), { ratio: 3.5, index: 0.8, dur: 2, peak: 0.016 });
    },
  },

  // Triumphant fanfare, then a warm major loop.
  victory: {
    bpm: 116, echo: 0.25, vol: 0.9, delay: 1.6,
    step(k, t, pos, bar, st, spb) {
      if (bar < 2) {
        if (bar === 0) {
          const fan = [[0, 67, 2], [2, 72, 2], [4, 76, 2], [6, 79, 6], [12, 76, 2], [14, 79, 2]];
          for (const [p, m, len] of fan) if (p === pos) k.brass(t, [m], len * spb, { peak: 0.04, bright: 3000 });
          if (pos === 0 || pos === 6 || pos === 12) k.tom(t, 43, 0.25);
        } else if (pos === 0) {
          k.brass(t, [72, 76, 79, 84], 16 * spb, { peak: 0.03, bright: 3000 });
          k.kick(t, 0.35);
          k.crash(t, 0.06);
          k.bass(t, 36, 16 * spb, { peak: 0.1, sub: 0.06 });
        }
        return;
      }
      const sc = SC.major, root = 48, lb = (bar - 2) % 4;
      if (pos === 0 && lb === 0) {
        st.prog = st.r.pick([[0, 4, 5, 3], [0, 3, 4, 0], [0, 5, 3, 4], [3, 4, 0, 5]]);
        st.motif = genMotif(st.r);
        st.motif2 = genMotif(st.r);
      }
      const d = st.prog[lb];
      if (pos === 0) k.pad(t, chord(sc, root + 12, d, 3), 16 * spb + 0.3, { type: 'triangle', det: [-5, 5], peak: 0.03, cutoff: 1800, a: 0.25 });
      if (pos === 0 || pos === 6 || pos === 8) k.pluck(t, deg(sc, root - 12, d) + (pos === 8 ? 12 : 0), { dur: 0.4, peak: 0.13, cutoff: 1000 });
      const motif = lb === 3 ? st.motif2 : st.motif;
      for (const n of motif) if (n.pos === pos) k.pluck(t, deg(sc, root + 24, d + n.d), { dur: Math.min(0.8, n.len * spb + 0.1), peak: 0.065, cutoff: 3800, oct: 0.3 });
      if (pos === 0 || pos === 8) k.kick(t, 0.2);
      if (pos === 4 || pos === 12) k.snare(t, 0.05);
      if (pos % 2 === 0) k.hat(t, 0.012);
    },
  },
};

export const TRACK_NAMES = Object.keys(TRACKS);

// ------------------------------------------------------------------ players

class TrackPlayer {
  constructor(E, name, def, fadeIn) {
    const { ctx } = E;
    const now = ctx.currentTime;
    this.E = E;
    this.name = name;
    this.def = def;
    this.fade = ctx.createGain();
    this.fade.gain.setValueAtTime(0, now);
    this.fade.gain.linearRampToValueAtTime(def.vol ?? 1, now + fadeIn);
    this.fade.connect(E.musicBus);
    this.wet = ctx.createGain();
    this.wet.gain.value = def.echo ?? 0.2;
    this.fade.connect(this.wet);
    this.wet.connect(E.musicSend);
    this.kit = makeKit(E, this.fade);
    this.spb = 60 / def.bpm / 4;
    this.step = 0;
    this.next = now + 0.08 + (def.delay || 0);
    this.st = { r: rng() };
    this.deadAt = Infinity;
    this.warned = false;
  }
  schedule(now, silent) {
    const horizon = now + LOOKAHEAD;
    let n = 0;
    while (this.next < horizon && n++ < 64) {
      if (this.next < now - 0.08) {
        // fell behind (long frame / hitch): drop missed steps rather than burst them out
        const miss = Math.ceil((now - this.next) / this.spb);
        this.step += miss;
        this.next += miss * this.spb;
        continue;
      }
      if (!silent) {
        try {
          this.def.step(this.kit, this.next, this.step % 16, Math.floor(this.step / 16), this.st, this.spb);
        } catch (err) {
          if (!this.warned) console.warn(`[audio] music "${this.name}" step failed:`, err);
          this.warned = true;
        }
      }
      this.step++;
      this.next += this.spb;
    }
  }
  stop(now) {
    const p = this.fade.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + CROSSFADE);
    this.deadAt = now + CROSSFADE + 0.1;
  }
  dispose() {
    try { this.fade.disconnect(); this.wet.disconnect(); } catch { /* ignore */ }
  }
}

/** Music engine: play(name|null) crossfades, update(silent) schedules ahead. */
export function createMusic(E) {
  let cur = null;
  let requested = undefined; // last name passed to play()
  const fading = [];
  return {
    get requested() { return requested; },
    play(name) {
      if (name === requested) return;
      requested = name;
      const now = E.ctx.currentTime;
      const hadMusic = !!cur;
      if (cur) {
        cur.stop(now);
        fading.push(cur);
        cur = null;
      }
      const def = name ? TRACKS[name] : null;
      if (def) cur = new TrackPlayer(E, name, def, hadMusic ? CROSSFADE : 0.8);
    },
    update(silent) {
      const now = E.ctx.currentTime;
      cur?.schedule(now, silent);
      for (let i = fading.length - 1; i >= 0; i--) {
        if (now >= fading[i].deadAt) {
          fading[i].dispose();
          fading.splice(i, 1);
        }
      }
    },
  };
}
