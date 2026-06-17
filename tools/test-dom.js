/* test-dom.js — loads the real index.html + scripts in jsdom (no Otzaria) and
 * verifies the plugin boots and renders without errors. Approximates the
 * standalone WebView. Run: node tools/test-dom.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  url: 'file://' + ROOT + '/index.html',
  beforeParse(window) {
    window.HTMLDetailsElement = window.HTMLDetailsElement || function () {};
    // capture script errors
    window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  },
});

// jsdom doesn't auto-resolve our <script src> relative file loads for execution
// order with runScripts unless resources are enabled; instead inject manually.
const win = dom.window;
function inject(rel) {
  try {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const s = win.document.createElement('script');
    s.textContent = code;
    win.document.body.appendChild(s);
  } catch (e) { errors.push('inject ' + rel + ': ' + e.message); }
}

// Wait for DOMContentLoaded, then inject scripts in order and let app boot.
function run() {
  ['vendor/hebcal.js', 'data/siddur-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js', 'js/app.js'].forEach(inject);
  // app.js boots on DOMContentLoaded; that already fired, so trigger its standalone boot path:
  // its init added a DOMContentLoaded listener — fire it again is a no-op, so call boot via the exposed API.
  setTimeout(check, 300);
}

function check() {
  const d = win.document;
  const content = d.getElementById('content');
  const tabs = d.getElementById('tabs');
  const badges = d.getElementById('hdr-badges');
  const dateEl = d.getElementById('hdr-date');
  console.log('errors during load:', errors.length);
  errors.forEach(e => console.log('  ✗', e));
  console.log('SiduronApp present:', !!win.SiduronApp);
  console.log('hebcal present:', !!win.hebcal);
  console.log('SIDDUR_DATA present:', !!win.SIDDUR_DATA);
  console.log('tabs rendered:', tabs ? tabs.children.length : 0);
  console.log('badges html:', badges ? badges.innerHTML.slice(0, 120) : '(none)');
  console.log('date:', dateEl ? dateEl.textContent : '(none)');
  const contentLen = content ? content.innerHTML.length : 0;
  console.log('content html length:', contentLen);
  const hasPrayer = content && /class="prayer/.test(content.innerHTML);
  const hasSection = content && /class="s-section"/.test(content.innerHTML);
  console.log('has .prayer:', !!hasPrayer, '| has .s-section:', !!hasSection);

  // Simulate a date change (RC) and re-check.
  if (win.SiduronApp) {
    win.SiduronApp.setDate('2026-07-15');
    const after = d.getElementById('content').innerHTML;
    console.log('\nafter setDate(RC 2026-07-15): content length', after.length,
      '| yaaleh veyavo present:', /יַעֲלֶה/.test(after),
      '| RC badge:', /ראש חודש/.test(d.getElementById('hdr-badges').innerHTML));
  }
  const ok = errors.length === 0 && contentLen > 1000 && hasPrayer && hasSection;
  console.log('\n=== RESULT:', ok ? 'PASS' : 'FAIL', '===');
  process.exit(ok ? 0 : 1);
}

if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', run);
else run();
