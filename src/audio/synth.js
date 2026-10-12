// AUDIO synth toolkit (team: ui+audio). Pure WebAudio - no asset files.
//   createEngine(ctx)  -> the shared mixer graph (buses, echo send, compressor/limiter, ducking,
//                         noise buffers generated once, cached waveshaper curves)
//   osc / noise / fm   -> one-shot enveloped voices that stop + disconnect themselves
// Used by sfx.js (one-shot effects) and music.js (sequencer instruments).

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const EPS = 0.0001;

// ------------------------------------------------------------------ mixer graph

/**
 * Graph:
 *   voices -> sfxBus(vol) ------------------------------\
 *   voices -> sfxSend(vol) -> echo(delay+fb+lp) ---------+-> mix -> compressor -> limiter -> master(vol/mute) -> out
 *   tracks -> musicBus(vol) -> duck ----------------------/
 *   tracks -> musicSend(vol) -> echo
 */
export function createEngine(ctx) {
  const g = (v = 1) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const mix = g(1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  const master = g(0);
  mix.connect(comp);
  comp.connect(limiter);
  limiter.connect(master);
  master.connect(ctx.destination);

  const sfxBus = g(0);
  const sfxSend = g(0);
  const musicBus = g(0);
  const musicSend = g(0);
  const duck = g(1);
  sfxBus.connect(mix);
  musicBus.connect(duck);
  duck.connect(mix);

  // Shared feedback-delay "space" (cheap stand-in for reverb).
  const echoIn = g(1);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.27;
  const fb = g(0.34);
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2600;
  const echoHp = ctx.createBiquadFilter();
  echoHp.type = 'highpass';
  echoHp.frequency.value = 220;
  const echoOut = g(0.55);
  sfxSend.connect(echoIn);
  musicSend.connect(echoIn);
  echoIn.connect(echoHp);
  echoHp.connect(delay);
  delay.connect(damp);
  damp.connect(fb);
  fb.connect(delay);
  damp.connect(echoOut);
  echoOut.connect(mix);

  const E = {
    ctx,
    master,
    sfxBus,
    sfxSend,
    musicBus,
    musicSend,
    duckGain: duck,
    noise: makeNoiseBuffers(ctx),
    hasPanner: typeof ctx.createStereoPanner === 'function',
    _curves: new Map(),
    /** Cached tanh waveshaper curve for amount (1..50). */
    curve(amount) {
      const k = Math.round(amount);
      let c = this._curves.get(k);
      if (!c) {
        c = new Float32Array(1024);
        const norm = Math.tanh(k);
        for (let i = 0; i < c.length; i++) {
          const x = (i / (c.length - 1)) * 2 - 1;
          c[i] = Math.tanh(x * k) / norm;
        }
        this._curves.set(k, c);
      }
      return c;
    },
    /** Smoothly move a gain param to a target (no clicks). */
    rampGain(node, target, tc = 0.06) {
      const now = ctx.currentTime;
      const p = node.gain;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(target, now, tc);
    },
    /** Duck the music bus to `level` (0.63 ~= -4 dB) for `hold` s, then release over 0.4 s. */
    duck(hold = 0.5, level = 0.63) {
      const now = ctx.currentTime;
      const p = duck.gain;
      const cur = p.value;
      p.cancelScheduledValues(now);
      p.setValueAtTime(cur, now);
      p.linearRampToValueAtTime(Math.min(cur, level), now + 0.03);
      p.setValueAtTime(Math.min(cur, level), now + 0.03 + hold);
      p.linearRampToValueAtTime(1, now + 0.43 + hold);
    },
  };
  return E;
}

/** White / pink / brown noise, 2 s each, generated once and shared by every voice. */
function makeNoiseBuffers(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const mk = () => ctx.createBuffer(1, len, ctx.sampleRate);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const r = Math.random() * 2 - 1;
    w[i] = r;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + r * 0.0555179;
    b1 = 0.99332 * b1 + r * 0.0750759;
    b2 = 0.969 * b2 + r * 0.153852;
    b3 = 0.8665 * b3 + r * 0.3104856;
    b4 = 0.55 * b4 + r * 0.5329522;
    b5 = -0.7616 * b5 - r * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + r * 0.5362) * 0.11;
    b6 = r * 0.115926;
    last = (last + 0.02 * r) / 1.02;
    b[i] = last * 3.5;
  }
  return { white, pink, brown };
}

