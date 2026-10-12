// Enemies and the boss (team: art+fx). Enchanted armour (hollow, ghost-lit), rogue golems
// (stone / ember-magma / frost / crystal variants with glowing runes) and the Corrupted Archmage.
// All face right; combat flips for left. Glow pixels go into the emissive layer `g`.
import { P } from './palette.js';
import { rect, px, line, ellipse, hash2, mix, shade } from './pixel.js';
import { frame, assemble, dissolveFrames, tinted } from './sheet.js';

// ------------------------------------------------------------------ enchanted armour

/**
 * opts: {steel ramp, trim ramp|null, eye css, plume css|null, cape ramp|null, big bool, weapon:'sword'|'greatsword'|'halberd'}
 */
function paintKnight(c, g, o, pose) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const s = o.steel, t = o.trim;
  const k = o.big ? 1 : 0;
  const ox = o.big ? 1 : 0;
  const bob = pose.bob || 0;
  const step = pose.step || 0;
  const by = bob; // floating armour bobs as a whole (except feet)
  const ghost = o.eye;

  // cape behind
  if (o.cape) {
    const cp = o.cape;
    const sw = pose.step ? 1 : 0;
    R(3 + ox, 10 + by, 4, 12 - by, cp[1]); R(2 + ox - sw, 16, 3, 6, cp[1]); R(4 + ox, 10 + by, 2, 11, cp[2]);
    for (let x = 2 - sw; x < 7; x += 2) px(c, x + ox, 22, cp[0]);
  }
  // back arm + shield
  R(3 + ox, 11 + by, 3, 5, s[1]);
  if (!o.cape) {
    R(1 + ox, 11 + by, 4, 7, s[2]); R(1 + ox, 11 + by, 4, 1, s[3]); R(1 + ox, 17 + by, 4, 1, s[1]);
    px(c, 2 + ox, 18 + by, s[1]);
    R(2 + ox, 13 + by, 2, 3, o.shield || '#3a4a8a'); px(c, 2 + ox, 13 + by, mix(o.shield || '#3a4a8a', '#ffffff', 0.3));
  }

  // legs (greaves), ghost light between plates
  const lA = 9 + ox + step, lB = 6 + ox - step;
  R(lB, 18 + k, 2, 4 - k, s[1]); R(lB, 21, 3, 2, s[1]);
  R(lA, 18 + k, 2, 4 - k, s[2]); px(c, lA, 18 + k, s[3]); R(lA, 21, 3, 2, s[2]); px(c, lA + 2, 21, s[3]);
  G(lA, 17 + k + by, 2, 1, mix(ghost, '#000000', 0.3));

  // torso / breastplate
  const ty = 10 + by;
  R(5 + ox, ty + 1, 7 + k, 6, s[2]);
  R(6 + ox, ty, 5 + k, 1, s[3]);
  R(5 + ox, ty + 1, 2, 4, s[3]); px(c, 6 + ox, ty + 1, s[4]);
  R(10 + ox + k, ty + 1, 2, 6, s[1]);
  // abdomen plates + tasset
  R(5 + ox, ty + 5, 7 + k, 1, s[1]);
  R(5 + ox, ty + 6, 7 + k, 2, s[2]); R(5 + ox, ty + 6, 7 + k, 1, s[3]);
  if (t) { R(5 + ox, ty + 5, 7 + k, 1, t[2]); px(c, 8 + ox, ty + 2, t[3]); px(c, 8 + ox, ty + 3, t[2]); }
  // ghost light at the waist gap
  G(6 + ox, ty + 8, 5 + k, 1, mix(ghost, '#000000', 0.45));

  // helmet (floating: 1px gap at the neck filled with ghost glow)
  const hy = 2 + by - k;
  G(7 + ox, hy + 7, 4, 1, mix(ghost, '#000000', 0.35));
  R(6 + ox, hy + 1, 6, 6, s[2]);
  R(7 + ox, hy, 4, 1, s[3]);
  R(6 + ox, hy + 1, 2, 5, s[3]); px(c, 7 + ox, hy + 1, s[4]);
  R(11 + ox, hy + 1, 1, 6, s[1]);
  R(8 + ox, hy + 6, 4, 1, s[1]);
  // visor slit with glowing eyes
  R(8 + ox, hy + 3, 4, 2, P.ink);
  G(9 + ox, hy + 3, 1, 1, ghost); G(11 + ox, hy + 3, 1, 1, ghost);
  rect(g, 8 + ox, hy + 4, 4, 1, mix(ghost, '#000000', 0.5));
  // breathing holes
  px(c, 10 + ox, hy + 5, s[1]);
  if (o.plume) {
    R(6 + ox, hy - 2, 3, 2, o.plume); R(4 + ox, hy - 1, 2, 2, o.plume); px(c, 3 + ox, hy, mix(o.plume, '#000000', 0.4));
    px(c, 7 + ox, hy - 2, mix(o.plume, '#ffffff', 0.4));
  } else {
    R(8 + ox, hy - 1, 2, 1, s[2]);
  }
  if (t) { R(6 + ox, hy + 2, 6, 1, t[2]); px(c, 6 + ox, hy + 2, t[3]); }

  // pauldrons
  R(4 + ox, ty - 1, 4, 3, s[2]); R(4 + ox, ty - 1, 4, 1, s[3]); px(c, 4 + ox, ty + 1, s[1]);
  R(9 + ox, ty - 1, 4 + k, 3, s[2]); R(9 + ox, ty - 1, 3, 1, s[4]); R(12 + ox + k - 1, ty, 1, 2, s[1]);
  if (t) { R(9 + ox, ty + 1, 4 + k, 1, t[2]); R(4 + ox, ty + 1, 4, 1, t[1]); }

  // front arm + weapon
  const blade = o.blade || P.steel;
  const long = o.weapon === 'greatsword' ? 3 : 0;
  const atk = pose.atk || 0;
  if (atk === 1) {
    // wind-up: blade raised behind the head
    R(10 + ox, ty, 2, 3, s[2]); px(c, 11 + ox, ty - 1, s[3]);
    line(c, 11 + ox, ty - 1, 4 + ox - long, ty - 8 - long, blade[3]);
    line(c, 11 + ox, ty, 4 + ox - long, ty - 7 - long, blade[2]);
    R(10 + ox, ty - 2, 3, 1, P.brass[3]);
    G(4 + ox - long, ty - 8 - long, 1, 1, ghost);
  } else if (atk === 2 && (o.weapon === 'spear' || o.weapon === 'halberd')) {
    // thrust: haft level, point far forward
    R(11 + ox, ty + 2, 3, 2, s[2]);
    R(6 + ox, ty + 3, 12, 1, P.wood[2]);
    R(18 + ox - (o.big ? 1 : 0), ty + 2, 2, 3, blade[3]); px(c, 19 + ox - (o.big ? 1 : 0), ty + 3, blade[4]);
    for (let i = 0; i < 4; i++) rect(g, 14 + ox + i, ty + 3, 1, 1, mix(ghost, '#000000', 0.2 + i * 0.15));
  } else if (atk === 2) {
    // swing: blade forward and down, ghostly arc
    R(11 + ox, ty + 2, 3, 2, s[2]);
    R(14 + ox, ty + 2, 1, 3, P.brass[3]);
    line(c, 15 + ox, ty + 3, 17 + ox, ty + 8 + long, blade[3]);
    line(c, 15 + ox, ty + 2, 17 + ox, ty + 7 + long, blade[4]);
    for (let i = 0; i < 5; i++) rect(g, 13 + ox + i, ty - 4 + i * 2, 1, 1, mix(ghost, '#000000', 0.2 + i * 0.1));
  } else if (o.weapon === 'spear' || o.weapon === 'halberd') {
    R(10 + ox, ty + 2, 2, 4, s[2]); px(c, 10 + ox, ty + 2, s[3]);
    R(11 + ox, ty + 5, 2, 2, s[3]);
    // long haft, upright
    R(13 + ox, ty - 9, 1, 21, P.wood[2]); px(c, 13 + ox, ty - 9, P.wood[3]);
    if (o.weapon === 'spear') { R(13 + ox, ty - 12, 1, 3, blade[4]); px(c, 12 + ox, ty - 10, blade[2]); px(c, 14 + ox, ty - 10, blade[2]); G(13 + ox, ty - 13, 1, 1, ghost); }
    else { R(14 + ox, ty - 9, 2, 4, blade[3]); px(c, 15 + ox, ty - 9, blade[4]); R(11 + ox, ty - 8, 2, 2, blade[2]); R(13 + ox, ty - 12, 1, 3, blade[4]); }
  } else {
    R(10 + ox, ty + 2, 2, 4, s[2]); px(c, 10 + ox, ty + 2, s[3]);
    R(11 + ox, ty + 5, 2, 2, s[3]);
    // blade upright
    R(12 + ox, ty + 5, 3, 1, P.brass[3]);
    R(13 + ox, ty - 6 - long, 1, 11 + long, blade[3]); R(14 + ox, ty - 5 - long, 1, 10 + long, blade[1]);
    px(c, 13 + ox, ty - 7 - long, blade[4]);
    R(13 + ox, ty + 6, 1, 2, P.leather[2]);
  }
}

