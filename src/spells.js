/**
 * The Spells as this client shows them: what each does (rules/spells.ts of netstorm-web, where they
 * are cast), how its blast looks, and the skirmish's choices of how Spells are had.
 *
 * A Priest prays for a Spell (in a skirmish the Devastation, or with "Prayer" any but the Thunder
 * ones); a carrier fetches one from an Obelisk (with "Obelisks"). Either holds it and casts it round
 * itself for its Storm Power, standing still for its cast time. "Spells do not affect the caster."
 */
import { defs } from './state.js';

/** The skirmish's Spells setting (netstorm-web's SPELL_OPTIONS), as the menu names them. */
export const SPELL_MODES = {
  none: 'Devastation',
  obelisks: 'Obelisks',
  prayer: 'Any, by prayer',
};

const BLAST = { look: 'blast', color: '#ff9a3a' };
const SUMMON_DEVIL = { look: 'summon', color: '#c9a36a' };
const SUMMON_MANO = { look: 'summon', color: '#c9a8ff' };

/** Each Spell's look when it goes off, and what it does (`r`: its range in cells, `def`: its type). */
const SPELLS = {
  bombexplodesmall: BLAST,
  bombexplodemedium: BLAST,
  bombexplodelarge: BLAST,
  bombspecialone: BLAST,
  bombgraviton: { look: 'implode', color: '#a184ea', text: (r) => `destroys every air unit within ${r} cells` },
  bombhardener: { look: 'ring', color: '#9fb6c8', text: (r) => `makes the bridges within ${r} cells unbreakable` },
  bombheal: { look: 'ring', color: '#7ee07a', text: (r) => `heals every unit within ${r} cells, whoever's, and ends Paralysis and Invisibility there` },
  bombinvisible: { look: 'ring', color: '#f2f6ff', text: (r, def) => `makes the units within ${r} cells invisible for ${def.effectTime || 40} s: nothing can aim at them` },
  bombparalyze: { look: 'ring', color: '#5cd6ff', text: (r, def) => `paralyzes the units within ${r} cells for ${def.effectTime || 120} s: they neither move nor shoot` },
  bombtreason: { look: 'ring', color: '#b04ad8', text: (r) => `makes the enemy's units and bridges within ${r} cells yours (not Temples, Workshops, Altars or Priests)` },
  bomblightingwave: { look: 'lightning', color: '#d9c2ff', text: (r) => `strikes everything within ${r} cells for 500` },
  bomblightingzap: { look: 'lightning', color: '#fff2a8', text: (r) => `strikes everything within ${r} cells with bolts of 100 to 500` },
  bombmeteor: { look: 'rocks', color: '#8a6a4a', text: (r) => `rains rocks on everything within ${r} cells` },
  bombtwister: SUMMON_DEVIL,
  bombiitwister: SUMMON_DEVIL,
  bombiiitwister: SUMMON_DEVIL,
  bombimano: SUMMON_MANO,
  bombiimano: SUMMON_MANO,
  bombiiimano: SUMMON_MANO,
};

/** How a Spell's blast looks: 'blast', 'implode', 'ring', 'lightning', 'rocks' or 'summon', and its colour. */
export function spellLook(id) {
  return SPELLS[id] ?? { look: 'ring', color: '#ffd27a' };
}

/** What a Spell does, in a line. */
export function spellText(id) {
  const def = defs.get(id), spell = SPELLS[id];
  if (!def) return '';
  const r = def.range;
  if (spell?.look === 'blast') {
    return `destroys everything on the ground within ${r} cells, yours too, and takes a third off Temples and Workshops; bridges there fall, those at the edge crack. Flyers and allied Priests are spared`;
  }
  if (spell?.look === 'summon') return `calls up ${def.spawns || 'some'} ${spell === SUMMON_MANO ? "Man o'Wars" : 'Dust Devils'} over the caster`;
  return spell?.text?.(r, def) ?? `a Spell of range ${r}`;
}

/** A Spell's name: "the Devastation". */
export const spellName = (id) => defs.get(id)?.name ?? id;
