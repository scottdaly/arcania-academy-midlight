// Spell casting (team: combat). One function per FORM; essences add behaviour at impact points.
import { EV } from '../core/events.js';
import { hasLineOfSight, raycastTiles } from '../core/physics.js';
import { SPELLS } from './data.js';
import { spellPowerFor } from './rules.js';
import { damage } from './rules.js';
import { Projectile, AreaEffect, Rune, ArcVisual, Zone, burst, chainFrom, doImpact } from './effects.js';
import { isTarget, angleDiff, shake, fx } from './util.js';

const TAU = Math.PI * 2;

/**
 * Cast `spellId` from `caster` in unit direction (dirX, dirY).
 * Player casters pay mana and respect per-spell cooldowns (caster.cooldowns Map); their damage is
 * scaled by spellPower and element affinity from equipment.
 * opts: { power?, targetX?, targetY? (glyph placement), free? (skip mana/cooldown) }
 * Returns true if the spell fired.
 */
export function castSpell(game, caster, spellId, dirX, dirY, opts = {}) {
  const spell = SPELLS[spellId];
  if (!spell || !caster) {
    if (!spell) console.warn(`[combat] unknown spell "${spellId}"`);
    game.bus.emit(EV.SPELL_FAILED, { caster, spellId, reason: 'locked' });
    return false;
  }
  const isPlayer = !!caster.tags?.has('player');
  let power = opts.power ?? 1;
  if (isPlayer && !opts.free) {
    const st = game.state.player;
    caster.cooldowns ||= new Map();
    if ((caster.cooldowns.get(spellId) || 0) > 0) {
      game.bus.emit(EV.SPELL_FAILED, { caster, spellId, reason: 'cooldown' });
      return false;
    }
    if (st.mana < spell.manaCost) {
      game.bus.emit(EV.SPELL_FAILED, { caster, spellId, reason: 'mana' });
      return false;
    }
    st.mana -= spell.manaCost;
    caster.cooldowns.set(spellId, spell.cooldown * (st.cooldownMult || 1));
    power = spellPowerFor(game.state, spell);
    game.state.stats.spellsCast++;
  }
  let l = Math.hypot(dirX, dirY);
  if (!(l > 1e-6)) { dirX = caster.facingX || 1; dirY = caster.facingY || 0; l = Math.hypot(dirX, dirY) || 1; }
  dirX /= l; dirY /= l;

  const ox = caster.x + dirX * 6, oy = caster.y + dirY * 4;
  const form = spell.form || (spell.kind === 'nova' ? 'nova' : spell.kind === 'aoe' ? 'aoe' : 'bolt');
  const ctx = { game, caster, spell, power, team: caster.team, dirX, dirY, ox, oy, opts };
  switch (form) {
    case 'arc': castArc(ctx); break;
    case 'nova': castNova(ctx); break;
    case 'rune': castRune(ctx); break;
    case 'aoe': castLegacyAoe(ctx); break;
    default: castProjectiles(ctx, form); break;
  }
  game.bus.emit(EV.SPELL_CAST, { caster, spellId, spell, x: ox, y: oy - 6, dirX, dirY });
  return true;
}

function castProjectiles({ game, caster, spell, power, team, dirX, dirY, ox, oy }, form) {
  const n = spell.count || 1;
  const base = Math.atan2(dirY, dirX);
  const spread = spell.spread || 0;
  for (let i = 0; i < n; i++) {
    let a = base;
    if (n > 1) a = base + (i / (n - 1) - 0.5) * spread * 2;
    else if (spread) a = base + (game.rng.next() - 0.5) * spread;
    const o = {};
    if (form === 'seekers') { o.seekDelay = 0.18 + i * 0.04; }
    game.entities.add(new Projectile(caster, spell, ox, oy, Math.cos(a), Math.sin(a), power, o));
  }
}

