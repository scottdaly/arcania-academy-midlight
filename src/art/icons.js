// 16x16 icons (team: art+fx): elements, spells, items and UI glyphs.
// Icons have transparent backgrounds and an ink outline so they sit on any UI slot.
import { P, ELEMENT_RAMPS } from './palette.js';
import { makeCanvas, rect, px, line, disc, ellipse, poly, outline, mix, hash2 } from './pixel.js';

const ER = (el) => ELEMENT_RAMPS[el] || ELEMENT_RAMPS.arcane;

// ------------------------------------------------------------------ element glyphs (reused by spells)

function flame(c, x, y, s, rp) {
  // s = scale 1 (small) .. 2 (large); x,y = bottom centre
  const [dk, base, lt, gl] = rp || ER('fire');
  const h = Math.round(7 * s), w = Math.round(3 * s);
  for (let i = 0; i < h; i++) {
    const t = i / h;
    const ww = Math.max(0, Math.round(w * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.15)) * (t < 0.2 ? 0.9 : 1)));
    const off = Math.round(Math.sin(t * 5) * t * s);
    rect(c, x - ww + off, y - i, ww * 2 + 1, 1, dk === undefined ? base : (t > 0.75 ? base : base));
  }
  for (let i = 0; i < h - 2; i++) {
    const t = i / h;
    const ww = Math.max(0, Math.round((w - 1) * Math.sin(Math.PI * Math.min(1, (1 - t) * 1.2))));
    rect(c, x - ww + Math.round(Math.sin(t * 5) * t * s), y - i, ww * 2 + 1, 1, lt);
  }
  for (let i = 0; i < h * 0.5; i++) rect(c, x - (i < 2 ? 1 : 0), y - i, i < 2 ? 3 : 1, 1, gl);
}

function snowflake(c, cx, cy, r, rp) {
  const [dk, base, lt, gl] = rp || ER('ice');
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 2;
    const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
    line(c, cx - dx, cy - dy, cx + dx, cy + dy, base);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 2;
    const bx = cx + Math.cos(a) * r * 0.6, by = cy + Math.sin(a) * r * 0.6;
    px(c, Math.round(bx + Math.cos(a + 1) * 1.5), Math.round(by + Math.sin(a + 1) * 1.5), lt);
    px(c, Math.round(bx + Math.cos(a - 1) * 1.5), Math.round(by + Math.sin(a - 1) * 1.5), lt);
    px(c, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), gl);
  }
  rect(c, cx - 1, cy - 1, 3, 3, lt); px(c, cx, cy, gl);
}

function bolt(c, x, y, s, rp) {
  const [dk, base, lt, gl] = rp || ER('lightning');
  const pts = [[3, 0], [0, 5], [2, 5], [-1, 11], [4, 4], [2, 4], [4, 0]].map(([a, b]) => [x + a * s, y + b * s]);
  poly(c, pts.flat(), base);
  line(c, pts[0][0], pts[0][1], pts[1][0] + 1, pts[1][1], lt);
  line(c, pts[2][0], pts[2][1], pts[3][0], pts[3][1], gl);
}

function star(c, cx, cy, r, col, col2) {
  poly(c, [cx, cy - r, cx + r * 0.3, cy - r * 0.3, cx + r, cy, cx + r * 0.3, cy + r * 0.3, cx, cy + r, cx - r * 0.3, cy + r * 0.3, cx - r, cy, cx - r * 0.3, cy - r * 0.3], col);
  if (col2) rect(c, cx - 1, cy - 1, 2, 2, col2);
}

function leaf(c, cx, cy, rp) {
  const [dk, base, lt, gl] = rp || ER('earth');
  ellipse(c, cx, cy, 3, 5, base);
  line(c, cx, cy + 6, cx, cy - 4, dk);
  px(c, cx - 1, cy - 2, lt); px(c, cx - 2, cy, lt);
}

function orb(c, cx, cy, r, rp) {
  const [dk, base, lt, gl] = rp;
  disc(c, cx, cy, r, base);
  disc(c, cx - 1, cy - 1, Math.max(1, r - 2), lt);
  rect(c, cx - Math.ceil(r / 2), cy - Math.ceil(r / 2), 2, 2, gl);
}

