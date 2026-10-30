/**
 * Build-time data, read from the netstorm-web submodule:
 *  - build/game-data.json: the units, the maps and the missions this client plays, trimmed by
 *    netstorm-web's own game-data.ts as its client trims them;
 *  - build/art.json: where the original sprites and grass tiles chosen for "Sprites" mode lie in
 *    netstorm-web's repository, at the commit the submodule pins. They are not copied here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { slimUnits, slimMaps, slimMissions, mapsOf } from 'ns-client/game-data.ts';

const VENDOR = 'vendor/netstorm-web';
const MISSIONS = ['thewarbegins'];
const read = (path) => JSON.parse(readFileSync(`${VENDOR}/${path}`, 'utf8'));

mkdirSync('build', { recursive: true });

const units = slimUnits(read('data/units.json'));
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
  'suncannon:0': ['suncannon', 'scannon', 10],
  'suncannon:1': ['suncannon', 'scannon', 5],
  'suncannon:2': ['suncannon', 'scannon', 0],
  'suncannon:3': ['suncannon', 'scannon', 14],
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
const tiles = Object.fromEntries(['wigrass', 'ragrass', 'rgrass', 'thgrass'].map((set) =>
  [set, GROUND_FRAMES.filter((f) => manifest.isle[set]?.[String(f)]).map((f) => path('isle', set, f))]));

const git = (...args) => execFileSync('git', ['-C', VENDOR, ...args], { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const remote = git('config', '--get', 'remote.origin.url').replace(/\.git$/, '');
const repo = remote.match(/github\.com[/:]([^/]+\/[^/]+)$/)?.[1] ?? 'x-ror/netstorm-web';
const base = `https://raw.githubusercontent.com/${repo}/${commit}/packages/client/public/`;
writeFileSync('build/art.json', JSON.stringify({ base, sprites, tiles }, null, 2));

console.log(`data: ${units.length} units, ${missions.length} mission(s); art from ${repo}@${commit.slice(0, 7)}`);
