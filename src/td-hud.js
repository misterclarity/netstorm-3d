/**
 * The Bridges of Nimbus (netstorm-3d): a tower defense campaign of six battles in NetStorm's world
 * of islands in the sky (the rules are sim/td.ts, the maps sim/td-map.ts; the scene's part is
 * src/components/ns-td.js). Here: its section of the main menu and its campaign map, each battle's
 * briefing, the bar of the battle (lives, waves, the next wave's call, the Spells, the High Priest
 * and his acts), the menus of a platform and of a gun, the Priest sent about and his Storm Hammer
 * aimed, what the battle's events show, the end of a battle with its stars, and the Priest's
 * skills, bought with the stars (src/td-progress.js keeps them in this browser). Its story, its
 * battles, the Priest's skills and all their names are made up here.
 */
import { NS, G, ME, TPS, defs, escapeHtml, wx, wz, THREE } from './state.js';
import { submit } from './game.js';
import { groundAt } from './heights.js';
import { toScene } from './space.js';
import { progress as kept, saveProgress, points, SKILLS, SKILL_COST } from './td-progress.js';

const $ = (id) => document.getElementById(id);

export const TD_TITLE = 'The Bridges of Nimbus';

const INTRO = [
  'The Hollow Priest has broken the truce of the Furies. Out of the storm gates at the edge of the world march his walkers, Golems and Fire Ants, Crystal Crabs, Sail Skaters and shaggy Bulfs, and over them sail his airships, all of them bound for the Temples of the free isles.',
  'You are the Wind’s High Priest of the Windward Reach, and the Furies lend you their guns. Raise them on the stone platforms beside your bridges, rank them up with the Storm Power the fallen leave behind, and hold the bridges of Nimbus.',
];

/** Each battle: its name, where it is, its story, and where it lies on the campaign map. */
export const BATTLES = {
  mossbridge: {
    title: 'Mossbridge',
    place: 'The Windward Reach, at the old moss-grown bridges',
    story: 'The first of the horde comes from the west along the old bridges, back and forth between six islands: slow Golems of sandstone, then Fire Ants, quick and many. Raise Disc Throwers and Crossbows beside the bridges, and call down the Thunder Strike where they crowd.',
    at: [92, 262],
  },
  ferries: {
    title: 'The Twin Ferries',
    place: 'Where two ferries of bridges meet',
    story: 'Two ways of bridges come from the west and meet at an island, then go on as one to your Temple. Crystal Crabs come now: a Crab that reaches the Temple steals Storm Power as well as a life. The Rain lends you its Ice Cannon, which fires down a straight line: raise it in line with a bridge, and its shells chill the walkers they strike, slowing them.',
    at: [214, 150],
  },
  cloudwatch: {
    title: 'Cloudwatch',
    place: 'Below the northern clouds',
    story: 'The Hollow Priest’s airships come out of the north, straight over the islands: Balloons first, then Cloud Floaters, which half the shots at them pass through. Only guns that shoot at the air can touch them: the Disc Thrower, the Crossbow, and the Thunder’s Vander Tower, which strikes at the air alone.',
    at: [350, 250],
  },
  skaters: {
    title: 'Skater’s Reach',
    place: 'Two long bridges across the open sky',
    story: 'Two long straight bridges: the Sail Skaters’ road, and they are the fastest of the walkers. The Sun lends its Sun Cannon, which turns to the best of its four lines, and the Thunder its Arc Spires: raised as a pair across a bridge at an Arc gate, their band shocks every walker that crosses it.',
    at: [478, 128],
  },
  bulfback: {
    title: 'Bulfback Pass',
    place: 'The long pass of the Bulfs',
    story: 'The Bulfs come, shaggy beasts of the storm: slow and hard to bring down, and each costs three lives if it reaches the Temple. Air Ships sail over them. Now the Thunder Cannon, the longest line and the hardest hits, and the Man o’ War Pool, whose Man o’ War hunts the walkers about it. Last of all comes Old Thunderhide, the greatest of the Bulfs.',
    at: [598, 258],
  },
  hollowgate: {
    title: 'The Hollow Gate',
    place: 'Before the Hollow Priest’s own storm gate',
    story: 'The Hollow Priest’s own gate: two ways of bridges and the air between them. At the very last his flagship comes, an Air Ship of his own, and as it passes it holds the guns about it still for a while. If the flagship reaches your Temple, the battle is lost.',
    at: [700, 122],
  },
};

const EPILOGUE = 'The flagship falls burning into the clouds, and one by one the storm gates close. The walkers that are left wander home along the bridges, and the airships drift away on the wind. The bridges of Nimbus are free again, and the Furies keep their truce.';

/** The Spells, as the player casts them. */
const SPELLS = {
  bomblightingzap: { name: 'Thunder Strike', key: '1', icon: '⚡' },
  bombparalyze: { name: 'Paralysis', key: '2', icon: '❄' },
};
const RANK = ['I', 'II', 'III'];
const HITS = { ground: 'walkers', air: 'airships', both: 'walkers and airships' };

