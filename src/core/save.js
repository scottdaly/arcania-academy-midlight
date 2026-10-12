// Save/load to localStorage. Single save slot + separate settings blob.
// Loading deep-merges the saved data over a fresh createNewState(), so fields added later
// get their defaults and old saves keep working. Failures (private mode, quota) never throw.
import { SAVE_KEY, SETTINGS_KEY } from './config.js';
import { createNewState, SAVE_VERSION } from './state.js';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Merge `src` into `dst` recursively. Arrays and primitives in src replace dst. */
export function deepMerge(dst, src) {
  if (!isPlainObject(src)) return dst;
  for (const [k, v] of Object.entries(src)) {
    if (isPlainObject(v) && isPlainObject(dst[k])) deepMerge(dst[k], v);
    else dst[k] = v;
  }
  return dst;
}

export function hasSave() {
  return !!storage()?.getItem(SAVE_KEY);
}

export function saveGame(state) {
  const s = storage();
  if (!s) return false;
  try {
    state.savedAt = Date.now();
    s.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('[save] failed:', err);
    return false;
  }
}

/** Returns a full state object, or null if no (valid) save exists. */
export function loadGame() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!isPlainObject(data) || (data.version ?? 0) > SAVE_VERSION) return null;
    const state = deepMerge(createNewState(), data);
    state.version = SAVE_VERSION;
    return state;
  } catch (err) {
    console.warn('[save] corrupt save ignored:', err);
    return null;
  }
}

export function deleteSave() {
  try {
    storage()?.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
}

export const DEFAULT_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  /** 'auto' | 'on' | 'off' - on-screen touch controls. */
  touchControls: 'auto',
  screenShake: true,
  showFps: false,
});

export function loadSettings() {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    if (raw) Object.assign(out, JSON.parse(raw));
  } catch { /* ignore */ }
  return out;
}

export function saveSettings(settings) {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
