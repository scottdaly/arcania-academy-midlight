// Wizards, NPCs, the cat familiar and dialogue portraits (team: art+fx).
// One parametric painter draws every robed character in three facings (down / up / side),
// with walk, cast, hurt and a dissolve death. Frame: 16x24, feet anchor at (8, 22).
import { P } from './palette.js';
import { rect, px, line, ellipse, disc, poly, mix, shade } from './pixel.js';
import { frame, assemble, dissolveFrames, tinted } from './sheet.js';

const FW = 16, FH = 24, AX = 8, AY = 22;

/**
 * Character spec:
 *  robe, trim, skin, hair: 5-step ramps
 *  hat: {style:'pointed'|'hood'|'cap'|'none'|'crown'|'wide', ramp, band?, stars?}
 *  hairStyle: 'short'|'long'|'bun'|'spiky'
 *  beard?: ramp, glasses?, goggles?, apron?: ramp, scarf?: ramp
 *  hold: 'staff'|'book'|'flask'|'wand'|'hammer'|null, staffWood, gem (css)
 *  small?: bool (students: 1px shorter)
 */
function paintWizard(c, g, s, dir, pose) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const G = (x, y, w, h, col) => { rect(c, x, y, w, h, col); rect(g, x, y, w, h, col); };
  const b = pose.bob || 0;
  const sm = s.small ? 1 : 0;
  const robe = s.robe, trim = s.trim, skin = s.skin, hair = s.hair;
  const hy = 8 + b + sm; // head top row
  const by = 14 + b + sm; // body top row
  const step = pose.step || 0;
  const cast = pose.arm === 'cast' || pose.arm === 'cast2';
  const lean = pose.hurt ? -1 : 0;

  // ---------- feet
  const boot = s.boots || P.leather;
  if (dir === 'side') {
    const fA = 8 + step, fB = 5 - step;
    R(fB, 21, 3, 2, boot[1]); R(fA, 21, 3, 2, boot[2]); px(c, fA + 2, 21, boot[3]);
  } else {
    const l = step > 0 ? 1 : 0, r = step < 0 ? 1 : 0;
    R(5, 21 - l, 2, 2, boot[2]); R(9, 21 - r, 2, 2, boot[2]);
    px(c, 5, 21 - l, boot[3]); px(c, 9, 21 - r, boot[3]);
  }

  // ---------- robe body (A-line)
  const sway = dir === 'side' ? (step > 0 ? 1 : 0) : 0;
  const rows = [];
  for (let y = by; y <= 20; y++) {
    const d = y - by;
    let x0 = d < 2 ? 5 : d < 4 ? 4 : 3, x1 = d < 2 ? 10 : d < 4 ? 11 : 12;
    if (dir === 'side') { x0 = d < 3 ? 5 : 4; x1 = d < 3 ? 10 : 11 + (y >= 19 ? sway : 0); }
    rows.push([y, x0 + lean, x1 + lean]);
  }
  for (const [y, x0, x1] of rows) {
    R(x0, y, x1 - x0 + 1, 1, robe[2]);
    px(c, x0, y, robe[3]);
    R(x1 - 1, y, 2, 1, robe[1]);
  }
  R(rows[rows.length - 1][1], 20, rows[rows.length - 1][2] - rows[rows.length - 1][1] + 1, 1, robe[1]);
  // fold shading
  if (dir !== 'up') for (let y = by + 4; y < 20; y += 2) px(c, (dir === 'side' ? 6 : 5) + lean, y, robe[1]);

  if (s.apron && dir !== 'up') {
    const a = s.apron;
    const ax0 = dir === 'side' ? 8 : 5, aw = dir === 'side' ? 3 : 6;
    R(ax0 + lean, by + 2, aw, 20 - by - 2, a[2]);
    R(ax0 + lean, by + 2, aw, 1, a[3]);
    if (dir === 'down') { R(6 + lean, by + 4, 2, 2, a[1]); px(c, 9 + lean, by + 5, a[1]); }
  }

  // trim: front opening + hem
  if (dir === 'down') {
    R(7 + lean, by + 1, 2, 20 - by - 1, trim[2]);
    px(c, 7 + lean, by + 1, trim[3]);
    R(rows[rows.length - 1][1] + 1, 20, 10, 1, trim[1]);
  } else if (dir === 'side') {
    R(4, 20, 8 + sway, 1, trim[1]);
    px(c, 10 + lean, by + 2, trim[2]); px(c, 10 + lean, by + 3, trim[2]);
  } else {
    R(4, 20, 8, 1, trim[1]);
  }
  // belt / sash
  const belt = s.belt || P.leather;
  if (dir === 'side') { R(5 + lean, by + 2, 6, 1, belt[1]); px(c, 9 + lean, by + 2, P.gold[3]); }
  else { R(5 + lean, by + 2, 6, 1, belt[1]); if (dir === 'down') px(c, 8 + lean, by + 2, P.gold[3]); }

  // ---------- arms & held item
  const sleeve = robe;
  const hold = s.hold;
  const gem = s.gem || '#b05aff';
  const wood = s.staffWood || P.wood;
  if (dir === 'side') {
    if (cast) {
      const up = pose.arm === 'cast2' ? 1 : 0;
      R(8 + lean, by, 3, 2, sleeve[3]); R(10 + lean, by - up, 2, 2, sleeve[2]);
      px(c, 12 + lean, by - up, skin[3]);
      if (hold === 'staff' || hold === 'wand') {
        line(c, 13, by - 7 - up, 11, 21 - (hold === 'wand' ? 12 : 0), wood[2]);
        line(c, 14, by - 7 - up, 12, 21 - (hold === 'wand' ? 12 : 0), wood[1]);
        G(13, by - 9 - up, 2, 2, gem); px(g, 13, by - 9 - up, '#ffffff'); px(c, 13, by - 9 - up, '#ffffff');
      } else if (hold === 'book') {
        R(11, by - 1, 3, 3, s.bookColor || '#7a2430'); px(c, 12, by - 1, P.cream);
      }
      // cast spark
      G(14, by - 2 - up, 1, 1, '#ffffff'); G(15, by - 3 - up, 1, 1, gem);
    } else {
      R(7 + lean, by + 1, 3, 4, sleeve[3]); R(8 + lean, by + 4, 2, 1, sleeve[1]);
      px(c, 10 + lean, by + 4, skin[2]);
      if (hold === 'staff') {
        R(11 + lean, 4 + b, 1, 18 - b, wood[2]); px(c, 11 + lean, 4 + b, wood[3]);
        G(10 + lean, 2 + b, 3, 2, gem); px(c, 10 + lean, 2 + b, '#ffffff');
      } else if (hold === 'book') {
        R(9 + lean, by + 2, 3, 4, s.bookColor || '#7a2430'); R(9 + lean, by + 2, 1, 4, P.cream);
      } else if (hold === 'flask') {
        R(10 + lean, by + 3, 1, 1, P.white); G(10 + lean, by + 4, 2, 2, gem);
      } else if (hold === 'hammer') {
        R(11 + lean, by - 1, 1, 7, wood[2]); R(10 + lean, by - 2, 3, 2, P.steel[2]); px(c, 10 + lean, by - 2, P.steel[3]);
      } else if (hold === 'wand') {
        line(c, 11 + lean, by + 4, 13 + lean, by + 1, wood[1]); G(13 + lean, by, 1, 1, gem);
      }
    }
  } else {
    // front / back
    const L = dir === 'down' ? 3 : 11, Rr = dir === 'down' ? 11 : 3; // free hand / item hand columns
    if (cast) {
      const up = pose.arm === 'cast2' ? 1 : 0;
      R(3, by - 1 - up, 2, 3, sleeve[3]); R(11, by - 1 - up, 2, 3, sleeve[1]);
      px(c, 3, by - 2 - up, skin[3]); px(c, 12, by - 2 - up, skin[2]);
      if (hold === 'staff' || hold === 'wand') {
        const sx = dir === 'down' ? 13 : 2;
        R(sx, by - 8 - up, 1, hold === 'wand' ? 8 : 22 - by + 8, wood[2]);
        G(sx - 1, by - 10 - up, 3, 2, gem); px(c, sx, by - 10 - up, '#ffffff'); px(g, sx, by - 10 - up, '#ffffff');
      }
      G(8 - (dir === 'down' ? 0 : 1), by - 3 - up, 1, 1, '#ffffff');
      if (dir === 'down') { G(7, by - 4 - up, 1, 1, gem); G(9, by - 4 - up, 1, 1, gem); }
    } else {
      R(L, by + 1, 2, 4, dir === 'down' ? sleeve[3] : sleeve[1]); R(Rr, by + 1, 2, 4, dir === 'down' ? sleeve[1] : sleeve[3]);
      if (dir === 'down') { px(c, L, by + 5, skin[2]); px(c, Rr + 1, by + 5, skin[1]); }
      const ix = dir === 'down' ? 13 : 2;
      if (hold === 'staff') {
        R(ix, 4 + b, 1, 18 - b, wood[2]); px(c, ix, 4 + b, wood[3]);
        G(ix - 1, 2 + b, 3, 2, gem); px(c, ix, 2 + b, '#ffffff');
      } else if (hold === 'book' && dir === 'down') {
        R(6, by + 3, 4, 3, s.bookColor || '#7a2430'); R(6, by + 3, 4, 1, P.cream); px(c, 9, by + 5, P.gold[3]);
      } else if (hold === 'flask' && dir === 'down') {
        px(c, 12, by + 4, P.white); G(12, by + 5, 2, 2, gem);
      } else if (hold === 'hammer') {
        R(ix, by - 1, 1, 7, wood[2]); R(ix - 1, by - 2, 3, 2, P.steel[2]);
      }
    }
  }

  // ---------- scarf
  if (s.scarf) {
    const sc = s.scarf;
    R(5 + lean, by, 6, 1, sc[2]);
    if (dir === 'down') { R(9, by + 1, 1, 3, sc[2]); px(c, 9, by + 3, sc[1]); }
    else if (dir === 'side') { R(4, by + 1, 1, 2, sc[1]); }
  }

  // ---------- head
  const hx = 5 + lean;
  R(hx, hy, 6, 6, skin[2]);
  px(c, hx, hy, 'rgba(0,0,0,0)'); // corners trimmed below
  c.clearRect(hx, hy + 5, 1, 1); c.clearRect(hx + 5, hy + 5, 1, 1);
  if (dir === 'down') {
    px(c, hx, hy + 2, skin[3]); R(hx + 5, hy + 1, 1, 4, skin[1]);
    // hair framing
    R(hx, hy, 6, 2, hair[2]); px(c, hx, hy + 2, hair[2]); px(c, hx + 5, hy + 2, hair[1]); px(c, hx + 1, hy, hair[3]);
    if (s.hairStyle === 'long') { R(hx - 1, hy + 1, 1, 6, hair[1]); R(hx + 6, hy + 1, 1, 6, hair[1]); R(hx, hy + 2, 1, 3, hair[2]); R(hx + 5, hy + 2, 1, 3, hair[1]); }
    // eyes
    const ey = hy + 3;
    if (pose.hurt) { R(hx + 1, ey, 2, 1, P.ink); R(hx + 3, ey, 2, 1, P.ink); }
    else if (s.glasses) { px(c, hx + 1, ey, '#bfe8ff'); px(c, hx + 4, ey, '#bfe8ff'); R(hx + 2, ey, 2, 1, P.gold[2]); }
    else { px(c, hx + 1, ey, s.eyes || P.ink); px(c, hx + 4, ey, s.eyes || P.ink); }
    if (s.eyesGlow) { G(hx + 1, ey, 1, 1, s.eyesGlow); G(hx + 4, ey, 1, 1, s.eyesGlow); }
    px(c, hx + 1, ey + 1, mix(skin[2], '#ff7a8a', 0.35)); px(c, hx + 4, ey + 1, mix(skin[2], '#ff7a8a', 0.35));
  } else if (dir === 'side') {
    // face on the right, hair at the back
    R(hx, hy, 3, 5, hair[2]); px(c, hx, hy + 4, hair[1]); R(hx + 3, hy, 3, 2, hair[2]);
    px(c, hx + 6, hy + 3, skin[2]); // nose
    if (s.hairStyle === 'long') R(hx - 1, hy + 1, 2, 7, hair[1]);
    if (s.hairStyle === 'bun') { R(hx - 2, hy, 2, 2, hair[2]); px(c, hx - 2, hy, hair[3]); }
    const ey = hy + 3;
    if (pose.hurt) R(hx + 4, ey, 2, 1, P.ink);
    else if (s.glasses) { px(c, hx + 4, ey, '#bfe8ff'); px(c, hx + 5, ey, P.gold[2]); }
    else px(c, hx + 4, ey, s.eyes || P.ink);
    if (s.eyesGlow) G(hx + 4, ey, 1, 1, s.eyesGlow);
    px(c, hx + 4, ey + 1, mix(skin[2], '#ff7a8a', 0.35));
  } else {
    R(hx, hy, 6, 6, hair[2]); R(hx + 4, hy + 1, 2, 4, hair[1]); px(c, hx + 1, hy + 1, hair[3]);
    if (s.hairStyle === 'long') { R(hx, hy + 5, 6, 3, hair[1]); }
    if (s.hairStyle === 'bun') { R(hx + 2, hy - 1, 2, 2, hair[2]); }
  }

  // ---------- beard
  if (s.beard && dir !== 'up') {
    const bd = s.beard;
    if (dir === 'down') {
      R(hx + 1, hy + 4, 4, 2, bd[3]); R(hx + 1, hy + 6, 4, 3, bd[2]); R(hx + 2, hy + 9, 2, 2, bd[2]); px(c, hx + 2, hy + 11, bd[1]);
      px(c, hx + 1, hy + 4, bd[4]); R(hx + 4, hy + 6, 1, 3, bd[1]);
      px(c, hx + 2, hy + 4, mix(skin[1], bd[1], 0.5));
    } else {
      R(hx + 3, hy + 4, 3, 2, bd[3]); R(hx + 3, hy + 6, 3, 3, bd[2]); R(hx + 4, hy + 9, 2, 1, bd[1]);
    }
  }

  // ---------- goggles
  if (s.goggles) {
    if (dir === 'down') { R(hx - 1, hy + 1, 8, 1, P.leather[1]); R(hx, hy, 2, 2, P.brass[3]); R(hx + 4, hy, 2, 2, P.brass[3]); px(c, hx, hy, '#bff8ff'); px(c, hx + 4, hy, '#bff8ff'); }
    else if (dir === 'side') { R(hx, hy + 1, 6, 1, P.leather[1]); R(hx + 4, hy, 2, 2, P.brass[3]); px(c, hx + 5, hy, '#bff8ff'); }
    else R(hx - 1, hy + 1, 8, 1, P.leather[1]);
  }

  // ---------- hat
  const h = s.hat || { style: 'none' };
  const hr = h.ramp || robe;
  const ty = hy; // brim row
  if (h.style === 'pointed' || h.style === 'wide') {
    const wide = h.style === 'wide' ? 1 : 0;
    // brim
    R(2 - wide + lean, ty, 12 + wide * 2, 1, hr[2]); R(3 - wide + lean, ty + 1, 10 + wide * 2, 1, hr[1]);
    px(c, 2 - wide + lean, ty, hr[3]);
    if (dir === 'side') {
      const cone = [[4, 7], [4, 6], [3, 5], [3, 4], [2, 3], [1, 2]];
      cone.forEach(([x0, w], i) => { const y = ty - 1 - i; if (y >= 1) { R(x0 + 1 + lean, y, w, 1, hr[2]); px(c, x0 + 1 + lean, y, hr[3]); px(c, x0 + w + lean, y, hr[1]); } });
      if (h.band) R(5 + lean, ty - 1, 7, 1, h.band);
      if (h.stars) { px(c, 7 + lean, ty - 3, P.gold[4]); px(c, 5 + lean, ty - 5, P.gold[3]); }
    } else {
      const cone = [[4, 8], [5, 6], [5, 5], [6, 4], [6, 3], [7, 2]];
      cone.forEach(([x0, w], i) => {
        const y = ty - 1 - i;
        if (y < 1) return;
        const xx = x0 + (i >= 4 ? 1 : 0) + lean;
        R(xx, y, w, 1, hr[2]);
        px(c, xx, y, dir === 'down' ? hr[3] : hr[1]); px(c, xx + w - 1, y, dir === 'down' ? hr[1] : hr[3]);
      });
      if (ty - 7 >= 1) px(c, 9 + lean, ty - 7, hr[2]);
      if (h.band) R(4 + lean, ty - 1, 8, 1, h.band);
      if (h.stars && dir === 'down') { G(6 + lean, ty - 3, 1, 1, P.gold[4]); px(c, 9 + lean, ty - 5, P.gold[3]); px(c, 8 + lean, ty - 2, P.gold[3]); }
    }
  } else if (h.style === 'hood') {
    if (dir === 'up') { R(hx - 1, hy - 1, 8, 8, hr[2]); R(hx + 4, hy, 2, 6, hr[1]); px(c, hx, hy, hr[3]); }
    else if (dir === 'down') {
      R(hx - 1, hy - 1, 8, 2, hr[2]); R(hx - 1, hy + 1, 1, 6, hr[2]); R(hx + 6, hy + 1, 1, 6, hr[1]); px(c, hx, hy - 1, hr[3]);
      R(hx, hy + 1, 1, 1, hr[1]); R(hx + 5, hy + 1, 1, 1, hr[1]);
    } else { R(hx - 1, hy - 1, 6, 8, hr[2]); R(hx + 4, hy - 1, 2, 2, hr[2]); px(c, hx, hy - 1, hr[3]); }
  } else if (h.style === 'cap') {
    R(hx - 1, hy - 1, 8, 2, hr[2]); px(c, hx, hy - 1, hr[3]); R(hx + 4, hy - 2, 2, 1, hr[2]);
    if (h.band) R(hx - 1, hy + 1, 8, 1, h.band);
  } else if (h.style === 'crown') {
    R(hx, hy - 1, 6, 2, P.gold[3]); px(c, hx, hy - 2, P.gold[3]); px(c, hx + 2, hy - 2, P.gold[4]); px(c, hx + 5, hy - 2, P.gold[3]);
    G(hx + 3, hy, 1, 1, '#ff3a8a');
  } else if (s.hairStyle === 'spiky') {
    px(c, hx, hy - 1, hair[2]); px(c, hx + 2, hy - 1, hair[3]); px(c, hx + 4, hy - 1, hair[2]);
  } else if (s.hairStyle === 'bun' && dir === 'down') {
    R(hx + 2, hy - 2, 2, 2, hair[2]); px(c, hx + 2, hy - 2, hair[3]);
  }
}

