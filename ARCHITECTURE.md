# Arcania Academy — Architecture & Team Contracts

A 2D top-down pixel-art spell-crafting RPG for the browser. Vanilla JS ES modules, Canvas 2D,
**zero runtime dependencies, zero asset files.** All art is generated procedurally, and all audio
is synthesised with WebAudio.

```
npm start            -> http://localhost:8080   (HOST=0.0.0.0 npm start to test on a phone over LAN)
npm test             -> check + combat-test + dungeon-test + world-flow + smoke + playthrough (all must pass)
npm run check        -> node --check on every .js file
npm run smoke        -> headless Chromium boot + input test, screenshots in ./screenshots/
npm run test:combat  -> scripts/combat-test.mjs   (plain Node: rules, AI, boss, balance bot)
npm run test:dungeon -> scripts/dungeon-test.mjs  (plain Node: 2700 generated maps, connectivity, spawns)
npm run test:flow    -> scripts/world-flow.mjs    (playwright: story mechanics)
npm run playthrough  -> scripts/playthrough.mjs   (playwright: the whole campaign on desktop + phone, section 12)
npm run perf         -> scripts/perf.mjs          (playwright: frame times under 4x CPU throttling)
```

Every stub in the repo works today: the game boots, and the title, hub, dungeon, tower, boss,
game-over, respawn and victory flow all run end to end. Each team **replaces the internals of
its own folder** and keeps the exported signatures in this document.

---

## 1. File ownership

| Owner | Folders / files | Notes |
|---|---|---|
| **core** (lead) | `index.html`, `css/`, `src/main.js`, `src/core/**`, `src/scenes/**`, `server.js`, `scripts/`, `package.json`, `ARCHITECTURE.md` | Engine, flow, scenes |
| **art+fx** | `src/art/**`, `src/fx/**` | Sprites, tiles, icons, backdrops, particles, lighting, flashes |
| **combat** | `src/combat/**` | Player entity, spells, recipes, items, enemies and AI, boss, damage, status effects, stats |
| **world** | `src/world/**` | Hub, dungeon generator, tower floors, boss arena, NPCs, dialogue content, doors, pickups |
| **ui+audio** | `src/ui/**`, `src/audio/**` | HUD, spell bar, panels (inventory, crafting, dialogue, menus), touch controls, pixel font, SFX and music |

### Rules
1. **Only edit files inside your own folders.** Inside them you may add, split, rename or
   delete files freely. Only `index.js` exports are contracts.
2. **Cross-team imports go through the other team's `src/<team>/index.js` only.** Never import
   another team's internal files. At runtime, prefer the instances on `game`
   (`game.combat.*`, `game.world.*`, `game.art.*`, `game.fx.*`, `game.ui.*`, `game.audio.*`).
   This avoids import cycles.
3. **Anyone may import anything from `src/core/`**, read-only.
4. **Need a core change** (new tile id, event, `game` field, input action, or a bug fix)? Append
   it to **`requests/<your-team>.md`**. Each team has its own file, so there are no merge conflicts.
   Core reviews and lands it. Until it lands, work around it inside your folder (for example, a
   team-prefixed private event).
5. **Never throw across a boundary for missing data.** Unknown sprite key: draw a placeholder.
   Unknown spell, item or enemy id: return `null` or fall back and `console.warn`. Core wraps every
   team call in `game.guard()`, so a bug logs (at most 3 times per site) instead of stopping the loop.
6. `npm test` (check, combat/dungeon/world tests, smoke and the full playthrough) must pass before you merge. The smoke test fails on **any**
   `console.error`, page error, 4xx/5xx response or failed request. Use `console.warn` for
   recoverable oddities.
7. Gameplay randomness uses the seeded RNG (`game.rng`, or `new RNG(seed)` / `rng.fork(label)`).
   `Math.random()` is only allowed for cosmetic effects (particles, shake, sfx pitch).
8. No external files of any kind (images, audio, fonts, JSON fetches). No runtime npm packages.
   `playwright` is a devDependency used only by `scripts/smoke.mjs`.

---

## 2. Units and conventions

| Thing | Unit |
|---|---|
| World position | **world pixels**. 1 world px = 1 virtual screen px (no zoom). |
| Tile | `TILE_SIZE = 16` world px. Tile coords `(tx, ty)`; `TileMap.tileCenter(tx,ty)` gives world px. |
| Entity `(x, y)` | **feet / ground-contact centre**. Sprites are anchored there and y-sorting uses it. |
| Time | **seconds**. `update(game, dt)` always gets `dt = FIXED_DT = 1/60`. |
| Speed | px / second. Angles are radians; 0 = +x (right) and +y points **down**. |
| Damage / HP / mana | plain numbers. Mana regen is mana per second. |
| Colours | CSS strings. Element colours come from `ELEMENT_COLORS[el] = [main, highlight]` (`core/config.js`). |
| Elements | `'fire' 'ice' 'lightning'` (core trio) `+ 'arcane' 'earth'` (optional). `'physical'` is used for non-elemental damage. |

**Virtual resolution.** The game renders into a low-res buffer (`game.display.width × height`)
that is integer-scaled to the screen. The short side is about 270 px (range 200–360). Examples:
1080p gives 480×270; a landscape phone gives about 633×292; a portrait phone gives about 292×633.
UI **must** lay out relative to `display.width/height` and respect `display.safe`
`{top,right,bottom,left}` (safe-area insets, already in virtual px). The buffer may overhang the
right and bottom screen edges by less than one virtual pixel.

`imageSmoothingEnabled` is false everywhere. Draw at integer coordinates (`Math.round`).

---

## 3. The `game` object (passed to every team function)

