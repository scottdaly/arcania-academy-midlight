// `npm run playthrough` - full campaign, end to end, in headless Chromium (dev-only, playwright).
//
// Runs twice: a desktop viewport (keyboard + mouse) and a phone viewport (touch only, landscape).
// Story beats are performed with REAL inputs: title menu, walking to NPCs (keys / virtual joystick),
// talking, crafting at the Forge, equipping gear in the bag, casting, dashing, quaffing a potion,
// the game-over menu and Continue after a reload. Long fights and dungeon crawling use an autopilot
// (scripts/lib/bot.js) that is itself an InputSource, so it goes through the same input pipeline.
// The game runs at ?timescale=N (simulation speed-up) to keep the run short.
//
//   node scripts/playthrough.mjs                 both viewports
//   VP=desktop|phone node scripts/playthrough.mjs
//   HEADED=1 TIMESCALE=2 node scripts/playthrough.mjs
//
// Screenshots: screenshots/_play/<viewport>-NN-<stage>.png. Exit code 1 on any failed check,
// console error, page error or failed request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const { chromium } = await import('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'screenshots', '_play');
fs.mkdirSync(OUT, { recursive: true });
const TIMESCALE = Number(process.env.TIMESCALE || 4);
const { server, port } = await startServer({ port: 0, host: '127.0.0.1' });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ headless: !process.env.HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const results = [];

