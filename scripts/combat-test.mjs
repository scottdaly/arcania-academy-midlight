// Headless combat test (team: combat). `node scripts/combat-test.mjs`
// Exercises the spellbook, crafting, stats, reactions, enemy AI and the boss without a browser,
// using a minimal fake `game`. Also runs a crude auto-play bot for a balance read-out.
import { EventBus, EV } from '../src/core/events.js';
import { EntityList } from '../src/core/entity.js';
import { TileMap } from '../src/core/tilemap.js';
import { TILE } from '../src/core/tiles.js';
import { RNG } from '../src/core/rng.js';
import { createNewState, equip, addItem, addFragments, setLoadoutSlot, learnSpell } from '../src/core/state.js';
import * as combat from '../src/combat/index.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const DT = 1 / 60;

function makeGame(scene = 'dungeon', params = { depth: 1 }, seed = 7) {
  const bus = new EventBus();
  const timers = [];
  const drops = [];
  const pressed = new Set(), held = new Set();
  const input = {
    move: { x: 0, y: 0 }, mouse: { inside: false }, pointerEvents: [], lastDevice: 'keyboard',
    pressed: (a) => pressed.has(a), down: (a) => held.has(a), getAim: () => game._aim || null,
  };
  const noop = () => null;
  const game = {
    bus, rng: new RNG(seed), time: 0, state: createNewState(), level: null, player: null,
    scenes: { currentName: scene, params },
    fx: new Proxy({}, { get: () => noop }),
    art: { hasSprite: () => true, getSprite: () => ({ ay: 16, anims: {} }), drawSprite() {}, drawShadow() {} },
    ui: { drawText() {} }, input, camera: { screenToWorld: (x, y) => ({ x, y }) },
    world: { spawnPickup: (g, kind, x, y, data) => drops.push({ kind, ...data }) },
    after(sec, fn) { timers.push({ t: game.time + sec, fn }); },
    hitStop() {}, combat, drops, pressed, held, guard: (l, f) => f(),
  };
  game.entities = new EntityList(game);
  const map = new TileMap(34, 26, TILE.DUNGEON_WALL);
  map.fillRect('ground', 1, 1, 32, 24, TILE.DUNGEON_FLOOR);
  game.level = { map };
  combat.initCombat(game);
  bus.emit(EV.GAME_NEW, { state: game.state });
  game.step = () => {
    game.time += DT;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= game.time) { const t = timers.splice(i, 1)[0]; t.fn(); }
    game.entities.update(DT);
    game.entities.separate(map);
    combat.update(game, DT);
    pressed.clear();
  };
  return game;
}

function addPlayer(game, x = 270, y = 300) {
  const p = combat.createPlayer(game, x, y);
  game.entities.add(p);
  game.player = p;
  return p;
}

// ------------------------------------------------------------------ 1. spellbook
console.log('\n[spellbook]');
{
  const spells = combat.listSpells();
  const recipes = combat.listRecipes();
  ok(spells.length >= 80, `${spells.length} craftable spells`);
  ok(recipes.length === spells.length, `${recipes.length} recipes (one per spell)`);
  ok(recipes.every((r) => combat.getSpell(r.result)), 'every recipe result exists');
  ok(new Set(recipes.map((r) => r.id)).size === recipes.length, 'recipe ids unique');
  ok(combat.findRecipe(['ice', 'fire'], 'orb')?.result === 'steam_orb', 'fire+ice orb = Steam Burst');
  ok(combat.findRecipe(['lightning', 'fire'], 'bolt')?.result === 'plasma_bolt', 'fire+lightning bolt = Plasma Lance');
  ok(combat.findRecipe(['lightning', 'ice'], 'arc')?.result === 'shatter_arc', 'ice+lightning arc = Shatterstorm');
  ok(combat.findRecipe(['fire', 'fire'])?.essence === 'fire', 'repeated element falls back to pure essence');
  ok(combat.findRecipe(['fire', 'ice', 'lightning'], 'nova')?.requires, 'triple combos are locked behind progress');
  ok(combat.findRecipe(['water']) === null, 'unknown element -> null');
  const fb = combat.getSpell('firebolt');
  ok(fb && fb.manaCost > 0 && fb.cooldown > 0 && fb.damage > 0 && fb.kind === 'projectile', `firebolt: ${fb.damage} dmg, ${fb.manaCost} mana, ${fb.cooldown}s`);
  const tiers = [1, 2, 3].map((t) => recipes.filter((r) => r.tier === t).length);
  console.log('       tiers:', tiers.join(' / '), ' sample costs:', ['r_fire_orb', 'r_steam_orb', 'r_prismatic_nova'].map((id) => `${id}=${JSON.stringify(recipes.find((r) => r.id === id)?.cost)}`).join(' '));
}

