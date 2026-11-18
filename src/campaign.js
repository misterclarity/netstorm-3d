/**
 * The Combahee River Raid: a campaign of two battles and an epilogue (the rules are sim/raid.ts,
 * the map sim/raid-map.ts). Its story follows Thea Anderson's essay "Harriet Tubman as a Magical,
 * Mercurial Figure: An Astrological Analysis of the Combahee River Raid" (The Mountain Astrologer,
 * June/July 2021), and it shows Harriet Tubman as the essay does: Mercury in a human life, the
 * swift traveller and messenger who reads the signs about her, slips by in disguise and moves by
 * night. The words here are the game's own, not the essay's; the facts of the raid are the
 * historians'. Her figure (models.js) is the game's own too, in the dress of her time: no portrait.
 *
 * In this campaign nobody is captured and nobody sacrificed, and the people who free themselves
 * are no units: they walk to the boats on their own feet, no gun aims at them, and they are counted
 * only by the boats that take them aboard.
 */
import { G } from './state.js';

export const CAMPAIGN = {
  id: 'combahee',
  title: 'The Combahee River Raid',
  when: '1863',
  blurb: 'Harriet Tubman scouts the river by night, then guides the gunboats up the Combahee. Two battles and an epilogue, after Thea Anderson’s essay on Tubman as a Mercurial figure.',
  source: {
    title: 'Harriet Tubman as a Magical, Mercurial Figure: An Astrological Analysis of the Combahee River Raid',
    author: 'Thea Anderson',
    where: 'The Mountain Astrologer, June/July 2021, published on astro.com',
    url: 'https://www.astro.com/astrology/tma_article210706_e.htm',
  },
};

/** The two battles, in order. */
export const RAID_MISSIONS = [
  {
    id: 'scout',
    title: 'Sky Messages',
    when: 'Spring 1863',
    briefing: [
      'South Carolina, spring 1863. Harriet Tubman escaped slavery fourteen years ago and went back again and again to lead others out. Now she scouts for the Union army at Beaufort. Before any boat can go up the Combahee River, someone has to learn where the Confederates sank their torpedoes and where their pickets keep watch. She goes herself, by night, as she always has.',
      'Thea Anderson reads her as Mercury in a human life: the traveller and messenger, quick, cunning and hard to catch, a master of disguise who reads the signs about her. When a flock of birds scatters over the trees ahead, someone is waiting there.',
    ],
    tasks: [
      'Walk her along both banks under the new moon and visit the <b>quarters</b> of the Nichols, Middleton, Heyward and Lowndes plantations: the people there know where the torpedoes lie.',
      'Cross the river at the ferry, on the pontoon bridge, and meet her scouts in the <b>cove past Tar Bluff</b> before dawn.',
      '<b>Pickets</b> fire on anyone in their reach, which is shorter in the dark. Birds rise as she comes near one. <b>Disguise</b> (<kbd>C</kbd>) keeps every picket from firing on her for 15 seconds; then it takes 50 to wear one again.',
      'If she is knocked out, or dawn finds her behind the lines, the scouting has failed.',
    ],
  },
  {
    id: 'raid',
    title: 'Combahee Ferry',
    when: 'The night of June 1 to 2, 1863',
    briefing: [
      'The night of June 1, 1863, under a full moon. Three steamers leave Beaufort with about three hundred soldiers of the 2nd South Carolina Volunteers, a Black regiment, under Colonel James Montgomery. Harriet Tubman is aboard the lead boat, the John Adams. The Sentinel runs aground near the river’s mouth; the John Adams and the Harriet A. Weed go on.',
      'The essay reads the raid’s own sky as Mercury’s. The messenger planet had just stood still in Gemini, close to Uranus, the planet of sudden change: knowledge that stuns and sets free. Venus and Mars met in Cancer, the sign of home and family: families running to the boats.',
    ],
    tasks: [
      'Steam up the river past the torpedoes she found: the boats keep clear of them on their own. Select a boat and click the river to send it.',
      'A boat tied up at a <b>landing</b> can <b>sound its whistle</b>: the people of that plantation come down to the river, family by family, and go aboard. Two landings are cut off by a creek: <b>lay bridge</b> for them.',
      'Where Harriet stands at a landing she <b>sings</b>, and the crowd goes aboard twice as fast.',
      '<b>Burn the pontoon bridge</b> from the ferry landing before a Confederate battery crosses it after dawn. Then bring the boats home to Field’s Point and press <b>Steam home</b>.',
    ],
  },
];

