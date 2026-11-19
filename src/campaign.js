/**
 * The Combahee Raid: a campaign of two battles and an epilogue in NetStorm's world of islands in
 * the sky (the rules are sim/raid.ts, the map sim/raid-map.ts). A fantasy after the Combahee River
 * Raid of June 1 to 2, 1863, and after Thea Anderson's essay on its Mercurial guide (The Mountain
 * Astrologer, June/July 2021): its hero is the player's own High Priest, the Wayfinder, drawn as
 * the essay draws its subject, Mercury in a life: the swift traveller and messenger who reads the
 * signs about him, slips by in disguise and moves by night, and who lives to guide and shield
 * those who cannot fend for themselves. The words here are the game's own, not the essay's.
 *
 * In this campaign nobody is captured and nobody sacrificed, and the people who free themselves
 * are no units: they walk to the airships on their own feet, no gun aims at them, and they are
 * counted only by the ships that take them aboard.
 */
import { G } from './state.js';

/** The hero's name, as the story calls him. */
export const HERO = 'the Wayfinder';
export const Hero = 'The Wayfinder';

export const CAMPAIGN = {
  id: 'combahee',
  title: 'The Combahee Raid',
  blurb: 'A High Priest born under Mercury scouts the Sun-lords’ islands by night, then guides two airships along the Combahee wind to carry their bondfolk to freedom. Two battles and an epilogue.',
  source: {
    title: 'Harriet Tubman as a Magical, Mercurial Figure: An Astrological Analysis of the Combahee River Raid',
    author: 'Thea Anderson',
    where: 'The Mountain Astrologer, June/July 2021, published on astro.com',
    url: 'https://www.astro.com/astrology/tma_article210706_e.htm',
  },
  /** Where the raid's details come from: the skiffs and the crowd clinging to them, the overseers,
   * the pickets' riders and the false alarm, the pilings, the mills, the pigs, the aftermath. */
  history: {
    title: 'Raid on Combahee Ferry',
    where: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Raid_on_Combahee_Ferry',
  },
};

/** Who tells him what at each estate's quarters, on his scouting. */
export const CONTACTS = { Amberfield: 'Old Sandor', Highmere: 'Mother Ayo', Goldcrest: 'Kesh the pilot', Sunhollow: 'Brother Tam' };

/** The two battles, in order. */
export const RAID_MISSIONS = [
  {
    id: 'scout',
    title: 'Sky Messages',
    when: 'A night of the new moon',
    briefing: [
      'Between two chains of islands runs the Combahee, a wind that carries airships from the open sky deep into the realm of the Sun-lords. On the islands along it the Sun-lords keep bondfolk, whole families made to work their fields. Before any airship can ride the Combahee to bring them out, someone has to learn where the Sun-lords have sown their sky mines and where their sentries keep watch.',
      'That someone is the Wayfinder, a High Priest born under Mercury: the traveller and messenger, quick, cunning and hard to catch, a master of disguise who reads the signs about him, and never at rest while anyone is left behind. He goes alone, by night, as he always has. When a flock of birds scatters over the trees ahead, someone is waiting there.',
    ],
    how: [
      'Select the Wayfinder and click the ground to walk him there. A gold marker hangs over each quarters still to visit; the blue one over the cove.',
      'The four estates lie two on each chain of islands. To cross from the south chain to the north, take the Sun-lords’ bridge at Ferry Isle, far to the west.',
      'Sentries fire on him within their reach, which is shorter in the dark. Birds rise over a sentry before it can see him: then press <kbd>C</kbd> for his disguise. For 15 seconds no sentry fires on him; after that it takes 50 seconds before he can wear one again.',
    ],
  },
  {
    id: 'raid',
    title: 'The Combahee Wind',
    when: 'A night of the full moon',
    briefing: [
      'Three in the morning, under the full moon. Two airships, the Swallow and the Rainbird, old ferries fitted with guns that gunners of the Third Isle man, come to Windgate with three hundred volunteers and the Wayfinder aboard; a third, the Sentinel, snagged on a crag soon after setting out and stays behind. Laden as they are, the ships cannot climb out of the Combahee (the bondfolk call it the Combee): they ride its strong middle, low between the islands, in reach of the Sun-lords’ guns.',
      'It is the fever season. The Sun-lords have pulled most of their guards back to the high islands, leaving a few sentries along the wind, and after a false alarm last week their keep is slow to believe any rider. Every estate has its warden, though, and the bondfolk have never seen a ship come for them.',
      'The astrologers of the free isles read tonight’s sky as his. Mercury, the messenger, has just stood still in Gemini beside Uranus, the planet of sudden change: knowledge that stuns and sets free. Venus and Mars meet in Cancer, the sign of home and family: families running to the ships.',
    ],
    how: [
      'Select a ship and click a landing to send her there: she rides the wind and steers round the mines he found by herself.',
      'At a landing, select the ship and press <b>Sound the horn</b> on her card: the families of that estate walk down, and skiffs row them out to her. Highmere and Sunhollow are cut off by a rift: lay bridge pieces from the landing across it so they can come.',
      'The horn also sends volunteers ashore, up to the quarters: until they get there the estate’s <b>warden</b> lets the families slip past him only slowly. He runs from them, and from the Wayfinder if he comes near.',
      'When more than 40 wait at a landing they <b>cling to the skiffs</b>, which can hardly push off: boarding halves. Walk the Wayfinder onto the landing: his song calms them, and they board twice as fast.',
      'A sentry that sees a ship sends a <b>rider</b> to the Sun-lords’ keep. The keep doubts the first alarm; after a second, their battery sets out for the ferry early. Sentries fire on him and on the ships; nothing aims at the families.',
      'Bonus: burn the bridge at Ferry Isle from a ship’s card before the battery crosses it; and the ships’ guns set the Sun-lords’ mills burning when they come in reach.',
      'Once enough are aboard, send both ships home to Windgate and press <b>Fly home</b> on the objectives panel.',
    ],
  },
];

