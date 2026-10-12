// World entities (team: world): NPCs, wandering students, doors/portals/stairs, stations,
// pickups (with magnet), chests, fragment geodes, shrines, ambush barriers, secret walls,
// quest items, signposts and the decorative Mage Tower spire.
import { Entity } from '../core/entity.js';
import { EV } from '../core/events.js';
import { TILE } from '../core/tiles.js';
import { TILE_SIZE, ELEMENT_COLORS } from '../core/config.js';
import { addFragments, addItem, checkRequirements, setFlag } from '../core/state.js';
import { moveCircle } from '../core/physics.js';
import { dist } from '../core/math.js';
import { spriteOr } from './util.js';
import { itemName, itemColor } from './loot.js';

const toast = (game, text, color, duration) => game.bus.emit(EV.TOAST, { text, color, duration });
const sfx = (game, name, opts = {}) => game.bus.emit(EV.SFX, { name, ...opts });

// ------------------------------------------------------------------ NPCs

/** Draws a little bobbing "!" (new story beat) or "?" (hint) over an NPC. */
function drawMarker(ctx, game, x, y, kind, t) {
  const bob = Math.round(Math.sin(t * 4) * 1.5);
  const col = kind === '!' ? '#ffd25a' : '#9fd8ff';
  ctx.fillStyle = '#1a1028';
  if (kind === '!') {
    ctx.fillRect(x - 2, y - 9 + bob, 4, 9);
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y - 8 + bob, 2, 4);
    ctx.fillRect(x - 1, y - 3 + bob, 2, 1);
  } else {
    ctx.fillRect(x - 3, y - 9 + bob, 6, 9);
    ctx.fillStyle = col;
    ctx.fillRect(x - 2, y - 8 + bob, 4, 1);
    ctx.fillRect(x + 1, y - 7 + bob, 1, 2);
    ctx.fillRect(x - 1, y - 5 + bob, 2, 1);
    ctx.fillRect(x - 1, y - 3 + bob, 2, 1);
  }
}

export class Npc extends Entity {
  /** npc: NPC def from dialogue.js. openDialogue(game, npcId). */
  constructor(npc, x, y, openDialogue) {
    super(x, y);
    this.npc = npc;
    this.tags.add('npc');
    this.radius = 6;
    this.mass = Infinity;
    this.pushable = true;
    this.interactable = true;
    this.interactRadius = 16;
    this.interactPrompt = npc.prompt || 'Talk';
    this.facing = npc.facing || 1;
    this.anim = 'idle';
    this._open = openDialogue;
    this._sprite = null;
  }
  spriteKey(game) {
    return (this._sprite ||= spriteOr(game, this.npc.sprite, this.npc.fallbackSprite || 'npc_student'));
  }
  update(game) {
    const p = game.player;
    if (p && dist(p.x, p.y, this.x, this.y) < 48) this.facing = p.x < this.x ? -1 : 1;
  }
  interact(game) {
    const p = game.player;
    if (p) this.facing = p.x < this.x ? -1 : 1;
    this._open(game, this.npc.id);
  }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    game.art.drawShadow(ctx, x, y, this.npc.small ? 6 : 9);
    game.art.drawSprite(ctx, this.spriteKey(game), x, y, { anim: this.anim, t: this.age, flip: this.facing < 0 });
    const m = this.npc.marker?.(game.state);
    if (m) drawMarker(ctx, game, x, y - (this.npc.small ? 12 : 22), m, this.age);
  }
}

/**
 * NPC that strolls between random walkable points inside a zone {x0,y0,x1,y1} (tiles).
 * Pauses, chats (faces the player) and never leaves its zone.
 */
