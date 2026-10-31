/**
 * NetStorm 3D: netstorm-web's game in an A-Frame scene. This registers the shader, systems and
 * components that index.html uses; it has to run before <a-scene> starts.
 */
import './errors.js'; // first: it guards every component registered after it
import './shaders/ns-sky.js';
import './systems/ns-art.js';
import './systems/ns-sound.js';
import './systems/ns-game.js';
import './components/orbit-rig.js';
import './components/ns-sun.js';
import './components/ns-clouds.js';
import './components/ns-terrain.js';
import './components/ns-units.js';
import './components/ns-effects.js';
import './components/ns-placement.js';