/** The High Priest's skills as the player reads them, and what each level gives. */
const SKILL = {
  bolt: { name: 'Lightning Hand', say: (l) => `bolts of ${NS.TD_HERO.bolt.damage[l]} every ${NS.TD_HERO.bolt.every[l]} s at the horde within ${NS.TD_HERO.bolt.reach[l]} cells` },
  bless: { name: 'Blessing', say: (l) => `guns within ${NS.TD_HERO.bless.reach[l]} cells of him hit ×${NS.TD_HERO.bless.hit[l]}` },
  rally: { name: 'Rally', key: '3', say: (l) => `for ${NS.TD_HERO.rally.seconds[l]} s the guns within ${NS.TD_HERO.rally.reach} cells hit ×${NS.TD_HERO.rally.hit[l]}; again after ${NS.TD_HERO.rally.cooldown[l]} s` },
  hammer: { name: 'Storm Hammer', key: '4', say: (l) => `${NS.TD_HERO.hammer.damage[l]} to the horde within ${NS.TD_HERO.hammer.reach[l]} cells of a spot up to ${NS.TD_HERO.hammer.range} from him; again after ${NS.TD_HERO.hammer.cooldown[l]} s` },
  stand: { name: 'Stand Fast', say: (l) => `${NS.TD_HERO.stand.hp[l]} hit points, holds up ${NS.TD_HERO.stand.holds[l]} walker${NS.TD_HERO.stand.holds[l] > 1 ? 's' : ''}, mends ${NS.TD_HERO.stand.regen[l]} a second, rises after ${NS.TD_HERO.stand.down[l]} s` },
  call: { name: 'Temple Guard', key: '5', say: (l) => guardSay(l) },
  muster: { name: 'Swift Summons', say: (l) => `the Temple Guard may be called again ${NS.TD_GUARD.wait[l]} s after it was called` },
};

/** Who the Temple Guard sends at a level of its skill, and for how long. */
function guardSay(l) {
  const g = NS.TD_GUARD, n = g.golems[l], b = g.balloons[l];
  const who = `${n === 1 ? 'a Golem' : `${n} Golems`}${b ? ` and ${b === 1 ? 'a Balloon' : `${b} Balloons`}` : ''}`;
  return `calls ${who} to a spot for ${g.stay[l]} s, standing there and hurling stones at the walkers going by${b ? '; the Balloon drops fire on airships too' : ''}`;
}

export const towerName = (type) => defs.get(type)?.name ?? type;
export const foeName = (type) => defs.get(type)?.name ?? type;

/** What this browser keeps of the campaign (src/td-progress.js). */
export const progress = kept;
const save = saveProgress;

/** A battle is open once the one before it is won. */
export function unlocked(id) {
  const i = NS.TD_LEVELS.indexOf(id);
  return i === 0 || (progress().stars[NS.TD_LEVELS[i - 1]] ?? 0) > 0;
}

/** Stars for a battle won: three with nine tenths of the lives kept, two with half, else one. */
export function starsFor(lives, max) {
  return lives <= 0 ? 0 : lives >= max * 0.9 ? 3 : lives >= max * 0.5 ? 2 : 1;
}

const starsHtml = (n, of = 3) => `<span class="td-stars">${'★'.repeat(n)}<i>${'★'.repeat(of - n)}</i></span>`;

/* ------------------------------------------ the menu ------------------------------------------ */

/** The main menu's section. */
export function menuSection() {
  const p = progress(), total = Object.values(p.stars).reduce((a, b) => a + b, 0);
  return `<section class="td"><h3>Tower defense</h3>
    <p><b>${escapeHtml(TD_TITLE)}</b>: six battles against the Hollow Priest’s horde. Raise the game’s guns beside the bridges and hold them, wave after wave.</p>
    <p class="level">${total} of ${NS.TD_LEVELS.length * 3} stars won${points(p).left > 0 ? ` · ${points(p).left} point${points(p).left > 1 ? 's' : ''} for your High Priest to spend` : ''}</p>
    <button class="main" data-td-open>Campaign map</button></section>`;
}

export function wireMenu(box, hud) {
  const b = box.querySelector('[data-td-open]');
  if (b) b.onclick = () => campaignMap(hud);
}

/** The campaign map: the six battles as islands joined by a way of bridges, their stars, the
 * locked ones grey. */