| Field | Type | Notes |
|---|---|---|
| `game.state` | object | Saved state (§7.1). **Replaced on new game or load, so never cache it.** |
| `game.settings` | object | `{masterVolume, musicVolume, sfxVolume, touchControls:'auto'\|'on'\|'off', screenShake, showFps, particleQuality:'low'\|'medium'\|'high'}`. Call `game.saveSettings()` after edits (it also calls `game.applySettings()`). |
| `game.bus` | `EventBus` | `on(type, fn, owner?) → off()`, `once`, `off`, `offOwner(owner)`, `emit(type, payload)` |
| `game.input` | `Input` | §5 |
| `game.camera` | `Camera` | `x,y` (view centre), `left,top` (valid during render), `shake(intensity, dur)`, `screenToWorld(sx,sy)`, `worldToScreen(wx,wy)`, `isVisible(x,y,margin)`, `viewW/viewH` |
| `game.display` | `Display` | `width,height` (virtual), `scale`, `dpr`, `safe`, `orientation`, `onResize(fn)`, `ctx` |
| `game.entities` | `EntityList` | `add(e)`, `get(id)`, `list`, `query(pred)`, `withTag(tag)`, `byTeam(team)`, `inRadius(x,y,r,pred?)`, `nearest(x,y,pred?,maxDist?)`, `count` |
| `game.level` | Level \| null | Current level (§7.5). null outside gameplay scenes. |
| `game.player` | Entity \| null | Current player entity |
| `game.interactTarget` | Entity \| null | Nearest interactable in range. Core maintains it; UI draws the prompt. |
| `game.rng` | `RNG` | Session RNG (`?seed=` makes it repeatable) |
| `game.time` | number | Simulated gameplay seconds (frozen while paused) |
| `game.realTime` | number | Seconds since boot (always advancing; use for menu animation) |
| `game.scenes` | `SceneManager` | Read `currentName`, `transitioning`. **Do not call `go()`. Emit events instead.** |
| `game.art` `game.combat` `game.world` | module namespaces | the teams' `index.js` exports |
| `game.fx` `game.ui` `game.audio` | instances | returned by `createFx` / `createUI` / `createAudio` |
| `game.after(sec, fn)` | | Scene-scoped timer (cleared on scene change, paused with the world) |
| `game.hitStop(sec)` | | Freeze world simulation briefly (max 0.2 s) |
| `game.isGameplay()` | bool | Is the current scene hub, dungeon, tower or boss? |
| `game.save(opts?)` | bool | Persist `game.state` (no-op before a game is started). `opts.auto` marks a background autosave (`GAME_SAVED {auto:true}`; the HUD skips its "saved" rune). |
| `game.saveDirty` | number | Seconds until a pending autosave. Core marks it after progress events (`FLAG_CHANGED`, `SPELL_LEARNED`, `SPELL_CRAFTED`, `LOADOUT_CHANGED`, `EQUIPMENT_CHANGED`, `INVENTORY_CHANGED`, `FRAGMENTS_CHANGED`, `DUNGEON_CLEARED`, `TOWER_FLOOR_CLEARED`) and saves about 1.5 s later; it also saves on `pagehide` and when the tab is hidden. |
| `game.applySettings()` | | Pushes core-wired settings into the modules (`particleQuality` -> `fx.setQualityCap`). Called by `saveSettings()` and at boot. |
| `game.guard(label, fn)` | | Run fn and log (rate-limited) instead of throwing |
| `game.params` | `URLSearchParams` | Debug URL params (§10) |
| `game.debug` | bool | Debug overlay on (F3 toggles) |

`window.game` is exposed for console debugging and the smoke test.

---

## 4. Team APIs (exports each team MUST keep)

All signatures are implemented in the current stubs. Return types are contractual.

### 4.1 art — `src/art/index.js`
```js
export const PALETTE                                  // named colours (free-form)
export async function initArt(game)                   // generate all canvases; called once before anything renders
export function hasSprite(key) -> boolean
export function getSprite(key) -> SpriteSheet          // never null: unknown keys get a cached placeholder
export function drawSprite(ctx, key, x, y, opts?)      // anchor at (x,y) = feet
//   opts: { anim='idle', t=0 (seconds into anim), frame?, flip=false, alpha=1, flash=0 (0..1 white hit overlay), scale=1 }
export function drawShadow(ctx, x, y, w=8)            // ground shadow at feet
export function drawIcon(ctx, key, x, y, opts?)        // 16x16, top-left; opts {size=16, alpha=1, disabled=false}
export function drawTile(ctx, tileId, px, py, variant, time, tx, ty, map)  // one 16x16 tile, top-left at (px,py)
export function drawBackdrop(ctx, name, w, h, t)       // full-screen menu backdrop: 'title'|'gameover'|'victory'
```
`SpriteSheet = { canvas, fw, fh, ax, ay, anims: { [name]: { frames:number[], fps, loop } } }`.
Frames sit in one horizontal strip, and `(ax, ay)` is the anchor inside a frame. Art may add
fields such as a precomputed flash canvas.

**Required animation names** for actors: `idle, walk, cast, attack, hurt, die`. Missing
animations fall back to `idle`. Facing is left/right via `flip`. The art direction is a
3/4 top-down view, and characters face right by default.

**Sprite keys art must provide** (anything else renders as a magenta placeholder):

| Group | Keys |
|---|---|
| Player | `player` (about 12×18) |
| NPCs | `npc_headmaster`, `npc_librarian`, `npc_alchemist`, `npc_duelmaster`, `npc_student` (+ any `NPCS[*].sprite` world adds) |
| Enemies | `enemy_knight`, `enemy_knight_captain`, `enemy_golem_stone`, `enemy_golem_ember`, `enemy_golem_frost` (+ any `ENEMIES[*].sprite` combat adds) |
| Boss | `boss_archmage` (about 20×28; anims also `phase2` optional) |
| Pickups | `pickup_fragment_<element>` for every element, `pickup_health`, `pickup_mana`, `pickup_item` |
| Props | `prop_portal`, `prop_tower_door`, `prop_stairs_up`, `prop_stairs_down`, `prop_forge`, `prop_chest` |
| Portraits (dialogue, 32×32 suggested) | `portrait_<npcId>`, `portrait_player` |
| Icons (via `drawIcon`) | `element_<el>`, `spell_<spellId>` (= `SPELLS[id].icon`), `item_<itemId>` (= `ITEMS[id].icon`), `ui_<name>` (UI asks via requests) |