export class Wanderer extends Npc {
  constructor(npc, x, y, openDialogue, { zone, speed = 22, rng, pauseMin = 1.5, pauseMax = 4 }) {
    super(npc, x, y, openDialogue);
    this.zone = zone;
    this.speed = speed;
    this.rng = rng;
    this.pauseMin = pauseMin;
    this.pauseMax = pauseMax;
    this.mass = 4;
    this.target = null;
    this.wait = rng.float(0.2, 2);
    this.stuck = 0;
  }
  pickTarget(game) {
    const map = game.level.map, z = this.zone;
    for (let i = 0; i < 12; i++) {
      const tx = this.rng.int(z.x0, z.x1), ty = this.rng.int(z.y0, z.y1);
      if (!map.isSolid(tx, ty) && !map.isSolid(tx - 1, ty) && !map.isSolid(tx + 1, ty)) return { x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 8 };
    }
    return null;
  }
  update(game, dt) {
    const p = game.player;
    const near = p && dist(p.x, p.y, this.x, this.y) < 26;
    this.anim = 'idle';
    if (near) { this.facing = p.x < this.x ? -1 : 1; return; }
    if (this.wait > 0) { this.wait -= dt; return; }
    if (!this.target) { this.target = this.pickTarget(game); if (!this.target) { this.wait = 1; return; } }
    const dx = this.target.x - this.x, dy = this.target.y - this.y, d = Math.hypot(dx, dy);
    if (d < 2 || this.stuck > 0.6) {
      this.target = null;
      this.stuck = 0;
      this.wait = this.rng.float(this.pauseMin, this.pauseMax);
      return;
    }
    const sx = this.x, sy = this.y;
    moveCircle(game.level.map, this, (dx / d) * this.speed * dt, (dy / d) * this.speed * dt);
    if (Math.hypot(this.x - sx, this.y - sy) < this.speed * dt * 0.3) this.stuck += dt; else this.stuck = 0;
    if (Math.abs(dx) > 0.5) this.facing = dx < 0 ? -1 : 1;
    this.anim = 'walk';
  }
}

// ------------------------------------------------------------------ doors / portals / stairs

/**
 * Door / portal / stairs: interact to emit TRAVEL_REQUEST.
 * Gating: `requires` (Requirement), runtime `locked`, or `check(game) -> lockedText|null`.
 * `onUse(game)` replaces travel (e.g. the hub portal opens a destination menu).
 */
export class Door extends Entity {
  constructor(x, y, { sprite, to, params = {}, prompt = 'Enter', requires = null, lockedText = 'It is sealed.', light = null, check = null, onUse = null, fallbackSprite = null }) {
    super(x, y);
    this.tags.add('door');
    this.sprite = sprite;
    this.fallbackSprite = fallbackSprite;
    this.to = to;
    this.params = params;
    this.requires = requires;
    this.lockedText = lockedText;
    this.check = check;
    this.onUse = onUse;
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
    const why = this.locked ? this.lockedText
      : !checkRequirements(game.state, this.requires) ? this.lockedText
        : this.check?.(game) || null;
    if (why) {
      toast(game, why, '#ff8a8a');
      sfx(game, 'fail');
      return;
    }
    if (this.onUse) { this.onUse(game); return; }
    sfx(game, 'door');
    game.bus.emit(EV.TRAVEL_REQUEST, { to: this.to, params: this.params });
  }
  update(game) {
    if (this.sprite === 'prop_portal' && !this.locked && Math.random() < 0.3) game.fx.emit('portal', this.x + (Math.random() - 0.5) * 10, this.y - 8);
  }
  render(ctx, game) {
    const key = this.fallbackSprite ? spriteOr(game, this.sprite, this.fallbackSprite) : this.sprite;
    game.art.drawSprite(ctx, key, Math.round(this.rx), Math.round(this.ry), { t: this.age, alpha: this.locked ? 0.5 : 1 });
  }
}

/** Generic interactable station (e.g. the Arcane Forge -> crafting panel). */
export class Station extends Entity {
  constructor(x, y, { sprite, prompt, onInteract, light = { radius: 40, color: '#ff9a3a' } }) {
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
    this.lightDef = light;
  }
  onAdd(game) {
    if (this.lightDef) this._light = game.fx.attachLight(this, this.lightDef.radius, this.lightDef.color, 0.8);
  }
  onRemove() {
    this._light?.remove();
  }
  interact(game) {
    this._on(game);
  }
  update(game) {
    if (this.sprite === 'prop_forge' && Math.random() < 0.06) game.fx.emit('sparkle', this.x + (Math.random() - 0.5) * 8, this.y - 10, { element: 'fire', count: 1 });
  }
  render(ctx, game) {
    game.art.drawSprite(ctx, this.sprite, Math.round(this.rx), Math.round(this.ry), { t: this.age });
  }
}

