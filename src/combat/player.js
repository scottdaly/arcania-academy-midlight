// Player entity (team: combat): movement, dash, aiming, casting, mana regen, hazards, hurt & death.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { moveCircle, hasLineOfSight } from '../core/physics.js';
import { normalize } from '../core/math.js';
import { castSpell } from './spells.js';
import { damage, tickStatuses, useItem } from './rules.js';
import { SPELLS } from './data.js';
import { fx, sfx, isTarget, angleDiff, colorsOf } from './util.js';

const DASH_TIME = 0.17;
const DASH_SPEED = 255;
const DASH_INVULN = 0.24;
const DASH_COOLDOWN = 0.85;

// ---- keyboard / mouse fallbacks until core adds 'dash' / 'potion' input actions -------------
// (requests/combat.md). Latched so a tap between ticks is never lost.
const latch = { dash: false, potion: false };
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') latch.dash = true;
    if (e.code === 'KeyQ') latch.potion = true;
  });
}

export class Player extends Entity {
  constructor(game, x, y) {
    super(x, y);
    this.team = 'player';
    this.tags.add('player');
    this.radius = 5;
    this.pushable = true;
    this.mass = 2;
    this.facingX = 1;
    this.facingY = 0;
    this.aimX = 1;
    this.aimY = 0;
    this.anim = 'idle';
    this.animT = 0;
    this.castAnim = 0;
    this.invuln = 0;
    this.dashInvuln = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.dashDir = { x: 1, y: 0 };
    this.ghosts = [];
    this.hurtFlash = 0;
    this.hurtT = 0;
    this.kbx = this.kby = 0;
    this.vx = this.vy = 0;
    this.dying = false;
    this.lastHurtTime = -99;
    this.hazardT = 0;
    this.regenT = 0;
    /** spellId -> seconds remaining */
    this.cooldowns = new Map();
    this.statuses = [];
    this.runes = [];
    listen();
    latch.dash = latch.potion = false;
  }

  onAdd(game) {
    this._light = game.fx?.attachLight?.(this, 56, '#c8b8ff', 0.85);
  }
  onRemove() {
    this._light?.remove?.();
  }

  /**
   * Unit aim vector: mouse (desktop) > aim source (touch stick / gamepad) > auto-aim
   * (touch: nearest foe; keyboard: soft lock-on to a foe roughly ahead) > facing.
   */
  aim(game) {
    const { input, camera } = game;
    const m = input.mouse;
    if (input.lastDevice !== 'touch' && m?.inside && performance.now() - (m.lastMoveTime || 0) < 4000) {
      const w = camera.screenToWorld(m.x, m.y);
      this.mouseWorld = w;
      const n = normalize(w.x - this.x, w.y - (this.y - 6));
      if (n.x || n.y) return n;
    }
    this.mouseWorld = null;
    const a = input.getAim?.();
    if (a && (a.x || a.y)) return normalize(a.x, a.y);
    const map = game.level?.map;
    const touch = input.lastDevice === 'touch';
    const facingA = Math.atan2(this.facingY, this.facingX);
    let best = null, bestScore = Infinity;
    for (const e of game.entities.inRadius(this.x, this.y, 170)) {
      if (!isTarget(e, 'player')) continue;
      const ang = Math.atan2(e.y - this.y, e.x - this.x);
      const off = angleDiff(ang, facingA);
      if (!touch && off > 0.6) continue;
      if (map && !hasLineOfSight(map, this.x, this.y - 4, e.x, e.y - 4)) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      const score = touch ? d : d * (1 + off * 2);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) return normalize(best.x - this.x, best.y - this.y);
    return { x: this.facingX, y: this.facingY };
  }