const DIRS = ['side', 'down', 'up'];

/** Build a full directional wizard sheet. defaultDir: which facing the plain anim names use. */
export function wizardSheet(spec, { defaultDir = 'side', dieTint = [210, 180, 255] } = {}) {
  const frames = [];
  const anims = {};
  const add = (f) => frames.push(f) - 1;
  for (const dir of DIRS) {
    const mk = (pose) => add(frame(FW, FH, (c, g) => paintWizard(c, g, spec, dir, pose)));
    const i0 = mk({ bob: 0 }), i1 = mk({ bob: 1 });
    const w = [mk({ step: 1, bob: 0 }), mk({ step: 0, bob: 1 }), mk({ step: -1, bob: 0 }), mk({ step: 0, bob: 1 })];
    const c0 = mk({ arm: 'cast' }), c1 = mk({ arm: 'cast2' });
    const hurtF = add(tinted(frame(FW, FH, (c, g) => paintWizard(c, g, spec, dir, { hurt: true }))));
    const suf = dir === defaultDir ? '' : null;
    const set = (name, a) => {
      anims[`${name}_${dir}`] = a;
      if (suf === '') anims[name] = a;
    };
    set('idle', { frames: [i0, i0, i1, i1], fps: 3, loop: true });
    set('walk', { frames: w, fps: 8, loop: true });
    set('cast', { frames: [c0, c1, c1], fps: 12, loop: false });
    set('attack', { frames: [c0, c1, c1], fps: 12, loop: false });
    set('hurt', { frames: [hurtF], fps: 1, loop: false });
  }
  // dissolve death (from the default facing's hurt frame)
  const src = frames[anims.hurt.frames[0]];
  const dieStart = frames.length;
  for (const f of dissolveFrames(src, 5, dieTint)) frames.push(f);
  anims.die = { frames: [anims.hurt.frames[0], dieStart, dieStart + 1, dieStart + 2, dieStart + 3, dieStart + 4], fps: 7, loop: false };
  for (const d of DIRS) anims[`die_${d}`] = anims.die;
  return assemble(frames, anims, AX, AY, { dirs: true });
}

