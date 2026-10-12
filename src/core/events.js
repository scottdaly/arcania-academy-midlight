// Event bus + canonical event names. Payload shapes are documented in ARCHITECTURE.md §6.
// Team-private events are allowed but MUST be prefixed with the team folder name,
// e.g. 'world:secretFound', 'combat:comboReset', 'ui:tabChanged', 'fx:..', 'audio:..', 'art:..'.

export const EV = Object.freeze({
  // ---- flow / scenes (emitted by core unless noted) ----
  SCENE_CHANGED: 'scene:changed', //        {from, to, params}
  TRAVEL_REQUEST: 'travel:request', //      {to, params}            <- anyone (world doors, dialogue)
  LEVEL_READY: 'level:ready', //            {level, spec}
  GAME_NEW: 'game:new', //                  {state}                 teams seed starting data here
  GAME_LOADED: 'game:loaded', //            {state}
  GAME_SAVED: 'game:saved', //              {ok}
  SAVE_REQUEST: 'save:request', //          {}                      <- anyone
  HIT_STOP: 'core:hitStop', //              {duration}              <- anyone (combat)
  CAMERA_SHAKE: 'camera:shake', //          {intensity, duration}   <- anyone

  // ---- menus (emitted by ui; handled by core) ----
  MENU_NEW_GAME: 'menu:newGame', //         {}
  MENU_CONTINUE: 'menu:continue', //        {}
  MENU_RESUME: 'menu:resume', //            {}
  MENU_QUIT_TO_TITLE: 'menu:quitToTitle', //{}
  MENU_RESPAWN: 'menu:respawn', //          {}
  UI_OPENED: 'ui:opened', //                {panel, data}
  UI_CLOSED: 'ui:closed', //                {panel}
  TOAST: 'ui:toast', //                     {text, color?, duration?}  <- anyone; ui displays

  // ---- player (emitted by combat) ----
  PLAYER_SPAWNED: 'player:spawned', //      {player}                (core)
  PLAYER_DAMAGED: 'player:damaged', //      {amount, element, source, hp, maxHp}
  PLAYER_HEALED: 'player:healed', //        {amount, hp, maxHp}
  PLAYER_DIED: 'player:died', //            {killer}
  PLAYER_RESPAWNED: 'player:respawned', //  {}                      (core)
  STATS_CHANGED: 'stats:changed', //        {stats}                 derived stats recomputed

  // ---- spells & combat (emitted by combat) ----
  SPELL_CAST: 'spell:cast', //              {caster, spellId, spell, x, y, dirX, dirY}
  SPELL_FAILED: 'spell:failed', //          {caster, spellId, reason: 'mana'|'cooldown'|'empty'|'locked'}
  SPELL_LEARNED: 'spell:learned', //        {spellId, crafted}      (core state helper)
  SPELL_CRAFTED: 'spell:crafted', //        {spellId, recipeId}
  CRAFT_FAILED: 'craft:failed', //          {recipeId, reason}
  LOADOUT_CHANGED: 'loadout:changed', //    {slot, spellId, loadout} (core state helper)
  PROJECTILE_HIT: 'projectile:hit', //      {projectile, target|null, x, y, element}
  AOE_TRIGGERED: 'aoe:triggered', //        {x, y, radius, element, spellId}
  ENTITY_DAMAGED: 'entity:damaged', //      {target, amount, element, source, crit, x, y}
  ENTITY_KILLED: 'entity:killed', //        {target, killer, x, y}
  ENEMY_SPAWNED: 'enemy:spawned', //        {enemy, defId}
  STATUS_APPLIED: 'status:applied', //      {target, status}
  STATUS_EXPIRED: 'status:expired', //      {target, status}
  BOSS_SPAWNED: 'boss:spawned', //          {boss}
  BOSS_PHASE: 'boss:phase', //              {boss, phase}
  BOSS_DEFEATED: 'boss:defeated', //        {boss}

  // ---- world / progression ----
  INTERACT: 'world:interact', //            {target}                (core, after target.interact)
  PICKUP_COLLECTED: 'pickup:collected', //  {kind, element?, itemId?, amount, x, y}   (world)
  FRAGMENTS_CHANGED: 'fragments:changed', //{element, delta, total} (core state helper)
  INVENTORY_CHANGED: 'inventory:changed', //{itemId, delta, qty}    (core state helper)
  EQUIPMENT_CHANGED: 'equipment:changed', //{slot, itemId, prev}    (core state helper)
  FLAG_CHANGED: 'flag:changed', //          {key, value}            (core state helper)
  DIALOGUE_OPEN: 'dialogue:open', //        DialogueOpenPayload     (world -> ui)
  DIALOGUE_ACTION: 'dialogue:action', //    {action, npcId, dialogueId}   (ui -> world)
  DIALOGUE_CLOSED: 'dialogue:closed', //    {npcId, dialogueId}     (ui)
  DUNGEON_CLEARED: 'dungeon:cleared', //    {depth, seed}           (world)
  TOWER_FLOOR_CLEARED: 'tower:floorCleared', // {floor}            (world)

  // ---- presentation requests (anyone may emit) ----
  SCREEN_FLASH: 'fx:flashRequest', //       {color, duration, alpha}
  SFX: 'audio:sfxRequest', //               {name, volume?, pitch?, x?, y?}

  // ---- endings (core) ----
  GAME_OVER: 'game:over', //                {}
  VICTORY: 'game:victory', //               {}
});

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<{fn: Function, owner: any, once: boolean}>>} */
    this._map = new Map();
    this.debug = false;
  }

  /**
   * Subscribe. Returns an unsubscribe function.
   * `owner` (optional) lets you remove a group of listeners at once with offOwner(owner).
   */
  on(type, fn, owner = null) {
    return this._add(type, fn, owner, false);
  }

  /** Like on(), but auto-removes after the first call. */
  once(type, fn, owner = null) {
    return this._add(type, fn, owner, true);
  }

  _add(type, fn, owner, once) {
    if (typeof fn !== 'function') throw new TypeError(`bus.on("${type}"): listener must be a function`);
    let set = this._map.get(type);
    if (!set) this._map.set(type, (set = new Set()));
    const rec = { fn, owner, once };
    set.add(rec);
    return () => set.delete(rec);
  }

  off(type, fn) {
    const set = this._map.get(type);
    if (!set) return;
    for (const rec of set) if (rec.fn === fn) set.delete(rec);
  }

  offOwner(owner) {
    for (const set of this._map.values()) for (const rec of set) if (rec.owner === owner) set.delete(rec);
  }

  /** Synchronous dispatch. A throwing listener is logged and does not break other listeners. */
  emit(type, payload = {}) {
    if (this.debug) console.debug('[bus]', type, payload);
    const set = this._map.get(type);
    if (!set || set.size === 0) return;
    for (const rec of [...set]) {
      if (rec.once) set.delete(rec);
      try {
        rec.fn(payload, type);
      } catch (err) {
        console.error(`[bus] listener for "${type}" threw:`, err);
      }
    }
  }

  listenerCount(type) {
    return this._map.get(type)?.size ?? 0;
  }
}