Tiles: draw **every** id in `TILE` (`src/core/tiles.js`). Static tiles are baked into chunk caches
with `time = 0`. Tiles with `TILE_DEFS[id].animated` are redrawn every frame with the real
`time`. `variant` (0–255, seeded per cell) picks visual variations. `tx, ty, map` let you
auto-tile (for example, a wall edge against floor). Deco tiles draw over the ground tile and have
a transparent background, except `TORCH_WALL`, which sits on a wall. Tiles must stay within
16×16. Taller things (big trees, the tower) should be entities.

### 4.2 fx — `src/fx/index.js`
```js
export function createFx(game) -> Fx
Fx.emit(preset, x, y, opts?)       // particle burst, world px. presets: 'cast','trail','impact','aoe','death','pickup',
                                   //   'heal','portal','dust','sparkle','hit' (unknown -> 'sparkle')
                                   //   opts: {element, color, color2, count, angle, spread, speed, life, size, additive}
Fx.ring(x, y, radius, color, duration=0.35)        // expanding shockwave
Fx.addLight(x, y, radius, color, intensity=1)      // transient: lasts until the next fx.update; call every tick
Fx.attachLight(target, radius, color, intensity) -> {remove()}   // follows target until removed / target.dead
Fx.flash(color='#fff', duration=0.15, alpha=0.6)   // full-screen flash
Fx.update(dt)
Fx.renderGround(ctx, camera)        // world space, under entities (telegraphs, scorch decals)
Fx.renderLighting(ctx, camera, ambient)  // SCREEN space. ambient = level.ambient {darkness 0..1, color} or null
Fx.renderWorld(ctx, camera)         // world space, AFTER lighting, so particles glow through darkness
Fx.renderScreen(ctx)                // screen space overlays (flash, vignette)
Fx.clear()                          // called by core on every scene enter
Fx.count() -> number                // live particles (debug overlay)
Fx.setQuality(0.25..1) / Fx.quality // particle density; adapts automatically from frame time (touch devices start at 0.7)
Fx.setQualityCap(0.25..1)           // ceiling from settings.particleQuality (low 0.35 / medium 0.65 / high 1)
```
Extended spell visuals (`spellCast`, `spellTrail`, `spellImpact`, `telegraph`, `arc`, `decal`, `aura`, `dissolve`, `shine`,
`lightPulse`, `drawSpellOrb`) are documented in `requests/art-fx.md`. Entities tagged `projectile` get an automatic
elemental halo and trail; set `e.drawHeight` (px above the feet; combat projectiles use 6) so the halo lines up with the
sprite, or `e.noAutoFx = true` to opt out.
fx **subscribes to events itself** for the standard visuals: `SPELL_CAST`, `PROJECTILE_HIT`,
`AOE_TRIGGERED`, `ENTITY_DAMAGED`, `ENTITY_KILLED`, `PICKUP_COLLECTED`, `PLAYER_HEALED`,
`PLAYER_DAMAGED`, `SCREEN_FLASH`, and `LEVEL_READY` (scan tiles with `TILE_DEFS[id].light` to
build static lights). Combat calls fx directly **only** for continuous effects such as trails,
auras and projectile lights. Particles must stay cheap on mobile: cap the total (the stub uses 1200).

### 4.3 combat — `src/combat/index.js`
```js
export function initCombat(game)                         // subscribe to events (GAME_NEW seeding, stat recompute...)
export function createPlayer(game, x, y) -> Entity       // NOT added; core adds it. tag 'player', team 'player'
export function spawnEnemy(game, enemyId, x, y, opts?) -> Entity   // creates AND adds; opts {hpMult?, elite?}
export function spawnBoss(game, x, y) -> Entity          // creates AND adds the Corrupted Archmage; emits BOSS_SPAWNED
export function update(game, dt)                         // global per-tick logic (after entities)
export function castSpell(game, caster, spellId, dirX, dirY) -> boolean
export function damage(game, target, hit) -> number      // hit {amount, element, source, status?, knockback?}
export function applyStatus(game, target, status)        // status {type, duration, power}
export function computeStats(state)                      // writes derived player stats from base + equipment
export function findRecipe(elements[]) -> Recipe|null    // order-insensitive multiset match
export function canCraft(state, recipeId) -> {ok, reason}   // reason: 'unknown'|'known'|'locked'|'fragments'
export function craft(game, recipeId) -> {ok, spellId?, reason?}  // spends fragments, learns spell, emits events
export function useItem(game, itemId) -> boolean         // consumables
export function getSpell(id) / getItem(id) / getEnemyDef(id) -> def | null
export function listSpells() -> Spell[]                  // excludes hidden (enemy-only) spells
export function listRecipes() -> Recipe[]
export function listItems() -> Item[]
export function getCooldown(game, spellId) -> seconds    // player's remaining cooldown (for UI)
export const SPELLS, RECIPES, ITEMS, ENEMIES             // raw tables, read-only for other teams
// extras (landed from requests/combat.md)
export const FORMS, ESSENCES, REACTIONS, STATUS_INFO, WARD_COUNTER, GEAR_DROPS
export function recipeGrid() -> [{essence, recipes: [one per form]}]
export function getSpellPower(game, spellId) -> number
export function getDashCooldown(game) -> 0..1            // touch dash button
export function requestDash(game) -> bool               // programmatic dash (the 'dash' input action is the normal path)
```
- `findRecipe(elements[], form?)`: the optional form picks between recipes that share an element multiset. A repeated
  single element (`['fire','fire']`) falls back to the pure essence; pure essences have one input (`['fire']`).
- Spell extras: `form` ('bolt'|'volley'|'orb'|'arc'|'nova'|'rune'|'seekers'), `essence`, `colors`, `statuses[]`, `impact`,
  `burstDamage`, `jumps`. Recipe extras: `form`, `essence`, `tier`, `name`. `FORMS[id].name` is the display name.
- `spawnEnemy` opts: `{hpMult?, dmgMult?, elite?, affix?, noDrops?, aggro?, autoElite?, variety?}`. Difficulty scales from
  the scene being entered (dungeon depth / tower floor): +20% HP and +8% damage per level.
