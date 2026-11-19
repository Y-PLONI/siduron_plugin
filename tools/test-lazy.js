/* test-lazy.js — lazy loading of the big data files (js/services.js loadData,
 * js/app.js openService). Boots the REAL index.html in jsdom, with jsdom's own
 * resource loader (every <script src> is fetched from disk through a logging
 * loader), so it proves what index.html loads at boot and what is loaded later:
 *   - the lazy files are NOT requested on boot (nor listed in index.html), and
 *     not when only unrelated services / days are shown;
 *   - they ARE requested when a service that needs them opens;
 *   - loadData is idempotent (no second request, no second <script>);
 *   - a failed load shows the error state with "נסה שוב", and retry works.
 * The clock is frozen on a weekday (Wed 22 Jul 2026) so the boot never needs Shabbat data.
 * Run: node tools/test-lazy.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM, ResourceLoader, VirtualConsole } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));

let pass = 0, fail = 0;
function check(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' ' + (extra || ''))); }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { if (fn()) return true; await wait(25); } return false; }

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const CLOCK = `var __RealDate = Date, __NOW = new Date(2026, 6, 22, 14, 0, 0);
  Date = class extends __RealDate { constructor(...a) { if (a.length) super(...a); else super(__NOW.getTime()); } static now() { return __NOW.getTime(); } };`;

async function bootPage(failing) {
  const requests = [];
  class Loader extends ResourceLoader {
    fetch(url, opts) {
      const base = path.basename(decodeURIComponent(url));
      requests.push(base);
      if (failing && failing.has(base)) return Promise.reject(new Error('simulated failure: ' + base));
      return super.fetch(url, opts);
    }
  }
  const dom = new JSDOM(INDEX, {
    runScripts: 'dangerously', resources: new Loader(), url: INDEX_URL, virtualConsole: new VirtualConsole(),
    beforeParse(w) { w.eval(CLOCK); },
  });
  const win = dom.window, errs = [];
  win.addEventListener('error', e => errs.push(String(e.error && e.error.stack || e.message)));
  const ok = await until(() => win.SiduronApp && win.SiduronApp.state.service && win.document.querySelector('#content .prayer'), 60000);
  return { dom, win, doc: win.document, requests, errs, booted: ok };
}
const lazyTags = doc => Array.from(doc.querySelectorAll('script[data-lazy]'));
const scriptTags = doc => Array.from(doc.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
const content = doc => doc.getElementById('content').innerHTML;
const count = (P, f) => P.requests.filter(r => r === f).length;

// Each scenario: how to get a service that needs the lazy file open, what it defines.
const SCENARIOS = [
  {
    name: 'סליחות', file: 'slichot-data.js', globs: ['SIDURON_SLICHOT'],
    // An Elul weekday in 5786 (day 3 of the slichot), Ashkenaz: the slichot tab is offered.
    prepare(win) { win.SiduronApp.state.nusach = 'ashkenaz'; win.SiduronApp.setDate('2026-09-08'); },
    open(win, doc) { doc.getElementById('tab-slichot').onclick(); },
    title: /סליחות/,
  },
  {
    name: 'שבת', file: 'shabbat-data.js', globs: ['SIDURON_SHABBAT', 'SIDURON_YOMTOV'],
    // setDate re-renders the open service (a weekday one) on a Saturday: that is what needs the data.
    prepare(win) { win.SiduronApp.state.service = 'shacharit'; },
    open(win, doc) { win.SiduronApp.setDate('2026-11-21'); },
    flag: 'shabbat',
  },
  {
    name: 'יום טוב (פסח, יום חול)', file: 'shabbat-data.js', globs: ['SIDURON_SHABBAT', 'SIDURON_YOMTOV'],
    prepare(win) { win.SiduronApp.state.service = 'shacharit'; },
    open(win, doc) { win.SiduronApp.setDate('2026-04-02'); },
    flag: 'pesach',
  },
];

(async function () {
  console.log('\n── index.html ──');
  SCENARIOS.forEach(sc => check('index.html has no <script> for ' + sc.file, !new RegExp('data/' + sc.file).test(INDEX)));

  console.log('\n── boot (weekday) ──');
  const B = await bootPage();
  check('page booted and rendered a service', B.booted);
  SCENARIOS.forEach(sc => {
    check(sc.file + ' was not requested on boot', B.requests.indexOf(sc.file) < 0, B.requests.join(','));
    sc.globs.forEach(g => check(g + ' is not defined on boot', B.win[g] === undefined));
  });
  check('eager data was loaded from the script tags', B.requests.indexOf('services-data.js') >= 0 && B.requests.indexOf('siddur-data.js') >= 0);
  check('no <script data-lazy> on boot', lazyTags(B.doc).length === 0);
  // Browsing other weekdays, services and nuschaot never needs the lazy files.
  ['2026-07-20', '2026-07-23', '2026-05-17', '2026-12-14'].forEach(d => B.win.SiduronApp.setDate(d));
  ['edot_mizrach', 'sfard', 'ashkenaz'].forEach(n => {
    B.win.SiduronApp.state.nusach = n;
    ['shacharit', 'mincha', 'maariv'].forEach(s => { B.win.SiduronApp.state.service = s; B.win.SiduronApp.setDate('2026-07-21'); });
  });
  check('weekday browsing (3 services x 3 nuschaot) requests no lazy file', B.requests.indexOf('shabbat-data.js') < 0 && B.requests.indexOf('slichot-data.js') < 0, B.requests.join(','));
  check('no load errors on boot', B.errs.length === 0, B.errs.join(' | '));
  B.win.close();

  for (const sc of SCENARIOS) {
    console.log('\n── ' + sc.name + ' ──');
    const P = await bootPage(), { win, doc } = P;
    check('booted', P.booted);
    sc.prepare(win);
    check('preparing the view does not load ' + sc.file, count(P, sc.file) === 0 && win[sc.globs[0]] === undefined);
    if (sc.name === 'סליחות') check('the slichot tab is offered before the data is loaded', !!doc.getElementById('tab-slichot'));
    sc.open(win, doc);
    if (sc.flag) check('the day has the flag ' + sc.flag, win.SiduronApp.state.dayFlags.flags.indexOf(sc.flag) >= 0);
    check('opening the service shows the loading state at first', /state-loading/.test(content(doc)));
    check('…and requests ' + sc.file + ' exactly once', count(P, sc.file) === 1, P.requests.join(','));
    check('the service rendered once the file arrived', await until(() => /class="prayer/.test(content(doc))));
    sc.globs.forEach(g => check(g + ' defined', !!win[g]));
    check('exactly one lazy <script> tag', lazyTags(doc).length === 1 && lazyTags(doc)[0].getAttribute('src') === 'data/' + sc.file);
    check('the rendered text is real (not empty)', content(doc).length > 5000, String(content(doc).length));
    if (sc.title) check('the title is the service', sc.title.test(doc.getElementById('hdr-title').textContent));
    if (sc.flag) check('the lazy data is what was rendered (the service is in it)',
      win.SiduronServices.hasShabbat('edot_mizrach', 'shacharit') && win.SiduronServices.hasYomtov('edot_mizrach', 'shacharit'));

    // Idempotence: another service and back, repeated loadData calls.
    const other = sc.name === 'סליחות' ? 'tab-shacharit' : 'tab-mincha';
    doc.getElementById(other).onclick();
    await until(() => /class="prayer/.test(content(doc)));
    const S = win.SiduronServices;
    const key = sc.file.replace('-data.js', '');
    const p1 = S.loadData(key), p2 = S.loadData(key);
    check('loadData returns the same cached promise', p1 === p2 || (S.dataLoaded(key) && !!p1 && !!p2));
    await Promise.all([p1, p2]);
    check('loadData is idempotent: still one request', count(P, sc.file) === 1);
    check('loadData is idempotent: still one <script>', scriptTags(doc).filter(s => s.indexOf(sc.file) >= 0).length === 1);
    check('dataLoaded reports it', S.dataLoaded(key) === true);
    if (sc.name === 'סליחות') {
      doc.getElementById('tab-slichot').onclick();
      check('re-opening slichot renders at once (no loading state)', /class="prayer/.test(content(doc)) && !/state-loading/.test(content(doc)));
    }
    check('loadData of an unknown key rejects', await S.loadData('nope').then(() => false, () => true));
    check('no runtime errors', P.errs.length === 0, P.errs.join(' | '));
    win.close();

    console.log('── ' + sc.name + ': failure + retry ──');
    const failing = new Set([sc.file]);
    const F = await bootPage(failing);
    check('failing page booted (the failure is only for the lazy file)', F.booted);
    sc.prepare(F.win);
    sc.open(F.win, F.doc);
    check('a failed load shows the error state', await until(() => /state-error/.test(content(F.doc))));
    check('…with the retry button', !!F.doc.querySelector('#content [data-retry]') && /נסה שוב/.test(content(F.doc)));
    check('…and no data was defined', F.win[sc.globs[0]] === undefined);
    check('…and the failed <script> tag was removed', lazyTags(F.doc).length === 0);
    check('…and no stale loading spinner remains', !/state-loading/.test(content(F.doc)));
    failing.delete(sc.file);
    F.doc.querySelector('#content [data-retry]').onclick();
    check('retry loads the file and renders', await until(() => /class="prayer/.test(content(F.doc))));
    check('retry made a second request, and one <script> remains', count(F, sc.file) === 2 && lazyTags(F.doc).length === 1);
    F.win.close();
  }

  // Two callers asking at once share one load.
  console.log('\n── concurrent loadData ──');
  {
    const P = await bootPage(), S = P.win.SiduronServices;
    const q1 = S.loadData('shabbat'), q2 = S.loadData('shabbat');
    check('concurrent calls share one cached promise', q1 === q2);
    await q1;
    check('…one request and one <script>', count(P, 'shabbat-data.js') === 1 && lazyTags(P.doc).length === 1);
    P.win.close();
  }

  // The user moves on while the file is loading: the late arrival must not repaint the old service.
  console.log('\n── moving on during a load ──');
  {
    const P = await bootPage(), { win, doc } = P;
    win.SiduronApp.state.service = 'shacharit';
    win.SiduronApp.setDate('2026-11-21');               // Shabbat → starts loading
    check('loading started', /state-loading/.test(content(doc)) && count(P, 'shabbat-data.js') === 1);
    doc.getElementById('tab-mincha').onclick();         // also Shabbat → waits for the same file
    check('only the open service is rendered (mincha)', await until(() => /class="prayer/.test(content(doc))) && win.SiduronApp.state.service === 'mincha');
    check('still a single request', count(P, 'shabbat-data.js') === 1);
    win.close();
  }

  console.log('\n=== LAZY: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