// ------------------------------------------------------------------ envelopes & helpers

/** Attack (linear) -> optional hold -> exponential decay to silence at t+dur. Returns end time. */
export function env(param, t, a, peak, dur, hold = 0) {
  a = Math.max(0.001, a);
  dur = Math.max(dur, a + hold + 0.01);
  param.setValueAtTime(EPS, t);
  param.linearRampToValueAtTime(Math.max(EPS, peak), t + a);
  if (hold > 0) param.setValueAtTime(Math.max(EPS, peak), t + a + hold);
  param.exponentialRampToValueAtTime(EPS, t + dur);
  return t + dur;
}

function sweep(param, v0, v1, t, t1, lin) {
  param.setValueAtTime(v0, t);
  if (v1 && v1 !== v0) {
    if (lin) param.linearRampToValueAtTime(v1, t1);
    else param.exponentialRampToValueAtTime(Math.max(1, v1), t1);
  }
}

/** Optional filter + distortion chain after a source. Returns the last node. */
function chain(E, src, o, t, end, fScale = 1) {
  const { ctx } = E;
  let node = src;
  if (o.filter) {
    const f = o.filter;
    const bq = ctx.createBiquadFilter();
    bq.type = f.type || 'lowpass';
    bq.Q.value = f.q ?? 0.8;
    sweep(bq.frequency, clamp(f.f * fScale, 20, 20000), f.f1 ? clamp(f.f1 * fScale, 20, 20000) : 0, t, f.t != null ? t + f.t : end, f.lin);
    node.connect(bq);
    node = bq;
  }
  if (o.dist) {
    const ws = ctx.createWaveShaper();
    ws.curve = E.curve(o.dist);
    node.connect(ws);
    node = ws;
  }
  return node;
}

function finish(src, nodes, t, end, reg) {
  src.start(t);
  src.stop(end + 0.03);
  src.onended = () => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* already gone */ }
    }
  };
  reg?.(src, end);
}

/**
 * Oscillator voice. o: {t, type, f, f1?, glide?, lin?, dur, a, peak, hold, detune, filter{type,f,f1,t,q},
 * dist, out, vib{rate, depth(cents)}}
 */
export function osc(E, o, reg) {
  const { ctx } = E;
  const t = o.t, dur = o.dur;
  const src = ctx.createOscillator();
  src.type = o.type || 'sine';
  sweep(src.frequency, clamp(o.f, 1, 20000), o.f1 ? clamp(o.f1, 1, 20000) : 0, t, t + (o.glide ?? dur), o.lin);
  if (o.detune) src.detune.value = o.detune;
  const nodes = [src];
  if (o.vib) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = o.vib.rate || 5;
    lg.gain.value = o.vib.depth || 15;
    l.connect(lg);
    lg.connect(src.detune);
    l.start(t);
    l.stop(t + dur + 0.03);
    nodes.push(lg);
    l.onended = () => { try { l.disconnect(); } catch { /* ignore */ } };
  }
  const last = chain(E, src, o, t, t + dur);
  const gn = ctx.createGain();
  const end = env(gn.gain, t, o.a ?? 0.005, o.peak ?? 0.3, dur, o.hold || 0);
  last.connect(gn);
  gn.connect(o.out);
  nodes.push(gn);
  if (last !== src) nodes.push(last);
  finish(src, nodes, t, end, reg);
  return src;
}