/** Paint a string grid: each char maps to a colour in `pal` ('.' = transparent). */
function grid(c, rows, pal, ox = 0, oy = 0) {
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = pal[row[x]]; if (col) { c.fillStyle = col; c.fillRect(ox + x, oy + y, 1, 1); } } });
}

const FIRE_ROWS = [
  '.......1........',
  '......12........',
  '......121.......',
  '.....1221...1...',
  '.....12321..11..',
  '....122321..121.',
  '...1223321.1221.',
  '..122333221223 1',
  '..1223443222321.',
  '.12234443323321.',
  '.12234454433321.',
  '.12334555443321.',
  '..1234555543321.',
  '..123345554321..',
  '...1223443321...',
  '.....111111.....',
];
const BOLT_ROWS = [
  '.........1111...',
  '........12221...',
  '.......12321....',
  '......12331.....',
  '.....12331......',
  '....123311111...',
  '...1233333321...',
  '...1111123321...',
  '......12331.....',
  '.....12331......',
  '....1231........',
  '...1231.........',
  '..121...........',
  '.121............',
  '.11.............',
  '................',
];
const EARTH_ROWS = [
  '..........66....',
  '.........6776...',
  '......6..676....',
  '.....676.66.....',
  '......6766......',
  '.......66.......',
  '......1111......',
  '....11222211....',
  '...1223332211...',
  '..122343332211..',
  '..123443332221..',
  '.1223333322211..',
  '.1222333222111..',
  '..11222221111...',
  '....111111......',
  '................',
];

const ELEMENT_ICON = {
  fire: (c) => grid(c, FIRE_ROWS, { 1: '#8a1a08', 2: '#e0400e', 3: '#ff8a2a', 4: '#ffd25a', 5: '#fff8d0' }),
  ice: (c) => { snowflake(c, 8, 8, 6); },
  lightning: (c) => grid(c, BOLT_ROWS, { 1: '#8a6a10', 2: '#ffe14a', 3: '#fff8c0' }),
  arcane: (c) => { const [dk, b, l, g] = ER('arcane'); disc(c, 8, 8, 6, dk); star(c, 8, 8, 6, b, g); px(c, 8, 4, l); },
  earth: (c) => grid(c, EARTH_ROWS, { 1: '#3a2a18', 2: '#6a5032', 3: '#8a6a44', 4: '#b8986a', 6: '#3a7a2e', 7: '#8fd04a' }),
  physical: (c) => { line(c, 3, 13, 12, 4, P.steel[3]); line(c, 4, 13, 13, 4, P.steel[2]); rect(c, 3, 10, 4, 1, P.brass[3]); rect(c, 2, 13, 2, 2, P.leather[2]); },
};

// ------------------------------------------------------------------ spells