- Status types: `burn`, `chill` (build-up; 100 => `freeze`), `freeze`, `shock`, `blind`, `vulnerable`, `stun`, `slow`.
  The player only takes burn/chill/shock/slow.
- Entity fields other teams may read: enemy `elite`, `affix`, `displayName`, `state`, `wardEl`; boss `phase`,
  `phaseCount` (3), `ward` (element|null), `wardHp/wardMax`, `exposedT`, `invulnerable`.
- Enemies without line of sight (or walled off while seeing you) hunt the player along a short BFS tile path
  (`pathStep` in `combat/enemies.js`), so they never stall behind doorway corners.
- Combat emits `EV.SFX` `dash` (on dodge) and quiet `footstep`s while the player walks.
Combat **owns all player gameplay**: movement (`game.input.move`), mana regen, casting on
`spell1..4`, aiming, i-frames, death, and tile hazards (`TILE_DEFS.hazard`/`slow`). Player HP
and mana live in **`game.state.player.hp/mana`**, not on the entity. When player HP reaches 0,
combat must emit `PLAYER_DIED` exactly once. Core then handles game over and respawn.
When the boss dies, combat emits `BOSS_DEFEATED` and core runs the victory flow.
Enemy drops call `game.world.spawnPickup(game, kind, x, y, data)`.

Aiming (stub behaviour, which combat may change): use the mouse if it moved recently and the
last device was not touch. Otherwise use `input.getAim()`. With touch, auto-aim at the nearest
enemy within 160 px. Otherwise use the facing direction.

### 4.4 world — `src/world/index.js`
```js
export function initWorld(game)
export function buildLevel(game, spec) -> Level   // build map + populate game.entities (NOT the player)
export function update(game, dt)                  // per-tick world logic (after combat)
export function spawnPickup(game, kind, x, y, data?) -> Entity   // kind 'fragment'|'health'|'mana'|'item'; adds it
export function openNpcDialogue(game, npcId)      // emits DIALOGUE_OPEN for that NPC's current dialogue
export const NPCS, DIALOGUES, SPEAKERS
export function generateDungeon(seed, depth) -> { map, rooms, ... }   // pure & deterministic (testable)
export function getObjective(game) -> string     // one-line current story objective (HUD tracker + pause menu)
export function getDialogue(game, id) -> Dialogue // static or built (dynamic) dialogue by id
```
`spawnPickup` also accepts kind `'gear'` (an unowned staff/robe of the current tier, or arcane fragments).
`LevelSpec` (normalised by core before `buildLevel` is called):
- `{kind:'hub', from?: 'newGame'|'continue'|'respawn'|'dungeon'|'tower'|'debug'}`. `from` picks the spawn point.
- `{kind:'dungeon', depth:int>=1, seed:uint32, element?}`
- `{kind:'tower', floor: 1..TOWER_FLOORS}`
- `{kind:'boss'}`

World places enemies with `game.combat.spawnEnemy` and the boss with `game.combat.spawnBoss`.
Doors, portals and stairs emit `TRAVEL_REQUEST`. **World owns progression flags and tower
progress** (`state.tower.*`, `state.dungeon.*`, `state.flags`).
`TOWER_FLOORS` (config) is the number of normal floors. The top floor's exit travels to `'boss'`.

### 4.5 ui — `src/ui/index.js`
```js
export function createUI(game) -> UI
UI.update(dt)                 // every tick, BEFORE the scene. Handles pause/inventory/craft keys when no panel is open.
UI.render(ctx)                // screen space, every frame, after fx.renderScreen
UI.renderWorld(ctx, camera)   // world space (camera applied): damage numbers, interact prompt, enemy HP bars
UI.open(panel, data?)         // panels: 'title','pause','inventory','crafting','dialogue','gameover','victory' (+ any you add)
UI.close(panel?)              // closes the named panel (or the top one)
UI.isOpen(panel) -> bool
UI.current -> string|null
UI.blocksWorld() -> bool      // true while any modal panel is open: the world freezes
UI.toast(text, color?, duration?)
UI.drawText(ctx, text, x, y, opts?)   // bitmap font. opts {color, align:'left'|'center'|'right', scale, shadow, alpha}
UI.measureText(text, scale?) -> px
UI.wrapText(text, maxWidth, scale?) -> string[]
export { drawText, measureText, wrapText }
UI.findTarget(id) -> {x,y}|null   // virtual-px centre of a button (tests): panel hit ids, or 'touch:<action>'
UI.touchVisible -> bool          // are the on-screen touch controls showing?
```
The HUD shows the current objective (`world.getObjective`) under the vitals; it flashes when the objective changes and
on arrival at the Academy. Toasts wrap narrower or drop below it (and the minimap) so they never overlap. The pause menu
also shows the objective. Touch controls add a dash button (with cooldown sweep) and a potion button (with count).
Contract details:
- **While any panel is open, UI owns input.** After updating the top panel, call
  `input.consumeAll()` so nothing leaks into gameplay in the same tick (the stub does this).
- Menu panels emit `MENU_NEW_GAME`, `MENU_CONTINUE` (title, `data.canContinue`), `MENU_RESUME`,
  `MENU_QUIT_TO_TITLE` (pause and victory), and `MENU_RESPAWN` (game over). Core reacts. The UI
  only closes its own panels.
- Core opens and closes `title`, `gameover` and `victory` from the scenes. UI opens `pause`,
  `inventory` and `crafting` (design default: `C` opens crafting only in the hub, and the hub
  Forge station also opens it). UI opens `dialogue` in response to `DIALOGUE_OPEN` (§7.7).
- Touch controls are an `InputSource` (§5) that UI registers with `game.input.addSource()`.
  Show them when `settings.touchControls === 'on'`, or when it is `'auto'` and
  (`input.isTouchDevice || input.lastDevice === 'touch' || params.has('touch')`). Hide them when
  `!game.isGameplay() || ui.blocksWorld()`. Keep buttons at least 13 virtual px in radius
  (about 44 CSS px on phones).