// ------------------------------------------------------------------ pickups

const MAGNET = { fragment: 60, health: 44, mana: 44, item: 30 };

/** Collectable. kind: 'fragment' | 'health' | 'mana' | 'item'. data: {element?, itemId?, amount, burst?} */
export class Pickup extends Entity {
  constructor(kind, x, y, data = {}) {
    super(x, y);
    this.kind = kind;
    this.data = data;
    this.tags.add('pickup');
    this.radius = 4;
    this.layer = 0;
    this.element = kind === 'fragment' ? (data.element || 'arcane') : null;
    this.sprite = kind === 'fragment' ? `pickup_fragment_${this.element}` : kind === 'item' ? 'pickup_item' : `pickup_${kind}`;
    this.bob = Math.random() * 6;
    this.pull = 0;
    // Optional pop-out burst so chest/geode loot sprays across the floor.
    if (data.burst) {
      const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 60;
      this.vx = Math.cos(a) * s;
      this.vy = Math.sin(a) * s;
      this.hop = 6 + Math.random() * 4;
    } else this.hop = 0;
    this.z = 0;
  }
  wanted(game) {
    const st = game.state.player;
    if (this.kind === 'health') return st.hp < st.maxHp;
    if (this.kind === 'mana') return st.mana < st.maxMana;
    return true;
  }
  update(game, dt) {
    const map = game.level?.map;
    if (this.vx || this.vy) {
      if (map) moveCircle(map, this, this.vx * dt, this.vy * dt);
      this.vx *= 0.9; this.vy *= 0.9;
      if (Math.abs(this.vx) + Math.abs(this.vy) < 2) this.vx = this.vy = 0;
    }
    if (this.hop > 0) { this.z = Math.sin(Math.min(1, this.age / 0.45) * Math.PI) * this.hop; if (this.age > 0.45) this.hop = this.z = 0; }
    const p = game.player;
    if (!p || this.age < 0.45 || game.state.player.hp <= 0 || !this.wanted(game)) { this.pull = 0; return; }
    const d = dist(this.x, this.y, p.x, p.y);
    const R = MAGNET[this.kind] || 36;
    if (d < R) {
      this.pull = Math.min(1, this.pull + dt * 3);
      const speed = (70 + 260 * (1 - d / R)) * this.pull;
      const k = Math.min(1, (speed * dt) / Math.max(1, d));
      this.x += (p.x - this.x) * k;
      this.y += (p.y - this.y) * k;
    } else this.pull = 0;
    if (d < (p.radius || 6) + this.radius + 2) this.collect(game);
  }
  collect(game) {
    const { kind, data } = this;
    const amount = data.amount ?? 1;
    const st = game.state.player;
    if (kind === 'fragment') addFragments(game, this.element, amount);
    else if (kind === 'item') {
      addItem(game, data.itemId, amount);
      const slot = game.combat?.getItem?.(data.itemId)?.slot;
      const extra = slot === 'staff' || slot === 'robe' ? ' - equip it from your inventory (I)' : '';
      toast(game, `Found ${itemName(game, data.itemId)}${amount > 1 ? ` x${amount}` : ''}!${extra}`, itemColor(game, data.itemId), 3);
    } else if (kind === 'health') {
      const before = st.hp;
      st.hp = Math.min(st.maxHp, st.hp + amount);
      game.bus.emit(EV.PLAYER_HEALED, { amount: st.hp - before, hp: st.hp, maxHp: st.maxHp });
    } else if (kind === 'mana') st.mana = Math.min(st.maxMana, st.mana + amount);
    game.bus.emit(EV.PICKUP_COLLECTED, { kind, element: this.element || undefined, itemId: data.itemId, amount, x: this.x, y: this.y });
    this.destroy();
  }
  renderGlow(ctx, game) {
    const y = this.ry - 3 - this.z + Math.sin(this.age * 4 + this.bob) * 1.5;
    if (this.element) {
      const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(this.age * 5 + this.bob);
      ctx.fillStyle = c[0];
      ctx.fillRect(Math.round(this.rx) - 4, Math.round(y) - 9, 8, 9);
      ctx.globalAlpha = 1;
    }
    game.art.drawSprite(ctx, this.sprite, Math.round(this.rx), Math.round(y), { t: this.age, alpha: 0.9 });
  }
  render(ctx, game) {
    game.art.drawShadow(ctx, Math.round(this.rx), Math.round(this.ry), 5);
  }
}

