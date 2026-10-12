// The Corrupted Archmage (team: combat). Three phases, every attack telegraphed.
//
//  Phase I   "The Scholar of Ruin"  (100% - 66%)  ring volleys with a gap, aimed bursts,
//            teleports, erupting glyphs. Element WARD (fire/ice) cuts damage to 25% until broken
//            with the counter element (fire <-> ice, storm <- earth). Breaking it EXPOSES him.
//  Phase II  "The Summoner"         (66% - 33%)   + storm ward, armour minions, spiral barrage, seekers.
//  Phase III "Unbound"              (33% - 0%)    ward gone for good, faster; sweeping beam,
//            meteor rain, corruption pools appear on the arena floor.
import { EV } from '../core/events.js';
import { moveCircle } from '../core/physics.js';
import { Enemy } from './enemies.js';
import { damage, tickStatuses, floatText } from './rules.js';
import { Telegraph, Shockwave, Zone, Meteor, inShape, burst } from './effects.js';
import { enemyShoot } from './spells.js';
import { colorsOf, fx, sfx, shake, hitStop, fillDisc, strokeDisc, isTarget } from './util.js';

const TAU = Math.PI * 2;
export const WARD_COUNTER = { fire: 'ice', ice: 'fire', lightning: 'earth' };
const WARD_NAME = { fire: 'FLAME', ice: 'FROST', lightning: 'STORM' };
const BOLT = { fire: 'boss_bolt_fire', ice: 'boss_bolt_ice', lightning: 'boss_bolt_lightning' };
const THRESH = [0.66, 0.33];

const WEIGHTS = {
  1: { ring: 3, aimed: 3, teleport: 2, hazard: 2 },
  2: { ring: 2, aimed: 2, teleport: 2, hazard: 2, summon: 2, spiral: 2, seekers: 1 },
  3: { ring: 2, aimed: 1, teleport: 2, hazard: 1, summon: 1, spiral: 2, beam: 2, meteor: 2, seekers: 1 },
};
const GAP = { 1: 1.3, 2: 1.0, 3: 0.75 };
const LINES = {
  2: 'The Archmage: "You think wards are all I know? RISE, my sentinels!"',
  3: 'The Archmage: "Enough! I will unmake this tower, and you with it!"',
};

export class Archmage extends Enemy {
  constructor(game, def, x, y) {
    super(game, def, x, y, { hpMult: 1, dmgMult: 1, difficulty: { level: 1 } });
    this.tags.add('boss');
    this.maxHp = this.hp = def.hp;
    this.aggro = true;
    this.phase = 1;
    this.state = 'intro';
    this.stateT = 1.6;
    this.ward = null;
    this.wardHp = this.wardMax = 0;
    this.wardIdx = 0;
    this.exposedT = 0;
    this.unwardedT = 0;
    this.pat = null;
    this.lastPat = null;
    this.cd = 0.8;
    this.alpha = 1;
    this.invulnerable = false;
    this.minions = [];
    this.poolT = 4;
    this.wp = null;
    this.beam = null;
    this.contactCd = 0;
    this.dyingT = 0;
    this.arena = null;
  }

  get displayName() { return this.def.name; }
  superArmorNow() { return true; }
  addPoise() {}
  blockCheck() { return 1; }

  // ---------------------------------------------------------------- tick