function towerShield(c, g, o, pose) {
  const by = pose.bob || 0;
  const ox = o.big ? 1 : 0;
  const sh = o.shieldRamp || ['#141a3a', '#22306a', '#34489a', '#5a70c8'];
  const x0 = 9 + ox, y0 = 10 + by;
  rect(c, x0, y0, 6, 11, sh[1]); rect(c, x0, y0, 6, 1, sh[3]); rect(c, x0, y0, 1, 11, sh[2]); rect(c, x0 + 5, y0, 1, 11, sh[0]);
  rect(c, x0 + 1, y0 + 10, 4, 1, sh[0]);
  rect(c, x0 + 2, y0 + 3, 2, 4, P.gold[2]); px(c, x0 + 2, y0 + 3, P.gold[4]);
  rect(c, x0 + 1, y0 + 5, 4, 1, P.gold[2]);
  rect(g, x0 + 2, y0 + 4, 2, 1, mix(o.eye, '#000000', 0.3)); rect(c, x0 + 2, y0 + 4, 2, 1, o.eye);
}

export function knightSheet(o) {
  const W = o.big ? 20 : 18, H = 26;
  const mk = (pose) => frame(W, H, (c, g) => { c.translate(0, 1); g.translate(0, 1); paintKnight(c, g, o, pose); if (o.towerShield && pose.atk !== 2) towerShield(c, g, o, pose); });
  const frames = [
    mk({ bob: 0 }), mk({ bob: 1 }),
    mk({ step: 1 }), mk({ step: 0, bob: 1 }), mk({ step: -1 }), mk({ step: 0, bob: 1 }),
    mk({ atk: 1 }), mk({ atk: 2 }),
  ];
  frames.push(tinted(mk({ bob: 0 })));
  const tint = hexTint(o.eye);
  frames.push(...dissolveFrames(frames[0], 5, tint, 11));
  const anims = {
    idle: { frames: [0, 0, 1, 1], fps: 3, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 7, loop: true },
    attack: { frames: [6, 6, 7, 7, 7], fps: 10, loop: true },
    cast: { frames: [6, 7], fps: 6, loop: true },
    hurt: { frames: [8], fps: 1, loop: false },
    die: { frames: [8, 9, 10, 11, 12, 13], fps: 8, loop: false },
  };
  return assemble(frames, anims, W / 2, 23, { emissiveColor: o.eye });
}

