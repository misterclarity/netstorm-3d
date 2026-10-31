# NetStorm 3D

An A-Frame reimagining of *NetStorm: Islands At War* (1997): floating islands, bridges and Storm
Power in a 3D scene you can orbit. The rules, the missions and the computer opponent come from
[netstorm-web](https://github.com/x-ror/netstorm-web), a browser remake of the game, which this
project uses unchanged as its engine. This repository is the 3D client around it.

**Play:** https://misterclarity.github.io/netstorm-3d/ (once GitHub Pages is on, see below)

![The first mission in 3D mode](docs/screenshot.jpg)

## What you can play

The main menu offers two kinds of battle against netstorm-web's computer opponent:

- **Mission 1, *The War Begins!***, guided step by step (below).
- **Skirmish**: a random map from a seed, with your Fury and the enemy's (Wind, Rain or Thunder),
  2 to 9 islands, the opponent's level (easy, normal, hard) and the starting Storm Power. You know
  the Sun's units; the computer plays an alignment drawn from the seed. New geysers rise during
  the battle. The same seed gives the same map, so a map can be replayed or shared.

In the mission:

1. Your **Priest** builds a **Sun Workshop**. Put the **Sun Cannon** into its production slots.
2. Build **Golems** at your Temple and send them to **geysers** for Storm Power.
3. Lay **bridge pieces** (they arrive in your hand over time and join only by their ends) toward
   the islets and the enemy in the east.
4. Build **Sun Cannons** where your Energy reaches. A Rain Workshop unlocks Rain Generators, which
   carry Energy further out.
5. Knock the enemy Priest out, have a Golem carry him to your **Altar**, then send your Priest to
   the Altar to perform the sacrifice.

If something goes wrong, a small panel says so and the game keeps running. **Help** shows which
build you are playing, and a notice offers to reload when a newer one has been published.

A *Next step* card reads the state of the battle and tells you what to do next. **Help** in the
top bar lists the controls: orbit by dragging, pan with right-drag or Shift-drag, zoom with the
wheel or a pinch, `R` rotates pieces and cannons, `Esc` cancels, `Space` pauses.

To see where you stand:

- **Reach as the game measures it.** A building in hand shows where it will fire: a cannon's
  straight line, a Disc Thrower's square, the Crossbow's arc, an air base's hunting ground.
  Enemy guns' reach shows in red while you hold a piece or a building, for the gun under the
  cursor, or all the time with `G` (*Enemy range*).
- **Bridge ends.** A piece in hand marks the ends it joins by, bright where they meet ground or
  bridge.
- **Minimap** in the top-left corner: click or drag to look there. `H` looks at your Temple, `P`
  at your Priest, `F` keeps the camera on the selected unit.
- **Event log** (`L`): what happened and when, including what was built, lost and destroyed.

Two art styles can be switched in the top bar:

- **3D**: low-poly models made for this project.
- **Sprites**: the original game's sprites as cards standing in the 3D world, with its grass
  tiles on the islands. They are not part of this repository. The page loads them at run time
  from netstorm-web's repository on GitHub, at the commit the submodule pins. Where the page may
  not load images from other sites, the button stays off and the models are used.

**Sound and music** come from netstorm-web too, read at run time in the same way: the battle's
events (bridges laid, buildings rising and done, guns firing and shells landing, explosions, a
Priest captured, the sacrifice), units answering when you pick or order them, the wind with
far-off cries, and the original's music, the Fury tracks in turn, with a fanfare or a dirge at
the end. Sounds are louder the nearer they are to what the camera looks at, and panned to their
side of the screen. **Sound** and **Music** in the top bar turn them off; the choice is
remembered in the browser.

## Running it

You need Node.js 20 or newer.

```sh
git clone --recurse-submodules https://github.com/misterclarity/netstorm-3d
cd netstorm-3d
npm install
npm run dev        # http://localhost:8080, rebuilt as you edit
```

Already cloned without `--recurse-submodules`? Run `git submodule update --init` first.

| Command | What it does |
| --- | --- |
| `npm run dev` | Builds in watch mode and serves the page on port 8080 (set `PORT` to change it). |
| `npm run build` | Writes `dist/index.html`: one self-contained file you can open directly or host anywhere. A-Frame loads from its CDN. |
| `npm run check` | Plays the mission headless for a couple of minutes of game time (no browser), failing on any error. CI runs it. |
| `npm run playtest` | Plays the built page in headless Chromium (Playwright): the mission's opening, a staged endgame and five minutes of a skirmish, failing on any page error. Needs `npx playwright install chromium` once. CI runs it. |

## How it is built

The whole scene is A-Frame: [`index.html`](index.html) declares the sky, the lights, the clouds,
the terrain, the units, the effects and the camera as entities, and `src/` registers the shader,
systems and components they use.

| Piece | Kind | Role |
| --- | --- | --- |
| `ns-game` | system | Runs the match each frame (netstorm-web's `World`, its AI in a Web Worker), turns clicks and keys into the game's commands, passes events to the HUD and effects. |
| `ns-art` | system | Loads the original sprites and switches between the two art styles. |
| `ns-sound` | system | Sound effects and music with the Web Audio API, after netstorm-web's `sound.ts`: what plays on which event, the construction loop, the guns, the music cycle. |
| `ns-sky` | shader | The gradient sky on `<a-sky>`. |
| `orbit-rig` | component | The orbiting camera; emits `ns-tap` and `ns-hover` for the game. |
| `ns-sun` | component | Shadow settings the `light` component does not cover. |
| `ns-clouds` | component | A ring of instanced low-poly clouds (used twice, `__low` and `__high`). |
| `ns-terrain` | component | The floating islands and the bridges, rebuilt when the world's terrain changes. |
| `ns-units` / `ns-unit` | components | One `<a-entity ns-unit="id: N">` per thing in the world: model or sprite card, smooth movement, health bar. |
| `ns-residence` | component | The map's Residences. |
| `ns-effects` | component | Shells in flight, impacts, explosions, falling bridges and islets. |
| `ns-placement` | component | Bridge and building previews with the reason a spot is refused and the ends a piece joins by; the reach of guns (yours and the enemy's, `src/reach.js`), Energy rings, selection. |

The HUD (`src/hud.js`) and the minimap (`src/minimap.js`) are plain DOM over the scene. `src/models.js` holds the low-poly models.

**netstorm-web** sits in `vendor/netstorm-web` as a git submodule pinned to one commit. The build
bundles its TypeScript straight from there (`src/engine.js` lists what is used: the simulation,
the mission set-up, the mission script's events, the AI schedule and worker). Its client's
compiled interface strings are replaced by `src/messages.js`, which reads its English messages
file. To follow netstorm-web, update the submodule and rebuild:

```sh
git -C vendor/netstorm-web pull origin main
npm run check && npm run build
git add vendor/netstorm-web && git commit -m "Update netstorm-web"
```

Moving the pinned commit also moves the URLs the original sprites, sounds and music are read
from (`scripts/make-data.js` writes them to `build/art.json` and `build/sounds.json`).

**Deploying:** [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs the check, builds
`dist/` and publishes it to GitHub Pages on every push to `main`. Pages has to be set to deploy
from GitHub Actions once (*Settings → Pages → Source: GitHub Actions*).

## Not there yet

- Only the first mission of the campaign; the engine has the other fifteen. Skirmish has no
  spells or Obelisks yet.
- In "Sprites" mode each unit is one still frame, not the original's animation.
- Tested in desktop Chromium; phones and other browsers are less tried.

## Credits and legal

- *NetStorm: Islands At War* © 1997 Titanic Entertainment / Activision. This is a non-commercial
  fan project, not affiliated with them. The original sprites, sounds and music are not in this
  repository; the page reads them from netstorm-web's repository when it runs.
- [netstorm-web](https://github.com/x-ror/netstorm-web) by x-ror: the simulation, the missions,
  the computer opponent and the sound design this client follows. It is included as a submodule under its own terms; it has no LICENSE
  file, and its `package.json` declares ISC. The built page (`dist/index.html`) contains its code.
- The code in this repository is licensed under the GNU General Public License v3.0
  (see [LICENSE](LICENSE)).
- Built with [A-Frame](https://aframe.io) 1.8 and three.js.
