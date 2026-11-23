/**
 * The sky cities in the HUD (sim/city-map.ts lays them out, src/components/ns-city.js draws
 * them): their section of the main menu, the briefing, and a stroll in the goal panel: the city's
 * sights, each ticked once the Priest has come near it, with a word as he does. Nothing is won or
 * lost in a city: it is there to be walked.
 */
import { G, ME, escapeHtml } from './state.js';
import { objectivesHtml, showObjectives } from './objectives.js';

const $ = (id) => document.getElementById(id);

export const CITIES = [
  {
    id: 'concord',
    title: 'Concord',
    blurb: 'The trading city of the four Furies: their quarters about the Temple of Concord.',
    briefing: [
      'Where the four Furies trade in peace. Each keeps a quarter of the city, built in its own way about its own Temple: the Sun’s of sandstone under awnings and sun discs, east; the Rain’s of pale stone under blue vaults, by its fountain, south; the Wind’s of whitewash and timber under green gables, round its wind tower, west; the Thunder’s of slate under steep roofs and lightning rods, round its coil, north.',
      'In the middle, on its compass rose, stands the Temple of Concord, the Furies’ four spires at its corners and their four orbs about the light over it. Four bridges join it to the quarters; airships of the Furies wait at the docks.',
    ],
  },
  {
    id: 'altamar',
    title: 'Altamar',
    blurb: 'A terraced city of white houses, blue domes and hanging gardens on islands at three heights.',
    briefing: [
      'A city of whitewashed houses and blue domes on islands at three heights. The town is in the middle: lanes about a square with a fountain, windmills on its western end. Above it, among cypresses and olives, the domed hall and its bell tower; below it, the harbour with its warehouses, stalls and piers, and airships moored off them.',
      'At either end of the town a garden hangs on an islet of its own, a pergola in it, vines over its rims. Bridges join them all, and where a bridge meets another level a lift carries you up or down.',
    ],
  },
];

const HOW = [
  'Press <b>V</b> (or <b>Eyes</b> by the minimap) to see through your Priest’s eyes: <b>W A S D</b> walk him, the mouse looks about; <b>V</b> again takes you back above.',
  'From above, select him and click the ground to send him there.',
  'Houses, stalls, trees and towers stand in the way: walk the streets and squares. Where a bridge meets another level, a lift carries you.',
  'Night falls after a minute and a half, and the lamps and windows light up.',
];

const cityOf = (id) => CITIES.find((c) => c.id === id) ?? CITIES[0];

/** How to stroll a city and its keys (hud.js modeGuide: How to play and Controls in a city). */
export function guide() {
  return {
    title: `How to stroll ${G.world?.city?.title ?? 'a sky city'}`,
    how: HOW,
    keys: [
      '<b>Camera:</b> drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> pan · <kbd>Q</kbd><kbd>E</kbd> turn (in a city of several levels, a level down or up)',
      '<b>Your Priest:</b> click him, then the ground to walk him there · <kbd>P</kbd> finds him · <kbd>F</kbd> follows him · click or drag on the minimap',
      '<b>Through his eyes:</b> <kbd>V</kbd> (or <b>Eyes</b> by the minimap), and again back above · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or the arrows walk him · the mouse looks (click the view to lock the pointer to it, <kbd>Esc</kbd> frees it) · click or <kbd>E</kbd> walks him to where the crosshair is',
      '<b>Pause:</b> <kbd>Space</kbd> · <b>Speed:</b> <kbd>+</kbd> / <kbd>−</kbd> (night comes sooner) · <kbd>T</kbd> the city on a table, as a headset shows it',
    ],
  };
}

/** The main menu's section. */
export function menuSection() {
  const rows = CITIES.map((c) => `<button class="main" data-city="${c.id}" title="${escapeHtml(c.blurb)}">${escapeHtml(c.title)}</button>`).join('');
  return `<section class="cities"><h3>Sky cities</h3><p>Two cities to stroll through, with no battle in them: walk them in first person.</p>
    <div class="raids">${rows}</div>
    <p class="level">${CITIES.map((c) => `<b>${escapeHtml(c.title)}</b>: ${escapeHtml(c.blurb)}`).join('<br>')}</p></section>`;
}

