// Enemies and their AI (team: combat).
// Every attack is TELEGRAPHED on the ground (Telegraph entity) and resolves against the shape
// when the wind-up ends, so a player who reads the warning and moves (or dashes) avoids it.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { moveCircle, hasLineOfSight } from '../core/physics.js';
import { ENEMIES, GEAR_DROPS } from './data.js';
import { damage, tickStatuses, floatText, hasStatus } from './rules.js';
import { Telegraph, Shockwave, Zone, Meteor, ArcVisual, Corpse, inShape, burst } from './effects.js';
import { enemyShoot } from './spells.js';
import { difficulty, angleDiff, turnToward, colorsOf, fx, sfx, shake, fillDisc, strokeDisc } from './util.js';

// Small BFS (8-way, no corner cutting) from the player's tile outward; returns the centre of the
// next tile an enemy at (fx, fy) should step to, or null. Bounded so it stays cheap.
const PATH_MAX = 1400;
let pathPrev = null, pathQ = null;
function pathStep(map, fx, fy, tx, ty) {
  const W = map.w, H = map.h, N = W * H;
  if (!pathPrev || pathPrev.length < N) { pathPrev = new Int32Array(N); pathQ = new Int32Array(N); }
  const sx = Math.floor(fx / 16), sy = Math.floor(fy / 16), gx = Math.floor(tx / 16), gy = Math.floor(ty / 16);
  if (sx === gx && sy === gy) return null;
  const goal = gy * W + gx, start = sy * W + sx;
  const seen = new Map();
  let qh = 0, qt = 0;
  pathQ[qt++] = goal; seen.set(goal, -1);
  while (qh < qt && qt < PATH_MAX) {
    const c = pathQ[qh++], cx = c % W, cy = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (seen.has(n)) continue;
      if (n !== start && map.isSolid(nx, ny, 'walk')) continue;
      if (dx && dy && (map.isSolid(cx + dx, cy, 'walk') || map.isSolid(cx, cy + dy, 'walk'))) continue;
      seen.set(n, c);
      if (n === start) return { x: cx * 16 + 8, y: cy * 16 + 8 }; // the tile we came from leads to the player
      pathQ[qt++] = n;
    }
  }
  return null;
}

const TAU = Math.PI * 2;
const AFFIXES = ['swift', 'warded', 'volatile', 'frenzied'];
const AFFIX_NAMES = { swift: 'Swift', warded: 'Warded', volatile: 'Volatile', frenzied: 'Frenzied' };
const WARD_COUNTER = { fire: 'ice', ice: 'fire', lightning: 'earth' };

export class Enemy extends Entity {
  constructor(game, def, x, y, opts = {}) {
    super(x, y);
    this.def = def;
    this.defId = def.id;
    this.element = def.element;
    this.team = 'enemy';
    this.tags.add('enemy');
    this.radius = def.radius;
    this.mass = def.mass;
    this.pushable = true;
    const ctx = opts.difficulty || difficulty(game);
    const L = Math.max(1, ctx.level || 1);
    this.level = L;
    const rng = game.rng;
    this.elite = !!opts.elite;
    this.affix = this.elite ? (opts.affix || rng.pick(AFFIXES)) : null;
    const hpMult = opts.hpMult ?? 1 + 0.2 * (L - 1);
    this.dmgMult = (opts.dmgMult ?? 1 + 0.08 * (L - 1)) * (this.elite ? 1.25 : 1);
    this.maxHp = this.hp = Math.max(1, Math.round(def.hp * hpMult * (this.elite ? 2.2 : 1)));
    this.speed = def.speed * (this.affix === 'swift' ? 1.3 : 1);
    this.windMul = this.affix === 'swift' ? 0.8 : 1;
    if (this.affix === 'warded') {
      this.wardEl = rng.pick(['fire', 'ice', 'lightning']);
      this.resistMod = { [this.wardEl]: 0.2, [WARD_COUNTER[this.wardEl]]: 1.5 };
    }
    this.home = { x, y };
    this.state = 'idle';
    this.stateT = 0;
    this.facing = rng.float(0, TAU);
    this.cd = rng.float(0.6, 1.4);
    this.statuses = [];
    this.kbx = this.kby = 0;
    this.poiseDmg = 0;
    this.noDrops = !!opts.noDrops;
    this.anim = 'idle';
    this.hurtFlash = 0;
    this.flinch = 0;
    this.guardBroken = 0;
    this.aggro = !!opts.aggro;
    this.lastSeen = null;
    this.wanderT = rng.float(0.5, 2);
    this.wanderDir = null;
    this.strafeDir = rng.sign();
    this.tele = [];
    this.slow = 1;
    this.moving = false;
    this.stuckT = 0;
    this.trailT = 0;
    this.combo = 0;
  }

  get displayName() {
    return this.elite ? `${AFFIX_NAMES[this.affix] || 'Elite'} ${this.def.name}` : this.def.name;
  }

  // ---------------------------------------------------------------- per tick

  update(game, dt) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.flinch = Math.max(0, this.flinch - dt);
    this.guardBroken = Math.max(0, this.guardBroken - dt);
    this.poiseDmg = Math.max(0, this.poiseDmg - 14 * dt);
    this.cd -= dt * (this.affix === 'frenzied' && this.hp < this.maxHp / 2 ? 1.7 : 1);
    const st = tickStatuses(game, this, dt);
    if (this.dead || this.dying) return;
    this.slow = st.slow;
    const map = game.level?.map;
    if (!map) return;

