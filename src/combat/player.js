// Player entity (team: combat). Placeholder: moves, regenerates mana, casts loadout spells 1-4.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { moveCircle } from '../core/physics.js';
import { normalize } from '../core/math.js';
import { castSpell } from './spells.js';

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
    this.anim = 'idle';
    this.animT = 0;
    this.castAnim = 0;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.kbx = this.kby = 0;
    this.dying = false;
    /** spellId -> seconds remaining */
    this.cooldowns = new Map();
    this.statuses = [];
  }

  onAdd(game) {
    this._light = game.fx.attachLight(this, 56, '#c8b8ff', 0.85);
  }
  onRemove() {
    this._light?.remove();
  }

  /** Unit aim vector: mouse (desktop) > touch aim source > nearest enemy (touch) > facing. */
  aim(game) {
    const { input, camera } = game;
    const m = input.mouse;
    if (input.lastDevice !== 'touch' && m.inside && performance.now() - m.lastMoveTime < 4000) {
      const w = camera.screenToWorld(m.x, m.y);
      const n = normalize(w.x - this.x, w.y - (this.y - 6));
      if (n.x || n.y) return n;
    }
    const a = input.getAim();
    if (a) return normalize(a.x, a.y);
    if (input.lastDevice === 'touch') {
      const t = game.entities.nearest(this.x, this.y, (e) => e.team === 'enemy' && e.hp > 0, 160);
      if (t) return normalize(t.x - this.x, t.y - this.y);
    }
    return { x: this.facingX, y: this.facingY };
  }

  update(game, dt) {
    const st = game.state.player;
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.castAnim = Math.max(0, this.castAnim - dt);
    for (const [id, t] of this.cooldowns) this.cooldowns.set(id, Math.max(0, t - dt));
    this.animT += dt;
    if (this.dying) { this.anim = 'die'; return; }

    const mv = game.input.move;
    const speed = st.moveSpeed;
    moveCircle(game.level.map, this, mv.x * speed * dt + this.kbx * dt, mv.y * speed * dt + this.kby * dt);
    this.kbx *= 0.8; this.kby *= 0.8;
    if (mv.x || mv.y) {
      const n = normalize(mv.x, mv.y);
      this.facingX = n.x; this.facingY = n.y;
    }
    this.anim = this.castAnim > 0 ? 'cast' : (mv.x || mv.y) ? 'walk' : 'idle';

    st.mana = Math.min(st.maxMana, st.mana + st.manaRegen * dt);

    for (let i = 0; i < 4; i++) {
      if (!game.input.pressed('spell' + (i + 1))) continue;
      const spellId = game.state.loadout[i];
      if (!spellId) { game.bus.emit(EV.SPELL_FAILED, { caster: this, spellId: null, reason: 'empty' }); continue; }
      const d = this.aim(game);
      if (castSpell(game, this, spellId, d.x, d.y)) this.castAnim = 0.2;
    }
  }

  die(game, killer) {
    if (this.dying) return;
    this.dying = true;
    game.bus.emit(EV.PLAYER_DIED, { killer });
  }

  render(ctx, game) {
    game.art.drawShadow(ctx, this.rx, this.ry, 9);
    const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;
    game.art.drawSprite(ctx, 'player', this.rx, this.ry, {
      anim: this.anim, t: this.animT, flip: this.facingX < 0, flash: this.hurtFlash > 0 ? 1 : 0,
      alpha: this.dying ? 0.5 : blink ? 0.5 : 1,
    });
  }
}