const SPELL_ICON = {
  firebolt: (c) => {
    for (let i = 0; i < 5; i++) line(c, 2 + i, 13 - i * 0.2, 7, 9, i % 2 ? '#ff6a1f' : '#c0281a');
    orb(c, 10, 6, 4, ER('fire'));
    px(c, 4, 10, '#ffd25a'); px(c, 3, 12, '#ff8a2a');
  },
  frost_shard: (c) => {
    const [dk, b, l, g] = ER('ice');
    for (const [a, len] of [[-0.5, 9], [0, 11], [0.5, 9]]) {
      const ang = -Math.PI / 4 + a;
      const x0 = 3, y0 = 13, x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      line(c, x0, y0, x1, y1, b); line(c, x0 + 1, y0, x1, y1, l); px(c, Math.round(x1), Math.round(y1), g);
    }
  },
  spark: (c) => {
    orb(c, 8, 8, 3, ER('lightning'));
    for (const [x0, y0, x1, y1] of [[8, 4, 6, 1], [11, 8, 14, 6], [8, 11, 10, 14], [5, 8, 2, 10], [10, 5, 13, 2]]) line(c, x0, y0, x1, y1, '#ffe14a');
    px(c, 6, 1, '#ffffff'); px(c, 14, 6, '#ffffff');
  },
  steam_burst: (c) => {
    for (const [x, y, r] of [[5, 10, 3], [10, 10, 3], [8, 7, 4], [4, 6, 2], [12, 6, 2]]) disc(c, x, y, r, '#c8d0e0');
    for (const [x, y, r] of [[8, 6, 2], [4, 9, 1], [11, 9, 2]]) disc(c, x, y, r, '#ffffff');
    rect(c, 3, 13, 10, 1, '#ff6a1f'); px(c, 5, 12, '#ffd25a'); px(c, 10, 12, '#4fc8ff'); px(c, 12, 13, '#4fc8ff');
  },
  plasma_lance: (c) => {
    line(c, 2, 14, 13, 3, '#ff5ad8'); line(c, 3, 14, 14, 3, '#ff5ad8');
    line(c, 2, 13, 13, 2, '#ffe14a');
    line(c, 3, 13, 13, 3, '#ffffff');
    disc(c, 13, 3, 2, '#ffffff');
    px(c, 8, 6, '#ffe14a'); px(c, 6, 11, '#ff8a2a');
  },
  glacial_storm: (c) => {
    c.strokeStyle = '#4fc8ff';
    for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2; px(c, Math.round(8 + Math.cos(t) * 6), Math.round(8 + Math.sin(t) * 6), a % 3 ? '#4fc8ff' : '#ffffff'); }
    snowflake(c, 8, 8, 3);
    line(c, 13, 2, 11, 5, '#ffe14a'); line(c, 11, 5, 13, 6, '#ffe14a'); px(c, 2, 13, '#ffe14a'); px(c, 3, 12, '#ffe14a');
  },
  meteor: (c) => {
    for (let i = 0; i < 6; i++) line(c, 14 - i, 1 + i * 0.3, 9, 6, ['#ffd25a', '#ff8a2a', '#ff6a1f', '#c0281a'][i % 4]);
    disc(c, 6, 10, 4, '#5a4030'); disc(c, 5, 9, 2, '#8a6a4a'); px(c, 7, 12, '#ff6a1f'); px(c, 8, 9, '#ff8a2a'); px(c, 3, 11, '#3a2418');
  },
  prism_nova: (c) => {
    const cols = ['#ff6a1f', '#ffe14a', '#7aff5a', '#4fc8ff', '#b05aff', '#ff5ad8'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      line(c, 8, 8, 8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, cols[i % 6]);
    }
    disc(c, 8, 8, 2, '#ffffff');
  },
  boss_bolt: (c) => {
    orb(c, 8, 8, 5, ['#24082e', '#a02aa8', '#e070e0', '#ffffff']);
    px(c, 6, 7, '#7aff5a'); px(c, 9, 7, '#7aff5a');
  },
};

/** Generic spell icon composed from the spell's elements + kind. */
function composeSpell(c, spell) {
  const els = (spell?.elements?.length ? spell.elements : [spell?.element || 'arcane']).slice(0, 3);
  const kind = spell?.kind || 'projectile';
  const rps = els.map(ER);
  if (kind === 'projectile') {
    for (let i = 0; i < 5; i++) line(c, 2 + i * 0.5, 14, 8, 8, rps[i % rps.length][i & 1 ? 1 : 0]);
    orb(c, 10, 6, 4, rps[0]);
    if (rps[1]) { px(c, 12, 5, rps[1][2]); px(c, 9, 4, rps[1][1]); }
  } else if (kind === 'aoe') {
    ellipse(c, 8, 11, 7, 3, rps[0][0]);
    ellipse(c, 8, 11, 5, 2, rps[0][1]);
    for (let i = 0; i < 4; i++) line(c, 4 + i * 3, 10, 5 + i * 2, 2 + (i & 1) * 2, rps[i % rps.length][2]);
  } else if (kind === 'nova') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      px(c, Math.round(8 + Math.cos(a) * 6), Math.round(8 + Math.sin(a) * 6), rps[i % rps.length][1]);
      px(c, Math.round(8 + Math.cos(a) * 4), Math.round(8 + Math.sin(a) * 4), rps[(i + 1) % rps.length][2]);
    }
    disc(c, 8, 8, 2, rps[0][3]);
  } else {
    ellipse(c, 8, 13, 5, 2, rps[0][0]);
    for (let i = 0; i < 5; i++) line(c, 4 + i * 2, 13, 4 + i * 2 + (i & 1), 3 + (i % 3), rps[i % rps.length][1 + (i & 1)]);
    star(c, 8, 6, 3, rps[0][2], rps[0][3]);
  }
}