// ------------------------------------------------------------------ golems

/** Shaded rocky ellipse: lit from the upper-left, with noise. */
function blob(c, cx, cy, rx, ry, ramp, seed, opts = {}) {
  const lx = -0.55, ly = -0.65, lz = 0.52;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      let l = nx * lx + ny * ly + nz * lz;
      l += (hash2(x >> 1, y >> 1, seed) - 0.5) * (opts.rough ?? 0.5);
      const n = ramp.length;
      let i = Math.round(((l + 0.6) / 1.6) * (n - 1));
      if (d > 0.78) i = Math.min(i - 1, 1);
      i = Math.max(0, Math.min(n - 1, i));
      rect(c, x, y, 1, 1, ramp[i]);
    }
  }
}

/** Glowing crack polyline into both layers. */
function crack(c, g, pts, color, glowColor) {
  for (let i = 0; i < pts.length - 2; i += 2) {
    line(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], color);
    if (glowColor) line(g, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], glowColor);
  }
}

export const GOLEMS = {
  stone: { ramp: ['#1e1a24', '#3a3440', '#5c5560', '#837a7e', '#ab9f98', '#d2c6b8'], rune: '#5ad8ff', eye: '#9af4ff', moss: true },
  ember: { ramp: ['#120808', '#261210', '#3e1e18', '#5a2c20', '#7a3e28', '#9a5a3a'], rune: '#ff8a2a', eye: '#ffd25a', lava: true },
  frost: { ramp: ['#1a2a4a', '#2e4a78', '#4a76a8', '#78a8d4', '#b0d8f0', '#e8f8ff'], rune: '#e6fbff', eye: '#ffffff', spikes: '#9af0ff' },
  crystal: { ramp: ['#1a0e2e', '#2e1a4e', '#4a2a72', '#6a3e98', '#9a62c0', '#c898e0'], rune: '#ff7af0', eye: '#ffb8ff', spikes: '#ff9af8' },
  moss: { ramp: ['#14180e', '#262c1a', '#3e4628', '#5c6438', '#7e8650', '#a8aa70'], rune: '#8aff5a', eye: '#c8ff8a', moss: true },
};

