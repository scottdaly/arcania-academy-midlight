// Shared implementation of the four gameplay scenes (hub, dungeon, tower, boss).
// The scene asks world.buildLevel() for a Level, spawns the player via combat.createPlayer(),
// runs the per-tick update order and the render layering documented in ARCHITECTURE.md §8.
import { EV } from '../core/events.js';
import { SCENES } from '../core/config.js';

/**
 * Normalise a LevelSpec for a scene kind, filling defaults.
 * hub:     {kind:'hub', from?}
 * dungeon: {kind:'dungeon', depth=1, seed=random, element?}
 * tower:   {kind:'tower', floor=state.tower.currentFloor}
 * boss:    {kind:'boss'}
 */
function makeSpec(game, kind, params) {
  const spec = { ...params, kind };
  if (kind === SCENES.DUNGEON) {
    spec.depth = Math.max(1, Number(spec.depth) || 1);
    if (spec.seed == null || spec.seed === '') spec.seed = game.rng.int(1, 0x7fffffff);
    spec.seed = Number(spec.seed) >>> 0;
  } else if (kind === SCENES.TOWER) {
    spec.floor = Math.max(1, Number(spec.floor) || game.state.tower.currentFloor || 1);
  }
  return spec;
}

function updateInteract(game) {
  const p = game.player;
  game.interactTarget = null;
  if (!p || p.dead || game.state.player.hp <= 0) return;
  let best = null, bd = Infinity;
  for (const e of game.entities.list) {
    if (!e.interactable || e.dead || e === p) continue;
    const r = e.interactRadius + (p.radius || 0);
    const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 <= r * r && d2 < bd) { bd = d2; best = e; }
  }
  game.interactTarget = best;
  if (best && game.input.pressed('interact')) {
    game.input.consume('interact');
    best.interact(game);
    game.bus.emit(EV.INTERACT, { target: best });
  }
}

export function createWorldScene(kind) {
  return {
    name: kind,

    enter(game, params = {}) {
      const { guard } = game;
      game.entities.clear();
      guard('fx.clear', () => game.fx.clear());
      game.interactTarget = null;
      game.hitStopTimer = 0;
      const st = game.state.player;
      if (st.hp <= 0) { st.hp = st.maxHp; st.mana = st.maxMana; }

      const spec = makeSpec(game, kind, params);
      const level = game.world.buildLevel(game, spec);
      if (!level || !level.map) throw new Error(`world.buildLevel returned no map for ${kind}`);
      game.level = level;
      game.tileRenderer.setMap(level.map);
      game.camera.setView(game.display.width, game.display.height);
      game.camera.setBounds(0, 0, level.map.widthPx, level.map.heightPx);

      const sp = level.playerSpawn || { x: level.map.widthPx / 2, y: level.map.heightPx / 2 };
      const player = game.combat.createPlayer(game, sp.x, sp.y);
      game.entities.add(player);
      game.player = player;
      game.camera.follow(player, true);

      guard('audio.music', () => game.audio.music(level.music ?? kind));
      game.bus.emit(EV.LEVEL_READY, { level, spec });
      game.bus.emit(EV.PLAYER_SPAWNED, { player });
      guard('level.onEnter', () => level.onEnter?.(game));
      if (kind === SCENES.HUB) game.save();
    },

    exit(game) {
      game.guard('level.onExit', () => game.level?.onExit?.(game));
      game.entities.clear();
      game.player = null;
      game.level = null;
      game.interactTarget = null;
      game.tileRenderer.setMap(null);
      game.camera.follow(null);
    },

    update(game, dt) {
      const { guard } = game;
      if (!game.level || game.ui.blocksWorld()) return;
      if (game.hitStopTimer > 0) {
        game.hitStopTimer -= dt;
        return;
      }
      game.time += dt;
      game.state.stats.playTime += dt;
      game.updateTimers(dt);
      guard('level.update', () => game.level.update?.(game, dt));
      game.entities.update(dt);
      game.entities.separate(game.level.map);
      guard('combat.update', () => game.combat.update(game, dt));
      guard('world.update', () => game.world.update(game, dt));
      updateInteract(game);
      guard('fx.update', () => game.fx.update(dt));
      game.camera.update(dt);
    },

    render(game, ctx, alpha) {
      const { camera, level, guard } = game;
      if (!level) return;
      const W = game.display.width, H = game.display.height;
      const t = game.time;
      camera.begin(alpha);

      // 1. background
      ctx.fillStyle = level.bgColor || '#000';
      ctx.fillRect(0, 0, W, H);

      // 2-7. world space
      ctx.save();
      camera.apply(ctx);
      game.tileRenderer.renderLayer(ctx, camera, 'ground', t);
      game.tileRenderer.renderLayer(ctx, camera, 'deco', t);
      guard('level.renderBelow', () => level.renderBelow?.(ctx, game));
      guard('fx.renderGround', () => game.fx.renderGround(ctx, camera));
      game.entities.render(ctx, alpha, camera);
      guard('level.renderAbove', () => level.renderAbove?.(ctx, game));
      ctx.restore();

      // 8. lighting (screen space; fx uses camera to place lights)
      ctx.save();
      guard('fx.renderLighting', () => game.fx.renderLighting(ctx, camera, level.ambient || null));
      ctx.restore();

      // 9. additive glow: entity glow pass + particles
      ctx.save();
      camera.apply(ctx);
      ctx.globalCompositeOperation = 'lighter';
      game.entities.renderGlow(ctx);
      ctx.globalCompositeOperation = 'source-over';
      guard('fx.renderWorld', () => game.fx.renderWorld(ctx, camera));
      ctx.restore();

      // 10. world-space UI (damage numbers, prompts, health bars)
      ctx.save();
      camera.apply(ctx);
      guard('ui.renderWorld', () => game.ui.renderWorld(ctx, camera));
      ctx.restore();
    },
  };
}
