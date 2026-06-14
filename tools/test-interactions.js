/* test-interactions.js — drives the live UI in jsdom: settings toggles, nusach
 * switch, censor, jump-to-section. Verifies button wiring + reactive rerender.
 * Run: node tools/test-interactions.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
const win = dom.window, doc = win.document;
const errors = [];
win.addEventListener('error', e => errors.push(e.error && e.error.stack || e.message));
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js', 'js/app.js']) {
  const s = doc.createElement('script'); s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
  doc.body.appendChild(s);
}

let pass = 0, fail = 0;
function check(name, cond) { (cond ? (pass++) : (fail++, 0)); console.log((cond ? '  ✓ ' : '  ✗ ') + name); }
function click(id) { const el = doc.getElementById(id); if (el && el.onclick) el.onclick.call(el); }
function content() { return doc.getElementById('content').innerHTML; }

setTimeout(function () {
  console.log('load errors:', errors.length); errors.forEach(e => console.log('   ', e));

  // Use a Mon/Thu CHM-relevant date with full divine names present.
  win.SiduronApp.setDate('2026-05-17'); // RC Sivan + omer
  check('booted with content', content().length > 5000);
  check('RC badge shown', /ראש חודש/.test(doc.getElementById('hdr-badges').innerHTML));
  check('omer tab present', /ספירת העומר/.test(doc.getElementById('tabs').textContent));

  // Settings: open + censor toggle
  click('btn-settings');
  check('settings panel opened', doc.getElementById('panel-settings').classList.contains('open'));
  const fullBefore = /יְהֹוָה|יהוה/.test(content());
  click('set-censor');
  const censored = content();
  check('censor: ה׳ appears', /ה׳/.test(censored));
  check('censor: full tetragrammaton removed', !/יְהֹוָה/.test(censored) && fullBefore);
  click('set-censor'); // toggle back

  // Close via the ✕ button, then via backdrop.
  doc.querySelector('#panel-settings [data-close]').onclick.call(doc.querySelector('#panel-settings [data-close]'));
  check('settings panel closed via ✕', !doc.getElementById('panel-settings').classList.contains('open'));
  click('btn-zmanim');
  const bd = doc.getElementById('backdrop'); if (bd && bd.onclick) bd.onclick.call(bd);
  check('zmanim panel closed via backdrop', !doc.getElementById('panel-zmanim').classList.contains('open'));

  // Nusach switch
  const emText = content().length;
  doc.querySelector('[data-nusach="ashkenaz"]').onclick.call(doc.querySelector('[data-nusach="ashkenaz"]'));
  check('nusach→ashkenaz rerendered', win.SiduronApp.state.nusach === 'ashkenaz' && content().length > 5000);
  doc.querySelector('[data-nusach="edot_mizrach"]').onclick.call(doc.querySelector('[data-nusach="edot_mizrach"]'));

  // Israel toggle on CHM Pesach (affects tefillin) — set date first
  win.SiduronApp.setDate('2026-04-05'); // CHM Pesach
  const ilOn = win.SiduronApp.state.isInIsrael;
  check('israel default on', ilOn === true);
  click('set-israel');
  check('israel toggled off', win.SiduronApp.state.isInIsrael === false);
  click('set-israel');

  // Jump-to-section
  win.SiduronApp.setDate('2026-05-17');
  click('btn-nav');
  const navItems = doc.querySelectorAll('#nav-body .nav-item');
  check('nav has sections', navItems.length > 10);
  if (navItems.length) { navItems[3].onclick.call(navItems[3]); check('nav click no error', true); }

  // Service tab switch
  const tabs = doc.querySelectorAll('#tabs .tab');
  let mincha = null; tabs.forEach(t => { if (t.textContent === 'מנחה') mincha = t; });
  if (mincha) { mincha.onclick.call(mincha); check('switched to Mincha', win.SiduronApp.state.service === 'mincha'); }

  check('no runtime errors', errors.length === 0);
  console.log(`\n=== INTERACTIONS: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed) ===`);
  process.exit(fail === 0 ? 0 : 1);
}, 400);
