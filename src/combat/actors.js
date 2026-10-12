// Enemies, boss, projectiles, AoE (team: combat). Placeholder behaviour.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { ELEMENT_COLORS } from '../core/config.js';
import { moveCircle, raycastTiles } from '../core/physics.js';
import { normalize } from '../core/math.js';
import { ENEMIES, SPELLS } from './data.js';
import { damage, tickStatuses } from './rules.js';

const isHostile = (a, b) => a.team !== b.team && a.team !== 'neutral' && b.team !== 'neutral';

// ------------------------------------------------------------------ Projectile

export class Projectile extends Entity {
  constructor(caster, spell, x, y, dirX, dirY, power = 1) {
    super(x, y);
    this.caster = caster;
    this.spell = spell;
    this.element = spell.element;
    this.team = caster.team;
    this.tags.add('projectile');
    this.radius = spell.radius || 3;
    this.vx = dirX * spell.speed;
    this.vy = dirY * spell.speed;
    this.range = spell.range;
    this.travelled = 0;
    this.pierce = spell.pierce || 0;
    this.power = power;
    this.hitIds = new Set();
    this.layer = 2;
  }

  update(game, dt) {
    const map = game.level.map;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const ray = raycastTiles(map, this.x, this.y, nx, ny, 'shot');
    this.travelled += Math.hypot(nx - this.x, ny - this.y);
    this.x = ray.x;
    this.y = ray.y;
    if (ray.hit || this.travelled >= this.range) {
      game.bus.emit(EV.PROJECTILE_HIT, { projectile: this, target: null, x: this.x, y: this.y, element: this.element });
      return this.destroy();
    }
    for (const e of game.entities.inRadius(this.x, this.y, this.radius)) {
      if (!isHostile(this, e) || this.hitIds.has(e.id) || e.tags.has('projectile') || !(e.tags.has('player') || e.hp > 0)) continue;
      this.hitIds.add(e.id);
      damage(game, e, { amount: this.spell.damage * this.power, element: this.element, source: this.caster, status: this.spell.status, knockback: 60 });
      game.bus.emit(EV.PROJECTILE_HIT, { projectile: this, target: e, x: this.x, y: this.y, element: this.element });
      if (this.pierce-- <= 0) return this.destroy();
    }
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    game.fx.addLight(this.x, this.y, 28, c[0], 0.9);
    if (Math.random() < 0.6) game.fx.emit('trail', this.x, this.y, { element: this.element, count: 1 });
  }

  renderGlow(ctx) {
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    const x = Math.round(this.rx), y = Math.round(this.ry), r = this.radius;
    ctx.fillStyle = c[0];
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = c[1];
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
}

// ------------------------------------------------------------------ AoE

export class AreaEffect extends Entity {
  constructor(caster, spell, x, y, power = 1) {
    super(x, y);
    this.caster = caster;
    this.spell = spell;
    this.team = caster.team;
    this.element = spell.element;
    this.tags.add('aoe');
    this.radius = spell.aoeRadius || 32;
    this.delay = spell.delay || 0;
    this.power = power;
    this.fired = false;
    this.layer = 0;
  }

  update(game, dt) {
    if (this.fired) {
      if (this.age > this.delay + 0.3) this.destroy();
      return;
    }
    if (this.age < this.delay) return;
    this.fired = true;
    for (const e of game.entities.inRadius(this.x, this.y, this.radius)) {
      if (!isHostile(this, e) || e.tags.has('projectile') || !(e.tags.has('player') || e.hp > 0)) continue;
      damage(game, e, { amount: this.spell.damage * this.power, element: this.element, source: this, status: this.spell.status, knockback: 120 });
    }
    game.bus.emit(EV.AOE_TRIGGERED, { x: this.x, y: this.y, radius: this.radius, element: this.element, spellId: this.spell.id });
    game.bus.emit(EV.CAMERA_SHAKE, { intensity: 2, duration: 0.2 });
  }

