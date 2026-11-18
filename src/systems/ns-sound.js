/**
 * Sound and music: netstorm-web's sound effects and the original's music, read at run time from
 * netstorm-web's repository like the sprites (they are not part of this repository). What plays
 * when follows netstorm-web's client (sound.ts, match.ts, renderer.ts, controls.ts): the sounds of
 * the battle's events, guns firing and shells landing, a loop while something is built, a unit
 * answering when picked or ordered, the wind with far-off cries, and the Fury tracks in turn.
 *
 * A sound with a place is louder the nearer it is to what the camera looks at and is panned to its
 * side of the screen.
 */
import { NS, G, ME, wx, wz } from '../state.js';
import { toLocal, toScene, unit } from '../space.js';
import SOUNDS from '../../build/sounds.json';

const { THREE } = AFRAME;
const MIN_GAP_MS = 100; // the same sound again no sooner
const MAX_VOICES = 4; // copies of one sound at once
const LATE_MS = 250; // a sound that took longer to load is dropped
const WIND = 'distantwindquiet';
const FAR_OFF = ['thunderquietdistant', 'eaglescream', 'whale'];
const FURY_TRACKS = ['wind22', 'rain22', 'thu22', 'sun22'];
const FULL_REACH = 20; // cells from the view's middle heard at full volume
const FADE_REACH = 60; // cells more over which it fades
const FAINTEST = 0.08;
const PAN_REACH = 0.7;
const SACRIFICE = { cry: 4, upgradeCry: 1.5, thunder: 2.8 }; // seconds after the last rune (match.ts)
const SACRIFICE_SOUNDS = ['itisdone2', 'priestsacrifice2', 'priestsacrifice4', 'thundercrack'];
const SETTINGS_KEY = 'netstorm-3d:sound';