// ------------------------------------------------------------------ chests, geodes, shrines

/** Solid-ish prop base: blocks the player (immovable pushable body). */
class Prop extends Entity {
  constructor(x, y) {
    super(x, y);
    this.radius = 6;
    this.mass = Infinity;
    this.pushable = true;
    this.interactable = true;
    this.interactRadius = 16;
  }
}

/** Chest: interact to burst its loot (list from loot.rollChest) across the floor. */
export class Chest extends Prop {
  constructor(x, y, { drops = [], onOpen = null, label = 'Open' } = {}) {
    super(x, y);
    this.tags.add('chest');
    this.drops = drops;
    this.opened = false;
    this.onOpen = onOpen;
    this.interactPrompt = label;
  }
  interact(game) {
    if (this.opened) return;
    this.opened = true;
    this.interactable = false;
    this.openedAt = this.age;
    sfx(game, 'pickup', { pitch: 0.8 });
    game.fx.emit('sparkle', this.x, this.y - 8, { color: '#ffd25a', count: 18 });
    game.fx.ring(this.x, this.y - 4, 18, '#ffd25a', 0.4);
    for (const d of this.drops) game.world.spawnPickup(game, d.kind, this.x, this.y + 2, { element: d.element, itemId: d.itemId, amount: d.amount, burst: true });
    this.onOpen?.(game, this);
  }
  renderGlow(ctx) {
    if (this.opened) return;
    ctx.globalAlpha = 0.12 + 0.08 * Math.sin(this.age * 3);
    ctx.fillStyle = '#ffd25a';
    ctx.fillRect(Math.round(this.rx) - 8, Math.round(this.ry) - 12, 16, 13);
    ctx.globalAlpha = 1;
  }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    game.art.drawShadow(ctx, x, y, 10);
    if (this.opened) {
      const key = spriteOr(game, 'prop_chest_open', 'prop_chest');
      game.art.drawSprite(ctx, key, x, y, { t: this.age - this.openedAt, anim: 'open' });
      if (key === 'prop_chest') { ctx.fillStyle = '#1a0e08'; ctx.fillRect(x - 5, y - 9, 10, 3); }
    } else game.art.drawSprite(ctx, 'prop_chest', x, y, { t: this.age });
  }
}

/** Fragment geode: a crystal cluster you crack open for a burst of one element's fragments. */
export class Geode extends Prop {
  constructor(x, y, { element = 'arcane', amount = 4 } = {}) {
    super(x, y);
    this.tags.add('geode');
    this.element = element;
    this.amount = amount;
    this.spent = false;
    this.interactPrompt = 'Harvest';
  }
  onAdd(game) {
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    this._light = game.fx.attachLight(this, 44, c[0], 0.9);
  }
  onRemove() { this._light?.remove(); }
  interact(game) {
    if (this.spent) return;
    this.spent = true;
    this.interactable = false;
    this._light?.remove();
    sfx(game, 'hit', { pitch: 1.4 });
    game.bus.emit(EV.CAMERA_SHAKE, { intensity: 2, duration: 0.15 });
    game.fx.emit('impact', this.x, this.y - 6, { element: this.element, count: 20 });
    // Split the yield into several bouncing shards: more satisfying than one big pickup.
    let left = this.amount;
    while (left > 0) {
      const n = Math.min(left, 1 + (Math.random() < 0.4 ? 1 : 0));
      left -= n;
      game.world.spawnPickup(game, 'fragment', this.x, this.y + 2, { element: this.element, amount: n, burst: true });
    }
    toast(game, `The geode cracks open: ${this.amount} ${this.element} fragments!`, (ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane)[1]);
  }
  update(game) {
    if (!this.spent && Math.random() < 0.05) game.fx.emit('sparkle', this.x + (Math.random() - 0.5) * 10, this.y - 4 - Math.random() * 8, { element: this.element, count: 1 });
  }
  renderGlow(ctx) {
    if (this.spent) return;
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    ctx.globalAlpha = 0.25 + 0.12 * Math.sin(this.age * 3);
    ctx.fillStyle = c[0];
    const x = Math.round(this.rx), y = Math.round(this.ry);
    ctx.fillRect(x - 5, y - 12, 10, 12);
    ctx.fillStyle = c[1];
    ctx.fillRect(x - 1, y - 10, 2, 6);
    ctx.globalAlpha = 1;
  }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    const key = `prop_geode_${this.element}`;
    if (game.art.hasSprite(key)) {
      game.art.drawSprite(ctx, key, x, y, { t: this.age, alpha: this.spent ? 0.45 : 1 });
      return;
    }
    // Fallback: the crystal tile plus element-tinted shards.
    ctx.globalAlpha = this.spent ? 0.4 : 1;
    game.art.drawTile(ctx, TILE.CRYSTAL, x - 8, y - 14, 0, this.age, 0, 0, null);
    const c = ELEMENT_COLORS[this.element] || ELEMENT_COLORS.arcane;
    ctx.fillStyle = c[0];
    ctx.fillRect(x - 6, y - 6, 3, 5);
    ctx.fillRect(x + 3, y - 7, 3, 6);
    ctx.fillStyle = c[1];
    ctx.fillRect(x - 5, y - 5, 1, 2);
    ctx.fillRect(x + 4, y - 6, 1, 2);
    ctx.globalAlpha = 1;
  }
}

