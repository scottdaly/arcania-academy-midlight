// AUDIO public API (team: ui+audio). Contract: ARCHITECTURE.md §4.6.
// Everything is synthesised with WebAudio - no audio files. PLACEHOLDER: simple blips, no music.
// The AudioContext is created lazily in unlock() (called by core on every user gesture) because
// browsers block audio until a gesture.
import { EV } from '../core/events.js';

/** name -> [oscillator type, start Hz, end Hz, duration s, gain] */
const SFX = {
  cast_fire: ['sawtooth', 220, 80, 0.18, 0.15],
  cast_ice: ['triangle', 900, 1400, 0.15, 0.12],
  cast_lightning: ['square', 1200, 200, 0.12, 0.08],
  cast_arcane: ['sine', 500, 1000, 0.25, 0.15],
  cast_earth: ['triangle', 120, 60, 0.2, 0.2],
  hit: ['square', 200, 90, 0.07, 0.1],
  enemy_die: ['sawtooth', 300, 40, 0.3, 0.12],
  player_hurt: ['square', 160, 60, 0.2, 0.15],
  player_die: ['sawtooth', 400, 30, 0.9, 0.18],
  pickup: ['sine', 880, 1760, 0.1, 0.1],
  craft: ['triangle', 440, 1320, 0.4, 0.15],
  fail: ['square', 140, 110, 0.15, 0.08],
  ui_move: ['square', 600, 600, 0.03, 0.04],
  ui_select: ['square', 800, 1200, 0.06, 0.06],
  ui_back: ['square', 600, 300, 0.06, 0.05],
  door: ['triangle', 200, 400, 0.3, 0.12],
  boss_phase: ['sawtooth', 80, 40, 0.8, 0.2],
  victory: ['triangle', 523, 1046, 1.2, 0.15],
};

export function createAudio(game) {
  let ctx = null, master = null, sfxBus = null, musicBus = null;
  let track = null;
  let muted = game.params.has('mute');

  function applyVolumes() {
    if (!ctx) return;
    const s = game.settings;
    master.gain.value = muted ? 0 : s.masterVolume;
    sfxBus.gain.value = s.sfxVolume;
    musicBus.gain.value = s.musicVolume;
  }

  const audio = {
    /** Create/resume the AudioContext. Safe to call repeatedly. */
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        sfxBus = ctx.createGain();
        musicBus = ctx.createGain();
        sfxBus.connect(master);
        musicBus.connect(master);
        master.connect(ctx.destination);
        applyVolumes();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    suspend() { ctx?.suspend?.().catch(() => {}); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },

    /** Play a one-shot effect. opts: { volume=1, pitch=1 } */
    sfx(name, opts = {}) {
      if (!ctx || ctx.state !== 'running') return;
      const def = SFX[name];
      if (!def) return;
      const [type, f0, f1, dur, gain] = def;
      const now = ctx.currentTime;
      const pitch = opts.pitch ?? 1;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0 * pitch, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), now + dur);
      g.gain.setValueAtTime(gain * (opts.volume ?? 1), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g).connect(sfxBus);
      o.start(now);
      o.stop(now + dur + 0.02);
    },

    /** Switch music track: 'title'|'hub'|'dungeon'|'tower'|'boss'|'gameover'|'victory'|null. */
    music(name) {
      track = name;
    },
    get currentTrack() { return track; },

    setMuted(m) { muted = !!m; applyVolumes(); },
    /** Re-read game.settings volumes. */
    applySettings: applyVolumes,
    update(dt) {},
  };

  // ---- event -> sound mapping ----------------------------------------------------------
  const { bus } = game;
  bus.on(EV.SFX, ({ name, ...opts }) => audio.sfx(name, opts));
  bus.on(EV.SPELL_CAST, ({ spell }) => audio.sfx(spell?.sfx || 'cast_arcane', { pitch: 0.9 + Math.random() * 0.2 }));
  bus.on(EV.ENTITY_DAMAGED, () => audio.sfx('hit', { pitch: 0.8 + Math.random() * 0.4 }));
  bus.on(EV.ENTITY_KILLED, () => audio.sfx('enemy_die'));
  bus.on(EV.PLAYER_DAMAGED, () => audio.sfx('player_hurt'));
  bus.on(EV.PLAYER_DIED, () => audio.sfx('player_die'));
  bus.on(EV.PICKUP_COLLECTED, () => audio.sfx('pickup', { pitch: 0.9 + Math.random() * 0.3 }));
  bus.on(EV.SPELL_CRAFTED, () => audio.sfx('craft'));
  bus.on(EV.CRAFT_FAILED, () => audio.sfx('fail'));
  bus.on(EV.SPELL_FAILED, ({ caster }) => { if (caster?.tags?.has('player')) audio.sfx('fail', { volume: 0.5 }); });
  bus.on(EV.SCENE_CHANGED, ({ to }) => { if (['hub', 'dungeon', 'tower', 'boss'].includes(to)) audio.sfx('door'); });
  bus.on(EV.BOSS_PHASE, () => audio.sfx('boss_phase'));
  bus.on(EV.VICTORY, () => audio.sfx('victory'));

  return audio;
}
