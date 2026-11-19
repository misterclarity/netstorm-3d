/**
 * The Combahee Raid on the screen (src/campaign.js has its words, sim/raid.ts its rules): its part
 * of the main menu, the briefings, the goal panel as the battle goes, the cards of the Wayfinder
 * and the airships, what its events say and sound like, and the pages at its end.
 */
import { G, NS, ME, TPS, escapeHtml } from './state.js';
import { submit } from './game.js';
import { CAMPAIGN, RAID_MISSIONS, EPILOGUE, CREDITS, HERO, Hero, endText, progress, remember, unlocked, raidName } from './campaign.js';

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
  const m = missionOf(G.raid), r = G.world.raid, n = RAID_MISSIONS.indexOf(m) + 1;
  const aim = G.raid === 'raid' ? `<p class="note">Bring at least <b>${r.target}</b> people aboard, and the ships home to Windgate by midday.</p>` : '';
  hud.modal(`<h2>${escapeHtml(m.title)}</h2><p class="when">${escapeHtml(CAMPAIGN.title)} · battle ${n} of ${RAID_MISSIONS.length} · ${escapeHtml(m.when)}</p>
    ${m.briefing.map((p) => `<p class="text">${escapeHtml(p)}</p>`).join('')}
    <ol>${m.tasks.map((t) => `<li>${t}</li>`).join('')}</ol>${aim}
    <p class="note credit">After the Combahee River Raid of 1863 and ${essay()} on its Mercurial guide (The Mountain Astrologer, 2021).</p>`,
  [{ label: 'Main menu', act: () => hud.game.start(G.setup, { menu: true }) }, { label: 'Controls', act: () => hud.help(true) },
    { label: 'Begin', main: true, act: () => hud.begin() }]);
}

/* --------------------------------------- the goal ----------------------------------------- */

/** His disguise, in the lines of the first person. */
export function disguiseLine() {
  const w = G.world, r = w?.raid;
  if (!r) return '';
  if (w.tick < r.disguise.until) return `<b>In disguise</b>: ${mmss(r.disguise.until - w.tick)} more, no sentry fires on him`;
  if (w.tick < r.disguise.ready) return `Disguise again in ${mmss(r.disguise.ready - w.tick)}`;
  return `<kbd>C</kbd> disguise: for ${NS.DISGUISE_SECONDS} s no sentry fires on him`;
}

/** The goal panel, as the raid stands. */
export function goal() {
  const w = G.world, r = w.raid;
  if (!r) return;
  const him = w.entities.get(r.guide), lines = [];
  let head;
  const disguise = w.tick < r.disguise.until ? `in disguise, ${mmss(r.disguise.until - w.tick)} more`
    : w.tick < r.disguise.ready ? `disguise again in ${mmss(r.disguise.ready - w.tick)}` : 'disguise ready (C)';
  if (r.mission === 'scout') {
    const seen = r.quarters.filter((q) => q.visited);
    head = seen.length < r.quarters.length
      ? `Quarters visited: ${seen.length} of ${r.quarters.length}. Still to go: ${r.quarters.filter((q) => !q.visited).map((q) => q.name).join(', ')}.`
      : 'Every quarters has told him what it knows. Meet his scouts in the cove past Raven Bluff!';
    lines.push(`Dawn in ${mmss(r.dawn - w.tick)} · sky mines found ${r.mines.filter((m) => m.known).length} of ${r.mines.length} · ${disguise}`);
  } else {
    const aboard = NS.freed(w), ships = [...r.ships.values()].filter((b) => !b.snagged);
    head = `Aboard: ${aboard} of ${r.target} · ${ships.map((b) => `${b.name} ${b.aboard}/${b.capacity}`).join(' · ')}`;
    const waiting = r.quarters.filter((q) => r.families.some((f) => f.quarters === q.id && f.waiting));
    const uncalled = r.quarters.filter((q) => !q.called);
    if (waiting.length) lines.push(`Waiting at the ${waiting.map((q) => q.name).join(' and ')} quarters: no way to the landing. Lay bridge across the rift.`);
    else if (uncalled.length) lines.push(`Not yet called: ${uncalled.map((q) => q.name).join(', ')}. Tie a ship up at their landing and sound its horn.`);
    const crowds = r.landings.filter((l) => l.crowd > 0);
    if (crowds.length) lines.push(`On the landings: ${crowds.map((l) => `${l.crowd} at ${l.name}`).join(', ')}${r.singing >= 0 ? ` · ${HERO} sings at ${r.landings[r.singing].name}` : ''}`);
    const dawn = w.tick < r.dawn ? `dawn in ${mmss(r.dawn - w.tick)}` : 'day';
    const bridge = r.bridge.burned ? 'the bridge at the ferry burned' : r.bridge.burning ? `the bridge at the ferry burning (${mmss(r.bridge.burning - w.tick)})` : 'the bridge at the ferry standing';
    const battery = r.battery.came ? 'the battery is at the ferry!' : r.battery.held ? 'the battery is held back' : r.bridge.burned ? '' : `battery in ${mmss(r.battery.due - w.tick)}`;
    lines.push([dawn, bridge, battery, `midday in ${mmss(r.noon - w.tick)}`, disguise].filter(Boolean).join(' · '));
  }
  if (him?.kind === 'priest' && him.hp < him.hpMax * 0.75 && him.state === 'normal') lines.push(`${Hero} is hurt (${Math.ceil(him.hp)}/${him.hpMax}): below half he is knocked out.`);
  if (r.verdict) {
    head = r.verdict.won ? 'Won.' : 'Lost.';
    lines.length = 0;
  }
  const h3 = $('goal')?.querySelector('h3');
  if (h3) h3.textContent = missionOf(r.mission)?.title ?? CAMPAIGN.title;
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
    <h3>Where it comes from</h3><ul class="credits"><li>A fantasy after the Combahee River Raid of June 1 to 2, 1863, and after ${escapeHtml(CAMPAIGN.source.author)}, ${source()}, ${escapeHtml(CAMPAIGN.source.where)}: its hero is drawn as the essay draws the raid’s guide, Mercury in a life.</li>${CREDITS.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`,
  [{ label: 'Main menu', main: true, act: () => hud.game.start(G.setup, { menu: true }) }]);
}