function paintGolem(c, g, v, pose, seed) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const rp = v.ramp;
  const bob = pose.bob || 0;
  const step = pose.step || 0;
  const atk = pose.atk || 0;
  const armUp = atk === 1 ? -6 : atk === 2 ? 3 : 0;
  // legs
  blob(c, 8 - step, 21, 3, 2, rp, seed + 1);
  blob(c, 15 + step, 21, 3, 2, rp, seed + 2);
  // back arm
  blob(c, 4, 13 + bob + (atk ? armUp : step), 3, 5, rp.map((x) => shade(x, -0.25)), seed + 3);
  // torso
  blob(c, 11, 13 + bob, 8, 7, rp, seed);
  // head (embedded, front-right)
  blob(c, 13, 6 + bob, 4, 3, rp, seed + 4, { rough: 0.3 });
  // brow + eyes
  R(10, 5 + bob, 7, 1, rp[1]);
  G(12, 6 + bob, 2, 1, v.eye); G(15, 6 + bob, 1, 1, v.eye);
  // runes on chest
  const ry = 12 + bob;
  const rune = v.rune;
  const rc = mix(rune, '#000000', 0.15);
  G(9, ry, 1, 4, rc); G(10, ry + 1, 2, 1, rc); G(12, ry, 1, 4, rc); G(10, ry + 3, 2, 1, rc);
  G(10, ry + 2, 2, 1, '#ffffff');
  // seams / cracks
  crack(c, v.lava ? g : null, [5, 9 + bob, 7, 12 + bob, 6, 15 + bob], v.lava ? '#ff7a1a' : rp[0], v.lava ? '#ff7a1a' : null);
  crack(c, v.lava ? g : null, [15, 15 + bob, 17, 17 + bob, 16, 19 + bob], v.lava ? '#ffb040' : rp[0], v.lava ? '#ffb040' : null);
  if (v.lava) {
    crack(c, g, [8, 18 + bob, 11, 19 + bob, 14, 18 + bob], '#ff5a10', '#ff5a10');
    G(13, 2 + bob, 1, 1, '#ffd25a'); G(14, 1 + bob, 1, 2, '#ff8a2a'); G(12, 3 + bob, 3, 1, '#ff6a1f');
  }
  if (v.moss) {
    for (let i = 0; i < 9; i++) {
      const x = 5 + ((hash2(i, 1, seed) * 12) | 0), y = 6 + bob + ((hash2(i, 2, seed) * 3) | 0);
      R(x, y + (x < 8 || x > 15 ? 3 : 1), 2, 1, i % 3 ? '#3a7a2e' : '#5aa848');
    }
  }
  if (v.spikes) {
    const sp = v.spikes, sd = mix(sp, '#1a2a4a', 0.5);
    const spike = (x, y, h) => { R(x, y - h, 1, h, sp); R(x + 1, y - h + 1, 1, h - 1, sd); rect(g, x, y - h, 1, 1, '#ffffff'); px(c, x, y - h, '#ffffff'); };
    spike(6, 8 + bob, 4); spike(8, 7 + bob, 3); spike(16, 8 + bob, 3); spike(4, 10 + bob, 2);
  }
  // front arm (fist)
  blob(c, 18, 13 + bob + armUp - (atk ? 0 : -step), 3, 5, rp, seed + 5);
  blob(c, 19, 18 + bob + armUp - (atk ? 0 : -step), 3, 2, rp, seed + 6, { rough: 0.2 });
  G(18, 13 + bob + armUp - (atk ? 0 : -step), 1, 2, rc);
  if (atk === 2) { for (let i = 0; i < 4; i++) rect(g, 15 + i * 2, 21, 1, 1, mix(rune, '#000000', 0.3)); }
}