- Every action must be reachable on touch: move, spell 1–4, interact, inventory, pause, and all
  menu interactions (tap). Read `input.pointerEvents` for taps. Pointers already claimed by touch
  controls have `input.pointers.get(id).claimedBy` set.

### 4.6 audio — `src/audio/index.js`
```js
export function createAudio(game) -> Audio
Audio.unlock()            // create/resume AudioContext. Core calls it on EVERY user gesture; must be idempotent & cheap
Audio.suspend() / Audio.resume()   // tab hidden/visible (core calls)
Audio.sfx(name, opts?)    // opts {volume=1, pitch=1}. Silently ignore unknown names / locked context
Audio.music(track)        // 'title'|'hub'|'dungeon'|'tower'|'boss'|'gameover'|'victory'|null. Core calls on scene enter (level.music)
Audio.applySettings()     // re-read game.settings volumes
Audio.setMuted(bool)
Audio.update(dt)          // every tick (music sequencer)
```
Audio **subscribes to events** for SFX (see the mapping in the stub) and also handles
`EV.SFX {name, volume?, pitch?, x?, y?}` requests from any team (`x, y` in world px give stereo pan and distance fade).
The full name list is `game.audio.names()` (57 names, e.g. `cast_<el> hit hit_armor hit_stone hit_boss enemy_die
enemy_die_armor enemy_die_golem player_hurt player_die boss_roar boss_die boss_phase pickup_fragment pickup_health
pickup_mana pickup_item potion equip unequip heal respawn gameover victory craft craft_add craft_charge learn fail type
banner toast door save clear dash footstep title_start ui_open ui_close ui_error ui_tab ui_slider ui_hover`). A spell's
`sfx` field picks its cast sound. DoT ticks (`dot: true`) play no hit sound. `?mute=1` starts muted.

---

## 5. Input

Actions (`ACTIONS` in `core/input.js`):
`up down left right spell1 spell2 spell3 spell4 interact confirm cancel inventory craft pause dash potion`

| Key | Actions |
|---|---|
| W/A/S/D, arrows | up/left/down/right (also menu navigation) |
| 1–4 (and numpad) | spell1–4 |
| E | interact |
| Space | interact + confirm |
| Enter | confirm |
| I, Tab | inventory |
| C | craft |
| Esc | pause + cancel |
| P | pause |
| Shift (either), right mouse button | dash (`MOUSEMAP` maps pointer buttons to actions) |
| Q | potion (quaff a Health Potion, else an Elixir) |
| Backspace | cancel |
| F3 | debug overlay (core) |

API: `input.down(a)`, `input.pressed(a)` (edge this tick), `input.released(a)`, `input.consume(a)`,
`input.consumeAll()`, `input.move` `{x,y}` (|v| ≤ 1, keyboard and analog merged), `input.getAim()`
(unit vector or null), `input.mouse` `{x,y,inside,down,moved,lastMoveTime}` in virtual screen px,
`input.pointers` (`Map<id,{id,x,y,startX,startY,startTime,pointerType,claimedBy}>`),
`input.pointerEvents` (`[{type:'down'|'move'|'up'|'cancel', id, x, y, pointerType, button}]` that
arrived since the last tick), `input.lastDevice` (`'keyboard'|'mouse'|'touch'`), `input.isTouchDevice`.

Input is sampled once per fixed tick, so quick taps are latched and never lost.

**InputSource contract** (touch, gamepad, and so on):
```js
{ id: string,
  poll?(input, dt),          // called at the start of every tick, before actions are computed
  getMove?() -> {x,y}|null,  // analog move; the strongest source wins over the keyboard
  isDown?(action) -> bool,   // held state; return true for one tick for taps that went down+up between ticks
  getAim?() -> {x,y}|null }  // optional aim direction
```

---

## 6. Event bus — names and payloads

Use the constants (`import { EV } from '../core/events.js'`), not raw strings. Payloads are
plain objects. **Team-private events must be prefixed with the folder name** (for example
`'world:secretFound'`), and other teams must not rely on them.