/** Healing shrine: restores HP and mana once. */
export class Shrine extends Prop {
  constructor(x, y) {
    super(x, y);
    this.tags.add('shrine');
    this.used = false;
    this.interactPrompt = 'Pray';
  }
  onAdd(game) { this._light = game.fx.attachLight(this, 52, '#7affc8', 0.9); }
  onRemove() { this._light?.remove(); }
  interact(game) {
    if (this.used) return;
    this.used = true;
    this.interactable = false;
    this._light?.remove();
    const st = game.state.player;
    const before = st.hp;
    st.hp = st.maxHp;
    st.mana = st.maxMana;
    game.bus.emit(EV.PLAYER_HEALED, { amount: st.hp - before, hp: st.hp, maxHp: st.maxHp });
    game.fx.emit('heal', game.player?.x ?? this.x, game.player?.y ?? this.y, { count: 24 });
    game.fx.ring(this.x, this.y - 4, 30, '#7affc8', 0.5);
    toast(game, 'Warm light washes over you. Health and mana restored.', '#7affc8');
  }
  update(game) {
    if (!this.used && Math.random() < 0.08) game.fx.emit('sparkle', this.x + (Math.random() - 0.5) * 12, this.y - Math.random() * 14, { color: '#7affc8', count: 1 });
  }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    if (game.art.hasSprite('prop_shrine')) { game.art.drawSprite(ctx, 'prop_shrine', x, y, { t: this.age, alpha: this.used ? 0.5 : 1 }); return; }
    ctx.globalAlpha = this.used ? 0.5 : 1;
    game.art.drawTile(ctx, TILE.STATUE, x - 8, y - 15, 0, this.age, 0, 0, null);
    ctx.globalAlpha = 1;
  }
  renderGlow(ctx) {
    if (this.used) return;
    ctx.globalAlpha = 0.2 + 0.1 * Math.sin(this.age * 2.5);
    ctx.fillStyle = '#7affc8';
    ctx.fillRect(Math.round(this.rx) - 6, Math.round(this.ry) - 16, 12, 16);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ ambush barrier & secrets

/** Shimmering arcane seal drawn over a FENCE tile while an ambush room is locked. */
export class Barrier extends Entity {
  constructor(x, y) {
    super(x, y);
    this.layer = 1;
    this.closing = 0;
  }
  release() { this.closing = 0.0001; }
  update(game, dt) {
    if (this.closing > 0) { this.closing += dt; if (this.closing > 0.35) this.destroy(); }
    if (Math.random() < 0.05) game.fx.emit('sparkle', this.x + (Math.random() - 0.5) * 14, this.y - Math.random() * 14, { element: 'arcane', count: 1 });
  }
  render(ctx, game) {
    if (game.art.hasSprite('prop_barrier')) game.art.drawSprite(ctx, 'prop_barrier', Math.round(this.rx), Math.round(this.ry), { t: this.age, alpha: 1 - this.closing / 0.35 });
  }
  renderGlow(ctx) {
    const a = (0.35 + 0.15 * Math.sin(this.age * 6 + this.x)) * (1 - Math.min(1, this.closing / 0.35));
    const x = Math.round(this.rx) - 8, y = Math.round(this.ry) - 16;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#b05aff';
    ctx.fillRect(x, y, 16, 16);
    ctx.globalAlpha = a * 1.6;
    ctx.fillStyle = '#ffb8ff';
    for (let i = 0; i < 4; i++) ctx.fillRect(x + ((i * 5 + Math.floor(this.age * 12)) % 16), y + 2 + i * 3, 2, 1);
    ctx.globalAlpha = 1;
  }
}

/** Loose stone hiding a secret room. Interact (or blast it with a spell) to open. */
export class SecretWall extends Entity {
  constructor(x, y, { tx, ty, floor, onOpen }) {
    super(x, y);
    this.tx = tx;
    this.ty = ty;
    this.floor = floor;
    this.onOpen = onOpen;
    this.radius = 4;
    this.layer = 0;
    this.interactable = true;
    this.interactRadius = 12;
    this.interactPrompt = 'Loose stone?';
    this.opened = false;
  }
  open(game) {
    if (this.opened) return;
    this.opened = true;
    this.interactable = false;
    const map = game.level.map;
    map.setGround(this.tx, this.ty, this.floor);
    map.setDeco(this.tx, this.ty, 0);
    game.bus.emit(EV.CAMERA_SHAKE, { intensity: 3, duration: 0.3 });
    game.fx.emit('dust', this.x, this.y, { count: 24 });
    sfx(game, 'door');
    toast(game, 'A hidden passage grinds open!', '#ffd25a');
    this.onOpen?.(game);
    this.destroy();
  }
  interact(game) { this.open(game); }
  render(ctx) {
    // Hairline cracks on the wall face: subtle, but visible if you look.
    const x = Math.round(this.rx) - 8, y = Math.round(this.ry) - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 5, y + 4, 1, 3);
    ctx.fillRect(x + 6, y + 7, 1, 2);
    ctx.fillRect(x + 7, y + 9, 3, 1);
    ctx.fillRect(x + 10, y + 10, 1, 3);
  }
}

