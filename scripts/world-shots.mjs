// `node scripts/world-shots.mjs` - world team visual check (dev-only, uses playwright like smoke).
// Writes screenshots to ./screenshots/_world/: a hub tour, one dungeon per biome, every tower
// floor, the summit, and full-map overview PNGs rendered with art.drawTile. Fails on any
// console.error / page error, like the smoke test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots', '_world');
fs.mkdirSync(OUT, { recursive: true });
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const problems = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(query, scene) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${query}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${query}: ${e.message}`));
  await page.goto(BASE + query);
  await page.waitForFunction((n) => window.game?.scenes.currentName === n && window.game.player, scene, { timeout: 10000 });
  await sleep(400);
  return { ctx, page };
}

/** Teleport the player (tile coords) and snap the camera. */
async function goTo(page, tx, ty) {
  await page.evaluate(([tx, ty]) => {
    const g = window.game;
    g.player.x = g.player.prevX = tx * 16 + 8;
    g.player.y = g.player.prevY = ty * 16 + 8;
    g.camera.follow(g.player, true);
  }, [tx, ty]);
  await sleep(450);
}

/** Render the whole level map (ground + deco + entity dots) to a PNG. */
async function overview(page, file) {
  const url = await page.evaluate(() => {
    const g = window.game, map = g.level.map;
    const c = document.createElement('canvas');
    c.width = map.w * 16; c.height = map.h * 16;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = g.level.bgColor || '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
      const i = ty * map.w + tx;
      g.art.drawTile(ctx, map.ground[i], tx * 16, ty * 16, map.variant[i], 0, tx, ty, map);
      if (map.deco[i]) g.art.drawTile(ctx, map.deco[i], tx * 16, ty * 16, map.variant[i], 0, tx, ty, map);
    }
    const col = (e) => (e.tags.has('player') ? '#00ff66' : e.tags.has('enemy') ? '#ff3030' : e.tags.has('npc') ? '#40c0ff'
      : e.tags.has('door') ? '#ff40ff' : e.tags.has('chest') ? '#ffd000' : e.tags.has('geode') ? '#ff9000' : e.tags.has('pickup') ? '#ffffff' : null);
    for (const e of g.entities.list) {
      const cc = col(e);
      if (!cc) continue;
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(e.x) - 4, Math.round(e.y) - 4, 8, 8);
      ctx.fillStyle = cc;
      ctx.fillRect(Math.round(e.x) - 3, Math.round(e.y) - 3, 6, 6);
    }
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));
}

try {
  // ---- hub tour
  {
    const { ctx, page } = await open('?scene=hub', 'hub');
    await overview(page, 'hub-overview.png');
    const stops = { 'hub-1-courtyard': [32, 25], 'hub-2-greathall': [32, 8], 'hub-3-library': [10, 9], 'hub-4-tower': [53, 12],
      'hub-5-forge': [55, 26], 'hub-6-dorm': [9, 26], 'hub-7-portal': [52, 41], 'hub-8-pond': [14, 40] };
    for (const [name, [tx, ty]] of Object.entries(stops)) { await goTo(page, tx, ty); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); }
    // Dialogue check: Librarian research menu (dynamic builder).
    await page.evaluate(() => { window.game.state.flags.visitedLibrary = true; window.game.world.openNpcDialogue(window.game, 'librarian'); });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, 'hub-9-dialogue-librarian.png') });
    await ctx.close();
  }
  // ---- one dungeon per biome
  for (const [depth, seed] of [[1, 1234], [3, 77], [5, 4242], [7, 9001]]) {
    const { ctx, page } = await open(`?scene=dungeon&depth=${depth}&seed=${seed}`, 'dungeon');
    await overview(page, `dungeon-d${depth}-overview.png`);
    await sleep(600);
    await page.screenshot({ path: path.join(OUT, `dungeon-d${depth}.png`) });
    await ctx.close();
  }
  // ---- tower floors + summit
  for (let f = 1; f <= 5; f++) {
    const { ctx, page } = await open(`?scene=tower&floor=${f}`, 'tower');
    await sleep(1600);
    await page.screenshot({ path: path.join(OUT, `tower-${f}.png`) });
    if (f === 5) await overview(page, 'tower-5-overview.png');
    await ctx.close();
  }
  {
    const { ctx, page } = await open('?scene=boss', 'boss');
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'boss.png') });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
for (const p of problems) console.error('problem:', p);
console.log(`world shots -> ${path.relative(ROOT, OUT)}`);
process.exit(problems.length ? 1 : 0);