| Constant | Emitted by | Payload |
|---|---|---|
| `SCENE_CHANGED` | core | `{from, to, params}` |
| `TRAVEL_REQUEST` | anyone (doors, dialogue) | `{to:'hub'\|'dungeon'\|'tower'\|'boss', params}`. Core saves, fades and enters the scene. Ignored while the player is dead. |
| `LEVEL_READY` | core | `{level, spec}`, after `buildLevel` + player spawn |
| `GAME_NEW` | core | `{state}`. **Seed starting data here** (combat: gear, spells, loadout; world: flags) |
| `GAME_LOADED` | core | `{state}` |
| `GAME_SAVED` | core | `{ok, auto}` (`auto` = background autosave) |
| `SAVE_REQUEST` | anyone | `{}` |
| `HIT_STOP` | anyone | `{duration}` |
| `CAMERA_SHAKE` | anyone | `{intensity, duration}` (respects `settings.screenShake`) |
| `MENU_NEW_GAME` `MENU_CONTINUE` `MENU_RESUME` `MENU_QUIT_TO_TITLE` `MENU_RESPAWN` | ui | `{}` |
| `UI_OPENED` / `UI_CLOSED` | ui | `{panel, data}` / `{panel}` |
| `TOAST` | anyone | `{text, color?, duration?}` |
| `PLAYER_SPAWNED` | core | `{player}` |
| `PLAYER_DAMAGED` | combat | `{amount, element, source, hp, maxHp, dot}` |
| `PLAYER_HEALED` | combat / world | `{amount, hp, maxHp}` |
| `PLAYER_DIED` | combat | `{killer}`. Emit exactly once; core shows game over after 1.6 s |
| `PLAYER_RESPAWNED` | core | `{}`. HP and mana already restored |
| `STATS_CHANGED` | combat | `{stats}` (`= state.player` after `computeStats`) |
| `SPELL_CAST` | combat | `{caster, spellId, spell, x, y, dirX, dirY}` |
| `SPELL_FAILED` | combat | `{caster, spellId, reason:'mana'\|'cooldown'\|'empty'\|'locked'}` |
| `SPELL_LEARNED` | core state helper | `{spellId, crafted}` |
| `SPELL_CRAFTED` | combat | `{spellId, recipeId}` |
| `CRAFT_FAILED` | combat | `{recipeId, reason}` |
| `LOADOUT_CHANGED` | core state helper | `{slot, spellId, loadout}` |
| `PROJECTILE_HIT` | combat | `{projectile, target\|null, x, y, element}` (`target` is null on a wall hit or expiry) |
| `AOE_TRIGGERED` | combat | `{x, y, radius, element, spellId}` |
| `ENTITY_DAMAGED` | combat | `{target, amount, element, source, crit, x, y, reaction, blocked, dot}` (non-player targets; `reaction` is 'SHATTER', 'OVERLOAD', 'MELT', 'SUPERCONDUCT', 'QUENCH' or null) |
| `ENTITY_KILLED` | combat | `{target, killer, x, y}` |
| `ENEMY_SPAWNED` | combat | `{enemy, defId}` |
| `STATUS_APPLIED` / `STATUS_EXPIRED` | combat | `{target, status}` |
| `BOSS_SPAWNED` / `BOSS_PHASE` / `BOSS_DEFEATED` | combat | `{boss}` / `{boss, phase}` / `{boss}`. Core runs victory 3 s after defeat |
| `INTERACT` | core | `{target}` (after `target.interact(game)`) |
| `PICKUP_COLLECTED` | world | `{kind, element?, itemId?, amount, x, y}` |
| `FRAGMENTS_CHANGED` | core state helper | `{element, delta, total}` |
| `INVENTORY_CHANGED` | core state helper | `{itemId, delta, qty}` |
| `EQUIPMENT_CHANGED` | core state helper | `{slot, itemId, prev}` |
| `FLAG_CHANGED` | core state helper | `{key, value}` |
| `DIALOGUE_OPEN` | world | `{dialogueId, dialogue, npcId, speakers}` (§7.7) |
| `DIALOGUE_ACTION` | ui | `{action, npcId, dialogueId}` (world executes) |
| `DIALOGUE_CLOSED` | ui | `{npcId, dialogueId}` |
| `DUNGEON_CLEARED` | world | `{depth, seed}` |
| `TOWER_FLOOR_CLEARED` | world | `{floor}` |
| `SCREEN_FLASH` | anyone | `{color, duration, alpha}` |
| `SFX` | anyone | `{name, volume?, pitch?, x?, y?}` |
| `GAME_OVER` / `VICTORY` | core | `{}` (just before entering those scenes) |

Listeners run synchronously in subscription order. A throwing listener is logged and skipped.
All team modules are created once at boot, so they subscribe in `init*`/`create*` and never
need to unsubscribe. Per-level listeners should pass an `owner` and call `bus.offOwner(owner)`
in `level.onExit`.

---

## 7. Data shapes

### 7.1 Game state (`game.state`, saved to localStorage, created by `core/state.js`)
```js
{
  version: 1, createdAt, savedAt,
  player: { hp, mana,                                   // current (combat writes directly)
            maxHp, maxMana, manaRegen, spellPower, moveSpeed, cooldownMult?, elementPower?: {el: bonus},  // derived (computeStats)
            base: { maxHp:100, maxMana:100, manaRegen:5, spellPower:1, moveSpeed:80 } },
  fragments: { fire, ice, lightning, arcane, earth },   // ints
  inventory: [ { id: itemId, qty } ],                   // equipped items stay listed here
  equipped: { staff: itemId|null, robe: itemId|null },
  spells: { known: [spellId], crafted: [recipeId] },
  loadout: [spellId|null, x4],                          // keys 1..4
  flags: { [key]: any },                                // story flags (world owns the keys; §7.6)
  tower: { floors, currentFloor, highestFloor },
  dungeon: { runs, deepest, lastSeed },
  stats: { deaths, kills, spellsCast, playTime },
}
```
Mutate it through the **helpers in `core/state.js`** so that events fire: `addFragments`,
`hasFragments`, `spendFragments`, `addItem`, `removeItem`, `countItem`, `hasItem`, `equip`,
`unequip`, `learnSpell`, `knowsSpell`, `setLoadoutSlot`, `setFlag`, `getFlag`,
`checkRequirements`, `clampVitals`. Only plain JSON may go in the state (no entities, no Maps).
If a new field needs a default, add it through `requests/`. Saves are deep-merged over defaults,
so old saves stay valid.

`Requirement` (dialogue choices, doors, recipes): `{ flags?: {key: value}, notFlags?: [key],
items?: {itemId: qty}, fragments?: {el: n}, spells?: [spellId], towerFloor?: n }`. All present
clauses must pass. `checkRequirements(state, req)`.

### 7.2 Spell (combat `SPELLS[id]`)
```js
{ id, name, description, icon: 'spell_<id>', sfx: 'cast_<el>',
  elements: ['fire','ice'],      // crafting identity
  element: 'fire',               // damage type & colour
  tier: 1|2|3, hidden?: true,    // hidden = enemy-only
  kind: 'projectile'|'aoe'|'nova'|'self',
  manaCost, cooldown /*s*/, damage,
  // projectile: speed (px/s), range (px), radius, count, spread (rad), pierce
  // aoe/nova:   aoeRadius, delay (s telegraph), range (aoe placement distance)
  status: { type: 'burn'|'chill'|'shock'|..., duration, power } | null }
```
### 7.3 Recipe (combat `RECIPES[]`)
```js
{ id: 'r_steam_burst', inputs: ['fire','ice'] /* 2-3 elements, order-insensitive, repeats allowed */,
  cost: { fire: 3, ice: 3 }, result: spellId, hint: string, requires?: Requirement }
```
### 7.4 Item (combat `ITEMS[id]`) and Enemy (`ENEMIES[id]`)
```js
Item  { id, name, description, icon: 'item_<id>', rarity: 'common'|'rare'|'epic'|'legendary',
        slot: 'staff'|'robe'|'consumable'|'key'|'material',
        stats?: { maxHp, maxMana, manaRegen, spellPower, moveSpeed, cooldownMult, elementPower: {el: n} },
        use?: { heal?, mana? } }
Enemy { id, name, sprite, hp, speed, radius, mass, damage,
        attack: { type: 'melee'|'ranged', range, cooldown, windup, spellId? },
        aggroRange, ai: 'chaser'|'brute'|'ranged'|'boss', element,
        resist: { [el]: multiplier },   // missing = 1, 0 = immune, >1 = weak; a fusion hit uses the average over its elements
        drops: [ { kind: 'fragment'|'health'|'mana'|'item', element?, itemId?, chance, min, max } ],
        boss?: true }
```
Entity conventions used across teams: `e.team` (`'player'|'enemy'|'neutral'`; damage only applies
between different non-neutral teams), `e.hp/maxHp` (enemies), `e.tags` (`'player'`, `'enemy'`,
`'boss'`, `'projectile'`, `'aoe'`, `'npc'`, `'door'`, `'pickup'`, `'station'`), `e.def` (enemy def),
`e.element`, `e.statuses`, and `e.die(game, killer)`.

