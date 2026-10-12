// Spell casting (team: combat).
import { EV } from '../core/events.js';
import { SPELLS } from './data.js';
import { Projectile, AreaEffect } from './actors.js';

/**
 * Cast `spellId` from `caster` in unit direction (dirX, dirY).
 * Player casters pay mana and respect per-spell cooldowns (caster.cooldowns Map).
 * Returns true if the spell fired.
 */
export function castSpell(game, caster, spellId, dirX, dirY) {
  const spell = SPELLS[spellId];
  if (!spell) {
    game.bus.emit(EV.SPELL_FAILED, { caster, spellId, reason: 'locked' });
    return false;
  }
  const isPlayer = caster.tags.has('player');
  let power = 1;
  if (isPlayer) {
    const st = game.state.player;
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
    power = st.spellPower * (1 + (st.elementPower?.[spell.element] || 0));
    game.state.stats.spellsCast++;
  }

  const ox = caster.x + dirX * 6, oy = caster.y - 6 + dirY * 6;
  if (spell.kind === 'projectile') {
    const n = spell.count || 1;
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const a = base + (n > 1 ? (i / (n - 1) - 0.5) * spell.spread * 2 : (Math.random() - 0.5) * (spell.spread || 0));
      game.entities.add(new Projectile(caster, spell, ox, oy, Math.cos(a), Math.sin(a), power));
    }
  } else if (spell.kind === 'aoe') {
    const range = spell.range || 100;
    const target = game.entities.nearest(caster.x + dirX * range * 0.6, caster.y + dirY * range * 0.6,
      (e) => e.team !== caster.team && e.team !== 'neutral' && e.hp > 0, range * 0.6);
    const tx = target ? target.x : caster.x + dirX * range * 0.6;
    const ty = target ? target.y : caster.y + dirY * range * 0.6;
    game.entities.add(new AreaEffect(caster, spell, tx, ty, power));
  } else if (spell.kind === 'nova') {
    game.entities.add(new AreaEffect(caster, spell, caster.x, caster.y, power));
  }
  game.bus.emit(EV.SPELL_CAST, { caster, spellId, spell, x: ox, y: oy, dirX, dirY });
  return true;
}
