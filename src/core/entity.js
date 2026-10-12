// Entity base class + EntityList. Every dynamic thing in a level (player, enemies,
// projectiles, AoEs, NPCs, doors, pickups) is an Entity living in game.entities.
// Position (x, y) is the entity's FEET / ground-contact centre in world px (y-sorting uses it).
import { separateCircles } from './physics.js';

let nextId = 1;

export class Entity {
  constructor(x = 0, y = 0) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    /** Previous-tick position (for render interpolation). Managed by EntityList. */
    this.prevX = x;
    this.prevY = y;
    /** Interpolated render position, valid inside render(). Draw at Math.round(rx/ry). */
    this.rx = x;
    this.ry = y;
    this.vx = 0;
    this.vy = 0;
    /** Collision radius (world px). */
    this.radius = 6;
    /** 'player' | 'enemy' | 'neutral'. Damage only applies across different non-neutral teams. */
    this.team = 'neutral';
    /** Free-form tags, e.g. 'player', 'enemy', 'boss', 'projectile', 'npc', 'pickup', 'door'. */
    this.tags = new Set();
    /** Set true to remove at end of tick (use destroy()). */
    this.dead = false;
    /** Pushed apart from other pushable bodies by core each tick. */
    this.pushable = false;
    /** Mass for body separation (Infinity = immovable). */
    this.mass = 1;
    /** Render layer: 0 = ground decals, 1 = actors (default), 2 = air/overhead. */
    this.layer = 1;
    /** Added to y for depth sorting within a layer. */
    this.sortOffset = 0;
    this.visible = true;
    /** If true, core shows/handles the interact prompt when the player is within interactRadius. */
    this.interactable = false;
    this.interactRadius = 18;
    /** Short verb for the prompt, e.g. 'Talk', 'Enter', 'Craft'. */
    this.interactPrompt = '';
    /** Seconds since added. */
    this.age = 0;
    /** Optional hit points (combat convention). Player HP lives in game.state.player instead. */
    this.hp = 0;
    this.maxHp = 0;
  }

  /** Fixed-tick logic. dt = FIXED_DT. */
  update(game, dt) {}

  /** Draw in world space at Math.round(this.rx), Math.round(this.ry). */
  render(ctx, game) {}

  // Optional method (define it in a subclass; do NOT declare it as a class field):
  //   renderGlow(ctx, game) - drawn AFTER the lighting pass with globalCompositeOperation
  //   'lighter' already set, so it glows through darkness. Projectile cores, auras, etc.

  /** Called when the player interacts (interactable entities only). */
  interact(game) {}

  /** Lifecycle hooks. */
  onAdd(game) {}
  onRemove(game) {}

  destroy() {
    this.dead = true;
  }

  hasTag(t) {
    return this.tags.has(t);
  }
}

export class EntityList {
  constructor(game) {
    this.game = game;
    /** @type {Entity[]} */
    this.list = [];
    this._pending = [];
    this._updating = false;
    this._byId = new Map();
    this._sorted = [];
  }

  get count() {
    return this.list.length;
  }

  /** Add an entity (safe to call during update; it joins at the end of the tick). Returns it. */
  add(e) {
    if (this._updating) this._pending.push(e);
    else this._insert(e);
    return e;
  }

  _insert(e) {
    e.prevX = e.x;
    e.prevY = e.y;
    this.list.push(e);
    this._byId.set(e.id, e);
    try {
      e.onAdd(this.game);
    } catch (err) {
      console.error('[entities] onAdd threw', err);
    }
  }

  get(id) {
    return this._byId.get(id) || null;
  }

  /** Remove everything immediately (scene change). */
  clear() {
    for (const e of this.list) {
      try { e.onRemove(this.game); } catch (err) { console.error('[entities] onRemove threw', err); }
    }
    this.list.length = 0;
    this._pending.length = 0;
    this._byId.clear();
  }

  update(dt) {
    const game = this.game;
    for (const e of this.list) {
      e.prevX = e.x;
      e.prevY = e.y;
    }
    this._updating = true;
    for (const e of this.list) {
      if (e.dead) continue;
      try {
        e.update(game, dt);
      } catch (err) {
        console.error(`[entities] update threw for ${e.constructor.name}#${e.id}`, err);
        e.dead = true;
      }
      e.age += dt;
    }
    this._updating = false;
    this._sweep();
    if (this._pending.length) {
      const p = this._pending;
      this._pending = [];
      for (const e of p) this._insert(e);
    }
  }

  _sweep() {
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead) {
        this._byId.delete(e.id);
        try { e.onRemove(this.game); } catch (err) { console.error('[entities] onRemove threw', err); }
      } else this.list[w++] = e;
    }
    this.list.length = w;
  }

  /** Push overlapping `pushable` bodies apart (respecting walls if map given). */
  separate(map) {
    const arr = this.list;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.pushable || a.dead) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.pushable || b.dead) continue;
        separateCircles(a, b, map);
      }
    }
  }

  /** Draw all visible entities sorted by layer then y. ctx in world space. */
  render(ctx, alpha, camera) {
    const s = this._sorted;
    s.length = 0;
    for (const e of this.list) {
      e.rx = e.prevX + (e.x - e.prevX) * alpha;
      e.ry = e.prevY + (e.y - e.prevY) * alpha;
      if (e.visible && camera.isVisible(e.rx, e.ry, 48)) s.push(e);
    }
    s.sort((a, b) => a.layer - b.layer || (a.ry + a.sortOffset) - (b.ry + b.sortOffset) || a.id - b.id);
    for (const e of s) {
      try {
        e.render(ctx, this.game);
      } catch (err) {
        console.error(`[entities] render threw for ${e.constructor.name}#${e.id}`, err);
        e.visible = false;
      }
    }
  }

  /** Additive glow pass (only entities with a renderGlow function). Call after render(). */
  renderGlow(ctx) {
    for (const e of this._sorted) {
      if (typeof e.renderGlow !== 'function') continue;
      try {
        e.renderGlow(ctx, this.game);
      } catch (err) {
        console.error(`[entities] renderGlow threw for ${e.constructor.name}#${e.id}`, err);
        e.renderGlow = null;
      }
    }
  }

  // ---------------------------------------------------------------- queries

  query(pred) {
    return this.list.filter((e) => !e.dead && pred(e));
  }

  withTag(tag) {
    return this.list.filter((e) => !e.dead && e.tags.has(tag));
  }

  byTeam(team) {
    return this.list.filter((e) => !e.dead && e.team === team);
  }

  /** Entities whose circle overlaps the circle (x, y, r). */
  inRadius(x, y, r, pred = null) {
    const out = [];
    for (const e of this.list) {
      if (e.dead || (pred && !pred(e))) continue;
      const rr = r + (e.radius || 0);
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= rr * rr) out.push(e);
    }
    return out;
  }

  /** Nearest entity (centre distance) matching pred within maxDist, or null. */
  nearest(x, y, pred = null, maxDist = Infinity) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.list) {
      if (e.dead || (pred && !pred(e))) continue;
      const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; best = e; }
    }
    return best;
  }
}