/** Its buttons, once the menu is up. */
export function wireMenu(box, match) {
  for (const b of box.querySelectorAll('[data-city]')) b.onclick = () => match.start({ mode: 'city', city: b.dataset.city });
}

/** Which of the city's sights he has seen: the HUD's to keep, as he walks. */
const seenIn = new WeakMap();
export function seenSights(w = G.world) {
  let s = seenIn.get(w);
  if (!s) { s = new Set(); seenIn.set(w, s); }
  return s;
}

/** The stroll: each sight, ticked once he has been near it; the first still to see marked. */
export function tour(w = G.world) {
  const seen = seenSights(w);
  let next = true;
  return (w.city?.sights ?? []).map((s, i) => {
    const done = seen.has(i), now = !done && next;
    if (now) next = false;
    return { text: s.name, state: done ? 'done' : now ? 'now' : '' };
  });
}

export function briefing(hud) {
  const c = cityOf(G.city), w = G.world;
  hud.modal(`<h2>${escapeHtml(w.city.title)}</h2>
    ${c.briefing.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <h3 class="objectives-head">A stroll: the sights</h3><ol class="objectives">${objectivesHtml(tour(w))}</ol>
    <h3 class="objectives-head">How</h3><ul class="how">${HOW.map((t) => `<li>${t}</li>`).join('')}</ul>
    <p class="note">A demo map: no battle, nothing to win or lose.</p>`,
  [{ label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }, { label: 'Controls', act: () => hud.help(true) },
    { label: 'Stroll', main: true, act: () => hud.begin() }]);
}

const WAYS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** The next sight to see and the way to it from the Priest (north is up the map), or null. */
export function nextSight(w = G.world) {
  const p = w.priestOf(ME), seen = seenSights(w), i = (w.city?.sights ?? []).findIndex((_, k) => !seen.has(k));
  if (!p || i < 0) return null;
  const s = w.city.sights[i], dx = s.x - p.x - 0.5, dy = s.y - p.y - 0.5;
  return { name: s.name, steps: Math.round(Math.hypot(dx, dy)), way: WAYS[((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8] };
}

/** His line through his own eyes: the way to the next sight. */
export function eyesLine(w = G.world) {
  const n = nextSight(w);
  if (!n) return 'Every sight seen: stroll on as you like';
  return `Next: <b>${escapeHtml(n.name.replace(/^The /, 'the '))}</b>, ${n.steps < 6 ? 'here' : `${n.steps} steps ${n.way}`} (the gold marker)`;
}

/** The goal panel: the sights, and the way to the next; a word as he reaches one. */
export function goal(hud) {
  const w = G.world, p = w.priestOf(ME), seen = seenSights(w), sights = w.city?.sights ?? [];
  if (p) {
    sights.forEach((s, i) => {
      if (seen.has(i) || Math.hypot(p.x + 0.5 - s.x, p.y + 0.5 - s.y) > s.r) return;
      seen.add(i);
      hud.toast(`${s.name}${seen.size === sights.length ? ': every sight seen' : ''}`, 'good');
    });
  }
  const h3 = $('goal')?.querySelector('h3');
  if (h3) h3.textContent = w.city?.title ?? 'A sky city';
  const list = tour(w), next = sights.find((s, i) => !seen.has(i));
  showObjectives(list, !!next);
  const how = G.fp?.active ? 'W A S D walk, the mouse looks about' : 'press V to see through his eyes, or select him and click the ground';
  $('goalText').textContent = next ? `Walk to ${next.name.replace(/^The /, 'the ')} (the gold marker): ${how}.` : `All ${sights.length} sights seen. Stroll on as long as you like.`;
  $('goalSub').textContent = '';
}