export function golemSheet(variant, seed = 3) {
  const v = typeof variant === 'string' ? GOLEMS[variant] || GOLEMS.stone : variant;
  const W = 24, H = 25;
  const mk = (pose) => frame(W, H, (c, g) => { c.translate(0, 1); g.translate(0, 1); paintGolem(c, g, v, pose, seed); });
  const frames = [
    mk({ bob: 0 }), mk({ bob: 1 }),
    mk({ step: 1 }), mk({ step: 0, bob: 1 }), mk({ step: -1 }), mk({ step: 0, bob: 1 }),
    mk({ atk: 1 }), mk({ atk: 2 }),
  ];
  frames.push(tinted(frames[0]));
  frames.push(...dissolveFrames(frames[0], 5, hexTint(v.rune), seed + 9));
  const anims = {
    idle: { frames: [0, 0, 1, 1], fps: 2, loop: true },
    walk: { frames: [2, 3, 4, 5], fps: 5, loop: true },
    attack: { frames: [6, 6, 6, 7, 7], fps: 8, loop: true },
    cast: { frames: [6, 7], fps: 4, loop: true },
    hurt: { frames: [8], fps: 1, loop: false },
    die: { frames: [8, 9, 10, 11, 12, 13], fps: 8, loop: false },
  };
  return assemble(frames, anims, 12, 23, { emissiveColor: v.rune });
}

// ------------------------------------------------------------------ the Corrupted Archmage