### 7.5 Level (returned by `world.buildLevel`) and tile map
```js
Level {
  kind: 'hub'|'dungeon'|'tower'|'boss', id: string, name: string,
  map: TileMap,                                 // required
  playerSpawn: { x, y },                        // world px (feet)
  music: 'hub'|'dungeon'|'tower'|'boss'|..., bgColor: css,
  ambient: { darkness: 0..1, color: css } | null,   // fx lighting (0 = fully lit)
  data?: any,
  onEnter?(game), onExit?(game), update?(game, dt),
  renderBelow?(ctx, game), renderAbove?(ctx, game)   // world space
}
```
`TileMap` (`core/tilemap.js`): `w, h` (tiles), `ground: Uint8Array`, `deco: Uint8Array` (0 = none),
`variant: Uint8Array` (0–255), `meta: {}`, `getGround/getDeco/setGround/setDeco/setVariant(tx,ty,..)`,
`fillRect(layer,tx,ty,w,h,id)`, `isSolid(tx,ty,mask='walk'|'shot')`, `isSolidAt(px,py,mask)`,
`defsAt(px,py)`, `randomizeVariants(rng)`, `forEach(fn)`, `findTiles(id,layer)`,
`static tileCenter(tx,ty)`, and `static fromStrings(rows, legend)` for ASCII-authored maps.
Out of bounds counts as solid. Index = `ty * w + tx`.

Tile ids and properties live in `core/tiles.js` (`TILE`, `TILE_DEFS[id] = {name, solid, blocksShot,
liquid, hazard:{element,dps}|null, slow, light:{radius,color,flicker}|null, animated}`).
`solid` blocks walking and `blocksShot` blocks projectiles and line of sight (so water is solid
but not `blocksShot`). New tiles go through requests.

### 7.6 Story flags (world owns the keys; others may read them)
All booleans, set through `setFlag`.
- Main arc: `metHeadmaster` -> `forgeGift` -> `firstCraft` (set on SPELL_CRAFTED) -> `reachedDepth<N>` (every depth entered)
  -> `dungeonCleared` / `clearedDepth<N>` -> `towerUnlocked` (Headmaster; needs `reachedDepth3` + `firstCraft`)
  -> `towerFloor<N>Cleared` (N = 1..5) -> `archmageDefeated` (set by core on victory).
- Side: `visitedLibrary`, `metArtificer`, `rivalMet`, `rivalBet`, `rivalBetWon`, `shyQuest`, `foundTome`, `shyQuestDone`,
  `catGift`, `corvinGift`, `artificerGift2`, `secretFound`. (`alchemistGift` is no longer used.)
- World also maintains `state.tower.highestFloor/currentFloor` (tier-3 recipes gate on `towerFloor`) and
  `state.dungeon.runs/deepest/lastSeed`. Tower stairs carry crafted-spell wards: floor 3 needs 1 crafted spell, floor 5 needs 2.
- Private world event: `world:buy {itemId, cost}` (quartermaster). Add new flags freely inside world and list them here.