function castArc({ game, caster, spell, power, team, dirX, dirY, ox, oy }) {
  const map = game.level?.map;
  const aim = Math.atan2(dirY, dirX);
  const range = spell.range || 120;
  let best = null, bestScore = Infinity;
  for (const e of game.entities.inRadius(caster.x, caster.y, range)) {
    if (!isTarget(e, team)) continue;
    const ang = angleDiff(Math.atan2(e.y - caster.y, e.x - caster.x), aim);
    if (ang > (spell.cone || 0.7)) continue;
    if (map && !hasLineOfSight(map, caster.x, caster.y - 2, e.x, e.y - 2)) continue;
    const score = Math.hypot(e.x - caster.x, e.y - caster.y) * (1 + ang * 1.5);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  const amount = spell.damage * power;
  if (!best) {
    // Fizzle to max range (still visible; no damage).
    const end = map ? raycastTiles(map, ox, oy, ox + dirX * range, oy + dirY * range, 'shot') : { x: ox + dirX * range, y: oy + dirY * range };
    game.entities.add(new ArcVisual([{ x: ox, y: oy - 6 }, { x: end.x, y: end.y - 6 }], spell.colors, 0.12));
    return;
  }
  game.entities.add(new ArcVisual([{ x: ox, y: oy - 6 }, { x: best.x, y: best.y - 7 }], spell.colors));
  const hit = { amount, element: spell.element, elements: spell.elements, source: caster, statuses: spell.statuses, knockback: spell.knockback, from: { x: caster.x, y: caster.y }, poise: spell.poise, shieldBreak: spell.shieldBreak, spell };
  damage(game, best, hit);
  game.bus.emit(EV.PROJECTILE_HIT, { projectile: null, target: best, x: best.x, y: best.y, element: spell.element });
  const seen = new Set([best.id]);
  const chained = chainFrom(game, best.x, best.y, {
    team, source: caster, jumps: spell.jumps || 2, range: spell.jumpRange || 64, amount: amount * (spell.falloff || 0.8),
    falloff: spell.falloff || 0.8, element: spell.element, elements: spell.elements, statuses: spell.statuses, colors: spell.colors,
    exclude: seen, poise: spell.poise,
  });
  const last = chained.length ? chained[chained.length - 1] : best;
  if (spell.impact) doImpact(game, spell.impact, last.x, last.y, { team, source: caster, spell, power, scale: spell.impactScale, exclude: seen });
}

function castNova({ game, caster, spell, power, team }) {
  const r = spell.aoeRadius || 48;
  // Novas also erase hostile projectiles caught in the blast - a defensive tool.
  for (const p of game.entities.inRadius(caster.x, caster.y, r)) {
    if (p.tags.has('projectile') && p.team !== team && p.team !== 'neutral') {
      fx(game, 'emit', 'impact', p.x, p.y - 6, { element: spell.element, count: 4 });
      p.destroy();
    }
  }
  const hits = burst(game, caster.x, caster.y, r, {
    team, source: caster, amount: spell.damage * power, element: spell.element, elements: spell.elements,
    statuses: spell.statuses, knockback: spell.knockback || 240, preset: 'aoe', spellId: spell.id,
    poise: spell.poise, shieldBreak: spell.shieldBreak,
  });
  shake(game, 2.5, 0.2);
  const imp = spell.impact;
  if (!imp) return;
  const o = { team, source: caster, spell, power, scale: 0.55 };
  if (imp === 'cloud' || imp === 'pool' || imp === 'embers' || imp === 'frost') {
    const type = { cloud: 'cloud', pool: 'lava', embers: 'fire', frost: 'frost' }[imp];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + game.rng.next() * 0.3;
      const zx = caster.x + Math.cos(a) * r * 0.7, zy = caster.y + Math.sin(a) * r * 0.7;
      if (game.level?.map?.isSolidAt(zx, zy)) continue;
      game.entities.add(new Zone(game, type, zx, zy, {
        team, source: caster, radius: type === 'cloud' ? 14 : 10, life: type === 'cloud' ? 3 : 2.5,
        power: type === 'frost' ? 14 : Math.max(1, spell.damage * power * 0.1),
      }));
    }
  } else if (imp === 'split' || imp === 'well') {
    doImpact(game, imp, caster.x, caster.y, { ...o, scale: 1 });
  } else {
    for (const e of hits.slice(0, 3)) doImpact(game, imp, e.x, e.y, o);
  }
}

function castRune({ game, caster, spell, power, team, dirX, dirY, opts }) {
  const map = game.level?.map;
  const range = spell.range || 90;
  let tx, ty;
  if (opts.targetX != null) {
    const dx = opts.targetX - caster.x, dy = opts.targetY - caster.y, d = Math.hypot(dx, dy);
    const k = d > range ? range / d : 1;
    tx = caster.x + dx * k; ty = caster.y + dy * k;
  } else {
    const aim = Math.atan2(dirY, dirX);
    const t = game.entities.nearest(caster.x, caster.y, (e) => isTarget(e, team) && angleDiff(Math.atan2(e.y - caster.y, e.x - caster.x), aim) < 0.6, range);
    if (t) { tx = t.x; ty = t.y; } else { tx = caster.x + dirX * range * 0.55; ty = caster.y + dirY * range * 0.55; }
  }
  if (map) {
    const ray = raycastTiles(map, caster.x, caster.y, tx, ty, 'walk');
    if (ray.hit) { tx = ray.x - dirX * 6; ty = ray.y - dirY * 6; }
  }
  game.entities.add(new Rune(game, caster, spell, tx, ty, power));
}

function castLegacyAoe({ game, caster, spell, power, team, dirX, dirY }) {
  const range = spell.range || 100;
  const t = game.entities.nearest(caster.x + dirX * range * 0.6, caster.y + dirY * range * 0.6, (e) => isTarget(e, team), range * 0.6);
  const tx = t ? t.x : caster.x + dirX * range * 0.6;
  const ty = t ? t.y : caster.y + dirY * range * 0.6;
  game.entities.add(new AreaEffect(caster, spell, tx, ty, power));
}

/** Fire a hidden enemy spell (no mana/cooldown). Returns the projectile. */
export function enemyShoot(game, caster, spellId, dirX, dirY, power = 1, opts = {}) {
  const spell = SPELLS[spellId] || SPELLS.boss_bolt;
  const l = Math.hypot(dirX, dirY) || 1;
  const p = new Projectile(caster, spell, opts.x ?? caster.x + (dirX / l) * 6, opts.y ?? caster.y + (dirY / l) * 4, dirX / l, dirY / l, power, opts);
  game.entities.add(p);
  return p;
}