    if (this.kbx || this.kby) {
      moveCircle(map, this, this.kbx * dt, this.kby * dt);
      const k = Math.exp(-9 * dt);
      this.kbx *= k; this.kby *= k;
      if (Math.abs(this.kbx) + Math.abs(this.kby) < 2) this.kbx = this.kby = 0;
    }
    this.moving = false;
    if (st.stunned) {
      this.cancelAttack();
      if (this.state !== 'stunned') { this.state = 'stunned'; }
      this.stateT = 0.05;
      this.anim = 'hurt';
      return;
    }
    if (this.state === 'stunned' || this.state === 'stagger' || this.state === 'dazed') {
      this.stateT -= dt;
      this.anim = 'hurt';
      if (this.stateT > 0) return;
      this.state = 'chase';
    }
    if (this.flinch > 0 && !this.superArmorNow()) {
      if (this.state === 'windup') this.cancelAttack(0.35);
      this.anim = 'hurt';
      return;
    }

    const p = game.player;
    const alive = p && !p.dying && !p.dead && game.state.player.hp > 0;
    const c = this.sense(game, p, alive, st.blind);
    this.think(game, dt, p, c, st);
    if (this.def.trail) this.leaveTrail(game, dt);
    // engaged enemies carry a faint light so they stay readable in dark dungeons
    if (this.aggro && game.camera?.isVisible?.(this.x, this.y, 16)) {
      fx(game, 'addLight', this.x, this.y - 8, this.elite ? 30 : 22, this.elite ? '#ffb03a' : colorsOf(this.def.element)[0], 0.35);
    }
    const anim = this.state === 'windup' || this.state === 'strike' || this.state === 'charge' ? 'attack' : this.moving ? 'walk' : 'idle';
    if (anim !== this.anim) { this.anim = anim; this.animT0 = this.age; } // one-shot anims start at frame 0
  }

  /** Perception: distance, angle and line of sight to the player; handles aggro. */
  sense(game, p, alive, blind) {
    const c = { alive: false, d: Infinity, dx: 0, dy: 0, ang: this.facing, los: false };
    if (!alive) { this.aggro = false; return c; }
    c.dx = p.x - this.x; c.dy = p.y - this.y;
    c.d = Math.hypot(c.dx, c.dy);
    c.ang = Math.atan2(c.dy, c.dx);
    c.los = c.d < 260 && hasLineOfSight(game.level.map, this.x, this.y - 4, p.x, p.y - 4);
    if (blind) { c.alive = false; return c; }
    if (!this.aggro && c.los && c.d < this.def.aggroRange) this.alert(game);
    if (this.aggro && c.d > this.def.aggroRange * 2.6) this.aggro = false;
    if (c.los) this.lastSeen = { x: p.x, y: p.y };
    c.alive = this.aggro;
    return c;
  }

  alert(game) {
    if (this.aggro) return;
    this.aggro = true;
    if (this.state === 'idle') this.state = 'chase';
    for (const e of game.entities.inRadius(this.x, this.y, 90)) {
      if (e !== this && e.team === 'enemy' && !e.aggro && e.alert && !e.def?.boss) { e.aggro = true; if (e.state === 'idle') e.state = 'chase'; }
    }
  }

  // ---------------------------------------------------------------- movement helpers

  moveDir(game, nx, ny, mul = 1, dt = 1 / 60) {
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) return;
    const sp = this.speed * this.slow * mul * dt;
    const bx = this.x, by = this.y;
    const res = moveCircle(game.level.map, this, (nx / l) * sp, (ny / l) * sp);
    this.moving = true;
    if (res.hit && Math.hypot(this.x - bx, this.y - by) < sp * 0.3) {
      this.stuckT += dt;
      // slide around the obstacle
      const sx = -ny / l * this.strafeDir, sy = nx / l * this.strafeDir;
      moveCircle(game.level.map, this, sx * sp, sy * sp);
      if (this.stuckT > 0.8) { this.strafeDir *= -1; this.stuckT = 0; }
    } else this.stuckT = 0;
  }

  /**
   * Approach the player: straight at them with line of sight, else to their last seen position,
   * else along a short tile path (so foes never stall behind a doorway corner).
   */
  approach(game, dt, c, mul = 1) {
    this.pathLock = Math.max(0, (this.pathLock || 0) - dt);
    if (c.los && this.pathLock <= 0) {
      this.moveDir(game, c.dx, c.dy, mul, dt);
      if (this.stuckT > 0.3) { this.pathLock = 1.2; this.pathWp = null; } // walled off despite seeing you: go around
      return;
    }
    // No line of sight: an aggro'd foe hunts the player along a short tile path (never stalls behind a
    // doorway corner); the last seen position is only a fallback when no path is found.
    const p = game.player;
    this.pathT = (this.pathT || 0) - dt;
    if (p && (this.pathT <= 0 || !this.pathWp)) {
      this.pathT = 0.35 + Math.random() * 0.2;
      this.pathWp = pathStep(game.level.map, this.x, this.y, p.x, p.y);
    }
    const w = this.pathWp;
    if (w) {
      const dx = w.x - this.x, dy = w.y - this.y;
      if (Math.hypot(dx, dy) < 3) this.pathWp = null;
      else { this.moveDir(game, dx, dy, mul, dt); return; }
    }
    if (this.lastSeen) {
      const dx = this.lastSeen.x - this.x, dy = this.lastSeen.y - this.y;
      if (Math.hypot(dx, dy) > 6) this.moveDir(game, dx, dy, mul, dt);
      else this.lastSeen = null;
    }
  }

  wander(game, dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = game.rng.float(1.2, 2.8);
      const toHome = Math.hypot(this.home.x - this.x, this.home.y - this.y);
      if (toHome > 40) this.wanderDir = { x: this.home.x - this.x, y: this.home.y - this.y };
      else this.wanderDir = game.rng.chance(0.5) ? { x: game.rng.float(-1, 1), y: game.rng.float(-1, 1) } : null;
    }
    if (this.wanderDir) {
      this.moveDir(game, this.wanderDir.x, this.wanderDir.y, 0.35, dt);
      this.facing = turnToward(this.facing, Math.atan2(this.wanderDir.y, this.wanderDir.x), 3 * dt);
    }
  }

  face(target, rate, dt) {
    this.facing = turnToward(this.facing, target, rate * dt);
  }

  // ---------------------------------------------------------------- attack helpers

  telegraph(game, spec) {
    const t = new Telegraph({ x: this.x, y: this.y, color: this.elite ? '#ffb03a' : '#ff3a3a', ...spec });
    game.entities.add(t);
    this.tele.push(t);
    return t;
  }

  clearTele() {
    for (const t of this.tele) t.destroy();
    this.tele.length = 0;
  }

  windup(game, name, dur, specs = []) {
    this.state = 'windup';
    this.attack = name;
    this.stateT = dur * this.windMul;
    this.stateDur = this.stateT;
    this.clearTele();
    for (const s of specs) this.telegraph(game, { dur: this.stateT, ...s });
  }

  cancelAttack(recover = 0) {
    this.clearTele();
    if (this.state === 'windup' || this.state === 'strike' || this.state === 'charge') {
      this.state = recover > 0 ? 'dazed' : 'chase';
      this.stateT = recover;
      this.cd = Math.max(this.cd, 0.6);
    }
  }

  superArmorNow() {
    return !!this.def.superArmor && (this.state === 'windup' || this.state === 'strike' || this.state === 'charge');
  }

  hitPlayer(game, p, amount, opts = {}) {
    return damage(game, p, { amount: amount * this.dmgMult, element: opts.element || (this.def.element === 'physical' ? 'physical' : this.def.element), source: this, knockback: opts.knockback ?? 140, from: opts.from, statuses: opts.statuses });
  }

  addPoise(game, amount) {
    this.poiseDmg += amount;
    const thresh = (this.def.poise || 10) * (this.elite ? 1.5 : 1) * (this.def.superArmor ? 2 : 1);
    if (this.poiseDmg >= thresh && (this.state === 'windup' || this.state === 'charge')) {
      this.poiseDmg = 0;
      this.clearTele();
      this.state = 'stagger';
      this.stateT = 0.8;
      this.cd = Math.max(this.cd, 0.8);
      floatText(game, this, 'STAGGER', '#ffd25a');
    }
  }

  onHurt(game) {
    if (!this.aggro) this.alert(game);
    if (game.player) this.lastSeen = { x: game.player.x, y: game.player.y };
  }

  onFrozen() {
    this.cancelAttack();
  }

  /** Front shields & guard stances. Returns damage multiplier (<1 = blocked). */
  blockCheck(game, hit) {
    const mode = this.def.shield;
    if (!mode || this.guardBroken > 0 || hasStatus(this, 'freeze') || hasStatus(this, 'stun')) return 1;
    const guarding = mode === 'front'
      ? (this.state === 'chase' || this.state === 'idle')
      : (this.state === 'guard' || this.state === 'chase' || this.state === 'idle');
    if (!guarding) return 1;
    const ox = hit.from?.x ?? hit.source?.x, oy = hit.from?.y ?? hit.source?.y;
    if (ox == null) return 1;
    const front = angleDiff(Math.atan2(oy - this.y, ox - this.x), this.facing) < 1.15;
    if (hit.shieldBreak && front) {
      this.guardBroken = 3;
      floatText(game, this, 'GUARD BREAK', '#e8d08a');
      sfx(game, 'hit', 1, 0.5);
      return 1.15;
    }
    if (mode === 'front') {
      if (!front) return 1;
      return hit.element === 'lightning' ? 0.6 : 0.3;
    }
    // halberd guard: everything is halved, the front is walled off
    return front ? (hit.element === 'lightning' ? 0.55 : 0.2) : 0.6;
  }

  damageTakenMult() {
    return this.state === 'recover' && this.def.ai === 'sentinel' ? 1.3 : 1;
  }

  leaveTrail(game, dt) {
    if (!this.moving || hasStatus(this, 'chill') || hasStatus(this, 'freeze')) return;
    this.trailT -= dt;
    if (this.trailT > 0) return;
    this.trailT = 0.45;
    const type = this.def.trail === 'frost' ? 'frost' : 'fire';
    game.entities.add(new Zone(game, type, this.x, this.y + 1, {
      team: 'enemy', source: this, radius: 9, life: 3.5, power: type === 'frost' ? 18 : Math.max(2, 3 * this.dmgMult),
    }));
  }

  // ---------------------------------------------------------------- AI (overridden)

  think(game, dt, p, c) {
    if (!c.alive) return this.wander(game, dt);
    this.face(c.ang, 4, dt);
    const reach = this.def.attack.range + this.radius + p.radius;
    if (this.state === 'windup') {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.clearTele();
        if (inShape(p, 'circle', this.x, this.y, { r: reach })) this.hitPlayer(game, p, this.def.damage);
        this.state = 'recover'; this.stateT = 0.5; this.cd = this.def.attack.cooldown;
      }
      return;
    }
    if (this.state === 'recover') { this.stateT -= dt; if (this.stateT <= 0) this.state = 'chase'; return; }
    if (c.d > reach * 0.8) this.approach(game, dt, c);
    if (c.d <= reach && this.cd <= 0) this.windup(game, 'hit', this.def.attack.windup, [{ shape: 'circle', r: reach, follow: this }]);
  }

  // ---------------------------------------------------------------- death & drops

  die(game, killer) {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.clearTele();
    this.destroy();
    game.state.stats.kills++;
    game.bus.emit(EV.ENTITY_KILLED, { target: this, killer, x: this.x, y: this.y });
    const key = this.spriteKey(game);
    if (key) game.entities.add(new Corpse(key, this.x, this.y, Math.cos(this.facing) < 0, this.dirName()));
    if (this.affix === 'volatile') {
      game.entities.add(new Meteor(game, this.x, this.y, { team: 'enemy', source: this, radius: 34, amount: 14 * this.dmgMult, delay: 0.9, element: 'fire', stun: 0, colors: ['#ff6a1f', '#ffd25a'] }));
    }
    if (!this.noDrops) this.dropLoot(game);
  }

  dropLoot(game) {
    const rng = game.rng;
    const spawn = (kind, data) => {
      const f = game.world?.spawnPickup;
      if (typeof f !== 'function') return;
      try { f(game, kind, this.x + rng.float(-7, 7), this.y + rng.float(-5, 5), data); } catch (err) { console.warn('[combat] spawnPickup failed', err); }
    };
    for (const d of this.def.drops || []) {
      const chance = Math.min(1, d.chance * (this.elite ? 1.6 : 1));
      if (!rng.chance(chance)) continue;
      if (d.kind === 'gear') { const id = rollGear(rng, this.level); if (id) spawn('item', { itemId: id, amount: 1 }); continue; }
      const amount = rng.int(d.min ?? 1, d.max ?? 1) + (this.elite && d.kind === 'fragment' ? 1 : 0);
      spawn(d.kind, { element: d.element, itemId: d.itemId, amount });
    }
    if (this.elite) {
      const el = ['fire', 'ice', 'lightning', 'earth', 'arcane'].includes(this.def.element) ? this.def.element : rng.pick(['fire', 'ice', 'lightning']);
      spawn('fragment', { element: el, amount: rng.int(2, 3) });
      if (rng.chance(0.3)) { const id = rollGear(rng, this.level); if (id) spawn('item', { itemId: id, amount: 1 }); }
    }
  }

  // ---------------------------------------------------------------- rendering

  spriteKey(game) {
    const art = game.art;
    if (art?.hasSprite?.(this.def.sprite)) return this.def.sprite;
    return this.def.fallbackSprite || (art?.hasSprite ? null : this.def.sprite);
  }

  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    const art = game.art;
    const frozen = hasStatus(this, 'freeze');
    const bob = this.def.flying ? Math.round(Math.sin(this.age * 5) * 1.5) - 5 : 0;
    art.drawShadow?.(ctx, x, y, this.radius * 2);
    const key = this.spriteKey(game);
    this._fallback = key !== this.def.sprite;
    let top = y - 18;
    if (key) {
      const sh = art.getSprite?.(key);
      if (sh) top = y + bob - sh.ay;
      const tele = this.state === 'windup' && this.stateT < 0.12;
      art.drawSprite(ctx, key, x, y + bob, {
        anim: frozen ? 'hurt' : this.anim, t: frozen ? 0 : this.age - (this.animT0 || 0), flip: Math.cos(this.facing) < 0, dir: this.dirName(),
        flash: this.hurtFlash > 0 ? 1 : tele ? 0.6 : 0,
      });
    } else {
      this.drawWisp(ctx, x, y + bob);
      top = y + bob - 8;
    }
    this.drawGear(ctx, x, y + bob);
    this.drawStatus(ctx, game, x, y + bob, top);
  }

  dirName() {
    const c = Math.cos(this.facing), s = Math.sin(this.facing);
    return Math.abs(s) > Math.abs(c) * 1.2 ? (s < 0 ? 'up' : 'down') : 'side';
  }

  drawWisp(ctx, x, y) {
    const [c1, c2] = colorsOf(this.def.element);
    const pulse = 3 + Math.round(Math.sin(this.age * 9));
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c1;
    fillDisc(ctx, x, y - 4, pulse + 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.hurtFlash > 0 ? '#ffffff' : c2;
    fillDisc(ctx, x, y - 4, Math.max(1, pulse - 1));
    ctx.fillStyle = '#20102a';
    const f = Math.cos(this.facing) < 0 ? -1 : 1;
    ctx.fillRect(x + f, y - 5, 1, 1);
  }

  /** Weapon/shield overlays so each armour type reads at a glance. */
  drawGear(ctx, x, y) {
    const ai = this.def.ai;
    const c = Math.cos(this.facing), s = Math.sin(this.facing);
    if (this.def.shield === 'front' && this.guardBroken <= 0 && (this.state === 'chase' || this.state === 'idle')) {
      const sx = Math.round(x + c * 7), sy = Math.round(y - 7 + s * 4);
      ctx.fillStyle = '#3a3a52';
      ctx.fillRect(sx - 2, sy - 3, 4, 6);
      ctx.fillStyle = this.def.id === 'armor_captain' ? '#ffd25a' : '#a8b0c8';
      ctx.fillRect(sx - 1, sy - 2, 2, 4);
    }
    if (ai === 'lancer' && this._fallback) {
      const len = this.state === 'charge' ? 16 : 13;
      const bx = x + c * 2, by = y - 8 + s * 2;
      ctx.fillStyle = '#8a6a4a';
      for (let i = 0; i < len; i++) ctx.fillRect(Math.round(bx + c * i), Math.round(by + s * i * 0.7), 1, 1);
      ctx.fillStyle = '#e6e6f0';
      ctx.fillRect(Math.round(bx + c * len) - 1, Math.round(by + s * len * 0.7) - 1, 2, 2);
    } else if (ai === 'sentinel' && this._fallback) {
      const a = this.state === 'windup' && this.attack === 'sweep' ? this.age * 14 : this.facing;
      const ca = Math.cos(a), sa = Math.sin(a);
      const bx = x + ca * 3, by = y - 9;
      ctx.fillStyle = '#6a5a4a';
      for (let i = 0; i < 15; i++) ctx.fillRect(Math.round(bx + ca * i), Math.round(by + sa * i * 0.7 - (this.state === 'guard' ? i * 0.4 : 0)), 1, 1);
      ctx.fillStyle = '#d8d8e8';
      const hx = Math.round(bx + ca * 15), hy = Math.round(by + sa * 15 * 0.7 - (this.state === 'guard' ? 6 : 0));
      ctx.fillRect(hx - 1, hy - 2, 3, 4);
    } else if (ai === 'crystal' && this._fallback) {
      ctx.fillStyle = '#9ae8ff';
      ctx.fillRect(x - 5, y - 20, 2, 4);
      ctx.fillRect(x + 3, y - 21, 2, 5);
      ctx.fillStyle = '#e6fbff';
      ctx.fillRect(x - 1, y - 23, 2, 5);
    }
  }

  drawStatus(ctx, game, x, y, top) {
    const t = this.age;
    if (hasStatus(this, 'freeze')) {
      const h = Math.max(10, y - top + 2), w = this.radius * 2 + 4;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#9ae8ff';
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e6fbff';
      ctx.fillRect(x - w / 2, y - h, w, 1);
      ctx.fillRect(x - w / 2, y - h, 1, h);
      ctx.fillRect(x - w / 2 + 2, y - h + 2, 1, 3);
      ctx.globalAlpha = 1;
    } else {
      const ch = this.statuses.find((s) => s.type === 'chill');
      if (ch) {
        // chill meter under the feet: fills toward FREEZE
        const w = 12, f = Math.round((ch.power / 100) * w);
        ctx.fillStyle = 'rgba(10,20,40,0.7)';
        ctx.fillRect(x - w / 2, y + 3, w, 2);
        ctx.fillStyle = '#4fc8ff';
        ctx.fillRect(x - w / 2, y + 3, f, 2);
      }
    }
    if (hasStatus(this, 'blind')) {
      ctx.fillStyle = '#c8c8d0';
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * TAU) / 3;
        ctx.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(top - 2 + Math.sin(a) * 2), 1, 1);
      }
    }
    if (hasStatus(this, 'vulnerable')) {
      ctx.fillStyle = '#c87aff';
      const by = Math.round(top - 4 + Math.sin(t * 6));
      ctx.fillRect(x - 1, by - 2, 3, 1);
      ctx.fillRect(x, by - 1, 1, 2);
    }
    if (this.guardBroken > 0) {
      ctx.fillStyle = '#e8d08a';
      ctx.fillRect(x - 3, top - 3, 1, 1); ctx.fillRect(x + 3, top - 4, 1, 1);
    }
    if (this.state === 'stunned' || this.state === 'stagger' || this.state === 'dazed') {
      if (!hasStatus(this, 'freeze')) {
        ctx.fillStyle = '#ffd25a';
        for (let i = 0; i < 3; i++) {
          const a = t * 6 + (i * TAU) / 3;
          ctx.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(top - 3 + Math.sin(a) * 1.5), 1, 1);
        }
      }
    }
  }

  renderGlow(ctx) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    if (this.elite) {
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(this.age * 5);
      ctx.fillStyle = this.wardEl ? colorsOf(this.wardEl)[0] : '#ffb03a';
      strokeDisc(ctx, x, y, this.radius + 4, 0.5);
      ctx.globalAlpha = 1;
    }
    if (hasStatus(this, 'shock')) {
      ctx.fillStyle = '#ffe14a';
      for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.5) continue;
        ctx.fillRect(x + Math.round((Math.random() - 0.5) * 14), y - 4 - Math.round(Math.random() * 14), 1, 2);
      }
    }
    if (this.state === 'windup' && this.stateT < 0.15) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(x - 1, y - 26, 2, 4);
      ctx.fillRect(x - 1, y - 21, 2, 1);
      ctx.globalAlpha = 1;
    }
  }
}