/** One-off quest object lying on the floor (e.g. Wren's lost tome). */
export class QuestItem extends Entity {
  constructor(x, y, { flag, sprite = 'prop_tome', text, color = '#ffd25a' }) {
    super(x, y);
    this.flag = flag;
    this.sprite = sprite;
    this.text = text;
    this.color = color;
    this.layer = 0;
    this.interactable = true;
    this.interactRadius = 14;
    this.interactPrompt = 'Pick up';
  }
  interact(game) {
    setFlag(game, this.flag, true);
    sfx(game, 'pickup', { pitch: 1.3 });
    game.fx.emit('sparkle', this.x, this.y - 4, { color: this.color, count: 16 });
    toast(game, this.text, this.color, 3.5);
    this.destroy();
  }
  renderGlow(ctx, game) {
    const y = Math.round(this.ry - 3 + Math.sin(this.age * 3) * 1.5);
    game.art.drawSprite(ctx, spriteOr(game, this.sprite, 'pickup_item'), Math.round(this.rx), y, { t: this.age, alpha: 0.95 });
  }
}

/** Readable signpost / plaque. */
export class Sign extends Entity {
  constructor(x, y, { onRead, prompt = 'Read' }) {
    super(x, y);
    this.radius = 5;
    this.mass = Infinity;
    this.pushable = true;
    this.interactable = true;
    this.interactRadius = 14;
    this.interactPrompt = prompt;
    this.onRead = onRead;
  }
  interact(game) { this.onRead(game); }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    if (game.art.hasSprite('prop_sign')) { game.art.drawSprite(ctx, 'prop_sign', x, y, { t: this.age }); return; }
    ctx.fillStyle = '#4a2e18';
    ctx.fillRect(x - 1, y - 9, 2, 9);
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(x - 6, y - 14, 12, 7);
    ctx.fillStyle = '#c89050';
    ctx.fillRect(x - 6, y - 14, 12, 1);
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(x - 4, y - 12, 8, 1);
    ctx.fillRect(x - 4, y - 10, 6, 1);
  }
}

