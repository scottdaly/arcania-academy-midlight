# Requests from combat

<!-- Append entries below (see README.md for the format). -->

## Input action `dash`            (status: open)
- What: new input action `dash` — keys ShiftLeft/ShiftRight, right mouse button; a touch button (UI).
- Why: the dodge-dash (0.17 s, 0.24 s i-frames, 0.85 s cooldown) is core to reading telegraphs and the boss's patterns.
- Proposed shape: `ACTIONS += 'dash'`, `KEYMAP.ShiftLeft = ['dash']`, `KEYMAP.ShiftRight = ['dash']`; core maps pointer button 2 to `dash`.
- Workaround in the meantime: combat listens for Shift keydown itself and reads `input.pointerEvents` for button 2.
  It already honours `input.pressed('dash')` as soon as the action exists. Touch UI can call
  `game.combat.requestDash(game)` and draw cooldown from `game.combat.getDashCooldown(game)` (0..1).

## Input action `potion`          (status: open)
- What: new input action `potion` (key Q; touch button) = quaff a Health Potion (falls back to Elixir).
- Why: healing mid-fight without opening the inventory panel (the world freezes while it is open, which is fine but slow).
- Proposed shape: `ACTIONS += 'potion'`, `KEYMAP.KeyQ = ['potion']`.
- Workaround in the meantime: combat listens for KeyQ itself and honours `input.pressed('potion')` when it lands.

## Contract doc updates (ARCHITECTURE.md §4.3 / §6 / §7)   (status: open)
- `findRecipe(elements[], form?)`: optional 2nd arg picks the delivery form; several recipes share an element
  multiset (one per form). A repeated single element (`['fire','fire']`) falls back to the pure essence.
  Pure essences have ONE input element (`inputs: ['fire']`); Void uses `['arcane','arcane','arcane']`.
- Spell extras: `form` ('bolt'|'volley'|'orb'|'arc'|'nova'|'rune'|'seekers'), `essence`, `colors [main, highlight]`,
  `statuses []` (all statuses per hit; `status` stays = first), `impact`, `burstDamage` (orbs), `jumps` (arcs).
- Recipe extras: `form`, `essence`, `tier`, `name`.
- New combat exports: `FORMS`, `ESSENCES`, `REACTIONS`, `STATUS_INFO`, `WARD_COUNTER`, `GEAR_DROPS`,
  `recipeGrid()`, `getSpellPower(game, spellId)`, `getDashCooldown(game)`, `requestDash(game)`.
- `spawnEnemy` opts: `{hpMult?, dmgMult?, elite?, affix?, noDrops?, aggro?, autoElite?, variety?}`. Difficulty
  scales automatically from the scene being entered (dungeon depth / tower floor): +20% HP, +8% dmg per level.
- Status types: `burn` (power = dmg/0.5 s), `chill` (power = build-up; 100 => `freeze`), `freeze`, `shock`,
  `blind`, `vulnerable` (power = +dmg taken), `stun`, `slow` (power = fraction). Player only takes burn/chill/shock/slow.
- Event payload extras: `ENTITY_DAMAGED {..., reaction: 'SHATTER'|'OVERLOAD'|'MELT'|'SUPERCONDUCT'|'QUENCH'|null, blocked, dot}`,
  `PLAYER_DAMAGED {..., dot}`. Enemy-drop kind `'gear'` is resolved inside combat (spawnPickup gets `'item'`).
- Private events (FYI, may change): `combat:reaction {target, reaction, x, y}`, `combat:dash`, `combat:dodge`,
  `combat:bossWard {boss, element, counter}`, `combat:bossWardBroken {boss, element}`.
- Entity fields other teams may read: enemy `elite`, `affix`, `displayName`, `state`, `wardEl`; boss `phase`,
  `ward` (element|null), `wardHp/wardMax`, `exposedT`, `invulnerable`.

## SFX name `dash`                (status: open — for ui-audio)
- What: combat emits `EV.SFX {name:'dash'}` on dodge. Currently silently ignored.
- Also: DoT ticks emit `ENTITY_DAMAGED` with `dot: true` (and `PLAYER_DAMAGED` with `dot: true`); audio/ui may want to
  skip the 'hit' sound / big damage numbers for those.