// ------------------------------------------------------------------ items

const STAFF_STYLES = {
  apprentice: { wood: P.wood, head: 'gem', gem: ER('arcane') },
  oak: { wood: P.wood, head: 'leaf', gem: ER('earth') },
  ember: { wood: P.woodDark, head: 'flame', gem: ER('fire') },
  fire: { wood: P.woodDark, head: 'flame', gem: ER('fire') },
  frost: { wood: P.steel, head: 'crystal', gem: ER('ice') },
  ice: { wood: P.steel, head: 'crystal', gem: ER('ice') },
  stormcaller: { wood: P.steel, head: 'bolt', gem: ER('lightning') },
  storm: { wood: P.steel, head: 'bolt', gem: ER('lightning') },
  lightning: { wood: P.steel, head: 'bolt', gem: ER('lightning') },
  arcane: { wood: P.woodDark, head: 'star', gem: ER('arcane') },
  void: { wood: P.woodDark, head: 'star', gem: ER('corrupt') },
  archmage: { wood: P.gold, head: 'star', gem: ER('arcane') },
  earth: { wood: P.wood, head: 'leaf', gem: ER('earth') },
};

function staffIcon(c, st, tier) {
  const w = st.wood;
  line(c, 2, 14, 10, 6, w[1]); line(c, 3, 14, 11, 6, w[2]); line(c, 3, 13, 10, 6, w[3]);
  if (tier >= 2) { px(c, 5, 11, P.gold[3]); px(c, 7, 9, P.gold[3]); }
  if (tier >= 3) { rect(c, 9, 7, 2, 2, P.gold[3]); px(c, 8, 9, P.gold[2]); }
  const [dk, b, l, g] = st.gem;
  const hx = 11, hy = 4;
  if (st.head === 'flame') { line(c, 9, 6, 9, 3, w[2]); line(c, 13, 6, 13, 3, w[2]); flame(c, 11, 6, 0.75, st.gem); }
  else if (st.head === 'crystal') { poly(c, [hx, hy - 4, hx + 2, hy, hx, hy + 3, hx - 2, hy], b); line(c, hx - 1, hy - 1, hx, hy - 3, l); px(c, hx, hy - 4, g); px(c, hx + 3, hy - 3, l); px(c, hx - 3, hy + 1, l); }
  else if (st.head === 'bolt') { disc(c, hx, hy, 2, b); px(c, hx - 1, hy - 1, g); line(c, hx + 2, hy - 2, hx + 4, hy - 4, l); line(c, hx - 2, hy - 2, hx - 3, hy - 4, l); px(c, hx + 3, hy + 1, g); }
  else if (st.head === 'leaf') { disc(c, hx, hy, 2, b); px(c, hx - 1, hy - 1, l); rect(c, hx + 1, hy - 3, 2, 1, '#5aa848'); rect(c, hx - 3, hy - 1, 2, 1, '#3a7a2e'); }
  else if (st.head === 'star') { star(c, hx, hy, 4, b, g); px(c, hx + 3, hy - 3, l); }
  else { disc(c, hx, hy, 2, b); px(c, hx - 1, hy - 1, g); }
}

const ROBE_STYLES = {
  novice: { ramp: P.robeBlue, trim: P.robeWhite },
  scholar: { ramp: P.robeGreen, trim: P.gold, ink: true },
  archmage: { ramp: P.robeViolet, trim: P.gold, stars: true },
  fire: { ramp: P.robeRed, trim: P.gold }, ember: { ramp: P.robeRed, trim: P.gold },
  frost: { ramp: P.robeTeal, trim: P.robeWhite }, ice: { ramp: P.robeTeal, trim: P.robeWhite },
  storm: { ramp: P.robeBlue, trim: P.gold }, battle: { ramp: P.robeBrown, trim: P.brass },
  shadow: { ramp: P.corrupt, trim: P.fel },
};