function paintArchmage(c, g, pose) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const p2 = pose.phase === 2;
  const robe = P.corrupt;
  const fel = p2 ? '#7aff5a' : '#c05aff';
  const eye = p2 ? '#9aff6a' : '#ff5ad8';
  const bob = pose.bob || 0;
  const cast = pose.cast || 0;
  const y0 = 2 + bob;

  // tattered robe (hovering: hem jagged, no feet)
  for (let y = 14; y <= 31; y++) {
    const d = y - 14;
    const half = 5 + Math.floor(d * 0.45);
    const x0 = 14 - half, x1 = 14 + half;
    const yy = y + y0 - 2;
    R(x0, yy, x1 - x0 + 1, 1, robe[2]);
    R(x0, yy, 2, 1, robe[3]);
    R(x1 - 2, yy, 3, 1, robe[1]);
  }
  // jagged hem
  for (let x = 5; x <= 23; x++) {
    const h = (hash2(x, 3, p2 ? 5 : 1) * 4) | 0;
    R(x, 30 + y0 - 2, 1, 1 + h, (x & 1) ? robe[1] : robe[2]);
    if (h > 2) rect(c, x, 30 + y0 - 2 + h, 1, 1, robe[0]);
  }
  // robe centre panel and fel veins
  R(13, 15 + y0 - 2, 3, 16, robe[1]);
  R(13, 15 + y0 - 2, 1, 16, robe[3]);
  const vein = (pts) => { for (let i = 0; i < pts.length - 2; i += 2) { line(c, pts[i], pts[i + 1] + y0, pts[i + 2], pts[i + 3] + y0, fel); line(g, pts[i], pts[i + 1] + y0, pts[i + 2], pts[i + 3] + y0, mix(fel, '#000000', 0.25)); } };
  vein([10, 18, 9, 22, 10, 25, 8, 29]);
  vein([18, 17, 19, 21, 18, 24, 20, 28]);
  if (p2) { vein([12, 14, 11, 19, 12, 22]); vein([16, 14, 17, 20, 16, 26]); }
  // belt with skull clasp
  R(8, 19 + y0, 13, 1, P.ink);
  R(13, 18 + y0, 3, 3, P.marble[3]); px(c, 13, 19 + y0, P.ink); px(c, 15, 19 + y0, P.ink);
  G(14, 19 + y0, 1, 1, eye);

  // back sleeve / arm
  const armUp = cast ? 5 : 0;
  R(4, 14 + y0 - armUp, 4, 7, robe[1]); R(3, 19 + y0 - armUp, 4, 3, robe[1]);
  if (cast) { G(3, 9 + y0 - armUp + 5, 2, 2, fel); rect(g, 2, 8 + y0, 1, 1, '#ffffff'); }
  else R(4, 21 + y0, 2, 2, P.marble[1]);

  // spiked pauldrons
  const bone = P.marble;
  R(6, 12 + y0, 6, 3, '#2a2236'); R(6, 12 + y0, 6, 1, '#4a3e5a');
  R(17, 12 + y0, 6, 3, '#2a2236'); R(17, 12 + y0, 6, 1, '#4a3e5a');
  for (const x of [6, 9, 18, 21]) { R(x, 10 + y0, 1, 2, bone[2]); px(c, x, 9 + y0, bone[4]); }
  if (p2) for (const x of [7, 20]) { R(x, 8 + y0, 1, 4, bone[2]); px(c, x, 7 + y0, bone[4]); }

  // hood
  const hy = 3 + y0;
  R(10, hy + 1, 9, 9, robe[2]); R(11, hy, 7, 1, robe[3]); R(10, hy + 1, 2, 8, robe[3]); R(17, hy + 1, 2, 9, robe[1]);
  R(12, hy + 3, 6, 6, P.void);
  // mask (cracked bone, phase 2 shattered)
  R(12, hy + 4, 5, 4, bone[2]); R(12, hy + 4, 5, 1, bone[3]); px(c, 16, hy + 7, bone[1]);
  if (p2) { line(c, 14, hy + 4, 15, hy + 7, P.ink); line(g, 14, hy + 5, 15, hy + 7, fel); px(c, 16, hy + 4, P.void); px(c, 16, hy + 5, P.void); }
  // eyes
  G(13, hy + 5, 1, 1, eye); G(15, hy + 5, 1, 1, eye);
  rect(g, 13, hy + 6, 1, 1, mix(eye, '#000000', 0.5)); rect(g, 15, hy + 6, 1, 1, mix(eye, '#000000', 0.5));
  // horns
  const horn = p2 ? '#d8c8b0' : '#b8a898';
  line(c, 11, hy, 9, hy - 2, horn); line(c, 9, hy - 2, 8, hy - 1, horn); px(c, 8, hy - 3, horn);
  line(c, 17, hy, 19, hy - 2, horn); line(c, 19, hy - 2, 20, hy - 1, horn); px(c, 20, hy - 3, horn);
  if (p2) { px(c, 7, hy - 4, horn); px(c, 21, hy - 4, horn); G(14, hy - 1, 1, 1, fel); }

  // front arm + staff with the corrupted orb
  const sx = 23, sTop = (cast ? 1 : 4) + y0;
  R(sx, sTop + 3, 1, 32 - sTop - 3 + (cast ? -4 : 0), P.woodDark[2]); px(c, sx, sTop + 10, P.woodDark[4]);
  R(sx - 1, sTop + 2, 3, 1, '#3a3048'); px(c, sx - 2, sTop + 1, '#3a3048'); px(c, sx + 2, sTop + 1, '#3a3048');
  px(c, sx - 2, sTop - 1, '#3a3048'); px(c, sx + 2, sTop - 1, '#3a3048');
  G(sx - 1, sTop - 1, 3, 3, mix(fel, '#ffffff', cast ? 0.2 : 0));
  G(sx, sTop, 1, 1, '#ffffff');
  if (cast) { for (const [dx, dy] of [[-3, -2], [3, -3], [0, -4], [-2, 3]]) G(sx + dx, sTop + dy, 1, 1, cast === 2 ? '#ffffff' : fel); }
  R(19, 14 + y0 - (cast ? 2 : 0), 4, 5, robe[2]); R(19, 14 + y0 - (cast ? 2 : 0), 4, 1, robe[3]);
  R(21, 18 + y0 - (cast ? 2 : 0), 2, 2, bone[1]);

  // floating corruption motes
  const m = pose.mote || 0;
  for (let i = 0; i < (p2 ? 6 : 3); i++) {
    const a = i * 2.1 + m * 0.8;
    const x = 14 + Math.round(Math.cos(a) * 11), y = 20 + y0 + Math.round(Math.sin(a) * 6);
    G(x, y, 1, 1, i & 1 ? fel : '#c05aff');
  }
}