export function campaignMap(hud) {
  const p = progress(), ids = NS.TD_LEVELS;
  const isles = ids.map((id, i) => {
    const b = BATTLES[id], [x, y] = b.at, open = unlocked(id), stars = p.stars[id] ?? 0;
    const L = NS.tdLevel(id), tint = { sun: '#e0b24a', rain: '#5d94cc', wind: '#8cb862', thunder: '#9a82d6' }[L.foe];
    return `<g class="td-isle${open ? '' : ' locked'}" data-battle="${id}" tabindex="${open ? 0 : -1}" role="button" aria-label="${escapeHtml(b.title)}${open ? '' : ' (locked)'}">
      <path d="M${x - 46},${y} q46,58 92,0 z" class="rock"/>
      <ellipse cx="${x}" cy="${y}" rx="48" ry="17" class="top" style="--tint:${tint}"/>
      <ellipse cx="${x}" cy="${y - 2}" rx="34" ry="10" class="grass"/>
      <text x="${x}" y="${y - 28}" class="num">${i + 1}</text>
      <text x="${x}" y="${y + 44}" class="name">${escapeHtml(b.title)}</text>
      <text x="${x}" y="${y + 62}" class="stars">${open ? `${'★'.repeat(stars)}<tspan class="off">${'★'.repeat(3 - stars)}</tspan>` : '🔒'}</text>
    </g>`;
  }).join('');
  const way = ids.map((id) => BATTLES[id].at).map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const total = Object.values(p.stars).reduce((a, b) => a + b, 0);
  hud.modal(`<h2>${escapeHtml(TD_TITLE)}</h2>
    ${INTRO.map((t) => `<p class="text">${escapeHtml(t)}</p>`).join('')}
    <svg class="td-map" viewBox="0 0 790 340" role="group" aria-label="The campaign map">
      <defs><linearGradient id="tdSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b86c7"/><stop offset="1" stop-color="#a9c7ea"/></linearGradient></defs>
      <rect width="790" height="340" rx="12" fill="url(#tdSky)"/>
      <g class="clouds">${[[60, 60, 50], [300, 40, 70], [560, 60, 60], [720, 300, 70], [250, 320, 80], [440, 310, 60]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.32}"/>`).join('')}</g>
      <path d="${way}" class="way"/>
      ${isles}
    </svg>
    <p class="note">${total} of ${ids.length * 3} stars. Each battle won opens the next; three stars for keeping nine tenths of your Temple’s lives.</p>
    ${skillsHtml(p)}`,
  [{ label: 'Main menu', act: () => hud.menu() }]);
  for (const g of $('modalBox').querySelectorAll('.td-isle:not(.locked)')) {
    const go = () => hud.game.start({ mode: 'td', level: g.dataset.battle });
    g.addEventListener('click', go);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(); });
  }
  for (const b of $('modalBox').querySelectorAll('[data-skill]')) {
    b.onclick = () => {
      const q = progress(), s = b.dataset.skill, level = q.skills[s] ?? 0;
      if (level >= 3 || points(q).left < SKILL_COST[level]) return;
      q.skills[s] = level + 1;
      save(q);
      campaignMap(hud);
    };
  }
  const reset = $('modalBox').querySelector('[data-skills-reset]');
  if (reset) reset.onclick = () => { const q = progress(); q.skills = { ...NS.TD_NO_SKILLS }; save(q); campaignMap(hud); };
}

/** The High Priest's skills: each with its level, what it gives now and next, raised with points. */
function skillsHtml(p) {
  const pts = points(p);
  const rows = SKILLS.map((s) => {
    const l = p.skills[s] ?? 0, cost = SKILL_COST[l];
    return `<div class="td-skill"><div><b>${SKILL[s].name}</b>${SKILL[s].key ? ` <kbd>${SKILL[s].key}</kbd>` : ''} <span class="td-pips">${'●'.repeat(l)}<i>${'●'.repeat(3 - l)}</i></span></div>
      <p>${escapeHtml(SKILL[s].say(l))}.${l < 3 ? ` <span class="next">Next: ${escapeHtml(SKILL[s].say(l + 1))}.</span>` : ''}</p>
      ${l < 3 ? `<button data-skill="${s}" ${pts.left < cost ? 'disabled' : ''}>Raise · ${cost} point${cost > 1 ? 's' : ''}</button>` : '<span class="td-top">Highest</span>'}</div>`;
  }).join('');
  return `<section class="td-hero"><h3>Your High Priest</h3>
    <p class="level">He fights beside the guns in every battle. Each star won is a point to raise his skills with: <b>${pts.left}</b> to spend of ${pts.won} won.${pts.spent ? ' <button class="link" data-skills-reset>Take them all back</button>' : ''}</p>
    <div class="td-skills">${rows}</div></section>`;
}

/** A battle's briefing: its story, what is new in it, and how. */
export function briefing(hud) {
  const id = G.td, b = BATTLES[id], L = NS.tdLevel(id), i = NS.TD_LEVELS.indexOf(id);
  const before = i > 0 ? NS.tdLevel(NS.TD_LEVELS[i - 1]) : { towers: [], foes: [], spells: [] };
  const fresh = [
    ...L.towers.filter((t) => !before.towers.includes(t)).map((t) => `<li><b>${escapeHtml(towerName(t))}</b> <span class="cost">⚡${NS.TD_TOWERS[t].cost}</span>: ${escapeHtml(NS.TD_TOWERS[t].note)}</li>`),
    ...L.spells.filter((s) => !before.spells.includes(s)).map((s) => `<li><b>${SPELLS[s].name}</b> (Spell, key ${SPELLS[s].key}): ${escapeHtml(NS.TD_SPELLS[s].note)}</li>`),
    ...L.foes.filter((f) => !before.foes.includes(f)).map((f) => `<li class="foe"><b>${escapeHtml(foeName(f))}</b>: ${escapeHtml(NS.TD_FOES[f].note)}</li>`),
  ];
  const how = [
    'Your <b>High Priest</b> fights beside the guns: click him, then where he should go. He strikes the horde about him with lightning, his blessing makes the guns near him hit harder, and where he stands his ground he holds up the walkers that reach him. <b>Rally</b> (3) and the <b>Storm Hammer</b> (4, then a spot near him) are his own, and he calls the <b>Temple Guard</b> (5, then a spot on or beside a bridge): Golems that stand there a while and strike the horde going by.',
    'Click a <b>stone platform</b> beside a bridge to raise a gun on it; click a gun to rank it up (to III), turn it or sell it. Pointing at a gun in the menu shows its reach.',
    'A <b>cannon</b> fires down one straight line: raise it on a platform in line with a bridge. The <b>Crossbow</b> shoots into an arc ahead of it; the archers all about them.',
    'The first wave comes when you call it; then each follows after a countdown. <b>Call the next wave early</b> (N) for Storm Power.',
    'A Spell: click its button (or press its key), then where to cast it.',
  ];
  hud.modal(`<h2>${i + 1}. ${escapeHtml(b.title)}</h2><p class="td-place">${escapeHtml(b.place)}</p>
    <p class="text">${escapeHtml(b.story)}</p>
    ${fresh.length ? `<h3 class="objectives-head">New in this battle</h3><ul class="td-new">${fresh.join('')}</ul>` : ''}
    ${i === 0 ? `<h3 class="objectives-head">How</h3><ul class="how">${how.map((t) => `<li>${t}</li>`).join('')}</ul>`
      : '<p class="note">Click a platform to raise a gun, a gun to rank it up, turn or sell it; click your Priest, then where he should go; <b>3</b> his Rally, <b>4</b> his Storm Hammer, <b>5</b> the Temple Guard; <b>N</b> calls the next wave early, for Storm Power.</p>'}
    <p class="note">${L.waves} waves · ${L.lives} lives · ⚡${L.storm} to begin with · your Priest’s skills: ${SKILLS.map((k) => `${SKILL[k].name} ${'●'.repeat(G.world.td.hero.skills[k])}${'○'.repeat(3 - G.world.td.hero.skills[k])}`).join(', ')}</p>`,
  [{ label: 'Campaign map', act: () => { hud.game.start(G.setup, { menu: true }); campaignMap(hud); } },
    { label: 'Controls', act: () => hud.help(true) },
    { label: 'Defend', main: true, act: () => hud.begin() }]);
}

/* ------------------------------------------ the bar ------------------------------------------- */

function bar(hud) {
  let el = $('tdBar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tdBar';
    el.className = 'panel';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.call !== undefined) callWave(hud);
      else if (b.dataset.spell) aim(hud, b.dataset.spell);
      else if (b.dataset.hero === 'pick') pickHero(hud, !G.tdHero);
      else if (b.dataset.hero) heroAct(hud, b.dataset.hero);
    });
  }
  return el;
}

/** Hide the battle's bar and menus (out of a battle). */
export function hide() {
  const el = $('tdBar');
  if (el) el.hidden = true;
  closeMenu();
  G.tdCast = null;
  G.tdHero = false;
}

/** The bar of the battle, drawn anew as it changes: lives, the wave, the call, the Spells. */
export function panel(hud) {
  const w = G.world, td = w.td, el = bar(hud);
  el.hidden = !G.started || G.ended;
  const n = td.waves.length, gap = td.next > 0 ? Math.ceil(td.next / TPS) : 0;
  const call = td.over ? `<button disabled>${td.over === 'won' ? 'Held!' : 'The Temple has fallen'}</button>`
    : td.wave === 0 ? '<button class="main" data-call>▶ Call the first wave <kbd>N</kbd></button>'
      : td.wave >= n ? `<button disabled>The last wave${td.enemies.size ? `: ${td.enemies.size} left` : ''}</button>`
        : td.due.length ? `<button disabled>Wave ${td.wave} coming…</button>`
          : `<button class="main" data-call>Next wave in ${gap} s · call now +⚡${Math.ceil(gap * NS.TD_CALL_BONUS)} <kbd>N</kbd></button>`;
  const spells = td.spells.map((s) => {
    const left = Math.ceil((td.cooldown.get(s) ?? 0) / TPS), on = G.tdCast === s;
    return `<button data-spell="${s}" class="spell${on ? ' on' : ''}" ${left > 0 ? 'disabled' : ''} title="${escapeHtml(NS.TD_SPELLS[s].note)} (key ${SPELLS[s].key})">${SPELLS[s].icon} ${SPELLS[s].name}${left > 0 ? ` <small>${left} s</small>` : ` <kbd>${SPELLS[s].key}</kbd>`}</button>`;
  }).join('');
  const hero = td.hero, k = hero.skills, wait = (act) => Math.ceil(hero.cooldown[act] / TPS);
  const fallen = hero.down > 0, life = Math.max(0, Math.round((hero.hp / hero.hpMax) * 100));
  const heroHtml = `<span class="td-hero-bar"><button data-hero="pick" class="td-portrait${G.tdHero ? ' on' : ''}" title="Your High Priest: click to send him somewhere">✦<span class="td-life"><i style="width:${life}%"></i></span><small>${fallen ? `down · ${Math.ceil(hero.down / TPS)} s` : G.tdHero ? 'where to?' : hero.holding.size ? `holding ${hero.holding.size}` : 'Priest'}</small></button>
    <button data-hero="rally" class="spell${hero.rally > 0 ? ' on' : ''}" ${fallen || wait('rally') ? 'disabled' : ''} title="Rally: ${escapeHtml(SKILL.rally.say(k.rally))} (key 3)">✶ Rally${wait('rally') ? ` <small>${wait('rally')} s</small>` : ' <kbd>3</kbd>'}</button>
    <button data-hero="hammer" class="spell${G.tdCast === 'hammer' ? ' on' : ''}" ${fallen || wait('hammer') ? 'disabled' : ''} title="Storm Hammer: ${escapeHtml(SKILL.hammer.say(k.hammer))} (key 4)">⚒ Hammer${wait('hammer') ? ` <small>${wait('hammer')} s</small>` : ' <kbd>4</kbd>'}</button>
    <button data-hero="call" class="spell${G.tdCast === 'call' || td.allies.size ? ' on' : ''}" ${wait('call') ? 'disabled' : ''} title="Temple Guard: ${escapeHtml(SKILL.call.say(k.call))}; again after ${NS.TD_GUARD.wait[k.muster]} s (key 5)">⚑ Guard${wait('call') ? ` <small>${wait('call')} s</small>` : ' <kbd>5</kbd>'}</button></span>`;
  const html = `<span class="td-lives" title="Your Temple's lives: what the horde takes when it reaches it">♥ <b>${td.lives}</b>/${td.livesMax}</span>
    <span class="td-wave" title="Waves begun, of the battle's">Wave <b>${td.wave}</b>/${n}</span>${call}<span class="td-spells">${spells}</span>${heroHtml}`;
  if (el.dataset.sig !== html) {
    el.dataset.sig = html;
    el.innerHTML = html;
  }
  refreshMenu(hud);
}

/** Call the next wave (early, for Storm Power). */
export function callWave() {
  const td = G.world?.td;
  if (!td || td.over || td.wave >= td.waves.length || td.due.length) return;
  submit({ t: 'tdWave' });
}

/** Pick the Priest (the next click on the ground sends him there), or let him be. */
export function pickHero(hud, on = true) {
  const td = G.world?.td;
  if (!td || td.over) return;
  closeMenu();
  G.tdCast = null;
  G.tdHero = on && td.hero.down === 0;
  if (G.tdHero) hud.toast('Click where your Priest should go');
  bar(hud).dataset.sig = '';
}

/** One of the Priest's acts: the Rally at once; the Storm Hammer or the Temple Guard aimed, the next
 * click its spot. The Guard comes even while he lies beaten down. */
export function heroAct(hud, act) {
  const td = G.world?.td, hero = td?.hero;
  if (!hero || td.over || (hero.down > 0 && act !== 'call') || hero.cooldown[act] > 0) return;
  closeMenu();
  if (act === 'rally') {
    submit({ t: 'tdHero', act: 'rally' });
  } else if (act === 'call') {
    G.tdHero = false;
    G.tdCast = G.tdCast === 'call' ? null : 'call';
    // through his own eyes, beside him
    const p = NS.tdPriest(G.world);
    if (G.tdCast && G.fp?.active && p) {
      G.tdCast = null;
      submit({ t: 'tdHero', act: 'call', tx: p.x, ty: p.y });
    } else if (G.tdCast) {
      hud.toast('Click where the Temple Guard should stand: on or beside a bridge or an island');
    }
  } else {
    G.tdHero = false;
    G.tdCast = G.tdCast === 'hammer' ? null : 'hammer';
    // through his own eyes, at the thickest knot of the horde within his reach
    if (G.tdCast && G.fp?.active) {
      const knot = hammerKnot();
      G.tdCast = null;
      if (knot) submit({ t: 'tdHero', act: 'hammer', tx: knot[0], ty: knot[1] });
      else hud.toast('Nothing of the horde within his reach');
    } else if (G.tdCast) {
      hud.toast(`Click where the Storm Hammer falls, within ${NS.TD_HERO.hammer.range} cells of your Priest`);
    }
  }
  bar(hud).dataset.sig = '';
}

/** Where the Storm Hammer would catch most of the horde, within the Priest's reach. */
function hammerKnot() {
  const w = G.world, td = w.td, p = NS.tdPriest(w), r = NS.TD_HERO.hammer.reach[td.hero.skills.hammer];
  if (!p) return null;
  const foes = [...td.enemies.keys()].map((id) => w.entities.get(id)).filter((e) => e && Math.hypot(e.x - p.x, e.y - p.y) <= NS.TD_HERO.hammer.range);
  let best = null;
  for (const e of foes) {
    const n = foes.filter((u) => Math.hypot(u.x - e.x, u.y - e.y) <= r).length;
    if (!best || n > best.n) best = { n, at: [e.x, e.y] };
  }
  return best?.at ?? null;
}

/** Take up a Spell to cast: the next click on the battlefield casts it there. */
export function aim(hud, spell) {
  const td = G.world.td;
  if (!td.spells.includes(spell) || (td.cooldown.get(spell) ?? 0) > 0) return;
  closeMenu();
  G.tdHero = false;
  G.tdCast = G.tdCast === spell ? null : spell;
  if (G.tdCast) hud.toast(`Click where to cast the ${SPELLS[spell].name}`);
  bar(hud).dataset.sig = '';
}

/* ----------------------------------------- the menus ------------------------------------------ */

/** The platform (index into the battle's spots) a cell is on, or -1. */
export function spotAt(x, y) {
  const td = G.world.td, on = (ax, ay) => x >= ax && x < ax + 3 && y >= ay && y < ay + 3;
  return td.spots.findIndex((s) => on(s.x, s.y) || (s.pair && on(s.pair[0], s.pair[1])));
}

/** A click on the battlefield: a Spell cast there, a platform's or a gun's menu, or the menu shut. */
export function tap(hud, x, y) {
  const td = G.world.td;
  if (td.over) return;
  const p = NS.tdPriest(G.world);
  if (G.tdCast === 'call') {
    if (!NS.tdGuardCells(G.world, x, y).length) { hud.toast('The Guard cannot stand there: click on or beside a bridge or an island', 'bad'); return; }
    submit({ t: 'tdHero', act: 'call', tx: x, ty: y });
    G.tdCast = null;
    bar(hud).dataset.sig = '';
    return;
  }
  if (G.tdCast === 'hammer') {
    if (p && Math.hypot(x - p.x, y - p.y) > NS.TD_HERO.hammer.range) { hud.toast('Too far from your Priest: closer to him', 'bad'); return; }
    submit({ t: 'tdHero', act: 'hammer', tx: x, ty: y });
    G.tdCast = null;
    bar(hud).dataset.sig = '';
    return;
  }
  if (G.tdCast) {
    submit({ t: 'tdCast', spell: G.tdCast, x, y });
    G.tdCast = null;
    bar(hud).dataset.sig = '';
    return;
  }
  // the Priest: a click on him picks him (or lets him be); picked, a click sends him there
  if (p && Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1) { pickHero(hud, !G.tdHero); return; }
  const k = spotAt(x, y);
  if (G.tdHero && (k < 0 || td.spots[k].tower === null)) {
    if (td.hero.down > 0) { hud.toast('Your Priest is down: he cannot go yet', 'bad'); return; }
    // a bridge is a cell wide: a click beside it means the way, or the nearest ground he can stand on
    const to = standAt(x, y);
    if (!to) { hud.toast('He cannot stand there: click a bridge or an island', 'bad'); return; }
    submit({ t: 'movePriest', x: to[0], y: to[1] });
    G.tdHero = false;
    bar(hud).dataset.sig = '';
    return;
  }
  G.tdHero = false;
  if (k < 0) { closeMenu(); return; }
  const s = td.spots[k];
  openMenu(hud, k, s.tower !== null && G.world.entities.has(s.tower) ? s.tower : null);
}

/** The cell nearest a click (within three) that the Priest can stand on: a cell of the horde's
 * way first, else any ground clear of a gun. */
function standAt(x, y) {
  const w = G.world, td = w.td, ways = new Set();
  for (const r of td.routes) if (!r.air) for (const [cx, cy] of r.cells) ways.add(cy * 256 + cx);
  let best = null;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const cx = x + dx, cy = y + dy, d = Math.hypot(dx, dy);
      if (d > 3.2 || !w.walkable(ME, cx, cy) || w.terrain[cy * 256 + cx] === 0) continue;
      const score = d - (ways.has(cy * 256 + cx) ? 1.5 : 0);
      if (!best || score < best.score) best = { score, at: [cx, cy] };
    }
  }
  return best?.at ?? null;
}

let menu = null;

export function closeMenu() {
  menu = null;
  G.tdPreview = null;
  const el = $('tdMenu');
  if (el) el.hidden = true;
}

function openMenu(hud, spot, tower) {
  menu = { spot, tower, sig: '' };
  G.tdPreview = tower !== null ? { tower } : null;
  refreshMenu(hud);
}

/** Where on the screen a platform is, to hang its menu by. */
function screenOf(hud, s) {
  const cam = hud.scene.camera, r = hud.scene.canvas.getBoundingClientRect();
  const v = toScene(cellPos(s.x + 1, s.y + 1, 1.5)).project(cam);
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}

function refreshMenu(hud) {
  const el0 = $('tdMenu');
  if (!menu) { if (el0) el0.hidden = true; return; }
  const w = G.world, td = w.td, me = w.players.get(ME), s = td.spots[menu.spot];
  // a gun sold or a platform built on meanwhile
  if (menu.tower !== null && !w.entities.has(menu.tower)) { menu.tower = null; G.tdPreview = null; }
  if (menu.tower === null && s.tower !== null && w.entities.has(s.tower)) { menu.tower = s.tower; G.tdPreview = { tower: s.tower }; }
  let el = el0;
  if (!el) {
    el = document.createElement('div');
    el.id = 'tdMenu';
    el.className = 'panel';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => menuClick(hud, e));
    el.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-build]');
      if (b && menu && menu.tower === null) {
        G.tdPreview = { spot: menu.spot, type: b.dataset.build };
        const note = el.querySelector('.td-note');
        if (note) note.textContent = `${NS.TD_TOWERS[b.dataset.build].note}. Hits ${HITS[NS.TD_TOWERS[b.dataset.build].hits]}.`;
      }
    });
    el.addEventListener('pointerleave', () => { if (menu && menu.tower === null) G.tdPreview = null; });
  }
  let html;
  if (menu.tower === null) {
    const types = td.towers.filter((t) => !!NS.TD_TOWERS[t].gate === !!s.pair);
    html = `<h4>${s.pair ? 'Arc gate: two spires across the bridge' : 'Stone platform: raise a gun'}</h4><div class="td-towers">${types.map((t) => {
      const cost = NS.TD_TOWERS[t].cost;
      return `<button data-build="${t}" ${me.storm < cost ? 'disabled' : ''}><canvas width="46" height="40" data-icon="${t}"></canvas><span>${escapeHtml(towerName(t))}</span><b>⚡${cost}</b></button>`;
    }).join('')}</div><p class="td-note">Point at a gun to see what it hits and where it reaches.</p>`;
  } else {
    const b = w.entities.get(menu.tower), T = NS.TD_TOWERS[b.type], rank = td.ranks.get(b.id) ?? 1;
    const post = td.posts.get(b.id), first = post !== undefined && !td.spent.has(b.id) ? post : b.id;
    const refund = Math.floor((td.spent.get(first) ?? 0) * NS.TD_REFUND), up = rank < 3 ? T.ranks[rank - 1] : null;
    const gain = up === null ? '' : `hits ×${(NS.TD_RANK_HIT[rank] / NS.TD_RANK_HIT[rank - 1]).toFixed(2).replace(/0$/, '')}${T.gate || b.type === 'rainaviary' ? '' : ', reach +1'}`;
    html = `<h4>${escapeHtml(towerName(b.type))} ${starsHtml(rank)}</h4>
      <p class="td-note">${escapeHtml(T.note)}. Hits ${HITS[T.hits]}. Rank ${RANK[rank - 1]}.</p>
      <div class="td-acts">${up !== null ? `<button data-up ${me.storm < up ? 'disabled' : ''}>Rank ${RANK[rank]} · ⚡${up}<small>${gain}</small></button>` : '<span class="td-top">Highest rank</span>'}
      ${T.turns ? '<button data-turn title="Turn it a quarter: its line or arc">Turn ⟳</button>' : ''}
      <button data-sell>Sell · +⚡${refund}</button></div>`;
  }
  const sig = `${html}|${menu.spot}`;
  if (sig !== menu.sig) {
    menu.sig = sig;
    el.innerHTML = html;
    for (const cv of el.querySelectorAll('canvas[data-icon]')) hud.drawIcon(cv, cv.dataset.icon);
  }
  el.hidden = false;
  // hung by its platform, kept on the screen
  const at = screenOf(hud, s), box = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, at.x - box.width / 2))}px`;
  el.style.top = `${Math.max(56, Math.min(innerHeight - box.height - 70, at.y - box.height - 24))}px`;
}