function robeIcon(c, st) {
  const r = st.ramp, t = st.trim;
  poly(c, [5, 2, 11, 2, 12, 5, 14, 14, 2, 14, 4, 5], r[2]);
  poly(c, [5, 2, 4, 5, 2, 14, 4, 14, 6, 5], r[3]);
  poly(c, [11, 2, 12, 5, 14, 14, 12, 14, 10, 5], r[1]);
  rect(c, 7, 3, 2, 11, t[2]); rect(c, 2, 13, 13, 1, t[1]);
  rect(c, 6, 2, 4, 1, r[0]);
  rect(c, 3, 8, 11, 1, P.leather[1]); px(c, 8, 8, P.gold[3]);
  if (st.stars) { px(c, 4, 11, P.gold[4]); px(c, 12, 10, P.gold[4]); px(c, 10, 5, P.gold[3]); }
  if (st.ink) { px(c, 11, 11, P.ink); px(c, 12, 12, P.ink); }
}

function potionIcon(c, liquid) {
  const [d, b, l] = liquid;
  rect(c, 6, 1, 4, 2, P.wood[3]); rect(c, 6, 3, 4, 2, '#c8d8f0');
  disc(c, 8, 10, 5, '#a8c0e0');
  disc(c, 8, 10, 4, b);
  rect(c, 4, 9, 9, 1, l);
  ellipse(c, 8, 12, 3, 1, d);
  px(c, 5, 8, '#ffffff'); px(c, 6, 7, '#ffffff');
}

function itemIcon(c, id, def) {
  const name = id.replace(/^item_/, '');
  const slot = def?.slot || (name.startsWith('staff') ? 'staff' : name.startsWith('robe') ? 'robe' : name.startsWith('potion') ? 'consumable' : 'material');
  const tier = { common: 1, rare: 2, epic: 3, legendary: 4 }[def?.rarity] || 1;
  const words = name.split('_');
  if (slot === 'staff') {
    const style = words.map((w) => STAFF_STYLES[w]).find(Boolean) || STAFF_STYLES.apprentice;
    staffIcon(c, style, tier);
  } else if (slot === 'robe') {
    const style = words.map((w) => ROBE_STYLES[w]).find(Boolean) || ROBE_STYLES.novice;
    robeIcon(c, style);
  } else if (slot === 'consumable') {
    const mana = name.includes('mana');
    const elix = name.includes('elixir') || name.includes('greater');
    potionIcon(c, mana ? ['#0a1a6a', '#3a8aff', '#b0d8ff'] : elix ? ['#3a0a5a', '#b05aff', '#ffb8ff'] : ['#6a0a1a', '#ff3a5a', '#ffb0c0']);
  } else if (slot === 'key') {
    disc(c, 5, 6, 3, P.gold[2]); disc(c, 5, 6, 1, 'rgba(0,0,0,0)'); c.clearRect(4, 5, 2, 2);
    rect(c, 7, 6, 7, 2, P.gold[2]); rect(c, 11, 8, 1, 3, P.gold[2]); rect(c, 13, 8, 1, 2, P.gold[2]); rect(c, 7, 6, 7, 1, P.gold[4]);
  } else {
    const el = words.find((w) => ELEMENT_RAMPS[w]) || 'arcane';
    const rp = ER(el);
    poly(c, [8, 1, 13, 6, 8, 15, 3, 6], rp[1]);
    poly(c, [8, 1, 3, 6, 8, 7], rp[2]);
    poly(c, [8, 1, 13, 6, 8, 7], rp[0]);
    px(c, 7, 4, rp[3]);
  }
}

// ------------------------------------------------------------------ UI glyphs