// ==================================================================== KNIGHT (sword & shield)

export class Knight extends Enemy {
  think(game, dt, p, c) {
    if (!c.alive) {
      if (this.state === 'windup' || this.state === 'strike') this.cancelAttack();
      this.state = 'idle';
      return this.wander(game, dt);
    }
    const reach = this.def.attack.range + this.radius + p.radius;
    switch (this.state) {
      case 'idle': this.state = 'chase'; break;
      case 'windup': {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.clearTele();
          // lunge into the slash
          const c0 = Math.cos(this.facing), s0 = Math.sin(this.facing);
          moveCircle(game.level.map, this, c0 * 6, s0 * 6);
          const spec = { r: reach + 6, angle: this.facing, halfAngle: 1.0 };
          if (inShape(p, 'cone', this.x, this.y, spec)) this.hitPlayer(game, p, this.def.damage, { knockback: 160 });
          fx(game, 'emit', 'hit', this.x + c0 * 14, this.y - 6 + s0 * 8, { color: '#ffffff', color2: '#c8c8d0', count: 5, angle: this.facing, spread: 1.6 });
          sfx(game, 'hit', 0.4, 1.4);
          this.combo -= 1;
          if (this.combo > 0) {
            this.face(c.ang, 99, 1);
            this.windup(game, 'slash', 0.32, [{ shape: 'cone', r: reach + 6, angle: this.facing, halfAngle: 1.0, follow: this }]);
          } else {
            this.state = 'recover';
            this.stateT = 0.7;
            this.cd = this.def.attack.cooldown;
          }
        }
        break;
      }
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'chase';
        break;
      default: { // chase
        this.face(c.ang, this.def.turnRate || 3, dt);
        const inFront = angleDiff(c.ang, this.facing) < 0.5;
        if (c.d > reach * 0.85) this.approach(game, dt, c, inFront ? 1 : 0.6);
        else if (c.d < reach * 0.5) this.moveDir(game, -c.dx, -c.dy, 0.4, dt);
        if (c.d <= reach + 4 && this.cd <= 0 && inFront && c.los) {
          this.combo = this.def.attack.combo || 1;
          this.windup(game, 'slash', this.def.attack.windup, [{ shape: 'cone', r: reach + 6, angle: this.facing, halfAngle: 1.0, follow: this }]);
        }
      }
    }
  }
}

