// Combat visual check (team: combat). `node scripts/combat-shots.mjs`
// Boots ?scene=dungeon / tower / boss, plays a little (move, cast, dash), reports console errors
// and saves screenshots to ./screenshots/combat-*.png.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function run(name, query, script) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.stack || e.message}`));
  await page.goto(BASE + query);
  try {
    await page.waitForFunction(() => window.game?.player && window.game.isGameplay(), null, { timeout: 8000 });
  } catch { errors.push(`[${name}] scene did not start`); await ctx.close(); return; }
  await sleep(400);
  await script(page, (n) => page.screenshot({ path: path.join(SHOTS, `combat-${name}-${n}.png`) }));
  await ctx.close();
}

const hold = async (page, key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };

await run('dungeon', '?scene=dungeon&depth=3&seed=42&debug=1', async (page, shot) => {
  // teleport next to the nearest enemy so we see a fight
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    const e = g.entities.list.filter((x) => x.tags.has('enemy')).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (e) { p.x = e.x; p.y = e.y + 60; e.alert?.(g); }
  });
  await sleep(300);
  for (let i = 0; i < 6; i++) { await page.keyboard.press(['Digit1', 'Digit2', 'Digit3'][i % 3]); await sleep(150); }
  await shot('fight');
  await sleep(700);
  await shot('telegraph');
  await hold(page, 'KeyA', 200);
  await page.keyboard.press('ShiftLeft');
  await sleep(60);
  await shot('dash');
  const info = await page.evaluate(() => {
    const g = window.game;
    return g.entities.list.filter((e) => e.tags.has('enemy')).map((e) => `${e.defId}${e.elite ? '*' : ''}:${e.state}`).join(' ');
  });
  console.log('dungeon enemies:', info);
});

await run('arena', '?scene=dungeon&depth=2&seed=42', async (page, shot) => {
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    for (const e of g.entities.list) if (e.tags.has('enemy')) e.destroy();
    g.state.player.maxHp = g.state.player.hp = 9999;
    const add = (id, dx, dy, o = {}) => { const e = g.combat.spawnEnemy(g, id, p.x + dx, p.y + dy, { aggro: true, ...o }); e.cd = 0; return e; };
    add('golem_stone', 22, 0); add('armor_knight', -22, 0); add('armor_lancer', 0, -70, { elite: true, affix: 'swift' });
  });
  await sleep(650);
  await shot('telegraphs');
  await page.evaluate(() => { const g = window.game; for (const e of g.entities.list) if (e.tags.has('enemy')) g.combat.applyStatus(g, e, { type: 'chill', duration: 3, power: 200 }); });
  await sleep(300);
  await shot('frozen');
});

await run('boss', '?scene=boss&debug=1', async (page, shot) => {
  await page.evaluate(() => {
    const g = window.game;
    for (const id of ['fire_orb', 'earth_bolt', 'shatter_arc']) g.state.spells.known.push(id);
    g.state.loadout = ['firebolt', 'frost_shard', 'earth_bolt', 'shatter_arc'];
    g.state.player.maxHp = g.state.player.hp = 9999;
  });
  await sleep(2200);
  await shot('ward');
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Digit2'); await sleep(120); }
  await shot('fight');
  await page.evaluate(() => { const g = window.game, b = g.entities.withTag('boss')[0]; b.ward = null; g.combat.damage(g, b, { amount: b.hp - b.maxHp * 0.6, element: 'fire', source: g.player }); });
  await sleep(4200);
  await shot('phase2');
  await page.evaluate(() => { const g = window.game, b = g.entities.withTag('boss')[0]; b.ward = null; b.exposedT = 0; g.combat.damage(g, b, { amount: b.hp - b.maxHp * 0.3, element: 'fire', source: g.player }); });
  await sleep(3500);
  await shot('phase3');
  await page.evaluate(() => { const g = window.game, b = g.entities.withTag('boss')[0]; b.startPattern(g, 'beam', g.player); });
  await sleep(1500);
  await shot('beam');
});

await run('tower', '?scene=tower&floor=4', async (page, shot) => {
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    const e = g.entities.list.find((x) => x.tags.has('enemy'));
    if (e) { p.x = e.x; p.y = e.y + 70; }
    for (const id of ['steam_orb', 'plasma_bolt', 'lightning_arc', 'fire_rune']) g.state.spells.known.push(id);
    g.state.loadout = ['steam_orb', 'plasma_bolt', 'lightning_arc', 'fire_rune'];
    g.state.player.mana = g.state.player.maxMana = 999;
  });
  for (let i = 0; i < 8; i++) { await page.keyboard.press(['Digit1', 'Digit2', 'Digit3', 'Digit4'][i % 4]); await sleep(200); }
  await shot('combos');
});

await browser.close();
server.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