// ------------------------------------------------------------------ 2. new game, stats, crafting
console.log('\n[new game / stats / crafting]');
{
  const game = makeGame('hub');
  const s = game.state;
  ok(s.loadout.join() === 'firebolt,frost_shard,spark,', `starting loadout ${s.loadout.join(',')}`);
  ok(s.equipped.staff === 'staff_apprentice' && s.equipped.robe === 'robe_novice', 'starting gear equipped');
  ok(s.player.manaRegen === 6, `mana regen from gear = ${s.player.manaRegen}`);
  addItem(game, 'staff_ember', 1);
  equip(game, 'staff', 'staff_ember');
  ok(Math.abs(s.player.spellPower - 1.1) < 1e-9 && s.player.elementPower.fire === 0.3, 'Ember Staff applies spellPower + fire affinity');
  ok(Math.abs(combat.getSpellPower(game, 'firebolt') - 1.1 * 1.3) < 1e-9, 'fire spells get 1.43x');
  addItem(game, 'staff_prism', 1);
  equip(game, 'staff', 'staff_prism');
  ok(s.player.cooldownMult < 1, `Prism Staff cooldownMult ${s.player.cooldownMult}`);
  const before = s.fragments.fire;
  const r = combat.craft(game, 'r_fire_orb');
  ok(r.ok && s.spells.known.includes('fire_orb') && s.fragments.fire === before - 4, `crafted Fireball (fire ${before} -> ${s.fragments.fire})`);
  ok(s.loadout[3] === 'fire_orb', 'crafted spell auto-slotted into the empty slot');
  ok(combat.canCraft(s, 'r_fire_orb').reason === 'known', 'cannot craft twice');
  ok(combat.canCraft(s, 'r_prismatic_nova').reason === 'locked', 'triple locked early');
  ok(combat.canCraft(s, 'r_magma_orb').reason === 'fragments', 'needs fragments');
  s.player.hp = 50;
  ok(combat.useItem(game, 'potion_health') && s.player.hp === 90, 'health potion heals 40');
}

// ------------------------------------------------------------------ 3. reactions & blocking
console.log('\n[reactions / shields]');
{
  const game = makeGame('dungeon', { depth: 1 });
  const p = addPlayer(game);
  const reactions = [];
  game.bus.on('combat:reaction', (e) => reactions.push(e.reaction));
  const g = combat.spawnEnemy(game, 'golem_stone', 300, 200, { exact: true, elite: false });
  game.step();
  combat.applyStatus(game, g, { type: 'chill', duration: 3, power: 150 });
  ok(g.statuses.some((s) => s.type === 'freeze'), 'chill build-up freezes');
  const hp0 = g.hp;
  const dealt = combat.damage(game, g, { amount: 10, element: 'lightning', elements: ['lightning'], source: p });
  ok(reactions.includes('SHATTER') && dealt >= 10 * 0.6 * 2.5 - 1, `lightning on frozen = SHATTER (${dealt} dmg, hp ${hp0}->${g.hp})`);
  game.time += 1;
  combat.applyStatus(game, g, { type: 'burn', duration: 3, power: 2 });
  combat.damage(game, g, { amount: 10, element: 'lightning', elements: ['lightning'], source: p });
  ok(reactions.includes('OVERLOAD'), 'lightning on burning = OVERLOAD');
  game.time += 1;
  combat.applyStatus(game, g, { type: 'burn', duration: 3, power: 2 });
  combat.damage(game, g, { amount: 10, element: 'ice', elements: ['ice'], source: p });
  ok(reactions.includes('QUENCH') && game.entities.list.concat(game.entities._pending).some((e) => e.type === 'cloud'), 'ice on burning = QUENCH + steam cloud');

  const k = combat.spawnEnemy(game, 'armor_knight', 270, 260, { exact: true, elite: false });
  game.step();
  k.state = 'chase';
  k.facing = Math.PI / 2; // facing down toward the player at y=300
  const front = combat.damage(game, k, { amount: 20, element: 'fire', source: p, from: { x: 270, y: 300 } });
  k.facing = -Math.PI / 2; // turned away
  const back = combat.damage(game, k, { amount: 20, element: 'fire', source: p, from: { x: 270, y: 300 } });
  ok(front < back / 3, `knight shield blocks from the front (${front}) not the back (${back})`);
  k.facing = Math.PI / 2;
  combat.damage(game, k, { amount: 20, element: 'earth', source: p, from: { x: 270, y: 300 }, shieldBreak: true });
  ok(k.guardBroken > 0, 'earth smashes the guard');
  const im = combat.spawnEnemy(game, 'golem_ember', 100, 100, { exact: true, elite: false });
  ok(combat.damage(game, im, { amount: 20, element: 'fire', source: p }) === 0, 'magma golem immune to fire');
}

