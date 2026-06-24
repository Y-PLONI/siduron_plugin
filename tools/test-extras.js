/* test-extras.js — verifies extras render across nusachim and that conditional
 * inserts evaluate correctly (e.g. birkat hamazon yaaleh-veyavo only on RC).
 * Run: node tools/test-extras.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'data/extras-data.js', 'js/calendar.js', 'js/extras.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const base = { nusach: 'edot_mizrach', gender: 'male', isInIsrael: true, withMinyan: true, purimDate: 'both' };

function renderExtra(id, iso, nusach) {
  const uc = Object.assign({}, base, { nusach: nusach || base.nusach });
  return vm.runInContext(
    `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T08:00:00')}),${JSON.stringify(uc)});` +
    `return SiduronExtras.renderExtra(${JSON.stringify(id)}, ${JSON.stringify(uc.nusach)}, df);})()`, ctx);
}

let pass = 0, fail = 0;
function check(name, cond) { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  ✗ ') + name); }

const items = vm.runInContext('SiduronExtras.list()', ctx);
console.log('extras available:', items.map(i => i.id).join(', '));

// All extras render non-empty in all 3 nusachim, no raw markup/placeholders.
const REGDAY = '2026-06-18', RC = '2026-07-15', CHAN = '2025-12-16';
['ashkenaz', 'sfard', 'edot_mizrach'].forEach(function (n) {
  items.forEach(function (it) {
    const r = renderExtra(it.id, REGDAY, n);
    const ok = r.html.length > 30 && !/\(\)\S|~|\{\{/.test(r.html);
    if (!ok) check(it.id + ' [' + n + '] clean & non-empty', false);
  });
});
check('all extras render clean in all nusachim (no raw markup)', fail === 0);

// Birkat hamazon: yaaleh veyavo appears ONLY on Rosh Chodesh.
const bmReg = renderExtra('birkat_hamazon', REGDAY, 'edot_mizrach').html;
const bmRC = renderExtra('birkat_hamazon', RC, 'edot_mizrach').html;
check('birkat hamazon: NO yaaleh-veyavo on regular day', !/יַעֲלֶה וְיָבוֹא/.test(bmReg));
check('birkat hamazon: yaaleh-veyavo present on Rosh Chodesh', /יַעֲלֶה וְיָבוֹא/.test(bmRC));

// Birkat hamazon: al hanissim only on Chanukah.
const bmChan = renderExtra('birkat_hamazon', CHAN, 'edot_mizrach').html;
check('birkat hamazon: NO al-hanissim on regular day', !/עַל הַנִּסִּים/.test(bmReg));
check('birkat hamazon: al-hanissim present on Chanukah', /הַנִּסִּים/.test(bmChan));

// Static extras present.
// Note: the passage's lead word is wrapped in <span class="s-firstword">…</span>
// for display, so match an interior word rather than the opening "יְהִי רָצוֹן".
check('tefilat haderech renders', /רָצוֹן/.test(renderExtra('tefilat_haderech', REGDAY).html));
check('borei nefashot renders', /בּוֹרֵא נְפָשׁוֹת/.test(renderExtra('borei_nefashot', REGDAY).html));
check('asher yatzar renders', renderExtra('asher_yatzar', REGDAY).html.length > 50);

// Divine name is the FULL form in source (censor is a display-time toggle).
check('full divine name in source', /יְהֹוָה|יהוה/.test(bmReg));

// Yom Kippur Katan flag fires on its day (Erev RC Shvat 2026-01-17).
const ykk = vm.runInContext(`SiduronCalendar.flagsFor(new Date("2026-01-18T08:00:00"),${JSON.stringify(base)}).flags.indexOf('yom_kippur_katan')>=0`, ctx);
check('yom_kippur_katan flag detected (Erev RC Shvat, 18 Jan 2026)', ykk);

console.log(`\n=== EXTRAS: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed) ===`);
process.exit(fail === 0 ? 0 : 1);