export function archmageSheet() {
  const W = 30, H = 38;
  const mk = (pose) => frame(W, H, (c, g) => paintArchmage(c, g, pose));
  const frames = [];
  const anims = {};
  for (const phase of [1, 2]) {
    const s = phase === 2 ? '_p2' : '';
    const b = frames.length;
    frames.push(mk({ phase, bob: 0, mote: 0 }), mk({ phase, bob: 1, mote: 1 }), mk({ phase, bob: 2, mote: 2 }), mk({ phase, bob: 1, mote: 3 }));
    frames.push(mk({ phase, cast: 1, bob: 0 }), mk({ phase, cast: 2, bob: 0 }));
    frames.push(tinted(frames[b], 'rgba(255,255,255,0.45)'));
    anims['idle' + s] = { frames: [b, b + 1, b + 2, b + 3], fps: 4, loop: true };
    anims['walk' + s] = { frames: [b, b + 1, b + 2, b + 3], fps: 6, loop: true };
    anims['cast' + s] = { frames: [b + 4, b + 5], fps: 8, loop: true };
    anims['attack' + s] = { frames: [b + 4, b + 5], fps: 8, loop: true };
    anims['hurt' + s] = { frames: [b + 6], fps: 1, loop: false };
  }
  const d0 = frames.length;
  frames.push(...dissolveFrames(frames[7], 7, [140, 255, 110], 21));
  anims.die = { frames: [13, d0, d0 + 1, d0 + 2, d0 + 3, d0 + 4, d0 + 5, d0 + 6], fps: 6, loop: false };
  anims.die_p2 = anims.die;
  anims.phase2 = { frames: [11, 12, 11, 12, 7, 8], fps: 8, loop: true };
  anims.phase2_p2 = anims.phase2;
  return assemble(frames, anims, 15, 35, { phases: true, emissiveColor: '#c05aff' });
}