// ==================================================================== LANCER (spear charge)

export class Lancer extends Enemy {
  think(game, dt, p, c) {
    if (!c.alive) {
      if (this.state !== 'idle') this.cancelAttack();
      this.state = 'idle';
      return this.wander(game, dt);
    }
    switch (this.state) {
      case 'windup': {
        this.stateT -= dt;
        const t = this.tele[0];
        if (this.attack === 'charge' && this.stateT > this.stateDur * 0.4) {
          this.face(c.ang, 5, dt); // tracks you, then locks
          if (t) t.angle = this.facing;
        }
        if (t) { t.x = this.x; t.y = this.y; }
        if (this.stateT <= 0) {
          this.clearTele();
          if (this.attack === 'charge') { this.state = 'charge'; this.chargeDist = 0; this.chargeHit = false; sfx(game, 'cast_earth', 0.6, 1.4); }
          else {
            const spec = { length: 34, width: 10, angle: this.facing };
            if (inShape(p, 'line', this.x, this.y, spec)) this.hitPlayer(game, p, this.def.damage * 0.6, { knockback: 120 });
            this.state = 'recover'; this.stateT = 0.5; this.pokeCd = 1.2;
          }
        }
        break;
      }
      case 'charge': {
        const sp = 260 * dt * this.slow;
        const cx = Math.cos(this.facing), cy = Math.sin(this.facing);
        const bx = this.x, by = this.y;
        const res = moveCircle(game.level.map, this, cx * sp, cy * sp);
        this.chargeDist += Math.hypot(this.x - bx, this.y - by);
        this.moving = true;
        if (Math.random() < 0.5) fx(game, 'emit', 'dust', this.x, this.y, { count: 1 });
        if (!this.chargeHit && Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius + 4) {
          this.chargeHit = true;
          this.hitPlayer(game, p, this.def.damage * 1.2, { knockback: 240 });
        }
        if (res.hit && Math.hypot(this.x - bx, this.y - by) < sp * 0.5) {
          // slammed into a wall: dazed and open
          this.state = 'dazed'; this.stateT = 1.6; this.cd = this.def.attack.cooldown;
          floatText(game, this, 'CLANG!', '#ffd25a');
          shake(game, 3, 0.2);
          sfx(game, 'hit', 1, 0.5);
          fx(game, 'emit', 'dust', this.x + cx * 6, this.y + cy * 6, { count: 8 });
        } else if (this.chargeDist > 170) {
          this.state = 'recover'; this.stateT = 0.8; this.cd = this.def.attack.cooldown;
        }
        break;
      }
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'chase';
        break;
      default: {
        this.state = 'chase';
        this.pokeCd = Math.max(0, (this.pokeCd || 0) - dt);
        this.face(c.ang, this.def.turnRate || 4, dt);
        const want = 85;
        if (!c.los || c.d > want + 35) this.approach(game, dt, c);
        else if (c.d < want - 30) this.moveDir(game, -c.dx, -c.dy, 0.7, dt);
        else this.moveDir(game, -c.dy * this.strafeDir, c.dx * this.strafeDir, 0.45, dt);
        if (c.d < 36 && this.pokeCd <= 0) {
          this.windup(game, 'poke', 0.38, [{ shape: 'line', length: 34, width: 10, angle: this.facing }]);
        } else if (this.cd <= 0 && c.los && c.d > 45 && c.d < 150) {
          this.windup(game, 'charge', this.def.attack.windup, [{ shape: 'line', length: 170, width: 12, angle: this.facing }]);
        }
      }
    }
  }
}