AFRAME.registerSystem('ns-sound', {
  init() {
    this.ctx = null;
    this.buffers = new Map();
    this.tracks = new Map();
    this.last = new Map();
    this.voices = new Map();
    this.building = new Map(); // building id → stop its construction loop
    this.shots = new Map(); // shots in flight → where they land
    this.strikes = new Map(); // flyer → its strike cooldown at the last step
    this.echoes = [];
    this.played = []; // the last few sounds, for tests and the console
    this.settings = { sound: true, music: true };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')); } catch { /* no storage */ }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      // a headset may hide the page it shows the scene for: the sound goes on there
      if (document.hidden && !this.el.xrSession) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
  },

  /* ------------------------------------- the engine -------------------------------------- */
  audio() {
    if (this.ctx || typeof AudioContext === 'undefined') return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sfx = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfx.connect(ctx.destination);
    this.musicGain.connect(ctx.destination);
    this.applySettings();
    // browsers start audio only after the player has done something
    const wake = () => ctx.resume().catch(() => {});
    for (const kind of ['pointerdown', 'keydown']) window.addEventListener(kind, wake, { capture: true });
    return ctx;
  },

  applySettings() {
    if (this.sfx) this.sfx.gain.value = this.settings.sound ? 1 : 0;
    if (this.musicGain) this.musicGain.gain.value = this.settings.music ? 0.8 : 0;
  },

  set(key, on) {
    this.settings[key] = on;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* no storage */ }
    this.audio();
    this.applySettings();
    if (key === 'music' && on && this.track?.paused) this.track.play().catch(() => {});
  },

  load(name) {
    let found = this.buffers.get(name);
    if (!found) {
      const file = SOUNDS.files[name], ctx = this.audio();
      found = file && ctx
        ? fetch(SOUNDS.base + file[0]).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => undefined)
        : Promise.resolve(undefined);
      this.buffers.set(name, found);
    }
    return found;
  },

  /**
   * Volume and pan of a sound at battlefield position `at` (THREE.Vector3, in cells), as the camera
   * hears it: from what the orbiting camera looks at, or from a headset's place over the table.
   */
  where(at) {
    if (!at) return { volume: 1, pan: 0 };
    const rig = document.getElementById('camera')?.components['orbit-rig'];
    const cam = this.el.camera;
    let volume = 1, pan = 0, far = null;
    if (rig?.enabled) {
      const t = toLocal(rig.cur.t);
      far = Math.hypot(at.x - t.x, at.z - t.z) + Math.max(0, rig.cur.r / unit() - 45) * 0.35;
    } else if (cam) {
      const head = toLocal(cam.getWorldPosition(new AFRAME.THREE.Vector3()));
      far = Math.hypot(at.x - head.x, at.z - head.z) * 0.6 + Math.max(0, head.y - 45) * 0.35;
    }
    if (far !== null) volume = Math.min(1, Math.max(FAINTEST, 1 - (far - FULL_REACH) / FADE_REACH));
    if (cam) {
      const p = toScene(at).project(cam);
      if (p.z < 1) pan = Math.max(-1, Math.min(1, p.x)) * PAN_REACH;
    }
    return { volume, pan };
  },

  play(name, at) {
    const file = name && SOUNDS.files[name];
    const now = performance.now();
    if (!file || !this.settings.sound || now - (this.last.get(name) ?? -Infinity) < MIN_GAP_MS || (this.voices.get(name) ?? 0) >= MAX_VOICES) return;
    this.last.set(name, now);
    this.voices.set(name, (this.voices.get(name) ?? 0) + 1);
    this.played.push(name);
    this.playedCount = (this.playedCount ?? 0) + 1;
    if (this.played.length > 50) this.played.shift();
    const { volume, pan } = this.where(at);
    const release = () => this.voices.set(name, Math.max(0, (this.voices.get(name) ?? 1) - 1));
    this.load(name).then((buffer) => {
      if (!buffer || !this.ctx || performance.now() - now > LATE_MS) { release(); return; }
      this.out(buffer, file[1] * volume, pan, false).addEventListener('ended', release);
    });
  },

  /** A sound looped until the returned function is called. */
  loop(name, at) {
    const file = SOUNDS.files[name];
    if (!file) return () => {};
    let source, stopped = false;
    const { volume, pan } = this.where(at);
    this.load(name).then((buffer) => {
      if (!stopped && buffer && this.ctx) source = this.out(buffer, file[1] * volume, pan, true);
    });
    return () => { stopped = true; source?.stop(); };
  },

  out(buffer, volume, pan, loop) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(this.sfx);
    source.start();
    return source;
  },

  /**
   * The raid's sounds (raid-hud.js): the original's where it has one (a cannon, a blast, a bridge
   * falling), and three made here, for it has none: a steamboat's whistle, a flock's wings, and a
   * soft chord as Harriet sings to the crowd (no voice: the game does not put words in her mouth).
   * `boat`, the boat it comes from.
   */
  raid(kind, boat) {
    const at = boat === undefined ? null : this.el.systems['ns-game']?.units()?.byId.get(boat)?.object3D.position ?? null;
    if (kind === 'shell') { this.play('suncannonfire', at); return; }
    if (kind === 'torpedo') { this.play('explosion', at); return; }
    if (kind === 'burned') { this.play('bridgefall'); return; }
    if (kind === 'battery') { this.play('suncannonfire'); this.later('thunderquietdistant', 0.6); return; }
    const ctx = this.audio();
    if (!ctx || !this.settings.sound || ctx.state !== 'running') return;
    this.played.push(`raid:${kind}`);
    if (this.played.length > 50) this.played.shift();
    const { volume, pan } = this.where(at), t0 = ctx.currentTime, out = ctx.createGain(), panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.sfx);
    const tone = (freq, from, to, peak, type = 'sine') => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + from);
      g.gain.linearRampToValueAtTime(peak, t0 + from + Math.min(0.25, (to - from) / 3));
      g.gain.setValueAtTime(peak, t0 + to - 0.3);
      g.gain.linearRampToValueAtTime(0, t0 + to);
      o.connect(g).connect(out);
      o.start(t0 + from);
      o.stop(t0 + to + 0.05);
      return o;
    };
    if (kind === 'whistle') {
      // a steam whistle: a chord of two pipes, a little out of tune, rising as the steam comes
      out.gain.value = 0.18 * volume;
      for (const [f, d] of [[392, 0], [466, 3], [587, -4]]) {
        const o = tone(f, 0, 1.9, 0.33, 'triangle');
        o.detune.setValueAtTime(-60 + d, t0);
        o.detune.linearRampToValueAtTime(d, t0 + 0.35);
      }
    } else if (kind === 'song') {
      // a soft chord, slow to swell and slow to fade
      out.gain.value = 0.1 * volume;
      for (const f of [220, 277.2, 329.6, 440]) tone(f, 0, 3.2, 0.25);
    } else if (kind === 'birds') {
      // wings: short bursts of noise, many and fast
      out.gain.value = 0.22 * volume;
      const len = Math.floor(ctx.sampleRate * 1.4), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const beat = Math.abs(Math.sin((i / ctx.sampleRate) * 2 * Math.PI * 11)) ** 6;
        d[i] = (Math.random() * 2 - 1) * beat * (1 - i / len);
      }
      const src = ctx.createBufferSource(), band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1800;
      src.buffer = buf;
      src.connect(band).connect(out);
      src.start(t0);
    }
  },

  /** A unit's own sound for what it does (sounds.json `units`), if it has one. */
  unit(type, what, at) {
    this.play(SOUNDS.units[type]?.[what], at);
  },

  /** The wind, with a far-off cry now and then; every sound loaded meanwhile. */
  ambience(on) {
    clearTimeout(this.farOff);
    this.wind?.();
    this.wind = null;
    if (!on) return;
    for (const name of Object.keys(SOUNDS.files)) this.load(name);
    this.wind = this.loop(WIND);
    const later = () => {
      this.farOff = setTimeout(() => { this.play(FAR_OFF[Math.floor(Math.random() * FAR_OFF.length)]); later(); }, 20000 + Math.random() * 40000);
    };
    later();
  },

  /** Play a music track (or none), calling `ended` when it runs out. */
  music(name, loop = false, ended) {
    this.track?.pause();
    this.track = null;
    const ctx = this.audio();
    if (!name || !ctx || !SOUNDS.music.includes(name)) return;
    const audio = new Audio();
    audio.loop = loop;
    this.track = audio;
    this.trackName = name;
    audio.addEventListener('ended', () => { if (this.track === audio) ended?.(); });
    // fetched whole, so that it plays from a same-origin blob wherever the page is served from
    this.trackUrl(name).then((url) => {
      if (this.track !== audio || !url) return;
      audio.src = url;
      ctx.createMediaElementSource(audio).connect(this.musicGain);
      const start = () => { if (this.track === audio && this.settings.music) audio.play().catch(() => {}); };
      audio.play().catch(() => window.addEventListener('pointerdown', start, { once: true, capture: true }));
      if (!this.settings.music) audio.pause();
    });
  },

  trackUrl(name) {
    let url = this.tracks.get(name);
    if (!url) {
      url = fetch(`${SOUNDS.base}music/${name}.mp3`).then((r) => r.blob())
        .then((b) => URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' }))).catch(() => null);
      this.tracks.set(name, url);
    }
    return url;
  },

  /** The Fury tracks in turn, from a random one; at a track's end during the player's sacrifice,
   * the sacrifice music first (match.ts playFury). */
  playFury(at) {
    this.trackUrl(FURY_TRACKS[(at + 1) % FURY_TRACKS.length]); // the next one, ready in time
    this.music(FURY_TRACKS[at], false, () => {
      if (G.ended) return;
      const next = () => this.playFury((at + 1) % FURY_TRACKS.length);
      if (this.sacrificing()) this.music('sacrifice', false, next);
      else next();
    });
  },

  sacrificing() {
    for (const e of G.view.entities.values()) {
      if (e.kind !== 'priest' || e.chainedAt === null || e.runes <= 0) continue;
      if (G.view.entities.get(e.chainedAt)?.owner === ME) return true;
    }
    return false;
  },

  /* ------------------------------------ the game's hooks --------------------------------- */
  newGame() {
    for (const stop of this.building.values()) stop();
    this.building.clear();
    this.shots.clear();
    this.strikes.clear();
    this.echoes = [];
    this.scanned = -1;
    this.alarm = NS.createAlarm(G.view);
    this.ambience(true);
    this.music('ser22', true); // the menu's music while the briefing is up
  },

  begin() {
    this.audio()?.resume().catch(() => {});
    this.playFury(Math.floor(Math.random() * FURY_TRACKS.length));
  },

  end(won) {
    this.music(won ? 'fanfare' : 'defeat');
  },

  /** A unit picked or ordered answers with its own sound; anything else clicks (controls.ts). */
  voice(entity, what) {
    if (!entity) return;
    const type = entity.kind === 'priest' ? 'priest' : entity.type;
    this.play((entity.owner === ME ? SOUNDS.units[type]?.[what] : undefined) ?? 'select');
  },

  /** The sound of an event of the battle (match.ts hear). */
  hear(ev, positionOf) {
    const mine = ev.who === ME, d = ev.data;
    const cell = (c) => new THREE.Vector3(wx(c.x + 0.5), 0, wz(c.y + 0.5));
    switch (ev.what) {
      case 'bridge': if (mine) this.play('droppiece'); break;
      case 'build': if (mine) this.play('somethingcreated'); break;
      case 'salvaged': if (mine) this.play('collapse'); break;
      case 'upgrade': this.play('upgradedone', positionOf(d.workshop)); if (mine) this.play('upgradecomplete'); break;
      case 'spell': this.unit(d.spell, 'active'); break;
      case 'cast': this.unit(d.spell, 'fire'); break;
      case 'captured': this.play(mine ? 'enemypriestcaptured' : 'ourpriestcaptured'); break;
      case 'priest down': if (mine) this.play('ourpriestimmobile'); break;
      case 'released': this.play('priestfree'); break;
      case 'chained': for (const name of [...SACRIFICE_SOUNDS, 'dissolve', 'shortzap']) this.load(name); break; // ready for the rite
      case 'rune': this.play('dissolve', positionOf(d.priest)); break; // a rune warded: it is gone
      case 'sacrifice': {
        const upgrade = d.gift === NS.GIFT_UPGRADE;
        this.later(upgrade ? 'priestsacrifice4' : 'priestsacrifice2', upgrade ? SACRIFICE.upgradeCry : SACRIFICE.cry);
        this.later('thundercrack', SACRIFICE.thunder);
        this.play('itisdone2');
        break;
      }
      case 'bridge cracked': this.play('bridgecrack', cell(d)); break;
      case 'bridge fell': this.play('bridgefall', cell(d)); break;
      case 'islet fell': this.play('islandfall', cell(d)); break;
      case 'destroyed':
        this.play('explosion', positionOf(d.id));
        if (d.type === 'altar') this.play('altarburncollapse');
        break;
      default: break;
    }
  },

  /** A sound due `seconds` of game time from now; it still comes if the battle has just ended. */
  /**
   * Seconds from the last rune until the Sacrifice has been heard out: the Priest's cry as he falls
   * through the Altar and the thunder, after their delays at the battle's speed. The end of the
   * battle waits for it. Nothing to wait for with the sound off.
   */
  async sacrificeLength(upgrade) {
    if (!this.settings.sound || !this.audio()) return 0;
    const cry = upgrade ? 'priestsacrifice4' : 'priestsacrifice2';
    const [done, scream, thunder] = await Promise.all(['itisdone2', cry, 'thundercrack'].map((n) => this.load(n)));
    return Math.max(done?.duration ?? 0, (upgrade ? SACRIFICE.upgradeCry : SACRIFICE.cry) / G.speed + (scream?.duration ?? 2),
      SACRIFICE.thunder / G.speed + (thunder?.duration ?? 1));
  },

  later(name, seconds) {
    this.echoes.push({ at: performance.now() + (seconds * 1000) / G.speed, name });
  },

  tick() {
    if (!G.view || !G.started) return;
    const v = G.view, now = performance.now();
    // sounds due a while after what made them
    this.echoes = this.echoes.filter((e) => {
      if (e.at > now) return true;
      this.play(e.name);
      return false;
    });
    // the rest follows the battle, which changes only when the world steps (ten times a second):
    // looked at once a step, not every frame
    if (G.world.tick === this.scanned) return;
    this.scanned = G.world.tick;
    // a building going up loops jimbuild; when it is up, its own sound or buildDone (renderer.ts)
    for (const e of v.entities.values()) {
      if (e.kind !== 'building') continue;
      const at = () => new THREE.Vector3(wx(e.x + e.fx / 2), 0, wz(e.y + e.fy / 2));
      if (e.rising > 0 && !this.building.has(e.id)) this.building.set(e.id, this.loop('jimbuild', at()));
      else if (e.rising <= 0 && this.building.has(e.id)) {
        this.building.get(e.id)();
        this.building.delete(e.id);
        this.play(SOUNDS.units[e.type]?.built ?? 'builddone', at());
      }
    }
    for (const [id, stop] of this.building) if (!v.entities.has(id)) { stop(); this.building.delete(id); }
    // guns: the shooter's (and its missile's) sound as a shot leaves; where it lands, the impact
    const live = new Set();
    for (const shot of v.shots) {
      const key = `${shot.gun.id}:${shot.leave}:${shot.target}`;
      live.add(key);
      if (this.shots.has(key) || G.world.tick < shot.leave) continue;
      const gun = shot.gun, missile = NS.MISSILES[gun.type];
      const from = new THREE.Vector3(wx(gun.x + gun.fx / 2), 0, wz(gun.y + gun.fy / 2));
      this.shots.set(key, { to: new THREE.Vector3(wx(shot.x + 0.5), 0, wz(shot.y + 0.5)), missile, blocked: shot.blocked, shooter: gun.type });
      this.unit(gun.type, 'fire', from);
      if (missile) this.unit(missile.type, 'fire', from);
    }
    for (const [key, s] of this.shots) {
      if (live.has(key)) continue;
      this.shots.delete(key);
      if (s.blocked) this.play('sunfenceimpact', s.to);
      else if (s.missile) {
        this.unit(s.missile.type, 'impact', s.to);
        if (s.shooter === 'raincannon') this.play(`icecannonimpact${1 + (G.world.tick % 4)}`, s.to);
      } else this.play('impact', s.to);
    }
    // flyers: a Man o'War's sting, a Whirligig's shot, heard as the strike cooldown starts over
    // (rules/flyers.ts strikes without a shot or an event)
    for (const e of v.entities.values()) {
      if (e.kind !== 'flyer') continue;
      const was = this.strikes.get(e.id);
      this.strikes.set(e.id, e.cooldown);
      if (was !== undefined && e.cooldown > was && e.target !== null) {
        this.unit(e.type, 'fire', new THREE.Vector3(wx(e.px / NS.FLYER_SCALE), 0, wz(e.py / NS.FLYER_SCALE)));
      }
    }
    for (const id of this.strikes.keys()) if (!v.entities.has(id)) this.strikes.delete(id);
    // "Your island is under attack", at most once in 30 s
    if (!G.paused && !G.ended && this.alarm(ME)) {
      this.play('islandunderattack');
      this.el.systems['ns-game'].hud?.toast(NS.m.event_island_attacked(), 'bad');
    }
  },
});