/** Why a battle ended, in words: `n` people aboard, `target` wanted. */
export function endText(mission, verdict, n, target) {
  if (mission === 'scout') {
    if (verdict.won) {
      return ['She is back with her scouts before first light. What the people in the quarters told her goes back to Beaufort: where the six torpedoes lie, where the pickets stand, the road to the ferry. Colonel Montgomery plans the raid around it.',
        'Weeks later, Boston’s Commonwealth would name her as the leader of the raid that followed.'];
    }
    return verdict.why === 'dawn'
      ? ['The sky is getting light, and she is still behind the pickets’ lines. She slips back unseen, this time, and the scouting must wait for another dark night.', 'Try again: the night is long enough if she does not linger.']
      : ['A picket’s shot has knocked her out. Her scouts carry her back to their boat, and the scouting must wait for another dark night.', 'Try again: watch for the birds, and wear a disguise past the pickets.'];
  }
  if (verdict.won) {
    return [`The boats steam home with ${n} people aboard.`,
      'On June 2, 1863 the raid freed more than seven hundred people: 756, by the historian Edda L. Fields-Black’s count. Within days many of the freed men had joined the 2nd South Carolina. The pontoon bridge, the rice mills and the barns burned, and the Confederate troops came too late to stop the boats.'];
  }
  if (verdict.why === 'down') {
    return ['Harriet has been hit and knocked out. The soldiers carry her aboard, and the boats turn back.', 'Try again: keep her out of the pickets’ reach and the battery’s line of fire.'];
  }
  return [`The boats are home with ${n} people aboard, fewer than the ${target} you set out for.`, 'Try again: whistle at every landing, lay bridge across the creeks, and let her sing where the crowd is largest.'];
}

/** The epilogue, after the raid is won. */
export const EPILOGUE = {
  title: 'July 10, 1863',
  text: [
    'On that day, five weeks after the raid, Boston’s Commonwealth named Harriet Tubman as its leader.',
    'Thea Anderson points out that on that same day Mercury came back, moving forward again, to the degree of Gemini it had held on the night of the raid, where it had turned retrograde. The ephemeris agrees: Mercury stood still at 26.6° Gemini on June 1, 1863, and was back there by July 10.',
    'Tubman was barely paid for her years of service in the war. She lived on in Auburn, New York, until 1913, caring for the old and the poor and working for women’s right to vote. More than a century later, Black feminists in Boston named their collective after the raid: the Combahee River Collective.',
  ],
};

/** Where the story and the facts come from, for the briefings and the epilogue. */
export const CREDITS = [
  `Story after Thea Anderson, “${CAMPAIGN.source.title}”, ${CAMPAIGN.source.where}.`,
  'Facts of the raid from the National Park Service and the historians’ accounts (Edda L. Fields-Black, Combee, 2024). The sky of June 1 to 2, 1863 worked out with Astronomy Engine.',
  'The map, the numbers and the figures are the game’s own; Harriet Tubman’s figure is not a portrait.',
];

/* -------------------------------------- progress ------------------------------------------ */

const STORAGE = 'netstorm-3d:combahee';

/** What the player has done of the campaign: the battles won, the torpedoes found. */
export function progress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return { done: Array.isArray(saved.done) ? saved.done : [], known: Array.isArray(saved.known) ? saved.known : [] };
  } catch {
    return { done: [], known: [] };
  }
}

export function remember(mission, world) {
  const p = progress();
  if (!p.done.includes(mission)) p.done.push(mission);
  if (mission === 'scout') p.known = world.raid.torpedoes.filter((t) => t.known).map((t) => t.id);
  try { localStorage.setItem(STORAGE, JSON.stringify(p)); } catch { /* not remembering is harmless */ }
}

/** Whether a battle can be played: the first always, the second once the first is won. */
export const unlocked = (mission) => mission === 'scout' || progress().done.includes('scout');

/* ------------------------------------- what is what --------------------------------------- */

/** What the raid's buildings are, by type. */
const RAID_NAMES = { sunarcher: 'Confederate picket', suncannon: 'Battery gun', sunbattery: 'Rice mill' };

/** The name an entity goes by in the raid, or null where the game's own name stands. */
export function raidName(e) {
  const r = e ? G.world?.raid : null;
  if (!r) return null;
  if (e.kind === 'priest' && e.id === r.tubman) return 'Harriet Tubman';
  if (e.kind === 'transport' && r.boats.has(e.id)) return r.boats.get(e.id).name;
  if (e.kind === 'building') return RAID_NAMES[e.type] ?? null;
  return null;
}