function menuClick(hud, e) {
  const b = e.target.closest('button');
  if (!b || b.disabled || !menu) return;
  const td = G.world.td, s = td.spots[menu.spot];
  if (b.dataset.build) {
    const type = b.dataset.build;
    submit({ t: 'tdBuild', spot: menu.spot, type, facing: NS.tdFacing(G.world, type, s.x, s.y) });
    closeMenu();
  } else if (b.dataset.up !== undefined) {
    submit({ t: 'tdUpgrade', tower: menu.tower });
  } else if (b.dataset.turn !== undefined) {
    submit({ t: 'tdTurn', tower: menu.tower });
  } else if (b.dataset.sell !== undefined) {
    submit({ t: 'tdSell', tower: menu.tower });
    closeMenu();
  }
  if (menu) menu.sig = '';
}

/** The keys of a battle: N calls the next wave, 1 and 2 take up a Spell, Escape lets go. */
export function onKey(hud, k) {
  if (k === 'n') { callWave(hud); return true; }
  const spell = Object.keys(SPELLS).find((s) => SPELLS[s].key === k);
  if (spell) { aim(hud, spell); return true; }
  if (k === '3') { heroAct(hud, 'rally'); return true; }
  if (k === '4') { heroAct(hud, 'hammer'); return true; }
  if (k === '5') { heroAct(hud, 'call'); return true; }
  if (k === 'escape' && (G.tdCast || G.tdHero || menu)) { G.tdCast = null; G.tdHero = false; closeMenu(); bar(hud).dataset.sig = ''; return true; }
  return false;
}

