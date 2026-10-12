// On-screen touch controls: floating joystick (left) + spell/interact buttons (right) + pause and
// inventory buttons (top-right). Registered as an InputSource (team: ui). Placeholder layout.
import { drawText } from './font.js';

export function createTouchControls(game) {
  const { input, display } = game;
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, mx: 0, my: 0 };
  const STICK_R = 22;
  /** Buttons are recomputed every poll from the screen size. */
  let buttons = [];
  const held = new Map(); // pointerId -> action
  const tapped = new Set(); // actions tapped (down+up) within one tick

  function layout() {
    const W = display.width, H = display.height, s = display.safe;
    const px = W - s.right - 14, py = H - s.bottom - 14, R = 50;
    const angles = [185, 212, 238, 265].map((d) => (d * Math.PI) / 180);
    buttons = angles.map((a, i) => ({ action: `spell${i + 1}`, slot: i, x: px + Math.cos(a) * R, y: py + Math.sin(a) * R, r: 13 }));
    buttons.push({ action: 'interact', x: px - 18, y: py - 18, r: 11, label: 'E' });
    buttons.push({ action: 'pause', x: W - s.right - 12, y: s.top + 12, r: 9, label: 'II' });
    buttons.push({ action: 'inventory', x: W - s.right - 34, y: s.top + 12, r: 9, label: 'INV' });
  }

  const hit = (b, x, y) => (x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r + 3) ** 2;

  const source = {
    id: 'touch',
    visible: false,
    poll(inp) {
      layout();
      const active = game.isGameplay() && !game.ui.blocksWorld();
      const st = game.settings.touchControls;
      source.visible = active && (st === 'on' || (st === 'auto' && (inp.isTouchDevice || inp.lastDevice === 'touch' || game.params.has('touch'))));
      tapped.clear();
      if (!active) { held.clear(); stick.id = null; stick.mx = stick.my = 0; return; }
      for (const e of inp.pointerEvents) {
        if (e.pointerType === 'mouse' && !game.params.has('touch')) continue;
        const p = inp.pointers.get(e.id);
        if (e.type === 'down') {
          const b = buttons.find((bb) => hit(bb, e.x, e.y));
          if (b) { held.set(e.id, b.action); if (p) p.claimedBy = 'touch:' + b.action; continue; }
          if (e.x < display.width * 0.5 && stick.id == null) {
            Object.assign(stick, { id: e.id, ox: e.x, oy: e.y, x: e.x, y: e.y });
            if (p) p.claimedBy = 'touch:stick';
          }
        } else if (e.type === 'move' && e.id === stick.id) {
          stick.x = e.x; stick.y = e.y;
        } else if (e.type === 'up' || e.type === 'cancel') {
          if (held.has(e.id)) { tapped.add(held.get(e.id)); held.delete(e.id); }
          if (e.id === stick.id) { stick.id = null; }
        }
      }
      if (stick.id != null) {
        let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) { stick.ox += (dx / d) * (d - STICK_R); stick.oy += (dy / d) * (d - STICK_R); dx = stick.x - stick.ox; dy = stick.y - stick.oy; }
        const m = Math.hypot(dx, dy) / STICK_R;
        stick.mx = m < 0.15 ? 0 : dx / STICK_R;
        stick.my = m < 0.15 ? 0 : dy / STICK_R;
      } else stick.mx = stick.my = 0;
    },
    getMove() {
      return stick.id != null ? { x: stick.mx, y: stick.my } : null;
    },
    isDown(action) {
      if (tapped.has(action)) return true;
      for (const a of held.values()) if (a === action) return true;
      return false;
    },
    getAim() {
      return null; // auto-aim handled by combat when lastDevice === 'touch'
    },
    render(ctx) {
      if (!source.visible) return;
      ctx.save();
      if (stick.id != null) {
        ctx.globalAlpha = 0.35;
        ring(ctx, stick.ox, stick.oy, STICK_R, '#ffffff');
        ctx.globalAlpha = 0.6;
        dot(ctx, stick.ox + stick.mx * STICK_R, stick.oy + stick.my * STICK_R, 8, '#ffffff');
      }
      for (const b of buttons) {
        const pressed = [...held.values()].includes(b.action);
        ctx.globalAlpha = pressed ? 0.85 : 0.5;
        dot(ctx, b.x, b.y, b.r, '#1a1030');
        ring(ctx, b.x, b.y, b.r, '#b8a8ff');
        ctx.globalAlpha = 1;
        if (b.slot != null) {
          const spell = game.combat.getSpell(game.state.loadout[b.slot]);
          if (spell) game.art.drawIcon(ctx, spell.icon, b.x - 8, b.y - 8);
          drawText(ctx, String(b.slot + 1), b.x + b.r - 4, b.y + b.r - 5, { color: '#ffd25a' });
        } else drawText(ctx, b.label, b.x, b.y - 2, { align: 'center' });
      }
      ctx.restore();
    },
  };

  input.addSource(source);
  return source;
}

function dot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2);
  ctx.stroke();
}
