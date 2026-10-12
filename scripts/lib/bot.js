// In-page autopilot for scripts/playthrough.mjs and scripts/perf.mjs (dev-only, never shipped).
//
// installBot(game) registers an InputSource (ARCHITECTURE.md §5): the bot drives the game through the
// exact same input pipeline as the keyboard and the touch controls (move vector, spell1-4 held,
// dash/potion/interact taps, aim vector). It never edits game state.
//
// Modes (window.__bot.run(mode, opts)):
//   'goto'   {x, y, near=8, interactId?}  path-find to a point; optionally interact with an entity
//   'clear'  {maxTime}                     fight every reachable enemy, collect pickups, open chests/geodes
//   'fight'  {maxTime}                     fight enemies only (tower waves, boss), never wanders to loot
//   'idle'                                 stand still (optionally {wander: true} near enemies)
// window.__bot.status -> {mode, done, result, t}
export function installBot(game) {
  const T = 16;
  const bot = {
    mode: 'off', opts: {}, done: true, result: null, t: 0,
    move: { x: 0, y: 0 }, aim: null, held: new Set(), taps: new Set(),
    path: null, pathGoal: null, pathT: 0, stuckT: 0, lastX: 0, lastY: 0,
    strafe: 1, strafeT: 0, castIdx: 0, potionT: 0, ignore: new Set(), stats: { casts: 0, dashes: 0, potions: 0 },
    log: [], skipped: [],
  };

  const hazardAt = (px, py) => { const d = game.level.map.defsAt?.(px, py); return !!(d && ((d.ground && d.ground.hazard) || (d.deco && d.deco.hazard))); };
  // hazards (lava, poison) count as walls for the autopilot, like a careful player
  const solid = (tx, ty) => game.level.map.isSolid(tx, ty, 'walk') || hazardAt(tx * T + 8, ty * T + 8);
  const tileOf = (v) => Math.floor(v / T);

  function bfs(fx, fy, gx, gy, near = 0) {
    const map = game.level.map, W = map.w, H = map.h;
    const sx = tileOf(fx), sy = tileOf(fy), tx = tileOf(gx), ty = tileOf(gy);
    const prev = new Int32Array(W * H).fill(-2);
    const q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    const s = sy * W + sx;
    prev[s] = -1; q[qt++] = s;
    let found = -1;
    const goalOk = (x, y) => Math.abs(x - tx) <= near && Math.abs(y - ty) <= near;
    while (qh < qt) {
      const c = q[qh++];
      const cx = c % W, cy = (c / W) | 0;
      if (goalOk(cx, cy)) { found = c; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (prev[n] !== -2) continue;
        if (solid(nx, ny) && !(nx === tx && ny === ty && near === 0 && false)) continue;
        if (dx && dy && (solid(cx + dx, cy) || solid(cx, cy + dy))) continue;
        prev[n] = c; q[qt++] = n;
      }
    }
    if (found < 0) return null;
    const out = [];
    for (let c = found; c !== -1 && c !== s; c = prev[c]) out.push({ x: (c % W) * T + 8, y: ((c / W) | 0) * T + 8 });
    out.reverse();
    return out;
  }

  function clearLine(x0, y0, x1, y1) {
    const map = game.level.map;
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 4);
    const px = -(y1 - y0) / (d || 1), py = (x1 - x0) / (d || 1);
    for (let i = 0; i <= n; i++) {
      const k = i / (n || 1), x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
      for (const o of [-5, 0, 5]) if (map.isSolidAt(x + px * o, y + py * o, 'walk') || hazardAt(x + px * o, y + py * o)) return false;
    }
    return true;
  }
  /** Line of fire for a ~3 px projectile (samples the centre line and both edges). */
  function los(x0, y0, x1, y1) {
    const map = game.level.map;
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 3);
    const px = -(y1 - y0) / (d || 1) * 3.5, py = (x1 - x0) / (d || 1) * 3.5;
    for (let i = 1; i < n; i++) {
      const k = i / n, x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k;
      if (map.isSolidAt(x, y, 'shot') || map.isSolidAt(x + px, y + py, 'shot') || map.isSolidAt(x - px, y - py, 'shot')) return false;
    }
    return true;
  }

  /** Steer toward (gx, gy) along a BFS path. Returns remaining distance or -1 if unreachable. */
  function steerTo(gx, gy, near = 0) {
    const p = game.player;
    const direct = Math.hypot(gx - p.x, gy - p.y);
    if (direct < 40 && clearLine(p.x, p.y, gx, gy)) { setMoveToward(gx, gy, direct); return direct; }
    bot.pathT -= 1 / 60;
    const goalKey = `${tileOf(gx)},${tileOf(gy)}`;
    if (!bot.path || bot.pathGoal !== goalKey || bot.pathT <= 0) {
      bot.path = bfs(p.x, p.y, gx, gy, near);
      bot.pathGoal = goalKey; bot.pathT = 0.6;
      if (!bot.path) return -1;
    }
    const path = bot.path;
    while (path.length && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 6) path.shift();
    while (path.length > 1 && clearLine(p.x, p.y, path[1].x, path[1].y) && Math.hypot(path[1].x - p.x, path[1].y - p.y) < 80) path.shift();
    const w = path[0] || { x: gx, y: gy };
    setMoveToward(w.x, w.y, 99);
    return direct;
  }
  function setMoveToward(x, y, dist) {
    const p = game.player;
    const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy) || 1;
    const k = dist < 4 ? 0 : 1;
    bot.move.x = (dx / d) * k; bot.move.y = (dy / d) * k;
  }

  const alive = (e) => e && !e.dead && !e.dying && (e.hp ?? 1) > 0;
  const enemies = () => game.entities.list.filter((e) => e.tags.has('enemy') && alive(e) && !bot.ignore.has(e.id));

  /** Steers out of danger (sets bot.move) and returns true when a dash is warranted and ready. */
  function threatDodge() {
    const p = game.player;
    const canDash = p.dashCd <= 0 && p.dashT <= 0;
    const found = findThreat(p);
    return found && canDash;
  }
  function findThreat(p) {
    for (const e of game.entities.list) {
      if (!e.dead && e.state === 'charge' && e.tags?.has('enemy')) {
        // a charging lancer: sidestep perpendicular to its run if it is heading at us
        const vx = Math.cos(e.facing || 0), vy = Math.sin(e.facing || 0);
        const along = (p.x - e.x) * vx + (p.y - e.y) * vy, side = -(p.x - e.x) * vy + (p.y - e.y) * vx;
        if (along > -4 && along < 90 && Math.abs(side) < 16) {
          const sgn = side >= 0 ? 1 : -1;
          bot.move.x = -vy * sgn; bot.move.y = vx * sgn;
          return true;
        }
      }
      if (e.dead) continue;
      const name = e.constructor?.name;
      if (name === 'Shockwave' && e.team === 'enemy') {
        // expanding ring: dash THROUGH the wave front (i-frames), never away from it
        const front = (e.r0 || 0) + ((e.r1 || 0) - (e.r0 || 0)) * Math.min(1, (e.age || 0) / (e.dur || 1));
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d > front && d - front < 14) {
          bot.move.x = (e.x - p.x) / (d || 1); bot.move.y = (e.y - p.y) / (d || 1);
          return true;
        }
        continue;
      }
      if (name === 'Telegraph' && e.progress > (e.shape === 'line' ? 0.25 : 0.62)) {
        if (e.shape === 'ring') continue; // handled by the Shockwave it spawns
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (e.shape === 'line') {
          // sidestep out of the thrust lane
          const ax = Math.cos(e.angle || 0), ay = Math.sin(e.angle || 0);
          const along = (p.x - e.x) * ax + (p.y - e.y) * ay, side = -(p.x - e.x) * ay + (p.y - e.y) * ax;
          if (along > -6 && along < (e.length || 60) + 8 && Math.abs(side) < (e.width || 10) / 2 + 8) {
            const sgn = side >= 0 ? 1 : -1;
            bot.move.x = -ay * sgn; bot.move.y = ax * sgn;
            return e.progress > 0.7; // walk out early, dash only if still in the lane late
          }
          continue;
        }
        const r = (e.shape === 'circle' ? e.r : Math.max(e.r || 0, e.length || 0)) + 6;
        if (d < r) {
          const away = d > 1 ? { x: (p.x - e.x) / d, y: (p.y - e.y) / d } : { x: 1, y: 0 };
          bot.move.x = away.x; bot.move.y = away.y;
          return true;
        }
      }
      if (e.tags.has('projectile') && e.team === 'enemy') {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < 22) {
          const vx = e.vx || 0, vy = e.vy || 0, vl = Math.hypot(vx, vy) || 1;
          if (((p.x - e.x) * vx + (p.y - e.y) * vy) / vl > 0) {
            bot.move.x = -vy / vl; bot.move.y = vx / vl;
            return true;
          }
        }
      }
    }
    return false;
  }

  function pickSlot(target) {
    const st = game.state.player, lo = game.state.loadout, p = game.player;
    const ready = [];
    for (let i = 0; i < 4; i++) {
      const sp = lo[i] && game.combat.getSpell(lo[i]);
      if (!sp) continue;
      if ((p.cooldowns.get(lo[i]) || 0) > 0 || st.mana < sp.manaCost) continue;
      ready.push({ i, sp });
    }
    if (!ready.length) return -1;
    const counter = target?.ward && game.combat.WARD_COUNTER?.[target.ward];
    if (counter) {
      const c = ready.find((r) => (r.sp.elements || [r.sp.element]).includes(counter));
      if (c) return c.i;
    }
    // prefer the strongest affordable spell against this foe's resistances, keeping a mana reserve
    const res = target?.def?.resist || {};
    const score = (sp) => (sp.damage || 0) * (1 + ((sp.count || 1) - 1) * 0.3) * /* a fan rarely lands every shard at kiting range */ (sp.elements || [sp.element]).reduce((a, el) => a + (res[el] ?? 1), 0) / (sp.elements || [sp.element]).length;
    ready.sort((a, b) => score(b.sp) - score(a.sp));
    const best = ready.find((r) => st.mana - r.sp.manaCost > 15) || ready[ready.length - 1];
    return best.i;
  }

  function fight(target, dt) {
    const p = game.player;
    // give up on foes we cannot hurt (immune, behind cover...) for a while
    if (target._botHp !== target.hp) { target._botHp = target.hp; target._botNoProg = 0; }
    else if (Math.hypot(target.x - p.x, target.y - p.y) < 170 && los(p.x, p.y - 4, target.x, target.y - 4) && (target._botNoProg = (target._botNoProg || 0) + dt) > 15) { bot.ignore.add(target.id); target._botNoProg = 0; bot.skipped.push(`foe ${target.def?.id}#${target.id}@${Math.round(target.x / 16)},${Math.round(target.y / 16)} hp${Math.round(target.hp)}`); return; }
    const st = game.state.player;
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
    const melee = target.def?.attack?.type !== 'ranged' && !target.tags.has('boss');
    const ai = target.def?.ai;
    const want = target.tags.has('boss') ? 100 : ai === 'golem' ? 105 : ai === 'sentinel' ? 95 : melee ? Math.max(72, (target.def?.attack?.range || 0) + 50) : 85;
    bot.aim = { x: dx / d, y: (dy - 2) / d };
    const see = los(p.x, p.y - 4, target.x, target.y - 4);
    if (!see || d > 170) { steerTo(target.x, target.y); return; }
    const radial = d > want + 14 ? 1 : d < want - 14 ? -1 : 0;
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeT = 1.5 + Math.random() * 1.5; if (Math.random() < 0.4) bot.strafe *= -1; }
    let mx = (dx / d) * radial * 0.8 - (dy / d) * bot.strafe * 0.6;
    let my = (dy / d) * radial * 0.8 + (dx / d) * bot.strafe * 0.6;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml; my /= ml;
    const blocked = (x, y) => game.level.map.isSolidAt(x, y, 'walk') || hazardAt(x, y);
    if (blocked(p.x + mx * 12, p.y + my * 12)) {
      bot.strafe *= -1;
      mx = (dx / d) * radial; my = (dy / d) * radial;
      if (blocked(p.x + mx * 12, p.y + my * 12)) { mx = -(dy / d) * bot.strafe; my = (dx / d) * bot.strafe; }
      if (blocked(p.x + mx * 12, p.y + my * 12)) { mx = my = 0; }
    }
    bot.move.x = mx; bot.move.y = my;
    if (threatDodge()) bot.taps.add('dash');
    const slot = pickSlot(target);
    if (slot >= 0 && d < 200) { bot.held.add('spell' + (slot + 1)); }
  }

  /** Loot goals the autopilot cannot reach in 25 s are skipped (logged in bot.skipped). */
  function giveUp(e, dt) {
    e._botT = (e._botT || 0) + dt;
    if (e._botT < 25) return false;
    bot.ignore.add(e.id);
    bot.skipped.push(`${e.constructor.name}#${e.id}@${Math.round(e.x / 16)},${Math.round(e.y / 16)}`);
    return true;
  }

  function nearestBy(list) {
    const p = game.player;
    let best = null, bd = Infinity;
    for (const e of list) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } }
    return best;
  }

  function brain(dt) {
    bot.move.x = bot.move.y = 0;
    bot.aim = null;
    bot.held.clear();
    bot.taps.clear();
    if (bot.mode === 'off' || bot.done) return;
    if (!game.player || !game.level || game.ui.blocksWorld() || game.scenes.transitioning) return;
    if (game.state.player.hp <= 0) { bot.done = true; bot.result = 'died'; return; }
    game.input.mouse.lastMoveTime = 0; // the bot aims (mouse aim would win for 4 s otherwise)
    bot.t += dt;
    bot.potionT -= dt;
    const o = bot.opts, p = game.player;
    const stp0 = game.state.player;
    if (stp0.hp / stp0.maxHp < 0.4 && bot.potionT <= 0 && game.state.inventory.some((s) => (s.id === 'potion_health' || s.id === 'elixir') && s.qty > 0)) {
      bot.taps.add('potion'); bot.potionT = 2.5; bot.stats.potions++;
    }
    if (o.maxTime && bot.t > o.maxTime) { bot.done = true; bot.result = 'timeout'; return; }

    // stuck detection
    if (Math.hypot(p.x - bot.lastX, p.y - bot.lastY) > 3) { bot.lastX = p.x; bot.lastY = p.y; bot.stuckT = 0; }
    else if (bot.mode !== 'idle') { bot.stuckT += dt; if (bot.stuckT > 1.2) { bot.path = null; bot.stuckT = 0; bot.strafe *= -1; } }

    if (bot.mode === 'goto') {
      const tgt = o.interactId != null ? game.entities.get(o.interactId) : null;
      const gx = tgt ? tgt.x : o.x, gy = tgt ? tgt.y : o.y;
      // fight anything that engages us on the way
      const foe = o.fightOnWay !== false && nearestBy(enemies().filter((e) => e.aggro && Math.hypot(e.x - p.x, e.y - p.y) < 120));
      if (foe) { fight(foe, dt); return; }
      if (tgt && game.interactTarget === tgt) { bot.taps.add('interact'); bot.done = true; bot.result = 'interacted'; return; }
      const r = steerTo(gx, gy + (tgt ? 4 : 0));
      if (r < 0) { bot.done = true; bot.result = 'unreachable'; return; }
      if (!tgt && r < (o.near ?? 8)) { bot.done = true; bot.result = 'arrived'; }
      if (threatDodge()) bot.taps.add('dash');
      return;
    }

    if (bot.mode === 'fight' || bot.mode === 'clear') {
      const foes = enemies();
      const boss = foes.find((e) => e.tags.has('boss'));
      let target = null;
      if (boss) {
        const minion = nearestBy(foes.filter((e) => e !== boss && Math.hypot(e.x - p.x, e.y - p.y) < 75));
        target = minion || boss;
      } else {
        // prefer engaged / visible foes, then anything reachable
        const engaged = foes.filter((e) => e.aggro);
        target = nearestBy(engaged.length ? engaged : foes);
      }
      if (target) {
        if (!target._botReach || (target._botReach < 0 && (target._botReachT -= dt) <= 0)) {
          // engageable if we can walk to it OR shoot it (flyers over lava / water)
          target._botReach = bfs(p.x, p.y, target.x, target.y, 1) || (Math.hypot(target.x - p.x, target.y - p.y) < 200 && los(p.x, p.y - 4, target.x, target.y - 4)) ? 1 : -1;
          target._botReachT = 2;
        }
        if (target._botReach < 0) {
          // not walkable: find a firing spot along the walkable path toward it
          const r = steerTo(target.x, target.y, 4);
          if (r < 0) { bot.ignore.add(target.id); return; }
          if (los(p.x, p.y - 4, target.x, target.y - 4) && Math.hypot(target.x - p.x, target.y - p.y) < 200) target._botReach = 1;
          return;
        }
        bot.goal = `foe ${target.def?.id || target.constructor.name} #${target.id} at ${Math.round(target.x / 16)},${Math.round(target.y / 16)} aggro=${!!target.aggro} d=${Math.round(Math.hypot(target.x - p.x, target.y - p.y))}`;
        fight(target, dt);
        return;
      }
      if (bot.mode === 'fight') {
        if (o.untilClear !== false) { bot.done = true; bot.result = 'cleared'; }
        return;
      }
      // loot
      const stp = game.state.player;
      const pick = nearestBy(game.entities.withTag('pickup').filter((e) => !e.dead && !bot.ignore.has(e.id)
        && !(e.kind === 'health' && stp.hp >= stp.maxHp) && !(e.kind === 'mana' && stp.mana >= stp.maxMana)));
      if (pick && giveUp(pick, dt)) return;
      if (pick) {
        bot.goal = `pickup #${pick.id} ${pick.kind} at ${Math.round(pick.x / 16)},${Math.round(pick.y / 16)}`;
        const r = steerTo(pick.x, pick.y);
        if (r < 0) bot.ignore.add(pick.id);
        if (r >= 0 && r < 6) { pick._botDwell = (pick._botDwell || 0) + dt; if (pick._botDwell > 1.5) bot.ignore.add(pick.id); }
        return;
      }
      const box = nearestBy(game.entities.list.filter((e) => !e.dead && !bot.ignore.has(e.id) && e.interactable
        && ((e.tags.has('chest') && !e.opened) || (e.tags.has('geode') && !e.spent))));
      if (box && giveUp(box, dt)) return;
      if (box) {
        bot.goal = `box #${box.id} at ${Math.round(box.x / 16)},${Math.round(box.y / 16)} (interactTarget ${game.interactTarget?.id})`;
        if (game.interactTarget === box) { bot.taps.add('interact'); bot.ignore.add(box.id); return; }
        const r = steerTo(box.x, box.y + 4);
        if (r < 0) bot.ignore.add(box.id);
        return;
      }
      bot.done = true; bot.result = 'cleared';
    }
  }

  const source = {
    id: 'bot',
    poll() { game.guard('bot', () => brain(1 / 60), 20); },
    getMove() { return bot.move.x || bot.move.y ? bot.move : null; },
    isDown(a) { return bot.held.has(a) || bot.taps.has(a); },
    getAim() { return bot.aim; },
  };
  game.input.addSource(source);
  // bot aim must beat other aim sources
  game.input.sources.splice(game.input.sources.indexOf(source), 1);
  game.input.sources.unshift(source);

  bot.run = (mode, opts = {}) => {
    bot.mode = mode; bot.opts = opts; bot.done = false; bot.result = null; bot.t = 0;
    bot.path = null; bot.ignore.clear(); bot.stuckT = 0;
  };
  bot.stop = () => { bot.mode = 'off'; bot.done = true; };
  bot.steerHint = (gx, gy) => {
    // direction for scripted keyboard/joystick walking: next waypoint along a BFS path
    const p = game.player;
    if (!p || !game.level) return null;
    const path = bfs(p.x, p.y, gx, gy, 0);
    if (!path) return null;
    let w = path[0] || { x: gx, y: gy };
    for (let i = 1; i < Math.min(path.length, 6); i++) if (clearLine(p.x, p.y, path[i].x, path[i].y)) w = path[i];
    if (path.length <= 1) w = { x: gx, y: gy };
    const dx = w.x - p.x, dy = w.y - p.y, d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d, dist: Math.hypot(gx - p.x, gy - p.y) };
  };
  Object.defineProperty(bot, 'status', { get: () => ({ mode: bot.mode, done: bot.done, result: bot.result, t: bot.t }) });
  window.__bot = bot;
  return bot;
}