### 7.7 Dialogue
```js
Dialogue { id, start: nodeId, nodes: { [nodeId]: Node } }
Node {
  speaker: npcId | 'player',
  text: string,
  next?: nodeId | null,                 // null/missing = end (when there are no choices)
  choices?: [ { text, next: nodeId|null, requires?: Requirement, actions?: Action[] } ],
  actions?: Action[]                    // fired when the node is ENTERED
}
Action = { type: 'setFlag', key, value? } | { type: 'giveItem', itemId, qty? } | { type: 'giveFragments', element, amount? }
       | { type: 'learnSpell', spellId } | { type: 'heal' } | { type: 'openPanel', panel, data? }
       | { type: 'travel', to, params? } | { type: 'emit', event, payload? }
NPC { id, name, sprite, portrait, dialogue(state) -> dialogueId }
```
Flow: an NPC entity's `interact()` triggers world, which emits `DIALOGUE_OPEN {dialogueId, dialogue,
npcId, speakers: {id: {name, portrait}}}`. UI renders it and walks the nodes, hiding choices whose
`requires` fails. UI emits `DIALOGUE_ACTION` for every action (node actions on enter, choice actions
on pick), and world executes them. `openPanel` and `travel` are deferred until `DIALOGUE_CLOSED`.

---

## 8. Frame structure

**Per fixed tick** (core, `core/game.js` + `scenes/world-scene.js`):
1. `input.update(dt)` (sources polled)
2. `ui.update(dt)`. If a panel is open it consumes input, and `blocksWorld()` freezes steps 4–12.
3. `scenes.update(dt)` (handles fades)
4. gameplay scenes only (skipped if `ui.blocksWorld()`, during fade-out, or during hit-stop):
5. `game.time += dt`, then timers
6. `level.update(game, dt)`
7. `entities.update(dt)` (each `e.update(game, dt)`; dead entities are removed at the end)
8. `entities.separate(map)` pushes apart `pushable` bodies (respects walls)
9. `combat.update(game, dt)`
10. `world.update(game, dt)`
11. interact: core finds `game.interactTarget` and calls `target.interact(game)` on `pressed('interact')`
12. `fx.update(dt)`, then `camera.update(dt)`
13. `audio.update(dt)`

**Render layering** (back to front). Steps marked [W] are in world space (camera applied); steps
marked [S] are in screen space.

| # | Layer | Owner |
|---|---|---|
| 1 | [S] clear with `level.bgColor` | core |
| 2 | [W] ground tiles (`art.drawTile`, chunk cached) | core/art |
| 3 | [W] deco tiles | core/art |
| 4 | [W] `level.renderBelow` | world |
| 5 | [W] `fx.renderGround` (telegraphs, decals) | fx |
| 6 | [W] entities, sorted by `layer` (0 ground, 1 actors, 2 air), then `y + sortOffset` | everyone's entities |
| 7 | [W] `level.renderAbove` | world |
| 8 | [S] `fx.renderLighting(ctx, camera, level.ambient)`: darkness and light mask | fx |
| 9 | [W] entity `renderGlow(ctx, game)` pass (composite `'lighter'`), then `fx.renderWorld` | combat/world/fx |
| 10 | [W] `ui.renderWorld` (damage numbers, prompts, HP bars) | ui |
| 11 | [S] `fx.renderScreen` (flash, vignette) | fx |
| 12 | [S] `ui.render` (HUD, touch controls, panels, toasts) | ui |
| 13 | [S] scene fade, debug overlay, then `display.present()` | core |

Entities: subclass `Entity` (`core/entity.js`). Draw at `Math.round(this.rx/ry)` (interpolated)
inside `render(ctx, game)`. Define `renderGlow(ctx, game)` as a **method** (not a class field) to
draw through darkness. Use `destroy()` to remove an entity, and `onAdd/onRemove` for setup and
teardown (for example `fx.attachLight` / `handle.remove()`). Set `interactable`, `interactRadius`
and `interactPrompt`, and implement `interact(game)`, to make an entity usable.

Physics (`core/physics.js`): `moveCircle(map, body, dx, dy, mask)` (sliding, anti-tunnelling) →
`{hit,nx,ny}`, `circleHitsTiles`, `raycastTiles(map,x0,y0,x1,y1,mask='shot')` →
`{hit,x,y,tx,ty,dist}`, `hasLineOfSight`, `circlesOverlap`, `separateCircles`, `pointInCircle`.
Math helpers are in `core/math.js` and the RNG (`RNG`, `hashString`) is in `core/rng.js`.

---

## 9. Game flow (core)

- **Title**: `ui.open('title', {canContinue})`. `MENU_NEW_GAME` creates a fresh state, emits
  `GAME_NEW`, saves, and enters the hub. `MENU_CONTINUE` loads, emits `GAME_LOADED`, and enters the hub.
- **Travel**: `TRAVEL_REQUEST` saves, fades out (0.3 s; the world freezes), runs `exit()` on the
  old scene, clears entities and fx, calls `world.buildLevel`, spawns the player, plays
  `audio.music(level.music)`, emits `LEVEL_READY` and `PLAYER_SPAWNED`, then fades in. Entering
  the hub autosaves.
- **Death**: `PLAYER_DIED` increments `stats.deaths`, then after 1.6 s the game-over scene opens.
  On `MENU_RESPAWN`, HP and mana are restored, `PLAYER_RESPAWNED` fires, the game saves, and the
  player returns to the hub with `{from:'respawn'}`. Inventory, fragments and spells are
  **kept** (a penalty, if any, is a combat/world design decision made by listening to
  `PLAYER_RESPAWNED`).
- **Victory**: `BOSS_DEFEATED` sets the flag `archmageDefeated` and saves. After 3 s the victory
  scene opens, and `MENU_QUIT_TO_TITLE` returns to the title.
- **Pause**: UI opens it. The world also auto-pauses when the tab is hidden.

## 10. Debug URL parameters
`?debug=1` (overlay, also F3) · `?scene=hub|dungeon|tower|boss` (fresh game, skip the title) ·
`?depth=N` · `?floor=N` · `?seed=N` · `?continue=1` · `?touch=1` (force touch controls with a
mouse) · `?mute=1` · `?debugbus=1` (log every event) · `?timescale=N` (simulate N x faster, max 16; rendering
is unaffected; used by the playthrough test). `game.loop.timeScale` and `game.loop.lastWorkMs` (update + render cost of
the last frame, ms) are exposed for tests.
Example: `http://localhost:8080/?scene=tower&floor=5&debug=1`.

## 11. Performance budget (mobile first)
Target 60 fps on a mid-range phone at about 633×292 virtual px. Avoid per-frame allocations in
hot loops. Cache generated canvases. Keep `createRadialGradient` usage modest (fx), keep particles
under about 1200, and keep entities under about 300. Static tiles are chunk-cached by core, so do
not redraw the map yourself.

## 12. End-to-end tests

`scripts/playthrough.mjs` plays the whole campaign in headless Chromium on a desktop viewport (1280x720, keyboard +
mouse) and a phone viewport (844x390 landscape, DPR 3, touch only): New Game from the title, walk to the Headmaster and
Forge-Master (keys / virtual joystick), talk, craft with the Forge UI, equip gear in the bag, cast / dash / quaff with real
inputs, crawl depths 1-3, die and respawn at the Academy, unlock the tower, reload and Continue, climb floors 1-5, defeat
the Corrupted Archmage and reach the victory screen. Long fights use `scripts/lib/bot.js`, an autopilot registered as an
InputSource (section 5), so it drives the same input pipeline as the keyboard and the touch controls and never edits state.
Screenshots go to `screenshots/_play/`. `scripts/perf.mjs` measures frame cost under DevTools CPU throttling (4x).
Run one viewport with `VP=desktop|phone`, watch it with `HEADED=1`, slow it with `TIMESCALE=2` (default 4). The bot's
deaths are real deaths (game over -> Rise Again -> healer), so a run usually dies several times before the Archmage
falls; the run fails only on a failed check, a console/page error, a failed request or a stall.
