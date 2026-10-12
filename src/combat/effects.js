// Combat world effects (team: combat): projectiles, bursts, ground zones, glyph traps, meteors,
// chain arcs, enemy telegraphs, shockwaves, floating combat text.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { raycastTiles } from '../core/physics.js';
import { damage, applyStatus } from './rules.js';
import { fx, sfx, shake, colorsOf, isTarget, drawText, fillDisc, strokeDisc, distToSegment } from './util.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ burst (instant AoE)

/**
 * Damage every target of `opts.team`'s enemies within r of (x, y).
 * opts: {team, source, amount, element, elements?, statuses?, knockback?, exclude?, reactionless?,
 *        ring? (colour), preset? ('aoe' => full AOE_TRIGGERED event, 'impact' => small), spellId?, poise?, shieldBreak?}
 * Returns the list of entities hit.
 */
export function burst(game, x, y, r, opts) {
  const hits = [];
  const team = opts.team;
  for (const e of game.entities.inRadius(x, y, r)) {
    if (e === opts.exclude || !isTarget(e, team)) continue;
    damage(game, e, {
      amount: opts.amount, element: opts.element, elements: opts.elements, source: opts.source,
      statuses: opts.statuses, knockback: opts.knockback ?? 120, from: { x, y }, reactionless: opts.reactionless,
      poise: opts.poise, shieldBreak: opts.shieldBreak,
    });
    hits.push(e);
  }
  if (opts.preset === 'aoe') {
    game.bus.emit(EV.AOE_TRIGGERED, { x, y, radius: r, element: opts.element, spellId: opts.spellId || null });
  } else {
    fx(game, 'emit', 'impact', x, y, { element: opts.element, count: Math.min(24, 6 + Math.round(r / 2)) });
    if (opts.ring) fx(game, 'ring', x, y, r, opts.ring, 0.3);
  }
  fx(game, 'addLight', x, y, r * 2, colorsOf(opts.element)[0], 1);
  return hits;
}

// ------------------------------------------------------------------ chain arcs

/**
 * Lightning-style chain from (x, y): hop to up to `jumps` targets within `range`, each hop
 * dealing `amount` (x falloff per hop). `exclude` = Set of ids already hit.
 */
export function chainFrom(game, x, y, opts) {
  const { team, jumps, range = 64, falloff = 0.8 } = opts;
  const seen = opts.exclude || new Set();
  let cx = x, cy = y, amount = opts.amount;
  const pts = [{ x: cx, y: cy - 6 }];
  const hit = [];
  for (let j = 0; j < jumps; j++) {
    const t = game.entities.nearest(cx, cy, (e) => isTarget(e, team) && !seen.has(e.id), range);
    if (!t) break;
    seen.add(t.id);
    pts.push({ x: t.x, y: t.y - 7 });
    damage(game, t, {
      amount, element: opts.element, elements: opts.elements, source: opts.source, statuses: opts.statuses,
      knockback: opts.knockback ?? 40, from: { x: cx, y: cy }, poise: opts.poise,
    });
    hit.push(t);
    cx = t.x; cy = t.y;
    amount *= falloff;
  }
  if (pts.length > 1) game.entities.add(new ArcVisual(pts, opts.colors || colorsOf(opts.element)));
  return hit;
}

// ------------------------------------------------------------------ impact effects (essence behaviours)

/**
 * Essence impact at (x, y). o = {team, source, spell, power, scale}.
 * Each essence does something mechanically different (see spellbook.js ESSENCES.impact).
 */
