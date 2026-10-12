// Pickups and props (team: art+fx).
import { P, ELEMENT_RAMPS } from './palette.js';
import { rect, px, line, ellipse, disc, mix, hash2, shade } from './pixel.js';
import { frame, assemble } from './sheet.js';
import { buildWorldProps } from './props.js';

const loopAnim = (n, fps) => ({ idle: { frames: Array.from({ length: n }, (_, i) => i), fps, loop: true } });

// ------------------------------------------------------------------ elemental fragments

/** Paint a spinning gem: `phase` 0..5 changes apparent width / highlight. */
function gem(c, g, el, phase) {
  const rp = ELEMENT_RAMPS[el] || ELEMENT_RAMPS.arcane;
  const [dk, base, lt, gl] = rp;
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const widths = [3, 2, 1, 0, 1, 2];
  const hw = widths[phase % 6];
  const cx = 6;
  if (el === 'fire') {
    // flame-shaped crystal
    const rows = [[0, 0], [0, 0], [1, 0], [1, 1], [2, 1], [3, 1], [3, 2], [3, 2], [2, 1], [1, 0]];
    rows.forEach(([w, w2], y) => {
      const ww = Math.max(0, Math.round(w * (0.4 + hw / 5)));
      const tip = phase % 2 && y < 2 ? 1 : 0;
      R(cx - ww + tip, y + 1, ww * 2 + 1, 1, base);
      R(cx - ww + tip, y + 1, 1, 1, lt);
      if (w2) G(cx - Math.min(ww, w2) + 1, y + 1, Math.max(1, Math.min(ww, w2)), 1, lt);
    });
    G(cx, 6, 1, 3, gl);
  } else if (el === 'ice') {
    // tall hexagonal shard
    const w = Math.max(1, hw + 1);
    R(cx - w + 1, 2, w * 2 - 1, 8, base);
    R(cx - w + 2, 1, Math.max(1, w * 2 - 3), 1, lt); px(c, cx, 0, gl);
    R(cx - w + 1, 2, 1, 8, lt); R(cx + w - 1, 2, 1, 8, dk);
    R(cx - w + 2, 10, Math.max(1, w * 2 - 3), 1, dk);
    G(cx - (hw > 1 ? 1 : 0), 3, 1, 5, gl);
  } else if (el === 'lightning') {
    // zig-zag bolt crystal
    const s = hw > 1 ? 1 : 0;
    const pts = [[7, 0], [6, 1], [5, 2], [4, 3], [5, 4], [6, 4], [7, 5], [6, 6], [5, 7], [6, 8], [5, 9], [4, 10]];
    for (const [x, y] of pts) { R(x - s, y, 2 + s, 1, base); px(c, x - s, y, lt); }
    for (const [x, y] of pts.slice(2, 9)) G(x, y, 1, 1, gl);
  } else if (el === 'arcane') {
    // four-point star gem
    const w = Math.max(0, hw);
    R(cx - w, 2, w * 2 + 1, 7, base); R(cx - 3, 5, 7, 1, base);
    R(cx - 1 - (w > 1 ? 1 : 0), 4, 3 + (w > 1 ? 2 : 0), 3, base);
    px(c, cx, 0 + 1, lt); px(c, cx, 9, dk);
    G(cx, 4, 1, 3, gl); G(cx - 1, 5, 3, 1, lt);
  } else if (el === 'earth') {
    // faceted emerald with a leaf
    const w = Math.max(1, hw + 1);
    for (let y = 0; y < 8; y++) {
      const ww = y < 3 ? Math.min(w, y + 1) : y > 5 ? Math.min(w, 8 - y) : w;
      R(cx - ww + 1, y + 2, ww * 2 - 1 + 1, 1, y < 3 ? lt : y > 5 ? dk : base);
    }
    G(cx, 4, 1, 3, gl);
    R(cx + 2, 1, 2, 1, '#5aa848'); px(c, cx + 1, 2, '#3a7a2e');
  } else {
    disc(c, cx, 5, Math.max(1, hw + 1), base); G(cx, 4, 1, 2, gl);
  }
}

export function fragmentSheet(el) {
  const frames = [];
  for (let i = 0; i < 6; i++) frames.push(frame(13, 13, (c, g) => { c.translate(0, 1); g.translate(0, 1); gem(c, g, el, i); }));
  return assemble(frames, loopAnim(6, 8), 6.5, 12, { emissiveColor: (ELEMENT_RAMPS[el] || ELEMENT_RAMPS.arcane)[1] });
}