// ==================================================================== SENTINEL (halberd guard)

export class Sentinel extends Enemy {
  constructor(...a) {
    super(...a);
    this.state = 'guard';
  }
  think(game, dt, p, c) {
    const leash = this.def.leash || 90;
    const homeD = Math.hypot(this.home.x - this.x, this.home.y - this.y);
    const sweepR = this.def.attack.range;
    switch (this.state) {
      case 'windup': {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.clearTele();
          if (this.attack === 'sweep') {
            if (c.alive && inShape(p, 'circle', this.x, this.y, { r: sweepR })) this.hitPlayer(game, p, this.def.damage, { knockback: 260 });
            fx(game, 'ring', this.x, this.y, sweepR, '#ffffff', 0.25);
            shake(game, 2, 0.15);
            this.state = 'recover'; this.stateT = 1.3;
          } else {
            const spec = { length: 62, width: 10, angle: this.facing };
            if (c.alive && inShape(p, 'line', this.x, this.y, spec)) this.hitPlayer(game, p, this.def.damage * 0.75, { knockback: 160 });
            this.state = 'recover'; this.stateT = 0.6;
          }
          this.cd = this.def.attack.cooldown;
        }
        break;
      }
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'guard';
        break;
      default: {
        this.state = 'guard';
        if (!c.alive) {
          if (homeD > 4) this.moveDir(game, this.home.x - this.x, this.home.y - this.y, 0.6, dt);
          return;
        }
        this.face(c.ang, 2.5, dt);
        if (c.d < sweepR + 2 && this.cd <= 0) {
          this.windup(game, 'sweep', this.def.attack.windup, [{ shape: 'circle', r: sweepR, follow: this }]);
        } else if (c.d < 75 && this.cd <= 0 && angleDiff(c.ang, this.facing) < 0.4) {
          this.windup(game, 'thrust', 0.6, [{ shape: 'line', length: 62, width: 10, angle: this.facing }]);
        } else if (c.d > sweepR - 6 && homeD < leash) {
          this.approach(game, dt, c, 0.8);
        } else if (homeD >= leash) {
          this.moveDir(game, this.home.x - this.x, this.home.y - this.y, 0.6, dt);
        }
      }
    }
  }
}