export function doImpact(game, kind, x, y, o) {
  const s = o.scale ?? 1;
  if (!kind || s <= 0) return;
  const sp = o.spell, power = o.power || 1, team = o.team, source = o.source;
  const dmg = (sp?.damage || 10) * power;
  switch (kind) {
    case 'embers':
      if (s >= 1) game.entities.add(new Zone(game, 'fire', x, y, { team, source, radius: Math.round(15 * s), life: 2.5, power: Math.max(1, dmg * 0.12) }));
      break;
    case 'frost':
      if (s >= 1) game.entities.add(new Zone(game, 'frost', x, y, { team, source, radius: Math.round(18 * s), life: 3, power: 14 }));
      break;
    case 'cloud':
      game.entities.add(new Zone(game, 'cloud', x, y, { team, source, radius: Math.max(12, Math.round(26 * s)), life: 2 + 1.6 * s, power: Math.max(1, dmg * 0.08) }));
      break;
    case 'explode':
      burst(game, x, y, Math.max(12, 24 * s), {
        team, source, amount: dmg * 0.6, element: 'fire', elements: ['fire', 'lightning'], knockback: 170,
        statuses: [{ type: 'burn', duration: 2, power: 1.5 }], ring: '#ff8ae0', reactionless: true,
        preset: s >= 1 ? 'aoe' : 'impact', spellId: sp?.id,
      });
      shake(game, s >= 1 ? 3 : 1.5, 0.15);
      break;
    case 'pool':
      game.entities.add(new Zone(game, 'lava', x, y, { team, source, radius: Math.max(8, Math.round(17 * s)), life: 4, power: Math.max(1.5, dmg * 0.15) }));
      break;
    case 'split': {
      if (s < 0.5) break;
      const base = Math.random() * TAU;
      ['fire', 'ice', 'lightning'].forEach((el, i) => {
        const a = base + (i / 3) * TAU;
        const mini = SHARD_SPELLS[el];
        game.entities.add(new Projectile(source || { team, x, y }, mini, x, y, Math.cos(a), Math.sin(a), power * Math.max(0.6, s), { team, damage: Math.max(4, (sp?.damage || 10) * 0.45) }));
      });
      break;
    }
    case 'meteor':
      if (s < 0.5 && Math.random() > 0.35) break;
      game.entities.add(new Meteor(game, x, y, { team, source, radius: Math.round(30 * Math.max(0.7, s)), amount: dmg * 1.5, delay: 0.55, element: 'fire', lava: true }));
      break;
    case 'well':
      game.entities.add(new Zone(game, 'well', x, y, { team, source, radius: s >= 0.5 ? Math.round(56 * s) : 26, life: 1.4, power: dmg * (s >= 0.5 ? 1.3 : 0.5) }));
      break;
    case 'chainstorm':
      chainFrom(game, x, y, {
        team, source, jumps: s >= 1 ? 3 : 1, range: 72, amount: dmg * 0.5, element: 'ice', elements: ['ice', 'lightning'],
        statuses: [{ type: 'chill', duration: 3, power: 35 }, { type: 'shock', duration: 0.6, power: 1 }], colors: sp?.colors,
        exclude: o.exclude,
      });
      break;
    default: break;
  }
}

/** Mini spells used by Prismatic splits. */
const mkShard = (el, status) => ({
  id: `shard_${el}`, name: 'Prism Shard', hidden: true, element: el, elements: [el], colors: colorsOf(el),
  damage: 6, speed: 200, range: 80, radius: 2, pierce: 0, statuses: [status], status, knockback: 40, impact: null, form: 'bolt',
});
const SHARD_SPELLS = {
  fire: mkShard('fire', { type: 'burn', duration: 2, power: 1.5 }),
  ice: mkShard('ice', { type: 'chill', duration: 3, power: 35 }),
  lightning: mkShard('lightning', { type: 'shock', duration: 0.8, power: 1 }),
};

// ------------------------------------------------------------------ Projectile

export class Projectile extends Entity {
  /**
   * @param caster  entity (or {team,x,y}) that owns the hit
   * @param spell   SPELLS entry
   * opts: {team, damage, speed, range, radius, pierce, homing, seekDelay, impactScale, impact}
   */
  constructor(caster, spell, x, y, dirX, dirY, power = 1, opts = {}) {
    super(x, y);
    this.caster = caster;
    this.spell = spell;
    this.team = opts.team || caster.team;
    this.element = spell.element;
    this.elements = spell.elements || [spell.element];
    this.colors = spell.colors || colorsOf(spell.element);
    this.tags.add('projectile');
    this.radius = opts.radius ?? spell.radius ?? 3;
    this.speed = opts.speed ?? spell.speed ?? 150;
    this.vx = dirX * this.speed;
    this.vy = dirY * this.speed;
    this.range = opts.range ?? spell.range ?? 200;
    this.travelled = 0;
    this.pierce = opts.pierce ?? spell.pierce ?? 0;
    this.power = power;
    this.dmg = opts.damage ?? spell.damage ?? 8;
    this.homing = opts.homing ?? spell.homing ?? 0;
    this.seekDelay = opts.seekDelay ?? 0;
    this.impactScale = opts.impactScale ?? spell.impactScale ?? 0;
    this.impact = opts.impact !== undefined ? opts.impact : spell.impact || null;
    this.isOrb = spell.form === 'orb';
    this.jump = opts.jump ?? spell.jump ?? 0;
    this.hostile = this.team === 'enemy';
    this.hitIds = new Set();
    this.layer = 2;
    this.trail = [];
    /** Visual height above the ground (px); fx offsets the auto halo/trail by this. */
    this.drawHeight = 6;
    this.seekTarget = null;
    this.seekT = 0;
    this.auraT = 0.2;
    this.ended = false;
  }

