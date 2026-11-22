/**
 * What this browser keeps of the tower defense campaign (src/td-hud.js): each battle's best stars,
 * the kinds of the horde already met, and the High Priest's skills, bought with the stars. A star
 * is a point; a skill's first level costs one, its second and third two each.
 */
import { NS } from './state.js';

const KEY = 'netstorm-3d:td';

/** What a skill's levels cost, to level 1, 2 and 3. */
export const SKILL_COST = [1, 2, 2];
export const SKILLS = ['bolt', 'bless', 'rally', 'hammer', 'stand', 'call', 'muster'];

export function progress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { stars: p.stars ?? {}, seen: p.seen ?? [], skills: { ...NS.TD_NO_SKILLS, ...(p.skills ?? {}) } };
  } catch {
    return { stars: {}, seen: [], skills: { ...NS.TD_NO_SKILLS } };
  }
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* no storage */ }
}

/** The points: won (a star each), spent on skills, left to spend. */
export function points(p = progress()) {
  const won = Object.values(p.stars).reduce((a, b) => a + b, 0);
  const spent = SKILLS.reduce((sum, s) => sum + SKILL_COST.slice(0, p.skills[s] ?? 0).reduce((a, b) => a + b, 0), 0);
  return { won, spent, left: won - spent };
}

/** The skills the Priest takes into a battle. */
export function heroSkills() {
  return progress().skills;
}