function potion(c, g, liquid, t) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const [d, b, l] = liquid;
  R(4, 1, 3, 1, P.wood[3]); R(4, 2, 3, 1, P.wood[2]);
  R(4, 3, 3, 1, '#c8d8f0');
  ellipse(c, 5, 7, 3, 3, '#a8c0e0');
  ellipse(c, 5, 7, 2, 2, b);
  R(3, 7 + (t & 1), 5, 1, l);
  rect(g, 4, 7, 3, 2, b);
  px(c, 3, 5, '#ffffff'); px(c, 4, 9, d);
}

// ------------------------------------------------------------------ props

function portal(c, g, f) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const st = P.stone;
  // stone archway
  for (let y = 4; y < 31; y++) { R(1, y, 4, 1, y % 4 ? st[3] : st[2]); R(19, y, 4, 1, y % 4 ? st[2] : st[1]); }
  for (let x = 1; x < 23; x++) {
    const dy = Math.round(5 - Math.sqrt(Math.max(0, 121 - (x - 11.5) ** 2)) * 0.45);
    R(x, dy, 1, 4, (x & 3) ? st[3] : st[2]);
  }
  R(0, 29, 6, 3, st[2]); R(18, 29, 6, 3, st[1]); R(0, 29, 6, 1, st[4]); R(18, 29, 6, 1, st[3]);
  // runes on pillars (emissive)
  for (let i = 0; i < 4; i++) {
    const on = (i + f) % 4 === 0;
    const col = on ? '#ffb8ff' : '#7a4aff';
    rect(c, 2, 9 + i * 5, 2, 2, col); rect(g, 2, 9 + i * 5, 2, 2, col);
    rect(c, 20, 9 + i * 5, 2, 2, col); rect(g, 20, 9 + i * 5, 2, 2, col);
  }
  // swirling vortex (emissive)
  const cx = 11.5, cy = 17;
  for (let y = 6; y < 30; y++) for (let x = 5; x < 19; x++) {
    const dx = (x - cx) / 7, dy = (y - cy) / 12;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r > 1) continue;
    const a = Math.atan2(dy, dx);
    const sw = Math.sin(a * 3 + r * 9 - f * 0.8);
    const v = (1 - r) * 0.8 + sw * 0.25;
    const col = v > 0.75 ? '#ffffff' : v > 0.55 ? '#ffb8ff' : v > 0.35 ? '#b05aff' : v > 0.15 ? '#6a3ac0' : '#2a1060';
    rect(c, x, y, 1, 1, col);
    if (v > 0.3) rect(g, x, y, 1, 1, col);
  }
}

function towerDoor(c, g) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const st = ['#1a1028', '#2e2244', '#4a3a68', '#6a5890', '#9a88c0'];
  // frame
  R(0, 6, 24, 24, st[2]);
  for (let x = 0; x < 24; x++) { const dy = Math.round(7 - Math.sqrt(Math.max(0, 144 - (x - 11.5) ** 2)) * 0.6); R(x, dy, 1, 8, st[2]); px(c, x, dy, st[3]); }
  for (let y = 8; y < 30; y += 4) { R(0, y, 3, 1, st[1]); R(21, y + 2, 3, 1, st[1]); }
  // door
  const w = P.woodDark;
  for (let x = 4; x < 20; x++) {
    const dy = Math.round(9 - Math.sqrt(Math.max(0, 64 - (x - 11.5) ** 2)) * 0.6);
    R(x, dy, 1, 30 - dy, (x % 4 === 0) ? w[1] : w[2]);
    px(c, x, dy, w[3]);
  }
  R(4, 14, 16, 1, P.steel[1]); R(4, 23, 16, 1, P.steel[1]);
  for (const x of [5, 9, 14, 18]) { px(c, x, 14, P.steel[3]); px(c, x, 23, P.steel[3]); }
  R(11, 9, 2, 21, w[0]);
  px(c, 10, 19, P.brass[3]); px(c, 13, 19, P.brass[3]);
  // glowing rune keystone
  const rc = '#c08aff';
  for (const [x, y] of [[11, 2], [12, 2], [10, 3], [13, 3], [11, 4], [12, 4]]) { rect(c, x, y, 1, 1, rc); rect(g, x, y, 1, 1, rc); }
  R(0, 30, 24, 2, st[1]); R(2, 29, 20, 1, st[3]);
}