// ------------------------------------------------------------------ cast of characters

export const CHARACTERS = {
  player: {
    robe: P.robeViolet, trim: P.gold, skin: P.skin, hair: P.hairBrown, hairStyle: 'short',
    hat: { style: 'pointed', ramp: P.robeBlue, band: P.gold[3] }, hold: 'staff', gem: '#c08aff',
  },
  npc_headmaster: {
    robe: P.robeWhite, trim: P.robeBlue, skin: P.skin, hair: P.hairWhite, beard: P.hairWhite,
    hat: { style: 'pointed', ramp: P.robeBlue, band: P.gold[3], stars: true }, hold: 'staff', gem: '#5ad8ff',
    staffWood: P.woodDark,
  },
  npc_librarian: {
    robe: P.robeGreen, trim: P.gold, skin: P.skin, hair: P.hairRed, hairStyle: 'bun', glasses: true,
    hat: { style: 'none' }, hold: 'book', bookColor: '#7a2430', scarf: null,
  },
  npc_alchemist: {
    robe: P.robeRed, trim: P.brass, skin: P.skinDark, hair: P.hairBlack, hairStyle: 'short', goggles: true,
    apron: P.leather, hat: { style: 'none' }, hold: 'flask', gem: '#7aff5a',
  },
  npc_artificer: {
    robe: P.robeBrown, trim: P.brass, skin: P.skin, hair: P.hairBlond, hairStyle: 'spiky', goggles: true,
    apron: P.leather, hat: { style: 'none' }, hold: 'hammer',
  },
  npc_forgemaster: {
    robe: P.robeBrown, trim: P.brass, skin: P.skinDark, hair: P.hairBlack, beard: P.hairBlack, goggles: true,
    apron: P.leather, hat: { style: 'none' }, hold: 'hammer',
  },
  npc_duelmaster: {
    robe: P.robeRed, trim: P.gold, skin: P.skin, hair: P.hairBlack, hairStyle: 'short', scarf: P.gold,
    hat: { style: 'cap', ramp: P.robeRed, band: P.gold[3] }, hold: 'wand', gem: '#ff6a1f',
  },
  npc_student: {
    robe: P.robeBlue, trim: P.robeWhite, skin: P.skin, hair: P.hairBlond, hairStyle: 'short', small: true,
    scarf: P.robeRed, hat: { style: 'none' }, hold: 'book', bookColor: '#2a4a8a',
  },
  npc_student2: {
    robe: P.robeTeal, trim: P.gold, skin: P.skinDark, hair: P.hairBlack, hairStyle: 'long', small: true,
    hat: { style: 'pointed', ramp: P.robeTeal }, hold: 'wand', gem: '#5ad8ff',
  },
  npc_student3: {
    robe: P.robeViolet, trim: P.robeWhite, skin: P.skin, hair: P.hairRed, hairStyle: 'spiky', small: true,
    scarf: P.gold, hat: { style: 'none' }, hold: null,
  },
  npc_archmage: {
    robe: P.robeViolet, trim: P.gold, skin: P.skin, hair: P.hairWhite, beard: P.hairWhite,
    hat: { style: 'pointed', ramp: P.robeViolet, band: P.gold[3], stars: true }, hold: 'staff', gem: '#ffd25a', staffWood: P.gold,
  },
  npc_rival: {
    robe: P.robeRed, trim: P.steel, skin: P.skin, hair: P.hairBlond, hairStyle: 'spiky', scarf: P.robeRed,
    hat: { style: 'none' }, hold: 'wand', gem: '#ff3a5a', boots: P.woodDark,
  },
  npc_quartermaster: {
    robe: P.robeBrown, trim: P.brass, skin: P.skinDark, hair: P.hairBrown, beard: P.hairBrown, apron: P.leather,
    hat: { style: 'cap', ramp: P.robeGreen, band: P.brass[3] }, hold: 'book', bookColor: '#4a3a1a',
  },
  npc_healer: {
    robe: P.robeWhite, trim: P.robeGreen, skin: P.skin, hair: P.hairBlond, hairStyle: 'bun', apron: P.robeWhite,
    hat: { style: 'hood', ramp: P.robeTeal }, hold: 'flask', gem: '#7affc8',
  },
  npc_student_shy: {
    robe: P.robeGreen, trim: P.gold, skin: P.skin, hair: P.hairBlack, hairStyle: 'long', small: true, glasses: true,
    hat: { style: 'none' }, hold: 'book', bookColor: '#5a1a2a', scarf: P.robeTeal,
  },
  npc_ghost: {
    robe: P.ghost, trim: P.ghost, skin: P.ghost, hair: P.ghost, hat: { style: 'hood', ramp: P.ghost }, eyesGlow: '#ffffff', hold: null,
  },
};

