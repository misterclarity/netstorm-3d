/**
 * The Combahee River Raid on the screen (src/campaign.js has its words, sim/raid.ts its rules): its
 * part of the main menu, the briefings, the goal panel as the battle goes, the cards of Harriet
 * Tubman and the boats, what its events say and sound like, and the pages at its end.
 */
import { G, NS, ME, TPS, escapeHtml } from './state.js';
import { submit } from './game.js';
import { CAMPAIGN, RAID_MISSIONS, EPILOGUE, CREDITS, endText, progress, remember, unlocked, raidName } from './campaign.js';

const LEVELS = ['easy', 'normal', 'hard'];
const $ = (id) => document.getElementById(id);
const mmss = (ticks) => {
  const s = Math.max(0, Math.ceil(ticks / TPS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const missionOf = (id) => RAID_MISSIONS.find((m) => m.id === id);
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
  return `<section class="campaign"><h3>${escapeHtml(CAMPAIGN.title)}, ${CAMPAIGN.when}</h3><p>${escapeHtml(CAMPAIGN.blurb)}</p>
    <div class="form"><label>Level <select id="rdLevel">${LEVELS.map((l) => `<option value="${l}" ${l === level ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select></label></div>
    <div class="raids">${rows}</div>
    <p class="level">After Thea Anderson, ${source()} (The Mountain Astrologer, 2021).</p></section>`;
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
  const m = missionOf(G.raid), r = G.world.raid, n = RAID_MISSIONS.indexOf(m) + 1;
  const aim = G.raid === 'raid' ? `<p class="note">Bring at least <b>${r.target}</b> people aboard (the raid freed 756), and the boats home by midday.</p>` : '';
  hud.modal(`<h2>${escapeHtml(m.title)}</h2><p class="when">${escapeHtml(CAMPAIGN.title)} · battle ${n} of ${RAID_MISSIONS.length} · ${escapeHtml(m.when)}</p>
    ${m.briefing.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <ol>${m.tasks.map((t) => `<li>${t}</li>`).join('')}</ol>${aim}
    <p class="note credit">The story follows Thea Anderson’s essay ${source()} (The Mountain Astrologer, 2021).</p>`,
  [{ label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }, { label: 'Controls', act: () => hud.help(true) },
    { label: 'Begin', main: true, act: () => hud.begin() }]);
}

/* --------------------------------------- the goal ----------------------------------------- */

/** Her disguise, in the lines of the first person. */
export function disguiseLine() {
  const w = G.world, r = w?.raid;
  if (!r) return '';
  if (w.tick < r.disguise.until) return `<b>In disguise</b>: ${mmss(r.disguise.until - w.tick)} more, no picket fires on her`;
  if (w.tick < r.disguise.ready) return `Disguise again in ${mmss(r.disguise.ready - w.tick)}`;
  return `<kbd>C</kbd> disguise: for ${NS.DISGUISE_SECONDS} s no picket fires on her`;
}

/** The goal panel, as the raid stands. */
export function goal() {
  const w = G.world, r = w.raid;
  if (!r) return;
  const her = w.entities.get(r.tubman), lines = [];
  let head;
  const disguise = w.tick < r.disguise.until ? `in disguise, ${mmss(r.disguise.until - w.tick)} more`
    : w.tick < r.disguise.ready ? `disguise again in ${mmss(r.disguise.ready - w.tick)}` : 'disguise ready (C)';
  if (r.mission === 'scout') {
    const seen = r.quarters.filter((q) => q.visited);
    head = seen.length < r.quarters.length
      ? `Quarters visited: ${seen.length} of ${r.quarters.length}. Still to go: ${r.quarters.filter((q) => !q.visited).map((q) => q.name).join(', ')}.`
      : 'Every quarters has told her what it knows. Meet her scouts in the cove past Tar Bluff!';
    lines.push(`Dawn in ${mmss(r.dawn - w.tick)} · torpedoes found ${r.torpedoes.filter((t) => t.known).length} of ${r.torpedoes.length} · ${disguise}`);
  } else {
    const aboard = NS.freed(w), boats = [...r.boats.values()].filter((b) => !b.aground);
    head = `Aboard: ${aboard} of ${r.target} · ${boats.map((b) => `${b.name} ${b.aboard}/${b.capacity}`).join(' · ')}`;
    const waiting = r.quarters.filter((q) => r.families.some((f) => f.quarters === q.id && f.waiting));
    const uncalled = r.quarters.filter((q) => !q.called);
    if (waiting.length) lines.push(`Waiting at the ${waiting.map((q) => q.name).join(' and ')} quarters: no way to the landing. Lay bridge across the creek.`);
    else if (uncalled.length) lines.push(`Not yet called: ${uncalled.map((q) => q.name).join(', ')}. Tie a boat up at their landing and sound its whistle.`);
    const crowds = r.landings.filter((l) => l.crowd > 0);
    if (crowds.length) lines.push(`On the landings: ${crowds.map((l) => `${l.crowd} at ${l.name}`).join(', ')}${r.singing >= 0 ? ` · Harriet sings at ${r.landings[r.singing].name}` : ''}`);
    const dawn = w.tick < r.dawn ? `dawn in ${mmss(r.dawn - w.tick)}` : 'day';
    const bridge = r.pontoon.burned ? 'pontoon bridge burned' : r.pontoon.burning ? `pontoon bridge burning (${mmss(r.pontoon.burning - w.tick)})` : 'pontoon bridge standing';
    const battery = r.battery.came ? 'the battery is at the ferry!' : r.battery.held ? 'the battery is held back' : r.pontoon.burned ? '' : `battery in ${mmss(r.battery.due - w.tick)}`;
    lines.push([dawn, bridge, battery, `midday in ${mmss(r.noon - w.tick)}`, disguise].filter(Boolean).join(' · '));
  }
  if (her?.kind === 'priest' && her.hp < her.hpMax * 0.75 && her.state === 'normal') lines.push(`Harriet is hurt (${Math.ceil(her.hp)}/${her.hpMax}): below half she is knocked out.`);
  if (r.verdict) {
    head = r.verdict.won ? 'Won.' : 'Lost.';
    lines.length = 0;
  }
  const h3 = $('goal')?.querySelector('h3');
  if (h3) h3.textContent = r.mission === 'scout' ? 'Sky Messages' : 'Combahee Ferry';
  $('goalText').textContent = head;
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
  if (r.mission === 'raid' && !r.verdict) {
    if (!home) {
      home = Object.assign(document.createElement('button'), { className: 'home', id: 'raidHome', textContent: 'Steam home', title: 'Every boat that is not aground must be at Field’s Point' });
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

/** What the raid adds to a card: her, a boat, a Confederate building. Returns true if it has said
 * all there is (the card's usual lines are left out). */
export function card(e, lines, acts) {
  const w = G.world, r = w.raid;
  if (!r) return false;
  if (e.kind === 'priest' && e.id === r.tubman) {
    lines.push(e.state === 'normal' ? (e.path?.length ? 'On her way' : 'Standing') : 'Knocked out');
    lines.push('“General Tubman” to John Brown, Moses to those she led. Swift and hard to catch: she reads the signs about her (birds rising ahead mean someone waits there), wears disguises and moves by night.');
    if (e.owner === ME && e.state === 'normal') {
      if (w.tick < r.disguise.until) lines.push(`In disguise: no picket fires on her for ${mmss(r.disguise.until - w.tick)}.`);
      acts.push(`<button data-sel="disguise" ${w.tick < r.disguise.ready ? `disabled title="Ready again in ${mmss(r.disguise.ready - w.tick)}"` : 'title="For 15 s no picket fires on her (C)"'}>Disguise</button>`);
      if (r.mission === 'raid') lines.push(r.singing >= 0 ? `She sings at ${r.landings[r.singing].name}: the crowd goes aboard twice as fast.` : 'Stand her at a landing and she sings: the crowd goes aboard twice as fast.');
      lines.push('Click ground to walk; V to see through her eyes.');
    }
    lines.push(`No single shot takes more than ${NS.PRIEST_WARD} off her; below half she is knocked out, and the battle is lost.`);
    return true;
  }
  if (e.kind === 'transport' && r.boats.has(e.id)) {
    const b = r.boats.get(e.id);
    if (b.aground) {
      lines.push(r.mission === 'raid' ? 'Ran aground near the river’s mouth; her soldiers went on in the Harriet A. Weed.' : 'Her scouts wait here with their boat.');
      return true;
    }
    const at = NS.mooredAt(w, e);
    lines.push(`Aboard ${b.aboard} of ${b.capacity}${e.path?.length ? ' · under way' : at ? ` · tied up at ${at.name}` : ''}`);
    lines.push('Click the river to send her. Her guns shell the Confederate buildings within reach.');
    if (e.owner === ME && at) {
      const called = r.quarters.filter((q) => q.landing === at.id);
      if (called.length) {
        const left = called.some((q) => !q.called && q.left > 0);
        acts.push(`<button data-sel="whistle" ${left ? 'title="The people of the plantation come down to the river"' : 'disabled title="Already called"'}>Sound the whistle</button>`);
      }
      if (at.ferry) acts.push(`<button data-sel="burn" ${r.pontoon.burned || r.pontoon.burning ? 'disabled' : `title="It burns through in ${NS.BURN_SECONDS} s"`}>Burn the pontoon bridge</button>`);
    }
    return true;
  }
  if (e.kind === 'building' && e.owner !== ME) {
    const what = raidName(e);
    if (what === 'Confederate picket') lines.push('Fires on Harriet and the boats within its reach, less far at night. Not on the families: nobody aims at them.');
    if (what === 'Battery gun') lines.push('Fires down its line over the river at the ferry.');
    if (what === 'Rice mill') lines.push('The raid burned the mills and barns that fed the Confederacy. The boats’ guns can reach it from the river.');
    return true;
  }
  return false;
}

/** A card's button of the raid; true if it was one. */
export function cardClick(sel, id) {
  if (sel === 'disguise') submit({ t: 'disguise' });
  else if (sel === 'whistle') submit({ t: 'whistle', transport: id });
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
      hud.toast(`The people of the ${q.name} quarters tell her where ${d.n === 1 ? 'a torpedo lies' : `${d.n} torpedoes lie`} in the river.`, 'good');
      break;
    }
    case 'sign': hud.toast('Birds scatter over the trees ahead: a picket is watching there.', 'bad'); scene?.birds(d.x, d.y); sound.raid('birds'); break;
    case 'disguise': hud.toast(`In disguise: for ${NS.DISGUISE_SECONDS} s no picket fires on her.`, 'good'); break;
    case 'whistle': hud.toast(`The steam whistle at ${r.landings[d.id].name}: the people of the plantation come running to the river.`, 'good'); sound.raid('whistle', d.boat); break;
    case 'song': hud.toast(`Harriet sings to the crowd at ${r.landings[d.id].name}: they go aboard twice as fast.`, 'good'); sound.raid('song'); break;
    case 'emptied': hud.log(`Everyone has left the ${r.quarters[d.id].name} quarters.`, 'good'); break;
    case 'full': hud.toast(`The ${r.boats.get(d.boat).name} is full.`, 'good'); break;
    case 'torpedo': hud.toast(`A torpedo went off under the ${r.boats.get(d.boat).name}! She is holed, but afloat.`, 'bad'); scene?.splash(d.x, d.y); sound.raid('torpedo', d.boat); break;
    case 'shell': scene?.shell(d.boat, d.x, d.y); sound.raid('shell', d.boat); break;
    case 'burning': hud.toast(`The pontoon bridge is on fire: it burns through in ${NS.BURN_SECONDS} s.`, 'good'); break;
    case 'burned': hud.toast('The pontoon bridge has fallen into the river.', 'good'); sound.raid('burned'); break;
    case 'dawn': hud.toast(r.mission === 'scout' ? 'Dawn.' : 'Dawn over the Combahee.', r.mission === 'scout' ? 'bad' : ''); break;
    case 'held': hud.toast('The Confederate battery reached the ferry and found the bridge gone.', 'good'); break;
    case 'battery': hud.toast('A Confederate battery has crossed at the ferry and fires on the river!', 'bad'); sound.raid('battery'); break;
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
  const words = endText(G.raid, verdict, r.freed, r.target);
  const next = RAID_MISSIONS[RAID_MISSIONS.indexOf(m) + 1];
  const buttons = [{ label: 'Keep looking', act: () => hud.closeModal() }, { label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }];
  if (!verdict.won) buttons.push({ label: 'Try again', main: true, act: () => hud.game.start() });
  else if (next) buttons.push({ label: `Next: ${next.title}`, main: true, act: () => hud.game.start({ ...G.setup, mission: next.id }) });
  else buttons.push({ label: 'Epilogue', main: true, act: () => epilogue(hud) });
  hud.modal(`<h2>${verdict.won ? escapeHtml(m.title) : `${escapeHtml(m.title)}: not this time`}</h2>${words.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}`, buttons);
}

/** The epilogue, and where the story comes from. */
export function epilogue(hud) {
  hud.modal(`<h2>${escapeHtml(EPILOGUE.title)}</h2>${EPILOGUE.text.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <h3>Sources</h3><ul class="credits"><li>Story after Thea Anderson, ${source()}, ${escapeHtml(CAMPAIGN.source.where)}.</li>${CREDITS.slice(1).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`,
  [{ label: 'Main menu', main: true, act: () => hud.game.start(G.setup, { menu: true }) }]);
}
