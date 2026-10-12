// `npm run smoke` - headless boot test (dev-only; playwright is a devDependency, never shipped).
// Starts the static server on a free port, drives the game on desktop and mobile viewports,
// collects console errors / page errors / failed requests, takes screenshots into ./screenshots/,
// and exits non-zero if anything went wrong.
//   node scripts/smoke.mjs            run everything
//   HEADED=1 node scripts/smoke.mjs   watch it
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright is not installed. Run: npm install && npx playwright install chromium');
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ headless: !process.env.HEADED });

const problems = []; // {scenario, kind, text}
const notes = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(scenario, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push({ scenario, kind: 'console.error', text: m.text() });
    else if (m.type() === 'warning') notes.push(`[${scenario}] console.warn: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push({ scenario, kind: 'pageerror', text: e.stack || e.message }));
  page.on('requestfailed', (r) => problems.push({ scenario, kind: 'requestfailed', text: `${r.url()} ${r.failure()?.errorText}` }));
  page.on('response', (r) => { if (r.status() >= 400) problems.push({ scenario, kind: 'http', text: `${r.status()} ${r.url()}` }); });
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

function expect(scenario, cond, text) {
  if (!cond) problems.push({ scenario, kind: 'assert', text });
}

const scene = (page) => page.evaluate(() => window.game?.scenes.currentName);
const playerPos = (page) => page.evaluate(() => (window.game?.player ? { x: window.game.player.x, y: window.game.player.y } : null));

async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
}

// ------------------------------------------------------------------ desktop flow
async function desktop() {
  const S = 'desktop';
  const { context, page } = await newPage(S, { viewport: { width: 1280, height: 720 } });
  await page.goto(BASE);
  await page.waitForFunction(() => window.game && window.game.loop.frameCount > 10, null, { timeout: 10000 });
  await sleep(800);
  await shot(page, '01-title');
  expect(S, (await scene(page)) === 'title', 'boot should land on title');

  await page.keyboard.press('Enter'); // New Game (no save in a fresh context)
  await page.waitForFunction(() => window.game.scenes.currentName === 'hub' && window.game.player, null, { timeout: 5000 });
  await sleep(700);
  await shot(page, '02-hub');

  const before = await playerPos(page);
  await hold(page, 'KeyD', 500);
  await hold(page, 'KeyS', 300);
  const after = await playerPos(page);
  expect(S, before && after && (after.x !== before.x || after.y !== before.y), 'WASD should move the player');

  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) { await page.keyboard.press(k); await sleep(120); }
  await sleep(100);
  await shot(page, '03-hub-casting');
  const cast = await page.evaluate(() => window.game.state.stats.spellsCast);
  expect(S, cast >= 3, `keys 1-3 should cast spells (spellsCast=${cast})`);

  await page.keyboard.press('KeyI');
  await sleep(250);
  expect(S, await page.evaluate(() => window.game.ui.isOpen('inventory')), 'I should open the inventory');
  await shot(page, '04-inventory');
  await page.keyboard.press('Escape');
  await sleep(150);

  await page.keyboard.press('Escape');
  await sleep(200);
  expect(S, await page.evaluate(() => window.game.ui.isOpen('pause')), 'Esc should open pause');
  await shot(page, '05-pause');
  await page.keyboard.press('Escape');
  await sleep(150);

  // Dialogue via the world API, advanced with keyboard.
  await page.evaluate(() => window.game.world.openNpcDialogue(window.game, 'headmaster'));
  await sleep(300);
  await shot(page, '06-dialogue');
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Space'); await sleep(120); }
  expect(S, await page.evaluate(() => window.game.state.flags.metHeadmaster === true), 'headmaster intro should set metHeadmaster');
  expect(S, !(await page.evaluate(() => window.game.ui.isOpen('dialogue'))), 'dialogue should close');

  await page.evaluate(() => window.game.ui.open('crafting'));
  await sleep(200);
  await shot(page, '07-crafting');
  await page.keyboard.press('Escape');

  // Travel through the event bus like a door would.
  await page.evaluate(() => window.game.bus.emit('travel:request', { to: 'dungeon', params: { depth: 1, seed: 1234 } }));
  await page.waitForFunction(() => window.game.scenes.currentName === 'dungeon' && window.game.player, null, { timeout: 5000 });
  await sleep(600);
  await hold(page, 'KeyW', 300);
  await page.keyboard.press('Digit1');
  await sleep(150);
  await shot(page, '08-dungeon');

  // Death -> game over -> respawn at the Academy.
  await page.evaluate(() => { const g = window.game; g.combat.damage(g, g.player, { amount: 9999, element: 'fire' }); });
  await page.waitForFunction(() => window.game.scenes.currentName === 'gameover', null, { timeout: 6000 });
  await sleep(400);
  await shot(page, '09-gameover');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.scenes.currentName === 'hub' && window.game.state.player.hp > 0, null, { timeout: 5000 });
  await context.close();
}

// ------------------------------------------------------------------ direct scene entry
async function directScene(name, query, wait = 1500) {
  const S = `scene-${name}`;
  const { context, page } = await newPage(S, { viewport: { width: 960, height: 540 } });
  await page.goto(BASE + query);
  await page.waitForFunction((n) => window.game?.scenes.currentName === n && window.game.player, name, { timeout: 8000 });
  await sleep(wait);
  await hold(page, 'KeyW', 250);
  await page.keyboard.press('Digit2');
  await sleep(300);
  await shot(page, `10-${name}`);
  await context.close();
}

// ------------------------------------------------------------------ win condition
async function victory() {
  const S = 'victory';
  const { context, page } = await newPage(S, { viewport: { width: 960, height: 540 } });
  await page.goto(BASE + '?scene=boss');
  await page.waitForFunction(() => window.game?.scenes.currentName === 'boss' && window.game.player, null, { timeout: 8000 });
  await sleep(500);
  await page.evaluate(() => {
    const g = window.game;
    const boss = g.entities.withTag('boss')[0];
    g.combat.damage(g, boss, { amount: 99999, element: 'arcane', source: g.player });
  });
  await page.waitForFunction(() => window.game.scenes.currentName === 'victory', null, { timeout: 8000 });
  await sleep(500);
  expect(S, await page.evaluate(() => window.game.state.flags.archmageDefeated === true), 'archmageDefeated flag should be set');
  await shot(page, '11-victory');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.scenes.currentName === 'title', null, { timeout: 5000 });
  await context.close();
}

// ------------------------------------------------------------------ mobile (touch)
async function mobile(label, viewport) {
  const S = `mobile-${label}`;
  const { context, page } = await newPage(S, { viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(BASE);
  await page.waitForFunction(() => window.game && window.game.loop.frameCount > 10, null, { timeout: 10000 });
  await sleep(600);
  await shot(page, `20-${label}-title`);

  // Tap "New Game" (menu geometry from ui/panels.js createMenu: title + subtitle + 8px gap).
  const tap = await page.evaluate(() => {
    const d = window.game.display;
    const vy = Math.round(d.height * 0.3) + 26 + 14 + 8 + 2;
    const k = d.scale / d.dpr;
    return { x: (d.width / 2) * k, y: vy * k };
  });
  await page.touchscreen.tap(tap.x, tap.y);
  const started = await page.waitForFunction(() => window.game.scenes.currentName === 'hub', null, { timeout: 2000 }).then(() => true, () => false);
  if (!started) {
    problems.push({ scenario: S, kind: 'assert', text: 'tapping New Game should start the game' });
    await page.keyboard.press('Enter');
  }
  await page.waitForFunction(() => window.game.scenes.currentName === 'hub' && window.game.player, null, { timeout: 5000 });
  await sleep(600);

  // Joystick drag via CDP touch events.
  const cdp = await context.newCDPSession(page);
  const vw = viewport.width, vh = viewport.height;
  const sx = vw * 0.2, sy = vh * 0.7;
  const before = await playerPos(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + i * 6, y: sy - i * 2, id: 1 }] });
    await sleep(60);
  }
  await sleep(400);
  await shot(page, `21-${label}-joystick`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await playerPos(page);
  expect(S, before && after && Math.hypot(after.x - before.x, after.y - before.y) > 4, 'touch joystick should move the player');

  // Tap spell button 1 (geometry from ui/touch.js layout()).
  const btn = await page.evaluate(() => {
    const d = window.game.display, s = d.safe;
    const px = d.width - s.right - 14, py = d.height - s.bottom - 14, a = (185 * Math.PI) / 180;
    const k = d.scale / d.dpr;
    return { x: (px + Math.cos(a) * 50) * k, y: (py + Math.sin(a) * 50) * k };
  });
  const castBefore = await page.evaluate(() => window.game.state.stats.spellsCast);
  await page.touchscreen.tap(btn.x, btn.y);
  await sleep(250);
  const castAfter = await page.evaluate(() => window.game.state.stats.spellsCast);
  expect(S, castAfter > castBefore, 'tapping touch spell button 1 should cast');
  await shot(page, `22-${label}-cast`);
  await context.close();
}

let crashed = null;
try {
  await desktop();
  await directScene('dungeon', '?scene=dungeon&seed=42&depth=2');
  await directScene('tower', '?scene=tower&floor=3');
  await directScene('boss', '?scene=boss', 2500);
  await victory();
  await mobile('landscape', { width: 844, height: 390 });
  await mobile('portrait', { width: 390, height: 844 });
} catch (err) {
  crashed = err;
} finally {
  await browser.close();
  server.close();
}

const real = problems.filter((p) => p.text);
for (const n of notes) console.log('note:', n);
if (crashed) console.error('\nSMOKE CRASHED:', crashed.message);
if (real.length) {
  console.error(`\n${real.length} problem(s):`);
  for (const p of real) console.error(`  [${p.scenario}] ${p.kind}: ${p.text}`);
}
console.log(`\nScreenshots: ${path.relative(ROOT, SHOTS)}${path.sep}`);
if (crashed || real.length) {
  console.error('SMOKE FAILED');
  process.exit(1);
}
console.log('SMOKE PASSED - no console errors, all checks OK');
