/*
 * The app is plain browser scripts that share globals (no modules), so unit tests
 * evaluate the needed files together in one function scope and pick out the names
 * they test. Same realm as the test, so results compare normally with assert.
 */
import { readFileSync } from 'node:fs';

// Hours, days and months are bucketed in local time: pin it so results don't depend on the machine.
process.env.TZ = 'UTC';

/**
 * The scripts index.html loads, in its order. app.js is left out: it is the one script
 * that does something as it loads (it waits for the page to start the app).
 */
export const APP_SCRIPTS = [...readFileSync(new URL('../../index.html', import.meta.url), 'utf8').matchAll(/<script src="js\/([^"]+)"/g)]
  .map((m) => m[1])
  .filter((f) => f !== 'app.js');

/**
 * Evaluates every app script in index.html's order and returns the requested top-level
 * names, so a test needn't know which file needs which. `globals` supplies anything the
 * scripts read from the page when called (S, $…).
 */
export function loadApp(names, globals = {}) {
  return loadScripts(APP_SCRIPTS, names, globals);
}

/**
 * Evaluates js/<file> for each of `files` (in order) and returns the requested
 * top-level names. `globals` supplies anything the scripts read from the page (S, $…).
 */
export function loadScripts(files, names, globals = {}) {
  const src = files.map((f) => readFileSync(new URL(`../../js/${f}`, import.meta.url), 'utf8')).join('\n;\n');
  const fn = new Function(...Object.keys(globals), `${src}\nreturn { ${names.join(', ')} };`);
  return fn(...Object.values(globals));
}

/** messageLib() from parser.js, without VADER (mood scores are skipped). */
export function messageLib() {
  return loadScripts(['parser.js'], ['messageLib']).messageLib(null);
}

/**
 * A message record as the parsers produce it: text analyzed and time stamped.
 * `at` is an ISO date-time (tests run with TZ=UTC).
 */
export function makeMessage(lib, { at, o = 0, k = 'alex', body = '', ...rest }) {
  const m = { t: Date.parse(at), o, k, m: 0, s: 0, ph: 0, gf: 0, vd: 0, au: 0, ot: 0, mb: 0, ...rest };
  lib.analyzeText(body, m);
  lib.stampTime(m);
  return m;
}
