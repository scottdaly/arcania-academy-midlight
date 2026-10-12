// AUDIO public API (team: ui+audio). Contract: ARCHITECTURE.md §4.6.
// Everything is synthesised with WebAudio - no audio files:
//   synth.js  mixer graph (buses, echo send, compressor + limiter, ducking) and voice toolkit
//   sfx.js    sound recipes + voice limiting / throttling
//   music.js  look-ahead step sequencer + procedural tracks with crossfades
// The AudioContext is created lazily in unlock() (core calls it on every user gesture) because
// browsers block audio until a gesture. Every entry point is a silent no-op without WebAudio and
// never throws (the smoke test fails on any console.error).
import { EV } from '../core/events.js';
import { createEngine, clamp } from './synth.js';
import { SFX, createSfxPlayer } from './sfx.js';
import { createMusic, TRACK_NAMES } from './music.js';

/** Perceptual volume curve. */
const curve = (v) => {
  const x = clamp(Number.isFinite(+v) ? +v : 0, 0, 1);
  return x * x;
};

export function createAudio(game) {
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null, E = null, playSfx = null, mus = null;
  let failed = !AC;
  let muted = game.params?.has?.('mute') && game.params.get('mute') !== '0';
  let wantTrack = null;
  let hidden = false;
  const warned = new Set();

  function warnOnce(key, ...args) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn('[audio]', ...args);
  }

  const running = () => !!ctx && ctx.state === 'running';
  const vol = (k, d) => {
    const v = game.settings?.[k];
    return v == null ? d : v;
  };
  const musicSilent = () => muted || curve(vol('masterVolume', 0.8)) * curve(vol('musicVolume', 0.6)) <= 0;
  const sfxSilent = () => muted || curve(vol('masterVolume', 0.8)) * curve(vol('sfxVolume', 0.8)) <= 0;

  function applyVolumes(instant = false) {
    if (!E) return;
    const m = muted ? 0 : curve(vol('masterVolume', 0.8));
    const mu = curve(vol('musicVolume', 0.6));
    const sf = curve(vol('sfxVolume', 0.8));
    const set = (node, v) => {
      if (instant) node.gain.value = v;
      else E.rampGain(node, v, 0.05);
    };
    set(E.master, m);
    set(E.musicBus, mu);
    set(E.musicSend, mu);
    set(E.sfxBus, sf);
    set(E.sfxSend, sf);
  }

  /** Start the requested track once the context is actually running. */
  function syncMusic() {
    if (!mus || !running()) return;
    if (mus.requested !== wantTrack) mus.play(wantTrack);
  }

  function build() {
    try {
      try {
        ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        ctx = new AC();
      }
      E = createEngine(ctx);
      playSfx = createSfxPlayer(E);
      mus = createMusic(E);
      applyVolumes(true);
      // iOS: playing a 1-sample silent buffer inside the gesture fully unlocks output.
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      s.onended = () => { try { s.disconnect(); } catch { /* ignore */ } };
      ctx.onstatechange = () => syncMusic();
    } catch (err) {
      warnOnce('init', 'WebAudio unavailable:', err?.message || err);
      failed = true;
      ctx = E = playSfx = mus = null;
    }
  }

  /** Stereo pan + distance attenuation from a world position relative to the camera. */
  function spatial(x, y) {
    const cam = game.camera;
    if (x == null || !cam || !game.isGameplay?.()) return { pan: 0, att: 1 };
    const hw = (cam.viewW || 480) / 2, hh = (cam.viewH || 270) / 2;
    const nx = (x - cam.x) / hw;
    const ny = y == null ? 0 : (y - cam.y) / hh;
    if (!Number.isFinite(nx)) return { pan: 0, att: 1 };
    const d = Math.max(Math.abs(nx), Math.abs(ny) || 0);
    return { pan: clamp(nx, -1, 1) * 0.6, att: d > 1 ? Math.max(0.25, 1 - (d - 1) * 0.6) : 1 };
  }

  const audio = {
    /** Create/resume the AudioContext. Safe and cheap to call on every gesture. */
    unlock() {
      if (failed) return;
      if (!ctx) build();
      if (!ctx || hidden) return;
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        ctx.resume().then(syncMusic, () => {});
      } else syncMusic();
    },
    suspend() {
      hidden = true;
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    },
    resume() {
      hidden = false;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().then(syncMusic, () => {});
    },

    /**
     * Play a one-shot effect. opts: {volume=1, pitch=1, x?, y? (world px -> pan/attenuation),
     * delay? (s), key? (throttle bucket), exact? (no random variation)}. Unknown names and a
     * locked/suspended context are silently ignored.
     */
    sfx(name, opts = {}) {
      if (!running() || !playSfx || sfxSilent()) return;
      if (!SFX[name]) return;
      try {
        const o = opts || {};
        const { pan, att } = spatial(o.x, o.y);
        playSfx(name, {
          volume: (o.volume ?? 1) * att,
          pitch: o.pitch ?? 1,
          pan: o.pan ?? pan,
          delay: o.delay,
          key: o.key,
          exact: o.exact,
        });
      } catch (err) {
        warnOnce(`sfx:${name}`, `sfx "${name}" failed:`, err?.message || err);
      }
    },

    /** Switch music track: 'title'|'hub'|'dungeon'|'tower'|'boss'|'gameover'|'victory'|null. */
    music(track) {
      wantTrack = track || null;
      try {
        syncMusic();
      } catch (err) {
        warnOnce('music', 'music failed:', err?.message || err);
      }
    },
    get currentTrack() { return wantTrack; },

    setMuted(m) {
      muted = !!m;
      applyVolumes();
    },
    get muted() { return muted; },
    /** Re-read game.settings volumes (short ramps, no clicks). */
    applySettings() {
      applyVolumes();
    },
    update() {
      if (!running() || !mus) return;
      try {
        syncMusic();
        mus.update(musicSilent());
      } catch (err) {
        warnOnce('update', 'music update failed:', err?.message || err);
      }
    },

    // ---- non-contract helpers ----
    /** AudioContext state ('running' | 'suspended' | ...) or null before unlock. */
    get state() { return ctx?.state ?? null; },
    /** Play a sound at normal volume without random variation (settings menu preview). */
    preview(name) { audio.sfx(name, { exact: true }); },
    /** All public sfx names. */
    names() { return Object.keys(SFX).filter((n) => !INTERNAL.has(n)); },
    tracks() { return TRACK_NAMES.slice(); },
    /** Internal engine (debug/tests only). */
    get _engine() { return E; },
  };

  wire(game, audio, warnOnce);
  return audio;
}

