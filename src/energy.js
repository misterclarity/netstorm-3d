/**
 * Energy, as netstorm-web's rules/building.ts has it (energyNeed, hasEnergy), told in full: what a
 * unit needs, which of the player's (and allies') Temples and Generators reach a site, and which
 * of the needed icons each covers. The rules only answer yes or no ('no energy'); the HUD and the
 * placement preview need to show why. scripts/check.js compares `energyAt(...).ok` with the rules'
 * own answer over a whole map.
 *
 * A unit needs Energy icons: of level 1 one of its Fury's, of level 2 one more of any Fury, of
 * level 3 two of its Fury's and one of any; Generators and the Outpost one of any. The Sun's icon
 * is "any". A Temple gives two icons of its Fury (a computer's Temple one), a Generator one of its
 * Fury, the Sun Generator one of "any". A source counts where its middle is within the Energy
 * range of the site's middle. Nothing is used up: one Generator serves every unit around it, and
 * Energy matters only while building.
 */
import { NS, G, ME, FURY_COLOR } from './state.js';

export const ANY = 's';
const FURY_OF = { w: 'wind', r: 'rain', t: 'thunder', s: 'sun' };
const LETTER = { wind: 'w', rain: 'r', thunder: 't', sun: 's' };
const TEMPLE_ENERGY = 2, AI_TEMPLE_ENERGY = 1;

/** The icons (letters) a unit needs, in the rules' order. */
export function needOf(def) {
  return def ? [...NS.energyNeed(def)] : [];
}

/** An icon's name for people: "Wind", "Rain", "Thunder", or "any". */
export const iconName = (letter) => (letter === ANY ? 'any' : FURY_OF[letter][0].toUpperCase() + FURY_OF[letter].slice(1));

/** "Wind + any", "2 Wind + any": a need, or what is missing of one. */
export function needText(letters) {
  const counts = new Map();
  for (const l of letters) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a === ANY) - (b === ANY)).map(([l, n]) => `${n > 1 ? `${n} ` : ''}${iconName(l)}`).join(' + ');
}

/** How many icons, and of which Fury, a building gives as a source of Energy; null if none. */
export function sourceOf(b, view = G.view) {
  if (b.kind !== 'building') return null;
  const d = view.def(b.type);
  if (!d?.theme) return null;
  const count = d.cls === 'Energy' ? (view.players.get(b.owner)?.ai ? AI_TEMPLE_ENERGY : TEMPLE_ENERGY) : Number(d.group === 'battery');
  return count ? { letter: LETTER[d.theme], count } : null;
}

/**
 * The Energy at a site for unit `def` laid with its top-left cell at (x, y): `need` (letters),
 * `sources` (the buildings within reach, each { b, letter, count, used }), `missing` (letters no
 * source covers) and `ok`.
 */
export function energyAt(def, x, y, player = ME, view = G.view) {
  const need = needOf(def), sources = [], icons = [];
  if (!need.length) return { need, sources, missing: [], ok: true };
  const reach = view.energyRange ** 2 + (def.footX * def.footX) / 2;
  for (const b of view.entities.values()) {
    if (b.kind !== 'building' || b.rising > 0 || !b.owner || view.hostile(player, b.owner)) continue;
    const s = sourceOf(b, view);
    if (!s) continue;
    const dx = b.x + b.fx / 2 - (x + def.footX / 2), dy = b.y + b.fy / 2 - (y + def.footY / 2);
    if (dx * dx + dy * dy >= reach) continue;
    const entry = { b, letter: s.letter, count: s.count, used: 0 };
    sources.push(entry);
    for (let i = 0; i < s.count; i++) icons.push(entry);
  }
  // as the rules match them: a Fury's icon takes a source of that Fury; "any" a Sun one first,
  // else the last one left
  const missing = [];
  for (const icon of need) {
    const at = icon === ANY
      ? (icons.findIndex((s) => s.letter === ANY) >= 0 ? icons.findIndex((s) => s.letter === ANY) : icons.length - 1)
      : icons.findIndex((s) => s.letter === icon);
    if (at < 0) { missing.push(icon); continue; }
    icons[at].used++;
    icons.splice(at, 1);
  }
  return { need, sources, missing, ok: !missing.length };
}

/** The colour of an icon: its Fury's, and "any" as the four together. */
export function iconStyle(letter) {
  return letter === ANY
    ? `background:conic-gradient(${FURY_COLOR.wind} 0 25%,${FURY_COLOR.rain} 0 50%,${FURY_COLOR.thunder} 0 75%,${FURY_COLOR.sun} 0)`
    : `background:${FURY_COLOR[FURY_OF[letter]]}`;
}

/** Icons as HTML dots, each crossed out when `missing` holds it. */
export function iconsHtml(letters, missing = []) {
  const left = [...missing];
  return letters.map((l) => {
    const i = left.indexOf(l), gone = i >= 0;
    if (gone) left.splice(i, 1);
    return `<i class="mana${gone ? ' gone' : ''}" data-l="${l}" style="${iconStyle(l)}" title="${iconName(l)} Energy${gone ? ': none here' : ''}"></i>`;
  }).join('');
}

/** The Generators that would make up what is missing: "a Wind Generator and one more of any Fury". */
function remedy(missing) {
  const counts = new Map();
  for (const l of missing) counts.set(l, (counts.get(l) ?? 0) + 1);
  const parts = [];
  for (const [l, n] of counts) {
    if (l === ANY) continue;
    parts.push(`${n > 1 ? `${n} ${iconName(l)} Generators` : `a ${iconName(l)} Generator`}`);
  }
  const any = counts.get(ANY) ?? 0;
  if (any) parts.push(parts.length ? `${any > 1 ? `${any} more` : 'one more'} of any Fury` : `${any > 1 ? `${any} Generators` : 'a Generator'} of any Fury`);
  return parts.join(' and ');
}

/** One line for the placement tip: the need, met or what it lacks. */
export function energyTip(at) {
  if (!at.need.length) return '';
  if (at.ok) return `Energy ${needText(at.need)} ✓`;
  return `Needs ${needText(at.need)} Energy, lacks ${needText(at.missing)} here: bring ${remedy(at.missing)} within ${G.view.energyRange} cells`;
}

/** What to do about missing icons, for a toast. */
export function missingAdvice(def, at) {
  return `${def.name} needs ${needText(at.need)} Energy; here it lacks ${needText(at.missing)}. Build ${remedy(at.missing)} within ${G.view.energyRange} cells of the spot, or build it nearer your Temple or Generators.`;
}