  update(game, dt) {
    const map = game.level?.map;
    if (!map) return this.destroy();
    // homing
    if (this.homing > 0 && this.age >= this.seekDelay) {
      this.seekT -= dt;
      if (this.seekT <= 0 || !this.seekTarget || this.seekTarget.dead || !isTarget(this.seekTarget, this.team)) {
        this.seekT = 0.25;
        this.seekTarget = game.entities.nearest(this.x, this.y, (e) => isTarget(e, this.team) && !this.hitIds.has(e.id), this.hostile ? 260 : 170);
      }
      const t = this.seekTarget;
      if (t) {
        const want = Math.atan2(t.y - this.y, t.x - this.x);
        const cur = Math.atan2(this.vy, this.vx);
        let d = want - cur;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const step = this.homing * dt;
        const a = cur + Math.max(-step, Math.min(step, d));
        this.vx = Math.cos(a) * this.speed;
        this.vy = Math.sin(a) * this.speed;
      }
    }
    if (this.isOrb && this.spell.orbAura) this.aura(game, dt);

    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const ray = raycastTiles(map, this.x, this.y, nx, ny, 'shot');
    this.travelled += Math.hypot(ray.x - this.x, ray.y - this.y);
    this.trail.push(this.x, this.y);
    if (this.trail.length > 8) this.trail.splice(0, 2);
    this.x = ray.x;
    this.y = ray.y;
    if (ray.hit || this.travelled >= this.range) return this.end(game, null);

    for (const e of game.entities.inRadius(this.x, this.y, this.radius)) {
      if (this.hitIds.has(e.id) || !isTarget(e, this.team)) continue;
      if (e.tags.has('player') && ((e.dashInvuln || 0) > 0 || (e.invuln || 0) > 0)) {
        if ((e.dashInvuln || 0) > 0) { this.hitIds.add(e.id); e.onDodge?.(game, null); }
        continue;
      }
      this.hitTarget(game, e);
      if (this.dead) return;
    }
    const c = this.colors[0];
    fx(game, 'addLight', this.x, this.y - 6, this.isOrb ? 40 : 26, c, 0.9);
    // (particle trail + halo are automatic in fx for 'projectile'-tagged entities)
  }

  aura(game, dt) {
    this.auraT -= dt;
    if (this.auraT > 0) return;
    const kind = this.spell.orbAura;
    this.auraT = kind === 'zap' ? 0.35 : 0.25;
    if (kind === 'zap') {
      chainFrom(game, this.x, this.y, {
        team: this.team, source: this.caster, jumps: 1, range: 46, amount: Math.max(2, this.dmg * this.power * 0.35),
        element: this.element, elements: this.elements, statuses: [{ type: 'shock', duration: 0.5, power: 1 }], colors: this.colors, knockback: 10,
      });
    } else if (kind === 'embers' || kind === 'frost' || kind === 'mist') {
      if (this.travelled > 14) {
        const type = kind === 'embers' ? 'fire' : kind === 'frost' ? 'frost' : 'cloud';
        game.entities.add(new Zone(game, type, this.x, this.y, { team: this.team, source: this.caster, radius: type === 'cloud' ? 10 : 8, life: 1.6, power: type === 'frost' ? 10 : Math.max(1, this.dmg * this.power * 0.08) }));
        this.auraT = 0.12;
      }
    } else if (kind === 'pull') {
      for (const e of game.entities.inRadius(this.x, this.y, 40)) {
        if (!isTarget(e, this.team) || e.mass === Infinity || e.tags.has('player')) continue;
        const dx = this.x - e.x, dy = this.y - e.y, d = Math.hypot(dx, dy) || 1;
        e.kbx = (e.kbx || 0) + (dx / d) * 30;
        e.kby = (e.kby || 0) + (dy / d) * 30;
      }
      this.auraT = 0.1;
    }
  }

  hitTarget(game, e) {
    this.hitIds.add(e.id);
    const amount = this.dmg * this.power;
    damage(game, e, {
      amount, element: this.element, elements: this.elements, source: this.caster, statuses: this.spell.statuses || (this.spell.status ? [this.spell.status] : null),
      knockback: this.spell.knockback ?? 60, from: { x: this.x - this.vx * 0.05, y: this.y - this.vy * 0.05 },
      poise: this.spell.poise, shieldBreak: this.spell.shieldBreak, spell: this.spell,
    });
    game.bus.emit(EV.PROJECTILE_HIT, { projectile: this, target: e, x: this.x, y: this.y, element: this.element });
    if (this.jump > 0 && !this.hostile) {
      chainFrom(game, e.x, e.y, {
        team: this.team, source: this.caster, jumps: this.jump, range: 60, amount: amount * 0.6, falloff: 0.8,
        element: this.element, elements: this.elements, statuses: this.spell.statuses, colors: this.colors, exclude: this.hitIds,
      });
    }
    if (this.pierce-- <= 0) this.end(game, e);
  }