const UI_ICON = {
  heart: (c) => { disc(c, 5, 6, 3, '#d8203a'); disc(c, 10, 6, 3, '#d8203a'); poly(c, [2, 7, 13, 7, 8, 14], '#d8203a'); rect(c, 4, 4, 2, 2, '#ff8a9a'); },
  mana: (c) => { poly(c, [8, 1, 13, 9, 8, 15, 3, 9], '#2a6ae0'); poly(c, [8, 1, 3, 9, 8, 10], '#5aaeff'); px(c, 6, 7, '#ffffff'); },
  lock: (c) => { rect(c, 4, 7, 8, 7, P.gold[2]); rect(c, 4, 7, 8, 1, P.gold[4]); rect(c, 5, 3, 1, 4, P.steel[3]); rect(c, 10, 3, 1, 4, P.steel[3]); rect(c, 6, 2, 4, 1, P.steel[3]); rect(c, 7, 9, 2, 3, P.ink); },
  gear: (c) => { for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; rect(c, Math.round(7 + Math.cos(a) * 6), Math.round(7 + Math.sin(a) * 6), 2, 2, P.steel[3]); } disc(c, 8, 8, 5, P.steel[2]); disc(c, 8, 8, 2, P.ink); },
  bag: (c) => { ellipse(c, 8, 10, 5, 4, P.leather[3]); rect(c, 6, 3, 4, 3, P.leather[2]); rect(c, 5, 5, 6, 1, P.gold[3]); px(c, 6, 9, P.leather[4]); },
  book: (c) => { rect(c, 3, 3, 10, 11, '#7a2430'); rect(c, 4, 4, 8, 9, '#9a3440'); rect(c, 11, 3, 2, 11, P.cream); star(c, 7, 8, 3, P.gold[3]); },
  star: (c) => { star(c, 8, 8, 7, P.gold[3], P.gold[4]); },
  close: (c) => { line(c, 3, 3, 12, 12, '#ff5a6a'); line(c, 4, 3, 13, 12, '#ff5a6a'); line(c, 12, 3, 3, 12, '#ff5a6a'); line(c, 13, 3, 4, 12, '#ff5a6a'); },
  check: (c) => { line(c, 2, 8, 6, 12, '#5aff8a'); line(c, 3, 8, 7, 12, '#5aff8a'); line(c, 6, 12, 13, 3, '#5aff8a'); line(c, 7, 12, 14, 3, '#5aff8a'); },
  arrow: (c) => { poly(c, [3, 6, 9, 6, 9, 3, 14, 8, 9, 13, 9, 10, 3, 10], P.gold[3]); },
  coin: (c) => { disc(c, 8, 8, 6, P.gold[2]); disc(c, 7, 7, 4, P.gold[3]); rect(c, 7, 5, 2, 6, P.gold[1]); },
  skull: (c) => { disc(c, 8, 7, 5, P.marble[3]); rect(c, 5, 11, 6, 3, P.marble[3]); rect(c, 5, 6, 2, 2, P.ink); rect(c, 9, 6, 2, 2, P.ink); px(c, 8, 9, P.ink); rect(c, 6, 13, 1, 1, P.ink); rect(c, 9, 13, 1, 1, P.ink); },
  scroll: (c) => { rect(c, 3, 3, 10, 10, P.cream); rect(c, 2, 2, 12, 2, P.sand[2]); rect(c, 2, 12, 12, 2, P.sand[2]); for (let y = 5; y < 11; y += 2) rect(c, 5, y, 6, 1, P.sand[1]); },
  map: (c) => { poly(c, [2, 3, 6, 2, 10, 4, 14, 3, 14, 13, 10, 14, 6, 12, 2, 13], P.sand[3]); line(c, 6, 2, 6, 12, P.sand[1]); line(c, 10, 4, 10, 14, P.sand[1]); line(c, 4, 9, 12, 6, '#d8203a'); },
  sword: (c) => { ELEMENT_ICON.physical(c); },
  shield: (c) => { poly(c, [3, 2, 13, 2, 13, 8, 8, 14, 3, 8], P.steel[2]); poly(c, [5, 4, 11, 4, 11, 8, 8, 11, 5, 8], '#3a4a8a'); px(c, 8, 6, P.gold[3]); },
  hourglass: (c) => { rect(c, 3, 1, 10, 2, P.wood[3]); rect(c, 3, 13, 10, 2, P.wood[3]); poly(c, [4, 3, 12, 3, 8, 8], '#c8d8f0'); poly(c, [4, 13, 12, 13, 8, 8], '#c8d8f0'); poly(c, [6, 13, 10, 13, 8, 10], P.sand[3]); },
  sound: (c) => { rect(c, 2, 6, 3, 4, P.steel[3]); poly(c, [5, 6, 9, 2, 9, 14, 5, 10], P.steel[3]); line(c, 11, 5, 12, 8, P.steel[4]); line(c, 12, 8, 11, 11, P.steel[4]); line(c, 13, 3, 14, 8, P.steel[4]); line(c, 14, 8, 13, 13, P.steel[4]); },
  music: (c) => { rect(c, 6, 2, 1, 10, P.gold[3]); rect(c, 12, 1, 1, 10, P.gold[3]); rect(c, 6, 1, 7, 2, P.gold[3]); disc(c, 4, 12, 2, P.gold[3]); disc(c, 10, 11, 2, P.gold[3]); },
  pause: (c) => { rect(c, 4, 3, 3, 10, P.white); rect(c, 9, 3, 3, 10, P.white); },
  craft: (c) => { rect(c, 2, 8, 12, 3, P.steel[2]); rect(c, 2, 8, 12, 1, P.steel[4]); rect(c, 5, 11, 6, 2, P.steel[1]); rect(c, 3, 13, 10, 1, P.steel[1]); line(c, 9, 1, 12, 6, P.wood[3]); rect(c, 7, 1, 4, 2, P.steel[3]); },
  fragment: (c) => { poly(c, [8, 1, 13, 6, 8, 15, 3, 6], '#b05aff'); poly(c, [8, 1, 3, 6, 8, 7], '#ffb8ff'); px(c, 7, 4, '#ffffff'); },
  potion: (c) => potionIcon(c, ['#6a0a1a', '#ff3a5a', '#ffb0c0']),
  interact: (c) => { disc(c, 8, 8, 6, P.gold[2]); rect(c, 7, 4, 2, 6, P.ink); rect(c, 7, 11, 2, 2, P.ink); },
  spellbook: (c) => { UI_ICON.book(c); },
  inventory: (c) => UI_ICON.bag(c),
  settings: (c) => UI_ICON.gear(c),
  quest: (c) => UI_ICON.scroll(c),
  hp: (c) => UI_ICON.heart(c),
  mp: (c) => UI_ICON.mana(c),
};