/** Deterministic random wizard for unknown npc_* keys. */
export function randomWizardSpec(seed) {
  const robes = [P.robeBlue, P.robeGreen, P.robeRed, P.robeTeal, P.robeViolet, P.robeBrown, P.robeWhite];
  const hairs = [P.hairBrown, P.hairRed, P.hairBlond, P.hairBlack, P.hairWhite];
  const hats = ['pointed', 'hood', 'cap', 'none', 'none'];
  const holds = ['staff', 'book', 'wand', null];
  const pick = (a, k) => a[(seed >>> k) % a.length];
  return {
    robe: pick(robes, 0), trim: P.gold, skin: (seed & 8) ? P.skinDark : P.skin, hair: pick(hairs, 3),
    hairStyle: pick(['short', 'long', 'bun', 'spiky'], 6), hat: { style: pick(hats, 9), ramp: pick(robes, 12) },
    hold: pick(holds, 15), gem: pick(['#b05aff', '#5ad8ff', '#ff6a1f', '#ffe14a', '#7aff5a'], 18),
  };
}

// ------------------------------------------------------------------ cat familiar

export function catSheet(fur = P.hairBlack, eyes = '#7aff5a') {
  const W = 14, H = 12;
  const frames = [];
  const paint = (pose) => frame(W, H, (c, g) => {
    const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
    const sit = pose.sit;
    const bob = pose.bob || 0;
    const tail = pose.tail || 0;
    if (sit) {
      // sitting cat facing right, tail curling
      R(3, 5, 6, 6, fur[2]); R(4, 4, 4, 2, fur[2]); R(3, 10, 7, 1, fur[1]);
      R(7, 1 + bob, 5, 5, fur[2]); px(c, 7, 0 + bob, fur[2]); px(c, 11, 0 + bob, fur[2]); px(c, 8, 1 + bob, fur[3]);
      rect(c, 9, 3 + bob, 1, 1, eyes); rect(g, 9, 3 + bob, 1, 1, eyes); rect(c, 11, 3 + bob, 1, 1, eyes); rect(g, 11, 3 + bob, 1, 1, eyes);
      px(c, 12, 4 + bob, '#ff8aa8');
      const tx = [[1, 9], [1, 8], [2, 7]][tail] || [1, 9];
      R(tx[0], tx[1], 2, 1, fur[1]); R(1, 9, 3, 2, fur[1]); px(c, tx[0], tx[1] - 1, fur[2]);
      R(4, 5, 1, 4, fur[3]);
      R(6, 8, 1, 1, P.gold[3]); // collar tag
      R(7, 6, 3, 1, '#9a2432');
    } else {
      const st = pose.step || 0;
      R(2, 4, 9, 4, fur[2]); R(2, 4, 9, 1, fur[3]);
      R(3 + st, 8, 1, 3, fur[1]); R(5 - st, 8, 1, 3, fur[2]); R(8 + st, 8, 1, 3, fur[1]); R(10 - st, 8, 1, 3, fur[2]);
      R(9, 1, 4, 4, fur[2]); px(c, 9, 0, fur[2]); px(c, 12, 0, fur[2]);
      rect(c, 11, 2, 1, 1, eyes); rect(g, 11, 2, 1, 1, eyes);
      px(c, 13, 3, '#ff8aa8');
      line(c, 2, 4, 0, 1 + st, fur[1]);
      R(9, 5, 2, 1, '#9a2432');
    }
  });
  frames.push(paint({ sit: true }), paint({ sit: true, tail: 1 }), paint({ sit: true, bob: 1, tail: 2 }), paint({ sit: true, tail: 1 }));
  frames.push(paint({ step: 0 }), paint({ step: 1 }), paint({ step: 0 }), paint({ step: -1 }));
  const hurt = tinted(frames[0]);
  frames.push(hurt);
  const d = dissolveFrames(frames[0], 4, [120, 255, 120]);
  frames.push(...d);
  const anims = {
    idle: { frames: [0, 0, 1, 2, 1, 0, 0, 3], fps: 3, loop: true },
    walk: { frames: [4, 5, 6, 7], fps: 10, loop: true },
    hurt: { frames: [8], fps: 1, loop: false },
    cast: { frames: [2], fps: 1, loop: false }, attack: { frames: [2], fps: 1, loop: false },
    die: { frames: [8, 9, 10, 11, 12], fps: 8, loop: false },
  };
  return assemble(frames, anims, 7, 11);
}

