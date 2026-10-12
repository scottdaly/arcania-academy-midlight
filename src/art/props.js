// World props that world probes with hasSprite (team: art+fx): signs, shrines, barriers,
// element geodes, quest tomes and the Mage Tower exterior.
import { P, ELEMENT_RAMPS } from './palette.js';
import { rect, px, line, ellipse, poly, hash2 } from './pixel.js';
import { frame, assemble } from './sheet.js';

const loopAnim = (n, fps) => ({ idle: { frames: Array.from({ length: n }, (_, i) => i), fps, loop: true } });

function sign(c) {
  const w = P.wood;
  rect(c, 6, 8, 2, 8, w[1]); px(c, 6, 8, w[3]);
  rect(c, 1, 2, 12, 7, w[3]); rect(c, 1, 2, 12, 1, w[4]); rect(c, 1, 8, 12, 1, w[1]); rect(c, 1, 2, 1, 7, w[4]);
  for (const y of [4, 6]) rect(c, 3, y, 8, 1, w[1]);
  px(c, 2, 3, P.steel[3]); px(c, 11, 3, P.steel[3]);
  rect(c, 4, 14, 6, 2, P.grass[3]);
}

function shrine(c, g, f) {
  const m = P.marble;
  rect(c, 2, 16, 14, 4, m[1]); rect(c, 2, 16, 14, 1, m[3]);
  rect(c, 4, 9, 10, 7, m[2]); rect(c, 4, 9, 3, 7, m[3]); rect(c, 12, 9, 2, 7, m[1]);
  ellipse(c, 9, 9, 6, 2, m[3]); ellipse(c, 9, 9, 4, 1, '#2a8a7a');
  rect(c, 7, 12, 4, 2, '#1a6a5a'); px(c, 8, 12, '#7affc8');
  const y = 2 + [0, 1, 1, 0, -1, -1][f % 6];
  const col = ['#1a6a5a', '#3ac8a0', '#7affc8', '#e0fff4'];
  const both = (fn) => { fn(c); fn(g); };
  both((k) => poly(k, [9, y - 1, 12, y + 3, 9, y + 7, 6, y + 3], col[1]));
  both((k) => poly(k, [9, y - 1, 6, y + 3, 9, y + 3], col[2]));
  both((k) => rect(k, 8, y + 1, 1, 2, col[3]));
  if (f % 3 === 0) both((k) => rect(k, 3, y + 2, 1, 1, col[3]));
  if (f % 3 === 1) both((k) => rect(k, 14, y + 4, 1, 1, col[3]));
}

function barrier(c, g, f) {
  const cols = ['#3a1a7a', '#7a3ac0', '#b05aff', '#ffb8ff'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const a = ((x + y + f) % 6 === 0) || ((x - y + 64 - f) % 6 === 0);
    const edge = x === 0 || x === 15 || y === 0;
    if (!a && !edge) continue;
    const col = edge ? cols[2] : ((x * 7 + y * 3 + f) % 5 === 0 ? cols[3] : cols[1]);
    rect(c, x, y, 1, 1, col); rect(g, x, y, 1, 1, col);
  }
  const ry = 4 + (f % 3);
  for (const [x, y] of [[7, ry], [8, ry], [6, ry + 1], [9, ry + 1], [7, ry + 2], [8, ry + 2]]) { rect(c, x, y, 1, 1, '#ffffff'); rect(g, x, y, 1, 1, '#ffffff'); }
}

function geode(c, g, el, f) {
  const rp = ELEMENT_RAMPS[el] || ELEMENT_RAMPS.arcane;
  const s = P.stone;
  ellipse(c, 8, 12, 7, 4, s[2]); ellipse(c, 7, 11, 5, 3, s[3]); ellipse(c, 8, 12, 4, 2, s[0]);
  const shard = (x0, h, w) => {
    poly(c, [x0, 13, x0 + w / 2, 13 - h, x0 + w, 13], rp[1]); poly(g, [x0, 13, x0 + w / 2, 13 - h, x0 + w, 13], rp[1]);
    line(c, x0 + 1, 12, x0 + w / 2, 14 - h, rp[2]); line(g, x0 + 1, 12, x0 + w / 2, 14 - h, rp[2]);
  };
  shard(3, 6, 4); shard(9, 7, 4); shard(5, 10, 5);
  const tip = f % 4 === 0 ? '#ffffff' : rp[3];
  rect(c, 7, 3, 1, 1, tip); rect(g, 7, 3, 1, 1, tip);
  if (f % 4 === 2) { rect(c, 13, 5, 1, 1, rp[3]); rect(g, 13, 5, 1, 1, rp[3]); }
}

function tome(c, g, f) {
  rect(c, 1, 3, 10, 6, '#5a1a2a'); rect(c, 1, 3, 10, 1, '#8a2a3a');
  rect(c, 2, 2, 8, 1, P.cream); rect(c, 10, 3, 1, 6, P.cream);
  rect(c, 4, 5, 3, 2, P.gold[3]); px(c, 5, 4, P.gold[4]);
  rect(g, 5, 5, 1, 1, P.gold[4]);
  if (f % 2) { rect(c, 11, 1, 1, 1, '#ffffff'); rect(g, 11, 1, 1, 1, '#ffd25a'); }
}