  render(ctx) {
    if (this.fired) return;
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = c[0];
    ctx.beginPath();
    ctx.arc(Math.round(this.rx), Math.round(this.ry), this.radius * Math.min(1, this.age / Math.max(0.01, this.delay)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ Enemy

export class Enemy extends Entity {
  constructor(def, x, y, opts = {}) {
    super(x, y);
    this.def = def;
    this.defId = def.id;
    this.element = def.element;
    this.team = 'enemy';
    this.tags.add('enemy');
    this.radius = def.radius;
    this.mass = def.mass;
    this.pushable = true;
    this.maxHp = this.hp = Math.round(def.hp * (opts.hpMult || 1));
    this.attackTimer = 0;
    this.kbx = this.kby = 0;
    this.hurtFlash = 0;
    this.facing = 1;
    this.anim = 'idle';
    this.aggro = false;
    this.statuses = [];
  }

  update(game, dt) {
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    const { slow, stunned } = tickStatuses(game, this, dt);
    if (this.dead) return;
    const map = game.level.map;
    let mx = this.kbx * dt, my = this.kby * dt;
    this.kbx *= 0.85; this.kby *= 0.85;
    const p = game.player;
    const pAlive = p && game.state.player.hp > 0;
    this.anim = 'idle';
    if (pAlive && !stunned) {
      const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy);
      if (d < this.def.aggroRange) this.aggro = true;
      if (this.aggro) {
        const reach = this.def.attack.range + this.radius + p.radius;
        if (d > reach) {
          const n = normalize(dx, dy);
          mx += n.x * this.def.speed * slow * dt;
          my += n.y * this.def.speed * slow * dt;
          this.anim = 'walk';
        } else if (this.attackTimer <= 0) {
          this.attackTimer = this.def.attack.cooldown;
          this.anim = 'attack';
          damage(game, p, { amount: this.def.damage, element: this.element, source: this, knockback: 80 });
        }
        if (Math.abs(dx) > 1) this.facing = dx < 0 ? -1 : 1;
      }
    }
    moveCircle(map, this, mx, my);
    this.updateBehaviour?.(game, dt);
  }

  die(game, killer) {
    if (this.dead) return;
    this.destroy();
    game.state.stats.kills++;
    game.bus.emit(EV.ENTITY_KILLED, { target: this, killer, x: this.x, y: this.y });
    const rng = game.rng;
    for (const d of this.def.drops || []) {
      if (!rng.chance(d.chance)) continue;
      const amount = rng.int(d.min ?? 1, d.max ?? 1);
      game.world.spawnPickup(game, d.kind, this.x + rng.float(-6, 6), this.y + rng.float(-6, 6), { element: d.element, itemId: d.itemId, amount });
    }
  }

  render(ctx, game) {
    game.art.drawShadow(ctx, this.rx, this.ry, this.radius * 2);
    game.art.drawSprite(ctx, this.def.sprite, this.rx, this.ry, { anim: this.anim, t: this.age, flip: this.facing < 0, flash: this.hurtFlash > 0 ? 1 : 0 });
  }
}

// ------------------------------------------------------------------ Boss

export class Boss extends Enemy {
  constructor(def, x, y) {
    super(def, x, y);
    this.tags.add('boss');
    this.phase = 1;
    this.volleyTimer = 2;
    this.pushable = true;
  }

  updateBehaviour(game, dt) {
    if (this.phase === 1 && this.hp < this.maxHp / 2) {
      this.phase = 2;
      game.bus.emit(EV.BOSS_PHASE, { boss: this, phase: 2 });
      game.bus.emit(EV.SCREEN_FLASH, { color: '#ff3a8a', duration: 0.3, alpha: 0.5 });
    }
    if (!this.aggro) return;
    this.volleyTimer -= dt;
    if (this.volleyTimer <= 0) {
      this.volleyTimer = this.phase === 1 ? 2.4 : 1.4;
      const n = this.phase === 1 ? 10 : 16;
      const off = Math.random() * Math.PI;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        game.entities.add(new Projectile(this, SPELLS.boss_bolt, this.x, this.y - 8, Math.cos(a), Math.sin(a)));
      }
    }
  }

  die(game, killer) {
    if (this.dead) return;
    super.die(game, killer);
    game.bus.emit(EV.BOSS_DEFEATED, { boss: this });
    game.bus.emit(EV.SCREEN_FLASH, { color: '#ffffff', duration: 0.6, alpha: 0.9 });
  }

  renderGlow(ctx) {
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(this.age * 4);
    ctx.fillStyle = '#ff3a8a';
    ctx.fillRect(Math.round(this.rx) - 10, Math.round(this.ry) - 28, 20, 28);
    ctx.globalAlpha = 1;
  }
}

export function createEnemy(defId, x, y, opts) {
  const def = ENEMIES[defId];
  if (!def) {
    console.warn(`[combat] unknown enemy "${defId}", using armor_knight`);
    return new Enemy(ENEMIES.armor_knight, x, y, opts);
  }
  return def.boss ? new Boss(def, x, y) : new Enemy(def, x, y, opts);
}
