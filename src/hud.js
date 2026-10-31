/**
 * The HUD, in plain DOM over the scene: the top bar, the bottom bar of bridge pieces and buildings,
 * the card of the selected thing, the next-step card, toasts and the dialogs.
 */
import { NS, G, MISSION, TPS, ME, defs, BUILDABLE, PRIEST_BUILT, HARDEN, SPEEDS, FACING_NAMES, OWNER_COLOR, FURY_COLOR, playerTheme, errorText, escapeHtml } from './state.js';
import { submit } from './game.js';
import { modelKind } from './models.js';

const $ = (id) => document.getElementById(id);

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
    const sound = this.sound = game.el.systems['ns-sound'];
    for (const key of ['sound', 'music']) {
      const b = $(key === 'sound' ? 'sfxToggle' : 'musicToggle');
      b.classList.toggle('on', sound.settings[key]);
      b.onclick = () => { sound.set(key, !sound.settings[key]); b.classList.toggle('on', sound.settings[key]); };
    }
    $('restart').onclick = () => this.confirmRestart();
    $('bar').addEventListener('click', (e) => this.barClick(e));
    $('sel').addEventListener('click', (e) => this.selClick(e));
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
    this.closeModal();
    this.updateTop();
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
    $('pause').textContent = G.paused ? '▶ Resume' : 'Pause';
    $('pause').classList.toggle('on', G.paused && G.started);
    $('speed').textContent = `${G.speed}×`;
  }

  toast(text, kind = '') {
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
    if (!cam) return;
    const p = at.clone().project(cam);
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
  /** "Use your High Priest to build Temples, Workshops, and Altars." */
  priestCards() {
    return [...new Set([`${playerTheme(ME)}factory`, 'sunfactory', 'altar'])].map((id) => defs.get(id)).filter(Boolean);
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
        return `<button class="card ${tool.kind === 'build' && tool.type === d.id ? 'on' : ''} ${poor || c ? 'poor' : ''}" data-act="build" data-type="${d.id}" title="${d.name}: ${d.cls}, ${d.footX}×${d.footY}${d.range ? `, range ${d.range}` : ''}"><canvas width="46" height="40" data-icon="${d.id}"></canvas><span>${d.name}</span><span class="cost">⚡${d.cost}</span>${c ? `<i class="fill" data-cool="${d.id}"></i>` : ''}</button>`;
      };
      const why = (d) => {
        const err = NS.makerError(G.view, ME, d), fury = (d.theme ?? 'sun').replace(/^./, (c) => c.toUpperCase());
        if (err === 'no workshop') return `${d.name}: needs a ${fury} Workshop`;
        if (err === 'not in production') return `${d.name}: select your ${fury} Workshop and add it to a slot${d.level > 1 ? ' (upgrade the Workshop for more slots)' : ''}`;
        return `${d.name}: ${errorText(err)}`;
      };
      $('units').innerHTML = units.map(card).join('')
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
    const img = this.art.sprite(d.group === 'cannon' ? `${id}:2` : id);
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
    else if (kind === 'golem') { g.fillRect(17, 12, 12, 16); g.fillRect(19, 5, 8, 7); g.fillRect(17, 28, 4, 8); g.fillRect(25, 28, 4, 8); }
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
    return `${name}${owner ? ` (${owner})` : ''}${hint}`;
  }

  renderSelection() {
    const box = $('sel');
    const e = G.selected === null ? null : G.view.entities.get(G.selected);
    if (!e) {
      box.style.display = 'none';
      G.selected = null;
      return;
    }
    const d = e.type ? defs.get(e.type) : null, owner = e.owner ? G.world.players.get(e.owner) : null;
    const name = e.kind === 'priest' ? 'High Priest' : e.kind === 'geyser' ? 'Geyser' : e.kind === 'crystal' ? 'Storm crystal' : d?.name ?? e.kind;
    const lines = [], acts = [];
    if (e.kind === 'geyser') lines.push(e.stock > 0 ? `${e.stock} Storm Power left` : 'Spent');
    if (e.kind === 'building') {
      if (e.rising > 0) lines.push(`Under construction: ${Math.ceil(e.rising / TPS)} s`);
      if (d.cls === 'Production') {
        lines.push(`Level ${e.upgrades + 1} · production slots ${e.slots.length}/${e.upgrades + 1}`);
        lines.push(e.slots.length ? `Makes: ${e.slots.map((t) => defs.get(t)?.name).join(', ')}` : 'No unit in production yet');
        if (e.owner === ME && !e.rising) {
          for (const u of [...G.world.players.get(ME).tech].map((t) => defs.get(t))) {
            if (!u || !NS.takesSlot(u) || e.slots.includes(u.id)) continue;
            const err = NS.canProduce(G.view, { player: ME, workshop: e.id, type: u.id });
            if (err === 'cannot build') continue;
            acts.push(`<button data-sel="produce" data-type="${u.id}" ${err ? `disabled title="${errorText(err)}"` : ''}>+ ${u.name}</button>`);
          }
          const up = NS.canUpgrade(G.view, { player: ME, workshop: e.id });
          if (up !== 'bad target' && up !== 'fully upgraded') acts.push(`<button data-sel="upgrade" ${up ? `disabled title="${errorText(up)}"` : ''}>Upgrade (⚡${d.cost})</button>`);
        }
      }
      if (d.range) lines.push(`Range ${d.range}${d.dps ? ` · damage ${d.dps}/s` : ''}${NS.hasFacing(d) ? ` · faces ${FACING_NAMES[e.facing]}` : ''}`);
      if (d.cls === 'Altar') {
        const captive = [...G.view.entities.values()].find((c) => c.kind === 'priest' && c.chainedAt === e.id);
        lines.push(captive ? `A captive is chained here: ${captive.runes}/5 runes. Your Priest must stand beside the Altar.` : 'Captured Priests are sacrificed here');
        if (e.owner === ME && captive) acts.push('<button data-sel="ritual">Send Priest: begin the sacrifice</button>');
      }
      if (e.owner === ME && d.cls !== 'Energy') acts.push('<button data-sel="salvage" title="Delete">Salvage</button>');
    }
    if (e.kind === 'transport') {
      lines.push({ idle: 'Waiting for orders', collect: 'Collecting Storm Power', pickup: 'Fetching a crystal', home: 'Carrying Storm Power home', capture: 'Going for the enemy Priest', altar: 'Carrying the captive to the Altar', obelisk: 'Fetching a spell' }[e.goal] ?? e.goal);
      if (e.owner === ME) {
        lines.push('Click a geyser to collect from it, or a downed enemy Priest to capture him.');
        if (e.carrying !== null) acts.push('<button data-sel="drop">Drop cargo</button>');
        acts.push('<button data-sel="salvage">Salvage</button>');
      }
    }
    if (e.kind === 'priest') {
      lines.push({ normal: e.goal === 'build' ? 'Building' : 'Standing', down: 'Knocked out', carried: 'Being carried off', chained: `Chained to an Altar: ${e.runes}/5 runes` }[e.state] ?? e.state);
      if (e.owner === ME && e.state === 'normal') lines.push('Click ground to walk, or your Altar to perform a sacrifice. “Priest builds” below has Workshops and the Altar.');
      if (e.owner !== ME && e.state !== 'down') lines.push('Knock him out (below half health) with cannons, then send a Golem.');
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
    if (b.dataset.sel === 'salvage') this.salvage();
    if (b.dataset.sel === 'ritual') {
      const altar = G.view.entities.get(id);
      if (altar) this.game.priestToAltar(altar);
    }
    this.dirty = true;
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
    const v = G.view, me = G.world.players.get(ME);
    const mine = [...v.entities.values()].filter((e) => e.owner === ME);
    const has = (f) => mine.some(f);
    const cls = (e) => e.kind === 'building' && defs.get(e.type)?.cls;
    const foe = v.priestOf(2);
    const sunShop = mine.find((e) => e.kind === 'building' && e.type === 'sunfactory');
    const cannonReach = defs.get('suncannon').range + 1;
    let goal, sub = '';
    if (foe?.state === 'chained') {
      const altar = v.entities.get(foe.chainedAt), mp = v.priestOf(ME);
      const at = altar && mp && mp.x >= altar.x - 1 && mp.x <= altar.x + altar.fx && mp.y >= altar.y - 1 && mp.y <= altar.y + altar.fy;
      goal = at ? `The sacrifice is under way: ${foe.runes}/5 runes. Keep your Priest and Altar safe!`
        : 'The enemy Priest is chained to your Altar. Select your Priest and click the Altar to begin the sacrifice.';
    } else if (foe?.state === 'carried' && v.entities.get(foe.carriedBy)?.owner === ME) {
      goal = 'Your Golem is carrying the enemy Priest to your Altar. Protect it on the way.';
    } else if (foe?.state === 'down') {
      goal = has((e) => cls(e) === 'Altar' && !e.rising)
        ? 'The enemy Priest is down! Select a Golem and click him to carry him to your Altar.'
        : 'The enemy Priest is down, but you need an Altar first: pick “Altar” under Priest builds.';
    } else if (!sunShop) {
      goal = 'Your Priest builds Workshops. Pick “Sun Workshop” under Priest builds, then click a free spot on your island.';
      sub = 'Everything costs Storm Power (⚡). You start with some; Golems bring more from geysers.';
    } else if (sunShop.rising > 0) goal = 'Your Priest is building the Sun Workshop…';
    else if (!sunShop.slots.length) goal = 'Select the Sun Workshop and add “Sun Cannon” to its production slots.';
    else if (!has((e) => e.kind === 'transport')) {
      goal = 'Build a Golem: it carries Storm Power from geysers to your Temple.';
      sub = 'Golems are made at your Temple and appear on your island.';
    } else if (!has((e) => e.kind === 'transport' && e.goal !== 'idle')) {
      goal = 'Select a Golem, then click a geyser to collect Storm Power. Geysers on islets need a bridge first.';
    } else if (!has((e) => e.kind === 'building' && e.type === 'suncannon')) {
      goal = 'Lay bridge pieces toward the enemy in the east, then build Sun Cannons near the end of your bridge.';
      sub = 'Bridges join by their ends. Cannons need Energy: blue rings show where you have it.';
    } else if (foe && !mine.some((e) => e.type === 'suncannon' && Math.hypot(e.x + 1.5 - foe.x, e.y + 1.5 - foe.y) <= cannonReach)
      && !has((e) => e.kind === 'building' && e.type === `${playerTheme(ME)}factory`)) {
      goal = 'Your cannons can’t reach the enemy Priest yet. Build a Rain Workshop with your Priest: it unlocks Rain Generators, which carry Energy out along your bridges.';
      sub = 'Then lay more bridge east and build cannons within range of the enemy Priest (yellow ring).';
    } else if (!has((e) => cls(e) === 'Altar')) {
      goal = 'Build an Altar with your Priest: captured Priests are sacrificed there.';
      sub = 'Meanwhile push your cannons toward the enemy Priest and his Disc Throwers.';
    } else {
      goal = 'Knock out the enemy Priest with cannon fire (below half health), then send a Golem to capture him.';
      sub = 'He stands near his Temple in the east. Cannons shoot what is in range on their own.';
    }
    if (me.storm < 400 && !has((e) => e.kind === 'transport' && e.goal !== 'idle')) sub = 'Low on Storm Power: send Golems to geysers.';
    if (G.ended) {
      goal = v.winner === ME || G.raised.has('badteamdead') ? 'Victory! Your island is free.' : 'The battle is lost.';
      sub = 'Press Restart to play again.';
    }
    $('goalText').textContent = goal;
    $('goalSub').textContent = sub;
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

  briefing() {
    const text = (MISSION.pages['a.']?.text ?? MISSION.briefing).replace(/^The War Begins!\s*/, '');
    this.modal(`<h2>${escapeHtml(MISSION.title)}</h2><div class="text">${escapeHtml(text)}</div>
      <ol><li>Have your <b>Priest</b> build a <b>Sun Workshop</b>, then put the <b>Sun Cannon</b> in its production slots.</li>
      <li>Build <b>Golems</b> and send them to geysers for Storm Power. Lay <b>bridge pieces</b> to reach islets and the enemy.</li>
      <li>Knock out the enemy Priest with cannons, carry him to your <b>Altar</b> with a Golem, and have your Priest perform the sacrifice.</li></ol>
      <p class="note">Your enemy, ${escapeHtml(MISSION.enemy)}, is played by netstorm-web’s own computer opponent.</p>`,
    [{ label: 'Controls', act: () => this.help(true) },
      { label: 'Play mission', main: true, act: () => { this.closeModal(); G.started = true; G.paused = false; G.clock.reset(); this.updateTop(); this.sound.begin(); } }]);
  }

  help(fromBriefing = false) {
    const was = G.paused;
    if (G.started) G.paused = true;
    this.modal(`<h2>Controls</h2><ol style="list-style:none;padding:0">
      <li><b>Camera:</b> drag to orbit · right-drag or Shift-drag to pan · scroll or pinch to zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> pan · <kbd>Q</kbd><kbd>E</kbd> turn</li>
      <li><b>Select:</b> click a unit or building. With a Golem selected, click a geyser to collect or a downed enemy Priest to capture him. With your Priest selected, click ground to walk, or your Altar to perform a sacrifice.</li>
      <li><b>Bridges:</b> click a piece (or <kbd>1</kbd>–<kbd>6</kbd>), then the map. <kbd>R</kbd> rotates. Pieces join only by their ends; the yellow dot marks the cell under the cursor.</li>
      <li><b>Build:</b> click a card, then the map. <kbd>R</kbd> turns cannons. Hold <kbd>Shift</kbd> to build several. Blue rings show your Energy; yellow, the gun’s range.</li>
      <li><b>Cancel:</b> right-click or <kbd>Esc</kbd> · <b>Pause:</b> <kbd>Space</kbd> · <b>Speed:</b> <kbd>+</kbd> / <kbd>−</kbd> · <b>Salvage:</b> <kbd>Delete</kbd></li>
      <li><b>Touch:</b> tap to select; with a piece or building chosen, tap once to preview and again to place.</li></ol>`,
    [{ label: fromBriefing ? 'Back' : 'Resume', main: true, act: () => { if (fromBriefing) this.briefing(); else { this.closeModal(); G.paused = was; G.clock.reset(); } } }]);
  }

  confirmRestart() {
    const was = G.paused;
    G.paused = true;
    this.modal('<h2>Restart the mission?</h2><p class="text">The battle starts over from the beginning.</p>',
      [{ label: 'Cancel', act: () => { this.closeModal(); G.paused = was; G.clock.reset(); } }, { label: 'Restart', main: true, act: () => this.game.start() }]);
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
      [{ label: 'Keep looking', act: () => this.closeModal() }, { label: 'Play again', main: true, act: () => this.game.start() }]);
  }
}