function hexTint(hex) {
  const n = parseInt((hex || '#c8b8ff').slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export { ellipse };

// ------------------------------------------------------------------ wisps

const WISPS = {
  ember: ['#8a1a08', '#ff5a10', '#ff9a3a', '#ffd25a', '#fff8d0'],
  frost: ['#1c4ea0', '#2a96c8', '#5ad8ff', '#b0f0ff', '#ffffff'],
  storm: ['#5a4a10', '#c8a020', '#ffe14a', '#fff8b0', '#ffffff'],
  arcane: ['#3a1a7a', '#7a3ac0', '#b05aff', '#ffb8ff', '#ffffff'],
  fel: ['#1a4a12', '#3aa01e', '#7aff5a', '#c8ffb0', '#ffffff'],
};

function paintWisp(c, g, rp, kind, f, atk) {
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const bob = [0, 1, 1, 0, -1, -1][f % 6];
  const cx = 7, cy = 8 + bob;
  const s = atk ? 1 : 0;
  // flame tail (flicker)
  for (let i = 0; i < 6; i++) {
    const w = Math.max(0, 3 - Math.floor(i / 2) + s);
    const sway = Math.round(Math.sin(f * 1.1 + i * 0.9) * (i / 3));
    G(cx - w + sway, cy - 3 - i, w * 2 + 1, 1, i < 2 ? rp[2] : i < 4 ? rp[1] : rp[0]);
  }
  ellipse(c, cx, cy, 4 + s, 4 + s, rp[1]); ellipse(g, cx, cy, 4 + s, 4 + s, rp[1]);
  ellipse(c, cx, cy, 3 + s, 3 + s, rp[2]); ellipse(g, cx, cy, 3 + s, 3 + s, rp[2]);
  ellipse(c, cx - 1, cy - 1, 2, 2, rp[3]); ellipse(g, cx - 1, cy - 1, 2, 2, rp[3]);
  G(cx - 1, cy - 1, 1, 1, rp[4]);
  // little eyes
  rect(c, cx, cy, 1, 1, P.ink); rect(c, cx + 2, cy, 1, 1, P.ink);
  // wisps trailing below
  G(cx - 2 + (f % 3), cy + 5, 1, 1, rp[2]); G(cx + 1 - (f % 2), cy + 6, 1, 1, rp[1]);
  if (kind === 'frost') for (let k = 0; k < 3; k++) { const a = f * 0.6 + k * 2.1; G(cx + Math.round(Math.cos(a) * 6), cy + Math.round(Math.sin(a) * 3), 1, 1, '#ffffff'); }
  if (kind === 'storm') { const a = f * 1.3; line(c, cx + 3, cy, cx + 6, cy - 2 + (f % 3), rp[4]); line(g, cx + 3, cy, cx + 6, cy - 2 + (f % 3), rp[4]); G(cx - 6 + (f % 2), cy + 1, 1, 1, rp[4]); void a; }
}

export function wispSheet(kind = 'ember') {
  const rp = WISPS[kind] || WISPS.arcane;
  const W = 15, H = 18;
  const mk = (f, atk) => frame(W, H, (c, g) => { c.translate(0, 1); g.translate(0, 1); paintWisp(c, g, rp, kind, f, atk); });
  const frames = [];
  for (let f = 0; f < 6; f++) frames.push(mk(f, false));
  frames.push(mk(0, true), mk(2, true));
  frames.push(tinted(frames[0], 'rgba(255,255,255,0.6)'));
  frames.push(...dissolveFrames(frames[0], 4, hexTint(rp[3]), 31));
  const anims = {
    idle: { frames: [0, 1, 2, 3, 4, 5], fps: 10, loop: true },
    walk: { frames: [0, 1, 2, 3, 4, 5], fps: 14, loop: true },
    attack: { frames: [6, 7], fps: 10, loop: true },
    cast: { frames: [6, 7], fps: 10, loop: true },
    hurt: { frames: [8], fps: 1, loop: false },
    die: { frames: [8, 9, 10, 11, 12], fps: 10, loop: false },
  };
  return assemble(frames, anims, 7, 16, { emissiveColor: rp[2], glowBloom: true });
}
