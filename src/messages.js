/**
 * The interface strings of netstorm-web in English. Its client compiles them with paraglide; this
 * stands in for the compiled module (`m.key({ name })`), reading messages/en.json directly. The
 * build points netstorm-web's own `./paraglide/messages.js` imports here too.
 */
import en from 'ns-messages/en.json';

const table = /** @type {Record<string, string>} */ (en);

export const m = new Proxy({}, {
  get: (_, key) => (args = {}) =>
    (table[String(key)] ?? String(key)).replace(/\{(\w+)\}/g, (_m, name) => String(args[name] ?? '')),
});
