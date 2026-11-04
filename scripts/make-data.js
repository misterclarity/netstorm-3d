/**
 * Build-time data, read from the netstorm-web submodule:
 *  - build/game-data.json: the units, the maps and the missions this client plays, trimmed by
 *    netstorm-web's own game-data.ts as its client trims them (and the Spells' prayer times put
 *    back, which that trimming leaves out);
 *  - build/art.json: where the original sprites and grass tiles chosen for "Sprites" mode lie in
 *    netstorm-web's repository, at the commit the submodule pins, and the frames of every unit's
 *    animation with their hot spots (the pixel that stands on the unit's place). Not copied here;
 *  - build/sounds.json: netstorm-web's sound index (each sound's file and volume, the sounds of
 *    each unit) and its music tracks, read from the same place at run time.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { slimUnits, slimMaps, slimMissions, mapsOf, hotFeet } from 'ns-client/game-data.ts';
import { FACING_FRAMES } from 'ns-client/texture-selection.ts';

const VENDOR = 'vendor/netstorm-web';
const MISSIONS = ['thewarbegins'];
const read = (path) => JSON.parse(readFileSync(`${VENDOR}/${path}`, 'utf8'));

mkdirSync('build', { recursive: true });

const rawUnits = read('data/units.json');
const units = slimUnits(rawUnits);
// netstorm-web's trimming leaves out `praytime`, which its simulation reads (defs.ts prayTime): a
// Priest would have his Spell in a tenth of a second instead of the original's 40 s of prayer for
// the Devastation. Put back from the same data.
const prayers = new Map(rawUnits.filter((u) => typeof u.praytime === 'number').map((u) => [u.id, u.praytime]));
for (const unit of units) if (prayers.has(unit.id)) unit.praytime = prayers.get(unit.id);
const maps = slimMaps(read('data/maps.json'));
const missions = slimMissions(read('data/missions.json'), maps).filter((m) => MISSIONS.includes(m.id));
writeFileSync('build/game-data.json', JSON.stringify({ units, maps: mapsOf(missions, maps), missions }));

/** Sprite key → [unit type, picture set, frame] in netstorm-web's sprite manifest ('@' = slots). */
const PICKS = {
  rainvortex: ['rainvortex', 'rvortex', 0],
  windvortex: ['windvortex', 'wvortex', 13],
  sunarcher: ['sunarcher', 'sarcher', 0],
  sunblocker: ['sunblocker', 'sunblock', 0],
  windbattery: ['windbattery', 'focus', 0],
  rainbattery: ['rainbattery', 'focus', 2],
  sunfactory: ['sunfactory', 'sfactory', 0],
  rainfactory: ['rainfactory', 'rfactory', 0],
  sunaviary: ['sunaviary', 'sflyer', 8],
  altar: ['altar', 'altar01', 3],
  sunwalker: ['sunwalker', 'golem', 4],
  sunflyer: ['sunflyer', 'sflyer', 0],
  // the picture of each facing (N, E, S, W) of the units laid facing a way, as netstorm-web draws
  // them: 'windblocker:2' is the Wind Tower with its shielded back to the south
  ...Object.fromEntries(Object.entries(FACING_FRAMES).flatMap(([type, frames]) =>
    frames.map(([set, frame], facing) => [`${type}:${facing}`, [type, set, frame]]))),
  priest: ['priest', '@', 0],
  'priest:down': ['priest', 'pchant', 0],
  geyser: ['geyser', '@', 0],
  crystal: ['nugget', 'nugget', 0],
  'residence:sun': ['residence', '@', 0],
  'residence:thunder': ['residence', '@', 6],
  'residence:wind': ['residence', '@', 12],
  'residence:rain': ['residence', '@', 18],
};
/** Grass frames picked for variety, as texture-selection.ts's GROUND_FRAMES. */
const GROUND_FRAMES = [4, 5, 47, 48, 51, 52, 53, 54];

const manifest = read('packages/client/public/data/sprites.json');
const path = (type, set, frame) => {
  const entry = manifest[type]?.[set]?.[String(frame)];
  if (!entry) throw new Error(`No sprite ${type}/${set}/${frame} in netstorm-web`);
  return entry.split('#')[0];
};
const sprites = Object.fromEntries(Object.entries(PICKS).map(([key, pick]) => [key, path(...pick)]));
// Every other unit a side can build, or that flies from an aviary, gets the first frame of its
// animation ('@'), else of its first picture set: the cards of the bottom bar and "Sprites" mode
// need a picture of each, whichever Fury a skirmish is played with.
const BUILT = new Set(['Shooter', 'Defense', 'Anti-Air', 'Source of Energy', 'Air Attack Base', 'Production', 'Energy', 'Altar',
  'Ground Transport', 'Aerial Transport', 'Aerial Attack']);
for (const unit of units) {
  const id = unit.id.toLowerCase(), sets = manifest[id];
  if (id in sprites || !BUILT.has(unit.class) || !sets) continue;
  const set = sets['@'] ? '@' : Object.keys(sets).find((k) => !/^[bs]_/.test(k)) ?? Object.keys(sets)[0];
  const first = Object.keys(sets[set]).map(Number).sort((a, b) => a - b)[0];
  sprites[id] = path(id, set, first);
}
const tiles = Object.fromEntries(['wigrass', 'ragrass', 'rgrass', 'thgrass'].map((set) =>
  [set, GROUND_FRAMES.filter((f) => manifest.isle[set]?.[String(f)]).map((f) => path('isle', set, f))]));

const git = (...args) => execFileSync('git', ['-C', VENDOR, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const remote = git('config', '--get', 'remote.origin.url').replace(/\.git$/, '');
const repo = remote.match(/github\.com[/:]([^/]+\/[^/]+)$/)?.[1] ?? 'x-ror/netstorm-web';
const base = `https://raw.githubusercontent.com/${repo}/${commit}/packages/client/public/`;
// Every animation frame ("slot") by unit type: "file,x,y" with the picture's offset from its hot
// spot, the file under sprites/<type>/ without .png; and where each type's hot spot lies in its
// footprint (hotFootRatioX/Y of its .type file).
const slots = {};
for (const [type, sets] of Object.entries(manifest)) {
  const table = sets['@'];
  if (!table) continue;
  const frames = [];
  for (const [n, entry] of Object.entries(table)) {
    const [file, offset = '0,0'] = entry.split('#');
    const prefix = `sprites/${type}/`;
    if (!file.startsWith(prefix)) continue;
    frames[Number(n)] = `${file.slice(prefix.length, -'.png'.length)},${offset}`;
  }
  slots[type] = frames;
}
const feet = Object.fromEntries(hotFeet(read('data/units.json')));
writeFileSync('build/art.json', JSON.stringify({ base, sprites, tiles, slots, hotFeet: feet }));

const sounds = read('packages/client/public/data/sounds.json');
const music = readdirSync(`${VENDOR}/packages/client/public/music`).filter((f) => f.endsWith('.mp3')).map((f) => f.replace(/\.mp3$/, ''));
writeFileSync('build/sounds.json', JSON.stringify({ base, files: sounds.files, units: sounds.units, music }));

console.log(`data: ${units.length} units, ${missions.length} mission(s), ${Object.keys(sounds.files).length} sounds, ${music.length} tracks; art and sound from ${repo}@${commit.slice(0, 7)}`);
