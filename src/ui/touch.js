// On-screen touch controls (team: ui), registered as an InputSource (ARCHITECTURE.md §5).
//   - floating joystick: any touch in the left ~45% of the screen spawns it (drag-follow, analog)
//   - spell buttons 1-4 in an arc around the bottom-right corner (spell1 = big primary button)
//   - interact (+ dash when core's ACTIONS has it) on an outer arc
//   - pause / bag (/ craft in the hub) small buttons top-right
// Independent pointer tracking: one stick pointer + any number of button pointers (move + cast).
// A finger that slides off a button keeps holding it until release; sliding onto another button
// does not press it. Taps that go down+up within one tick still register for exactly one tick.
//
// source.reserved = { topRight, bottomRight, bottomLeft } rects {x,y,w,h} (virtual px) so the HUD
// can keep clear of the controls. source.target(action) -> {x,y} centre for tests.
import { ACTIONS } from '../core/input.js';
import { drawText, measureText } from './font.js';
import { COL, drawDisc, drawRing, drawSweep, elColor, clamp, mix, easeOutCubic } from './theme.js';
import { drawMask, maskSize } from './hud-icons.js';

const STICK_R = 22;
const KNOB_R = 9;
const DEAD = 0.15;
const STICK_ZONE = 0.45;

export function createTouchControls(game, ui) {
  const { input, display } = game;
  const hasDash = ACTIONS.includes('dash');
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, mx: 0, my: 0, alpha: 0, homeX: 0, homeY: 0, lastX: 0, lastY: 0 };
  /** [{action, kind:'spell'|'interact'|'dash'|'small', slot?, icon?, x, y, r}] */
  const buttons = [];
  const byAction = new Map();
  const held = new Map(); // pointerId -> button
  const tapped = new Set(); // actions tapped (down+up) within one tick
  const anim = new Map(); // action -> {press, ripple}
  const cd = [0, 0, 0, 0].map(() => ({ max: 0, prev: 0, ready: 0 }));
  const moveOut = { x: 0, y: 0 };
  const reserved = {
    topRight: { x: 0, y: 0, w: 0, h: 0 },
    bottomRight: { x: 0, y: 0, w: 0, h: 0 },
    bottomLeft: { x: 0, y: 0, w: 0, h: 0 },
  };
  let layoutKey = '';
  let fade = 0;

  function addButton(action, kind, x, y, r, extra = {}) {
    const b = { action, kind, x: Math.round(x), y: Math.round(y), r, ...extra };
    buttons.push(b);
    byAction.set(action, b);
    if (!anim.has(action)) anim.set(action, { press: 0, ripple: 0 });
    return b;
  }

  function layout() {
    const W = display.width, H = display.height, s = display.safe;
    const hub = game.level?.kind === 'hub';
    const key = `${W}x${H}:${s.top},${s.right},${s.bottom},${s.left}:${hub}`;
    if (key === layoutKey) return;
    layoutKey = key;
    buttons.length = 0;
    byAction.clear();

    const short = Math.min(W, H);
    const r = clamp(Math.round(short * 0.06), 15, 20); // >= 15 virtual px (~45+ CSS px on phones)
    const r1 = r + 3; // primary button
    const m = 6;
    const ax = W - s.right - m - r1, ay = H - s.bottom - m - r1;
    // ring distance so neighbours 45 degrees apart never touch
    const D1 = Math.max(r1 + r + 7, Math.ceil((2 * r + 5) / (2 * Math.sin(Math.PI / 8))));
    const deg = Math.PI / 180;
    addButton('spell1', 'spell', ax, ay, r1, { slot: 0 });
    [180, 225, 270].forEach((a, i) => addButton(`spell${i + 2}`, 'spell', ax + Math.cos(a * deg) * D1, ay + Math.sin(a * deg) * D1, r, { slot: i + 1 }));
    const ri = Math.max(13, r - 2);
    const D2 = D1 + r + ri + 6;
    addButton('interact', 'interact', ax + Math.cos(202.5 * deg) * D2, ay + Math.sin(202.5 * deg) * D2, ri);
    if (hasDash) addButton('dash', 'dash', ax + Math.cos(247.5 * deg) * D2, ay + Math.sin(247.5 * deg) * D2, ri);

    const rs = 11;
    const ty = s.top + m + rs;
    const px = W - s.right - m - rs;
    addButton('pause', 'small', px, ty, rs, { icon: 'pause' });
    addButton('inventory', 'small', px - (2 * rs + 7), ty, rs, { icon: 'bag' });
    if (hub) addButton('craft', 'small', px - 2 * (2 * rs + 7), ty, rs, { icon: 'anvil' });

    // reserved rects for the HUD
    let minX = W, minY = H, sx = W;
    for (const b of buttons) {
      if (b.kind === 'small') { sx = Math.min(sx, b.x - b.r - 3); continue; }
      minX = Math.min(minX, b.x - b.r - 3);
      minY = Math.min(minY, b.y - b.r - 3);
    }
    Object.assign(reserved.topRight, { x: sx, y: 0, w: W - sx, h: ty + rs + 3 });
    Object.assign(reserved.bottomRight, { x: minX, y: minY, w: W - minX, h: H - minY });
    stick.homeX = Math.round(s.left + m + STICK_R + 16);
    stick.homeY = Math.round(H - s.bottom - m - STICK_R - 16);
    const bl = stick.homeY - STICK_R - 6;
    Object.assign(reserved.bottomLeft, { x: 0, y: bl, w: stick.homeX + STICK_R + 6, h: H - bl });
  }

  function hitButton(x, y) {
    let best = null, bd = Infinity;
    for (const b of buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      const reach = b.r + (b.kind === 'small' ? 5 : 4);
      if (d <= reach && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function isHeld(action) {
    for (const b of held.values()) if (b.action === action) return true;
    return false;
  }

  function releaseAll() {
    held.clear();
    stick.id = null;
    stick.mx = stick.my = 0;
  }

  function updateStick() {
    if (stick.id == null) { stick.mx = stick.my = 0; return; }
    let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
    let d = Math.hypot(dx, dy);
    if (d > STICK_R) {
      // drag-follow: the base trails the finger so direction changes stay responsive
      stick.ox += (dx / d) * (d - STICK_R);
      stick.oy += (dy / d) * (d - STICK_R);
      dx = stick.x - stick.ox; dy = stick.y - stick.oy;
      d = STICK_R;
    }
    const mag = d / STICK_R;
    if (mag < DEAD || d === 0) { stick.mx = stick.my = 0; return; }
    const k = Math.min(1, (mag - DEAD) / (1 - DEAD)) / d;
    stick.mx = dx * k;
    stick.my = dy * k;
  }

  const source = {
    id: 'touch',
    visible: false,
    reserved,
    layout,

    poll(inp, dt = 1 / 60) {
      layout();
      const active = game.isGameplay() && !ui.blocksWorld();
      const st = game.settings.touchControls;
      const want = st === 'on' || (st === 'auto' && (inp.isTouchDevice || inp.lastDevice === 'touch' || game.params.has('touch')));
      source.visible = active && want;
      tapped.clear();
      for (const a of anim.values()) { a.press = Math.max(0, a.press - dt * 6); a.ripple = Math.max(0, a.ripple - dt * 3); }
      for (const c of cd) c.ready = Math.max(0, c.ready - dt * 3);
      if (!source.visible) { releaseAll(); fade = 0; return; }
      fade = Math.min(1, fade + dt * 5);

      const W = display.width, s = display.safe;
      const mouseOk = game.params.has('touch');
      for (const e of inp.pointerEvents) {
        if (e.pointerType === 'mouse' && !mouseOk) continue;
        const p = inp.pointers.get(e.id);
        if (e.type === 'down') {
          if (e.pointerType === 'mouse' && e.button !== 0) continue;
          const b = hitButton(e.x, e.y);
          if (b) {
            held.set(e.id, b);
            const a = anim.get(b.action);
            a.press = 1; a.ripple = 1;
            if (p) p.claimedBy = 'touch:' + b.action;
            continue;
          }
          if (stick.id == null && e.x < W * STICK_ZONE && e.y > s.top + 30) {
            stick.id = e.id;
            stick.ox = stick.x = e.x;
            stick.oy = stick.y = e.y;
            stick.alpha = 0;
            if (p) p.claimedBy = 'touch:stick';
          }
        } else if (e.type === 'move') {
          if (e.id === stick.id) { stick.x = e.x; stick.y = e.y; }
        } else if (e.type === 'up' || e.type === 'cancel') {
          const b = held.get(e.id);
          if (b) { tapped.add(b.action); held.delete(e.id); }
          if (e.id === stick.id) { stick.id = null; stick.lastX = stick.ox; stick.lastY = stick.oy; }
        }
      }
      // pointers that vanished without an up event (e.g. lost capture)
      for (const id of held.keys()) if (!inp.pointers.has(id)) held.delete(id);
      if (stick.id != null && !inp.pointers.has(stick.id)) stick.id = null;
      updateStick();
      stick.alpha = stick.id != null ? Math.min(1, stick.alpha + dt * 8) : Math.max(0, stick.alpha - dt * 5);

      // cooldown tracking for the ready flash
      const lo = game.state.loadout;
      for (let i = 0; i < 4; i++) {
        const c = cd[i];
        const v = lo[i] ? game.combat.getCooldown?.(game, lo[i]) || 0 : 0;
        if (v > c.prev + 0.05) c.max = v;
        if (c.prev > 0 && v <= 0) c.ready = 1;
        c.prev = v;
      }
    },

    getMove() {
      if (stick.id == null) return null;
      moveOut.x = stick.mx;
      moveOut.y = stick.my;
      return moveOut;
    },

    isDown(action) {
      return tapped.has(action) || isHeld(action);
    },

    /** Centre (virtual px) of a button by action name, for tests / ui.findTarget('touch:<action>'). */
    target(action) {
      layout();
      const b = byAction.get(action);
      return b ? { x: b.x, y: b.y } : null;
    },

    /** Auto-aim is combat's job on touch (nearest enemy). */
    getAim() {
      return null;
    },

    render(ctx) {
      if (!source.visible) return;
      layout();
      const t = game.realTime;
      ctx.save();
      ctx.globalAlpha = fade;
      renderStick(ctx);
      for (const b of buttons) {
        if (b.kind === 'spell') renderSpell(ctx, b, t);
        else if (b.kind === 'interact') renderInteract(ctx, b, t);
        else renderSmall(ctx, b);
      }
      ctx.restore();
    },
  };

  // ------------------------------------------------------------------ rendering

  function renderStick(ctx) {
    const base = ctx.globalAlpha;
    if (stick.id == null && stick.alpha <= 0) {
      // idle ghost at the default spot so players know where to touch
      ctx.globalAlpha = base * 0.4;
      drawDisc(ctx, stick.homeX, stick.homeY, STICK_R + 1, null, COL.ink);
      drawDisc(ctx, stick.homeX, stick.homeY, STICK_R, 'rgba(20,12,36,0.45)', '#c8b8ff');
      drawDisc(ctx, stick.homeX, stick.homeY, KNOB_R, 'rgba(200,184,255,0.55)');
      ctx.globalAlpha = base * 0.45;
      chevrons(ctx, stick.homeX, stick.homeY, '#e8e0ff');
      ctx.globalAlpha = base;
      return;
    }
    const ox = stick.id != null ? stick.ox : stick.lastX, oy = stick.id != null ? stick.oy : stick.lastY;
    ctx.globalAlpha = base * (0.35 + 0.5 * stick.alpha);
    drawDisc(ctx, ox, oy, STICK_R + 1, 'rgba(20,12,36,0.45)', COL.ink);
    drawRing(ctx, ox, oy, STICK_R, '#c8b8ff', 1);
    const kx = ox + stick.mx * STICK_R, ky = oy + stick.my * STICK_R;
    // direction wedge on the rim
    if (stick.mx || stick.my) {
      const l = Math.hypot(stick.mx, stick.my);
      const ex = ox + (stick.mx / l) * (STICK_R - 1), ey = oy + (stick.my / l) * (STICK_R - 1);
      drawDisc(ctx, ex, ey, 2, '#ffd25a');
    }
    ctx.globalAlpha = base * (0.5 + 0.45 * stick.alpha);
    drawDisc(ctx, kx, ky, KNOB_R + 1, COL.ink);
    drawDisc(ctx, kx, ky, KNOB_R, '#b8a8f0', '#e8e0ff');
    drawDisc(ctx, kx - 2, ky - 3, 2, '#ffffff');
    ctx.globalAlpha = base;
  }

  function chevrons(ctx, x, y, color) {
    ctx.fillStyle = color;
    const d = STICK_R - 6;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const cx = Math.round(x + dx * d), cy = Math.round(y + dy * d);
      if (dx === 0) { ctx.fillRect(cx - 1, cy, 3, 1); ctx.fillRect(cx, cy + dy, 1, 1); }
      else { ctx.fillRect(cx, cy - 1, 1, 3); ctx.fillRect(cx + dx, cy, 1, 1); }
    }
  }

  function ripple(ctx, b, color) {
    const a = anim.get(b.action);
    if (!a || a.ripple <= 0) return;
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * a.ripple * 0.8;
    drawRing(ctx, b.x, b.y, b.r + 1 + Math.round(easeOutCubic(1 - a.ripple) * 8), color, 1);
    ctx.globalAlpha = base;
  }

  function renderSpell(ctx, b, t) {
    const id = game.state.loadout[b.slot];
    const spell = id ? game.combat.getSpell?.(id) : null;
    const down = isHeld(b.action);
    const r = b.r;
    const x = b.x, y = b.y + (down ? 1 : 0);
    const base = ctx.globalAlpha;
    if (!spell) {
      ctx.globalAlpha = base * 0.7;
      drawDisc(ctx, x, y, r + 1, null, 'rgba(20,12,36,0.6)');
      drawDisc(ctx, x, y, r, 'rgba(20,12,36,0.5)', 'rgba(160,150,190,0.85)');
      ctx.fillStyle = 'rgba(138,128,168,0.8)';
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillRect(x, y - 2, 1, 5);
      ctx.globalAlpha = base;
      badge(ctx, b, COL.dimmer);
      return;
    }
    const els = spell.elements?.length ? [...new Set(spell.elements)] : [spell.element];
    const c0 = elColor(els[0], 0), c1 = els.length > 1 ? elColor(els[1], 0) : elColor(els[0], 1);
    const st = game.state.player;
    const noMana = st.mana < (spell.manaCost || 0);
    const v = game.combat.getCooldown?.(game, id) || 0;
    drawDisc(ctx, x, y, r + 1, null, COL.ink);
    drawDisc(ctx, x, y, r, down ? 'rgba(70,52,120,0.88)' : 'rgba(22,14,40,0.72)', noMana ? mix(c0, '#3a3058', 0.6) : c0, 2);
    if (els.length > 1) drawRing(ctx, x, y, r - 2, noMana ? mix(c1, '#3a3058', 0.6) : c1, 1);
    else drawRing(ctx, x, y, r - 2, 'rgba(255,255,255,0.12)', 1);
    game.art.drawIcon(ctx, spell.icon, x - 8, y - 8, { alpha: noMana ? 0.45 : 1 });
    const ir = r - 3;
    if (noMana) drawDisc(ctx, x, y, ir, 'rgba(70,40,150,0.35)');
    if (v > 0) {
      const max = Math.max(cd[b.slot].max, spell.cooldown || 0.001, v);
      drawSweep(ctx, x - ir, y - ir, ir * 2 + 1, ir * 2 + 1, v / max, 'rgba(8,4,16,0.66)', 'circle');
      if (v >= 0.95) drawText(ctx, String(Math.ceil(v)), x + 1, y - 2, { align: 'center', outline: COL.ink, shadow: null });
    }
    if (down) drawDisc(ctx, x, y, ir, 'rgba(255,255,255,0.16)');
    const rd = cd[b.slot].ready;
    if (rd > 0) {
      drawDisc(ctx, x, y, ir, `rgba(255,255,255,${(rd * 0.55).toFixed(2)})`);
      ctx.globalAlpha = base * rd;
      drawRing(ctx, x, y, r + 1 + Math.round((1 - rd) * 5), elColor(els[0], 1), 1);
      ctx.globalAlpha = base;
    }
    if (noMana) drawText(ctx, String(Math.round(spell.manaCost)), x, y + r - 9, { align: 'center', color: COL.bad, outline: COL.ink, shadow: null });
    ripple(ctx, b, elColor(els[0], 1));
    badge(ctx, b, down ? COL.goldHi : COL.gold);
  }

  function badge(ctx, b, color) {
    const bx = Math.round(b.x + b.r * 0.72), by = Math.round(b.y + b.r * 0.72) + (isHeld(b.action) ? 1 : 0);
    drawDisc(ctx, bx, by, 4, COL.ink);
    drawDisc(ctx, bx, by, 3, '#2a1e44');
    drawText(ctx, String(b.slot + 1), bx + 1, by - 2, { align: 'center', color, shadow: null });
  }

  function renderInteract(ctx, b, t) {
    const target = game.interactTarget;
    const on = !!target && !target.dead;
    const down = isHeld(b.action);
    const x = b.x, y = b.y + (down ? 1 : 0), r = b.r;
    const base = ctx.globalAlpha;
    const pulse = on ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    ctx.globalAlpha = base * (on ? 1 : 0.62);
    drawDisc(ctx, x, y, r + 1, null, COL.ink);
    drawDisc(ctx, x, y, r, down ? 'rgba(90,64,30,0.9)' : on ? 'rgba(48,32,20,0.82)' : 'rgba(22,14,40,0.6)', on ? mix(COL.gold, COL.goldHi, pulse) : '#8a80a8', 2);
    if (on && !down) {
      ctx.globalAlpha = base * (0.25 + 0.45 * (1 - pulse));
      drawRing(ctx, x, y, r + 2 + Math.round(pulse * 3), COL.gold, 1);
      ctx.globalAlpha = base;
    }
    const word = on ? String(target.interactPrompt || 'Use').split(' ')[0].toUpperCase() : 'USE';
    const fits = measureText(word) <= r * 2 - 6;
    drawText(ctx, fits ? word : 'USE', x + 1, y - 2, { align: 'center', color: on ? COL.goldHi : COL.dim, shadow: COL.ink });
    ctx.globalAlpha = base;
    if (on && !fits) {
      // full label in a pill above the button
      const label = String(target.interactPrompt);
      const w = measureText(label) + 8;
      const lx = Math.round(Math.min(display.width - display.safe.right - w - 2, x - w / 2)), ly = y - r - 14;
      ctx.fillStyle = COL.ink;
      ctx.fillRect(lx - 1, ly, w + 2, 11);
      ctx.fillRect(lx, ly - 1, w, 13);
      ctx.fillStyle = 'rgba(48,32,20,0.95)';
      ctx.fillRect(lx, ly, w, 11);
      drawText(ctx, label, lx + 4, ly + 3, { color: COL.goldHi });
    }
    ripple(ctx, b, COL.gold);
  }

  function renderSmall(ctx, b) {
    const down = isHeld(b.action);
    const x = b.x, y = b.y + (down ? 1 : 0), r = b.r;
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * 0.92;
    drawDisc(ctx, x, y, r + 1, null, COL.ink);
    drawDisc(ctx, x, y, r, down ? 'rgba(70,52,120,0.9)' : 'rgba(22,14,40,0.62)', down ? COL.edgeHi : 'rgba(200,184,255,0.7)', 1);
    ctx.globalAlpha = base;
    if (b.kind === 'dash') {
      const sz = maskSize('dash');
      drawMask(ctx, 'dash', x - Math.floor(sz.w / 2), y - Math.floor(sz.h / 2), '#a8e0ff', '#ffffff', '#4a8ac8');
    } else {
      const sz = maskSize(b.icon);
      const col = b.icon === 'anvil' ? ['#ffb84a', '#fff2b0', '#b07a20'] : ['#e8e0ff', '#ffffff', '#8a80a8'];
      drawMask(ctx, b.icon, x - Math.floor(sz.w / 2), y - Math.floor(sz.h / 2), col[0], col[1], col[2]);
    }
    ripple(ctx, b, COL.edgeHi);
  }

  input.addSource(source);
  return source;
}
