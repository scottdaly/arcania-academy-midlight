// World entities: NPCs, doors/portals, crafting stations, pickups (team: world). Placeholder.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { addFragments, addItem, checkRequirements } from '../core/state.js';
import { dist } from '../core/math.js';

export class Npc extends Entity {
  /** npc: NPC def from npcs.js */
  constructor(npc, x, y, openDialogue) {
    super(x, y);
    this.npc = npc;
    this.tags.add('npc');
    this.radius = 6;
    this.mass = Infinity;
    this.pushable = true;
    this.interactable = true;
    this.interactRadius = 16;
    this.interactPrompt = 'Talk';
    this.facing = 1;
    this._open = openDialogue;
  }
  update(game) {
    if (game.player) this.facing = game.player.x < this.x ? -1 : 1;
  }
  interact(game) {
    this._open(game, this.npc.id);
  }
  render(ctx, game) {
    game.art.drawShadow(ctx, this.rx, this.ry, 9);
    game.art.drawSprite(ctx, this.npc.sprite, this.rx, this.ry, { t: this.age, flip: this.facing < 0 });
  }
}

/** Door / portal / stairs: interact to emit TRAVEL_REQUEST (optionally gated by requirements). */
export class Door extends Entity {
  constructor(x, y, { sprite, to, params = {}, prompt = 'Enter', requires = null, lockedText = 'It is sealed.', light = null }) {
    super(x, y);
    this.tags.add('door');
    this.sprite = sprite;
    this.to = to;
    this.params = params;
    this.requires = requires;
    this.lockedText = lockedText;
    this.radius = 6;
    this.interactable = true;
    this.interactRadius = 18;
    this.interactPrompt = prompt;
    this.layer = 0;
    this.lightDef = light;
    /** Extra runtime lock (e.g. tower stairs until the floor is cleared). */
    this.locked = false;
  }
  onAdd(game) {
    if (this.lightDef) this._light = game.fx.attachLight(this, this.lightDef.radius, this.lightDef.color, 1);
  }
  onRemove() {
    this._light?.remove();
  }
  interact(game) {
    if (this.locked || !checkRequirements(game.state, this.requires)) {
      game.bus.emit(EV.TOAST, { text: this.lockedText, color: '#ff8a8a' });
      return;
    }
    game.bus.emit(EV.TRAVEL_REQUEST, { to: this.to, params: this.params });
  }
  update(game) {
    if (this.sprite === 'prop_portal' && Math.random() < 0.3) game.fx.emit('portal', this.x + (Math.random() - 0.5) * 10, this.y - 8);
  }
  render(ctx, game) {
    game.art.drawSprite(ctx, this.sprite, this.rx, this.ry, { t: this.age, alpha: this.locked ? 0.5 : 1 });
  }
}

/** Generic interactable station (e.g. the Arcane Forge -> crafting panel). */
export class Station extends Entity {
  constructor(x, y, { sprite, prompt, onInteract }) {
    super(x, y);
    this.tags.add('station');
    this.sprite = sprite;
    this.radius = 7;
    this.mass = Infinity;
    this.pushable = true;
    this.interactable = true;
    this.interactRadius = 18;
    this.interactPrompt = prompt;
    this._on = onInteract;
  }
  onAdd(game) {
    this._light = game.fx.attachLight(this, 40, '#ff9a3a', 0.8);
  }
  onRemove() {
    this._light?.remove();
  }
  interact(game) {
    this._on(game);
  }
  render(ctx, game) {
    game.art.drawSprite(ctx, this.sprite, this.rx, this.ry, { t: this.age });
  }
}

/** Collectable. kind: 'fragment' | 'health' | 'mana' | 'item'. data: {element?, itemId?, amount} */
export class Pickup extends Entity {
  constructor(kind, x, y, data = {}) {
    super(x, y);
    this.kind = kind;
    this.data = data;
    this.tags.add('pickup');
    this.radius = 4;
    this.layer = 0;
    this.sprite = kind === 'fragment' ? `pickup_fragment_${data.element || 'arcane'}` : kind === 'item' ? 'pickup_item' : `pickup_${kind}`;
    this.bob = Math.random() * 6;
  }
  update(game, dt) {
    const p = game.player;
    if (!p || this.age < 0.4 || game.state.player.hp <= 0) return;
    const d = dist(this.x, this.y, p.x, p.y);
    if (d < 36) {
      const k = Math.min(1, (160 * dt) / Math.max(1, d));
      this.x += (p.x - this.x) * k;
      this.y += (p.y - this.y) * k;
    }
    if (d < p.radius + this.radius + 2) this.collect(game);
  }
  collect(game) {
    const { kind, data } = this;
    const amount = data.amount ?? 1;
    const st = game.state.player;
    if (kind === 'fragment') addFragments(game, data.element, amount);
    else if (kind === 'item') addItem(game, data.itemId, amount);
    else if (kind === 'health') {
      const before = st.hp;
      st.hp = Math.min(st.maxHp, st.hp + amount);
      game.bus.emit(EV.PLAYER_HEALED, { amount: st.hp - before, hp: st.hp, maxHp: st.maxHp });
    } else if (kind === 'mana') st.mana = Math.min(st.maxMana, st.mana + amount);
    game.bus.emit(EV.PICKUP_COLLECTED, { kind, element: data.element, itemId: data.itemId, amount, x: this.x, y: this.y });
    this.destroy();
  }
  renderGlow(ctx, game) {
    const y = this.ry - 3 + Math.sin(this.age * 4 + this.bob) * 1.5;
    game.art.drawSprite(ctx, this.sprite, this.rx, y, { t: this.age, alpha: 0.9 });
  }
  render(ctx, game) {
    game.art.drawShadow(ctx, this.rx, this.ry, 5);
  }
}
