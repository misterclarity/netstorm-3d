/**
 * Words for the moon and the Furies (the house rules in scripts/house-rules.mjs): tonight's moon,
 * how much reach a night takes from a Fury's guns, how hard a Fury hits now, and what a gun's hit on
 * a target is multiplied by, part by part.
 */
import { NS } from './state.js';

/** The moon's phases as the house rules number them (NS.MOON_PHASES), as icons. */
export const MOON_ICON = ['🌑', '🌓', '🌕', '🌗'];

/** "a full moon", "a first quarter moon": tonight's moon, or by day the coming night's. */
export function moonName(w) {
  const name = NS.MOON_PHASES[w.moonPhase()];
  return name.endsWith('moon') ? `a ${name}` : `a ${name} moon`;
}

/** The share of their reach a Fury's guns lose tonight, out of an Energy ring and not at a flyer a
 * Vander Tower lights up: by the moon, more for the Sun, none for Thunder. */
export function cutFor(w, theme) {
  if (theme === 'thunder') return 0;
  return Math.min(0.9, w.nightShare * (NS.MOON_DARK[w.moonPhase()] + (theme === 'sun' ? NS.SUN_BLIND : 0)));
}

const pct = (x) => `${Math.round(x * 100)}%`;

/** A sentence on tonight's reach: "guns reach 13% less (the Sun's 28%, Thunder's not at all)". */
export function reachText(w) {
  const most = cutFor(w, 'wind'), sun = cutFor(w, 'sun');
  if (!sun) return 'guns reach as far as by day';
  return `guns reach ${pct(most)} less (the Sun's ${pct(sun)}, Thunder's not at all; none in your Energy rings)`;
}

/** What hits harder or softer now: "Rain hits ×1.25", "the Sun hits ×1.15". */
export function furyText(w) {
  const parts = [];
  for (const [theme, name] of [['sun', 'the Sun'], ['rain', 'Rain']]) {
    const k = w.furyStrength(theme);
    if (k !== 1) parts.push(`${name} hits ×${k}`);
  }
  return parts.join(', ');
}

/** What a gun's hit on a target is multiplied by, as words: "×0.5 vs units · ×1.2 from above". */
export function hitText(w, gun, target) {
  const { against, height, fury } = NS.hitParts(w, gun, target);
  const words = [];
  const riding = (target.kind === 'transport' || target.kind === 'priest') && w.liftLevels(target) > 0;
  const what = target.kind === 'building' ? 'buildings' : riding ? 'a lift rider (as a building)' : 'units';
  if (against !== 1) words.push(`×${against} vs ${what}`);
  if (height !== 1) words.push(`×${+height.toFixed(2)} from ${height > 1 ? 'above' : 'below'}`);
  if (fury !== 1) {
    const theme = w.def(gun.type).theme;
    words.push(`×${fury} ${theme === 'rain' ? `Rain under ${moonName(w)}` : 'Sun by day'}`);
  }
  if (riding) words.push(`×${NS.LIFT_EXPOSURE} on the lift`);
  const total = against * height * fury * (riding ? NS.LIFT_EXPOSURE : 1);
  if (words.length > 1) words.push(`= ×${+total.toFixed(2)}`);
  if (target.kind === 'priest') words.push(`at most ${NS.PRIEST_WARD} a hit`);
  return words.join(' · ');
}

/** A gun's class, for its card: "siege gun: ×1.5 vs buildings, ×0.5 vs units". */
export function classText(type) {
  if (NS.SIEGE_GUNS.has(type)) return `siege gun: ×${NS.SIEGE_VS_BUILDINGS} vs buildings, ×${NS.SIEGE_VS_UNITS} vs units`;
  if (NS.LIGHT_GUNS.has(type)) return `light gun: ×${NS.LIGHT_VS_BUILDINGS} vs buildings`;
  return '';
}