// ==================================================================== GOLEM (slam + shockwave)

export class Golem extends Enemy {
  think(game, dt, p, c) {
    if (!c.alive) {
      if (this.state === 'windup') this.cancelAttack();
      this.state = 'idle';
      return this.wander(game, dt);
    }
    const slamR = 28;
    switch (this.state) {
      case 'windup':
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.clearTele();
          const el = this.def.element;
          if (inShape(p, 'circle', this.x, this.y, { r: slamR })) this.hitPlayer(game, p, this.def.damage, { knockback: 220 });
          const statuses = el === 'ice' ? [{ type: 'chill', duration: 2.5, power: 40 }] : el === 'fire' ? [{ type: 'burn', duration: 2, power: 2 }] : null;
          game.entities.add(new Shockwave({
            x: this.x, y: this.y, r0: slamR, r1: 78, dur: 0.55, team: 'enemy', source: this,
            amount: this.def.damage * 0.5 * this.dmgMult, element: el === 'physical' ? 'earth' : el, statuses,
            color: colorsOf(el)[1],
          }));
          if (el === 'fire') game.entities.add(new Zone(game, 'lava', this.x, this.y, { team: 'enemy', source: this, radius: 16, life: 3, power: 3 * this.dmgMult }));
          if (el === 'ice') game.entities.add(new Zone(game, 'frost', this.x, this.y, { team: 'enemy', source: this, radius: 22, life: 3.5, power: 20 }));
          fx(game, 'emit', 'dust', this.x, this.y, { count: 14 });
          shake(game, 4, 0.25);
          sfx(game, 'cast_earth', 1, 0.55);
          this.state = 'recover'; this.stateT = 1.1; this.cd = this.def.attack.cooldown;
        }
        break;
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'chase';
        break;
      default: {
        this.state = 'chase';
        this.face(c.ang, 2.5, dt);
        if (c.d > slamR - 4) this.approach(game, dt, c);
        if (c.d < slamR + 8 && this.cd <= 0) {
          this.windup(game, 'slam', this.def.attack.windup, [
            { shape: 'circle', r: slamR, follow: this },
            { shape: 'ring', r: 78, r0: slamR, follow: this, color: '#ff8a3a' },
          ]);
        }
      }
    }
  }
}