/** Why a battle ended, in words: `n` people aboard, `target` wanted; whether the bridge burned. */
export function endText(mission, verdict, n, target, burned) {
  if (mission === 'scout') {
    if (verdict.won) {
      return ['He is back with his scouts before first light. What the bondfolk told him goes home to Windgate: where the six mines float, where the sentries stand, the way to the ferry. The raid is planned around it.',
        'At the next full moon the airships will ride the Combahee.'];
    }
    return verdict.why === 'dawn'
      ? ['The sky is getting light, and he is still behind the sentries’ lines. He slips back unseen, this time, and the scouting must wait for another dark night.', 'Try again: the night is long enough if he does not linger.']
      : ['A sentry’s shot has knocked him out. His scouts carry him back to their skiff, and the scouting must wait for another dark night.', 'Try again: watch for the birds, and wear a disguise past the sentries.'];
  }
  if (verdict.won) {
    return [`The ships fly home with ${n} people aboard, with their baskets and pots, their chickens and their pigs. Not one volunteer was lost; the Wayfinder’s cloak was torn in the crush at the skiffs.`,
      burned ? 'Behind them the Sun-lords’ bridge, their mills and their barns are burning, and their battery came too late to stop the ships. Many of the men freed tonight will fly with the Wayfinder on the next raid.'
        : 'Behind them the Sun-lords’ mills and barns are burning; their bridge at the ferry still stands, but the ships are beyond their guns. Many of the men freed tonight will fly with the Wayfinder on the next raid.'];
  }
  if (verdict.why === 'down') {
    return ['The Wayfinder has been hit and knocked out. The volunteers carry him aboard, and the ships turn back.', 'Try again: keep him out of the sentries’ reach and the battery’s line of fire.'];
  }
  return [`The ships are home with ${n} people aboard, fewer than the ${target} you set out for.`, 'Try again: sound the horn at every landing, lay bridge across the rifts, and let him sing where the crowd is largest.'];
}

/** The epilogue, after the raid is won. */
export const EPILOGUE = {
  title: 'Mercury Returns',
  text: [
    'Five weeks after the raid, Mercury came back, moving forward again, to the degree of Gemini where it had stood still on the night of the raid. On that day the free isles named the Wayfinder as the raid’s leader, and the bondfolk he had brought out built the first houses of their own.',
    'The people brought out of bondage slept their first free nights in the great hall at Windgate, then settled on an island of their own; many of the men joined the volunteers.',
    'Within weeks the free isles raided again the same way. The Sun-lords threw up new walls and batteries along their winds, but their estates were never rebuilt; their broadsheet raged against the vandals, and could not even spell the word.',
    'The astrologers say that is how a Mercurial life runs: swift and out of sight, and at its strongest when it carries a message or a people through. He would go back for others, as he always had.',
  ],
};

/** Where the story comes from, for the epilogue (the link is the essay's, in raid-hud.js). */
export const CREDITS = [
  'The raid of 1863 freed 756 people, by the historian Edda L. Fields-Black’s count; the 756 bondfolk of this campaign are in their honour.',
  'The sky of the raid is that of June 1 to 2, 1863, worked out with Astronomy Engine: Mercury stood still at 26.6° Gemini on June 1, and was back there by July 10.',
  'The world, the names, the map and the numbers are the game’s own.',
];

/* -------------------------------------- progress ------------------------------------------ */

const STORAGE = 'netstorm-3d:combahee';

/** What the player has done of the campaign: the battles won, the sky mines found. */
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
  if (mission === 'scout') p.known = world.raid.mines.filter((m) => m.known).map((m) => m.id);
  try { localStorage.setItem(STORAGE, JSON.stringify(p)); } catch { /* not remembering is harmless */ }
}

/** Whether a battle can be played: the first always, the second once the first is won. */
export const unlocked = (mission) => mission === 'scout' || progress().done.includes('scout');

/* ------------------------------------- what is what --------------------------------------- */

/** What the Sun-lords' buildings are in the raid, by type. */
const RAID_NAMES = { sunarcher: 'Sentry', suncannon: 'Battery gun', sunbattery: 'Mill' };

/** The name an entity goes by in the raid, or null where the game's own name stands. */
export function raidName(e) {
  const r = e ? G.world?.raid : null;
  if (!r) return null;
  if (e.kind === 'priest' && e.id === r.guide) return Hero;
  if (e.kind === 'transport' && r.ships.has(e.id)) return r.ships.get(e.id).name;
  if (e.kind === 'building') return RAID_NAMES[e.type] ?? null;
  return null;
}
