/* test-lazy.js — lazy loading of the big data files (js/services.js loadData,
 * js/app.js openService). Boots the REAL index.html in jsdom, with jsdom's own
 * resource loader (every <script src> is fetched from disk through a logging
 * loader), so it proves what index.html loads at boot and what is loaded later:
 *   - the lazy files are NOT requested on boot (nor listed in index.html);
 *   - they ARE requested when a service that needs them opens;
 *   - loadData is idempotent (no second request, no second <script>);
 *   - a failed load shows the error state with "נסה שוב", and retry works.
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

// Every lazy file with the global it defines. `needs(win)` opens a service that depends on it.
const LAZY = [
  { file: 'slichot-data.js', glob: 'SIDURON_SLICHOT' },
];

async function bootPage(failing) {
  const requests = [];
  class Loader extends ResourceLoader {
    fetch(url, opts) {
      requests.push(path.basename(decodeURIComponent(url)));
      const base = path.basename(decodeURIComponent(url));
      if (failing && failing.has(base)) return Promise.reject(new Error('simulated failure: ' + base));
      return super.fetch(url, opts);
    }
  }
  const dom = new JSDOM(INDEX, { runScripts: 'dangerously', resources: new Loader(), url: INDEX_URL, virtualConsole: new VirtualConsole() });
  const win = dom.window, errs = [];
  win.addEventListener('error', e => errs.push(String(e.error && e.error.stack || e.message)));
  const ok = await until(() => win.SiduronApp && win.SiduronApp.state.service && win.document.querySelector('#content .prayer'), 60000);
  return { dom, win, doc: win.document, requests, errs, booted: ok };
}
const lazyTags = doc => Array.from(doc.querySelectorAll('script[data-lazy]'));
const scriptTags = doc => Array.from(doc.querySelectorAll('script[src]')).map(s => s.getAttribute('src'));
const content = doc => doc.getElementById('content').innerHTML;
// An Elul weekday in 5786 (day 3 of the slichot), shown in the Ashkenaz nusach.
function toSlichot(win) { win.SiduronApp.state.nusach = 'ashkenaz'; win.SiduronApp.setDate('2026-09-08'); }

(async function () {
  console.log('\n── index.html ──');
  LAZY.forEach(L => check('index.html has no <script> for ' + L.file, !new RegExp('data/' + L.file).test(INDEX)));

  console.log('\n── boot ──');
  const P = await bootPage();
  const { win, doc } = P;
  check('page booted and rendered a service', P.booted);
  LAZY.forEach(L => {
    check(L.file + ' was not requested on boot', P.requests.indexOf(L.file) < 0, P.requests.join(','));
    check(L.glob + ' is not defined on boot', win[L.glob] === undefined);
  });
  check('eager data was loaded from the script tags', P.requests.indexOf('services-data.js') >= 0 && P.requests.indexOf('siddur-data.js') >= 0);
  check('no <script data-lazy> on boot', lazyTags(doc).length === 0);
  check('no load errors on boot', P.errs.length === 0, P.errs.join(' | '));

  console.log('\n── slichot ──');
  toSlichot(win);
  check('the slichot tab is offered before the data is loaded', !!doc.getElementById('tab-slichot'));
  check('showing the tab alone does not load the file', P.requests.indexOf('slichot-data.js') < 0 && win.SIDURON_SLICHOT === undefined);
  doc.getElementById('tab-slichot').onclick();
  check('opening the tab shows the loading state at first', /state-loading/.test(content(doc)));
  check('…and requests slichot-data.js', P.requests.filter(r => r === 'slichot-data.js').length === 1, P.requests.join(','));
  check('slichot rendered once the file arrived', await until(() => /class="prayer/.test(content(doc))));
  check('SIDURON_SLICHOT defined', !!win.SIDURON_SLICHOT && !!win.SIDURON_SLICHOT.ashkenaz);
  check('exactly one lazy <script> tag', lazyTags(doc).length === 1 && lazyTags(doc)[0].getAttribute('src') === 'data/slichot-data.js');
  check('the slichot title is shown', /סליחות/.test(doc.getElementById('hdr-title').textContent));
  check('the slichot text is real (not empty)', content(doc).length > 5000, String(content(doc).length));

  // Idempotence: other service and back, direct loadData calls.
  doc.getElementById('tab-shacharit').onclick();
  await wait(50);
  doc.getElementById('tab-slichot').onclick();
  check('re-opening slichot renders at once (no loading state)', /class="prayer/.test(content(doc)) && !/state-loading/.test(content(doc)));
  const S = win.SiduronServices;
  const p1 = S.loadData('slichot'), p2 = S.loadData('slichot');
  await Promise.all([p1, p2]);
  check('loadData is idempotent: still one request', P.requests.filter(r => r === 'slichot-data.js').length === 1);
  check('loadData is idempotent: still one <script>', scriptTags(doc).filter(s => /slichot-data/.test(s)).length === 1);
  check('loadData of an unknown key rejects', await S.loadData('nope').then(() => false, () => true));
  check('no runtime errors', P.errs.length === 0, P.errs.join(' | '));
  win.close();

  console.log('\n── failure + retry ──');
  const failing = new Set(['slichot-data.js']);
  const F = await bootPage(failing);
  check('failing page booted (the failure is only for the lazy file)', F.booted);
  toSlichot(F.win);
  F.doc.getElementById('tab-slichot').onclick();
  check('a failed load shows the error state', await until(() => /state-error/.test(content(F.doc))));
  check('…with the retry button', !!F.doc.querySelector('#content [data-retry]') && /נסה שוב/.test(content(F.doc)));
  check('…and no data was defined', F.win.SIDURON_SLICHOT === undefined);
  check('…and the failed <script> tag was removed', lazyTags(F.doc).length === 0);
  failing.delete('slichot-data.js');
  F.doc.querySelector('#content [data-retry]').onclick();
  check('retry loads the file and renders', await until(() => /class="prayer/.test(content(F.doc))));
  check('retry made a second request, and one <script> remains', F.requests.filter(r => r === 'slichot-data.js').length === 2 && lazyTags(F.doc).length === 1);
  F.win.close();

  console.log('\n=== LAZY: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