// ------------------------------------------------------------------ portraits (32x32)

export function portraitSheet(spec, opts = {}) {
  const f = frame(32, 32, (c, g) => paintPortrait(c, g, spec, opts, 0), { doOutline: false });
  const f2 = frame(32, 32, (c, g) => paintPortrait(c, g, spec, opts, 1), { doOutline: false });
  return assemble([f, f2], { idle: { frames: [0, 0, 0, 0, 0, 0, 0, 1], fps: 3, loop: true }, talk: { frames: [0, 1], fps: 6, loop: true } }, 0, 0);
}

function paintPortrait(c, g, s, opts, blink) {
  const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
  const robe = s.robe, skin = s.skin, hair = s.hair, trim = s.trim;
  // framed background
  const bg = opts.bg || mix(robe[0], '#0b0716', 0.4);
  R(0, 0, 32, 32, P.ink);
  R(1, 1, 30, 30, bg);
  for (let y = 1; y < 31; y++) if (y % 2) R(1, y, 30, 1, mix(bg, '#000000', 0.12));
  ellipse(c, 16, 14, 12, 11, mix(bg, robe[3], 0.18));
  // shoulders / robe
  R(4, 25, 24, 6, robe[2]); R(6, 23, 20, 2, robe[2]); R(4, 25, 3, 6, robe[3]); R(24, 25, 4, 6, robe[1]);
  R(14, 23, 4, 8, trim[2]); px(c, 14, 23, trim[3]);
  if (s.apron) R(9, 26, 14, 5, s.apron[2]);
  if (s.scarf) { R(8, 22, 16, 2, s.scarf[2]); R(18, 24, 2, 4, s.scarf[1]); }
  // neck + head
  R(13, 20, 6, 4, skin[1]);
  ellipse(c, 16, 14, 7, 8, skin[2]);
  R(10, 10, 2, 8, skin[3]);
  R(21, 9, 2, 9, skin[1]);
  // hair
  R(9, 5, 14, 4, hair[2]); R(9, 7, 2, 7, hair[2]); R(21, 7, 2, 7, hair[1]); R(10, 5, 5, 1, hair[3]);
  if (s.hairStyle === 'long') { R(7, 8, 3, 15, hair[2]); R(22, 8, 3, 15, hair[1]); }
  if (s.hairStyle === 'bun') { disc(c, 16, 3, 3, hair[2]); px(c, 15, 1, hair[3]); }
  if (s.hairStyle === 'spiky') { for (let i = 0; i < 5; i++) { px(c, 10 + i * 3, 4, hair[2]); px(c, 11 + i * 3, 3, hair[3]); } }
  // eyes
  const ey = 14;
  if (blink) { R(11, ey + 1, 3, 1, P.ink); R(18, ey + 1, 3, 1, P.ink); }
  else {
    const ec = s.eyesGlow || s.eyeColor || '#3a2a6a';
    R(11, ey, 3, 3, P.white); R(18, ey, 3, 3, P.white);
    R(12, ey, 2, 3, ec); R(19, ey, 2, 3, ec);
    px(c, 12, ey, '#ffffff'); px(c, 19, ey, '#ffffff');
    if (s.eyesGlow) { rect(g, 12, ey, 2, 3, s.eyesGlow); rect(g, 19, ey, 2, 3, s.eyesGlow); }
  }
  R(11, ey - 2, 3, 1, hair[1]); R(18, ey - 2, 3, 1, hair[1]); // brows
  px(c, 16, ey + 3, skin[1]); px(c, 16, ey + 4, skin[1]); // nose
  R(10, ey + 4, 2, 1, mix(skin[2], '#ff6a8a', 0.4)); R(20, ey + 4, 2, 1, mix(skin[2], '#ff6a8a', 0.4));
  R(15, ey + 6, 3, 1, skin[0]); // mouth
  if (s.glasses) {
    c.strokeStyle = P.gold[2]; c.lineWidth = 1;
    R(10, ey - 1, 5, 1, P.gold[2]); R(17, ey - 1, 5, 1, P.gold[2]); R(10, ey + 3, 5, 1, P.gold[2]); R(17, ey + 3, 5, 1, P.gold[2]);
    R(10, ey - 1, 1, 5, P.gold[2]); R(14, ey - 1, 1, 5, P.gold[2]); R(17, ey - 1, 1, 5, P.gold[2]); R(21, ey - 1, 1, 5, P.gold[2]);
    R(15, ey, 2, 1, P.gold[2]);
  }
  if (s.beard) {
    const bd = s.beard;
    ellipse(c, 16, 22, 7, 6, bd[2]); R(10, 18, 12, 3, bd[2]); R(13, 26, 6, 4, bd[2]); R(15, 29, 2, 2, bd[1]);
    R(11, 19, 2, 5, bd[3]); R(20, 19, 2, 6, bd[1]);
    R(13, 18, 6, 1, bd[3]); R(14, 20, 4, 1, skin[0]);
  }
  if (s.goggles) {
    R(8, 8, 16, 2, P.leather[1]);
    disc(c, 12, 8, 2, P.brass[3]); disc(c, 20, 8, 2, P.brass[3]);
    R(11, 7, 2, 2, '#bff8ff'); R(19, 7, 2, 2, '#bff8ff');
  }
  // hat
  const h = s.hat || { style: 'none' };
  const hr = h.ramp || robe;
  if (h.style === 'pointed' || h.style === 'wide') {
    // cone leaning right, then the brim over it
    poly(c, [8, 8, 24, 8, 20, 2, 25, 0, 17, 1, 12, 4], hr[2]);
    poly(c, [8, 8, 12, 4, 14, 3, 12, 8], hr[3]);
    poly(c, [19, 8, 24, 8, 20, 2, 18, 4], hr[1]);
    if (h.band) R(9, 6, 15, 2, h.band);
    R(2, 8, 28, 2, hr[2]); R(3, 10, 26, 1, hr[1]); R(2, 8, 6, 1, hr[3]);
    if (h.stars) { rect(c, 14, 3, 1, 1, P.gold[4]); rect(g, 14, 3, 1, 1, P.gold[4]); px(c, 19, 5, P.gold[3]); px(c, 11, 6, P.gold[3]); }
  } else if (h.style === 'hood') {
    R(6, 3, 20, 5, hr[2]); R(6, 3, 3, 22, hr[2]); R(23, 3, 3, 22, hr[1]); R(7, 3, 6, 1, hr[3]);
  } else if (h.style === 'cap') {
    R(8, 3, 16, 4, hr[2]); R(8, 3, 5, 1, hr[3]); if (h.band) R(8, 6, 16, 1, h.band);
  }
  // corner frame accents
  for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) px(c, x, y, P.gold[3]);
}

