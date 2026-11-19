/* test-theme.js — theme payload wiring (applyTheme) in jsdom with a mock host:
 * colour roles, surfaces, radius/density/spacing, UI + reading fonts, validation
 * of malformed values, font migration and the first-run font-size seed.
 * Run: node tools/test-theme.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));
const FILES = ['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js',
  'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js', 'js/services.js', 'js/extras.js', 'js/app.js'];
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' ' + (extra || ''))); }

async function boot(theme, stored) {
  const d = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
    { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
  const w = d.window, doc = w.document, h = {}, errs = [], sets = [];
  w.addEventListener('error', e => errs.push(String(e.message)));
  w.Otzaria = {
    call: (m, p) => {
      if (m === 'storage.set') sets.push(p);
      const v = m === 'storage.get' && stored && p.key in stored ? stored[p.key] : null;
      return Promise.resolve({ success: true, data: v });
    },
    on: (ev, fn) => { h[ev] = fn; }, off() {},
  };
  FILES.forEach(f => { const s = doc.createElement('script'); s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8'); doc.body.appendChild(s); });
  h['plugin.boot']({ app: { platform: 'windows' }, permissions: [], theme });
  await wait(250);
  const root = doc.documentElement;
  return { w, doc, h, errs, sets, css: n => root.style.getPropertyValue(n), st: w.SiduronApp.state };
}

const FULL = {
  mode: 'dark',
  colorScheme: {
    primary: '#112233', onPrimary: '#ffffff', primaryContainer: '#223344', onPrimaryContainer: '#eeeeee',
    secondary: '#334455', secondaryContainer: '#445566', onSecondaryContainer: '#fafafa',
    tertiaryContainer: '#556677', onTertiaryContainer: '#f0f0f0', errorContainer: '#660000', onErrorContainer: '#ffdddd',
    surface: '#101010', onSurface: '#e0e0e0', onSurfaceVariant: '#cccccc', surfaceContainer: '#181818',
    surfaceContainerHigh: '#202020', surfaceContainerHighest: '#282828', outline: '#888888', outlineVariant: '#444444',
    error: '#ff5555', shadow: '#010101', scrim: '#020202',
  },
  surfaces: { reader: '#0a0a0a', panel: '#0b0b0b', card: '#0c0c0c', topBar: '#0d0d0d' },
  typography: { fontFamily: 'TaameyDavidCLM', fontSize: 28, lineHeight: 1.6, uiFontFamily: 'Rubik', uiFont: "'Segoe UI', system-ui, sans-serif" },
  radius: 12, density: { compact: false, topBarHeight: 56, fieldHeight: 44 },
  spacing: { '2xs': 2, xs: 4, sm: 8, smd: 12, md: 16, lg: 24, xl: 32 },
};

(async () => {
  console.log('══ full payload ══');
  let t = await boot(FULL);
  check('no runtime errors', t.errs.length === 0, t.errs.join('|'));
  check('--color-primary', t.css('--color-primary') === '#112233');
  check('container roles', t.css('--color-primary-container') === '#223344' && t.css('--color-on-error-container') === '#ffdddd' &&
    t.css('--color-tertiary-container') === '#556677');
  check('shadow + scrim', t.css('--color-shadow') === '#010101' && t.css('--color-scrim') === '#020202');
  check('surfaces', t.css('--surface-reader') === '#0a0a0a' && t.css('--surface-panel') === '#0b0b0b' &&
    t.css('--surface-card') === '#0c0c0c' && t.css('--surface-top-bar') === '#0d0d0d');
  check('radius / field height', t.css('--radius') === '12px' && t.css('--field-h') === '44px');
  check('spacing', t.css('--space-md') === '16px' && t.css('--space-smd') === '12px' && t.css('--space-2xs') === '2px');
  check('UI font from uiFont', t.css('--font-ui') === "'Segoe UI', system-ui, sans-serif");
  check('reading font from typography.fontFamily', /^'TaameyDavidCLM'/.test(t.css('--font-main')));
  check('line height', t.css('--line-height') === '1.6');
  check('dark class on body', t.doc.body.classList.contains('dark'));
  check('first run: font size seeded from theme', t.st.fontSize === 28 && t.css('--font-size-base') === '28px', t.st.fontSize);
  t.h['theme.changed']({ mode: 'light', colorScheme: { primary: '#abcdef' }, typography: { fontSize: 20 } });
  check('theme.changed recolours', t.css('--color-primary') === '#abcdef' && !t.doc.body.classList.contains('dark'));
  check('theme.changed never overrides the chosen size', t.st.fontSize === 28);

  console.log('\n══ uiFontFamily only ══');
  t = await boot({ colorScheme: { primary: '#112233' }, typography: { uiFontFamily: 'Rubik' } });
  check('--font-ui from uiFontFamily + system fallback', /^'Rubik', system-ui/.test(t.css('--font-ui')), t.css('--font-ui'));

  console.log('\n══ malformed payload ══');
  t = await boot({
    mode: 'light',
    colorScheme: { primary: 'red;}body{display:none', onPrimary: 'url(x)', surface: '#12', primaryContainer: 7, secondary: '#abc' },
    surfaces: { panel: 'javascript:1', card: null },
    typography: { fontFamily: "x';}", fontSize: 'big', lineHeight: 'tall', uiFont: 'a;}b{', uiFontFamily: 'x{y' },
    radius: '8px', density: { fieldHeight: 9999, topBarHeight: -1 }, spacing: { md: 'wide', lg: 1e9 },
  });
  check('no runtime errors', t.errs.length === 0, t.errs.join('|'));
  check('bad colours ignored', t.css('--color-primary') === '' && t.css('--color-on-primary') === '' &&
    t.css('--color-surface') === '' && t.css('--color-primary-container') === '');
  check('good colour kept (3-digit hex)', t.css('--color-secondary') === '#abc');
  check('bad surfaces ignored', t.css('--surface-panel') === '' && t.css('--surface-card') === '');
  check('bad numbers ignored', t.css('--radius') === '' && t.css('--field-h') === '' && t.css('--space-md') === '' && t.css('--space-lg') === '');
  check('bad fonts ignored', t.css('--font-ui') === '' && t.css('--font-main').indexOf('x') < 0, t.css('--font-main'));
  check('font size not seeded from garbage', t.st.fontSize === 22, t.st.fontSize);
  check('no theme at all: boots', (await boot(undefined)).errs.length === 0);

  console.log('\n══ reading font picker + migration ══');
  t = await boot(undefined);
  const opts = Array.from(t.doc.querySelectorAll('#set-font option')).map(o => o.value);
  check('only bundled families offered', opts.join() === ',FrankRuhlCLM,TaameyDavidCLM,KeterYG,NotoSerifHebrew,Shofar,TaameyAshkenaz', opts.join());
  t = await boot(undefined, { fontFamily: 'TaameyFrankCLM' });
  check('stored unsupported family -> default', t.st.fontFamily === '');
  check('...and the migrated value is written back', t.sets.some(s => s.key === 'fontFamily' && s.value === ''));
  t = await boot(undefined, { fontFamily: 'Shofar' });
  check('stored supported family kept', t.st.fontFamily === 'Shofar' && /^'Shofar'/.test(t.css('--font-main')) && !t.sets.some(s => s.key === 'fontFamily'));
  t = await boot(FULL, { fontSize: 31 });
  check('stored font size beats the theme seed', t.st.fontSize === 31, t.st.fontSize);
  t = await boot({ colorScheme: { primary: '#112233' }, typography: { fontSize: 60 } });
  check('seeded size is clamped to 16-36', t.st.fontSize === 36, t.st.fontSize);

  console.log('\n=== THEME: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail ? 1 : 0);
})();