/** Filtered noise voice. o: {t, dur, color, rate, a, peak, hold, filter, dist, out, fScale} */
export function noise(E, o, reg) {
  const { ctx } = E;
  const t = o.t;
  const src = ctx.createBufferSource();
  src.buffer = E.noise[o.color || 'white'];
  src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const last = chain(E, src, o, t, t + o.dur, o.fScale || 1);
  const gn = ctx.createGain();
  const end = env(gn.gain, t, o.a ?? 0.003, o.peak ?? 0.3, o.dur, o.hold || 0);
  last.connect(gn);
  gn.connect(o.out);
  const nodes = [src, gn];
  if (last !== src) nodes.push(last);
  // random offset into the buffer so repeated hits don't sound identical
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.03);
  src.onended = () => {
    for (const n of nodes) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
  };
  reg?.(src, end);
  return src;
}

/**
 * 2-operator FM voice (bells, metal). o: {t, f, ratio, index, idxEnd, dur, a, peak, hold, out, type, f1}
 * index = modulation depth as a multiple of the carrier frequency; decays to idxEnd*index.
 */
export function fm(E, o, reg) {
  const { ctx } = E;
  const t = o.t, dur = o.dur;
  const car = ctx.createOscillator();
  car.type = o.type || 'sine';
  sweep(car.frequency, o.f, o.f1 || 0, t, t + dur);
  const mod = ctx.createOscillator();
  mod.frequency.value = o.f * (o.ratio ?? 2);
  const mg = ctx.createGain();
  const depth = o.f * (o.index ?? 2);
  mg.gain.setValueAtTime(depth, t);
  mg.gain.exponentialRampToValueAtTime(Math.max(1, depth * (o.idxEnd ?? 0.08)), t + dur);
  mod.connect(mg);
  mg.connect(car.frequency);
  const last = chain(E, car, o, t, t + dur);
  const gn = ctx.createGain();
  const end = env(gn.gain, t, o.a ?? 0.002, o.peak ?? 0.25, dur, o.hold || 0);
  last.connect(gn);
  gn.connect(o.out);
  mod.start(t);
  mod.stop(end + 0.03);
  mod.onended = () => { try { mod.disconnect(); mg.disconnect(); } catch { /* ignore */ } };
  const nodes = [car, gn];
  if (last !== car) nodes.push(last);
  finish(car, nodes, t, end, reg);
  reg?.(mod, end);
  return car;
}

/**
 * Shared processing bus for several sources (e.g. a filtered/distorted roar).
 * o: {t, dur, filter, dist, gain, out}. Returns the input node; disconnects itself after dur.
 */
export function bus(E, o, reg) {
  const { ctx } = E;
  const input = ctx.createGain();
  input.gain.value = o.gain ?? 1;
  const last = chain(E, input, o, o.t, o.t + o.dur);
  last.connect(o.out);
  // A silent constant source keeps a handle so the bus is torn down with the voice.
  const keep = ctx.createConstantSource ? ctx.createConstantSource() : null;
  if (keep) {
    const z = ctx.createGain();
    z.gain.value = 0;
    keep.connect(z);
    z.connect(input);
    keep.start(o.t);
    keep.stop(o.t + o.dur + 0.05);
    keep.onended = () => {
      for (const n of [keep, z, input, last]) {
        try { n.disconnect(); } catch { /* ignore */ }
      }
    };
    reg?.(keep, o.t + o.dur);
  }
  return input;
}

/** LFO into an AudioParam for dur seconds. */
export function lfo(E, param, t, dur, rate, depth, type = 'sine', rate1) {
  const { ctx } = E;
  const l = ctx.createOscillator();
  l.type = type;
  sweep(l.frequency, rate, rate1 || 0, t, t + dur);
  const g = ctx.createGain();
  g.gain.value = depth;
  l.connect(g);
  g.connect(param);
  l.start(t);
  l.stop(t + dur + 0.03);
  l.onended = () => { try { l.disconnect(); g.disconnect(); } catch { /* ignore */ } };
  return l;
}

/** Tiny seeded PRNG (mulberry32) for repeatable-per-loop musical variation. */
export function rng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  return r;
}
