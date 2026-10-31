/**
 * Errors do not freeze the game. three.js stops its render loop when a frame throws, so every
 * component's and system's tick is wrapped: an error is reported once and the frame goes on. What
 * escapes anyway (events, promises) is reported too. The report is a small panel with the message,
 * a button to copy the details and one to reload.
 *
 * Imported first by main.js, so that it wraps every component registered after it.
 */
const seen = new Map();

function guard(def, name) {
  for (const key of ['tick', 'tock']) {
    const f = def[key];
    if (typeof f !== 'function') continue;
    def[key] = function guarded(...args) {
      try {
        return f.apply(this, args);
      } catch (error) {
        report(error, `${name}.${key}`);
        return undefined;
      }
    };
  }
  return def;
}

const registerComponent = AFRAME.registerComponent;
AFRAME.registerComponent = (name, def) => registerComponent.call(AFRAME, name, guard(def, name));
const registerSystem = AFRAME.registerSystem;
AFRAME.registerSystem = (name, def) => registerSystem.call(AFRAME, name, guard(def, name));

window.addEventListener('error', (e) => report(e.error ?? e.message, 'page'));
window.addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));

/** Show an error once per message (counting repeats) and keep the game running. */
export function report(error, where = '') {
  const message = String(error?.message ?? error);
  const entry = seen.get(message);
  if (entry) {
    entry.count++;
    entry.el.querySelector('.count').textContent = `×${entry.count}`;
    return;
  }
  console.error(`[netstorm-3d] ${where}:`, error);
  const box = document.getElementById('errors') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'errors' }));
  const el = document.createElement('div');
  el.className = 'error panel';
  const stack = String(error?.stack ?? message);
  const build = window.NS3D_BUILD?.version ?? 'dev';
  el.innerHTML = `<b>Something went wrong</b> <span class="count"></span>
    <p>The game keeps running. If it misbehaves, reload the page.</p><code></code>
    <div class="acts"><button data-a="copy">Copy details</button><button data-a="reload">Reload</button><button data-a="close">Dismiss</button></div>`;
  el.querySelector('code').textContent = message;
  el.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'copy') navigator.clipboard?.writeText(`netstorm-3d ${build}, ${where}\n${stack}`).catch(() => {});
    if (a === 'reload') location.reload();
    if (a === 'close') { el.remove(); seen.delete(message); }
  });
  box.appendChild(el);
  seen.set(message, { el, count: 1 });
  window.NS3D_ERRORS = [...(window.NS3D_ERRORS ?? []), message];
}
