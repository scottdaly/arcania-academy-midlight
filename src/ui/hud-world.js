// World-space HUD overlay (team: ui): floating combat text, enemy HP bars and the interact prompt.
// Drawn by hud.renderWorld() with the camera already applied (world px == virtual px).
import { EV } from '../core/events.js';
import { ELEMENT_COLORS } from '../core/config.js';
import { drawText, measureText } from './font.js';
import { COL, mix, clamp, rrect, easeOutBack } from './theme.js';
import { drawPrompt } from './widgets.js';

const MAX_FLOATERS = 60;
const MERGE_WINDOW = 0.25;
const OUTLINE = COL.ink;
const STATUS_WORDS = {
  burn: 'BURN', chill: 'CHILL', shock: 'SHOCK', stun: 'STUN',
  poison: 'POISON', weak: 'WEAK', root: 'ROOTED', vulnerable: 'EXPOSED',
};
const STATUS_EL = { burn: 'fire', chill: 'ice', freeze: 'ice', frozen: 'ice', slow: 'ice', shock: 'lightning', stun: 'lightning', poison: 'earth', root: 'earth', weak: 'arcane', vulnerable: 'arcane' };

const colorCache = new Map();
/** Readable damage colour for an element: halfway between its main and highlight colours. */
function dmgColor(el) {
  let c = colorCache.get(el);
  if (!c) {
    const pair = ELEMENT_COLORS[el] || ELEMENT_COLORS.physical;
    c = el === 'physical' || !ELEMENT_COLORS[el] ? '#f4f0ff' : mix(pair[0], pair[1], 0.45);
    colorCache.set(el, c);
  }
  return c;
}