  update(game, dt) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.dying) return this.updateDying(game, dt);
    tickStatuses(game, this, dt);
    if (this.dead || this.dying) return;
    const map = game.level?.map;
    if (!map) return;
    if (!this.arena) this.arena = { x: map.widthPx / 2, y: Math.min(map.heightPx / 2, this.home.y + 60), rx: Math.min(150, map.widthPx / 2 - 40), ry: Math.min(110, map.heightPx / 2 - 40) };
    const p = game.player;
    const alive = p && !p.dying && game.state.player.hp > 0;
    this.contactCd = Math.max(0, this.contactCd - dt);
    if (alive && this.alpha > 0.5 && this.contactCd <= 0 && Math.hypot(p.x - this.x, p.y - this.y) < this.radius + p.radius + 1) {
      this.contactCd = 0.8;
      this.hitPlayer(game, p, 8, { element: 'arcane', knockback: 220 });
    }
    this.updateWard(game, dt);
    if (this.phase === 3 && alive && this.state !== 'transition') this.updatePools(game, dt, p);
    this.minions = this.minions.filter((m) => !m.dead);

    switch (this.state) {
      case 'intro':
        this.stateT -= dt;
        this.hover(game, dt, p, 0.3);
        if (this.stateT <= 0) { this.state = 'idle'; this.raiseWard(game); }
        break;
      case 'transition':
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.invulnerable = false;
          this.state = 'idle';
          this.cd = 0.6;
          if (this.phase === 2) { this.raiseWard(game); this.startPattern(game, 'summon', p); }
        }
        break;
      case 'exposed':
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'idle'; this.cd = 0.5; }
        break;
      case 'pattern':
        if (!alive) { this.endPattern(); break; }
        if (this.pat.update(game, dt, p)) this.endPattern();
        break;
      default: // idle
        if (!alive) { this.hover(game, dt, null, 0.4); break; }
        this.hover(game, dt, p, 1);
        this.cd -= dt;
        if (this.cd <= 0) this.startPattern(game, this.choosePattern(game), p);
    }
    fx(game, 'addLight', this.x, this.y - 14, 60, this.ward ? colorsOf(this.ward)[0] : '#ff3a8a', 0.9);
    this.anim = this.state === 'pattern' ? 'cast' : this.state === 'exposed' ? 'hurt' : 'idle';
  }

  hover(game, dt, p, mul) {
    const a = this.arena;
    if (!this.wp || Math.hypot(this.wp.x - this.x, this.wp.y - this.y) < 6 || this.wpT <= 0) {
      this.wpT = game.rng.float(1.5, 3);
      const map = game.level.map;
      for (let i = 0; i < 12; i++) {
        let x, y;
        if (p) {
          // stay on screen: 85-135 px from the player, biased to the side we are already on
          const base = Math.atan2(this.y - p.y, this.x - p.x);
          const ang = base + game.rng.float(-1.1, 1.1);
          const d = game.rng.float(85, 135);
          x = p.x + Math.cos(ang) * d; y = p.y + Math.sin(ang) * d * 0.8;
        } else {
          x = a.x + game.rng.float(-a.rx, a.rx); y = a.y + game.rng.float(-a.ry, a.ry);
        }
        x = Math.max(28, Math.min(map.widthPx - 28, x));
        y = Math.max(36, Math.min(map.heightPx - 28, y));
        if (map.isSolidAt(x, y) || map.isSolidAt(x, y - 12)) continue;
        if (p && Math.hypot(p.x - x, p.y - y) < 70) continue;
        this.wp = { x, y };
        break;
      }
    }
    this.wpT -= dt;
    if (p && Math.hypot(p.x - this.x, p.y - this.y) > 170) mul *= 2.4; // close in when far away
    if (this.wp) {
      const dx = this.wp.x - this.x, dy = this.wp.y - this.y, d = Math.hypot(dx, dy);
      if (d > 1) moveCircle(game.level.map, this, (dx / d) * this.speed * mul * dt, (dy / d) * this.speed * mul * dt);
    }
    if (p) this.facing = Math.atan2(p.y - this.y, p.x - this.x);
  }

  // ---------------------------------------------------------------- ward

  raiseWard(game) {
    if (this.phase >= 3) { this.ward = null; return; }
    const cycle = this.phase === 1 ? ['fire', 'ice'] : ['lightning', 'fire', 'ice'];
    this.ward = cycle[this.wardIdx++ % cycle.length];
    this.wardMax = this.wardHp = this.phase === 1 ? 110 : 150;
    this.unwardedT = 0;
    floatText(game, this, `${WARD_NAME[this.ward]} WARD`, colorsOf(this.ward)[1], true);
    game.after?.(0.6, () => !this.dead && this.ward && floatText(game, this, `weak to ${WARD_COUNTER[this.ward].toUpperCase()}`, colorsOf(WARD_COUNTER[this.ward])[0]));
    fx(game, 'ring', this.x, this.y - 12, 24, colorsOf(this.ward)[0], 0.4);
    sfx(game, `cast_${this.ward}`, 0.9, 0.6);
    game.bus.emit('combat:bossWard', { boss: this, element: this.ward, counter: WARD_COUNTER[this.ward] });
  }

  updateWard(game, dt) {
    if (this.ward || this.phase >= 3 || this.state === 'intro' || this.state === 'transition') return;
    if (this.exposedT > 0) {
      this.exposedT -= dt;
      if (this.exposedT <= 0) this.unwardedT = 4;
      return;
    }
    this.unwardedT -= dt;
    if (this.unwardedT <= 0) this.raiseWard(game);
  }

  /** Called by rules.damage(): wards absorb most damage unless hit by the counter element. */
  wardFilter(game, hit, amount) {
    if (!this.ward) return this.exposedT > 0 ? amount * 1.5 : amount;
    const counter = WARD_COUNTER[this.ward];
    const els = hit.elements || [hit.element];
    const isCounter = els.includes(counter);
    this.wardHp -= amount * (isCounter ? 1.8 : 0.4) * (hit.dot ? 0.5 : 1);
    if (this.wardHp <= 0) { this.breakWard(game); return amount; }
    return amount * 0.25;
  }

  breakWard(game) {
    const el = this.ward;
    this.ward = null;
    this.exposedT = 3.5;
    this.endPattern();
    this.state = 'exposed';
    this.stateT = 3.5;
    floatText(game, this, 'WARD SHATTERED!', '#ffffff', true);
    game.bus.emit(EV.SCREEN_FLASH, { color: colorsOf(el)[1], duration: 0.25, alpha: 0.45 });
    fx(game, 'emit', 'aoe', this.x, this.y - 12, { element: el, count: 40 });
    hitStop(game, 0.12);
    shake(game, 5, 0.3);
    sfx(game, 'boss_phase', 0.8, 1.4);
    game.bus.emit('combat:bossWardBroken', { boss: this, element: el });
  }

  // ---------------------------------------------------------------- phases

  onHurt(game, hit, amount) {
    if (this.hp <= 0 || this.dying) return;
    const ratio = this.hp / this.maxHp;
    if (this.phase <= THRESH.length && ratio < THRESH[this.phase - 1]) {
      this.hp = Math.ceil(this.maxHp * THRESH[this.phase - 1]);
      this.startTransition(game, this.phase + 1);
    }
  }

  startTransition(game, phase) {
    this.phase = phase;
    this.endPattern();
    this.ward = null;
    this.exposedT = 0;
    this.invulnerable = true;
    this.state = 'transition';
    this.stateT = 2.4;
    for (const e of game.entities.withTag('projectile')) if (e.team === 'enemy') e.destroy();
    // blast the player back
    game.entities.add(new Shockwave({ x: this.x, y: this.y, r0: 10, r1: 140, dur: 0.7, team: 'enemy', source: this, amount: 5, element: 'arcane', color: '#ff8ad0' }));
    game.bus.emit(EV.BOSS_PHASE, { boss: this, phase });
    game.bus.emit(EV.SCREEN_FLASH, { color: '#ff3a8a', duration: 0.4, alpha: 0.55 });
    game.bus.emit(EV.TOAST, { text: LINES[phase] || '', color: '#ff8ad0', duration: 3 });
    floatText(game, this, phase === 2 ? 'PHASE II' : 'PHASE III - UNBOUND', '#ff8ad0', true);
    shake(game, 6, 0.5);
    if (phase === 3) this.speed = this.def.speed * 1.3;
  }

  // ---------------------------------------------------------------- patterns

  choosePattern(game) {
    const w = { ...WEIGHTS[this.phase] };
    if (this.lastPat) delete w[this.lastPat];
    if ('summon' in w && this.minions.length >= 3) delete w.summon;
    const entries = Object.entries(w).map(([name, weight]) => ({ name, weight }));
    return game.rng.weighted(entries)?.name || 'ring';
  }

  startPattern(game, name, p) {
    const make = PATTERNS[name] || PATTERNS.ring;
    this.pat = make(game, this, p);
    this.pat.name = name;
    this.lastPat = name;
    this.state = 'pattern';
  }

  endPattern() {
    if (this.pat?.cleanup) this.pat.cleanup();
    this.pat = null;
    this.beam = null;
    this.alpha = 1;
    this.clearTele();
    if (this.state === 'pattern') this.state = 'idle';
    this.cd = GAP[this.phase] || 1;
  }

  boltId() { return this.ward ? BOLT[this.ward] : this.phase === 3 ? 'boss_bolt' : 'boss_bolt'; }

  shoot(game, a, opts = {}) {
    return enemyShoot(game, this, opts.spell || this.boltId(), Math.cos(a), Math.sin(a), 1, { x: this.x + Math.cos(a) * 8, y: this.y + Math.sin(a) * 6, ...opts });
  }

  updatePools(game, dt, p) {
    this.poolT -= dt;
    if (this.poolT > 0) return;
    this.poolT = 6;
    const a = game.rng.float(0, TAU), d = game.rng.float(20, 70);
    const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
    if (game.level.map.isSolidAt(x, y)) return;
    game.entities.add(new Telegraph({ shape: 'circle', x, y, r: 22, dur: 1.2, color: '#b02a8a' }));
    game.after?.(1.2, () => { if (!this.dead && !this.dying) game.entities.add(new Zone(game, 'corrupt', x, y, { team: 'enemy', source: this, radius: 22, life: 8, power: 4 })); });
  }

  // ---------------------------------------------------------------- death

  die(game, killer) {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.hp = 0;
    this.endPattern();
    this.state = 'dying';
    this.invulnerable = true;
    game.state.stats.kills++;
    for (const e of game.entities.list) {
      if (e === this || e.dead) continue;
      if (e.team === 'enemy' && (e.tags.has('projectile') || e.tags.has('aoe'))) e.destroy();
      else if (e.team === 'enemy' && e.tags.has('enemy')) { e.noDrops = true; e.die?.(game, killer); }
    }
    game.bus.emit(EV.ENTITY_KILLED, { target: this, killer, x: this.x, y: this.y });
    game.bus.emit(EV.BOSS_DEFEATED, { boss: this });
    game.bus.emit(EV.SCREEN_FLASH, { color: '#ffffff', duration: 0.6, alpha: 0.9 });
    shake(game, 8, 0.8);
  }

  updateDying(game, dt) {
    this.dyingT += dt;
    if (Math.floor(this.dyingT * 5) !== Math.floor((this.dyingT - dt) * 5)) {
      const el = ['fire', 'ice', 'lightning', 'arcane'][Math.floor(this.dyingT * 5) % 4];
      fx(game, 'emit', 'aoe', this.x + (Math.random() - 0.5) * 20, this.y - 10 - Math.random() * 16, { element: el, count: 20 });
      shake(game, 3, 0.15);
    }
    if (this.dyingT > 2.6) this.destroy();
  }

  // ---------------------------------------------------------------- render

  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    const art = game.art;
    const float = Math.round(Math.sin(this.age * 2) * 2) - 3;
    ctx.globalAlpha = this.alpha;
    art.drawShadow?.(ctx, x, y, 16);
    const anim = this.dying ? 'die' : this.state === 'transition' ? 'phase2' : this.anim;
    art.drawSprite(ctx, 'boss_archmage', x, y + (this.dying ? 0 : float), {
      anim, t: this.dying ? this.dyingT : this.age, flip: Math.cos(this.facing) < 0, alpha: this.dying ? 1 : this.alpha, phase: this.phase,
      flash: this.hurtFlash > 0 ? 0.8 : this.state === 'exposed' && Math.floor(this.age * 10) % 2 ? 0.4 : 0,
    });
    ctx.globalAlpha = 1;
  }

  renderGlow(ctx) {
    const x = Math.round(this.rx), y = Math.round(this.ry) - 14;
    if (this.dying) return;
    if (this.ward) {
      const [c1, c2] = colorsOf(this.ward);
      const k = Math.max(0, this.wardHp / this.wardMax);
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(this.age * 6);
      ctx.fillStyle = c1;
      fillDisc(ctx, x, y, 17);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = c2;
      // ward ring: the lit arc shrinks as it takes damage
      const n = 48;
      for (let i = 0; i < n * k; i++) {
        const a = -Math.PI / 2 + (i / n) * TAU + this.age * 0.8;
        ctx.fillRect(Math.round(x + Math.cos(a) * 18), Math.round(y + Math.sin(a) * 18), 1, 1);
      }
      ctx.globalAlpha = 1;
    } else if (this.state === 'exposed') {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const a = this.age * 6 + (i * TAU) / 3;
        ctx.fillRect(Math.round(x + Math.cos(a) * 9), Math.round(y - 14 + Math.sin(a) * 2), 2, 1);
      }
      ctx.globalAlpha = 1;
    } else if (this.phase === 3 || this.state === 'transition') {
      ctx.globalAlpha = 0.25 + 0.12 * Math.sin(this.age * 8);
      ctx.fillStyle = '#ff3a8a';
      fillDisc(ctx, x, y, 15);
      ctx.globalAlpha = 1;
    }
    if (this.state === 'pattern' && this.pat?.charging) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = this.ward ? colorsOf(this.ward)[1] : '#ffb8ff';
      fillDisc(ctx, x + (Math.cos(this.facing) < 0 ? -7 : 7), y - 10, 2 + Math.round(Math.sin(this.age * 20)));
      ctx.globalAlpha = 1;
    }
    const b = this.beam;
    if (b) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      ctx.fillStyle = '#ff3a8a';
      for (let d = 8; d < b.length; d += 1) {
        const w = 2 + ((d + Math.floor(this.age * 30)) % 5 === 0 ? 1 : 0);
        ctx.fillRect(Math.round(this.rx + c * d) - w, Math.round(this.ry - 8 + s * d) - w, w * 2, w * 2);
      }
      ctx.fillStyle = '#ffffff';
      for (let d = 8; d < b.length; d += 2) ctx.fillRect(Math.round(this.rx + c * d), Math.round(this.ry - 8 + s * d), 1, 1);
    }
  }
}

