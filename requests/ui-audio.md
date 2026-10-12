# Requests from ui-audio

<!-- Append entries below (see README.md for the format). -->

## `particleQuality` setting default            (status: open)
- What: settings default
- Why: the Settings menu has a Particles Low/Medium/High option; fx should scale emit counts / particle cap from it.
- Proposed shape: `DEFAULT_SETTINGS.particleQuality = 'high'` ('low'|'medium'|'high'); fx reads `game.settings.particleQuality` (suggest x0.35 / x0.65 / x1).
- Workaround in the meantime: UI treats a missing value as 'high' and saves it with the other settings.

## `dash` input action                          (status: open)
- What: new input action `dash` (e.g. Shift / Space-free key; right mouse?)
- Why: brief asks for a touch dash button; touch controls already render one automatically when `ACTIONS` includes `'dash'`. Combat would own the movement.
- Proposed shape: `ACTIONS += 'dash'`, `KEYMAP.ShiftLeft/ShiftRight = ['dash']`; combat emits `EV.SFX {name:'dash'}` (or a new `PLAYER_DASHED {}` event) so audio can play it.
- Workaround in the meantime: no dash button is shown.

## `SFX` payload and SFX name list in docs       (status: open)
- What: docs only
- Why: audio uses optional `x, y` (world px) in `EV.SFX` for stereo pan / distance fade; §4.6 name list is out of date.
- Proposed shape: §6 `SFX {name, volume?, pitch?, x?, y?}`; §4.6 names = `game.audio.names()` (57 names incl. hit_armor, hit_stone, enemy_die_armor, enemy_die_golem, boss_roar, boss_die, craft_add, craft_charge, learn, type, banner, toast, ui_open/close/error/tab/slider/hover, pickup_fragment/health/mana/item, potion, equip, unequip, heal, respawn, gameover, title_start, dash, footstep, save, clear).

## `ui.findTarget(id)` for tests                (status: open, FYI)
- What: new non-contract UI method, used by scripts/smoke.mjs
- Why: the mobile smoke test now taps `ui.findTarget('new-game')` and `ui.findTarget('touch:spell1')` (virtual px centres) instead of hard-coding UI geometry.
- Proposed shape: document in §4.5: `UI.findTarget(id) -> {x,y}|null`; also `UI.touchVisible`.

## Requests for other teams (relayed via core)   (status: open)
- combat: `e.elite = true` on elite enemies (gold HP-bar edge); `boss.phaseCount` (HUD assumes 3); optional `FORMS` display names export (crafting shows recipe.form with a local label map); consider `learnSpell(..., {autoSlot:false})` when crafting since the craft screen offers a "Bind to slot" step; emit `EV.SFX {name:'dash'|'footstep'}` if those exist.
- world: dialogue `giveItem` toasts the raw id ("Received potion_health") — UI now drops it because the HUD shows "Found: <name>" from INVENTORY_CHANGED; the dungeon's own "Depth N: ..." toast duplicates the UI area banner (consider removing).
- art: portraits for any new NPC ids (`portrait_<npcId>`); missing ones get a silhouette placeholder. A `talk` anim on portrait sheets is used automatically.