function forge(c, g, f) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const br = P.brick, st = P.stone;
  // chimney + body
  R(8, 0, 8, 6, st[2]); R(8, 0, 8, 1, st[4]); R(15, 0, 1, 6, st[1]);
  R(2, 5, 20, 14, br[2]);
  for (let y = 6; y < 19; y += 3) { R(2, y, 20, 1, br[1]); for (let x = 2 + ((y / 3) & 1) * 3; x < 22; x += 6) R(x, y, 1, 3, br[1]); }
  R(2, 5, 20, 1, br[4]); R(2, 5, 1, 14, br[3]); R(21, 5, 1, 14, br[0]);
  // glowing mouth
  ellipse(c, 12, 13, 5, 3, '#1a0806');
  const coal = ['#ffd25a', '#ff8a2a', '#ff5a10', '#c02a08'];
  for (let x = 8; x <= 16; x++) {
    const k = (x + f) % 4;
    const col = coal[k];
    rect(c, x, 14 + (k & 1), 1, 2 - (k & 1), col); rect(g, x, 14 + (k & 1), 1, 2 - (k & 1), col);
  }
  for (let i = 0; i < 3; i++) { const x = 9 + ((f * 3 + i * 4) % 7); const y = 11 + ((i + f) % 3); rect(c, x, y, 1, 1, '#ffd25a'); rect(g, x, y, 1, 1, '#ffb040'); }
  // anvil in front
  const s = P.steel;
  R(4, 19, 8, 2, s[2]); R(3, 19, 1, 1, s[2]); R(4, 19, 8, 1, s[4]); R(6, 21, 4, 2, s[1]); R(5, 23, 6, 1, s[1]);
  // tool rack
  R(16, 19, 6, 4, P.wood[2]); R(17, 17, 1, 3, P.steel[3]); R(20, 16, 1, 4, P.wood[3]);
}

function chest(c, g, open) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const w = P.wood, gd = P.gold;
  if (open) {
    R(1, 1, 12, 4, w[1]); R(1, 1, 12, 1, w[2]);
    R(2, 4, 10, 2, '#1a0e08'); rect(g, 3, 4, 8, 1, gd[3]); rect(c, 3, 4, 8, 1, gd[3]);
  } else {
    R(1, 2, 12, 4, w[2]); R(1, 2, 12, 1, w[3]); R(1, 5, 12, 1, w[1]);
  }
  R(1, 6, 12, 6, w[2]); R(1, 6, 12, 1, w[3]); R(1, 11, 12, 1, w[1]);
  R(1, 2, 1, 10, gd[2]); R(12, 2, 1, 10, gd[1]); R(1, 6, 12, 1, gd[2]);
  R(6, 5, 2, 3, gd[3]); px(c, 6, 7, P.ink);
}

function stairs(c, up) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const st = P.stone;
  if (up) {
    for (let i = 0; i < 5; i++) {
      const y = 12 - i * 3;
      R(1, y, 14, 3, st[4 - Math.min(3, i)] || st[2]);
      R(1, y, 14, 1, st[5 - Math.min(3, i)] || st[3]);
      R(14, y, 1, 3, st[1]);
    }
    R(0, 0, 1, 16, st[1]); R(15, 0, 1, 16, st[0]);
  } else {
    R(0, 0, 16, 16, st[1]);
    R(1, 1, 14, 14, P.void);
    for (let i = 0; i < 4; i++) {
      const y = 1 + i * 3;
      const col = mix(st[3], '#05030a', i / 4);
      R(2 + i, y, 12 - i * 2, 2, col);
      R(2 + i, y, 12 - i * 2, 1, mix(st[4], '#05030a', i / 4));
    }
    R(0, 0, 16, 1, st[3]);
  }
}

function bigTree(c, g, v) {
  const lf = v === 1 ? ['#3a0e2a', '#6a1e4a', '#a83a6a', '#e070a0', '#ffb0d0', '#ffe0f0'] : P.leaf;
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  // trunk with roots
  R(13, 22, 6, 14, P.wood[2]); R(13, 22, 2, 14, P.wood[3]); R(17, 22, 2, 14, P.wood[1]);
  R(10, 34, 4, 2, P.wood[1]); R(18, 34, 4, 2, P.wood[1]);
  // canopy: layered clumps lit from top-left
  const clumps = [[16, 14, 11, 9], [9, 17, 6, 5], [23, 17, 6, 5], [16, 7, 8, 6], [11, 10, 6, 5], [21, 10, 6, 5]];
  for (const [cx, cy, rx, ry] of clumps) ellipse(c, cx, cy + 1, rx, ry, lf[1]);
  for (const [cx, cy, rx, ry] of clumps) ellipse(c, cx - 1, cy, rx - 1, ry - 1, lf[2]);
  for (const [cx, cy, rx, ry] of clumps) ellipse(c, cx - 2, cy - 1, Math.max(1, rx - 4), Math.max(1, ry - 3), lf[3]);
  for (let i = 0; i < 26; i++) {
    const x = 6 + ((hash2(i, 1, v) * 21) | 0), y = 3 + ((hash2(i, 2, v) * 18) | 0);
    px(c, x, y, i % 3 ? lf[4] : lf[3]);
  }
  if (v === 2) for (let i = 0; i < 8; i++) { const x = 8 + ((hash2(i, 5, 2) * 16) | 0), y = 8 + ((hash2(i, 6, 2) * 12) | 0); px(c, x, y, '#ff4a4a'); px(c, x, y - 1, '#ffb0a0'); }
}