export function createWorldOverlay(game, ui) {
  const pool = [];
  for (let i = 0; i < MAX_FLOATERS; i++) {
    pool.push({ on: false, kind: '', target: null, amount: 0, x: 0, y: 0, ox: 0, oy: 0, vx: 0, vy: 0, g: 0, age: 0, life: 1, last: 0, text: '', color: '#fff', crit: false });
  }
  /** Overlay clock: advances only while the world runs, so numbers freeze with the pause menu. */
  let now = 0;
  /** enemy entity -> {trail, hold, last} */
  const bars = new Map();
  /** status throttle: target -> {type: lastTime} */
  const statusSeen = new WeakMap();
  let promptTarget = null, promptAge = 0;

  function alloc() {
    let best = null;
    for (const f of pool) {
      if (!f.on) return f;
      if (!best || f.age / f.life > best.age / best.life) best = f;
    }
    return best;
  }

  function spawn(kind, target, x, y, text, color, opts = {}) {
    const f = alloc();
    f.on = true;
    f.kind = kind;
    f.target = target;
    f.amount = opts.amount || 0;
    f.x = x; f.y = y;
    f.ox = 0; f.oy = 0;
    f.vx = opts.vx ?? (Math.random() - 0.5) * 22;
    f.vy = opts.vy ?? -58;
    f.g = opts.g ?? 110;
    f.age = 0;
    f.life = opts.life ?? 0.9;
    f.last = now;
    f.text = text;
    f.color = color;
    f.crit = !!opts.crit;
    return f;
  }

  const fmt = (n) => String(Math.max(1, Math.round(n)));

  function onDamaged({ target, amount, element, crit, x, y, dot } = {}) {
    if (!(amount > 0) || !target) return;
    const px = x ?? target.x, py = (y ?? target.y) - 14;
    // merge rapid hits on the same target into a rolling total
    for (const f of pool) {
      if (f.on && f.kind === 'dmg' && f.target === target && now - f.last < MERGE_WINDOW) {
        f.amount += amount;
        f.crit = f.crit || !!crit;
        f.text = fmt(f.amount) + (f.crit ? '!' : '');
        f.last = now;
        f.age = Math.min(f.age, 0.12);
        f.vy = Math.min(f.vy, -30);
        if (crit) f.color = '#ffe14a';
        return;
      }
    }
    if (dot) spawn('dmg', target, px, py + 4, fmt(amount), mix(dmgColor(element), '#8a80a8', 0.35), { amount, life: 0.7, vy: -34, g: 40 });
    else spawn('dmg', target, px, py, fmt(amount) + (crit ? '!' : ''), crit ? '#ffe14a' : dmgColor(element), { amount, crit, life: crit ? 1.15 : 0.9, vy: crit ? -70 : -58 });

    // enemy HP bar bookkeeping (bosses have their own big bar)
    if (target.tags?.has('boss') || !(target.maxHp > 0)) return;
    const before = clamp((target.hp + amount) / target.maxHp, 0, 1);
    let r = bars.get(target);
    if (!r) bars.set(target, (r = { trail: before, hold: 0, last: now }));
    r.trail = Math.max(r.trail, before);
    r.hold = 0.35;
    r.last = now;
  }

  const bus = game.bus;
  bus.on(EV.ENTITY_DAMAGED, onDamaged);
  bus.on(EV.PLAYER_DAMAGED, ({ amount } = {}) => {
    const p = game.player;
    if (!p || !(amount > 0)) return;
    for (const f of pool) {
      if (f.on && f.kind === 'pdmg' && now - f.last < MERGE_WINDOW) {
        f.amount += amount; f.text = '-' + fmt(f.amount); f.last = now; f.age = Math.min(f.age, 0.12);
        return;
      }
    }
    spawn('pdmg', p, p.x, p.y - 20, '-' + fmt(amount), '#ff5a6a', { amount, vx: (Math.random() - 0.5) * 14, vy: -50 });
  });
  bus.on(EV.PLAYER_HEALED, ({ amount } = {}) => {
    const p = game.player;
    if (!p || !(amount >= 1)) return;
    for (const f of pool) {
      if (f.on && f.kind === 'heal' && now - f.last < 0.4) {
        f.amount += amount; f.text = '+' + fmt(f.amount); f.last = now; f.age = Math.min(f.age, 0.15);
        return;
      }
    }
    spawn('heal', p, p.x, p.y - 22, '+' + fmt(amount), '#7aff9a', { amount, vx: 0, vy: -30, g: 20, life: 1.1 });
  });
  bus.on(EV.STATUS_APPLIED, ({ target, status } = {}) => {
    const type = status?.type;
    if (!target || !type || target.dead) return;
    let seen = statusSeen.get(target);
    if (!seen) statusSeen.set(target, (seen = {}));
    if (now - (seen[type] ?? -9) < 1.2) return;
    seen[type] = now;
    const word = STATUS_WORDS[type];
    if (!word) return; // combat floats its own words for freeze / reactions
    const el = STATUS_EL[type] || status.element || 'arcane';
    spawn('status', target, target.x, target.y - 26, word, ELEMENT_COLORS[el]?.[1] === '#ffffff' ? ELEMENT_COLORS[el][0] : mix(ELEMENT_COLORS[el]?.[0] || '#c8b8ff', '#ffffff', 0.25), { vx: 0, vy: -16, g: 0, life: 0.95 });
  });
  bus.on(EV.ENTITY_KILLED, ({ target } = {}) => { bars.delete(target); });
  const clearAll = () => {
    for (const f of pool) { f.on = false; f.target = null; }
    bars.clear();
    promptTarget = null;
  };
  bus.on(EV.LEVEL_READY, clearAll);
  bus.on(EV.SCENE_CHANGED, ({ to } = {}) => { if (!game.isGameplay()) clearAll(); });

  function spriteTop(t) {
    if (t.promptY != null) return t.promptY;
    const key = t.sprite || t.npc?.sprite || t.spriteKey;
    if (key && game.art.hasSprite?.(key)) {
      const s = game.art.getSprite(key);
      if (s && s.ay > 0) return t.y - s.ay;
    }
    return t.y - 22;
  }

  const overlay = {
    update(dt) {
      if (ui.blocksWorld()) return;
      now += dt;
      for (const f of pool) {
        if (!f.on) continue;
        f.age += dt;
        if (f.age >= f.life || (f.kind === 'status' && f.target?.dead && f.age > 0.5)) { f.on = false; f.target = null; continue; }
        f.ox += f.vx * dt;
        f.oy += f.vy * dt;
        f.vy += f.g * dt;
        f.vx *= 0.96;
      }
      for (const [e, r] of bars) {
        if (e.dead || !(e.hp > 0) || now - r.last > 3.6) { bars.delete(e); continue; }
        const frac = clamp(e.hp / e.maxHp, 0, 1);
        if (r.hold > 0) r.hold -= dt;
        else r.trail = Math.max(frac, r.trail - dt * 0.9);
        if (r.trail < frac) r.trail = frac;
      }
      const t = game.interactTarget;
      if (t !== promptTarget) { promptTarget = t; promptAge = 0; } else promptAge += dt;
    },

    render(ctx) {
      // enemy HP bars (under the numbers)
      for (const [e, r] of bars) {
        const fade = clamp((3.6 - (now - r.last)) / 0.5, 0, 1);
        if (fade <= 0) continue;
        const frac = clamp(e.hp / e.maxHp, 0, 1);
        const w = clamp(Math.round((e.radius || 6) * 2.4 + 6), 14, 28), h = 2;
        const ex = Math.round((e.rx ?? e.x) - w / 2), ey = Math.round((e.ry ?? e.y) + 4);
        const elite = !!(e.elite || e.isElite || e.opts?.elite);
        ctx.save();
        ctx.globalAlpha = fade;
        if (elite) {
          rrect(ctx, ex - 2, ey - 2, w + 4, h + 4, OUTLINE);
          ctx.fillStyle = COL.gold;
          ctx.fillRect(ex - 1, ey - 1, w + 2, h + 2);
        } else rrect(ctx, ex - 1, ey - 1, w + 2, h + 2, OUTLINE);
        ctx.fillStyle = '#2a1e3e';
        ctx.fillRect(ex, ey, w, h);
        const fw = Math.round(w * frac), tw = Math.round(w * r.trail);
        if (tw > fw) { ctx.fillStyle = COL.trail; ctx.fillRect(ex + fw, ey, tw - fw, h); }
        if (fw > 0) {
          ctx.fillStyle = frac < 0.3 ? '#ff7a3a' : COL.hp;
          ctx.fillRect(ex, ey, fw, h);
          ctx.fillStyle = COL.hpHi;
          ctx.fillRect(ex, ey, fw, 1);
        }
        ctx.restore();
      }

      // floating combat text (oldest first so new hits sit on top)
      for (const f of pool) {
        if (!f.on) continue;
        const k = f.age / f.life;
        const alpha = k > 0.7 ? clamp((1 - k) / 0.3, 0, 1) : 1;
        const big = f.crit && f.age < 0.42;
        const pop = f.age < 0.07;
        const x = Math.round(f.x + f.ox), y = Math.round(f.y + f.oy - (big ? 4 : 0));
        drawText(ctx, f.text, x, y, {
          color: pop ? '#ffffff' : f.color, align: 'center', scale: big ? 2 : 1, alpha, outline: OUTLINE, shadow: null,
        });
        if (f.crit && f.age < 0.25 && f.kind === 'dmg') {
          drawText(ctx, 'CRIT', x, y - (big ? 10 : 8), { color: '#fff2b0', align: 'center', alpha: alpha * clamp(1 - f.age / 0.25, 0, 1), outline: OUTLINE, shadow: null });
        }
      }

      // interact prompt
      const t = game.interactTarget;
      if (t && !ui.blocksWorld() && !game.scenes.transitioning && !t.dead) {
        const text = t.interactPrompt || 'Use';
        const total = 9 + 3 + measureText(text);
        const cx = Math.round(t.rx ?? t.x);
        const intro = easeOutBack(promptAge / 0.25);
        const bob = Math.round(Math.sin(game.realTime * 3.5) * 1.2);
        const top = Math.round(spriteTop(t)) - 16 + bob + Math.round((1 - intro) * 5);
        const bw = total + 8, bh = 13;
        const bx = Math.round(cx - bw / 2);
        ctx.save();
        ctx.globalAlpha = clamp(promptAge / 0.12, 0, 1);
        rrect(ctx, bx - 1, top - 1, bw + 2, bh + 2, OUTLINE);
        rrect(ctx, bx, top, bw, bh, 'rgba(36,24,62,0.94)');
        ctx.fillStyle = 'rgba(255,210,90,0.35)';
        ctx.fillRect(bx + 1, top, bw - 2, 1);
        // tail
        ctx.fillStyle = OUTLINE;
        ctx.fillRect(cx - 2, top + bh, 5, 2);
        ctx.fillRect(cx - 1, top + bh + 2, 3, 1);
        ctx.fillStyle = 'rgba(36,24,62,0.94)';
        ctx.fillRect(cx - 1, top + bh, 3, 1);
        ctx.fillRect(cx, top + bh + 1, 1, 1);
        drawPrompt(ctx, game, 'interact', text, cx, top + 2, { align: 'center', color: COL.goldHi });
        ctx.restore();
      }
    },

    get floaterCount() {
      let n = 0;
      for (const f of pool) if (f.on) n++;
      return n;
    },
  };
  return overlay;
}
