/**
 * The Combahee Raid on the screen (src/campaign.js has its words, sim/raid.ts its rules): its part
 * of the main menu, the briefings, the goal panel as the battle goes, the cards of the Wayfinder
 * and the airships, what its events say and sound like, and the pages at its end.
 */
import { G, NS, ME, TPS, escapeHtml } from './state.js';
import { submit } from './game.js';
import { CAMPAIGN, RAID_MISSIONS, EPILOGUE, CREDITS, HERO, Hero, endText, progress, remember, unlocked, raidName } from './campaign.js';
import { objectivesHtml, showObjectives } from './objectives.js';

const LEVELS = ['easy', 'normal', 'hard'];
const $ = (id) => document.getElementById(id);
const mmss = (ticks) => {
  const s = Math.max(0, Math.ceil(ticks / TPS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const missionOf = (id) => RAID_MISSIONS.find((m) => m.id === id);
/** The essay, as the menu and the briefings name it, and in full in the epilogue's sources. */
const essay = () => `<a href="${CAMPAIGN.source.url}" target="_blank" rel="noopener">Thea Anderson’s essay</a>`;
const source = () => `<a href="${CAMPAIGN.source.url}" target="_blank" rel="noopener">${escapeHtml(CAMPAIGN.source.title)}</a>`;

/* ----------------------------------------- menu ------------------------------------------- */

/** The campaign's part of the main menu. */
export function menuSection() {
  let level = 'normal';
  try { level = localStorage.getItem('netstorm-3d:combahee-level') ?? 'normal'; } catch { /* no storage */ }
  const done = progress().done;
  const rows = RAID_MISSIONS.map((m, i) => {
    const open = unlocked(m.id);
    return `<button class="${i === 0 || open ? 'main' : ''}" data-raid="${m.id}" ${open ? '' : 'disabled title="Win Sky Messages first"'}>${i + 1}. ${escapeHtml(m.title)}${done.includes(m.id) ? ' ✓' : ''}</button>`;
  }).join('');
  return `<section class="campaign"><h3>${escapeHtml(CAMPAIGN.title)}</h3><p>${escapeHtml(CAMPAIGN.blurb)}</p>
    <div class="form"><label>Level <select id="rdLevel">${LEVELS.map((l) => `<option value="${l}" ${l === level ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select></label></div>
    <div class="raids">${rows}</div>
    <p class="level">After the Combahee River Raid of 1863 and ${essay()} on its Mercurial guide (The Mountain Astrologer, 2021).</p></section>`;
}

/** Its buttons, once the menu is up. */
export function wireMenu(box, match) {
  for (const b of box.querySelectorAll('[data-raid]')) {
    b.onclick = () => {
      const difficulty = box.querySelector('#rdLevel').value;
      try { localStorage.setItem('netstorm-3d:combahee-level', difficulty); } catch { /* no storage */ }
      match.start({ mode: 'raid', mission: b.dataset.raid, difficulty });
    };
  }
}

/* --------------------------------------- briefing ----------------------------------------- */

export function briefing(hud) {
  const m = missionOf(G.raid), n = RAID_MISSIONS.indexOf(m) + 1;
  hud.modal(`<h2>${escapeHtml(m.title)}</h2><p class="when">${escapeHtml(CAMPAIGN.title)} · battle ${n} of ${RAID_MISSIONS.length} · ${escapeHtml(m.when)}</p>
    ${m.briefing.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <h3 class="objectives-head">Objectives</h3><ol class="objectives">${objectivesHtml(objectives(G.world, null))}</ol>
    <h3 class="objectives-head">How</h3><ul class="how">${m.how.map((t) => `<li>${t}</li>`).join('')}</ul>
    <p class="note credit">After the Combahee River Raid of 1863 and ${essay()} on its Mercurial guide (The Mountain Astrologer, 2021).</p>`,
  [{ label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }, { label: 'Controls', act: () => hud.help(true) },
    { label: 'Begin', main: true, act: () => hud.begin() }]);
}

/* --------------------------------------- the goal ----------------------------------------- */

/** Which chain of islands a place is on: north or south of the Combahee. */
const chain = (x, y) => (y + 0.5 < NS.windY(x + 0.5) ? 'north' : 'south');
const away = (e, [x, y]) => Math.max(Math.abs(e.x - x), Math.abs(e.y - y));

/**
 * The battle's objectives as they stand (objectives.js): the one the next step is about (`focus`, an
 * objective's key) marked as the one to work on, else the first still to do.
 */
export function objectives(w = G.world, focus = nextStep(w)?.of) {
  const r = w.raid, him = w.entities.get(r.guide), list = [], over = !!r.verdict;
  const health = him?.kind === 'priest' ? `${Math.ceil(him.hp)}/${him.hpMax}` : '';
  const lost = over && !r.verdict.won ? r.verdict.why : null;
  if (r.mission === 'scout') {
    const seen = r.quarters.filter((q) => q.visited).length;
    list.push({
      key: 'quarters', text: 'Visit the quarters of the four estates (gold markers)', meta: `${seen}/${r.quarters.length}`,
      state: seen === r.quarters.length ? 'done' : '',
      items: r.quarters.map((q) => ({ text: `${q.name}, ${chain(q.door[0], q.door[1])} chain`, state: q.visited ? 'done' : '' })),
    });
    list.push({ key: 'cove', text: 'Then meet his scouts in the cove past Raven Bluff (blue marker)', state: r.verdict?.won ? 'done' : '' });
    list.push({ key: 'dawn', text: 'Before dawn', meta: !over && w.tick < r.dawn ? `${mmss(r.dawn - w.tick)} left` : '', state: lost === 'dawn' ? 'fail' : 'rule' });
  } else {
    const aboard = NS.freed(w);
    list.push({
      key: 'aboard', text: `Bring at least ${r.target} people aboard: at each estate’s landing a ship sounds her horn, and its families come`,
      meta: `${aboard}/${r.target}`, state: aboard >= r.target ? 'done' : lost === 'few' ? 'fail' : '',
      items: r.quarters.map((q) => {
        const l = r.landings[q.landing], stuck = r.families.some((f) => f.quarters === q.id && f.waiting);
        const coming = q.left + r.families.filter((f) => f.quarters === q.id).reduce((n, f) => n + f.size, 0);
        const meta = over ? '' : stuck ? 'stuck at the rift: lay bridge' : !q.called && l.parted ? 'behind a rift: lay bridge' : q.called && coming > 0 ? `${coming} on their way` : '';
        return { text: l.name, meta, state: q.called && !stuck ? 'done' : stuck && !over && aboard < r.target ? 'now' : '' };
      }),
    });
    list.push({ key: 'home', text: 'Fly the ships home to Windgate, then press Fly home', meta: !over && w.tick < r.noon ? `before midday: ${mmss(r.noon - w.tick)}` : '', state: r.verdict?.won ? 'done' : lost === 'few' ? 'fail' : '' });
    const bridge = over || r.bridge.burned || r.battery.came ? '' : r.bridge.burning ? `burning, ${mmss(r.bridge.burning - w.tick)}` : `battery in ${mmss(r.battery.due - w.tick)}`;
    list.push({ key: 'bridge', text: 'Bonus: burn the bridge at Ferry Isle before the Sun-lords’ battery crosses it', meta: bridge, state: r.bridge.burned ? 'done' : r.battery.came ? 'fail' : '' });
  }
  list.push({ key: 'hp', text: `Keep ${HERO} on his feet: below half he is knocked out`, meta: health, state: lost === 'down' ? 'fail' : 'rule' });
  if (!r.verdict) {
    const now = list.find((o) => o.key === focus && o.state === '') ?? list.find((o) => o.state === '');
    if (now) now.state = 'now';
  }
  return list;
}

/** What to do next, in a sentence, and which objective that is (`of`); null once it is over. */
export function nextStep(w = G.world) {
  const r = w.raid, him = w.entities.get(r?.guide);
  if (!r || r.verdict) return null;
  const up = him?.kind === 'priest' && him.state === 'normal';
  // a sentry's birds have risen, and he is near it
  if (up && r.signs.size > 0 && w.tick >= r.disguise.until) {
    return w.tick >= r.disguise.ready
      ? { of: 'hp', text: 'Birds! A sentry is close. Press C for his disguise, then walk on past it.' }
      : { of: 'hp', text: `Birds! A sentry is close, and his disguise is ready again in ${mmss(r.disguise.ready - w.tick)}: keep him out of its reach (Enemy range shows it) till then.` };
  }
  if (r.mission === 'scout') {
    const left = r.quarters.filter((q) => !q.visited);
    if (!left.length) return { of: 'cove', text: `Walk ${HERO} to the cove past Raven Bluff, at the east end of the north chain (blue marker): select him, then click the ground there.` };
    // the quarters on his own chain first, the nearest of them
    const mine = up ? left.filter((q) => chain(q.door[0], q.door[1]) === chain(him.x, him.y)) : [];
    const pick = (mine.length ? mine : left).reduce((a, q) => (him && away(him, q.door) < away(him, a.door) ? q : a));
    const cross = up && !mine.length ? ` It lies on the ${chain(pick.door[0], pick.door[1])} chain: cross on the Sun-lords’ bridge at Ferry Isle, far to the west.` : '';
    return { of: 'quarters', text: `Walk ${HERO} to the ${pick.name} quarters (gold marker): select him, then click the ground by its door.${cross}` };
  }
  const ships = [...r.ships.values()].filter((b) => !b.snagged).map((b) => ({ b, t: w.entities.get(b.id) })).filter((s) => s.t);
  const landingOf = (q) => r.landings[q.landing];
  const standing = !r.bridge.burned && !r.bridge.burning && !r.battery.came;
  const ferry = r.landings.find((l) => l.ferry), atFerry = standing && ships.find(({ t }) => NS.mooredAt(w, t) === ferry);
  if (atFerry) return { of: 'bridge', text: `Select the ${atFerry.b.name} at Ferry Isle and press Burn the bridge on her card.` };
  // enough aboard: home
  if (NS.freed(w) >= r.target) return { of: 'home', text: 'Enough are aboard! Send both ships home to Windgate, in the east (select each, then click its landing), and press Fly home.' };
  // families stuck at a rift
  const stuck = r.quarters.find((q) => r.families.some((f) => f.quarters === q.id && f.waiting));
  if (stuck) return { of: 'aboard', text: `The ${stuck.name} families cannot reach ${landingOf(stuck).name}: lay bridge across the rift. Pick a bridge piece below, then click it into place between the landing and their island.` };
  // a ship tied up where nobody has been called yet
  for (const { b, t } of ships) {
    const at = NS.mooredAt(w, t), q = at && r.quarters.find((x) => x.landing === at.id && !x.called && x.left > 0);
    if (q) return { of: 'aboard', text: `Select the ${b.name} at ${at.name} and press Sound the horn on her card.${at.parted ? ' Then lay bridge across the rift for the families.' : ''}` };
  }
  // a landing still to call: the nearest ship that is free of a crowd to it
  const uncalled = r.quarters.filter((q) => !q.called);
  const busy = (t) => { const at = NS.mooredAt(w, t); return !!at && (at.crowd > 0 || r.quarters.some((q) => q.landing === at.id && (q.left > 0 || r.families.some((f) => f.quarters === q.id)))); };
  const free = ships.filter(({ b, t }) => b.aboard < b.capacity && !busy(t));
  // the bridge at the ferry, a bonus, when the battery is near and a ship can be spared
  if (standing && free.length && (r.battery.due - w.tick < 120 * TPS || !uncalled.length)) {
    return { of: 'bridge', text: `Bonus: the Sun-lords’ battery comes in ${mmss(r.battery.due - w.tick)}. Send the ${free[0].b.name} to Ferry Isle, far to the west, and burn the bridge from her card.` };
  }
  if (uncalled.length && free.length) {
    let best = null;
    for (const s of free) for (const q of uncalled) { const d = away(s.t, landingOf(q).dock); if (!best || d < best.d) best = { s, q, d }; }
    const l = landingOf(best.q);
    return { of: 'aboard', text: `Send the ${best.s.b.name} to ${l.name}: select her, then click the landing.${l.parted ? ' A rift parts it from its estate: lay bridge across it too.' : ''}` };
  }
  const crowd = r.landings.filter((l) => l.crowd > 0).sort((a, b) => b.crowd - a.crowd)[0];
  if (crowd && r.singing !== crowd.id && up) return { of: 'aboard', text: `Walk ${HERO} onto ${crowd.name}: while he sings there, the ${crowd.crowd} waiting board twice as fast.` };
  return { of: 'aboard', text: 'The families are on their way to the ships: wait while they board, or send a ship on to the next landing.' };
}

/** His disguise, in the lines of the first person. */
export function disguiseLine() {
  const w = G.world, r = w?.raid;
  if (!r) return '';
  if (w.tick < r.disguise.until) return `<b>In disguise</b>: ${mmss(r.disguise.until - w.tick)} more, no sentry fires on him`;
  if (w.tick < r.disguise.ready) return `Disguise again in ${mmss(r.disguise.ready - w.tick)}`;
  return `<kbd>C</kbd> disguise: for ${NS.DISGUISE_SECONDS} s no sentry fires on him`;
}

/** The goal panel, as the raid stands: its objectives, the next step, and how things stand. */
export function goal() {
  const w = G.world, r = w.raid;
  if (!r) return;
  const step = nextStep(w);
  const h3 = $('goal')?.querySelector('h3');
  if (h3) h3.textContent = missionOf(r.mission)?.title ?? CAMPAIGN.title;
  showObjectives(objectives(w, step?.of), !r.verdict);
  $('goalText').textContent = r.verdict ? (r.verdict.won ? 'Won.' : 'Lost.') : step?.text ?? '';
  const disguise = w.tick < r.disguise.until ? `in disguise, ${mmss(r.disguise.until - w.tick)} more`
    : w.tick < r.disguise.ready ? `disguise again in ${mmss(r.disguise.ready - w.tick)}` : 'disguise ready (C)';
  const lines = [];
  if (!r.verdict) {
    if (r.mission === 'scout') lines.push(`Sky mines found ${r.mines.filter((m) => m.known).length} of ${r.mines.length} · ${disguise}`);
    else {
      const ships = [...r.ships.values()].filter((b) => !b.snagged).map((b) => `${b.name} ${b.aboard}/${b.capacity}`);
      lines.push([...ships, w.tick < r.dawn ? `dawn in ${mmss(r.dawn - w.tick)}` : 'day', r.singing >= 0 ? `${HERO} sings at ${r.landings[r.singing].name}` : '', disguise].filter(Boolean).join(' · '));
    }
  }
  // the lines change as the clock runs; the button stays the same one, so that a click on it holds
  const sub = $('goalSub');
  let text = sub.querySelector('.lines'), home = $('raidHome');
  if (!text) {
    sub.innerHTML = '<span class="lines"></span>';
    text = sub.firstChild;
    home = null;
  }
  const html = lines.map(escapeHtml).join('<br>');
  if (text.dataset.html !== html) {
    text.dataset.html = html;
    text.innerHTML = html;
  }
  if (r.mission === 'raid' && !r.verdict && NS.freed(w) >= r.target) {
    if (!home) {
      home = Object.assign(document.createElement('button'), { className: 'home', id: 'raidHome', textContent: 'Fly home', title: 'Every ship not snagged must be at Windgate' });
      home.onclick = () => submit({ t: 'raidHome' });
      sub.append(home);
    }
  } else {
    home?.remove();
  }
}

/* ---------------------------------------- cards ------------------------------------------- */

/** The name on an entity's card in the raid. */
export const cardName = raidName;

/** What the raid adds to a card: his, an airship's, a Sun-lords' building's. Returns true if it has
 * said all there is (the card's usual lines are left out). */
export function card(e, lines, acts) {
  const w = G.world, r = w.raid;
  if (!r) return false;
  if (e.kind === 'priest' && e.id === r.guide) {
    lines.push(e.state === 'normal' ? (e.path?.length ? 'On his way' : 'Standing') : 'Knocked out');
    lines.push('A High Priest born under Mercury, who lives to guide and shield those who cannot fend for themselves. Swift and hard to catch: he reads the signs about him (birds rising ahead mean someone waits there), wears disguises and moves by night.');
    if (e.owner === ME && e.state === 'normal') {
      if (w.tick < r.disguise.until) lines.push(`In disguise: no sentry fires on him for ${mmss(r.disguise.until - w.tick)}.`);
      acts.push(`<button data-sel="disguise" ${w.tick < r.disguise.ready ? `disabled title="Ready again in ${mmss(r.disguise.ready - w.tick)}"` : 'title="For 15 s no sentry fires on him (C)"'}>Disguise</button>`);
      if (r.mission === 'raid') lines.push(r.singing >= 0 ? `He sings at ${r.landings[r.singing].name}: the crowd goes aboard twice as fast.` : 'Stand him at a landing and he sings: the crowd goes aboard twice as fast.');
      lines.push('Click ground to walk; V to see through his eyes.');
    }
    lines.push(`No single shot takes more than ${NS.PRIEST_WARD} off him; below half he is knocked out, and the battle is lost.`);
    return true;
  }
  if (e.kind === 'transport' && r.ships.has(e.id)) {
    const b = r.ships.get(e.id);
    if (b.snagged) {
      lines.push(r.mission === 'raid' ? 'Snagged on a crag by Windgate; her volunteers went on in the Rainbird.' : 'His scouts wait here with their skiff.');
      return true;
    }
    const at = NS.mooredAt(w, e);
    lines.push(`Aboard ${b.aboard} of ${b.capacity}${e.path?.length ? ' · under way' : at ? ` · tied up at ${at.name}` : ''}`);
    lines.push('Click the sky to send her along the Combahee. Her guns shell the Sun-lords’ buildings within reach.');
    if (e.owner === ME && at) {
      const called = r.quarters.filter((q) => q.landing === at.id);
      if (called.length) {
        const left = called.some((q) => !q.called && q.left > 0);
        acts.push(`<button data-sel="horn" ${left ? 'title="The bondfolk of the estate come down to the landing"' : 'disabled title="Already called"'}>Sound the horn</button>`);
      }
      if (at.ferry) acts.push(`<button data-sel="burn" ${r.bridge.burned || r.bridge.burning ? 'disabled' : `title="It burns through in ${NS.BURN_SECONDS} s"`}>Burn the bridge</button>`);
    }
    return true;
  }
  if (e.kind === 'building' && e.owner !== ME) {
    const what = raidName(e);
    if (what === 'Sentry') lines.push(`Fires on ${HERO} and the airships within its reach, less far at night. Not on the families: nobody aims at them.`);
    if (what === 'Battery gun') lines.push('Fires down its line over the Combahee at the ferry.');
    if (what === 'Mill') lines.push('One of the Sun-lords’ mills, where the bondfolk were made to work. The airships’ guns can reach it from the wind.');
    return true;
  }
  return false;
}

/** A card's button of the raid; true if it was one. */
export function cardClick(sel, id) {
  if (sel === 'disguise') submit({ t: 'disguise' });
  else if (sel === 'horn') submit({ t: 'horn', transport: id });
  else if (sel === 'burn') submit({ t: 'burnBridge', transport: id });
  else return false;
  return true;
}

/* ---------------------------------------- events ------------------------------------------ */

/** What a raid event says, shows and sounds like. */
export function hear(match, ev) {
  const r = G.world.raid, d = ev.data, hud = match.hud, scene = match.raidScene?.(), sound = match.sound();
  if (!r) return;
  switch (d.kind) {
    case 'visit': {
      const q = r.quarters[d.id];
      hud.toast(`The bondfolk of the ${q.name} quarters tell him where ${d.n === 1 ? 'a sky mine floats' : `${d.n} sky mines float`} in the Combahee.`, 'good');
      break;
    }
    case 'sign': hud.toast('Birds scatter over the trees ahead: a sentry is watching there.', 'bad'); scene?.birds(d.x, d.y); sound.raid('birds'); break;
    case 'disguise': hud.toast(`In disguise: for ${NS.DISGUISE_SECONDS} s no sentry fires on him.`, 'good'); break;
    case 'horn': hud.toast(`The horn at ${r.landings[d.id].name}: the bondfolk of the estate come running to the landing.`, 'good'); sound.raid('horn', d.ship); break;
    case 'song': hud.toast(`${Hero} sings to the crowd at ${r.landings[d.id].name}: they go aboard twice as fast.`, 'good'); sound.raid('song'); break;
    case 'emptied': hud.log(`Everyone has left the ${r.quarters[d.id].name} quarters.`, 'good'); break;
    case 'full': hud.toast(`The ${r.ships.get(d.ship).name} is full.`, 'good'); break;
    case 'mine': hud.toast(`A sky mine went off against the ${r.ships.get(d.ship).name}! She is torn, but still flying.`, 'bad'); scene?.burst(d.x, d.y); sound.raid('mine', d.ship); break;
    case 'shell': scene?.shell(d.ship, d.x, d.y); sound.raid('shell', d.ship); break;
    case 'burning': hud.toast(`The bridge at the ferry is on fire: it burns through in ${NS.BURN_SECONDS} s.`, 'good'); break;
    case 'burned': hud.toast('The bridge at the ferry has fallen into the clouds.', 'good'); sound.raid('burned'); break;
    case 'dawn': hud.toast(r.mission === 'scout' ? 'Dawn.' : 'Dawn over the Combahee.', r.mission === 'scout' ? 'bad' : ''); break;
    case 'held': hud.toast('The Sun-lords’ battery reached the ferry and found the bridge gone.', 'good'); break;
    case 'battery': hud.toast('The Sun-lords’ battery has crossed at the ferry and fires on the Combahee!', 'bad'); sound.raid('battery'); break;
    case 'end': break;
    default: break;
  }
}

/* --------------------------------------- the end ------------------------------------------ */

/** The page at the end of a battle. */
export function end(hud, verdict) {
  if (G.ended) return;
  G.ended = true;
  G.paused = true;
  const r = G.world.raid, m = missionOf(G.raid);
  if (verdict.won) remember(G.raid, G.world);
  hud.sound.end(verdict.won);
  const words = endText(G.raid, verdict, r.freed, r.target, r.bridge.burned);
  const next = RAID_MISSIONS[RAID_MISSIONS.indexOf(m) + 1];
  const buttons = [{ label: 'Keep looking', act: () => hud.closeModal() }, { label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }];
  if (!verdict.won) buttons.push({ label: 'Try again', main: true, act: () => hud.game.start() });
  else if (next) buttons.push({ label: `Next: ${next.title}`, main: true, act: () => hud.game.start({ ...G.setup, mission: next.id }) });
  else buttons.push({ label: 'Epilogue', main: true, act: () => epilogue(hud) });
  hud.modal(`<h2>${verdict.won ? escapeHtml(m.title) : `${escapeHtml(m.title)}: not this time`}</h2>${words.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <h3 class="objectives-head">Objectives</h3><ol class="objectives">${objectivesHtml(objectives(G.world))}</ol>`, buttons);
}

/** The epilogue, and where the story comes from. */
export function epilogue(hud) {
  hud.modal(`<h2>${escapeHtml(EPILOGUE.title)}</h2>${EPILOGUE.text.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <h3>Where it comes from</h3><ul class="credits"><li>A fantasy after the Combahee River Raid of June 1 to 2, 1863, and after ${escapeHtml(CAMPAIGN.source.author)}, ${source()}, ${escapeHtml(CAMPAIGN.source.where)}: its hero is drawn as the essay draws the raid’s guide, Mercury in a life.</li>${CREDITS.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`,
  [{ label: 'Main menu', main: true, act: () => hud.game.start(G.setup, { menu: true }) }]);
}
