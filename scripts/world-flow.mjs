// `node scripts/world-flow.mjs` - world team end-to-end flow check (dev-only, playwright).
// Drives the campaign mechanics in a real browser: intro dialogue, forge gift, first craft,
// portal waystone menu, dungeon ambush seal/waves/release, chest + geode + secret wall,
// tower unlock + floor clear, shop purchase, respawn healer line. Fails on console errors.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots', '_world');
fs.mkdirSync(OUT, { recursive: true });
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const problems = [];
const ok = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, label) => (cond ? ok.push(label) : problems.push(`FAILED: ${label}`));
const ev = (fn, arg) => page.evaluate(fn, arg);
const scene = () => ev(() => window.game.scenes.currentName);
const waitScene = (n) => page.waitForFunction((n) => window.game.scenes.currentName === n && window.game.player && !window.game.scenes.transitioning, n, { timeout: 10000 });
const flags = () => ev(() => ({ ...window.game.state.flags }));
async function closePanels() {
  for (let i = 0; i < 6 && await ev(() => !!window.game.ui.current); i++) { await page.keyboard.press('Escape'); await sleep(120); }
}
async function skimDialogue(max = 14) {
  for (let i = 0; i < max; i++) {
    if (!(await ev(() => window.game.ui.isOpen('dialogue')))) break;
    await page.keyboard.press('Space');
    await sleep(110);
  }
  const closed = !(await ev(() => window.game.ui.isOpen('dialogue')));
  await closePanels(); // looping menus (Librarian) or deferred panels (Forge)
  return closed;
}
async function talk(npcId) {
  await ev((id) => window.game.world.openNpcDialogue(window.game, id), npcId);
  await sleep(150);
  return skimDialogue();
}
const shot = (name) => page.screenshot({ path: path.join(OUT, `flow-${name}.png`) });