// ------------------------------------------------------------------ 4. every enemy fights
console.log('\n[enemy AI duels]');
function duel(enemyId, opts = {}) {
  const game = makeGame('dungeon', { depth: opts.depth || 2 }, opts.seed || 3);
  const p = addPlayer(game, 270, 320);
  const e = combat.spawnEnemy(game, enemyId, 270, 220, { exact: true, elite: !!opts.elite });
  game.step();
  e.alert?.(game);
  let pdmg = 0, t = 0, attacked = false;
  game.bus.on(EV.PLAYER_DAMAGED, ({ amount }) => { pdmg += amount; attacked = true; });
  const st = game.state.player;
  while (t < 60 && !e.dead && st.hp > 0) {
    // bot: keep ~70px away, strafe, shoot firebolt/spark, dash out of telegraphs
    const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
    const want = 75;
    const radial = d > want + 10 ? 1 : d < want - 10 ? -1 : 0;
    const strafe = Math.sin(t * 0.7) > 0 ? 1 : -1;
    game.input.move = { x: (dx / d) * radial * 0.8 - (dy / d) * strafe * 0.6, y: (dy / d) * radial * 0.8 + (dx / d) * strafe * 0.6 };
    game._aim = { x: dx / d, y: dy / d };
    const danger = game.entities.list.some((x) => x.constructor.name === 'Telegraph' && x.progress > 0.6 && Math.hypot(x.x - p.x, x.y - p.y) < 90);
    if (danger && p.dashCd <= 0) game.held.add('dash'), game.pressed.add('dash');
    const slot = ['spell1', 'spell3', 'spell2'][Math.floor(t * 3) % 3];
    game.held.clear(); game.held.add(slot);
    game.step();
    t += DT;
  }
  return { t, pdmg, dead: e.dead, attacked, hp: Math.round(st.hp), drops: game.drops.length };
}
for (const id of Object.keys(combat.ENEMIES).filter((id) => !combat.ENEMIES[id].boss)) {
  const r = duel(id);
  ok(r.dead || r.t >= 60, `${id.padEnd(15)} killed=${r.dead} in ${r.t.toFixed(1)}s, player took ${r.pdmg} (hp ${r.hp}), attacked=${r.attacked}, drops=${r.drops}`);
}
console.log('\n[enemies vs an idle player: do attacks land?]');
for (const id of Object.keys(combat.ENEMIES).filter((id) => !combat.ENEMIES[id].boss)) {
  const game = makeGame('dungeon', { depth: 1 }, 5);
  const p = addPlayer(game, 270, 300);
  const e = combat.spawnEnemy(game, id, 270, 230, { exact: true, elite: false });
  let dmg = 0, hits = 0;
  game.bus.on(EV.PLAYER_DAMAGED, ({ amount }) => { dmg += amount; hits++; });
  for (let i = 0; i < 60 * 10 && game.state.player.hp > 0; i++) game.step();
  ok(hits > 0, `${id.padEnd(15)} landed ${hits} hits for ${dmg} in 10s`);
}
{
  const r = duel('armor_captain', { elite: true, depth: 4 });
  ok(true, `elite captain @depth4: killed=${r.dead} in ${r.t.toFixed(1)}s, player took ${r.pdmg}`);
}

// ------------------------------------------------------------------ 5. boss
console.log('\n[boss]');
{
  const game = makeGame('boss', {});
  const p = addPlayer(game, 208, 300);
  const phases = [], defeated = [];
  game.bus.on(EV.BOSS_PHASE, ({ phase }) => phases.push(phase));
  game.bus.on(EV.BOSS_DEFEATED, () => defeated.push(1));
  const b = combat.spawnBoss(game, 208, 120);
  for (let i = 0; i < 120; i++) game.step();
  ok(b.ward, `ward raised after intro: ${b.ward}`);
  const counter = combat.WARD_COUNTER[b.ward];
  const hp0 = b.hp;
  combat.damage(game, b, { amount: 20, element: 'arcane', elements: ['arcane'], source: p });
  ok(hp0 - b.hp <= 4, `ward absorbs off-element damage (${hp0 - b.hp})`);
  for (let i = 0; i < 6 && b.ward; i++) combat.damage(game, b, { amount: 20, element: counter, elements: [counter], source: p });
  ok(!b.ward && b.state === 'exposed', `counter element (${counter}) shatters the ward`);
  combat.damage(game, b, { amount: b.hp - b.maxHp * 0.6, element: counter, source: p });
  ok(phases.includes(2) && b.invulnerable, 'phase 2 at 66%, invulnerable during transition');
  for (let i = 0; i < 300; i++) game.step();
  ok(b.minions.length > 0, `phase 2 summons minions (${b.minions.length})`);
  combat.damage(game, b, { amount: b.hp - b.maxHp * 0.3, element: 'fire', source: p, ignoreWard: true });
  for (let i = 0; i < 10 && !phases.includes(3); i++) { b.ward = null; combat.damage(game, b, { amount: 200, element: 'fire', source: p }); }
  ok(phases.includes(3), 'phase 3 at 33%');
  for (let i = 0; i < 200; i++) game.step();
  combat.damage(game, b, { amount: 99999, element: 'arcane', source: p });
  ok(defeated.length === 1 && b.dying, 'BOSS_DEFEATED emitted once');
  combat.damage(game, b, { amount: 99999, element: 'arcane', source: p });
  ok(defeated.length === 1, 'no double defeat');
  ok(!game.entities.list.some((e) => e.tags.has('enemy') && !e.dead && e !== b && !e.dying), 'minions cleared on defeat');
}