  /** End of flight: orb burst + essence impact. */
  end(game, target) {
    if (this.ended) return;
    this.ended = true;
    if (!target) game.bus.emit(EV.PROJECTILE_HIT, { projectile: this, target: null, x: this.x, y: this.y, element: this.element });
    if (this.isOrb) {
      burst(game, this.x, this.y, this.spell.aoeRadius || 28, {
        team: this.team, source: this.caster, amount: (this.spell.burstDamage || this.dmg) * this.power, element: this.element,
        elements: this.elements, statuses: this.spell.statuses, knockback: (this.spell.knockback || 80) * 1.6, exclude: target,
        preset: 'aoe', spellId: this.spell.id, poise: this.spell.poise, shieldBreak: this.spell.shieldBreak,
      });
      shake(game, 2, 0.15);
    }
    if (this.impact && this.impactScale > 0) {
      doImpact(game, this.impact, this.x, this.y, { team: this.team, source: this.caster, spell: this.spell, power: this.power, scale: this.impactScale, exclude: new Set(this.hitIds) });
    }
    this.destroy();
  }

  render(ctx) {
    // ground shadow so height reads in top-down view
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const r = Math.max(1, this.radius - 1);
    ctx.fillRect(Math.round(this.rx) - r, Math.round(this.ry), r * 2, 1);
  }