/* ----------------------------------------- the events ----------------------------------------- */

/** How high an airship is drawn over its cell (src/components/ns-units.js: 44 pixels). */
const AIR_UP = 44 / 16;

/** A cell's middle in the scene. */
function cellPos(x, y, up = 0) {
  return new THREE.Vector3(wx(x + 0.5), groundAt(x + 0.5, y + 0.5) + up, wz(y + 0.5));
}

let toldAura = false;

/** What the battle's events show: a wave's word, a new kind of the horde, a bounty's +, a life lost,
 * a Spell's blast, the end. */
export function hear(game, ev) {
  const d = ev.data, hud = game.hud, td = G.world.td, fx = game.effects();
  const at = (id) => game.units()?.byId.get(id)?.object3D.position.clone();
  switch (d.kind) {
    case 'wave': {
      const kinds = [...new Set((td.waves[d.n - 1] ?? []).map((g) => g.foe))].map(foeName);
      hud.toast(`Wave ${d.n} of ${td.waves.length}: ${kinds.join(', ')}`, 'bad');
      toldAura = d.n === 1 ? false : toldAura;
      break;
    }
    case 'appear': {
      if (d.flagship) { hud.toast('The Hollow Priest’s flagship! It holds your guns still as it passes', 'bad'); break; }
      const p = progress();
      if (!p.seen.includes(d.type)) {
        p.seen.push(d.type);
        save(p);
        hud.toast(`New: the ${foeName(d.type)}. ${NS.TD_FOES[d.type]?.note ?? ''}`, 'bad');
      }
      break;
    }
    case 'bounty': {
      const p = at(d.id);
      if (p && d.amount) hud.floater(`+${d.amount}`, p.setY(p.y + 1.6));
      break;
    }
    case 'leak': {
      const door = td.routes[0]?.cells.at(-1);
      if (door) hud.floater(`−${d.n} ♥`, cellPos(door[0], door[1], 3));
      if (d.amount) hud.toast(`A Crystal Crab reached your Temple and stole ⚡${d.amount}`, 'bad');
      else if (td.lives > 0 && td.lives <= 5) hud.toast(`Only ${td.lives} ${td.lives === 1 ? 'life' : 'lives'} left!`, 'bad');
      break;
    }
    case 'aura': {
      const p = at(d.id);
      if (p) fx?.cast(p.setY(p.y - 2), 'bombparalyze');
      if (!toldAura) { toldAura = true; hud.toast('The flagship holds your guns about it still', 'bad'); }
      break;
    }
    case 'cast': fx?.cast(cellPos(d.x, d.y, 0.2), d.type); break;
    case 'rank': {
      const p = at(d.id);
      if (p) hud.floater(`Rank ${RANK[d.n - 1]}`, p.setY(p.y + 3));
      break;
    }
    case 'sold': hud.floater(`+${d.amount}`, cellPos(d.x + 1, d.y + 1, 2.5)); break;
    // the High Priest's: his bolt, his acts, his fall and rising
    case 'bolt': {
      const p = NS.tdPriest(G.world), from = p && at(p.id), to = at(d.id);
      if (from && to) fx?.zap(from.setY(from.y + 1.6), to.setY(to.y + 0.6), '#ffe9a0');
      break;
    }
    case 'rally': {
      const from = at(d.id);
      if (from) fx?.wave(from.setY(from.y + 0.3), NS.TD_HERO.rally.reach + 0.5, '#ffd04a');
      hud.toast('Rally! The guns about your Priest hit far harder', 'good');
      break;
    }
    case 'hammer': {
      const spot = cellPos(d.x, d.y, 0.2);
      fx?.cast(spot, 'bombexplodemedium');
      fx?.zap(spot.clone().setY(spot.y + 16), spot, '#fff3c4');
      break;
    }
    // the Temple Guard: come at the call, each blow a stone (a Golem's) or fire (a Balloon's), gone
    case 'guard': {
      let golems = 0, balloons = 0;
      for (const [id, ally] of td.allies) {
        const e = G.world.entities.get(id);
        if (ally.air) balloons++;
        else golems++;
        if (e) fx?.puff(cellPos(e.x, e.y, ally.air ? AIR_UP : 0.6), '#fff3c4', ally.air ? 2.2 : 1.4, 0.8);
      }
      fx?.wave(cellPos(d.x, d.y, 0.3), 2.5, '#ffd04a');
      hud.toast(`The Temple Guard answers: ${golems === 1 ? 'a Golem' : `${golems} Golems`}${balloons ? ' and a Balloon' : ''} for ${NS.TD_GUARD.stay[td.hero.skills.call]} s`, 'good');
      break;
    }
    case 'shot': {
      const from = at(d.id), to = at(d.to), mark = G.world.entities.get(d.to);
      if (!from || !to) break;
      from.setY(from.y + (d.air ? AIR_UP - 0.4 : 1.4));
      to.setY(to.y + (mark?.aloft ? AIR_UP : 0.5));
      fx?.lob(from, to, d.air ? '#ff7a2e' : '#7d6a55', d.air ? 0.2 : 0.17, d.air);
      break;
    }
    case 'dismissed': fx?.puff(cellPos(d.x, d.y, d.air ? AIR_UP : 0.6), '#fff3c4', d.air ? 2 : 1.3, 0.7); break;
    case 'down': hud.toast(`Your High Priest is beaten down: he rises again in ${d.n} s`, 'bad'); G.tdHero = false; break;
    case 'up': hud.toast('Your High Priest stands again', 'good'); break;
    case 'called': hud.toast(`Called early: +⚡${d.amount}`, 'good'); break;
    case 'over': result(hud, d.won); break;
    default: break;
  }
}

