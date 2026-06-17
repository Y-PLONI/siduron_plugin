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
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js', 'js/extras.js', 'js/app.js']) {
  const s = doc.createElement('script'); s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
  doc.body.appendChild(s);
}

let pass = 0, fail = 0;
function check(name, cond) { (cond ? (pass++) : (fail++, 0)); console.log((cond ? '  ✓ ' : '  ✗ ') + name); }
function click(id) { const el = doc.getElementById(id); if (el && el.onclick) el.onclick.call(el); }
function content() { return doc.getElementById('content').innerHTML; }

setTimeout(async function () {
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
  doc.querySelector('#set-nusach [data-val="ashkenaz"]').onclick.call(doc.querySelector('#set-nusach [data-val="ashkenaz"]'));
  check('nusach→ashkenaz rerendered', win.SiduronApp.state.nusach === 'ashkenaz' && content().length > 5000);
  doc.querySelector('#set-nusach [data-val="edot_mizrach"]').onclick.call(doc.querySelector('#set-nusach [data-val="edot_mizrach"]'));

  // Location (from Otzaria's selected city) on CHM Pesach (affects tefillin).
  win.SiduronApp.setDate('2026-04-05'); // CHM Pesach
  check('israel default on (no city)', win.SiduronApp.state.isInIsrael === true);
  win.SiduronApp.setCity('בני ברק');
  check('israeli city → inIsrael true', win.SiduronApp.state.isInIsrael === true && win.SiduronApp.state.country === 'ארץ ישראל');
  win.SiduronApp.setCity('ניו יורק');
  check('diaspora city → inIsrael false', win.SiduronApp.state.isInIsrael === false && win.SiduronApp.state.country === 'ארצות הברית');
  win.SiduronApp.setCity('ירושלים'); // restore Israel for the rest of the run

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

  // Extras (תוספות) tab → menu → open an extra → back.
  const tabs2 = doc.querySelectorAll('#tabs .tab');
  let extrasTab = null; tabs2.forEach(t => { if (t.textContent === 'תוספות') extrasTab = t; });
  check('extras tab present', !!extrasTab);
  if (extrasTab) {
    extrasTab.onclick.call(extrasTab);
    const cards = doc.querySelectorAll('#content [data-extra]');
    check('extras menu shows items', cards.length >= 8);
    const bm = doc.querySelector('#content [data-extra="birkat_hamazon"]');
    if (bm) {
      bm.onclick.call(bm);
      check('birkat hamazon renders in extras view', content().length > 3000 && /יהוה|הַזָּ|בְרִיךְ/.test(content()));
      const back = doc.getElementById('extras-back');
      check('back-to-list button present', !!back);
      if (back) { back.onclick.call(back); check('back returns to menu', !!doc.querySelector('#content [data-extra]')); }
    }
  }

  // Font family picker + width picker + scroll-collapse.
  win.SiduronApp.setDate('2026-06-18');
  click('btn-settings');
  const fontSel = doc.getElementById('set-font');
  check('font picker present', !!fontSel && fontSel.tagName === 'SELECT' && fontSel.options.length === 5);
  if (fontSel) {
    fontSel.value = 'David'; fontSel.onchange.call(fontSel);
    check('font → David applied', /David/.test(doc.documentElement.style.getPropertyValue('--prayer-font')) && win.SiduronApp.state.fontFamily === 'David');
    fontSel.value = ''; fontSel.onchange.call(fontSel);
    check('font → default reverts', win.SiduronApp.state.fontFamily === '');
  }
  const fullPill = doc.querySelector('#set-width [data-val="full"]');
  check('width picker present', !!fullPill);
  if (fullPill) {
    fullPill.onclick.call(fullPill);
    check('width → full applied', doc.documentElement.style.getPropertyValue('--content-width') === '100%');
  }
  const scEl = doc.getElementById('reader-scroll');
  Object.defineProperty(scEl, 'scrollTop', { value: 120, configurable: true });
  scEl.dispatchEvent(new win.Event('scroll'));
  check('header collapses on scroll', doc.body.classList.contains('scrolled') && doc.getElementById('hdr-svc').textContent.length > 0);

  // Desktop shortcut (shortcut.create) — gated to desktop platforms.
  check('shortcut card hidden off-desktop', doc.getElementById('card-shortcut').hidden === true);
  const sdkCalls = [];
  win.Otzaria = {
    call: (m, p) => { sdkCalls.push([m, p]); return Promise.resolve({ success: true, data: m === 'shortcut.create' ? { created: true, path: '~/Desktop/סידורון.webloc' } : null }); },
    on() {}, off() {},
  };
  win.SiduronApp.state.platform = 'macos';
  click('btn-settings'); // rebuilds settings → reveals the card + wires the button
  check('shortcut card visible on desktop', doc.getElementById('card-shortcut').hidden === false);
  const sBtn = doc.getElementById('set-shortcut');
  check('shortcut button present', !!sBtn);
  if (sBtn) {
    sBtn.onclick.call(sBtn);
    await new Promise(r => setTimeout(r, 10));
    check('shortcut.create called with label+location',
      sdkCalls.some(c => c[0] === 'shortcut.create' && c[1] && c[1].label === 'סידורון' && c[1].location === 'desktop'));
    check('success toast on created', sdkCalls.some(c => c[0] === 'ui.showSuccess'));
  }

  check('no runtime errors', errors.length === 0);
  console.log(`\n=== INTERACTIONS: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed) ===`);
  process.exit(fail === 0 ? 0 : 1);
}, 400);