  renderGlow(ctx) {
    const [c1, c2] = this.colors;
    const x = Math.round(this.rx), y = Math.round(this.ry) - 6, r = this.radius;
    if (this.hostile) {
      // enemy shots: diamond with a hot rim so they read as dangerous
      ctx.fillStyle = c1;
      for (let i = -r - 1; i <= r + 1; i++) {
        const w = r + 1 - Math.abs(i);
        ctx.fillRect(x - w, y + i, w * 2 + 1, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      return;
    }
    // fx draws the per-element halo (drawSpellOrb-style) + trail automatically; we add the bright body
    ctx.fillStyle = c1;
    fillDisc(ctx, x, y, Math.max(1, r - 1));
    ctx.fillStyle = c2;
    fillDisc(ctx, x, y, Math.max(1, r - 2));
    if (this.isOrb) {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(this.age * 20);
      ctx.fillStyle = c1;
      fillDisc(ctx, x, y, r + 2);
      ctx.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------ delayed AoE (legacy kind 'aoe')

export class AreaEffect extends Entity {
  constructor(caster, spell, x, y, power = 1, opts = {}) {
    super(x, y);
    this.caster = caster;
    this.spell = spell;
    this.team = opts.team || caster.team;
    this.element = spell.element;
    this.tags.add('aoe');
    this.radius = opts.radius ?? spell.aoeRadius ?? 32;
    this.delay = opts.delay ?? spell.delay ?? 0;
    this.power = power;
    this.fired = false;
    this.layer = 0;
  }

  update(game) {
    if (this.fired) { if (this.age > this.delay + 0.3) this.destroy(); return; }
    if (this.age < this.delay) return;
    this.fired = true;
    burst(game, this.x, this.y, this.radius, {
      team: this.team, source: this.caster, amount: (this.spell.damage || 10) * this.power, element: this.element,
      elements: this.spell.elements, statuses: this.spell.statuses || (this.spell.status ? [this.spell.status] : null),
      knockback: this.spell.knockback ?? 120, preset: 'aoe', spellId: this.spell.id,
    });
    shake(game, 2, 0.2);
  }

  render(ctx) {
    if (this.fired) return;
    const c = colorsOf(this.element);
    const k = Math.min(1, this.age / Math.max(0.01, this.delay));
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = c[0];
    fillDisc(ctx, this.rx, this.ry, this.radius * k);
    ctx.globalAlpha = 0.8;
    strokeDisc(ctx, this.rx, this.ry, this.radius);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ ground zones

const ZONE_STYLE = {
  cloud: { colors: ['#d8d4e0', '#ffffff'], element: 'fire', tick: 0.5 },
  fire: { colors: ['#ff6a1f', '#ffd25a'], element: 'fire', tick: 0.5 },
  lava: { colors: ['#ff3a1a', '#ffb03a'], element: 'fire', tick: 0.5 },
  frost: { colors: ['#4fc8ff', '#e6fbff'], element: 'ice', tick: 0.5 },
  static: { colors: ['#ffe14a', '#ffffff'], element: 'lightning', tick: 0.5 },
  well: { colors: ['#6a2aff', '#ffb8ff'], element: 'arcane', tick: 0.25 },
  corrupt: { colors: ['#b02a8a', '#ff8ad0'], element: 'arcane', tick: 0.5 },
};

/**
 * Lingering ground effect. type: 'cloud' (steam: blinds + slows foes), 'fire', 'lava' (burn + slow),
 * 'frost' (chill build-up), 'static' (shock), 'well' (pull, then implode), 'corrupt' (boss hazard).
 * opts: {team, source, radius, life, power}
 */
export class Zone extends Entity {
  constructor(game, type, x, y, opts = {}) {
    super(x, y);
    this.type = type;
    this.style = ZONE_STYLE[type] || ZONE_STYLE.fire;
    this.team = opts.team || 'neutral';
    this.source = opts.source || null;
    this.radius = opts.radius || 16;
    this.life = opts.life || 3;
    this.power = opts.power || 1;
    this.tags.add('aoe');
    this.tags.add('zone');
    this.layer = type === 'cloud' ? 2 : 0;
    this.tickT = 0.15;
    this.seed = Math.random() * 100;
    this.element = this.style.element;
    // Cap overlapping zones so mobile stays fast.
    const zs = game.entities.withTag?.('zone') || [];
    if (zs.length > 40) zs[0].destroy();
  }

  update(game, dt) {
    if (this.age >= this.life) {
      if (this.type === 'well') {
        burst(game, this.x, this.y, this.radius * 0.55, {
          team: this.team, source: this.source, amount: this.power, element: 'arcane', knockback: 60,
          statuses: [{ type: 'vulnerable', duration: 4, power: 0.25 }], preset: 'aoe', ring: '#ffb8ff', reactionless: false,
        });
        shake(game, 3, 0.2);
      }
      return this.destroy();
    }
    const fade = Math.min(1, (this.life - this.age) / 0.4);
    if (this.type !== 'cloud') fx(game, 'addLight', this.x, this.y, this.radius * 1.8, this.style.colors[0], 0.6 * fade);
    if (this.type === 'well') {
      for (const e of game.entities.inRadius(this.x, this.y, this.radius)) {
        if (!isTarget(e, this.team) || e.mass === Infinity) continue;
        const dx = this.x - e.x, dy = this.y - e.y, d = Math.hypot(dx, dy) || 1;
        const pull = (e.tags.has('player') ? 40 : 110) * (1 - Math.min(1, d / this.radius) * 0.5);
        e.kbx = (dx / d) * pull;
        e.kby = (dy / d) * pull;
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * TAU;
        fx(game, 'emit', 'sparkle', this.x + Math.cos(a) * this.radius, this.y + Math.sin(a) * this.radius, { color: '#b05aff', color2: '#ffb8ff', count: 1, angle: a + Math.PI, spread: 0.2, speed: 60 });
      }
      return;
    }
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = this.style.tick;
    for (const e of game.entities.inRadius(this.x, this.y, this.radius)) {
      if (!isTarget(e, this.team)) continue;
      if (e.def?.flying && (this.type === 'lava' || this.type === 'fire' || this.type === 'frost')) continue;
      switch (this.type) {
        case 'cloud':
          applyStatus(game, e, { type: 'blind', duration: 0.7, power: 1 });
          if (this.power > 0) damage(game, e, { amount: this.power, element: 'fire', source: this.source, dot: true });
          break;
        case 'fire':
          damage(game, e, { amount: this.power, element: 'fire', source: this.source, dot: true, statuses: [{ type: 'burn', duration: 1.5, power: Math.max(1, this.power * 0.5) }] });
          break;
        case 'lava':
          damage(game, e, { amount: this.power, element: 'fire', source: this.source, dot: true, statuses: [{ type: 'burn', duration: 2, power: Math.max(1, this.power * 0.5) }] });
          applyStatus(game, e, { type: 'slow', duration: 0.6, power: 0.3 }); // molten drag
          break;
        case 'frost':
          applyStatus(game, e, { type: 'chill', duration: 2, power: this.power });
          break;
        case 'static':
          damage(game, e, { amount: this.power, element: 'lightning', source: this.source, dot: true, statuses: [{ type: 'shock', duration: 0.6, power: 1 }] });
          break;
        case 'corrupt':
          damage(game, e, { amount: this.power, element: 'arcane', source: this.source, dot: true });
          break;
        default: break;
      }
    }
  }

  render(ctx) {
    const fade = Math.min(1, (this.life - this.age) / 0.4, this.age / 0.15);
    const [c1, c2] = this.style.colors;
    const x = this.rx, y = this.ry, r = this.radius;
    const t = this.age + this.seed;
    if (this.type === 'cloud') {
      for (let i = 0; i < 6; i++) {
        const a = i * 1.7 + t * 0.6;
        const rr = r * (0.45 + 0.15 * Math.sin(t * 2 + i));
        ctx.globalAlpha = 0.28 * fade;
        ctx.fillStyle = i % 2 ? c1 : c2;
        fillDisc(ctx, x + Math.cos(a) * r * 0.45, y - 4 + Math.sin(a) * r * 0.35, rr);
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (this.type === 'well') {
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = '#0a0014';
      fillDisc(ctx, x, y, Math.max(3, r * 0.25 * (1 + 0.2 * Math.sin(t * 9))));
      ctx.globalAlpha = 0.6 * fade;
      ctx.fillStyle = c1;
      const k = 1 - ((this.age * 1.5) % 1);
      strokeDisc(ctx, x, y, r * k);
      strokeDisc(ctx, x, y, r * ((k + 0.5) % 1));
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = (this.type === 'frost' ? 0.3 : 0.35) * fade;
    ctx.fillStyle = c1;
    fillDisc(ctx, x, y, r);
    ctx.globalAlpha = 0.5 * fade;
    ctx.fillStyle = c2;
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4 + Math.floor(t * 6) * 0.7;
      const d = r * (0.2 + ((i * 37) % 10) / 14);
      ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 1, 1 + (i & 1));
    }
    ctx.globalAlpha = 1;
  }

  renderGlow(ctx) {
    if (this.type !== 'fire' && this.type !== 'lava' && this.type !== 'corrupt' && this.type !== 'static') return;
    const fade = Math.min(1, (this.life - this.age) / 0.4);
    ctx.globalAlpha = 0.15 * fade;
    ctx.fillStyle = this.style.colors[0];
    fillDisc(ctx, this.rx, this.ry, this.radius * 0.7);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ glyph trap

export class Rune extends Entity {
  constructor(game, caster, spell, x, y, power) {
    super(x, y);
    this.caster = caster;
    this.spell = spell;
    this.team = caster.team;
    this.power = power;
    this.radius = spell.trigger || 13;
    this.tags.add('aoe');
    this.layer = 0;
    this.armT = spell.delay ?? 0.5;
    this.life = spell.life || 14;
    this.colors = spell.colors || colorsOf(spell.element);
    caster.runes ||= [];
    caster.runes = caster.runes.filter((r) => !r.dead);
    while (caster.runes.length >= (spell.max || 3)) caster.runes.shift().destroy();
    caster.runes.push(this);
  }

  update(game) {
    if (this.age > this.life) return this.destroy();
    if (this.age < this.armT) return;
    fx(game, 'addLight', this.x, this.y, 22, this.colors[0], 0.5);
    const t = game.entities.nearest(this.x, this.y, (e) => isTarget(e, this.team), this.radius + 6);
    if (t) this.trigger(game);
  }

  trigger(game) {
    const sp = this.spell;
    burst(game, this.x, this.y, sp.aoeRadius || 34, {
      team: this.team, source: this.caster, amount: sp.damage * this.power, element: sp.element, elements: sp.elements,
      statuses: sp.statuses, knockback: (sp.knockback || 80) * 1.5, preset: 'aoe', spellId: sp.id, poise: sp.poise, shieldBreak: sp.shieldBreak,
    });
    if (sp.impact) doImpact(game, sp.impact, this.x, this.y, { team: this.team, source: this.caster, spell: sp, power: this.power, scale: sp.impactScale || 1 });
    shake(game, 3, 0.2);
    sfx(game, sp.sfx || 'cast_arcane', 0.8, 0.7);
    this.destroy();
  }

  renderGlow(ctx) {
    const [c1, c2] = this.colors;
    const armed = this.age >= this.armT;
    const x = Math.round(this.rx), y = Math.round(this.ry);
    const blink = this.life - this.age < 2 && Math.floor(this.age * 8) % 2 === 0;
    ctx.globalAlpha = armed ? (blink ? 0.4 : 0.85) : 0.35 + 0.4 * (this.age / this.armT);
    ctx.fillStyle = c1;
    strokeDisc(ctx, x, y, this.radius - 2);
    const a0 = this.age * (armed ? 2 : 6);
    for (let i = 0; i < 5; i++) {
      const a = a0 + (i / 5) * TAU, b = a0 + (((i + 2) % 5) / 5) * TAU;
      const r = this.radius - 4;
      // pentagram strokes (dotted)
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        ctx.fillRect(Math.round(x + Math.cos(a) * r * (1 - t) + Math.cos(b) * r * t), Math.round(y + Math.sin(a) * r * (1 - t) + Math.sin(b) * r * t), 1, 1);
      }
    }
    ctx.fillStyle = c2;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ meteor

export class Meteor extends Entity {
  /** opts: {team, source, radius, amount, delay, element, lava?, stun?} */
  constructor(game, x, y, opts) {
    super(x, y);
    Object.assign(this, { team: opts.team, source: opts.source, radius: opts.radius || 30, amount: opts.amount || 20, delay: opts.delay ?? 0.7, element: opts.element || 'fire', lava: !!opts.lava });
    this.stun = opts.stun ?? 0.8;
    this.tags.add('aoe');
    this.layer = 0;
    this.hostile = this.team === 'enemy';
    this.colors = opts.colors || (this.hostile ? ['#ff3a8a', '#ffb8ff'] : ['#ffb03a', '#fff6a0']);
  }

  update(game) {
    if (this.age < this.delay) return;
    burst(game, this.x, this.y, this.radius, {
      team: this.team, source: this.source, amount: this.amount, element: this.element, knockback: 200,
      statuses: [{ type: 'burn', duration: 2, power: 1.5 }, ...(this.stun && !this.hostile ? [{ type: 'stun', duration: this.stun, power: 1 }] : [])],
      preset: 'aoe', spellId: 'meteor', poise: 3, shieldBreak: true,
    });
    if (this.lava) game.entities.add(new Zone(game, 'lava', this.x, this.y, { team: this.team, source: this.source, radius: Math.round(this.radius * 0.5), life: 3, power: Math.max(2, this.amount * 0.08) }));
    fx(game, 'emit', 'dust', this.x, this.y, { count: 10 });
    shake(game, 4, 0.25);
    sfx(game, 'cast_earth', 1, 0.6);
    this.destroy();
  }

  renderMarker(ctx) {
    const k = Math.min(1, this.age / this.delay);
    const x = Math.round(this.rx), y = Math.round(this.ry);
    ctx.globalAlpha = 0.2 + 0.25 * k;
    ctx.fillStyle = this.colors[0];
    fillDisc(ctx, x, y, this.radius * k);
    ctx.globalAlpha = 0.9;
    strokeDisc(ctx, x, y, this.radius);
    ctx.globalAlpha = 1;
  }

  renderGlow(ctx) {
    this.renderMarker(ctx);
    const k = Math.min(1, this.age / this.delay);
    const h = Math.round((1 - k) * 120);
    const x = Math.round(this.rx) + Math.round((1 - k) * 30), y = Math.round(this.ry) - h - 4;
    ctx.fillStyle = this.colors[0];
    fillDisc(ctx, x, y, 4);
    ctx.fillStyle = this.colors[1];
    fillDisc(ctx, x - 1, y - 1, 2);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = this.colors[0];
    for (let i = 1; i < 5; i++) ctx.fillRect(x + i * 2, y - i * 7, 2, 4);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ chain arc visual

export class ArcVisual extends Entity {
  constructor(points, colors, life = 0.18) {
    super(points[0].x, points[0].y);
    this.points = points;
    this.colors = colors;
    this.life = life;
    this.layer = 2;
    this.tags.add('fxonly');
    this.jit = points.map(() => [Math.random() * 6 - 3, Math.random() * 6 - 3]);
  }
  update() { if (this.age >= this.life) this.destroy(); }
  renderGlow(ctx) {
    const pts = this.points;
    ctx.globalAlpha = 1 - this.age / this.life;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(3, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      let px = a.x, py = a.y;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const j = k === n ? 0 : (Math.random() - 0.5) * 6;
        const qx = a.x + (b.x - a.x) * t + j, qy = a.y + (b.y - a.y) * t + j;
        line(ctx, px, py, qx, qy, this.colors[0]);
        px = qx; py = qy;
      }
      ctx.fillStyle = this.colors[1];
      ctx.fillRect(Math.round(b.x) - 1, Math.round(b.y) - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
  }
}

function line(ctx, x0, y0, x1, y1, color) {
  ctx.fillStyle = color;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}

// ------------------------------------------------------------------ telegraphs

/**
 * Ground warning for an enemy attack. spec: {shape:'circle'|'ring'|'cone'|'line', x, y, r, r0?,
 * angle, halfAngle, length, width, dur, color?, follow? (entity), danger? (default true)}
 * The inner fill grows to the edge exactly when the attack lands.
 */
export class Telegraph extends Entity {
  constructor(spec) {
    super(spec.x, spec.y);
    Object.assign(this, { shape: 'circle', r: 20, angle: 0, halfAngle: 0.8, length: 60, width: 10, dur: 0.6, color: '#ff3a3a' }, spec);
    this.tags.add('fxonly');
    this.layer = 0;
    this.sortOffset = -100;
  }
  update() {
    if (this.follow) {
      if (this.follow.dead) return this.destroy();
      this.x = this.follow.x; this.y = this.follow.y;
    }
    if (this.age >= this.dur) this.destroy();
  }
  get progress() { return Math.min(1, this.age / this.dur); }
  renderGlow(ctx) {
    const k = this.progress;
    const x = Math.round(this.follow ? this.follow.rx : this.rx), y = Math.round(this.follow ? this.follow.ry : this.ry);
    const flash = k > 0.8 && Math.floor(this.age * 20) % 2 === 0;
    const col = flash ? '#ffffff' : this.color;
    ctx.fillStyle = this.color;
    if (this.shape === 'ring') {
      // shockwave warning: outline + a pulse travelling outward
      ctx.globalAlpha = 0.5;
      strokeDisc(ctx, x, y, this.r);
      ctx.globalAlpha = 0.35;
      strokeDisc(ctx, x, y, (this.r0 || 0) + (this.r - (this.r0 || 0)) * ((this.age * 2) % 1));
    } else if (this.shape === 'circle') {
      ctx.globalAlpha = 0.16;
      fillDisc(ctx, x, y, this.r);
      ctx.globalAlpha = 0.32;
      fillDisc(ctx, x, y, this.r * k);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      strokeDisc(ctx, x, y, this.r);
    } else if (this.shape === 'cone') {
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const a = this.angle - this.halfAngle + (2 * this.halfAngle * i) / steps;
        for (let d = 4; d <= this.r; d += 2) {
          const inner = d <= this.r * k;
          ctx.globalAlpha = inner ? 0.38 : 0.14;
          ctx.fillStyle = this.color;
          ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d), 1, 1);
        }
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(x + Math.cos(a) * this.r), Math.round(y + Math.sin(a) * this.r), 1, 1);
      }
    } else if (this.shape === 'line') {
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const hw = this.width / 2;
      for (let d = 0; d <= this.length; d += 1) {
        const inner = d <= this.length * k;
        ctx.globalAlpha = inner ? 0.35 : 0.13;
        ctx.fillStyle = this.color;
        for (let w = -hw; w <= hw; w += 2) ctx.fillRect(Math.round(x + c * d - s * w), Math.round(y + s * d + c * w), 1, 1);
        if (d % 2 === 0) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = col;
          ctx.fillRect(Math.round(x + c * d - s * hw), Math.round(y + s * d + c * hw), 1, 1);
          ctx.fillRect(Math.round(x + c * d + s * hw), Math.round(y + s * d - c * hw), 1, 1);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Is the entity inside a telegraph-like shape? (used to resolve the attack when it lands) */
export function inShape(e, shape, x, y, spec) {
  const pr = e.radius || 4;
  const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy);
  if (shape === 'circle') return d <= spec.r + pr;
  if (shape === 'ring') return d <= spec.r + pr && d >= (spec.r0 || 0) - pr;
  if (shape === 'cone') {
    if (d > spec.r + pr) return false;
    if (d < pr + 4) return true;
    let a = Math.atan2(dy, dx) - spec.angle;
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return Math.abs(a) <= spec.halfAngle + Math.atan2(pr, d);
  }
  if (shape === 'line') {
    const ex = x + Math.cos(spec.angle) * spec.length, ey = y + Math.sin(spec.angle) * spec.length;
    return distToSegment(e.x, e.y, x, y, ex, ey) <= spec.width / 2 + pr;
  }
  return false;
}

// ------------------------------------------------------------------ shockwave

/** Expanding ring that hits each target once as its edge passes. Dash through it! */
export class Shockwave extends Entity {
  constructor(opts) {
    super(opts.x, opts.y);
    Object.assign(this, { r0: 10, r1: 70, dur: 0.5, thickness: 6, amount: 10, element: 'earth', color: '#e8d08a' }, opts);
    this.tags.add('fxonly');
    this.layer = 0;
    this.hit = new Set();
    this.r = this.r0;
  }
  update(game) {
    const k = Math.min(1, this.age / this.dur);
    this.r = this.r0 + (this.r1 - this.r0) * k;
    for (const e of game.entities.inRadius(this.x, this.y, this.r + this.thickness)) {
      if (this.hit.has(e.id) || !isTarget(e, this.team)) continue;
      const d = Math.hypot(e.x - this.x, e.y - this.y);
      if (d < this.r - this.thickness - (e.radius || 4)) continue;
      if (e.def?.flying) continue;
      this.hit.add(e.id);
      damage(game, e, { amount: this.amount, element: this.element, source: this.source, knockback: 160, from: { x: this.x, y: this.y }, statuses: this.statuses });
    }
    if (k >= 1) this.destroy();
  }
  renderGlow(ctx) {
    const k = Math.min(1, this.age / this.dur);
    ctx.globalAlpha = 0.9 * (1 - k * 0.6);
    ctx.fillStyle = this.color;
    strokeDisc(ctx, this.rx, this.ry, this.r);
    ctx.globalAlpha = 0.5 * (1 - k * 0.6);
    strokeDisc(ctx, this.rx, this.ry, this.r - 2);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ floating combat text

export class FloatText extends Entity {
  constructor(x, y, text, color, big = false) {
    super(x + (Math.random() - 0.5) * 6, y);
    this.text = text;
    this.color = color;
    this.big = big;
    this.life = big ? 1.0 : 0.75;
    this.layer = 2;
    this.tags.add('fxonly');
  }
  update(game, dt) {
    this.y -= (this.big ? 16 : 22) * dt;
    if (this.age >= this.life) this.destroy();
  }
  renderGlow(ctx, game) {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over';
    const alpha = Math.min(1, (this.life - this.age) / 0.3);
    drawText(game, ctx, this.text, Math.round(this.rx), Math.round(this.ry), { color: this.color, align: 'center', shadow: true, alpha });
    ctx.globalCompositeOperation = prev;
  }
}

// ------------------------------------------------------------------ death dissolve

/** Plays the sprite's 'die' animation (art dissolve) where an enemy fell, then fades. */
export class Corpse extends Entity {
  constructor(key, x, y, flip, dir) {
    super(x, y);
    this.key = key; this.flip = flip; this.dir = dir;
    this.life = 0.8;
    this.tags.add('fxonly');
    this.sortOffset = -1;
  }
  update() { if (this.age >= this.life) this.destroy(); }
  render(ctx, game) {
    game.art.drawSprite(ctx, this.key, this.rx, this.ry, { anim: 'die', t: this.age, flip: this.flip, dir: this.dir, alpha: Math.min(1, (this.life - this.age) / 0.3) });
  }
}