const INTERNAL = new Set(['cast_swell']);

// ===================================================================== event wiring

const isPlayer = (game, e) => !!e && (e === game.player || e.team === 'player' || e.tags?.has?.('player'));

/** Material of an enemy entity for hit / death sounds. */
function material(e) {
  const d = e?.def;
  if (!d) return e?.tags?.has?.('boss') ? 'boss' : null;
  if (d.boss || e.tags?.has?.('boss')) return 'boss';
  const id = String(d.id || ''), sp = String(d.sprite || ''), ai = String(d.ai || '');
  if (id.includes('golem') || sp.includes('golem') || ai === 'brute' || ai === 'golem') return 'stone';
  if (id.includes('armor') || sp.startsWith('enemy_knight') || d.armored || (d.element === 'physical' && ai === 'knight')) return 'armor';
  if (id.includes('wisp') || d.flying) return 'magic';
  return 'flesh';
}

const CAST = (el) => (['fire', 'ice', 'lightning', 'arcane', 'earth'].includes(el) ? `cast_${el}` : 'cast_arcane');

function wire(game, audio, warnOnce) {
  const { bus } = game;
  const on = (type, fn) => {
    if (!type) return;
    bus.on(type, (p = {}) => {
      try {
        fn(p || {});
      } catch (err) {
        warnOnce(`ev:${type}`, `handler for ${type} failed:`, err?.message || err);
      }
    });
  };
  const sfx = (name, o) => audio.sfx(name, o);
  const gameplay = () => !!game.isGameplay?.();
  let lastDoor = -10, lastPickupHeal = -10;
  const now = () => game.realTime || 0;

  on(EV.SFX, ({ name, ...opts }) => sfx(name, opts));

  on(EV.SPELL_CAST, ({ caster, spellId, spell, x, y }) => {
    const sp = spell || game.combat?.getSpell?.(spellId);
    const enemy = caster?.team === 'enemy';
    const base = enemy ? 0.45 : 1;
    const key = enemy ? 'enemy' : 'player';
    const pos = { x: x ?? caster?.x, y: y ?? caster?.y };
    const els = [...new Set((sp?.elements || []).filter(Boolean))];
    const main = sp?.sfx && SFX[sp.sfx] ? sp.sfx : CAST(sp?.element);
    if (els.length > 1) {
      // combo: blend each element's voice at reduced volume
      const names = [...new Set([main, ...els.map(CAST)])];
      const v = base * (names.length > 2 ? 0.55 : 0.7);
      for (const n of names) sfx(n, { ...pos, volume: v, key: `${key}:${n}` });
    } else {
      sfx(main, { ...pos, volume: base, key: `${key}:${main}` });
    }
    if ((sp?.tier ?? 0) >= 3 && !enemy) sfx('cast_swell', { ...pos, volume: 0.9 });
  });

  on(EV.ENTITY_DAMAGED, ({ target, crit, x, y }) => {
    if (isPlayer(game, target)) return;
    const mat = material(target);
    const name = { armor: 'hit_armor', stone: 'hit_stone', boss: 'hit_boss', flesh: 'hit_flesh' }[mat] || 'hit';
    sfx(name, { x: x ?? target?.x, y: y ?? target?.y, volume: crit ? 1.35 : 1, pitch: crit ? 1.15 : 1 });
  });

  on(EV.ENTITY_KILLED, ({ target, x, y }) => {
    if (!target || isPlayer(game, target)) return;
    if (!target.def && !target.tags?.has?.('enemy')) return;
    const mat = material(target);
    if (mat === 'boss') return; // BOSS_DEFEATED plays boss_die
    const name = mat === 'armor' ? 'enemy_die_armor' : mat === 'stone' ? 'enemy_die_golem' : 'enemy_die';
    sfx(name, { x: x ?? target.x, y: y ?? target.y });
  });

  on(EV.PLAYER_DAMAGED, () => sfx('player_hurt'));
  on(EV.PLAYER_HEALED, ({ amount }) => {
    if (amount != null && amount <= 0) return;
    if (now() - lastPickupHeal < 0.15) return; // pickup/potion sound already covers it
    sfx('heal');
  });
  on(EV.PLAYER_DIED, () => sfx('player_die'));
  on(EV.PLAYER_RESPAWNED, () => sfx('respawn'));

  on(EV.PICKUP_COLLECTED, ({ kind, x, y }) => {
    const name = { fragment: 'pickup_fragment', health: 'pickup_health', mana: 'pickup_mana', item: 'pickup_item', gear: 'pickup_item' }[kind] || 'pickup';
    if (kind === 'health' || kind === 'mana') lastPickupHeal = now();
    sfx(name, { x, y });
  });

  on(EV.SPELL_CRAFTED, () => sfx('craft'));
  on(EV.CRAFT_FAILED, () => sfx('fail'));
  on(EV.SPELL_LEARNED, ({ crafted }) => {
    if (crafted || !gameplay()) return; // craft already played / GAME_NEW seeding
    sfx('learn');
  });
  on(EV.SPELL_FAILED, ({ caster, reason }) => {
    if (caster && !isPlayer(game, caster)) return;
    if (reason === 'mana') sfx('mana_empty');
    else if (reason === 'cooldown') sfx('cooldown');
    else sfx('fail', { volume: 0.6 });
  });

  on(EV.BOSS_SPAWNED, () => sfx('boss_roar'));
  on(EV.BOSS_PHASE, () => {
    sfx('boss_phase');
    sfx('boss_roar', { delay: 0.15 });
  });
  on(EV.BOSS_DEFEATED, () => sfx('boss_die'));

  on(EV.EQUIPMENT_CHANGED, ({ itemId }) => {
    if (!gameplay()) return;
    sfx(itemId ? 'equip' : 'unequip');
  });
  on(EV.INVENTORY_CHANGED, ({ itemId, delta }) => {
    if (!gameplay() || !(delta < 0)) return;
    if (game.combat?.getItem?.(itemId)?.slot === 'consumable') {
      lastPickupHeal = now();
      sfx('potion');
    }
  });

  on(EV.TRAVEL_REQUEST, () => {
    if ((game.state?.player?.hp ?? 1) <= 0) return;
    lastDoor = now();
    sfx('door');
  });
  on(EV.SCENE_CHANGED, ({ from, to, params }) => {
    const GP = ['hub', 'dungeon', 'tower', 'boss'];
    if (!GP.includes(to) || !GP.includes(from) || params?.from === 'respawn') return;
    if (now() - lastDoor > 1.5) sfx('door');
  });
  on(EV.MENU_NEW_GAME, () => sfx('title_start'));
  on(EV.MENU_CONTINUE, () => sfx('title_start'));
  on(EV.DUNGEON_CLEARED, () => sfx('clear'));
  on(EV.TOWER_FLOOR_CLEARED, () => sfx('clear'));
  on(EV.GAME_OVER, () => sfx('gameover'));
  on(EV.VICTORY, () => sfx('victory'));
}
