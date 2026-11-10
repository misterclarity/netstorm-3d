/**
 * The HUD, in plain DOM over the scene: the top bar, the bottom bar of bridge pieces and buildings,
 * the card of the selected thing, the next-step card, toasts and the dialogs.
 */
import { NS, G, MISSION, TPS, ME, defs, BUILDABLE, PRIEST_BUILT, HARDEN, SPEEDS, facingText, OWNER_COLOR, FURY_COLOR, playerTheme, errorText, escapeHtml, PLAY, setPlay } from './state.js';
import { needOf, needText, iconsHtml, iconName, sourceOf } from './energy.js';
import { submit, SKIRMISH_DEFAULTS } from './game.js';
import { modelKind } from './models.js';
import { describeBuild, loadNewer } from './version.js';
import { toScene } from './space.js';
import { SPELL_MODES, SPELL_IDS, spellText, spellName } from './spells.js';
import { HEIGHTS, LEVEL_NAMES } from './heights.js';
import { loadSettings, saveSettings, NIGHT_REACH } from './settings.js';
import { MOON_ICON, moonName, reachText, furyText, hitText, classText, cutFor } from './moon.js';

const $ = (id) => document.getElementById(id);

/** The computer's levels as the menu describes them (scripts/house-rules.mjs and netstorm-web's
 * ai/params.ts set what each does). */
const LEVELS = {
  easy: 'Moves slowly and does little at a time. Defends only once you shoot at it, and casts no Spells. A good start.',
  normal: 'Answers your bridges and guns, keeps its Priest near home, has a carrier ready when yours falls, and casts Spells when you come near.',
  hard: 'Fast and aggressive: guns at your Priest and Temple first, two carriers ready, a fallen Priest fetched even by air, and Spells carried to where they hurt most.',
};