// ==================================================================== CRYSTAL GOLEM (shards)

export class CrystalGolem extends Enemy {
  think(game, dt, p, c) {
    if (!c.alive) {
      if (this.state === 'windup') this.cancelAttack();
      this.state = 'idle';
      return this.wander(game, dt);
    }
    switch (this.state) {
      case 'windup': {
        this.stateT -= dt;
        if (this.attack === 'fan' && this.stateT > this.stateDur * 0.5) {
          this.face(c.ang, 3, dt);
          this.tele.forEach((t, i) => { t.angle = this.facing + (i - 1) * 0.24; });
        }
        if (this.stateT <= 0) {
          this.clearTele();
          if (this.attack === 'fan') {
            for (let i = -1; i <= 1; i++) { const a = this.facing + i * 0.24; enemyShoot(game, this, 'crystal_shard', Math.cos(a), Math.sin(a), this.dmgMult); }
          } else {
            const off = game.rng.float(0, TAU);
            for (let i = 0; i < 8; i++) { const a = off + (i / 8) * TAU; enemyShoot(game, this, 'crystal_shard', Math.cos(a), Math.sin(a), this.dmgMult * 0.8, { speed: 120 }); }
          }
          sfx(game, 'cast_ice', 0.7, 1.3);
          this.state = 'recover'; this.stateT = 0.6; this.cd = this.def.attack.cooldown;
        }
        break;
      }
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'chase';
        break;
      default: {
        this.state = 'chase';
        this.face(c.ang, 3, dt);
        if (!c.los || c.d > 140) this.approach(game, dt, c);
        else if (c.d < 70) this.moveDir(game, -c.dx, -c.dy, 0.8, dt);
        else this.moveDir(game, -c.dy * this.strafeDir, c.dx * this.strafeDir, 0.3, dt);
        if (this.cd <= 0 && c.los && c.d < 170) {
          this.shots = (this.shots || 0) + 1;
          if (this.shots % 3 === 0) this.windup(game, 'nova', 0.8, [{ shape: 'circle', r: 20, follow: this, color: '#4fc8ff' }]);
          else this.windup(game, 'fan', this.def.attack.windup, [-1, 0, 1].map((i) => ({ shape: 'line', length: 150, width: 4, angle: this.facing + i * 0.24, follow: this, color: '#4fc8ff' })));
        }
      }
    }
  }
}