function runeGlyph(c, key) {
  const h = (i) => hash2(i, key.length, key.charCodeAt(i % key.length) || 1);
  disc(c, 8, 8, 6, '#2a1a4a');
  for (let i = 0; i < 4; i++) line(c, 4 + h(i) * 8, 4 + h(i + 9) * 8, 4 + h(i + 3) * 8, 4 + h(i + 5) * 8, '#c08aff');
}

// ------------------------------------------------------------------ public

/** Paint the icon for `key` into a fresh 16x16 canvas. lookup(kind, id) -> def|null for spells/items. */
export function buildIcon(key, lookup) {
  const { canvas, ctx: c } = makeCanvas(16, 16);
  try {
    if (key.startsWith('element_')) (ELEMENT_ICON[key.slice(8)] || ((g) => runeGlyph(g, key)))(c);
    else if (key.startsWith('spell_')) {
      const id = key.slice(6);
      if (SPELL_ICON[id]) SPELL_ICON[id](c);
      else composeSpell(c, lookup?.('spell', id));
    } else if (key.startsWith('item_')) itemIcon(c, key, lookup?.('item', key.slice(5)));
    else if (key.startsWith('ui_')) (UI_ICON[key.slice(3)] || ((g) => runeGlyph(g, key)))(c);
    else runeGlyph(c, key);
  } catch (err) {
    console.warn('[art] icon failed', key, err);
    runeGlyph(c, key);
  }
  outline(canvas);
  return canvas;
}

export { mix };
