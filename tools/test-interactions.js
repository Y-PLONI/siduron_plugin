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

  // Settings: open + divine-name styles (ה׳ / יְיָ / יְדֹוָד / as written)
  click('btn-settings');
  check('settings panel opened', doc.getElementById('panel-settings').classList.contains('open'));
  function pickDivine(v) {
    const b = doc.querySelector('#set-divine [data-val="' + v + '"]');
    if (b) b.onclick.call(b);
    return content();
  }
  check('divine-name control rendered', doc.querySelectorAll('#set-divine [data-val]').length === 4);
  const asWritten = pickDivine('source');
  check('divine name: source keeps the full Name', /יְהֹוָה/.test(asWritten));
  const hashem = pickDivine('hashem');
  check('divine name: ה׳ replaces the Name', /ה׳/.test(hashem) && !/יְהֹוָה/.test(hashem));
  const twoYods = pickDivine('yy');
  check('divine name: two yods, vocalised', /יְיָ/.test(twoYods) && !/יְהֹוָה/.test(twoYods));
  const yedovid = pickDivine('yedovid');
  check('divine name: ידוד, vocalised', /יְדֹוָד/.test(yedovid) && !/יְהֹוָה/.test(yedovid));
  pickDivine('yy');

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
      check('back button: inline SVG chevron, no ‹ glyph, name kept', !!back && !!back.querySelector('svg[aria-hidden="true"]') && !/[‹›]/.test(back.textContent) && /חזרה לרשימת התוספות/.test(back.textContent));
      if (back) { back.onclick.call(back); check('back returns to menu', !!doc.querySelector('#content [data-extra]')); }
    }
  }

  // Font family picker + width picker + scroll-collapse.
  win.SiduronApp.setDate('2026-06-18');
  click('btn-settings');
  const fontSel = doc.getElementById('set-font');
  check('font picker present', !!fontSel && fontSel.tagName === 'SELECT' && fontSel.options.length === 7);
  if (fontSel) {
    fontSel.value = 'KeterYG'; fontSel.onchange.call(fontSel);
    check('font → KeterYG applied', /KeterYG/.test(doc.documentElement.style.getPropertyValue('--font-main')) && win.SiduronApp.state.fontFamily === 'KeterYG');
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

  // Panels are modal dialogs: labelled, focus moves in, Tab is trapped, focus returns on close.
  ['panel-nav', 'panel-zmanim', 'panel-settings'].forEach(id => {
    const pn = doc.getElementById(id);
    check(id + ': role=dialog, aria-modal, labelled by its title',
      pn.getAttribute('role') === 'dialog' && pn.getAttribute('aria-modal') === 'true' &&
      !!doc.getElementById(pn.getAttribute('aria-labelledby')) && !pn.hasAttribute('aria-label'));
  });
  function key(k, opts) {
    const ev = new win.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
    (doc.activeElement || doc).dispatchEvent(ev);
    return ev;
  }
  { const b = doc.getElementById('backdrop'); b.onclick.call(b); }          // start with everything closed
  const setBtn = doc.getElementById('btn-settings'), setPanel = doc.getElementById('panel-settings');
  setBtn.focus(); click('btn-settings');
  check('dialog open: focus moved inside the panel', setPanel.classList.contains('open') && setPanel.contains(doc.activeElement));
  const foc = Array.from(setPanel.querySelectorAll('button, input, select')).filter(e => !e.closest('[hidden]'));
  foc[foc.length - 1].focus();
  check('Tab from the last control wraps to the first', key('Tab').defaultPrevented && doc.activeElement === foc[0]);
  check('Shift+Tab from the first control wraps to the last', key('Tab', { shiftKey: true }).defaultPrevented && doc.activeElement === foc[foc.length - 1]);
  key('Escape');
  check('Escape closes the dialog and restores focus to its opener', !setPanel.classList.contains('open') && doc.activeElement === setBtn);
  doc.getElementById('btn-zmanim').focus(); click('btn-zmanim');
  const zpanel = doc.getElementById('panel-zmanim');
  check('panel without fields: focus lands on its title', doc.activeElement === zpanel.querySelector('.panel-title'));
  const zc = zpanel.querySelector('[data-close]'); zc.onclick.call(zc);
  check('close button restores focus to the opener', doc.activeElement === doc.getElementById('btn-zmanim'));

  // Switch + tab semantics.
  Object.defineProperty(doc.getElementById('reader-scroll'), 'scrollTop', { value: 0, writable: true, configurable: true });   // the scroll test above froze it
  const sw = doc.getElementById('set-minyan');
  check('switch: role=switch with aria-checked in sync with the state', sw.getAttribute('role') === 'switch' &&
    sw.getAttribute('aria-checked') === String(win.SiduronApp.state.withMinyan));
  const wasMinyan = win.SiduronApp.state.withMinyan;
  sw.onclick.call(sw);
  check('switch: click flips aria-checked', sw.getAttribute('aria-checked') === String(!wasMinyan) && sw.classList.contains('on') === !wasMinyan);
  sw.onclick.call(sw);
  check('switch: aria-checked back after a second click', sw.getAttribute('aria-checked') === String(wasMinyan));
  check('every role=switch in the page carries aria-checked', Array.from(doc.querySelectorAll('[role="switch"]')).every(e => /^(true|false)$/.test(e.getAttribute('aria-checked'))));
  const tabsEl = doc.getElementById('tabs');
  const tabBtns = Array.from(tabsEl.querySelectorAll('button'));
  check('tabs: container is a tablist, buttons are tabs', tabsEl.getAttribute('role') === 'tablist' && tabBtns.length >= 4 && tabBtns.every(b => b.getAttribute('role') === 'tab'));
  check('tabs: exactly one aria-selected, matching .active and the service',
    tabBtns.filter(b => b.getAttribute('aria-selected') === 'true').length === 1 &&
    tabBtns.every(b => (b.getAttribute('aria-selected') === 'true') === b.classList.contains('active')) &&
    tabsEl.querySelector('.active').id === 'tab-' + win.SiduronApp.state.service);
  check('tabs: roving tabindex (only the selected tab is in the tab order)', tabBtns.filter(b => b.tabIndex === 0).length === 1 && tabsEl.querySelector('.active').tabIndex === 0);
  check('tabs: the content area is the tabpanel labelled by the selected tab', doc.getElementById('content').getAttribute('role') === 'tabpanel' &&
    doc.getElementById('content').getAttribute('aria-labelledby') === 'tab-' + win.SiduronApp.state.service);
  check('mini tabs: also a tablist with aria-selected', doc.getElementById('mini-tabs').getAttribute('role') === 'tablist' &&
    doc.querySelectorAll('#mini-tabs [role="tab"][aria-selected="true"]').length === 1);
  {
    const before = win.SiduronApp.state.service;
    const act = doc.querySelector('#tabs .active'); act.focus();
    // RTL: ArrowLeft moves to the next tab (visually leftwards).
    act.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    check('tabs: ArrowLeft (RTL) selects the next tab and keeps focus on the strip', win.SiduronApp.state.service !== before &&
      doc.activeElement === doc.querySelector('#tabs .active') && doc.activeElement.getAttribute('aria-selected') === 'true');
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    check('tabs: Home selects the first tab', win.SiduronApp.state.service === 'shacharit' && doc.activeElement.id === 'tab-shacharit');
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    check('tabs: ArrowRight (RTL) wraps to the previous = last tab', win.SiduronApp.state.service === 'extras');
    doc.getElementById('tab-shacharit').click();
    doc.getElementById('btn-settings').focus();
  }
  const cssAll = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  check('mini-tab .active is not colour-only (font-weight 700)', /\.mini-tab\.active\s*\{[^}]*font-weight:\s*700/.test(cssAll));

  // Tooltips: every icon-only / aria-label button carries a title too (DS: tooltip = accessible name).
  const noTitle = Array.from(doc.querySelectorAll('button[aria-label]')).filter(b => b.getAttribute('role') !== 'switch' && !b.getAttribute('title'));
  check('every labelled button has a tooltip' + (noTitle.length ? ' (missing: ' + noTitle.map(b => b.id || b.className).join(',') + ')' : ''), noTitle.length === 0);
  ['fs-dec', 'fs-inc'].forEach(id => { const b = doc.getElementById(id); check(id + ': title equals its aria-label', b.title === b.getAttribute('aria-label') && b.title.length > 0); });
  doc.querySelectorAll('[data-close]').forEach(b => check('panel close button title "סגירה"', b.title === 'סגירה' && b.getAttribute('aria-label') === 'סגירה'));

  // Icons are inline SVG (currentColor, decorative), not text glyphs.
  ['fs-dec', 'fs-inc'].forEach(id => {
    const b = doc.getElementById(id), sv = b.querySelector('svg');
    check(id + ': inline SVG icon, no text glyph', !!sv && sv.getAttribute('aria-hidden') === 'true' && sv.getAttribute('stroke') === 'currentColor' && b.textContent.trim() === '' && !!b.getAttribute('aria-label'));
  });
  check('close buttons: SVG only (no ✕ text)', Array.from(doc.querySelectorAll('[data-close]')).every(b => !!b.querySelector('svg') && b.textContent.trim() === ''));

  // Fixed top bar with the plugin name (DESIGN_GUIDE: Top Bar).
  const topbar = doc.querySelector('header.topbar');
  check('top bar: header.topbar with the plugin name in <h1>', !!topbar && !!topbar.querySelector('h1') && topbar.querySelector('h1').textContent === 'סידורון');
  check('top bar: tool buttons live in the bar', !!topbar && ['btn-nav', 'btn-zmanim', 'btn-settings'].every(id => !!topbar.querySelector('#' + id)));
  check('top bar: outside the scrolling reader', !doc.getElementById('reader-scroll').contains(topbar));
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  check('top bar: CSS uses the theme tokens, fixed height', /\.topbar\s*\{[^}]*var\(--top-bar-height[^}]*var\(--surface-top-bar\)[^}]*flex:\s*0 0 auto/.test(css));

  check('no runtime errors', errors.length === 0);
  console.log(`\n=== INTERACTIONS: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed) ===`);
  process.exit(fail === 0 ? 0 : 1);
}, 400);