/** The end of a battle: its stars, kept; on to the next, again, or the campaign map. */
export function result(hud, won) {
  if (G.ended) return;
  G.ended = true;
  G.paused = true;
  hud.sound.end(won);
  hide();
  const id = G.td, td = G.world.td, i = NS.TD_LEVELS.indexOf(id), next = NS.TD_LEVELS[i + 1];
  const stars = won ? starsFor(td.lives, td.livesMax) : 0;
  let gained = 0;
  if (won) {
    const p = progress();
    gained = Math.max(0, stars - (p.stars[id] ?? 0));
    p.stars[id] = Math.max(p.stars[id] ?? 0, stars);
    save(p);
  }
  const map = { label: 'Campaign map', act: () => { hud.game.start(G.setup, { menu: true }); campaignMap(hud); } };
  if (won) {
    hud.modal(`<h2>${escapeHtml(BATTLES[id].title)} held</h2><div class="td-won">${starsHtml(stars)}</div>
      <p class="text">${td.lives} of ${td.livesMax} lives kept; ${td.killed} of the horde brought down.${stars < 3 ? ` Keep ${Math.ceil(td.livesMax * (stars < 2 ? 0.5 : 0.9))} lives for ${stars < 2 ? 'two stars' : 'three'}.` : ''}</p>
      ${gained ? `<p class="text td-gain">+${gained} point${gained > 1 ? 's' : ''} for your High Priest: raise his skills on the campaign map.</p>` : ''}
      ${next ? '' : `<p class="text">${escapeHtml(EPILOGUE)}</p>`}`,
    [map, { label: 'Again', act: () => hud.game.start() },
      ...(next ? [{ label: `Next: ${BATTLES[next].title}`, main: true, act: () => hud.game.start({ mode: 'td', level: next }) }] : [])]);
  } else {
    hud.modal(`<h2>The Temple has fallen</h2>
      <p class="text">The horde reached your Temple in wave ${td.wave} of ${td.waves.length}; ${td.killed} of it were brought down.</p>
      <p class="text">Raise cannons in line with the long bridges, guns that shoot at the air where airships come, and rank up the guns that see the most of the bridges.</p>`,
    [map, { label: 'Try again', main: true, act: () => hud.game.start() }]);
  }
}