try {
  await page.goto(`http://127.0.0.1:${port}/?scene=hub&seed=7`);
  await waitScene('hub');
  await sleep(500);
  const npcs = await ev(() => window.game.entities.withTag('npc').map((e) => e.npc.id));
  check(['headmaster', 'librarian', 'artificer', 'quartermaster', 'shy', 'healer', 'rival', 'cat', 'student'].every((id) => npcs.includes(id)), `hub NPCs present (${npcs.join(',')})`);
  check(npcs.filter((n) => n === 'wanderer').length >= 3, 'wandering students present');
  const objective = await ev(() => window.game.world.getObjective(window.game));
  check(/Headmaster/.test(objective), `objective: ${objective}`);

  // Portal is gated before meeting the Headmaster.
  await ev(() => { const g = window.game; const p = g.entities.withTag('door').find((d) => d.sprite === 'prop_portal'); p.interact(g); });
  await sleep(100);
  check(await scene() === 'hub' && !(await ev(() => window.game.ui.isOpen('dialogue'))), 'portal locked before intro');

  // Intro + forge gift.
  check(await talk('headmaster'), 'headmaster intro closes');
  let f = await flags();
  check(f.metHeadmaster === true, 'metHeadmaster set');
  const fragsBefore = await ev(() => ({ ...window.game.state.fragments }));
  await ev(() => window.game.world.openNpcDialogue(window.game, 'artificer'));
  await sleep(150);
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Space'); await sleep(110); if (await ev(() => window.game.ui.current !== 'dialogue')) break; }
  await sleep(200);
  check(await ev(() => window.game.ui.isOpen('crafting')), 'artificer opens the Forge (deferred openPanel)');
  await page.keyboard.press('Escape');
  await sleep(150);
  const fragsAfter = await ev(() => ({ ...window.game.state.fragments }));
  check(fragsAfter.fire === fragsBefore.fire + 3 && fragsAfter.ice === fragsBefore.ice + 3, 'forge gift fragments');
  check((await flags()).forgeGift, 'forgeGift set');

  // Librarian (dynamic research tree) and other NPCs open without error.
  for (const id of ['librarian', 'librarian', 'rival', 'shy', 'cat', 'healer', 'student', 'quartermaster']) {
    await ev((id) => window.game.world.openNpcDialogue(window.game, id), id);
    await sleep(120);
    check(await ev(() => window.game.ui.isOpen('dialogue')), `dialogue opens: ${id}`);
    await skimDialogue();
  }

  // Every dynamic dialogue: valid links, text fits the box.
  const dyn = await ev(() => {
    const g = window.game, bad = [];
    for (const id of ['librarian_main', 'artificer_main', 'quartermaster_shop', 'cat', 'healer_main', 'healer_respawn', 'pip', 'wanderer_bark', 'portal_menu']) {
      const d = g.world.getDialogue(g, id);
      if (!d || !d.nodes[d.start]) { bad.push(`${id}: missing`); continue; }
      for (const [nid, n] of Object.entries(d.nodes)) {
        if (n.text.length > 125) bad.push(`${id}.${nid} too long (${n.text.length}): ${n.text}`);
        for (const nx of [n.next, ...(n.choices || []).map((c) => c.next)]) if (nx != null && !d.nodes[nx]) bad.push(`${id}.${nid} -> ${nx}`);
      }
    }
    return bad;
  });
  check(!dyn.length, `dynamic dialogues valid ${dyn.join(' | ')}`);

  // First craft -> firstCraft flag.
  await closePanels();
  const crafted = await ev(() => {
    const g = window.game;
    g.state.fragments.fire += 10; g.state.fragments.ice += 10; g.state.fragments.lightning += 10;
    const r = g.combat.listRecipes().find((r) => r.inputs.length === 2 && g.combat.canCraft(g.state, r.id).ok);
    return r ? g.combat.craft(g, r.id) : null;
  });
  await sleep(100);
  check(crafted?.ok && (await flags()).firstCraft, `first craft sets firstCraft (${JSON.stringify(crafted)})`);

  // Shop purchase.
  const bought = await ev(() => {
    const g = window.game;
    g.state.fragments.fire += 5; g.state.fragments.earth += 5;
    const before = g.state.inventory.find((s) => s.id === 'potion_health')?.qty || 0;
    g.bus.emit('world:buy', { itemId: 'potion_health', cost: { fire: 2, earth: 1 } });
    return (g.state.inventory.find((s) => s.id === 'potion_health')?.qty || 0) - before;
  });
  check(bought === 1, 'quartermaster sale');

  // Portal waystone menu -> depth 1.
  await ev(() => { const g = window.game; g.entities.withTag('door').find((d) => d.sprite === 'prop_portal').interact(g); });
  await sleep(150);
  check(await ev(() => window.game.ui.isOpen('dialogue')), 'portal opens the waystone menu');
  for (let i = 0; i < 6 && await ev(() => window.game.ui.isOpen('dialogue')); i++) { await page.keyboard.press('Space'); await sleep(150); }
  await waitScene('dungeon');
  const lvl = await ev(() => ({ name: window.game.level.name, depth: window.game.level.data.depth }));
  check(lvl.depth === 1, `portal travels to depth 1 (${lvl.name})`);
  check((await flags()).reachedDepth1, 'reachedDepth1 set');

  // Dungeon: open every chest/geode, open the secret wall if any, trigger an ambush and clear it.
  await page.goto(`http://127.0.0.1:${port}/?scene=dungeon&depth=3&seed=4242`);
  await waitScene('dungeon');
  await sleep(400);
  const info = await ev(() => {
    const g = window.game;
    const chests = g.entities.withTag('chest');
    const geodes = g.entities.withTag('geode');
    const frags = { ...g.state.fragments };
    for (const c of chests) c.interact(g);
    for (const ge of geodes) ge.interact(g);
    const secret = g.entities.list.find((e) => e.constructor.name === 'SecretWall');
    let secretOpened = null;
    if (secret) { const tx = secret.tx, ty = secret.ty; secret.interact(g); secretOpened = !g.level.map.isSolid(tx, ty); }
    return { chests: chests.length, geodes: geodes.length, secret: !!secret, secretOpened, frags };
  });
  check(info.chests > 0, `dungeon has chests (${info.chests})`);
  check(info.secretOpened !== false, `secret wall opens (${info.secret ? 'present' : 'none in this seed'})`);
  // Let pickups fly to the player: teleport the player onto every pickup.
  for (let k = 0; k < 40; k++) {
    const left = await ev(() => {
      const g = window.game;
      const p = g.entities.withTag('pickup').find((e) => e.age > 0.5);
      if (!p) return g.entities.withTag('pickup').length;
      g.player.x = p.x; g.player.y = p.y;
      return g.entities.withTag('pickup').length;
    });
    if (!left) break;
    await sleep(60);
  }
  const gained = await ev((before) => Object.keys(before).reduce((n, k) => n + (window.game.state.fragments[k] - before[k]), 0), info.frags);
  check(gained > 0, `collected fragments from chests/geodes/floor (+${gained})`);
  await shot('dungeon-looted');

  // Ambush: kill roaming enemies, step into the ambush room, check seal, clear waves.
  const amb = await ev(() => {
    const g = window.game;
    for (const e of g.entities.withTag('enemy')) g.combat.damage(g, e, { amount: 99999, element: 'arcane', source: g.player });
    return g.level.data.rooms.filter((r) => r.role === 'ambush').map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, c: r.center }));
  });
  check(amb.length > 0, `ambush rooms in depth 3 (${amb.length})`);
  if (amb.length) {
    await sleep(300);
    for (const [ai, room] of amb.entries()) {
      await ev((r) => { const g = window.game; g.player.x = r.c.tx * 16 + 8; g.player.y = r.c.ty * 16 + 8; }, room);
      await sleep(500);
      const sealed = await ev(() => window.game.entities.list.filter((e) => e.constructor.name === 'Barrier').length);
      check(sealed > 0, `ambush ${ai + 1} seals the room (${sealed} barriers)`);
      if (ai === 0) await shot('ambush-sealed');
      for (let k = 0; k < 8; k++) {
        await ev(() => { const g = window.game; for (const e of g.entities.withTag('enemy')) g.combat.damage(g, e, { amount: 99999, element: 'arcane', source: g.player }); });
        await sleep(400);
      }
    }
    const after = await ev(() => ({ barriers: window.game.entities.list.filter((e) => e.constructor.name === 'Barrier').length, chests: window.game.entities.withTag('chest').filter((c) => !c.opened).length }));
    check(after.barriers === 0, 'ambush seals lift after waves');
    check(after.chests >= 1, 'ambush reward chest appears');
    await sleep(500);
    for (let k = 0; k < 6; k++) {
      await ev(() => { const g = window.game; for (const e of g.entities.withTag('enemy')) g.combat.damage(g, e, { amount: 99999, element: 'arcane', source: g.player }); });
      await sleep(300);
    }
    check((await flags()).dungeonCleared, 'dungeonCleared after all foes and ambushes');
  }

  // Tower unlock via Headmaster (state set as if depth 3 reached & spell crafted).
  await ev(() => window.game.bus.emit('travel:request', { to: 'hub', params: { from: 'dungeon' } }));
  await waitScene('hub');
  await sleep(300);
  await ev(() => { const g = window.game; g.state.flags.reachedDepth3 = true; g.state.flags.firstCraft = true; g.state.flags.metHeadmaster = true; });
  await ev(() => window.game.world.openNpcDialogue(window.game, 'headmaster'));
  await sleep(150);
  for (let i = 0; i < 20 && await ev(() => window.game.ui.isOpen('dialogue')); i++) { await page.keyboard.press('Space'); await sleep(110); }
  check((await flags()).towerUnlocked, 'Headmaster unlocks the tower');
  await ev(() => { const g = window.game; g.entities.withTag('door').find((d) => d.to === 'tower').interact(g); });
  await waitScene('tower');
  await sleep(1700);
  for (let k = 0; k < 6; k++) {
    await ev(() => { const g = window.game; for (const e of g.entities.withTag('enemy')) g.combat.damage(g, e, { amount: 99999, element: 'arcane', source: g.player }); });
    await sleep(350);
  }
  const t = await ev(() => ({ cleared: window.game.state.flags.towerFloor1Cleared, highest: window.game.state.tower.highestFloor, stairsLocked: window.game.entities.withTag('door').find((d) => d.sprite === 'prop_stairs_up')?.locked }));
  check(t.cleared && t.highest === 1 && t.stairsLocked === false, `tower floor 1 cleared (${JSON.stringify(t)})`);
  await shot('tower-cleared');

  // Respawn -> healer line.
  await ev(() => { const g = window.game; g.combat.damage(g, g.player, { amount: 99999, element: 'fire' }); });
  await page.waitForFunction(() => window.game.scenes.currentName === 'gameover', null, { timeout: 8000 });
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScene('hub');
  await sleep(1200);
  const healer = await ev(() => window.game.ui.isOpen('dialogue'));
  check(healer, 'healer greets you on respawn');
  await shot('respawn-healer');
  await skimDialogue();
} catch (err) {
  problems.push(`crashed: ${err.stack}`);
} finally {
  await browser.close();
  server.close();
}
for (const o of ok) console.log('  ok  ', o);
for (const p of problems) console.error('  !!  ', p);
console.log(problems.length ? `WORLD FLOW FAILED (${problems.length})` : `WORLD FLOW PASSED (${ok.length} checks)`);
process.exit(problems.length ? 1 : 0);