export class Hud {
  constructor(game) {
    this.game = game;
    this.scene = game.el;
    this.art = game.el.systems['ns-art'];
    this.dirty = true;
    this.sig = '';
    this.acc = 0;
    $('pause').onclick = () => this.togglePause();
    $('speed').onclick = () => this.setSpeed(G.speed === SPEEDS[SPEEDS.length - 1] ? -9 : 1);
    $('artSprites').onclick = () => this.art.setMode('sprites');
    $('artModels').onclick = () => this.art.setMode('models');
    $('help').onclick = () => this.help();
    $('howto').onclick = () => this.howToPlay();
    const sound = this.sound = game.el.systems['ns-sound'];
    for (const key of ['sound', 'music']) {
      const b = $(key === 'sound' ? 'sfxToggle' : 'musicToggle');
      b.classList.toggle('on', sound.settings[key]);
      b.onclick = () => { sound.set(key, !sound.settings[key]); b.classList.toggle('on', sound.settings[key]); };
    }
    $('autoCollect').classList.toggle('on', PLAY.autoCollect);
    $('autoCollect').onclick = () => { setPlay('autoCollect', !PLAY.autoCollect); $('autoCollect').classList.toggle('on', PLAY.autoCollect); };
    $('restart').onclick = () => this.confirmRestart();
    // a phone's ⋯ menu: open and shut, shut by a choice in it or a tap elsewhere
    const menu = (open) => { $('top').classList.toggle('open', open); $('moreBtn').setAttribute('aria-expanded', String(open)); };
    $('moreBtn').onclick = () => menu(!$('top').classList.contains('open'));
    $('more').addEventListener('click', (e) => { if (e.target.closest('button')) menu(false); });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('#top')) menu(false); });
    $('mapToggle').onclick = () => $('mapToggle').classList.toggle('on', document.body.classList.toggle('show-map'));
    $('bar').addEventListener('click', (e) => this.barClick(e));
    $('logToggle').onclick = () => this.toggleLog();
    $('rangesToggle').onclick = () => game.placement().toggleEnemyReach();
    $('sel').addEventListener('click', (e) => this.selClick(e));
    // the Spell chosen to pray for is kept while the card is drawn anew
    $('sel').addEventListener('change', (e) => { if (e.target.matches('[data-prayer]')) this.prayerChoice = e.target.value; });
    this.scene.addEventListener('ns-art-mode', ({ detail }) => {
      $('artSprites').classList.toggle('on', detail.mode === 'sprites');
      $('artModels').classList.toggle('on', detail.mode !== 'sprites');
      this.sig = '';
      this.dirty = true;
    });
    const available = (ok) => {
      const b = $('artSprites');
      b.disabled = !ok;
      b.title = ok ? 'The original pixel-art sprites'
        : 'The original sprites load from netstorm-web’s GitHub, which this page can’t reach.';
    };
    this.scene.addEventListener('ns-art-available', ({ detail }) => available(detail.ok));
    if (this.art.available !== null) available(this.art.available);
  }

  reset() {
    this.dirty = true;
    this.sig = '';
    this.entries = [];
    if ($('logList')) $('logList').innerHTML = '';
    this.closeModal();
    this.updateTop();
    this.showLevel(true);
  }

  /** Tiered islands: the level bridges are laid on, by the bridge pieces (Q and E change it). */
  showLevel(quiet = false) {
    const badge = $('levelBadge');
    if (!badge) return;
    badge.hidden = !HEIGHTS.on;
    if (!HEIGHTS.on) return;
    const name = LEVEL_NAMES[HEIGHTS.active];
    badge.textContent = `· ${name} level · Q ▼ E ▲`;
    badge.className = `level-${HEIGHTS.active < 0 ? 'low' : HEIGHTS.active > 0 ? 'high' : 'mid'}`;
    if (!quiet) this.toast(`${name} level: bridges are laid here`);
  }

  modalOpen() {
    return $('modal').style.display === 'grid';
  }

  togglePause() {
    if (G.ended || !G.started) return;
    G.paused = !G.paused;
    G.clock.reset();
    this.updateTop();
  }

  setSpeed(d) {
    const i = Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(G.speed) + d));
    G.speed = SPEEDS[i];
    this.updateTop();
  }

  updateTop() {
    const me = G.world?.players.get(ME);
    $('storm').innerHTML = `⚡ <b>${me ? Math.floor(me.storm) : 0}</b>`;
    const secs = Math.floor((G.world?.tick ?? 0) / TPS);
    $('clock').innerHTML = `⏱ <b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>`;
    // day and night (a setting): which it is, and how long until it turns
    const day = $('daytime'), w = G.world;
    if (day) {
      day.hidden = !w?.nights;
      if (w?.nights) {
        const cycle = NS.DAY_SECONDS + NS.NIGHT_SECONDS, into = (w.tick / TPS) % cycle, night = into >= NS.DAY_SECONDS;
        const left = Math.ceil((night ? cycle : NS.DAY_SECONDS) - into), clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        const fury = furyText(w);
        day.innerHTML = `${night ? MOON_ICON[w.moonPhase()] : '☀'} <b>${clock}</b>`;
        day.classList.toggle('night', night);
        day.title = night
          ? `Night under ${moonName(w)}, ${clock} to dawn: ${reachText(w)}${fury ? `; ${fury}` : ''}. Whirligigs stay home, Sun Generators are dark, a Sacrifice waits for the sun, and a crystal brought home is worth a quarter more.`
          : `Day, ${clock} to nightfall${fury ? `: ${fury}` : ''}. Tonight: ${moonName(w)} ${MOON_ICON[w.moonPhase()]}.`;
      }
    }
    $('pause').textContent = G.paused ? '▶ Resume' : 'Pause';
    $('pause').classList.toggle('on', G.paused && G.started);
    $('speed').textContent = `${G.speed}×`;
  }

  /** A line in the event log, with the battle's time. */
  log(text, tone = '') {
    const secs = Math.floor((G.world?.tick ?? 0) / TPS);
    this.entries = [{ time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, text, tone }, ...(this.entries ?? [])].slice(0, 120);
    const list = $('logList');
    if (!list) return;
    const li = document.createElement('li');
    li.className = tone;
    li.innerHTML = `<time>${this.entries[0].time}</time> ${escapeHtml(text)}`;
    list.prepend(li);
    while (list.children.length > 120) list.lastChild.remove();
  }

  toggleLog(show = $('log').hidden) {
    $('log').hidden = !show;
    $('logToggle').classList.toggle('on', show);
  }

  toast(text, kind = '') {
    if (G.started) this.log(text, kind);
    const box = $('toasts');
    if ([...box.children].some((c) => c.textContent === text)) return;
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-6px)'; }, 3200);
    setTimeout(() => el.remove(), 3800);
  }

  /** "+120" rising from a point in the scene. */
  floater(text, at) {
    const cam = this.scene.camera;
    if (!cam || this.scene.xrSession) return;
    const p = toScene(at).project(cam);
    if (p.z > 1) return;
    const r = this.scene.canvas.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = `${r.left + (p.x + 1) / 2 * r.width}px`;
    el.style.top = `${r.top + (1 - p.y) / 2 * r.height}px`;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = 'translateY(-40px)'; el.style.opacity = '0'; });
    setTimeout(() => el.remove(), 1700);
  }

  frame(dt) {
    this.acc += dt;
    const me = G.world.players.get(ME);
    if (me.storm > G.lastStorm + 1) {
      const temple = G.world.templeOf(ME), el = temple && this.game.units()?.byId.get(temple.id);
      if (el) this.floater(`+${Math.round(me.storm - G.lastStorm)}`, el.object3D.position.clone().setY(5));
    }
    G.lastStorm = me.storm;
    if (this.acc < 150 && !this.dirty) return;
    this.acc = 0;
    this.updateTop();
    this.renderBar();
    this.renderSelection();
    this.renderGoal();
    this.dirty = false;
  }

  /* ------------------------------------- bottom bar -------------------------------------- */
  /** As netstorm-web's Production Window: the Golem of the Temple, and what a Workshop makes. */
  unitCards() {
    return this.known().filter((d) => NS.makerError(G.view, ME, d) === null).sort((a, b) => a.level - b.level || a.cost - b.cost);
  }
  lockedUnits() {
    return this.known().filter((d) => NS.makerError(G.view, ME, d) !== null);
  }
  known() {
    return [...G.world.players.get(ME).tech].map((id) => defs.get(id)).filter((d) => d && BUILDABLE.has(d.cls) && !PRIEST_BUILT.has(d.cls));
  }
  /** "Use your High Priest to build Temples, Workshops, and Altars"; the Outpost where a side has it. */
  priestCards() {
    const ids = [`${playerTheme(ME)}factory`, 'sunfactory', 'altar'];
    if (G.world.players.get(ME).tech.has('outpost')) ids.push('outpost');
    return [...new Set(ids)].map((id) => defs.get(id)).filter(Boolean);
  }

  renderBar() {
    const me = G.world.players.get(ME), tool = G.tool;
    const units = this.unitCards(), priest = this.priestCards(), locked = this.lockedUnits();
    const cool = (id) => me.refresh.find((r) => r.type === id);
    const sig = JSON.stringify([me.hand.map((h) => [h.piece, h.age >= HARDEN]), tool, G.rot, this.art.mode, locked.map((d) => d.id),
      [...units, ...priest].map((d) => [d.id, me.storm >= d.cost, !!cool(d.id)])]);
    if (sig !== this.sig) {
      this.sig = sig;
      let h = '';
      for (let i = 0; i < (G.view.bridgeSlots ?? 6); i++) {
        const p = me.hand[i];
        h += p
          ? `<button class="card piece ${tool.kind === 'piece' && tool.hand === i ? 'on' : ''}" data-act="piece" data-i="${i}" title="Bridge piece: click it, then the map. R rotates."><span class="key">${i + 1}</span><canvas width="46" height="40" data-piece="${p.piece}" data-hard="${p.age >= HARDEN ? 1 : 0}"></canvas><span>${p.age >= HARDEN ? 'solid' : 'hardening'}</span></button>`
          : `<div class="card piece empty"><span class="key">${i + 1}</span><span style="margin:auto">…</span></div>`;
      }
      $('hand').innerHTML = h;
      const card = (d) => {
        const c = cool(d.id), poor = me.storm < d.cost;
        const need = needOf(d);
        return `<button class="card ${tool.kind === 'build' && tool.type === d.id ? 'on' : ''} ${poor || c ? 'poor' : ''}" data-act="build" data-type="${d.id}" title="${d.name}: ${d.cls}, ${d.footX}×${d.footY}${d.range ? `, range ${d.range}` : ''}${need.length ? `\nNeeds ${needText(need)} Energy where it is built (from your Temple or Generators)` : ''}"><canvas width="46" height="40" data-icon="${d.id}"></canvas><span>${d.name}</span><span class="cost">⚡${d.cost}</span>${need.length ? `<em class="needs">${iconsHtml(need)}</em>` : ''}${c ? `<i class="fill" data-cool="${d.id}"></i>` : ''}</button>`;
      };
      const why = (d) => {
        const err = NS.makerError(G.view, ME, d), fury = (d.theme ?? 'sun').replace(/^./, (c) => c.toUpperCase());
        if (err === 'no workshop') return `${d.name}: needs a ${fury} Workshop`;
        if (err === 'not in production') return `${d.name}: select your ${fury} Workshop and add it to a slot${d.level > 1 ? ' (upgrade the Workshop for more slots)' : ''}`;
        return `${d.name}: ${errorText(err)}`;
      };
      $('unitCards').innerHTML = units.map(card).join('')
        + (locked.length ? `<div class="card off" title="${escapeHtml(locked.map(why).join('\n'))}"><span style="margin:auto;color:var(--muted)">${locked.length} locked<br><small>hover for why</small></span></div>` : '');
      $('priestBuilds').innerHTML = priest.map(card).join('');
      for (const cv of document.querySelectorAll('#bar canvas[data-piece]')) this.drawPiece(cv, Number(cv.dataset.piece), cv.dataset.hard === '1');
      for (const cv of document.querySelectorAll('#bar canvas[data-icon]')) this.drawIcon(cv, cv.dataset.icon);
    }
    for (const el of document.querySelectorAll('#bar [data-cool]')) {
      const c = cool(el.dataset.cool);
      el.style.width = c ? `${100 * (1 - c.ticks / (G.view.unitRate * TPS))}%` : '100%';
    }
  }

  drawPiece(cv, piece, hard) {
    const g = cv.getContext('2d'), cells = NS.rotatePiece(NS.PIECES[piece], G.rot);
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX + 1, h = Math.max(...ys) - minY + 1;
    const s = Math.min(Math.floor(40 / w), Math.floor(36 / h), 12), ox = (46 - w * s) / 2, oy = (40 - h * s) / 2;
    g.clearRect(0, 0, 46, 40);
    for (const [x, y] of cells) {
      g.fillStyle = hard ? '#b07a48' : '#d7b38a';
      g.fillRect(ox + (x - minX) * s + 0.5, oy + (y - minY) * s + 0.5, s - 1, s - 1);
      if (!hard) {
        g.strokeStyle = '#8a5a34';
        g.setLineDash([2, 2]);
        g.strokeRect(ox + (x - minX) * s + 1, oy + (y - minY) * s + 1, s - 2, s - 2);
        g.setLineDash([]);
      }
    }
    // the cell under the cursor
    g.fillStyle = '#f2c14e';
    g.beginPath();
    g.arc(ox - minX * s + s / 2, oy - minY * s + s / 2, Math.max(2, s / 5), 0, Math.PI * 2);
    g.fill();
  }

  drawIcon(cv, id) {
    const g = cv.getContext('2d'), d = defs.get(id);
    g.clearRect(0, 0, 46, 40);
    const img = (d.group === 'cannon' && this.art.sprite(`${id}:2`)) || this.art.sprite(id);
    if (img) {
      const s = Math.min(46 / img.width, 40 / img.height, 2);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, (46 - img.width * s) / 2, (40 - img.height * s) / 2, img.width * s, img.height * s);
      return;
    }
    const c = FURY_COLOR[d.theme] ?? '#d9c9a8';
    g.fillStyle = c;
    const kind = modelKind({ kind: d.cls === 'Ground Transport' ? 'transport' : 'building', type: id });
    g.beginPath();
    if (kind === 'cannon') { g.arc(23, 26, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#333'; g.fillRect(23, 21, 17, 6); }
    else if (kind === 'walker') { g.fillRect(17, 12, 12, 16); g.fillRect(19, 5, 8, 7); g.fillRect(17, 28, 4, 8); g.fillRect(25, 28, 4, 8); }
    else if (kind === 'generator') { g.moveTo(23, 4); g.lineTo(31, 18); g.lineTo(23, 32); g.lineTo(15, 18); g.closePath(); g.fill(); g.fillStyle = '#8c8f97'; g.fillRect(14, 32, 18, 5); }
    else if (kind === 'aviary') { g.arc(23, 28, 12, Math.PI, 0); g.fill(); g.fillStyle = '#6b4a2c'; g.fillRect(10, 12, 26, 3); }
    else if (kind === 'workshop') {
      g.fillStyle = '#e6dccb'; g.fillRect(9, 18, 24, 16);
      g.fillStyle = c; g.moveTo(7, 19); g.lineTo(21, 7); g.lineTo(35, 19); g.closePath(); g.fill();
      g.fillStyle = '#5fb7ad'; g.beginPath(); g.arc(36, 20, 5, Math.PI, 0); g.fill();
    } else if (kind === 'altar') {
      g.strokeStyle = '#c99a6a'; g.lineWidth = 4; g.arc(23, 22, 12, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ff9a3a'; g.beginPath(); g.arc(23, 22, 4, 0, Math.PI * 2); g.fill();
    } else g.fillRect(12, 12, 22, 22);
  }

  barClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'piece') {
      const i = Number(b.dataset.i);
      this.game.setTool(G.tool.kind === 'piece' && G.tool.hand === i ? { kind: 'select' } : { kind: 'piece', hand: i });
    } else if (b.dataset.act === 'build') {
      const t = b.dataset.type;
      this.game.setTool(G.tool.kind === 'build' && G.tool.type === t ? { kind: 'select' } : { kind: 'build', type: t });
      if (PRIEST_BUILT.has(defs.get(t).cls)) this.toast('Your Priest walks over and builds it');
    }
  }

  /* ----------------------------------- selection card ------------------------------------ */
  /** A line for the tooltip of the thing under the cursor. */
  describe(e) {
    const owner = e.owner ? G.world.players.get(e.owner)?.name : '';
    const name = e.kind === 'priest' ? 'Priest' : e.kind === 'geyser' ? 'Geyser' : e.kind === 'crystal' ? 'Storm crystal' : defs.get(e.type)?.name ?? e.kind;
    const sel = G.selected === null ? null : G.view.entities.get(G.selected);
    let hint = '';
    if (sel?.owner === ME && (sel.kind === 'transport' || sel.kind === 'priest')) {
      if (e.kind === 'geyser') hint = ' · click: collect';
      else if (e.kind === 'priest' && e.owner !== ME && sel.kind === 'transport') hint = e.state === 'down' ? ' · click: capture' : ' · not down yet';
    }
    // a gun of yours selected: what its hits on this enemy are multiplied by (the house rules)
    if (sel?.owner === ME && sel.kind === 'building' && defs.get(sel.type)?.dps && e.owner && e.owner !== ME && e.hp !== undefined) {
      const k = hitText(G.world, sel, e);
      if (k) hint += ` · your ${defs.get(sel.type).name}: ${k}`;
    }
    return `${name}${owner ? ` (${owner})` : ''}${hint}`;
  }

  renderSelection() {
    const box = $('sel');
    if (this.game.selectedIds().length > 1) { this.renderGroup(box); return; }
    const e = G.selected === null ? null : G.view.entities.get(G.selected);
    if (!e) {
      box.style.display = 'none';
      G.selected = null;
      return;
    }
    const d = e.type ? defs.get(e.type) : null, owner = e.owner ? G.world.players.get(e.owner) : null;
    const name = e.kind === 'priest' ? 'High Priest' : e.kind === 'geyser' ? 'Geyser' : e.kind === 'crystal' ? 'Storm crystal' : e.kind === 'obelisk' ? 'Obelisk' : d?.name ?? e.kind;
    const lines = [], acts = [];
    if (e.kind === 'obelisk') {
      lines.push(`Holds the ${spellName(e.spell)}: it ${spellText(e.spell)}.`);
      lines.push('Select one of your carriers, then click the Obelisk: it walks there and takes the Spell.');
    }
    if (e.kind === 'geyser') lines.push(e.stock > 0 ? `${e.stock} Storm Power left` : 'Spent');
    if (e.kind === 'building') {
      if (e.rising > 0) lines.push(`Under construction: ${Math.ceil(e.rising / TPS)} s`);
      const source = sourceOf(e), need = needOf(d);
      if (source) {
        lines.push(`Gives ${iconsHtml(Array(source.count).fill(source.letter))} ${source.count > 1 ? `${source.count} ` : ''}${iconName(source.letter)} Energy within ${G.view.energyRange} cells${e.rising > 0 ? ' once it stands' : ''}. One source serves everything built in its ring; nothing is used up.`);
      } else if (need.length) lines.push(`Energy to build it: ${iconsHtml(need)} ${needText(need)}`);
      if (d.cls === 'Production') {
        lines.push(`Level ${e.upgrades + 1} · production slots ${e.slots.length}/${e.upgrades + 1}`);
        lines.push(e.slots.length ? `Makes: ${e.slots.map((t) => defs.get(t)?.name).join(', ')}` : 'No unit in production yet');
        if (e.owner === ME && !e.rising) {
          for (const u of [...G.world.players.get(ME).tech].map((t) => defs.get(t))) {
            if (!u || !NS.takesSlot(u) || e.slots.includes(u.id)) continue;
            const err = NS.canProduce(G.view, { player: ME, workshop: e.id, type: u.id });
            if (err === 'cannot build') continue;
            acts.push(`<button data-sel="produce" data-type="${u.id}" ${err ? `disabled title="${errorText(err)}"` : `title="Needs ${needText(needOf(u))} Energy where it is built"`}>+ ${u.name} ${iconsHtml(needOf(u))}</button>`);
          }
          const up = NS.canUpgrade(G.view, { player: ME, workshop: e.id });
          if (up !== 'bad target' && up !== 'fully upgraded') acts.push(`<button data-sel="upgrade" ${up ? `disabled title="${errorText(up)}"` : ''}>Upgrade (⚡${d.cost})</button>`);
        }
      }
      // reach now (less at night, by the moon and the light) and the weight of its hits (the house rules)
      const reach = d.dps && d.range ? NS.gunReach(G.world, e, d.range) : d.range;
      if (d.range) lines.push(`Range ${d.range}${reach !== d.range ? ` (${reach} tonight)` : ''}${d.dps ? ` · damage ${d.dps}/s` : ''}${NS.hasFacing(d) ? ` · ${facingText(d, e.facing)}` : ''}`);
      else if (NS.hasFacing(d)) lines.push(`${facingText(d, e.facing)[0].toUpperCase()}${facingText(d, e.facing).slice(1)}: guns on that side, but the Arc Spire, do it no harm`);
      if (d.dps && d.range) {
        const kind = classText(d.id), fury = G.world.furyStrength(d.theme);
        const now = fury !== 1 ? `hits ×${fury} ${d.theme === 'rain' ? `under ${moonName(G.world)}` : 'by day'}` : '';
        const dark = G.world.isNight() && cutFor(G.world, d.theme) && !NS.nightCut(G.world, e) ? 'lit by an Energy ring: full reach tonight' : '';
        const words = [kind, now, dark].filter(Boolean).join(' · ');
        if (words) lines.push(words[0].toUpperCase() + words.slice(1));
      }
      if (d.cls === 'Altar') {
        const captive = [...G.view.entities.values()].find((c) => c.kind === 'priest' && c.chainedAt === e.id);
        lines.push(captive ? `A captive is chained here: ${captive.runes}/5 runes. Your Priest must stand beside the Altar.` : 'Captured Priests are sacrificed here');
        if (e.owner === ME && captive) acts.push('<button data-sel="ritual">Send Priest: begin the sacrifice</button>');
      }
      if (e.owner === ME && d.cls !== 'Energy') acts.push('<button data-sel="salvage" title="Delete">Salvage</button>');
    }
    if (e.kind === 'transport') {
      const captive = G.view.entities.get(e.carrying)?.kind === 'priest' ? G.view.entities.get(e.carrying) : null;
      lines.push(captive && e.goal === 'idle' ? 'Holding the enemy Priest'
        : { idle: 'Waiting for orders', collect: 'Collecting Storm Power', pickup: 'Fetching a crystal', home: 'Carrying Storm Power home', capture: 'Going for the enemy Priest', altar: 'Carrying the captive to the Altar', obelisk: 'Fetching a spell' }[e.goal] ?? e.goal);
      if (e.owner === ME) {
        lines.push('Click a geyser to collect from it, a downed enemy Priest to capture him, or ground to send it there.');
        if (captive && e.goal !== 'altar') {
          const altar = [...G.view.entities.values()].some((b) => b.kind === 'building' && b.owner === ME && defs.get(b.type)?.cls === 'Altar' && !b.rising);
          acts.push(`<button data-sel="toAltar" ${altar ? '' : 'disabled title="Build an Altar first: your Priest builds it"'}>Carry to the Altar</button>`);
        }
        if (e.carrying !== null) acts.push(`<button data-sel="drop">${captive ? 'Let the captive go' : 'Drop cargo'}</button>`);
      }
      this.spellCard(e, lines, acts);
      if (e.owner === ME) acts.push('<button data-sel="salvage">Salvage</button>');
    }
    if (e.kind === 'priest') {
      const doing = { build: 'Building', collect: 'Collecting Storm Power', home: 'Carrying Storm Power home', pickup: 'Fetching a crystal' }[e.goal] ?? 'Standing';
      lines.push({ normal: doing, down: 'Knocked out', carried: 'Being carried off', chained: `Chained to an Altar: ${e.runes}/5 runes` }[e.state] ?? e.state);
      const held = e.carrying === null || e.carrying === undefined ? null : G.view.entities.get(e.carrying);
      if (e.owner === ME && e.state === 'normal' && held?.kind === 'crystal' && e.goal !== 'home') {
        lines.push(`He holds a storm crystal (⚡${held.value}): it is banked when he reaches your Temple.`);
        acts.push('<button data-sel="bank">Bank it at the Temple</button>', '<button data-sel="drop">Drop it</button>');
      }
      if (e.owner === ME && e.state === 'normal') lines.push('Click ground to walk, a geyser to collect, or your Altar to perform a sacrifice. “Priest builds” below has Workshops and the Altar.');
      if (e.owner !== ME && e.state !== 'down') lines.push('Knock him out (below half health) with cannons, then send a Golem.');
      lines.push(`His ward: no single hit of a gun or flyer takes more than ${NS.PRIEST_WARD} off him${G.world.nights ? '; he heals half as fast again by day, and prays slower at night' : ''}.`);
      if (e.state === 'normal') this.spellCard(e, lines, acts);
    }
    const hp = e.hp !== undefined && e.hpMax ? `<div class="hp"><i style="width:${Math.max(0, 100 * e.hp / e.hpMax)}%"></i></div>` : '';
    const html = `<h4>${name}</h4><div class="who" style="color:${owner ? OWNER_COLOR[e.owner] : 'var(--muted)'}">${owner ? owner.name : 'Neutral'}${e.hp !== undefined ? ` · ${Math.ceil(e.hp)}/${e.hpMax}` : ''}</div>${hp}${lines.map((l) => `<div class="line">${l}</div>`).join('')}${acts.length ? `<div class="acts">${acts.join('')}</div>` : ''}`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    box.style.display = 'block';
  }

  selClick(ev) {
    const b = ev.target.closest('[data-sel]');
    if (!b || b.disabled || G.selected === null) return;
    const id = G.selected;
    if (b.dataset.sel === 'produce') submit({ t: 'produce', workshop: id, type: b.dataset.type });
    if (b.dataset.sel === 'upgrade') submit({ t: 'upgradeWorkshop', workshop: id });
    if (b.dataset.sel === 'drop') submit({ t: 'dropCargo', transport: id });
    if (b.dataset.sel === 'cast') submit({ t: 'castSpell', transport: id });
    if (b.dataset.sel === 'pray') {
      const spell = b.dataset.spell ?? b.closest('.acts')?.querySelector('[data-prayer]')?.value;
      if (spell) submit({ t: 'pray', spell });
    }
    if (b.dataset.sel === 'toAltar') {
      const t = G.view.entities.get(id);
      if (t?.carrying !== null && t?.carrying !== undefined) submit({ t: 'capturePriest', transport: id, target: t.carrying });
    }
    if (b.dataset.sel === 'bank') {
      const p = G.view.entities.get(id);
      if (p?.kind === 'priest') this.game.bankCargo(p);
    }
    if (b.dataset.sel === 'salvage') this.salvage();
    if (b.dataset.sel === 'ritual') {
      const altar = G.view.entities.get(id);
      if (altar) this.game.priestToAltar(altar);
    }
    this.dirty = true;
  }

  /**
   * A caster's Spell on its card: a Priest's prayer and the Spells he may pray for (in a skirmish),
   * the Spell a Priest or a carrier holds and the button that casts it, and the cast under way. Of
   * an enemy's, what he holds, as a warning.
   */
  spellCard(e, lines, acts) {
    const secs = (ticks) => Math.ceil(ticks / TPS);
    const mine = e.owner === ME, who = e.kind === 'priest' ? 'He' : 'It';
    if (e.casting > 0) {
      lines.push(`${mine ? '' : '⚠ '}Casting the ${spellName(e.spell)}: it goes off in ${secs(e.casting)} s${mine ? '' : `. Get your units out of ${defs.get(e.spell)?.range} cells of ${who.toLowerCase() === 'he' ? 'him' : 'it'}!`}`);
      return;
    }
    if (e.praying > 0) lines.push(`Praying for the ${spellName(e.prayer)}: ${secs(e.praying)} s left${mine ? ' (walking or a hit breaks the prayer off)' : ''}`);
    if (e.spell) {
      const def = defs.get(e.spell);
      if (mine) {
        lines.push(`${who} holds the ${def.name}: it ${spellText(e.spell)}. Casting takes ${def.castTime} s, standing still.`);
        const storm = G.world.players.get(ME)?.storm ?? 0;
        const err = storm < def.cost ? 'no storm power' : e.aloft ? 'not ready' : null;
        acts.push(`<button data-sel="cast" ${err ? `disabled title="${errorText(err)}"` : `title="Cast it round ${who === 'He' ? 'him' : 'it'}: everything within ${def.range} cells"`}>Cast the ${def.name} (⚡${def.cost})</button>`);
      } else lines.push(`⚠ ${who} holds the ${def.name}, which ${spellText(e.spell)}: keep your units more than ${def.range} cells away.`);
    }
    if (!mine || e.kind !== 'priest' || e.praying > 0 || e.spell === 'bombspecialone') return;
    const prayers = NS.prayable(G.view);
    if (prayers.length <= 3) {
      for (const id of prayers) {
        if (id === e.spell) continue;
        acts.push(`<button data-sel="pray" data-spell="${id}" title="${escapeHtml(`The ${spellName(id)} ${spellText(id)}.`)}">Pray for the ${spellName(id)} (${defs.get(id).prayTime} s)</button>`);
      }
    } else if (prayers.length) {
      acts.push(`<select data-prayer>${prayers.map((id) => `<option value="${id}" ${id === this.prayerChoice ? 'selected' : ''}>${spellName(id)} (${defs.get(id).prayTime} s, ⚡${defs.get(id).cost} to cast)</option>`).join('')}</select>`, '<button data-sel="pray">Pray</button>');
    }
  }

  salvage() {
    const e = G.view.entities.get(G.selected);
    if (e && e.owner === ME && (e.kind === 'building' || e.kind === 'transport')) {
      submit({ t: 'salvage', target: e.id });
      G.selected = null;
    }
  }

  /* ------------------------ the next step, read off the battle --------------------------- */
  renderGoal() {
    const v = G.view, w = G.world, me = w.players.get(ME);
    const all = [...v.entities.values()], mine = all.filter((e) => e.owner === ME);
    const has = (f) => mine.some(f);
    const def = (e) => (e.kind === 'building' || e.kind === 'transport') ? defs.get(e.type) : null;
    const foes = [...w.players.values()].filter((p) => p.alive && w.hostile(ME, p.id));
    const foe = foes.map((p) => v.priestOf(p.id)).find(Boolean);
    const known = [...me.tech].map((id) => defs.get(id)).filter(Boolean);
    const gunTypes = known.filter((d) => d.cls === 'Shooter');
    // the Workshop to build: the Sun's in the mission (it makes the Sun Cannon), else your Fury's;
    // one you have counts if it can make something you know
    const furyOf = (d) => d?.theme ?? 'sun';
    const shopType = G.mission ? 'sunfactory' : `${playerTheme(ME)}factory`, shopName = defs.get(shopType)?.name ?? 'Workshop';
    const useful = mine.filter((e) => def(e)?.cls === 'Production' && known.some((d) => NS.takesSlot(d) && furyOf(d) === furyOf(def(e))));
    const sunShop = useful.find((e) => !e.rising) ?? useful[0];
    const shopGuns = gunTypes.filter((d) => furyOf(d) === furyOf(sunShop ? def(sunShop) : defs.get(shopType)));
    const gunName = (shopGuns.find((d) => d.group === 'cannon') ?? shopGuns[0] ?? gunTypes.find((d) => d.group === 'cannon') ?? gunTypes[0])?.name ?? 'guns';
    const guns = mine.filter((e) => def(e)?.cls === 'Shooter' && !e.rising);
    const reaches = foe && guns.some((g) => Math.hypot(g.x + g.fx / 2 - foe.x, g.y + g.fy / 2 - foe.y) <= def(g).range + 1);
    const toward = this.direction();
    let goal, sub = '';
    if (foe?.state === 'chained') {
      const altar = v.entities.get(foe.chainedAt), mp = v.priestOf(ME);
      const at = altar && mp && mp.x >= altar.x - 1 && mp.x <= altar.x + altar.fx && mp.y >= altar.y - 1 && mp.y <= altar.y + altar.fy;
      goal = at ? `The sacrifice is under way: ${foe.runes}/5 runes. Keep your Priest and Altar safe!`
        : 'The enemy Priest is chained to your Altar. Select your Priest and click the Altar to begin the sacrifice.';
    } else if (foe?.state === 'carried' && v.entities.get(foe.carriedBy)?.owner === ME) {
      const carrier = v.entities.get(foe.carriedBy), name = def(carrier)?.name ?? 'carrier';
      goal = carrier.goal === 'altar' ? `Your ${name} is carrying the enemy Priest to your Altar. Protect it on the way.`
        : has((e) => def(e)?.cls === 'Altar' && !e.rising)
          ? `Your ${name} holds the enemy Priest. Select it and press “Carry to the Altar”.`
          : `Your ${name} holds the enemy Priest. Build an Altar with your Priest (“Altar” under Priest builds), then send the ${name} there.`;
    } else if (foe?.state === 'down') {
      goal = has((e) => def(e)?.cls === 'Altar' && !e.rising)
        ? 'The enemy Priest is down! Select a Golem and click him to carry him to your Altar.'
        : 'The enemy Priest is down! Select a Golem and click him to take him before he gets up. Then build an Altar to sacrifice him.';
    } else if (!sunShop) {
      goal = `Your Priest builds Workshops. Pick “${shopName}” under Priest builds, then click a free spot on your island.`;
      sub = 'Everything costs Storm Power (⚡). You start with some; Golems bring more from geysers.';
    } else if (sunShop.rising > 0) goal = `Your Priest is building the ${def(sunShop).name}…`;
    else if (!sunShop.slots.length) goal = `Select the ${def(sunShop).name} and add “${gunName}” to its production slots.`;
    else if (!has((e) => e.kind === 'transport')) {
      goal = 'Build a Golem: it carries Storm Power from geysers to your Temple.';
      sub = 'Golems are made at your Temple and appear on your island.';
    } else if (!has((e) => e.kind === 'transport' && e.goal !== 'idle')) {
      goal = 'Select a Golem, then click a geyser to collect Storm Power. Geysers on islets need a bridge first.';
    } else if (!guns.length) {
      goal = `Lay bridge pieces toward the enemy${toward ? ` in the ${toward}` : ''}, then build ${gunName}s near the end of your bridge.`;
      sub = 'Bridges join by their ends. Guns need Energy: the dots on their cards show what kind, the coloured rings where you have it.';
    } else if (foe && !reaches && this.energyAdvice()) {
      goal = `Your guns can’t reach the enemy Priest yet. ${this.energyAdvice()}`;
      sub = `Then lay more bridge${toward ? ` ${toward}` : ''} and build guns within range of the enemy Priest (yellow ring).`;
    } else if (!has((e) => def(e)?.cls === 'Altar')) {
      goal = 'Build an Altar with your Priest: captured Priests are sacrificed there.';
      sub = 'Meanwhile push your guns toward the enemy Priest. Red rings show where enemy guns reach.';
    } else {
      goal = 'Knock out the enemy Priest with gunfire (below half health), then send a Golem to capture him.';
      sub = `He stands near his Temple${toward ? ` to the ${toward}` : ''}. Guns shoot what is in range on their own.`;
    }
    if (me.storm < 400 && !has((e) => e.kind === 'transport' && e.goal !== 'idle')) sub = 'Low on Storm Power: send Golems to geysers.';
    if (G.ended) {
      goal = NS.outcome(w, ME) === 'won' || G.raised.has('badteamdead') ? 'Victory!' : 'The battle is lost.';
      sub = 'Press Restart to play again, or go back to the main menu.';
    }
    $('goalText').textContent = goal;
    $('goalSub').textContent = sub;
  }

  /** Where the enemy's Temple lies from yours, as a compass direction (north is up the screen). */
  direction() {
    const w = G.world, mine = w.templeOf(ME);
    const foe = [...w.players.values()].filter((p) => p.alive && w.hostile(ME, p.id)).map((p) => w.templeOf(p.id)).find(Boolean);
    if (!mine || !foe) return '';
    const a = Math.atan2(foe.y - mine.y, foe.x - mine.x); // y grows southward
    return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }

  /** How to carry Energy further out with the Generators the player knows, or '' if none. */
  energyAdvice() {
    const me = G.world.players.get(ME);
    const gens = [...me.tech].map((id) => defs.get(id)).filter((d) => d?.group === 'battery');
    if (!gens.length) return '';
    const ready = gens.find((d) => NS.makerError(G.view, ME, d) === null);
    if (ready) return `Build ${ready.name}s near the front: they carry Energy out along your bridges.`;
    const d = gens[0], fury = (d.theme ?? 'sun').replace(/^./, (c) => c.toUpperCase());
    return `Build a ${fury} Workshop with your Priest: it unlocks ${d.name}s, which carry Energy out along your bridges.`;
  }

  /* --------------------------------------- dialogs --------------------------------------- */
  modal(html, buttons) {
    const box = $('modalBox');
    box.innerHTML = `${html}<div class="row">${buttons.map((b, i) => `<button data-i="${i}" class="${b.main ? 'main' : ''}">${b.label}</button>`).join('')}</div>`;
    box.querySelectorAll('button[data-i]').forEach((el) => { el.onclick = () => buttons[Number(el.dataset.i)].act(); });
    $('modal').style.display = 'grid';
  }

  closeModal() {
    $('modal').style.display = 'none';
  }

  /** The main menu: the mission, or a skirmish with its settings. */
  menu() {
    G.paused = true;
    G.started = false;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('netstorm-3d:skirmish') ?? '{}'); } catch { /* no storage */ }
    const s = { ...SKIRMISH_DEFAULTS, ...saved };
    const fury = (id, value) => `<select id="${id}">${['wind', 'rain', 'thunder'].map((f) => `<option value="${f}" ${f === value ? 'selected' : ''}>${f[0].toUpperCase() + f.slice(1)}</option>`).join('')}</select>`;
    const pick = (id, values, value, label = (x) => x) => `<select id="${id}">${values.map((x) => `<option value="${x}" ${String(x) === String(value) ? 'selected' : ''}>${label(x)}</option>`).join('')}</select>`;
    let missionLevel = 'normal';
    try { missionLevel = localStorage.getItem('netstorm-3d:mission-level') ?? 'normal'; } catch { /* no storage */ }
    if (!LEVELS[missionLevel]) missionLevel = 'normal';
    const level = (id, value) => `<label>Opponent ${pick(id, Object.keys(LEVELS), value, (x) => x[0].toUpperCase() + x.slice(1))}</label>`;
    this.modal(`<h2>NetStorm 3D</h2>
      <p class="text">Islands at war above the clouds: build bridges, gather Storm Power and sacrifice the enemy’s Priest.</p>
      <div class="modes">
        <section><h3>${escapeHtml(MISSION.title)}</h3><p>Mission 1 of the campaign: break free from ${escapeHtml(MISSION.enemy)}. Guided step by step.</p>
          <div class="form">${level('msLevel', missionLevel)}</div>
          <p class="level" id="msLevelNote"></p>
          <button class="main" data-start="mission">Play mission</button></section>
        <section><h3>Skirmish</h3><p>A random map against the computer.</p>
          <div class="form">
            <label>Your Fury ${fury('skTheme', s.theme)}</label>
            <label>Enemy Fury ${fury('skEnemy', s.enemyTheme)}</label>
            <label>Islands ${pick('skIslands', [2, 4, 6, 9], s.islands)}</label>
            ${level('skLevel', s.difficulty)}
            <label>Storm Power ${pick('skStorm', [1000, 2000, 5000, 10000], s.storm)}</label>
            <label>Spells ${pick('skSpells', Object.keys(SPELL_MODES), s.spells, (x) => SPELL_MODES[x])}</label>
            <label>Heights ${pick('skTiers', ['level', 'tiered'], s.tiers ?? 'level', (x) => (x === 'level' ? 'Level' : 'Tiered'))}</label>
            <label>Map <span class="seed"><input id="skSeed" type="number" min="0" max="99999" value="${s.seed}"><button type="button" id="skDice" title="Another map">🎲</button></span></label>
          </div>
          <p class="level" id="skLevelNote"></p>
          <button class="main" data-start="skirmish">Start skirmish</button></section>
      </div>`, [{ label: 'Settings', act: () => this.settings(() => this.menu()) }, { label: 'How to play', act: () => this.howToPlay(() => this.menu()) }]);
    const box = $('modalBox');
    box.querySelector('#skDice').onclick = () => { box.querySelector('#skSeed').value = String(Math.floor(Math.random() * 100000)); };
    // each level's line under its choice, kept up to date as it changes
    for (const id of ['msLevel', 'skLevel']) {
      const select = box.querySelector(`#${id}`), note = box.querySelector(`#${id}Note`);
      const show = () => { note.textContent = LEVELS[select.value]; };
      select.onchange = show;
      show();
    }
    box.querySelector('[data-start="mission"]').onclick = () => {
      const difficulty = box.querySelector('#msLevel').value;
      try { localStorage.setItem('netstorm-3d:mission-level', difficulty); } catch { /* no storage */ }
      this.game.start({ mode: 'mission', difficulty });
    };
    box.querySelector('[data-start="skirmish"]').onclick = () => {
      const setup = {
        mode: 'skirmish',
        theme: box.querySelector('#skTheme').value,
        enemyTheme: box.querySelector('#skEnemy').value,
        islands: Number(box.querySelector('#skIslands').value),
        difficulty: box.querySelector('#skLevel').value,
        storm: Number(box.querySelector('#skStorm').value),
        spells: box.querySelector('#skSpells').value,
        tiers: box.querySelector('#skTiers').value,
        seed: Math.max(0, Math.min(99999, Math.floor(Number(box.querySelector('#skSeed').value) || 0))),
      };
      try { localStorage.setItem('netstorm-3d:skirmish', JSON.stringify(setup)); } catch { /* no storage */ }
      this.game.start(setup);
    };
  }

  /** Settings: rules a game takes as it starts (src/settings.js); `back` returns to where it was opened. */
  settings(back) {
    const s = loadSettings(), share = (n) => (n ? `−${n}%` : 'as by day') + (n === 25 ? ' (default)' : '');
    this.modal(`<h2>Settings</h2>
      <p class="text">These are rules: they hold from the next game you start.</p>
      <div class="form">
        <label>Day and night <select id="stNights"><option value="on" ${s.nights ? 'selected' : ''}>On</option><option value="off" ${s.nights ? '' : 'selected'}>Off</option></select></label>
        <label>Guns' reach at night <select id="stNightReach">${NIGHT_REACH.map((n) => `<option value="${n}" ${n === s.nightReach ? 'selected' : ''}>${share(n)}</option>`).join('')}</select></label>
      </div>
      <p class="level">A day lasts ${NS.DAY_SECONDS / 60} minutes and a night ${NS.NIGHT_SECONDS / 60}, from a morning at the start of the battle. At night
        guns reach less far: the setting is how much under a new moon; a quarter moon takes three quarters of that, the full
        moon half, the Sun's guns lose more and Thunder's none (rings show how far). The moon also strengthens Rain, the
        day the Sun, and a Sacrifice waits for the sun; How to play has the rest. Off, it is always day, as in the original.</p>`,
    [{ label: 'Back', act: () => back() }, {
      label: 'Save', main: true,
      act: () => {
        const box = $('modalBox');
        saveSettings({ nights: box.querySelector('#stNights').value === 'on', nightReach: Number(box.querySelector('#stNightReach').value) });
        back();
      },
    }]);
  }

  begin() {
    this.closeModal();
    G.started = true;
    G.paused = false;
    G.clock.reset();
    this.updateTop();
    this.sound.begin();
  }

  briefing() {
    if (!G.mission) return this.skirmishBriefing();
    const mission = G.mission;
    const text = (mission.pages['a.']?.text ?? mission.briefing).replace(/^The War Begins!\s*/, '');
    this.modal(`<h2>${escapeHtml(mission.title)}</h2><div class="text">${escapeHtml(text)}</div>
      <ol><li>Have your <b>Priest</b> build a <b>Sun Workshop</b>, then put the <b>Sun Cannon</b> in its production slots.</li>
      <li>Build <b>Golems</b> and send them to geysers for Storm Power. Lay <b>bridge pieces</b> to reach islets and the enemy.</li>
      <li>Knock out the enemy Priest with cannons, carry him to your <b>Altar</b> with a Golem, and have your Priest perform the sacrifice.</li></ol>
      <p class="note">Your enemy, ${escapeHtml(mission.enemy)}, is played by netstorm-web’s own computer opponent, at ${G.setup.difficulty ?? 'normal'} level.</p>`,
    [{ label: 'How to play', act: () => this.howToPlay(() => this.briefing()) }, { label: 'Controls', act: () => this.help(true) },
      { label: 'Play mission', main: true, act: () => this.begin() }]);
  }

  skirmishBriefing() {
    const s = G.setup, cap = (x) => x[0].toUpperCase() + x.slice(1);
    const enemy = [...G.world.players.values()].find((p) => p.id !== ME);
    this.modal(`<h2>Skirmish</h2>
      <p class="text">You are ${cap(s.theme)}; ${escapeHtml(enemy?.name ?? 'the computer')} is ${cap(s.enemyTheme)} and plays at ${s.difficulty} level. ${s.islands} islands${s.tiers === 'tiered' ? ' on three levels: you lay bridges on the level shown by your bridge pieces (Q goes down, E up), and where a bridge meets another level a lift carries walkers up or down, slowly and exposed to fire' : ''}, map ${s.seed}.</p>
      <ol><li>Win by capturing the enemy’s Priest and sacrificing him at your Altar; lose if he does it to you.</li>
      <li>You know the ${cap(s.theme)} units (${escapeHtml(this.furyUnits(s.theme))}) and the Sun’s first ones. Your Priest builds the Workshops that make them (a ${cap(s.theme)} Workshop for the ${cap(s.theme)} units), and an Altar.</li>
      <li>New geysers appear during the battle. Golems carry their Storm Power home.</li>
      <li>Spells: ${{ none: 'your Priest can pray for the Devastation (select him: “Pray”), and cast it round him.', obelisks: 'Obelisks with Spells rise during the battle (send a carrier to take one); your Priest can pray for the Devastation.', prayer: 'your Priest can pray for any Spell (select him: “Pray”), and cast it round him.' }[s.spells ?? 'none']} See How to play.</li></ol>`,
    [{ label: 'Main menu', act: () => this.menu() }, { label: 'How to play', act: () => this.howToPlay(() => this.briefing()) },
      { label: 'Controls', act: () => this.help(true) }, { label: 'Start', main: true, act: () => this.begin() }]);
  }

  /** The card of several carriers selected together: what they are, what they do. */
  renderGroup(box) {
    const units = this.game.selectedIds().map((id) => G.view.entities.get(id));
    const count = (list, plural = false) => [...list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map())]
      .map(([k, n]) => `${n} ${k}${plural && n > 1 ? 's' : ''}`).join(' · ');
    const doing = { idle: 'waiting', collect: 'collecting', pickup: 'fetching a crystal', home: 'carrying Storm Power home', capture: 'going for the enemy Priest', altar: 'carrying a captive', obelisk: 'fetching a spell' };
    const lines = [
      count(units.map((e) => defs.get(e.type)?.name ?? e.type), true),
      count(units.map((e) => doing[e.goal] ?? e.goal)),
      'Click a geyser, a crystal, a downed enemy Priest or ground: they all go. Shift-click one to add or remove it; Esc clears.',
    ];
    const html = `<h4>${units.length} selected</h4>${lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join('')}`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
    }
    box.style.display = 'block';
  }

  /** The names of the units of `theme` the player knows, for the briefing. */
  furyUnits(theme) {
    return [...G.world.players.get(ME).tech].map((id) => defs.get(id)).filter((d) => d?.theme === theme && BUILDABLE.has(d.cls))
      .map((d) => d.name).join(', ');
  }

  /** The end of a skirmish. */
  result(won) {
    if (G.ended) return;
    G.ended = true;
    G.paused = true;
    this.sound.end(won);
    this.modal(`<h2>${won ? 'Victory!' : 'Defeat'}</h2><p class="text">${escapeHtml(won ? NS.m.page_enemy_sacrificed() : NS.m.page_own_sacrificed())}</p>`,
      [{ label: 'Keep looking', act: () => this.closeModal() }, { label: 'Main menu', act: () => this.game.start(G.setup, { menu: true }) },
        { label: 'Play again', main: true, act: () => this.game.start() }]);
  }

  help(fromBriefing = false) {
    const was = G.paused;
    if (G.started) G.paused = true;
    this.modal(`<h2>Controls</h2><ol style="list-style:none;padding:0">
      <li><b>Camera:</b> drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> pan · <kbd>Q</kbd><kbd>E</kbd> turn (on tiered islands: the level, below)</li>
      <li><b>Select:</b> click a unit or building. With a Golem or air ship selected, click a geyser to collect, a downed enemy Priest to capture him, or ground to send it there. With your Priest selected, click ground to walk, or your Altar to perform a sacrifice.</li>
      <li><b>Several at once:</b> <kbd>Shift</kbd>-click Golems and air ships to add or remove them · double-click one for all of its kind on the screen · <kbd>Ctrl</kbd>-drag (<kbd>⌘</kbd>-drag on a Mac) a box around them. An order then goes to all. <kbd>I</kbd> picks the next idle one.</li>
      <li><b>Bridges:</b> click a piece (or <kbd>1</kbd>–<kbd>6</kbd>), then the map. <kbd>R</kbd> rotates. Pieces join only by their ends; the yellow dot marks the cell under the cursor. While you hold a piece, markers float over your bridges’ open ends, and the piece snaps onto the one nearest the pointer (or the rim of your island). On tiered islands a piece is laid on the level shown by the pieces: <kbd>Q</kbd> goes a level down, <kbd>E</kbd> up. Where a bridge joins another level a lift stands; walkers ride it slowly and take half again the damage on the way. Flyers hunt in a sphere about their base, reaching other levels; a Sun Disc Thrower throws level or up, never down.</li>
      <li><b>Build:</b> click a card, then the map. <kbd>R</kbd> turns cannons. Hold <kbd>Shift</kbd> to build several. Rings in each Fury’s colour show your Energy (the ones that count for the spot light up, and the tip says what is missing); yellow, the gun’s range. The dots on a card are the Energy it needs.</li>
      <li><b>Cancel:</b> right-click or <kbd>Esc</kbd> · <b>Pause:</b> <kbd>Space</kbd> · <b>Speed:</b> <kbd>+</kbd> / <kbd>−</kbd> · <b>Salvage:</b> <kbd>Delete</kbd></li>
      <li><b>Look:</b> <kbd>H</kbd> your Temple · <kbd>P</kbd> your Priest · <kbd>F</kbd> follow the selected unit · click or drag on the minimap</li>
      <li><b>Danger:</b> <kbd>G</kbd> shows where enemy guns reach (red); they show by themselves while you hold a piece or a building · <kbd>L</kbd> the event log</li>
      <li><b>Touch:</b> tap to select; with a piece or building chosen, tap once to preview and again to place.</li>
      <li><b>Tabletop:</b> <kbd>T</kbd> puts the battle on a table, as a headset shows it. <b>VR</b> and <b>AR</b> appear in the top bar when your headset or phone can do them: the trigger (or a tap) selects, lays and builds · grip cancels · A/X rotates the piece · right stick turns and zooms the map, left stick moves it · B/Y recenters (AR: moves the table)</li></ol>
      <p class="note">Build ${escapeHtml(describeBuild())} · <a href="https://github.com/misterclarity/netstorm-3d" target="_blank" rel="noopener">source on GitHub</a></p>`,
    [{ label: fromBriefing ? 'Back' : 'Resume', main: true, act: () => { if (fromBriefing) this.briefing(); else { this.closeModal(); G.paused = was; G.clock.reset(); } } }]);
  }

  /**
   * The game explained: the goal, Storm Power, bridges, building, fighting and the capture. `back`
   * is where its button returns (the menu or a briefing); from the battle it resumes.
   */
  howToPlay(back = null) {
    const was = G.paused;
    if (G.started) G.paused = true;
    this.modal(`<h2>How to play</h2><div class="guide">
      <p>Islands float above the clouds, and each side has a <b>High Priest</b> and a <b>Temple</b>. You win by
        knocking out the enemy’s Priest, carrying him to your <b>Altar</b> and sacrificing him there. If the
        enemy does that to yours, you lose.</p>
      <h3>Your Priest</h3>
      <p>He is your most precious unit. He builds Workshops and the Altar (the “Priest builds” cards), walks on
        your ground and can carry a Storm Crystal home. Keep him out of reach of enemy guns: press <kbd>G</kbd>
        to see their range in red.</p>
      <h3>Storm Power ⚡</h3>
      <p>Everything costs Storm Power. It comes from geysers as Storm Crystals, and counts once a crystal is
        carried home to your Temple. Build <b>Golems</b> at your Temple, select one and click a geyser: it
        keeps carrying crystals home by itself. Geysers run dry and new ones appear during the battle. Air
        ships fly, so they can reach geysers no bridge leads to.</p>
      <h3>Bridges</h3>
      <p>Bridge pieces arrive in your hand at the bottom, up to six, while you have a Temple. Each must
        harden for a moment before it can be laid. Click one (or press <kbd>1</kbd>–<kbd>6</kbd>), turn it with
        <kbd>R</kbd>, and lay it so that one of its ends meets the end of your ground or of another bridge:
        pieces join only by their ends. Bridges lead your Golems and Priest to islets, geysers and the enemy.
        Nothing is built on a bridge itself, but many units can be built just off its open end, on a little
        islet of their own, and on any unclaimed island a bridge joins to yours. Enemy fire can crack and
        break bridges.</p>
      <h3>Workshops and units</h3>
      <p>A Workshop makes the units of its Fury. Select it and put units in its production slots; they then
        appear as Build cards, and you build them on your island. Upgrade a Workshop for its stronger units.
        Units need <b>Energy</b> where they are built. The dots on a card show how much: one dot per
        icon, in the colour of its Fury, and a four-coloured dot for “any”. Level 1 units need one of their
        Fury’s, level 2 one more of any, level 3 two of their Fury’s and one of any. Your Temple gives two of
        its Fury and each Generator one of its own (a Sun Generator’s counts as any) to everything inside its
        ring. Nothing is used up: one Generator serves every unit around it. While you place a unit, the
        rings that count light up and the tip says what is missing.</p>
      <h3>Fighting</h3>
      <p>Guns fire by themselves at enemies in range (the yellow ring when you place or select one). Cannons
        and the Crossbow fire the way they face. Turn them with <kbd>R</kbd> while placing them. The Wind
        Tower is shielded on the side it faces. Towers and barricades hold a line, air bases send flyers at
        the enemy, and the Vander Tower shoots flyers down.</p>
      <p>A hit weighs its target. The Sun and Thunder Cannons are <b>siege guns</b>: ×${NS.SIEGE_VS_BUILDINGS} on
        buildings, ×${NS.SIEGE_VS_UNITS} on units. The Crossbow, Disc Thrower and Ice Cannon are <b>light guns</b>:
        ×${NS.LIGHT_VS_BUILDINGS} on buildings. A unit riding a lift counts as a building, and takes
        ×${NS.LIFT_EXPOSURE} besides. On tiered islands a gun hits ${NS.HIGH_HIT * 100}% harder for each level its
        target stands below it (${NS.HIGH_HIT * 100}% softer for each above) and reaches ${NS.HIGH_REACH * 100}% farther
        for each level down; not at flyers, nor the Disc Thrower. A Priest has a ward: no single hit takes more
        than ${NS.PRIEST_WARD} off him, so no one shot knocks him out. Select a gun of yours and point at an enemy:
        the tip says what its hits are multiplied by.</p>
      <h3>Day and night</h3>
      <p>Unless it is turned off in Settings, a day of ${NS.DAY_SECONDS / 60} minutes follows the start of the battle,
        then a night of ${NS.NIGHT_SECONDS / 60}, and so on; the clock by the Storm Power says which, how long until
        it turns, and tonight’s moon. The moon goes round a night at a time: 🌑 new, 🌓 first quarter, 🌕 full,
        🌗 third quarter, then new again; the first night has a new moon.</p>
      <ul><li><b>Reach.</b> At night guns reach less far: a quarter less under a new moon (unless Settings
        say otherwise), three quarters of that under a quarter moon, half under the full moon. The Sun’s
        guns are blinder, Thunder’s see by their own lightning and lose nothing, and a gun inside the Energy
        ring of your Temple or a Generator is lit and keeps its full reach. A Vander Tower’s beam lights up
        flyers for all your guns around. The rings show how far each gun reaches now. A night is the time
        to move carriers and lay bridges past the enemy’s guns.</li>
        <li><b>The Furies.</b> Rain is the moon’s Fury: at night its guns and flyers hit ×${NS.RAIN_MOON[1]} under a
        quarter moon and ×${NS.RAIN_MOON[2]} under the full moon, but ×${NS.RAIN_MOON[0]} under the new. By day the Sun’s hit
        ×${NS.SUN_DAY}. At night a Sun Generator is dark: it gives no Energy, and Whirligigs stay in their base
        until dawn.</li>
        <li><b>Priests.</b> A Priest calls out to the sun: a Sacrifice stops at nightfall and goes on at dawn,
        the captive still chained, which leaves the night to his side to break the Altar and free him. By
        day a Priest heals half as fast again; at night he prays a quarter slower, but Thunder’s Spells come
        a third faster.</li>
        <li><b>Crystals</b> brought home at night are worth a quarter more.</li></ul>
      <h3>Capturing the enemy Priest</h3>
      <ol><li>Build guns within reach of the enemy Priest and knock him out: he falls when he is below half
        his health.</li>
        <li>Quickly select a Golem and click him, before he gets his strength back and stands up. It carries
        him to your Altar, or holds him until you have built one; then press “Carry to the Altar”.</li>
        <li>When he is chained to your Altar, select your Priest and click the Altar. Your Priest wards five
        runes standing beside it; protect both until the last. In a skirmish nobody can be chained in the
        first two minutes.</li></ol>
      <p>The enemy will try the same: if your Priest is knocked out, shoot the carriers that come for him.</p>
      <h3>Spells</h3>
      <p>In a skirmish your Priest can <b>pray</b> for the <b>Devastation</b>: select him and press “Pray” on
        his card; he stands still for 40 s (walking or a hit breaks the prayer off). Then he holds it, a
        glowing orb over his head, and “Cast” sets it off round him for ⚡100, five seconds later:
        everything on the ground within 3 cells is destroyed, <b>yours too</b>, Temples and Workshops lose
        a third of their hit points, and bridges there fall. Selected, he shows the ring it will reach.
        With the skirmish setting <b>Spells: Obelisks</b>, Obelisks with other Spells rise during the battle: send a
        carrier to one (select it, click the Obelisk) and cast the Spell from its card. With <b>Spells: Any,
        by prayer</b>, the Priest prays for any of them instead. The enemy prays too: an orb over his
        Priest warns you, and a pulsing ring round a caster shows where his Spell is about to strike.</p>
      <table class="spells"><thead><tr><th>Spell</th><th>What it does</th><th>⚡</th><th>Reach</th><th>Cast</th><th>Prayer</th></tr></thead><tbody>
        ${SPELL_IDS.map((id) => defs.get(id)).filter(Boolean).map((d) => `<tr><td>${escapeHtml(d.name)}${d.id === 'bombspecialone' ? ' (prayed for)' : ''}</td><td>${escapeHtml(spellText(d.id)[0].toUpperCase() + spellText(d.id).slice(1))}.</td>
          <td>${d.cost}</td><td>${d.range}</td><td>${d.castTime} s</td><td>${d.id === 'bombspecialone' ? `${d.prayTime} s` : /lighting/.test(d.id) ? 'Obelisks only' : `${d.prayTime} s*`}</td></tr>`).join('')}
      </tbody></table>
      <p class="note">Reach and cast time in cells and seconds; the caster stands still while it casts. The Devastation is prayed for in every skirmish;
        * the others only with Spells: Any, by prayer (the Thunder Spells never), or found on Obelisks with Spells: Obelisks.</p>
      <h3>The computer’s levels</h3>
      <p>Chosen in the main menu, for the mission and the skirmish alike. <b>Easy</b>: ${LEVELS.easy}
        <b>Normal</b>: ${LEVELS.normal} <b>Hard</b>: ${LEVELS.hard} All three pay the same prices and
        start with the same Storm Power.</p>
      <h3>Tips</h3>
      <p>The <b>Next step</b> card at the top right always says what to do next. Golems come first: without
        Storm Power there is no army. Press <kbd>Space</kbd> to pause and look around, and <b>Help</b> for every
        control.</p></div>`,
    [{ label: back ? 'Back' : 'Resume', main: true, act: () => { if (back) back(); else { this.closeModal(); G.paused = was; G.clock.reset(); } } }]);
  }

  confirmRestart() {
    const was = G.paused;
    G.paused = true;
    this.modal(`<h2>Restart the ${G.mission ? 'mission' : 'skirmish'}?</h2><p class="text">The battle starts over from the beginning${G.mission ? '' : ', on the same map'}.</p>`,
      [{ label: 'Cancel', act: () => { this.closeModal(); G.paused = was; G.clock.reset(); } },
        { label: 'Main menu', act: () => this.game.start(G.setup, { menu: true }) },
        { label: 'Restart', main: true, act: () => this.game.start() }]);
  }

  /** A newer build has been published: offer to load it. */
  newVersion(version) {
    if (document.getElementById('update')) return;
    const el = document.createElement('div');
    el.id = 'update';
    el.className = 'panel';
    el.innerHTML = '<span>A new version of the game is available.</span><button>Reload</button>';
    el.querySelector('button').onclick = () => loadNewer(version);
    document.body.appendChild(el);
  }

  /** A page of the mission's script: victory or defeat end the battle. */
  page(event, page) {
    if (!page || G.ended) return;
    const won = event === 'succeeded' || event === 'badteamdead';
    const lost = event === 'failed' || event === 'goodteamdead';
    if (!won && !lost) { this.toast(page.text.split('\n')[0]); return; }
    G.ended = true;
    G.paused = true;
    this.sound.end(won);
    this.modal(`<h2>${won ? 'Victory!' : 'Defeat'}</h2><div class="text">${escapeHtml(page.text.replace(/^(Success!|Failure!)\s*/, ''))}</div>`,
      [{ label: 'Keep looking', act: () => this.closeModal() }, { label: 'Main menu', act: () => this.game.start(G.setup, { menu: true }) },
        { label: 'Play again', main: true, act: () => this.game.start() }]);
  }
}