function mageTower(c, g, f) {
  const W = 72, H = 150;
  const st = ['#140c22', '#24183a', '#36265a', '#4a3878', '#62509a', '#8a78c0'];
  for (let y = 30; y < H; y++) {
    const taper = Math.round((H - y) * 0.06);
    const x0 = 12 + taper, x1 = W - 12 - taper;
    for (let x = x0; x < x1; x++) {
      const t = (x - x0) / (x1 - x0);
      const row = Math.floor((y - 30) / 6);
      const off = (row & 1) * 5;
      const mortar = (y - 30) % 6 === 5 || ((x - x0 + off) % 10 === 0);
      let i = t < 0.18 ? 4 : t < 0.45 ? 3 : t < 0.8 ? 2 : 1;
      if (mortar) i -= 1;
      if (hash2(x, y, 3) < 0.05) i -= 1;
      rect(c, x, y, 1, 1, st[Math.max(0, i)]);
    }
  }
  // spiral of glowing runes
  for (let k = 0; k < 26; k++) {
    const y = 40 + k * 4.2;
    const taper = Math.round((H - y) * 0.06);
    const x0 = 12 + taper, x1 = W - 12 - taper;
    const t = Math.sin(k * 0.55) * 0.5 + 0.5;
    const x = Math.round(x0 + 3 + t * (x1 - x0 - 6));
    const col = (k + f) % 6 === 0 ? '#ffb8ff' : '#7a4aff';
    rect(c, x, Math.round(y), 2, 1, col); rect(g, x, Math.round(y), 2, 1, col);
  }
  // windows
  const glass = ['#e8c8ff', '#b08aff', '#7a3aff'];
  for (const [wx, wy] of [[33, 44], [22, 70], [44, 70], [33, 96], [22, 120], [44, 120]]) {
    rect(c, wx - 1, wy - 2, 8, 13, '#0e0818');
    for (let y = 0; y < 10; y++) { const col = glass[Math.min(2, Math.floor(y / 4))]; rect(c, wx, wy + y, 6, 1, col); rect(g, wx, wy + y, 6, 1, col); }
    rect(c, wx + 2, wy, 2, 10, '#0e0818'); rect(c, wx, wy + 4, 6, 1, '#0e0818');
    rect(c, wx - 1, wy + 10, 8, 1, st[5]);
  }
  // balconies
  for (const by of [86, 58]) {
    const taper = Math.round((H - by) * 0.06);
    const bw = W - 12 - taper * 2;
    rect(c, 6 + taper, by, bw, 3, st[2]); rect(c, 6 + taper, by, bw, 1, st[5]);
    for (let x = 8 + taper; x < W - 8 - taper; x += 4) rect(c, x, by - 4, 1, 4, st[3]);
    rect(c, 6 + taper, by - 5, bw, 1, st[4]);
  }
  // door
  rect(c, 28, 128, 16, 22, '#0e0818');
  for (let x = 29; x < 43; x++) {
    const dy = Math.round(130 - Math.sqrt(Math.max(0, 49 - (x - 35.5) * (x - 35.5))) * 0.6);
    rect(c, x, dy, 1, 150 - dy, x % 4 ? P.woodDark[2] : P.woodDark[1]);
  }
  rect(c, 34, 128, 4, 2, '#c08aff'); rect(g, 34, 128, 4, 2, '#c08aff');
  // conical roof with gold trim
  for (let y = 4; y < 31; y++) {
    const half = Math.round((y - 4) * 0.98) + 2;
    for (let x = 36 - half; x < 36 + half; x++) {
      const t = (x - (36 - half)) / (half * 2);
      rect(c, x, y, 1, 1, t < 0.3 ? '#4a2a8a' : t < 0.7 ? '#36206a' : '#24144a');
    }
  }
  rect(c, 8, 30, 56, 2, P.gold[2]); rect(c, 8, 30, 56, 1, P.gold[4]);
  // floating crystal crown (animated)
  const fy = 1 + [0, 1, 1, 0][f % 4];
  const cc = ['#3a1a7a', '#b05aff', '#ffb8ff', '#ffffff'];
  for (const k of [c, g]) {
    poly(k, [36, fy - 1, 39, fy + 3, 36, fy + 8, 33, fy + 3], cc[1]);
    poly(k, [36, fy - 1, 33, fy + 3, 36, fy + 3], cc[2]);
    rect(k, 35, fy + 2, 1, 2, cc[3]);
  }
}

export function buildWorldProps(set, elements) {
  set('prop_sign', assemble([frame(14, 17, (c) => { c.translate(0, 1); sign(c); })], loopAnim(1, 1), 7, 16));
  set('prop_shrine', assemble(Array.from({ length: 6 }, (_, f) => frame(18, 21, (c, g) => { c.translate(0, 1); g.translate(0, 1); shrine(c, g, f); })), loopAnim(6, 6), 9, 20, { emissiveColor: '#7affc8' }));
  set('prop_barrier', assemble(Array.from({ length: 6 }, (_, f) => frame(16, 16, (c, g) => barrier(c, g, f), { doOutline: false })), loopAnim(6, 10), 8, 15, { emissiveColor: '#b05aff' }));
  for (const el of elements) {
    set(`prop_geode_${el}`, assemble(Array.from({ length: 4 }, (_, f) => frame(16, 17, (c, g) => { c.translate(0, 1); g.translate(0, 1); geode(c, g, el, f); })), loopAnim(4, 4), 8, 16));
  }
  set('prop_tome', assemble([0, 1].map((f) => frame(13, 11, (c, g) => { c.translate(0, 1); g.translate(0, 1); tome(c, g, f); })), loopAnim(2, 3), 6, 10));
  set('prop_mage_tower', assemble(Array.from({ length: 4 }, (_, f) => frame(72, 150, (c, g) => mageTower(c, g, f))), loopAnim(4, 3), 36, 149, { emissiveColor: '#b05aff', glowBloom: false }));
}
