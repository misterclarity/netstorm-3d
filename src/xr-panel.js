/**
 * The tabletop's panel: the HUD again, painted on a board at the table's edge where a headset can
 * see it. It does not keep a game state of its own: it reads the page's HUD (which goes on
 * updating while the headset is on) and a press on one of its buttons clicks the HUD's own button.
 * The dialogs come along too, with their choices: the main menu, the briefing, victory and defeat.
 */
import { G } from './state.js';

const { THREE } = AFRAME;
const W = 1280, H = 800; // canvas pixels
export const PANEL_SIZE = { w: 0.5, h: 0.3125 }; // metres
const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';
const C = {
  bg: '#0e1522', edge: 'rgba(255, 255, 255, 0.16)', text: '#eef3fa', muted: '#a3b1c5',
  accent: '#f2c14e', good: '#6fd08c', bad: '#ff7a6b', button: '#27344b', hover: '#3a4c6b', on: '#5a4a1c',
};

const $ = (id) => document.getElementById(id);
const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** A button's words; a button of symbols only (the 🎲) by its tooltip. */
const words = (b) => {
  const t = txt(b);
  return /[A-Za-z0-9]/.test(t) ? t : b.title || t;
};

export class Panel {
  /** `game` is the ns-game system; `xr` the ns-xr system, which adds the tabletop's own buttons. */
  constructor(game, xr) {
    this.game = game;
    this.xr = xr;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_SIZE.w, PANEL_SIZE.h),
      // opaque, its round corners cut by the alpha test: no sorting against the scene's see-through things
      new THREE.MeshBasicMaterial({ map: this.tex, alphaTest: 0.5, toneMapped: false, fog: false }),
    );
    this.mesh.name = 'ns-panel';
    this.raycaster = new THREE.Raycaster();
    this.items = [];
    this.hover = null;
    this.flash = null;
    this.sig = '';
    this.acc = Infinity;
  }

  /** Where `ray` (a scene ray) meets the panel: { item } with the button there, if any; or null. */
  pick(ray) {
    if (!this.shown()) return null;
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit?.uv) return null;
    const x = hit.uv.x * W, y = (1 - hit.uv.y) * H;
    return { item: this.items.find((b) => !b.off && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null, distance: hit.distance };
  }

  shown() {
    let o = this.mesh;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return !!this.mesh.parent;
  }

  /** The pointer's ray this frame: true when it is on the panel. */
  hoverAt(ray) {
    const p = ray && this.pick(ray);
    const key = p?.item?.key ?? null;
    if (key !== this.hover) { this.hover = key; this.acc = Infinity; }
    return !!p;
  }

  /** A press along `ray`: true when it was on the panel (whether or not on a button). */
  press(ray) {
    const p = this.pick(ray);
    if (!p) return false;
    if (p.item) {
      this.flash = p.item.key;
      setTimeout(() => { this.flash = null; this.acc = Infinity; }, 160);
      p.item.act();
      this.game.sound().play('select');
      this.acc = Infinity;
    }
    return true;
  }

  /** Repaint when what it shows has changed, a few times a second at most. */
  update(dt) {
    this.acc += dt;
    if (this.acc < 120 || !this.shown()) return;
    this.acc = 0;
    const model = this.xr.placing ? this.placing() : this.game.hud.modalOpen() ? this.dialog() : this.battle();
    const sig = JSON.stringify(model, (k, v) => (k === 'act' || k === 'icon' ? undefined : v)) + this.hover + this.flash + this.game.hud.sig;
    if (sig === this.sig) return;
    this.sig = sig;
    this.paint(model);
  }

  /* ------------------------------------- what it shows ------------------------------------- */
  /** The battle: Storm Power and time, the next step, the selection, the bridge pieces and builds. */
  battle() {
    const game = this.game, xr = this.xr, out = { texts: [], buttons: [], cards: [] };
    const T = (x, y, w, text, o = {}) => out.texts.push({ x, y, w, text, ...o });
    const B = (key, x, y, w, h, label, act, o = {}) => out.buttons.push({ key, x, y, w, h, label, act, ...o });
    // top row
    T(28, 52, 200, `Storm ${txt($('storm').querySelector('b'))}`, { size: 34, bold: true, color: C.accent });
    T(250, 52, 150, txt($('clock').querySelector('b')), { size: 32, bold: true });
    let x = 360;
    const pause = $('pause');
    B('pause', x, 18, 130, 50, G.paused ? 'Resume' : 'Pause', () => pause.click(), { on: G.paused && G.started }); x += 140;
    B('speed', x, 18, 70, 50, txt($('speed')).replace('×', 'x'), () => $('speed').click()); x += 80;
    B('ranges', x, 18, 180, 50, 'Enemy range', () => $('rangesToggle').click(), { on: $('rangesToggle').classList.contains('on') });
    B('exit', W - 132, 18, 112, 50, xr.mode === 'preview' ? 'Leave' : 'Exit', () => xr.exit(), { tone: 'bad' });
    // the next step
    T(28, 112, 760, txt($('goalText')), { size: 27, lines: 2, bold: true });
    T(28, 180, 760, txt($('goalSub')), { size: 22, lines: 1, color: C.muted });
    const toast = $('toasts').lastElementChild;
    if (toast) T(28, 220, 760, txt(toast), { size: 23, lines: 1, color: toast.classList.contains('bad') ? C.bad : toast.classList.contains('good') ? C.good : C.text });
    const tip = game.el.querySelector('[ns-placement]')?.components['ns-placement'];
    if (tip?.tipText) T(28, 256, 760, tip.tipText, { size: 22, lines: 1, color: tip.tipBad ? C.bad : C.muted });
    // the selection
    const sel = $('sel');
    if (sel.style.display !== 'none' && sel.firstChild) {
      T(816, 108, 440, txt(sel.querySelector('h4')), { size: 28, bold: true, lines: 1 });
      T(816, 142, 440, txt(sel.querySelector('.who')), { size: 21, lines: 1, color: C.muted });
      const hp = sel.querySelector('.hp i');
      if (hp) out.bar = { x: 816, y: 154, w: 430, h: 8, f: parseFloat(hp.style.width) / 100 };
      const line = [...sel.querySelectorAll('.line')].map(txt).find((l) => l.length < 90) ?? '';
      T(816, 190, 440, line, { size: 20, lines: 2, color: C.muted });
      let bx = 816, by = 222;
      for (const [i, b] of [...sel.querySelectorAll('.acts button')].entries()) {
        const label = words(b), w = Math.min(440, 26 + label.length * 12);
        if (bx + w > W - 20) { bx = 816; by += 50; }
        if (by > 280) break;
        B(`sel${i}`, bx, by, w, 44, label, () => b.click(), { size: 20, off: b.disabled });
        bx += w + 8;
      }
    }
    // bridge pieces, then the builds
    const row = (sel, y, label) => {
      T(28, y - 8, 300, label, { size: 20, color: C.muted, bold: true });
      return [...document.querySelectorAll(sel)];
    };
    let cx = 28;
    for (const [i, el] of row('#bar #hand > *', 342, 'BRIDGE PIECES').entries()) {
      if (el.matches('[data-act]')) {
        out.cards.push({ key: `piece${i}`, x: cx, y: 344, w: 100, h: 136, icon: el.querySelector('canvas'), keyLabel: txt(el.querySelector('.key')),
          label: txt(el.querySelector('span:last-child')), on: el.classList.contains('on'), act: () => el.click() });
      } else out.cards.push({ key: `piece${i}`, x: cx, y: 344, w: 100, h: 136, empty: true });
      cx += 108;
    }
    // what to do with the piece in hand, and with the table
    B('rotate', cx + 12, 350, 150, 58, 'Rotate', () => game.rotate());
    B('cancel', cx + 12, 418, 150, 58, 'Cancel', () => game.cancel(), { off: G.tool.kind === 'select' && G.selected === null });
    const where = xr.mode === 'ar' ? ['place', 'Move table', () => xr.startPlacing()] : xr.mode === 'vr' ? ['recenter', 'Recenter', () => xr.recenter()] : null;
    if (where) B(where[0], cx + 172, 350, 150, 58, where[1], where[2], { size: 22 });
    B('home', cx + 172, 418, 150, 58, 'Reset view', () => xr.resetView(), { size: 22 });
    const view = [['turnL', '◀ Turn', () => xr.turn(-1)], ['turnR', 'Turn ▶', () => xr.turn(1)],
      ['zoomOut', 'Zoom −', () => xr.zoomBy(1 / 1.25)], ['zoomIn', 'Zoom +', () => xr.zoomBy(1.25)]];
    view.forEach(([key, label, act], i) => B(key, cx + 332 + (i % 2) * 124, 350 + Math.floor(i / 2) * 68, 116, 58, label, act, { size: 22 }));
    cx = 28;
    const builds = [...row('#bar #units > *', 532, 'BUILD').map((el) => ['u', el]), ...row('#bar #priestBuilds > *', 532, '').map((el) => ['p', el])];
    T(28 + 108 * Math.max(1, builds.filter(([k]) => k === 'u').length) + 12, 524, 300, builds.some(([k]) => k === 'p') ? 'PRIEST BUILDS' : '', { size: 20, color: C.muted, bold: true });
    let gap = false;
    for (const [i, [k, el]] of builds.entries()) {
      if (k === 'p' && !gap) { cx += 12; gap = true; }
      if (cx + 100 > W - 20) break;
      if (!el.matches('[data-act]')) {
        out.cards.push({ key: `b${i}`, x: cx, y: 534, w: 100, h: 136, empty: true, label: txt(el).replace('hover for why', '') });
      } else {
        const fill = el.querySelector('[data-cool]');
        out.cards.push({ key: `b${i}`, x: cx, y: 534, w: 100, h: 136, icon: el.querySelector('canvas'), label: txt(el.querySelector('span')),
          cost: txt(el.querySelector('.cost')).replace(/[^\d]/g, ''), on: el.classList.contains('on'), dim: el.classList.contains('poor'),
          cool: fill ? Math.round(parseFloat(fill.style.width) / 5) * 5 : null, act: () => el.click() });
      }
      cx += 108;
    }
    T(28, 728, W - 56, xr.hint(), { size: 21, color: C.muted, lines: 2 });
    return out;
  }

  /** AR, before the battle has a place: where to put it. */
  placing() {
    const out = { texts: [], buttons: [], cards: [] };
    out.texts.push({ x: 60, y: 150, w: W - 120, text: 'Where should the battle be?', size: 52, bold: true, color: C.accent });
    out.texts.push({ x: 60, y: 240, w: W - 120, lines: 4, size: 32, color: C.text,
      text: 'Point at a table or the floor, and pull the trigger (or tap the screen) where the islands should float. You can move them again later with B or Y, or the panel’s Move table.' });
    out.buttons.push({ key: 'keep', x: W - 420, y: H - 130, w: 360, h: 76, label: 'Keep it here', size: 30, main: true, act: () => this.xr.stopPlacing() });
    out.buttons.push({ key: 'exit', x: 60, y: H - 130, w: 220, h: 76, label: 'Exit AR', size: 28, tone: 'bad', act: () => this.xr.exit() });
    return out;
  }

  /** A dialog: its title and words, a button for each of its choices and each setting it asks for. */
  dialog() {
    const box = $('modalBox'), out = { texts: [], buttons: [], cards: [] };
    out.texts.push({ x: 40, y: 72, w: W - 80, text: txt(box.querySelector('h2')), size: 44, bold: true, color: C.accent, lines: 1 });
    const sel = 'h3, p, li, div.text';
    const paras = [...box.querySelectorAll(sel)].filter((el) => !el.parentElement.closest(sel) && !el.closest('.form'))
      .map((el) => ({ text: (el.matches('li') ? '• ' : '') + txt(el), bold: el.matches('h3') })).filter((p) => p.text);
    const selects = [...box.querySelectorAll('select')];
    let y = 124, room = selects.length ? 7 : 13;
    for (const p of paras) {
      if (room <= 0) break;
      const lines = Math.min(room, p.bold ? 1 : 3);
      out.texts.push({ x: 40, y, w: W - 80, text: p.text, size: p.bold ? 28 : 25, bold: p.bold, lines, color: p.bold ? C.text : '#d6deea' });
      const used = this.measure(p.text, W - 80, p.bold ? 28 : 25, p.bold, lines);
      y += used * 34 + 8;
      room -= used;
    }
    // a skirmish's settings: each one a button that goes to its next choice
    if (selects.length) {
      y = Math.max(y + 6, 420);
      selects.forEach((s, i) => {
        const name = txt(s.closest('label')?.firstChild) || s.id, value = s.options[s.selectedIndex]?.text ?? '';
        const col = i % 3, rowN = Math.floor(i / 3);
        out.buttons.push({ key: `set${i}`, x: 40 + col * 404, y: y + rowN * 62, w: 392, h: 52, label: `${name}: ${value}`, size: 23,
          act: () => { s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change', { bubbles: true })); } });
      });
      const seed = box.querySelector('#skSeed');
      if (seed) out.texts.push({ x: 40, y: y + Math.ceil(selects.length / 3) * 62 + 30, w: 400, text: `Map ${seed.value}`, size: 23, color: C.muted });
    }
    const buttons = [...box.querySelectorAll('button')].filter((b) => !b.disabled && !b.closest('[hidden]'));
    const bw = Math.min(330, (W - 80 - (buttons.length - 1) * 14) / Math.max(1, buttons.length));
    buttons.forEach((b, i) => {
      out.buttons.push({ key: `dlg${i}`, x: W - 40 - (buttons.length - i) * (bw + 14) + 14, y: H - 96, w: bw, h: 64, label: words(b), size: 26,
        main: b.classList.contains('main'), act: () => b.click() });
    });
    return out;
  }

  /* ---------------------------------------- painting --------------------------------------- */
  font(size, bold) {
    return `${bold ? '600 ' : ''}${size}px ${FONT}`;
  }

  /** `text` broken into lines `w` wide, at most `max` of them, the last cut short with "…". */
  wrap(text, w, size, bold, max = 1) {
    const g = this.g;
    g.font = this.font(size, bold);
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= w || !line) { line = next; continue; }
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    }
    if (lines.length < max && line) lines.push(line);
    else if (line && lines.length === max) {
      let last = lines[max - 1];
      while (last && g.measureText(`${last}…`).width > w) last = last.slice(0, -1);
      lines[max - 1] = `${last}…`;
    }
    return lines;
  }

  measure(text, w, size, bold, max) {
    return this.wrap(text, w, size, bold, max).length;
  }

  round(x, y, w, h, r) {
    const g = this.g;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }

  paint(model) {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    this.round(4, 4, W - 8, H - 8, 34);
    g.fillStyle = C.bg;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = C.edge;
    g.stroke();
    this.items = [];
    for (const t of model.texts) {
      if (!t.text) continue;
      const size = t.size ?? 24, lines = this.wrap(t.text, t.w, size, t.bold, t.lines ?? 1);
      g.font = this.font(size, t.bold);
      g.fillStyle = t.color ?? C.text;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      lines.forEach((l, i) => g.fillText(l, t.x, t.y + i * Math.round(size * 1.3)));
    }
    if (model.bar) {
      const b = model.bar;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = b.f > 0.5 ? C.good : b.f > 0.25 ? C.accent : C.bad;
      g.fillRect(b.x, b.y, b.w * Math.max(0, Math.min(1, b.f)), b.h);
    }
    for (const b of model.buttons) this.button(b);
    for (const c of model.cards) this.card(c);
    this.tex.needsUpdate = true;
  }

  button(b) {
    const g = this.g, hot = this.hover === b.key, flash = this.flash === b.key;
    g.globalAlpha = b.off ? 0.4 : 1;
    this.round(b.x, b.y, b.w, b.h, 12);
    g.fillStyle = flash ? C.accent : b.main ? (hot ? '#ffd772' : C.accent) : b.on ? C.on : hot ? C.hover : C.button;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = b.on || hot ? C.accent : b.tone === 'bad' ? 'rgba(255,122,107,0.6)' : 'rgba(255,255,255,0.14)';
    g.stroke();
    g.fillStyle = b.main || flash ? '#1a1406' : b.tone === 'bad' ? C.bad : C.text;
    g.font = this.font(b.size ?? 24, true);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = this.wrap(b.label, b.w - 16, b.size ?? 24, true, 1)[0] ?? '';
    g.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    g.globalAlpha = 1;
    if (!b.off) this.items.push(b);
  }

  card(c) {
    const g = this.g, hot = this.hover === c.key && !c.empty, flash = this.flash === c.key;
    g.globalAlpha = c.empty ? 0.45 : c.dim ? 0.55 : 1;
    this.round(c.x, c.y, c.w, c.h, 12);
    g.fillStyle = flash ? C.accent : c.on ? C.on : hot ? C.hover : C.button;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = c.on || hot ? C.accent : 'rgba(255,255,255,0.14)';
    g.stroke();
    if (c.icon) {
      g.imageSmoothingEnabled = false;
      g.drawImage(c.icon, c.x + 4, c.y + 8, 92, 80);
    }
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = C.text;
    if (c.label) {
      const lines = this.wrap(c.label, c.w - 8, 18, true, c.icon ? 1 : 3);
      g.font = this.font(18, true);
      lines.forEach((l, i) => g.fillText(l, c.x + c.w / 2, c.y + (c.icon ? 108 : 40 + i * 22)));
    }
    if (c.cost) {
      g.font = this.font(18, false);
      g.fillStyle = C.accent;
      g.fillText(c.cost, c.x + c.w / 2, c.y + 128);
    }
    if (c.keyLabel) {
      g.font = this.font(16, true);
      g.fillStyle = C.muted;
      g.textAlign = 'left';
      g.fillText(c.keyLabel, c.x + 8, c.y + 22);
    }
    if (c.cool !== null && c.cool !== undefined && c.cool < 100) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(c.x + 4, c.y + c.h - 10, (c.w - 8), 6);
      g.fillStyle = C.accent;
      g.fillRect(c.x + 4, c.y + c.h - 10, (c.w - 8) * c.cool / 100, 6);
    }
    g.globalAlpha = 1;
    if (!c.empty) this.items.push(c);
  }
}