// ==================================================================== WISPS (fodder)

export class Wisp extends Enemy {
  constructor(...a) {
    super(...a);
    this.orbitA = this.facing;
    this.layer = 1;
  }
  think(game, dt, p, c) {
    if (!c.alive) {
      if (this.state !== 'idle') this.cancelAttack();
      this.state = 'idle';
      return this.wander(game, dt);
    }
    const el = this.def.element;
    switch (this.state) {
      case 'windup': {
        this.stateT -= dt;
        const t = this.tele[0];
        if (t) { t.x = this.x; t.y = this.y; }
        if (this.stateT <= 0) {
          this.clearTele();
          if (el === 'fire') { this.state = 'charge'; this.chargeT = 0.35; this.chargeHit = false; }
          else if (el === 'ice') { enemyShoot(game, this, 'frost_mote', Math.cos(this.facing), Math.sin(this.facing), this.dmgMult); this.state = 'recover'; this.stateT = 0.4; }
          else {
            const spec = { length: 110, width: 6, angle: this.facing };
            const ex = this.x + Math.cos(this.facing) * 110, ey = this.y + Math.sin(this.facing) * 110;
            game.entities.add(new ArcVisual([{ x: this.x, y: this.y - 6 }, { x: ex, y: ey - 6 }], colorsOf('lightning'), 0.15));
            if (inShape(p, 'line', this.x, this.y, spec)) this.hitPlayer(game, p, this.def.damage, { element: 'lightning', knockback: 60, statuses: [{ type: 'shock', duration: 1, power: 1 }] });
            sfx(game, 'cast_lightning', 0.5, 1.5);
            this.state = 'recover'; this.stateT = 0.5;
          }
          this.cd = this.def.attack.cooldown + game.rng.float(0, 0.8);
        }
        break;
      }
      case 'charge': {
        this.chargeT -= dt;
        moveCircle(game.level.map, this, Math.cos(this.facing) * 260 * dt, Math.sin(this.facing) * 260 * dt);
        this.moving = true;
        if (!this.chargeHit && Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius + 3) {
          this.chargeHit = true;
          this.hitPlayer(game, p, this.def.damage, { element: 'fire', statuses: [{ type: 'burn', duration: 2, power: 1 }] });
        }
        if (this.chargeT <= 0) { this.state = 'recover'; this.stateT = 0.5; }
        break;
      }
      case 'recover':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'chase';
        break;
      default: {
        this.state = 'chase';
        // orbit the player at a jittery radius
        this.orbitA += this.strafeDir * 1.2 * dt;
        const want = 52 + Math.sin(this.age * 2.3) * 10;
        const tx = p.x + Math.cos(this.orbitA) * want, ty = p.y + Math.sin(this.orbitA) * want;
        if (Math.hypot(tx - this.x, ty - this.y) > 3) this.moveDir(game, tx - this.x, ty - this.y, 1, dt);
        this.facing = c.ang;
        if (this.cd <= 0 && c.los && c.d < this.def.attack.range) {
          const len = el === 'fire' ? 90 : 110;
          this.windup(game, 'zap', this.def.attack.windup, el === 'ice' ? [{ shape: 'circle', r: 6, follow: this, color: '#4fc8ff' }] : [{ shape: 'line', length: len, width: el === 'fire' ? 8 : 6, angle: this.facing, color: colorsOf(el)[0] }]);
        }
      }
    }
  }
}

// ==================================================================== factory

const AI_CLASSES = { knight: Knight, lancer: Lancer, sentinel: Sentinel, golem: Golem, crystal: CrystalGolem, wisp: Wisp };

export function createEnemyEntity(game, def, x, y, opts) {
  const Cls = AI_CLASSES[def.ai] || Enemy;
  return new Cls(game, def, x, y, opts);
}

export function rollGear(rng, level) {
  const pool = GEAR_DROPS.filter((g) => g.minLevel <= level + 0.01);
  const pick = rng.weighted(pool);
  return pick?.itemId || null;
}

export { ENEMIES };