// boss balance bot: mid-game loadout fights the full boss
console.log('\n[boss balance bot]');
for (const seed of [1, 2, 3]) {
  const game = makeGame('boss', {}, seed);
  const s = game.state;
  for (const id of ['fire_orb', 'earth_bolt', 'shatter_arc', 'steam_orb']) learnSpell(game, id, { autoSlot: false });
  ['firebolt', 'frost_shard', 'earth_bolt', 'shatter_arc'].forEach((id, i) => setLoadoutSlot(game, i, id));
  addItem(game, 'staff_oak', 1); equip(game, 'staff', 'staff_oak');
  addItem(game, 'robe_scholar', 1); equip(game, 'robe', 'robe_scholar');
  addItem(game, 'potion_health', 2);
  const p = addPlayer(game, 208, 300);
  const b = combat.spawnBoss(game, 208, 120);
  let t = 0, taken = 0, potions = 0;
  game.bus.on(EV.PLAYER_DAMAGED, ({ amount }) => { taken += amount; });
  while (t < 600 && !b.dying && s.player.hp > 0) {
    const tgt = b.minions.find((m) => !m.dead && Math.hypot(m.x - p.x, m.y - p.y) < 70) || b;
    const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy) || 1;
    const want = 95;
    const radial = d > want + 15 ? 1 : d < want - 15 ? -1 : 0;
    const strafe = Math.sin(t * 0.5) > 0 ? 1 : -1;
    game.input.move = { x: (dx / d) * radial * 0.7 - (dy / d) * strafe * 0.7, y: (dy / d) * radial * 0.7 + (dx / d) * strafe * 0.7 };
    game._aim = { x: dx / d, y: dy / d };
    game.held.clear();
    // choose the counter element when warded
    const counter = b.ward && combat.WARD_COUNTER[b.ward];
    const slot = counter === 'fire' ? 'spell1' : counter === 'ice' ? 'spell2' : counter === 'earth' ? 'spell3' : ['spell1', 'spell4', 'spell3'][Math.floor(t * 2) % 3];
    game.held.add(slot);
    const near = game.entities.list.some((x) => (x.constructor.name === 'Telegraph' && x.progress > 0.55 && Math.hypot(x.x - p.x, x.y - p.y) < 40)
      || (x.tags.has('projectile') && x.team === 'enemy' && Math.hypot(x.x - p.x, x.y - p.y) < 14));
    if (near && p.dashCd <= 0) game.pressed.add('dash');
    if (s.player.hp < 35 && s.inventory.find((i) => i.id === 'potion_health')) { combat.useItem(game, 'potion_health'); potions++; }
    game.step();
    t += DT;
  }
  console.log(`  seed ${seed}: ${b.dying ? 'WON' : s.player.hp <= 0 ? 'died' : 'timeout'} after ${t.toFixed(0)}s, boss phase ${b.phase}, boss hp ${Math.round(b.hp)}/${b.maxHp}, player took ${taken}, potions ${potions}`);
}

// ------------------------------------------------------------------ 6. player death
console.log('\n[player death]');
{
  const game = makeGame('dungeon', { depth: 1 });
  const p = addPlayer(game);
  let died = 0;
  game.bus.on(EV.PLAYER_DIED, () => died++);
  combat.damage(game, p, { amount: 9999, element: 'fire' });
  for (let i = 0; i < 30; i++) game.step();
  combat.damage(game, p, { amount: 9999, element: 'fire' });
  ok(died === 1 && game.state.player.hp === 0, 'PLAYER_DIED exactly once');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL COMBAT TESTS PASSED');
process.exit(failures ? 1 : 0);