export const PORTRAIT_BG = {
  player: '#2a1a5a', headmaster: '#1a2a5a', librarian: '#163a2a', alchemist: '#4a1a14', duelmaster: '#4a0e18',
  student: '#1a2a4a', artificer: '#3a2414', forgemaster: '#3a2414', archmage: '#2a1450', rival: '#3a0e18',
  quartermaster: '#2a2414', healer: '#123a30', shy: '#14302a', wanderer: '#1a2440',
};

export { shade };

// ------------------------------------------------------------------ special portraits

export function specialPortrait(id) {
  const paint = (c, g, t) => {
    const R = (x, y, w, h, col) => rect(c, x, y, w, h, col);
    R(0, 0, 32, 32, P.ink);
    if (id === 'cat') {
      R(1, 1, 30, 30, '#1a1430');
      const fur = P.hairBlack;
      ellipse(c, 16, 26, 11, 6, fur[2]);
      ellipse(c, 16, 16, 10, 8, fur[2]); ellipse(c, 14, 14, 6, 5, fur[3]);
      for (const sx of [8, 24]) { const d = sx < 16 ? 1 : -1; for (let i = 0; i < 6; i++) R(sx - (d > 0 ? 0 : i) + (d > 0 ? 0 : 0), 4 + i, Math.max(1, 6 - i), 1, fur[2]); }
      R(7, 4, 2, 4, fur[2]); R(23, 4, 2, 4, fur[2]); R(8, 6, 1, 2, '#ff8aa8'); R(23, 6, 1, 2, '#ff8aa8');
      const eye = '#7aff5a';
      if (t) { R(10, 15, 4, 1, eye); R(18, 15, 4, 1, eye); }
      else { for (const ex of [10, 18]) { R(ex, 13, 4, 4, eye); R(ex + 1, 13, 2, 4, P.ink); px(c, ex, 13, '#ffffff'); rect(g, ex, 13, 4, 4, eye); } }
      R(15, 18, 2, 1, '#ff8aa8'); px(c, 14, 19, fur[0]); px(c, 17, 19, fur[0]);
      for (const y of [18, 20]) { R(3, y, 7, 1, fur[4]); R(22, y, 7, 1, fur[4]); }
      R(10, 24, 12, 2, '#9a2432'); R(15, 25, 2, 2, P.gold[3]);
    } else if (id === 'portal') {
      R(1, 1, 30, 30, '#0e0620');
      for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) {
        const dx = x - 15.5, dy = y - 15.5, r = Math.hypot(dx, dy) / 14;
        if (r > 1) continue;
        const a = Math.atan2(dy, dx) + r * 5 + t * 0.6;
        const v = Math.sin(a * 3) * 0.3 + (1 - r);
        const col = v > 0.9 ? '#ffffff' : v > 0.6 ? '#ffb8ff' : v > 0.35 ? '#b05aff' : v > 0.1 ? '#6a3ac0' : '#2a1060';
        R(x, y, 1, 1, col); if (v > 0.35) rect(g, x, y, 1, 1, col);
      }
    } else if (id === 'sign') {
      R(1, 1, 30, 30, '#20301a');
      R(14, 16, 4, 15, P.wood[1]);
      R(3, 5, 26, 13, P.wood[3]); R(3, 5, 26, 1, P.wood[4]); R(3, 17, 26, 1, P.wood[1]);
      for (const y of [8, 11, 14]) R(6, y, 20, 1, P.wood[1]);
      px(c, 4, 6, P.steel[3]); px(c, 27, 6, P.steel[3]);
    } else {
      R(1, 1, 30, 30, '#1a1430');
      for (let i = 0; i < 6; i++) R(6 + i * 3, 10 + (i & 1) * 4, 2, 2, '#c08aff');
    }
    for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) px(c, x, y, P.gold[3]);
  };
  const f0 = frame(32, 32, (c, g) => paint(c, g, 0), { doOutline: false });
  const f1 = frame(32, 32, (c, g) => paint(c, g, 1), { doOutline: false });
  return assemble([f0, f1], { idle: { frames: [0, 0, 0, 0, 0, 0, 0, 1], fps: 3, loop: true }, talk: { frames: [0, 1], fps: 6, loop: true } }, 0, 0);
}
