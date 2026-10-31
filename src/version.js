/**
 * The build this page is, and a notice when a newer one has been published: GitHub Pages lets
 * browsers keep a page for up to ten minutes, so a fix can be live while an old copy still plays.
 * The build writes version.json beside the page; the page asks for it (uncached) now and then.
 */
export const BUILD = window.NS3D_BUILD ?? { version: 'dev', commit: '', date: '' };

export function describeBuild() {
  return `${BUILD.version}${BUILD.date ? ` of ${BUILD.date.slice(0, 10)}` : ''}`;
}

export function watchForUpdates(onNewer) {
  if (BUILD.version === 'dev' || !/^https?:$/.test(location.protocol)) return;
  let told = false;
  const check = async () => {
    if (told || document.hidden) return;
    try {
      const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const { version } = await r.json();
      if (version && version !== BUILD.version) {
        told = true;
        onNewer(version);
      }
    } catch { /* offline, or no version.json: nothing to say */ }
  };
  check();
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', check);
}

/** Load the newer build: a new address, so that no cached copy can answer. */
export function loadNewer(version) {
  location.replace(`${location.pathname}?v=${encodeURIComponent(version)}`);
}