// ------------------------------------------------------------------ the Mage Tower (decorative)

let towerCanvas = null;
function bakeTower() {
  if (towerCanvas || typeof document === 'undefined') return towerCanvas;
  const W = 72, H = 150;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // Body (slightly tapering), shaded left-to-right.
  for (let y = 26; y < H; y++) {
    const taper = Math.round((H - y) * 0.06);
    const x0 = 10 + taper, x1 = W - 10 - taper;
    for (let x = x0; x < x1; x++) {
      const t = (x - x0) / (x1 - x0);
      const band = (Math.floor((y - 26) / 6) + (Math.floor((x - x0) / 9) % 2)) % 2;
      const base = t < 0.25 ? 62 : t < 0.7 ? 78 : 54;
      const v = base + (band ? 6 : 0);
      g.fillStyle = `rgb(${v - 10},${v - 18},${v + 22})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  // Mortar lines.
  for (let y = 32; y < H; y += 6) R(12, y, W - 24, 1, 'rgba(20,10,40,0.45)');
  // Windows glowing violet.
  for (const [wx, wy] of [[33, 40], [24, 66], [42, 66], [33, 92], [24, 116], [42, 116]]) {
    R(wx - 1, wy - 1, 8, 12, '#1a0e2a');
    R(wx, wy, 6, 10, '#7a3aff');
    R(wx + 1, wy + 1, 4, 3, '#e8c8ff');
    R(wx + 2, wy, 2, 10, 'rgba(255,184,255,0.35)');
  }
  // Balcony ring.
  R(6, 84, W - 12, 4, '#3a2a5a');
  R(6, 84, W - 12, 1, '#8a7ab8');
  // Conical roof.
  for (let y = 0; y < 30; y++) {
    const half = Math.round((y / 30) * 34);
    for (let x = W / 2 - half; x < W / 2 + half; x++) {
      const t = (x - (W / 2 - half)) / Math.max(1, half * 2);
      g.fillStyle = t < 0.3 ? '#3a1a6a' : t < 0.75 ? '#5a2a9a' : '#2a1250';
      g.fillRect(x, y, 1, 1);
    }
  }
  R(W / 2 - 1, 0, 2, 4, '#ffd25a');
  R(4, 28, W - 8, 3, '#2a1250');
  // Corruption veins (the Archmage's taint).
  g.fillStyle = 'rgba(255,58,138,0.55)';
  for (const [x, y, h] of [[20, 40, 18], [50, 52, 26], [28, 100, 14], [46, 120, 20]]) for (let i = 0; i < h; i++) g.fillRect(x + Math.round(Math.sin(i * 0.7) * 2), y + i, 1, 1);
  towerCanvas = c;
  return c;
}

export class TowerSpire extends Entity {
  /** (x, y) = base centre (feet) of the tower. */
  constructor(x, y) {
    super(x, y);
    this.layer = 1;
    this.sortOffset = 0;
  }
  render(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    if (game.art.hasSprite('prop_mage_tower')) { game.art.drawSprite(ctx, 'prop_mage_tower', x, y, { t: this.age }); return; }
    const c = bakeTower();
    if (c) ctx.drawImage(c, x - (c.width >> 1), y - c.height);
  }
  renderGlow(ctx, game) {
    const x = Math.round(this.rx), y = Math.round(this.ry);
    const corrupted = !game.state.flags.archmageDefeated;
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(this.age * 1.7);
    ctx.fillStyle = corrupted ? '#ff3a8a' : '#7ad8ff';
    ctx.fillRect(x - 3, y - 152, 6, 8);
    ctx.globalAlpha = 0.08 + 0.05 * Math.sin(this.age * 1.3);
    ctx.fillRect(x - 12, y - 160, 24, 20);
    ctx.globalAlpha = 1;
  }
}