// ==================================================================== pattern library
// Each factory returns { update(game, dt, p) -> done, cleanup?, charging? }.

function timeline(steps) {
  // steps: [[time, fn], ...] run once each when t passes them; done after last step + tail
  let t = 0, i = 0;
  const tail = steps.tail ?? 0.2;
  return (dt) => {
    t += dt;
    while (i < steps.length && t >= steps[i][0]) steps[i++][1]();
    return i >= steps.length && t >= steps[steps.length - 1][0] + tail;
  };
}

const PATTERNS = {
  ring(game, b) {
    const n = b.phase === 1 ? 14 : b.phase === 2 ? 16 : 18;
    const waves = b.phase;
    const pat = { charging: true };
    b.telegraph(game, { shape: 'circle', r: 16, follow: b, dur: 0.75, color: '#ff3a8a' });
    const steps = [];
    for (let w = 0; w < waves; w++) {
      steps.push([0.75 + w * 0.45, () => {
        pat.charging = false;
        const gapAt = Math.floor(game.rng.float(0, n));
        const off = game.rng.float(0, TAU);
        for (let i = 0; i < n; i++) {
          // a 3-bolt hole each wave: find it and step through
          const k = (i - gapAt + n) % n;
          if (k < 3) continue;
          b.shoot(game, off + (i / n) * TAU);
        }
        sfx(game, 'cast_arcane', 0.7, 0.8);
      }]);
    }
    const run = timeline(steps);
    pat.update = (g, dt) => run(dt);
    return pat;
  },

  aimed(game, b, p) {
    const volleys = b.phase === 3 ? 4 : 3;
    const fan = b.phase === 1 ? 3 : 5;
    const pat = { charging: true };
    const steps = [];
    let tele = null;
    for (let v = 0; v < volleys; v++) {
      const t0 = v * 0.55;
      steps.push([t0, () => {
        const a = Math.atan2(p.y - b.y, p.x - b.x);
        tele = b.telegraph(game, { shape: 'line', length: 200, width: 14, angle: a, follow: b, dur: v === 0 ? 0.6 : 0.4, color: '#ff3a8a' });
      }]);
      steps.push([t0 + (v === 0 ? 0.6 : 0.4), () => {
        const a = tele ? tele.angle : Math.atan2(p.y - b.y, p.x - b.x);
        for (let i = 0; i < fan; i++) b.shoot(game, a + (i - (fan - 1) / 2) * 0.17, { speed: 120 });
        sfx(game, 'cast_arcane', 0.6, 1.1);
      }]);
    }
    const run = timeline(steps);
    pat.update = (g, dt) => {
      // first telegraph tracks the player until it is almost done
      if (tele && !tele.dead && tele.progress < 0.6) tele.angle = Math.atan2(p.y - b.y, p.x - b.x);
      return run(dt);
    };
    return pat;
  },

  teleport(game, b, p) {
    const pat = {};
    let dest = null;
    for (let i = 0; i < 12 && !dest; i++) {
      const a = game.rng.float(0, TAU), d = game.rng.float(90, 130);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      const map = game.level.map;
      if (x < 28 || y < 36 || x > map.widthPx - 28 || y > map.heightPx - 28) continue;
      if (!map.isSolidAt(x, y) && !map.isSolidAt(x, y - 12)) dest = { x, y };
    }
    dest ||= { x: b.x, y: b.y };
    const n = b.phase === 1 ? 8 : 12;
    const run = timeline([
      [0, () => { fx(game, 'emit', 'portal', b.x, b.y - 10, { count: 16 }); sfx(game, 'cast_arcane', 0.7, 1.5); }],
      [0.45, () => { b.telegraph(game, { shape: 'circle', x: dest.x, y: dest.y, r: 20, dur: 0.6, color: '#b05aff' }); }],
      [1.05, () => {
        b.x = b.prevX = dest.x; b.y = b.prevY = dest.y;
        b.alpha = 1;
        // anyone standing on the landing spot gets blasted
        const pl = game.player;
        if (pl && inShape(pl, 'circle', b.x, b.y, { r: 20 })) b.hitPlayer(game, pl, 12, { element: 'arcane', knockback: 220 });
        const off = game.rng.float(0, TAU);
        for (let i = 0; i < n; i++) b.shoot(game, off + (i / n) * TAU, { speed: 90 });
        fx(game, 'emit', 'portal', b.x, b.y - 10, { count: 16 });
      }],
    ]);
    pat.update = (g, dt) => {
      const done = run(dt);
      if (!done && b.alpha > 0 && dest && b.x !== dest.x) b.alpha = Math.max(0.15, b.alpha - dt * 2);
      return done;
    };
    pat.cleanup = () => { b.alpha = 1; };
    return pat;
  },

  hazard(game, b, p) {
    const n = b.phase === 1 ? 3 : b.phase === 2 ? 5 : 7;
    const el = b.ward || ['fire', 'ice', 'lightning'][Math.floor(game.rng.float(0, 3))];
    const spots = [{ x: p.x, y: p.y }];
    for (let i = 1; i < n * 3 && spots.length < n; i++) {
      const a = game.rng.float(0, TAU), d = game.rng.float(30, 100);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (game.level.map.isSolidAt(x, y) || spots.some((s) => Math.hypot(s.x - x, s.y - y) < 30)) continue;
      spots.push({ x, y });
    }
    const col = colorsOf(el)[0];
    for (const s of spots) b.telegraph(game, { shape: 'circle', x: s.x, y: s.y, r: 22, dur: 1.15, color: col });
    const zone = el === 'fire' ? 'fire' : el === 'ice' ? 'frost' : 'static';
    const run = timeline([[1.15, () => {
      for (const s of spots) {
        burst(game, s.x, s.y, 22, { team: 'enemy', source: b, amount: 14, element: el, knockback: 140, preset: 'aoe', reactionless: true });
        game.entities.add(new Zone(game, zone, s.x, s.y, { team: 'enemy', source: b, radius: 18, life: 2.5, power: zone === 'frost' ? 25 : 3 }));
      }
      shake(game, 4, 0.25);
    }]]);
    return { charging: true, update: (g, dt) => run(dt) };
  },

  summon(game, b) {
    const count = Math.min(2, 4 - b.minions.length);
    const spots = [];
    for (let i = 0; i < 16 && spots.length < count; i++) {
      const a = game.rng.float(0, TAU), d = game.rng.float(40, 80);
      const x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
      if (!game.level.map.isSolidAt(x, y)) spots.push({ x, y });
    }
    for (const s of spots) b.telegraph(game, { shape: 'circle', x: s.x, y: s.y, r: 14, dur: 1.2, color: '#b05aff' });
    const run = timeline([[1.2, () => {
      const pool = b.phase === 3 ? ['armor_knight', 'armor_lancer'] : ['armor_knight'];
      for (const s of spots) {
        const id = pool[Math.floor(game.rng.float(0, pool.length))];
        const m = game.combat?.spawnEnemy?.(game, id, s.x, s.y, { exact: true, noDrops: true, aggro: true, elite: false, hpMult: 1.2, dmgMult: 1.1 });
        if (m) { b.minions.push(m); fx(game, 'emit', 'portal', s.x, s.y - 8, { count: 20 }); }
      }
      sfx(game, 'boss_phase', 0.5, 1.6);
    }]]);
    return { charging: true, update: (g, dt) => run(dt) };
  },

  spiral(game, b) {
    const arms = b.phase === 3 ? 4 : 3;
    let t = 0, fireT = 0;
    const spin = game.rng.sign() * 2.0;
    const off = game.rng.float(0, TAU);
    b.telegraph(game, { shape: 'circle', r: 22, follow: b, dur: 0.6, color: '#ff3a8a' });
    const pat = { charging: true };
    pat.update = (g, dt) => {
      t += dt;
      if (t < 0.6) return false;
      pat.charging = false;
      fireT -= dt;
      if (fireT <= 0) {
        fireT = 0.13;
        const base = off + (t - 0.6) * spin;
        for (let i = 0; i < arms; i++) b.shoot(game, base + (i / arms) * TAU, { speed: 75 });
      }
      return t >= 3.0;
    };
    return pat;
  },

  seekers(game, b) {
    const run = timeline([[0.5, () => {
      for (let i = 0; i < 4; i++) b.shoot(game, -Math.PI / 2 + (i - 1.5) * 0.7, { spell: 'boss_seeker', seekDelay: 0.4 });
      sfx(game, 'cast_arcane', 0.6, 0.7);
    }]]);
    b.telegraph(game, { shape: 'circle', r: 12, follow: b, dur: 0.5, color: '#b05aff' });
    return { charging: true, update: (g, dt) => run(dt) };
  },

  beam(game, b, p) {
    const pat = { charging: true };
    let t = 0, hitCd = 0;
    const a0 = Math.atan2(p.y - b.y, p.x - b.x);
    const dir = game.rng.sign();
    const tele = b.telegraph(game, { shape: 'line', length: 260, width: 10, angle: a0 - dir * 0.35, follow: b, dur: 1.0, color: '#ff3a8a' });
    pat.update = (g, dt) => {
      t += dt;
      if (t < 1.0) return false;
      pat.charging = false;
      tele.destroy();
      const angle = a0 - dir * 0.35 + dir * (t - 1.0) * 1.05;
      const ray = g.level.map ? raycastLen(g, b, angle, 260) : 260;
      b.beam = { angle, length: ray };
      fx(g, 'addLight', b.x + Math.cos(angle) * ray * 0.5, b.y + Math.sin(angle) * ray * 0.5, 80, '#ff3a8a', 0.8);
      hitCd -= dt;
      const pl = g.player;
      if (pl && hitCd <= 0 && inShape(pl, 'line', b.x, b.y, { angle, length: ray, width: 8 })) {
        hitCd = 0.3;
        b.hitPlayer(g, pl, 14, { element: 'arcane', knockback: 120, statuses: [{ type: 'burn', duration: 2, power: 1.5 }] });
      }
      if (t >= 3.0) { b.beam = null; return true; }
      return false;
    };
    pat.cleanup = () => { b.beam = null; };
    return pat;
  },

  meteor(game, b, p) {
    const steps = [];
    for (let i = 0; i < 6; i++) {
      steps.push([0.3 + i * 0.35, () => {
        const pl = game.player || p;
        game.entities.add(new Meteor(game, pl.x + game.rng.float(-6, 6), pl.y + game.rng.float(-6, 6), { team: 'enemy', source: b, radius: 22, amount: 13, delay: 0.95, element: 'fire', stun: 0, lava: false }));
      }]);
    }
    steps.tail = 1.0;
    const run = timeline(steps);
    return { charging: true, update: (g, dt) => run(dt) };
  },
};

function raycastLen(game, b, angle, max) {
  const map = game.level.map;
  const step = 8;
  for (let d = step; d <= max; d += step) {
    if (map.isSolidAt(b.x + Math.cos(angle) * d, b.y + Math.sin(angle) * d, 'shot')) return d;
  }
  return max;
}

export { isTarget, damage };