async function runViewport(vpName) {
  const touch = vpName === 'phone';
  const context = await browser.newContext(VIEWPORTS[vpName]);
  const page = await context.newPage();
  const cdp = touch ? await context.newCDPSession(page) : null;
  const problems = [];
  const passed = [];
  const timeline = [];
  let shotN = 0;
  const t0 = Date.now();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.stack || e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  const check0 = (cond, label) => { (cond ? passed : problems).push(cond ? label : `FAILED: ${label}`); console.log(`  [${vpName}] ${cond ? 'ok  ' : 'FAIL'} ${label}`); return cond; };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const check = (cond, label) => { const r = check0(cond, label); if (!cond) lastToasts().then((t) => t && console.log(`         toasts: ${t}`), () => {}); return r; };
  const G = (expr) => page.evaluate(`(() => { const g = window.game; return (${expr}); })()`);
  const shot = async (name) => { shotN++; await page.screenshot({ path: path.join(OUT, `${vpName}-${String(shotN).padStart(2, '0')}-${name}.png`) }); };
  const mark = async (label) => { const gt = await G('g.state.stats.playTime'); timeline.push({ label, gameTime: Math.round(gt) }); };
  const scene = () => G('g.scenes.currentName');
  const waitFor = (expr, timeout = 15000) => page.waitForFunction(`(() => { const g = window.game; return !!(${expr}); })()`, null, { timeout, polling: 50 });
  const waitScene = (n, timeout = 15000) => waitFor(`g.scenes.currentName === '${n}' && !g.scenes.transitioning && (['title','gameover','victory'].includes('${n}') || g.player)`, timeout);
  const gsleep = (gameSec) => sleep((gameSec * 1000) / TIMESCALE);

  // ---- real input helpers -------------------------------------------------------------------
  const toClient = (v) => ev(({ x, y }) => {
    const g = window.game, r = g.canvas.getBoundingClientRect(), k = g.display.scale / g.display.dpr;
    return { x: r.left + x * k, y: r.top + y * k };
  }, v);
  async function tapVirtual(v) {
    const c = await toClient(v);
    if (touch) await page.touchscreen.tap(c.x, c.y);
    else await page.mouse.click(c.x, c.y);
    await gsleep(0.1);
  }
  async function tapTarget(id, { required = true } = {}) {
    let v = null;
    for (let i = 0; i < 40 && !v; i++) { v = await ev((id) => window.game.ui.findTarget(id), id); if (!v) await sleep(50); }
    if (!v) { if (required) check(false, `UI target "${id}" exists`); return false; }
    await tapVirtual(v);
    return true;
  }
  async function confirmUI() {
    if (touch) await tapTarget('dialogue-advance', { required: false });
    else await page.keyboard.press('Space');
    await sleep(60);
  }
  /** Walk with keys (desktop) or the virtual joystick (phone) until `doneExpr` is true. */
  async function walkTo(goalExpr, doneExpr, maxMs = 25000) {
    const keys = new Set();
    const setKeys = async (want) => {
      for (const k of [...keys]) if (!want.has(k)) { await page.keyboard.up(k); keys.delete(k); }
      for (const k of want) if (!keys.has(k)) { await page.keyboard.down(k); keys.add(k); }
    };
    let stick = null;
    const touchMove = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
    const start = Date.now();
    let ok = false;
    while (Date.now() - start < maxMs) {
      if (await G(doneExpr)) { ok = true; break; }
      const hint = await G(`(() => { const goal = ${goalExpr}; return goal && window.__bot.steerHint(goal.x, goal.y); })()`);
      if (!hint) break;
      if (touch) {
        if (!stick) {
          const home = await G('(() => { const t = g.ui.touch; t.layout(); const b = g.display; return { x: Math.round(b.safe.left + 6 + 22 + 16), y: Math.round(b.height - b.safe.bottom - 6 - 22 - 16) }; })()');
          stick = await toClient(home);
          await touchMove('touchStart', stick.x, stick.y);
        }
        const k = (await G('g.display.scale / g.display.dpr')) * 20;
        await touchMove('touchMove', stick.x + hint.x * k, stick.y + hint.y * k);
      } else {
        const want = new Set();
        if (hint.x > 0.38) want.add('d'); if (hint.x < -0.38) want.add('a');
        if (hint.y > 0.38) want.add('s'); if (hint.y < -0.38) want.add('w');
        await setKeys(want);
      }
      await sleep(40);
    }
    if (touch && stick) await touchMove('touchEnd', 0, 0);
    else await setKeys(new Set());
    await gsleep(0.15);
    return ok;
  }
  async function interact() {
    if (touch) await tapTarget('touch:interact');
    else await page.keyboard.press('e');
    await gsleep(0.2);
  }
  /** Advance an open dialogue; `choose(texts) -> index` picks a choice (default: first). */
  async function runDialogue(choose = () => 0, max = 60) {
    for (let i = 0; i < max; i++) {
      if (!(await G("g.ui.isOpen('dialogue')"))) return true;
      const choices = await G(`(() => { const out = []; for (let i = 0; i < 9; i++) { if (!g.ui.findTarget('choice-' + i)) break; out.push(i); } return out.length; })()`);
      if (choices > 0) {
        const texts = await G(`g.ui.current === 'dialogue' ? (window.__lastChoices || []) : []`);
        const idx = Math.min(choices - 1, choose(texts, choices));
        await tapTarget(`choice-${idx}`);
        await gsleep(0.15);
      } else await confirmUI();
    }
    return !(await G("g.ui.isOpen('dialogue')"));
  }
  async function closePanels() {
    for (let i = 0; i < 6 && await G('!!g.ui.current'); i++) {
      if (touch) {
        const id = await G(`g.ui.current === 'crafting' ? 'craft-close' : g.ui.current === 'inventory' ? 'inv-close' : g.ui.current === 'pause' ? 'resume' : null`);
        if (id) await tapTarget(id, { required: false }); else await confirmUI();
      } else await page.keyboard.press('Escape');
      await gsleep(0.2);
    }
  }
  const bot = {
    run: (mode, opts) => ev(([m, o]) => window.__bot.run(m, o), [mode, opts || {}]),
    async until(mode, opts = {}, realTimeout = 240000) {
      await bot.run(mode, opts);
      const start = Date.now();
      while (Date.now() - start < realTimeout) {
        const s = await ev(() => ({ ...window.__bot.status, scene: window.game.scenes.currentName, ui: window.game.ui.current }));
        if (s.done) return s.result;
        if (s.ui === 'dialogue') await runDialogue(); // e.g. a sign the bot bumped into
        else if (s.ui && s.ui !== 'dialogue' && !['gameover', 'victory'].includes(s.ui)) await closePanels();
        if (['gameover', 'victory'].includes(s.scene)) return s.scene;
        await sleep(250);
      }
      await ev(() => window.__bot.stop());
      return 'realtimeout';
    },
    stop: () => ev(() => window.__bot.stop()),
  };
  const installBot = () => ev(async () => {
    const m = await import('/scripts/lib/bot.js');
    m.installBot(window.game);
    window.__toasts = [];
    window.__dmg = window.__dmg || {};
    window.game.bus.on('player:damaged', ({ amount, source, dot } = {}) => {
      const k = (source?.def?.id || source?.caster?.def?.id || source?.source?.def?.id || source?.constructor?.name || 'hazard') + (dot ? '(dot)' : '');
      window.__dmg[k] = Math.round((window.__dmg[k] || 0) + amount);
    });
    window.game.bus.on('ui:toast', ({ text } = {}) => { window.__toasts.push(text); if (window.__toasts.length > 12) window.__toasts.shift(); });
  });
  const lastToasts = () => G('(window.__toasts || []).slice(-4).join(" / ")');
  const entityExpr = (pred) => `g.entities.list.find((e) => ${pred})`;
  const posOf = (pred) => `(() => { const e = ${entityExpr(pred)}; return e ? { x: e.x, y: e.y + 6 } : null; })()`;
  /** Walk up to an entity with real inputs and interact with it. */
  async function goInteract(pred, label) {
    const reached = await walkTo(posOf(pred), `g.interactTarget && g.interactTarget === ${entityExpr(pred)}`);
    check(reached, `walk to ${label} (${touch ? 'joystick' : 'keyboard'})`);
    if (!reached) return false;
    await interact();
    return true;
  }
  /** Let the autopilot take us to a door/entity and use it. */
  async function botUse(pred, label, opts = {}) {
    const id = await G(`(${entityExpr(pred)} || {}).id ?? null`);
    if (id == null) { check(false, `${label} exists`); return false; }
    let r = await bot.until('goto', { interactId: id, ...opts });
    // an ambush room seals itself (arcane barriers) until its waves are beaten - fight, then try again
    for (let i = 0; i < 3 && r === 'unreachable' && await G("g.entities.list.some((e) => e.constructor.name === 'Barrier' && !e.dead)"); i++) {
      console.log(`  [${vpName}] ${label}: sealed in by an ambush, fighting it out`);
      await bot.until('fight', { maxTime: 120 });
      r = await bot.until('goto', { interactId: id, ...opts });
    }
    return check(r === 'interacted', `${label}: autopilot reached and used it (${r})`);
  }
  async function travelWait(to) {
    try { await waitScene(to, 20000); await gsleep(0.6); return true; } catch { return false; }
  }

  try {
    console.log(`\n=== ${vpName} (${touch ? 'touch' : 'keyboard+mouse'}) timescale ${TIMESCALE} ===`);
    // ---------------------------------------------------------------------- 1. title -> new game
    await page.goto(`${BASE}?timescale=${TIMESCALE}`);
    await ev(() => localStorage.clear());
    await page.reload();
    await waitScene('title');
    await sleep(900);
    await shot('title');
    await tapTarget('new-game');
    // a fresh profile has no save, but the title may still ask for confirmation
    await sleep(300);
    if (await G("g.scenes.currentName === 'title'")) await tapTarget('confirm-yes', { required: false });
    check(await travelWait('hub'), 'New Game from the title enters the Academy');
    await installBot();
    await gsleep(1.6);
    await shot('hub-start');
    const obj0 = await G('g.world.getObjective(g)');
    check(/Headmaster/i.test(obj0), `first objective points at the Headmaster: "${obj0}"`);
    await mark('start');

    // ---------------------------------------------------------------------- 2. Headmaster
    if (await goInteract("e.npc && e.npc.id === 'headmaster'", 'Headmaster')) {
      await gsleep(0.4);
      check(await G("g.ui.isOpen('dialogue')"), 'Headmaster dialogue opens');
      await shot('headmaster-dialogue');
      await runDialogue();
    }
    check(await G('g.state.flags.metHeadmaster === true'), 'metHeadmaster set');
    check(await G("g.state.inventory.find((s) => s.id === 'potion_health')?.qty >= 5"), 'Headmaster gift potions received');
    await mark('met headmaster');

    // ---------------------------------------------------------------------- 3. Forge-Master + craft
    if (await goInteract("e.npc && e.npc.id === 'artificer'", 'Forge-Master Brindle')) {
      await gsleep(0.4);
      await runDialogue();
      await gsleep(0.4);
    }
    let crafting = await G("g.ui.isOpen('crafting')");
    if (!crafting) {
      // the Forge station itself (or C) also opens the panel
      if (touch) await tapTarget('touch:craft', { required: false }); else await page.keyboard.press('c');
      await gsleep(0.3);
      crafting = await G("g.ui.isOpen('crafting')");
    }
    check(crafting, 'Arcane Forge opens');
    const fragsBefore = await G('({ ...g.state.fragments })');
    if (crafting) {
      await gsleep(0.5);
      await shot('forge-open');
      await tapTarget('craft-el-fire');
      await tapTarget('craft-el-ice');
      await gsleep(0.2);
      await shot('forge-fire-ice');
      await tapTarget('craft-go');
      await gsleep(1.6);
      await shot('forge-result');
      // bind to slot 4
      for (let i = 0; i < 20 && !(await ev(() => window.game.ui.findTarget('craft-assign-3'))); i++) { await confirmUI(); await gsleep(0.1); }
      await tapTarget('craft-assign-3', { required: false });
      await gsleep(0.4);
      await closePanels();
    }
    const crafted1 = await G('g.state.spells.crafted.length');
    check(crafted1 >= 1, `first spell crafted with the Forge UI (crafted=${crafted1})`);
    check(await G('!!g.state.loadout[3]'), `crafted spell bound to slot 4 (${await G('g.state.loadout[3]')})`);
    check(await G('g.state.flags.firstCraft === true'), 'firstCraft set');
    const fragsAfter = await G('({ ...g.state.fragments })');
    check(fragsAfter.fire < fragsBefore.fire + 3 || fragsAfter.ice < fragsBefore.ice + 3, `fragments spent on the craft (${JSON.stringify(fragsBefore)} -> ${JSON.stringify(fragsAfter)})`);
    await mark('first craft');

    // ---------------------------------------------------------------------- shared: death -> respawn
    let deaths = 0;
    async function handleDeath(where) {
      deaths++;
      console.log(`  [${vpName}] died (${where}); damage taken since last death: ${await G('JSON.stringify(window.__dmg || {})')}`);
      await ev(() => { window.__dmg = {}; });
      const ok = await waitFor("g.scenes.currentName === 'gameover'", 20000).then(() => true, () => false);
      check(ok, `HP 0 -> game over screen (${where})`);
      await gsleep(2.5);
      if (deaths === 1) await shot('gameover');
      await tapTarget('respawn');
      const home = await travelWait('hub');
      check(home, 'Rise Again returns to the Academy');
      const resp = await G('({ hp: g.state.player.hp, max: g.state.player.maxHp, x: Math.round(g.player.x / 16), y: Math.round(g.player.y / 16), deaths: g.state.stats.deaths })');
      check(resp.hp === resp.max && resp.deaths >= deaths, `respawned at the Academy with full HP (tile ${resp.x},${resp.y}, deaths ${resp.deaths})`);
      await gsleep(1.2);
      const healer = await G("g.ui.isOpen('dialogue')");
      if (deaths === 1) { check(healer, 'healer greets you after respawn'); await shot('respawn-healer'); }
      await runDialogue();
      await mark(`death ${deaths} (${where})`);
    }
    const dead = (r) => r === 'died' || r === 'gameover';
    const portal = "e.tags.has('door') && e.sprite === 'prop_portal'";
    /** From the hub: use the Delving Portal and pick the deepest waystone <= want. Returns the depth entered. */
    async function portalDown(want) {
      if (!(await botUse(portal, 'Delving Portal'))) return 0;
      await gsleep(0.3);
      const texts = await G("(() => { const d = g.world.getDialogue(g, 'portal_menu'); return d.nodes[d.start].choices.map((c) => c.text); })()");
      let best = 0, bestD = 0;
      texts.forEach((t, i) => { const m = /^Depth (\d+)/.exec(t); if (m && +m[1] <= want && +m[1] >= bestD) { bestD = +m[1]; best = i; } });
      if (deaths === 0 && want === 1) await shot('portal-menu');
      await runDialogue(() => best, 4);
      const ok = await travelWait('dungeon');
      check(ok, `portal waystone "${texts[best]}" leads down`);
      return ok ? G('g.level.data.depth') : 0;
    }

    // ---------------------------------------------------------------------- 4. dungeon depths
    let depth = await portalDown(1);
    let equipDone = false, realCastDone = false, forcedDeath = false;
    for (let guard = 0; guard < 12 && depth > 0; guard++) {
      const lvl = await G('({ name: g.level.name, depth: g.level.data.depth })');
      check(lvl.depth === depth, `entered ${lvl.name}`);
      await gsleep(1);
      await shot(`dungeon-d${depth}`);
      if (!realCastDone) {
        // real inputs: aim + cast + dash + potion against the first foe we meet
        const foeId = await G("(g.entities.list.filter((e) => e.tags.has('enemy') && !e.dead).sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y))[0] || {}).id ?? null");
        if (foeId != null) {
          await bot.run('goto', { x: 0, y: 0, interactId: foeId, fightOnWay: false });
          for (let i = 0; i < 200; i++) {
            if (await G("!g.player || g.entities.list.some((e) => e.tags.has('enemy') && !e.dead && Math.hypot(e.x - g.player.x, e.y - g.player.y) < 110)")) break;
            await sleep(100);
          }
          await bot.stop();
          await ev(() => { const s = window.game.state.player; s.hp = s.maxHp; });
          const before = await G('g.state.stats.spellsCast');
          if (touch) { await tapTarget('touch:spell1'); await gsleep(0.3); await tapTarget('touch:spell1'); }
          else {
            const foe = await G(`(() => { const e = g.entities.get(${foeId}) || g.entities.list.find((e) => e.tags.has('enemy') && !e.dead); return e ? g.camera.worldToScreen(e.x, e.y - 8) : null; })()`);
            if (foe) { const c = await toClient(foe); await page.mouse.move(c.x, c.y); await page.mouse.move(c.x + 2, c.y + 1); }
            await page.keyboard.press('1');
            await gsleep(0.4);
            await page.keyboard.press('2');
          }
          await gsleep(0.3);
          await shot('first-fight-cast');
          check(await G('g.state.stats.spellsCast') > before, `spell cast with ${touch ? 'touch spell button' : 'key 1 + mouse aim'}`);
          if (touch) await tapTarget('touch:dash'); else await page.keyboard.press('Shift');
          await gsleep(0.05);
          check(await G('g.player?.dashCd > 0'), `dash with ${touch ? 'touch dash button' : 'Shift'}`);
          await gsleep(1);
          if (!touch) { await page.mouse.click(640, 360, { button: 'right' }); await gsleep(0.05); check(await G('g.player?.dashCd > 0.5'), 'dash with right mouse button'); }
          await ev(() => { const s = window.game.state.player; s.hp = Math.min(s.hp, s.maxHp - 30); }); // (debug) take a scratch so a potion has an effect
          const pots = await G("g.state.inventory.find((s) => s.id === 'potion_health')?.qty || 0");
          if (touch) await tapTarget('touch:potion'); else await page.keyboard.press('q');
          await gsleep(0.2);
          check(await G("g.state.inventory.find((s) => s.id === 'potion_health')?.qty || 0") === pots - 1, `potion quaffed with ${touch ? 'touch potion button' : 'Q'}`);
          realCastDone = true;
        }
      }
      const res = await bot.until('clear', { maxTime: 420 });
      const st = await G('({ hp: Math.round(g.state.player.hp), kills: g.state.stats.kills, cleared: !!g.state.flags[`clearedDepth${g.level?.data?.depth}`] })');
      console.log(`  [${vpName}] depth ${depth}: autopilot ${res}, hp ${st.hp}, kills ${st.kills}, cleared ${st.cleared}, skipped [${await G('window.__bot.skipped.splice(0).join("; ")')}]${res === 'timeout' ? ', last goal ' + (await G('window.__bot.goal')) : ''}`);
      if (dead(res)) {
        await handleDeath(`depth ${depth}`);
        depth = await portalDown(depth);
        continue;
      }
      check(res === 'cleared' || res === 'timeout', `depth ${depth} crawled by the autopilot (${res})`);
      await shot(`dungeon-d${depth}-cleared`);
      await mark(`depth ${depth} cleared`);

      // equip new gear found so far (bag UI)
      if (!equipDone) {
        const gear = await G("(() => { const inv = g.state.inventory; const i = inv.findIndex((s) => { const it = g.combat.getItem(s.id); return it && (it.slot === 'staff' || it.slot === 'robe') && g.state.equipped[it.slot] !== s.id; }); return i < 0 ? null : { index: i, id: inv[i].id, slot: g.combat.getItem(inv[i].id).slot }; })()");
        if (gear) {
          const regenBefore = await G('g.state.player.manaRegen');
          if (touch) await tapTarget('touch:inventory'); else await page.keyboard.press('i');
          await gsleep(0.4);
          check(await G("g.ui.isOpen('inventory')"), 'bag opens');
          await tapTarget(`inv-item-${gear.index}`);
          await gsleep(0.2);
          await shot('bag-gear-focused');
          if (await G(`g.state.equipped['${gear.slot}'] !== '${gear.id}'`)) await tapTarget('inv-action');
          await gsleep(0.3);
          const now = await G(`g.state.equipped['${gear.slot}']`);
          check(now === gear.id, `equipped ${gear.id} from the bag (${gear.slot}); mana regen ${regenBefore} -> ${await G('g.state.player.manaRegen')}`);
          await shot('bag-equipped');
          await closePanels();
          equipDone = true;
        }
      }

      // the brief requires a death: if the autopilot has not died by depth 2, stand in a fight at 1 HP
      if (depth === 2 && deaths === 0 && !forcedDeath) {
        forcedDeath = true;
        await ev(() => { const s = window.game.state; s.player.hp = 1; s.inventory = s.inventory.filter((x) => x.id !== 'potion_health' || (window.__stash = x.qty, false)); });
        if (!(await G("g.entities.list.some((e) => e.tags.has('enemy') && !e.dead)"))) await ev(() => { const g = window.game; g.combat.spawnEnemy(g, 'armor_knight', g.player.x + 40, g.player.y, { aggro: true }); });
        await bot.run('idle');
        const died = await waitFor("g.scenes.currentName === 'gameover' || g.state.player.hp <= 0", 60000).then(() => true, () => false);
        if (!died) await ev(() => { const g = window.game; g.combat.damage(g, g.player, { amount: 999, element: 'physical' }); });
        await handleDeath('depth 2, 1 HP on purpose');
        await ev(() => { const g = window.game; if (window.__stash) g.state.inventory.push({ id: 'potion_health', qty: window.__stash }); });
        depth = await portalDown(2);
        continue;
      }

      if (depth < 3) {
        const stairs = "e.tags.has('door') && e.sprite === 'prop_stairs_down'";
        if (await botUse(stairs, `stairs to depth ${depth + 1}`) && check(await travelWait('dungeon'), `descend to depth ${depth + 1}`)) { depth++; continue; }
        break;
      }
      break;
    }
    check(await G('!!g.state.flags.reachedDepth3'), 'reached depth 3 (Frozen Crypts)');
    check(deaths >= 1, `died at least once (${deaths})`);
    if (await scene() === 'dungeon') {
      let ok = await botUse(portal, 'return portal');
      if (!ok) {
        const why = await G("({ barriers: g.entities.list.filter((e) => e.constructor.name === 'Barrier').length, foes: g.entities.list.filter((e) => e.tags.has('enemy') && !e.dead).length, p: [Math.round(g.player.x / 16), Math.round(g.player.y / 16)] })");
        console.log(`  [${vpName}] return portal unreachable: ${JSON.stringify(why)}`);
        await shot('portal-unreachable');
        await bot.until('fight', { maxTime: 120 });
        ok = await botUse(portal, 'return portal (retry)');
      }
      check(await travelWait('hub'), 'return portal leads home');
    }
    await mark('home from dungeon');

    // ---------------------------------------------------------------------- 5. second craft + tower unlock
    async function forgeCraft(slot) {
      const rec = await G("(() => { const r = g.combat.listRecipes().filter((r) => g.combat.canCraft(g.state, r.id).ok); r.sort((a, b) => (b.tier || 1) - (a.tier || 1) || b.inputs.length - a.inputs.length); return r[0] ? { id: r[0].id, inputs: r[0].inputs, form: r[0].form, name: r[0].name || r[0].result } : null; })()");
      if (!rec) return null;
      await botUse("e.tags.has('station')", 'Arcane Forge station');
      await gsleep(0.4);
      if (!(await G("g.ui.isOpen('crafting')"))) { if (touch) await tapTarget('touch:craft', { required: false }); else await page.keyboard.press('c'); await gsleep(0.3); }
      for (const el of rec.inputs) await tapTarget(`craft-el-${el}`);
      if (rec.form) await tapTarget(`craft-form-${rec.form}`, { required: false });
      await gsleep(0.2);
      await shot('forge-craft');
      await tapTarget('craft-go');
      await gsleep(1.6);
      for (let i = 0; i < 20 && !(await ev((s) => window.game.ui.findTarget('craft-assign-' + s), slot)); i++) { await confirmUI(); await gsleep(0.1); }
      await tapTarget(`craft-assign-${slot}`, { required: false });
      await gsleep(0.3);
      await closePanels();
      return rec;
    }
    const fr = await G('({ ...g.state.fragments })');
    console.log(`  [${vpName}] fragments after the dungeons: ${JSON.stringify(fr)}`);
    const rec2 = await forgeCraft(2);
    check(!!rec2, `a second recipe is affordable from dungeon loot (${rec2 ? rec2.name + ' ' + rec2.inputs.join('+') : 'none'})`);
    const crafted2 = await G('g.state.spells.crafted.length');
    check(crafted2 >= 2, `second spell crafted (crafted=${crafted2}, loadout ${await G("g.state.loadout.join(',')")})`);

    if (await goInteract("e.npc && e.npc.id === 'headmaster'", 'Headmaster (tower)')) { await gsleep(0.3); await runDialogue(); }
    check(await G('!!g.state.flags.towerUnlocked'), 'Headmaster lifts the tower seal');
    await mark('tower unlocked');

    // ---------------------------------------------------------------------- 6. save / continue across a reload
    const snapExpr = 'JSON.stringify({ f: g.state.flags, c: g.state.spells.crafted, l: g.state.loadout, e: g.state.equipped, fr: g.state.fragments })';
    const snap = await G(snapExpr);
    await page.reload();
    await waitScene('title');
    await sleep(600);
    check(await ev(() => !!window.game.ui.findTarget('continue')), 'title offers Continue after a reload');
    await shot('title-continue');
    await tapTarget('continue');
    check(await travelWait('hub'), 'Continue loads into the Academy');
    await installBot();
    const snap2 = await G(snapExpr);
    if (!check(snap === snap2, 'saved progress (flags, spells, loadout, gear, fragments) survives the reload')) console.log(`   before ${snap}\n   after  ${snap2}`);

    // ---------------------------------------------------------------------- 7. tower floors + 8. boss
    const towerDoor = "e.tags.has('door') && e.sprite === 'prop_tower_door'";
    let won = false;
    let shotF5 = false, shotBoss = false, towerShots = 0;
    for (let guard = 0; guard < 30 && !won; guard++) {
      const sc = await scene();
      if (sc === 'hub') {
        if (!(await G('!!g.state.flags.towerUnlocked'))) { check(false, 'tower still sealed; cannot climb'); break; }
        // more crafted spells open the higher wards; craft whenever loot allows
        if (await G('g.state.spells.crafted.length') < 3 && await G("g.combat.listRecipes().some((r) => g.combat.canCraft(g.state, r.id).ok)")) await forgeCraft(1);
        const used = await botUse(towerDoor, 'Mage Tower door');
        await gsleep(0.3);
        if (await G("g.ui.isOpen('dialogue')")) await runDialogue();
        const moved = used && await waitFor("!g.scenes.transitioning && g.player && g.scenes.currentName !== 'hub'", 8000).then(() => true, () => false);
        if (!moved) {
          const t = await lastToasts();
          check(false, `tower door refused: ${t} (fragments ${JSON.stringify(await G('g.state.fragments'))})`);
          // debug: make the next craft affordable so the run can continue, and record it as a balance problem
          await ev(() => { const s = window.game.state.fragments; for (const k of Object.keys(s)) s[k] += 10; });
          await forgeCraft(1);
        }
        continue;
      }
      if (sc === 'tower') {
        const floor = await G('g.level.data.floor');
        await gsleep(1.5);
        if (floor === 1 && towerShots++ === 0) await shot('tower-f1');
        if (floor === 5 && !shotF5) { shotF5 = true; await shot('tower-f5'); }
        let cleared = await G(`!!g.state.flags.towerFloor${floor}Cleared`);
        let died = false;
        for (let k = 0; k < 8 && !cleared; k++) {
          const r = await bot.until('fight', { maxTime: 150 });
          if (dead(r)) { died = true; break; }
          await gsleep(2);
          cleared = await G(`!!g.state.flags.towerFloor${floor}Cleared`);
        }
        if (died) { await handleDeath(`tower floor ${floor}`); continue; }
        check(cleared, `tower floor ${floor} cleared (hp ${Math.round(await G('g.state.player.hp'))})`);
        await mark(`tower ${floor} cleared`);
        if (floor === 3) await shot('tower-f3-cleared');
        const lr = await bot.until('clear', { maxTime: 40 }); // loot the reward chest
        if (dead(lr)) { await handleDeath(`tower floor ${floor} loot`); continue; }
        const used = await botUse("e.tags.has('door') && e.sprite === 'prop_stairs_up'", floor < 5 ? `stairs to floor ${floor + 1}` : 'stairs to the summit');
        await gsleep(0.3);
        if (await G("g.ui.isOpen('dialogue')")) await runDialogue();
        if (used) await waitFor(`!g.scenes.transitioning && g.player && (g.scenes.currentName === 'boss' || (g.scenes.currentName === 'tower' && g.level.data.floor === ${floor + 1}))`, 15000).catch(() => {});
        if (await scene() === 'tower' && await G('g.level.data.floor') === floor) {
          console.log(`  [${vpName}] stairs refused on floor ${floor}: ${await lastToasts()} -> home to craft`);
          await botUse("e.tags.has('door') && e.sprite === 'prop_stairs_down'", 'leave tower to craft');
          await travelWait('hub');
          if (await G('!g.combat.listRecipes().some((r) => g.combat.canCraft(g.state, r.id).ok)')) {
            check(false, `ward on floor ${floor + 1} needs a craft the loot cannot pay for (${JSON.stringify(await G('g.state.fragments'))})`);
            await ev(() => { const s = window.game.state.fragments; for (const k of Object.keys(s)) s[k] += 10; });
          }
        }
        continue;
      }
      if (sc === 'boss') {
        await gsleep(1.5);
        if (!shotBoss) { shotBoss = true; await shot('boss-intro'); }
        const r = await bot.until('fight', { maxTime: 600 }, 400000);
        const st = await G("({ scene: g.scenes.currentName, phase: g.entities.withTag('boss')[0]?.phase, bossHp: Math.round(g.entities.withTag('boss')[0]?.hp || 0), hp: Math.round(g.state.player.hp) })");
        console.log(`  [${vpName}] boss fight: ${r} ${JSON.stringify(st)}`);
        if (await G('!!g.state.flags.archmageDefeated')) { won = true; break; }
        if (dead(r) || st.scene === 'gameover') { await handleDeath('boss'); continue; }
        continue;
      }
      if (sc === 'gameover') { await handleDeath('?'); continue; }
      await sleep(500);
    }
    check(won, 'the Corrupted Archmage is defeated');
    await mark('boss defeated');
    check(await waitFor("g.scenes.currentName === 'victory'", 30000).then(() => true, () => false), 'victory screen');
    await sleep(3000);
    await shot('victory');
    await sleep(9000);
    await shot('victory-settled');
    const stats = await G('({ ...g.state.stats })');
    timeline.push({ label: 'victory', gameTime: Math.round(stats.playTime) });
    console.log(`  [${vpName}] stats ${JSON.stringify(stats)}`);
  } catch (err) {
    problems.push(`crashed: ${err.stack || err}`);
    try { await shot('crash'); } catch { /* ignore */ }
  } finally {
    await context.close();
  }
  results.push({ vpName, passed: passed.length, problems, timeline, realSeconds: Math.round((Date.now() - t0) / 1000) });
}

const which = process.env.VP ? [process.env.VP] : ['desktop', 'phone'];
for (const vp of which) await runViewport(vp);
await browser.close();
server.close();

let failed = 0;
for (const r of results) {
  console.log(`\n${r.vpName}: ${r.passed} checks passed, ${r.problems.length} problem(s), ${r.realSeconds}s real time`);
  console.log('  timeline (game seconds): ' + r.timeline.map((t) => `${t.label}@${t.gameTime}`).join(' | '));
  for (const p of r.problems) console.log('  - ' + p);
  failed += r.problems.length;
}
console.log(failed ? '\nPLAYTHROUGH FAILED' : '\nPLAYTHROUGH PASSED');
process.exit(failed ? 1 : 0);