function crystalBall(c, g, f) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  R(3, 11, 8, 2, P.wood[2]); R(4, 13, 6, 2, P.wood[1]); R(3, 11, 8, 1, P.wood[3]);
  disc(c, 7, 6, 4, '#5a3ac0');
  disc(g, 7, 6, 3, '#7a5aff');
  const a = f * 0.9;
  rect(c, 7 + Math.round(Math.cos(a) * 2), 6 + Math.round(Math.sin(a) * 2), 2, 1, '#ffb8ff');
  rect(g, 7 + Math.round(Math.cos(a) * 2), 6 + Math.round(Math.sin(a) * 2), 2, 1, '#ffb8ff');
  px(c, 5, 4, '#ffffff');
}

// ------------------------------------------------------------------ registry

export function buildObjects(set, elements) {
  for (const el of elements) set(`pickup_fragment_${el}`, fragmentSheet(el));
  const pot = (liquid, key) => {
    const fr = [0, 1, 2, 3].map((i) => frame(11, 12, (c, g) => { c.translate(0, 1); g.translate(0, 1); potion(c, g, liquid, i); }));
    set(key, assemble(fr, loopAnim(4, 4), 5.5, 11, { emissiveColor: liquid[1] }));
  };
  pot(['#6a0a1a', '#ff3a5a', '#ffb0c0'], 'pickup_health');
  pot(['#0a1a6a', '#3a8aff', '#b0d8ff'], 'pickup_mana');
  set('pickup_item', assemble([0, 1, 2, 3].map((i) => frame(14, 14, (c, g) => {
    c.translate(0, 1); g.translate(0, 1);
    chest(c, g, false);
    if (i === 1) { rect(c, 11, 1, 1, 1, '#ffffff'); rect(g, 11, 1, 1, 1, '#ffffff'); rect(g, 10, 1, 3, 1, '#ffd25a'); }
  })), loopAnim(4, 3), 7, 13));
  set('prop_portal', assemble(Array.from({ length: 8 }, (_, f) => frame(24, 32, (c, g) => portal(c, g, f))), loopAnim(8, 8), 12, 31, { emissiveColor: '#b05aff' }));
  set('prop_tower_door', assemble([frame(24, 32, (c, g) => towerDoor(c, g))], loopAnim(1, 1), 12, 31));
  set('prop_stairs_up', assemble([frame(16, 16, (c) => stairs(c, true), { doOutline: false })], loopAnim(1, 1), 8, 15));
  set('prop_stairs_down', assemble([frame(16, 16, (c) => stairs(c, false), { doOutline: false })], loopAnim(1, 1), 8, 15));
  set('prop_forge', assemble(Array.from({ length: 4 }, (_, f) => frame(24, 25, (c, g) => { c.translate(0, 1); g.translate(0, 1); forge(c, g, f); })), loopAnim(4, 6), 12, 24, { emissiveColor: '#ff8a2a' }));
  const chestSheet = assemble([frame(14, 14, (c, g) => { c.translate(0, 1); chest(c, g, false); }), frame(14, 14, (c, g) => { c.translate(0, 1); g.translate(0, 1); chest(c, g, true); })],
    { idle: { frames: [0], fps: 1, loop: true }, open: { frames: [1], fps: 1, loop: false } }, 7, 13);
  set('prop_chest', chestSheet);
  set('prop_chest_open', assemble([frame(14, 14, (c, g) => { c.translate(0, 1); g.translate(0, 1); chest(c, g, true); })], loopAnim(1, 1), 7, 13));
  for (const [k, v] of [['prop_tree_big', 0], ['prop_tree_blossom', 1], ['prop_tree_apple', 2]]) {
    set(k, assemble([frame(32, 38, (c, g) => { c.translate(0, 1); bigTree(c, g, v); })], loopAnim(1, 1), 16, 37));
  }
  buildWorldProps(set, elements);
  set('prop_crystal_ball', assemble(Array.from({ length: 6 }, (_, f) => frame(14, 16, (c, g) => crystalBall(c, g, f))), loopAnim(6, 6), 7, 15, { emissiveColor: '#7a5aff' }));
}

export { shade, line };
