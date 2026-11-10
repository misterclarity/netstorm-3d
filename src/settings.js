/**
 * The player's settings (the main menu's Settings), kept in the browser between visits. They are
 * rules, so a game takes them as it starts: day and night, and how much shorter the guns reach at
 * night.
 */
import { G } from './state.js';

const KEY = 'netstorm-3d:settings';
export const SETTINGS_DEFAULTS = { nights: true, nightReach: 25 };
/** The choices for the guns' reach at night, in per cent less than by day. */
export const NIGHT_REACH = [0, 10, 25, 40, 50];

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* no storage */ }
  const s = { ...SETTINGS_DEFAULTS, ...saved };
  if (!NIGHT_REACH.includes(s.nightReach)) s.nightReach = SETTINGS_DEFAULTS.nightReach;
  s.nights = !!s.nights;
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* no storage */ }
}

/** Give a new world the settings' rules (the house rules read `nights` and `nightShare`). */
export function applySettings(world, s = loadSettings()) {
  world.nights = s.nights;
  world.nightShare = s.nightReach / 100;
  G.settings = s;
}
