/**
 * The build: dist/index.html, one self-contained page (A-Frame comes from its CDN).
 *
 *   node scripts/build.mjs           build once
 *   node scripts/build.mjs --watch   rebuild on change and serve dist/ at http://localhost:8080
 *   node scripts/build.mjs --check   build the data, then play the mission headless (scripts/check.js)
 *
 * netstorm-web's TypeScript is bundled straight from the submodule; its client's compiled
 * paraglide messages are replaced by src/messages.js.
 */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const VENDOR = resolve('vendor/netstorm-web');
const args = new Set(process.argv.slice(2));

if (!existsSync(`${VENDOR}/packages/sim/src/index.ts`)) {
  console.error('vendor/netstorm-web is empty: run `git submodule update --init` first.');
  process.exit(1);
}

const common = {
  bundle: true,
  target: 'es2022',
  logLevel: 'warning',
  legalComments: 'none',
  alias: {
    '@netstorm/sim': `${VENDOR}/packages/sim/src/index.ts`,
    'ns-client': `${VENDOR}/packages/client/src`,
    'ns-messages': `${VENDOR}/packages/client/messages`,
  },
  plugins: [{
    name: 'messages',
    setup(b) {
      b.onResolve({ filter: /paraglide\/messages\.js$/ }, () => ({ path: resolve('src/messages.js') }));
    },
  }],
};

/** Run a script that imports netstorm-web's TypeScript, bundled for Node first. */
async function runNode(entry) {
  const out = resolve(`build/${entry.replace(/^.*\//, '').replace(/\.js$/, '.mjs')}`);
  await esbuild.build({ ...common, entryPoints: [entry], outfile: out, platform: 'node', format: 'esm' });
  await import(`${pathToFileURL(out).href}?${Date.now()}`);
}

mkdirSync('build', { recursive: true });
mkdirSync('dist', { recursive: true });
await runNode('scripts/make-data.js');

if (args.has('--check')) {
  await runNode('scripts/check.js');
  process.exit(0);
}

const minify = !args.has('--watch');
const app = { ...common, entryPoints: ['src/main.js'], outfile: 'build/app.js', format: 'iife', platform: 'browser', minify };
const worker = { ...common, entryPoints: ['src/ai-worker.js'], outfile: 'build/ai-worker.js', format: 'iife', platform: 'browser', minify };

/** Put the stylesheet, the app and the worker's source into the page. */
function assemble() {
  // nothing in an inline script may close it early
  const safe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const html = readFileSync('index.html', 'utf8')
    .replace('<!--INLINE:style-->', () => `<style>\n${readFileSync('src/style.css', 'utf8')}</style>`)
    .replace('<!--INLINE:app-->', () => `<script>${safe(readFileSync('build/app.js', 'utf8'))}</script>`)
    .replace('<!--INLINE:ai-->', () => `<script id="ns-ai" type="text/plain">${safe(readFileSync('build/ai-worker.js', 'utf8'))}</script>`);
  writeFileSync('dist/index.html', html);
  console.log(`dist/index.html: ${(html.length / 1024).toFixed(0)} KB`);
}

if (args.has('--watch')) {
  const onEnd = { name: 'assemble', setup(b) { b.onEnd((r) => { if (!r.errors.length) assemble(); }); } };
  const workerCtx = await esbuild.context(worker);
  await workerCtx.rebuild();
  await workerCtx.watch();
  const appCtx = await esbuild.context({ ...app, plugins: [...common.plugins, onEnd] });
  await appCtx.watch();
  for (const file of ['index.html', 'src/style.css']) watch(file, () => assemble());
  const port = Number(process.env.PORT) || 8080;
  createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path !== '/' && path !== '/index.html') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(readFileSync('dist/index.html'));
  }).listen(port, () => console.log(`serving http://localhost:${port}; the page is rebuilt when a file changes (reload to see it)`));
} else {
  await Promise.all([esbuild.build(app), esbuild.build(worker)]);
  assemble();
}