  update(game, dt) {
    const st = game.state.player;
    const input = game.input;
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashInvuln = Math.max(0, this.dashInvuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.castAnim = Math.max(0, this.castAnim - dt);
    for (const [id, t] of this.cooldowns) if (t > 0) this.cooldowns.set(id, Math.max(0, t - dt));
    this.animT += dt;
    for (let i = this.ghosts.length - 1; i >= 0; i--) if ((this.ghosts[i].t -= dt) <= 0) this.ghosts.splice(i, 1);
    if (this.dying || st.hp <= 0) {
      this.anim = 'die';
      if (!this.dying) this.die(game, null);
      latch.dash = latch.potion = false;
      return;
    }
    const map = game.level?.map;
    if (!map) return;
    const ts = tickStatuses(game, this, dt);
    if (this.dying) return;

    // ---- dash
    let wantDash = latch.dash || input.pressed?.('dash');
    latch.dash = false;
    for (const ev of input.pointerEvents || []) if (ev.type === 'down' && ev.button === 2 && ev.pointerType === 'mouse') wantDash = true;
    if (wantDash && this.dashCd <= 0 && this.dashT <= 0) this.startDash(game);

    // ---- potion hotkey
    if (latch.potion || input.pressed?.('potion')) {
      latch.potion = false;
      const id = st.hp < st.maxHp ? (game.state.inventory.find((s) => s.id === 'potion_health') ? 'potion_health' : 'elixir') : null;
      if (id && !useItem(game, id)) game.bus.emit(EV.TOAST, { text: 'No health potions', color: '#ff8a8a', duration: 0.8 });
    }

    // ---- movement
    const mv = input.move;
    const td = map.defsAt?.(this.x, this.y);
    const tileDefs = td ? [td.ground, td.deco] : null;
    let tileSlow = 1;
    if (tileDefs) for (const d of tileDefs) if (d && d.slow) tileSlow *= d.slow;
    if (this.dashT > 0) {
      this.dashT -= dt;
      moveCircle(map, this, this.dashDir.x * DASH_SPEED * dt, this.dashDir.y * DASH_SPEED * dt);
      this.ghosts.push({ x: this.x, y: this.y, t: 0.18, flip: this.facingX < 0 });
      this.vx = this.dashDir.x * st.moveSpeed;
      this.vy = this.dashDir.y * st.moveSpeed;
    } else {
      const speed = st.moveSpeed * ts.slow * tileSlow * (this.castAnim > 0 ? 0.85 : 1);
      const k = 1 - Math.exp(-22 * dt);
      this.vx += (mv.x * speed - this.vx) * k;
      this.vy += (mv.y * speed - this.vy) * k;
      moveCircle(map, this, this.vx * dt + this.kbx * dt, this.vy * dt + this.kby * dt);
    }
    const kd = Math.exp(-10 * dt);
    this.kbx *= kd; this.kby *= kd;
    if (mv.x || mv.y) {
      const n = normalize(mv.x, mv.y);
      this.facingX = n.x; this.facingY = n.y;
    }

    // ---- hazards (lava, poison...)
    this.hazardT -= dt;
    if (this.hazardT <= 0 && this.dashT <= 0 && tileDefs) {
      for (const d of tileDefs) {
        if (!d?.hazard) continue;
        this.hazardT = 0.5;
        damage(game, this, { amount: Math.max(1, Math.round(d.hazard.dps * 0.5)), element: d.hazard.element, dot: true,
          statuses: d.hazard.element === 'fire' ? [{ type: 'burn', duration: 1.5, power: 1 }] : null });
        break;
      }
    }

    // ---- mana & out-of-combat regen
    if (!ts.regenStop) st.mana = Math.min(st.maxMana, st.mana + st.manaRegen * dt);
    if (game.time - this.lastHurtTime > 6 && st.hp < st.maxHp) {
      const engaged = game.entities.list.some((e) => e.team === 'enemy' && e.aggro && !e.dead && e.tags.has('enemy'));
      if (!engaged) st.hp = Math.min(st.maxHp, st.hp + 2 * dt);
    }

    // ---- casting (tap or hold)
    const d = this.aim(game);
    this.aimX = d.x; this.aimY = d.y;
    if (this.dashT <= 0) {
      for (let i = 0; i < 4; i++) {
        const act = 'spell' + (i + 1);
        const pressed = input.pressed(act);
        const held = input.down?.(act);
        if (!pressed && !held) continue;
        const spellId = game.state.loadout[i];
        if (!spellId) { if (pressed) game.bus.emit(EV.SPELL_FAILED, { caster: this, spellId: null, reason: 'empty' }); continue; }
        if (!pressed) {
          // holding: auto-repeat silently when ready (no failure spam)
          const sp = SPELLS[spellId];
          if (!sp || (this.cooldowns.get(spellId) || 0) > 0 || st.mana < sp.manaCost) continue;
        }
        const opts = this.mouseWorld ? { targetX: this.mouseWorld.x, targetY: this.mouseWorld.y } : {};
        if (castSpell(game, this, spellId, d.x, d.y, opts)) {
          this.castAnim = 0.22;
          if (Math.abs(d.x) > 0.2) this.facingX = d.x < 0 ? -Math.abs(this.facingX || 1) : Math.abs(this.facingX || 1);
          break; // one spell per tick
        }
      }
    }

    this.anim = this.hurtT > 0 ? 'hurt' : this.castAnim > 0 ? 'cast' : (Math.abs(this.vx) + Math.abs(this.vy) > 8) ? 'walk' : 'idle';
  }

  startDash(game) {
    const mv = game.input.move;
    let dx = mv.x, dy = mv.y;
    if (!dx && !dy) { dx = this.facingX; dy = this.facingY; }
    const n = normalize(dx, dy);
    if (!n.x && !n.y) return;
    this.dashDir = n;
    this.dashT = DASH_TIME;
    this.dashInvuln = DASH_INVULN;
    this.dashCd = DASH_COOLDOWN;
    this.kbx = this.kby = 0;
    fx(game, 'emit', 'dust', this.x, this.y, { count: 6 });
    sfx(game, 'dash', 0.6, 1);
    game.bus.emit('combat:dash', { player: this, dirX: n.x, dirY: n.y });
  }

  /** A hit was avoided by dashing through it. */
  onDodge(game) {
    if ((this._dodgeT || 0) > game.time) return;
    this._dodgeT = game.time + 0.4;
    fx(game, 'emit', 'sparkle', this.x, this.y - 8, { color: '#c8b8ff', color2: '#ffffff', count: 6 });
    game.bus.emit('combat:dodge', { player: this });
  }

  die(game, killer) {
    if (this.dying) return;
    this.dying = true;
    this.dashT = 0;
    this.statuses.length = 0;
    game.bus.emit(EV.PLAYER_DIED, { killer: killer || null });
  }

  render(ctx, game) {
    const art = game.art;
    for (const g of this.ghosts) {
      art.drawSprite(ctx, 'player', g.x, g.y, { anim: 'walk', t: this.animT, flip: g.flip, alpha: (g.t / 0.18) * 0.35, flash: 1 });
    }
    art.drawShadow(ctx, this.rx, this.ry, 9);
    const blink = this.invuln > 0 && !this.dying && Math.floor(this.invuln * 20) % 2 === 0;
    art.drawSprite(ctx, 'player', this.rx, this.ry, {
      anim: this.anim, t: this.animT, flip: this.facingX < 0, flash: this.hurtFlash > 0 ? 1 : 0,
      alpha: this.dying ? 0.6 : blink ? 0.5 : 1,
    });
    // status pips
    const x = Math.round(this.rx), y = Math.round(this.ry);
    for (const s of this.statuses) {
      if (s.type === 'burn' && Math.random() < 0.3) fx(game, 'emit', 'trail', x, y - 10, { element: 'fire', count: 1 });
    }
    if (this.statuses.some((s) => s.type === 'chill')) {
      ctx.fillStyle = '#9ae8ff';
      ctx.fillRect(x - 4, y - 1, 1, 1); ctx.fillRect(x + 3, y - 2, 1, 1);
    }
  }

  renderGlow(ctx, game) {
    if (this.dying) return;
    // aim pip: where your spells will go
    const x = Math.round(this.rx), y = Math.round(this.ry) - 6;
    const id = game.state.loadout?.[0];
    const c = colorsOf(SPELLS[id]?.element || 'arcane');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = c[1];
    ctx.fillRect(Math.round(x + this.aimX * 14), Math.round(y + this.aimY * 14), 1, 1);
    ctx.fillStyle = c[0];
    ctx.fillRect(Math.round(x + this.aimX * 18) - 1, Math.round(y + this.aimY * 18), 3, 1);
    ctx.fillRect(Math.round(x + this.aimX * 18), Math.round(y + this.aimY * 18) - 1, 1, 3);
    ctx.globalAlpha = 1;
    if (this.statuses.some((s) => s.type === 'shock')) {
      ctx.fillStyle = '#ffe14a';
      if (Math.random() < 0.5) ctx.fillRect(x + Math.round((Math.random() - 0.5) * 10), y - Math.round(Math.random() * 10), 1, 2);
    }
  }
}
