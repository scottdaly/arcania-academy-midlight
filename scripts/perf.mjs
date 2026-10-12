// `npm run perf` - frame-cost measurement in heavy scenes under CPU throttling (dev-only, playwright).
//
// Approximates a mid-range phone: phone viewport (844x390 @3x, touch) + Chrome DevTools
// Emulation.setCPUThrottlingRate(4). Scenes:
//   dungeon-brawl  depth 6, ~24 aggro'd foes around the player, autopilot casting everything
//   boss-phase3    the Corrupted Archmage forced into phase 3 (pools, volleys, minions), autopilot fighting
// For each scene it samples requestAnimationFrame intervals and the loop's own work time per frame
// (update + render, game.loop.lastWorkMs) for ~8 s after a warm-up, plus particle/entity counts and fx quality.
// Note: headless Chromium rasterises canvas in software, so absolute numbers are pessimistic vs a real GPU.
//   node scripts/perf.mjs            RATE=4 by default;  RATE=1 for an unthrottled baseline
import { startServer } from '../server.js';

const { chromium } = await import('playwright');
const RATE = Number(process.env.RATE || 4);
const SECONDS = Number(process.env.SECONDS || 8);
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function scenario(name, url, setup) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  const cdp = await context.newCDPSession(page);
  await page.goto(`http://127.0.0.1:${port}/${url}`);
  await page.waitForFunction(() => window.game?.player && !window.game.scenes.transitioning, null, { timeout: 20000 });
  await page.evaluate(async () => { const m = await import('/scripts/lib/bot.js'); m.installBot(window.game); });
  await page.evaluate(setup);
  await sleep(1500);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  await sleep(2500); // warm-up under throttling (lets fx quality adapt)
  const r = await page.evaluate((secs) => new Promise((resolve) => {
    const g = window.game;
    const frames = [], work = [], parts = [], ents = [];
    let last = performance.now();
    const end = last + secs * 1000;
    function tick(now) {
      frames.push(now - last); last = now;
      work.push(g.loop.lastWorkMs);
      parts.push(g.fx.count?.() || 0);
      ents.push(g.entities.count);
      if (now < end) requestAnimationFrame(tick);
      else {
        const st = (a) => { const s = [...a].sort((x, y) => x - y); return { avg: a.reduce((x, y) => x + y, 0) / a.length, p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
        const boss = g.entities.withTag('boss')[0];
        resolve({ frames: frames.length, interval: st(frames.slice(1)), work: st(work), particles: st(parts), entities: st(ents), quality: g.fx.quality, boss: boss ? `phase ${boss.phase}` : '', hp: Math.round(g.state.player.hp) });
      }
    }
    requestAnimationFrame(tick);
  }), SECONDS);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await context.close();
  const f = (o) => `avg ${o.avg.toFixed(1)} / p95 ${o.p95.toFixed(1)} / max ${o.max.toFixed(1)}`;
  console.log(`\n[${name}] CPU x${RATE}, ${r.frames} frames in ${SECONDS}s (${(r.frames / SECONDS).toFixed(1)} fps) ${r.boss}`);
  console.log(`  frame interval ms  ${f(r.interval)}`);
  console.log(`  update+render ms   ${f(r.work)}`);
  console.log(`  particles          avg ${r.particles.avg.toFixed(0)} / max ${r.particles.max}   entities avg ${r.entities.avg.toFixed(0)} / max ${r.entities.max}   fx quality ${r.quality.toFixed(2)}`);
  return r;
}

try {
  await scenario('dungeon-brawl', '?scene=dungeon&depth=6&seed=31&mute=1', () => {
    const g = window.game, p = g.player;
    const ids = ['armor_knight', 'golem_ember', 'wisp_storm', 'golem_frost', 'armor_lancer', 'wisp_ember', 'golem_crystal', 'armor_knight'];
    let n = 0;
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + ring * 0.4, d = 60 + ring * 30;
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (g.level.map.isSolidAt(x, y, 'walk')) continue;
      if (g.combat.spawnEnemy(g, ids[(i + ring) % ids.length], x, y, { aggro: true })) n++;
    }
    for (const id of ['steam_bolt', 'fire_orb']) if (!g.state.spells.known.includes(id)) g.state.spells.known.push(id);
    g.state.loadout = ['firebolt', 'steam_bolt', 'fire_orb', 'spark'];
    g.state.player.maxHp = g.state.player.hp = 5000; // keep the brawl going for the whole sample
    g.state.player.manaRegen = 60;
    window.__bot.run('fight', { maxTime: 999, untilClear: false });
    return n;
  });
  await scenario('boss-phase3', '?scene=boss&mute=1', () => {
    const g = window.game;
    const b = g.entities.withTag('boss')[0];
    for (const id of ['steam_bolt', 'fire_orb']) if (!g.state.spells.known.includes(id)) g.state.spells.known.push(id);
    g.state.loadout = ['firebolt', 'steam_bolt', 'fire_orb', 'frost_shard'];
    g.state.player.maxHp = g.state.player.hp = 5000;
    g.state.player.manaRegen = 60;
    // knock the Archmage through both phase thresholds (one at a time so each transition runs)
    g.combat.damage(g, b, { amount: b.maxHp * 0.4, element: 'arcane', source: g.player });
    setTimeout(() => { b.ward = null; b.state = 'idle'; g.combat.damage(g, b, { amount: b.maxHp * 0.4, element: 'arcane', source: g.player }); }, 2500);
    b.maxHp *= 4; b.hp *= 4; // and keep it alive for the sample
    window.__bot.run('fight', { maxTime: 999, untilClear: false });
  });
} catch (err) {
  errors.push(`crashed: ${err.stack || err}`);
}
await browser.close();
server.close();
for (const e of errors) console.log('  - ' + e);
console.log(errors.length ? '\nPERF DONE (with errors)' : '\nPERF DONE');
process.exit(errors.length ? 1 : 0);
