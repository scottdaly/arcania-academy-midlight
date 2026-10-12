# Requests from art-fx

<!-- Append entries below (see README.md for the format). -->

## FX API: extended spell effects (status: done, informational)
- What: `game.fx` implements the full §4.2 contract (`emit, ring, addLight, attachLight, flash, update,
  renderGround, renderLighting, renderWorld, renderScreen, clear, count`) and adds the following methods.
  `els` is anything element-ish: `'fire'`, `['fire','ice']`, or a spell def with `.elements`/`.element`.
  Known elements: fire, ice, lightning, arcane, earth, physical, corrupt. Unknown elements fall back to arcane.
  Combos get extra signatures: steam (fire+ice), plasma (fire+lightning), storm (ice+lightning),
  magma (fire+earth), arcane mixes, and prismatic for 3+ elements.
  - `fx.spellCast(els, shape, x, y, {dirX, dirY, power})`: muzzle burst at the caster.
    `shape` is one of `'projectile' | 'aoe' | 'nova' | 'self' | 'beam'`.
  - `fx.spellTrail(els, shape, x, y, {dirX, dirY, power})`: call once per tick per projectile. Normally you do not
    need to call it, because it is automatic (see below).
  - `fx.spellImpact(els, shape, x, y, {radius, power, decal})`: hit burst. `'aoe'`/`'nova'` adds a shockwave,
    a ground decal (scorch, frost, burn, glyph, crack or corrupt) and a light pulse. Pass `decal: false` to skip the decal.
  - `fx.telegraph(x, y, radius, els, duration)`: a ground warning disc that fills over `duration`.
  - `fx.arc(x0, y0, x1, y1, els | '#color', {life, branches})`: jagged lightning arc.
  - `fx.decal(x, y, els | 'scorch'|'frost'|'burn'|'glyph'|'crack'|'corrupt', radius)`: fading ground mark.
  - `fx.aura(target, els, {rate, duration})` returns `{remove()}`: continuous elemental aura on an entity.
  - `fx.dissolve(spriteKey, x, y, {frame, flip, elements})`: the sprite breaks into its own pixels.
  - `fx.shine(x, y, color)`: level-up/equip style sparkle burst.
  - `fx.lightPulse(x, y, radius, color, intensity, duration)`: a timed light (unlike `addLight`, it needs no per-tick call).
  - `fx.drawSpellOrb(ctx, x, y, els, radius, t)`: glowing multi-element orb for `renderGlow` (use with 'lighter').
  - `fx.setQuality(0.25..1)` / `fx.quality`. Quality also adapts automatically from frame time; touch devices start at 0.7.
- Automatic behaviours (no call needed):
  - Entities tagged `projectile` get an elemental trail plus a halo from `e.spell.elements` (or `e.element`) and `e.vx/vy`.
  - `aoe` entities with `!fired && delay > 0` get a telegraph fill/rim.
  - STATUS_APPLIED/EXPIRED drive status auras (burn, chill, shock and so on).
  - Hits, kills (dissolve), pickups, heals, equips, crafts, boss spawn/phase/defeat and level clears all have effects.
  - Set `e.noAutoFx = true` on an entity to opt out.
- Legacy `fx.emit(preset, x, y, {element, ...})` still works. When an element is given, it uses that element's signature.

## combat: small hookups for nicer visuals   (status: open)
- What:
  1. Pass `{dir: 'up'|'down'|'side'}` to `art.drawSprite` for wizard-like sheets (sheets with `dirs: true`)
     and `{phase: 2}` for the boss. The player and boss fall back to `game.player.facingX/Y` and `boss.phase`.
  2. In `Projectile.renderGlow`, drop the square glow and call `game.fx.drawSpellOrb(ctx, x, y, spell.elements, r, age)`.
     The auto trail already exists, so the extra `fx.emit('trail', ...)` per tick doubles the particle count and can go.
  3. Attack/cast animations are one-shot. Draw them with `{anim: 'attack', t: ageSinceAttackStart}` so they start at frame 0.
  4. For bigger spells, `fx.spellCast(spell, spell.kind, x, y, {dirX, dirY})` and
     `fx.spellImpact(spell, spell.kind, x, y, {radius})` give each element/shape its signature look. The PROJECTILE_HIT,
     AOE_TRIGGERED and SPELL_CAST events already trigger these, so only call them for custom effects.
- Workaround: everything renders correctly without these changes. They are polish only.

## world: tile themes and sprite probes   (status: done, informational)
- `map.meta.biome` is read for tile themes: catacombs maps to crypt (mossy), crypts to frost, vaults to crystal and magma to magma.
  Tower and boss levels are themed from `level.kind`. `map.meta.theme` can also force one of
  `academy|crypt|magma|frost|crystal|tower|boss`.
- `art.hasSprite(key)` returns true for any generatable family:
  `npc_*`, `portrait_*`, `enemy_*`, `boss_*`, `familiar_*`, `pickup_fragment_*`, `prop_geode_*`.
  An unknown npc id becomes a seeded random student wizard; a key containing "cat" becomes a cat.
- Optional prop keys that exist: `prop_sign`, `prop_shrine`, `prop_barrier`, `prop_tome`, `prop_mage_tower`,
  `prop_portal`, `prop_tower_door`, `prop_stairs_up/down`, `prop_forge`, `prop_chest` (+ `open` anim), `prop_chest_open`,
  `prop_tree_big|blossom|apple`, `prop_crystal_ball`.

## art extras   (status: done, informational)
- `drawSprite` opts additionally accept `dir` and `phase`. Sheets can carry `dirs: true` or `phases: true`.
- `art.getSpritePixels(key, frame, max)` returns sampled `{x, y, c}` pixels (used by `fx.dissolve`).
- `art.tileTheme(map)` returns the resolved theme name.
- `drawIcon` handles `el_*`/element ids, `spell_*` (hand-drawn for known spells, composed from elements/kind for
  crafted ones) and item ids (staff/robe styled by keyword and rarity). UI keys: heart, mana, lock, gear, bag, book, star, close, check,
  arrow, coin, skull, scroll, map, sword, shield, hourglass, sound, music, pause, craft, fragment, potion, interact
  (+ aliases spellbook, inventory, settings, quest, hp, mp). Unknown keys get a rune glyph, never a blank.
