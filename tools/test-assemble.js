/* test-assemble.js — end-to-end assembly check in one vm realm. */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'js/calendar.js', 'js/assembler.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const base = { nusach: 'edot_mizrach', gender: 'male', isInIsrael: true, withMinyan: true, purimDate: 'fourteenth' };

function assemble(iso, templateId, over) {
  const userCtx = Object.assign({}, base, over || {});
  return vm.runInContext(
    `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T08:00:00')}), ${JSON.stringify(userCtx)});` +
    `return {df:df, segs:SiduronAssembler.assemble(${JSON.stringify(templateId)}, ${JSON.stringify(userCtx)}, df)};})()`,
    ctx
  );
}

function clip(s, n) { return (s || '').replace(/\n/g, ' ⏎ ').slice(0, n); }

function report(label, iso, templateId, over, checks) {
  const r = assemble(iso, templateId, over);
  console.log(`\n══ ${label} — ${templateId} [${iso}${over ? ' ' + JSON.stringify(over) : ''}] ══`);
  console.log(`   segments: ${r.segs.length}`);
  (checks || []).forEach(c => {
    const seg = r.segs.find(s => s.id === c.id);
    if (!seg) { console.log(`   ✗ MISSING segment ${c.id}`); return; }
    const has = c.contains ? seg.resolvedText.includes(c.contains) : true;
    const mark = has ? '✓' : '✗';
    console.log(`   ${mark} ${c.id}${c.contains ? ' contains "' + c.contains + '"' : ''} :: ${clip(seg.resolvedText, 70)}`);
  });
}

// Shacharit edot_mizrach on regular weekday vs RC vs Chanukah
report('Weekday shacharit', '2026-06-16', 'shacharit_edot_mizrach', null, [
  { id: 'amidah_gevurot', contains: 'מַשִּׁיב' },        // summer? June → morid hatal, so NOT mashiv
]);
report('Rosh Chodesh shacharit', '2026-07-15', 'shacharit_edot_mizrach', null, [
  { id: 'amidah_retzeh', contains: 'יַעֲלֶה' },           // Yaaleh Veyavo present on RC
  { id: 'amidah_modim' },
]);
report('Chanukah shacharit', '2025-12-16', 'shacharit_edot_mizrach', null, [
  { id: 'amidah_modim', contains: 'הַנִּסִּים' },          // Al HaNisim
  { id: 'amidah_gevurot', contains: 'הַגֶּֽשֶׁם' },        // winter → mashiv haruach
]);
report('Winter weekday gevurot', '2026-01-15', 'shacharit_edot_mizrach', null, [
  { id: 'amidah_gevurot', contains: 'מַשִּׁיב' },
  { id: 'amidah_shanim', contains: 'וְתֵן טַל וּמָטָר' },
]);
report('Mincha weekday', '2026-06-16', 'mincha', null, []);
report('Maariv weekday', '2026-06-16', 'maariv_edot_mizrach', null, []);

// Sefirat HaOmer — placeholder fill
const omer = assemble('2026-04-10', 'sefirat_haomer_edot_mizrach');
const dayCount = omer.segs.find(s => s.id === 'sefirat_haomer_day_count');
console.log('\n══ Sefirat HaOmer day 8 ══');
console.log('   day_count:', clip(dayCount && dayCount.resolvedText, 90));
const lam = omer.segs.find(s => s.id === 'sefirat_haomer_lamenatzeach');
console.log('   lamenatzeach has <b>:', !!(lam && /<b>/.test(lam.resolvedText)));

// withMinyan off — chazarat hashatz / kaddish should drop
const noMinyan = assemble('2026-06-16', 'shacharit_edot_mizrach', { withMinyan: false });
const withMinyan = assemble('2026-06-16', 'shacharit_edot_mizrach', { withMinyan: true });
console.log('\n══ Minyan gating ══');
console.log('   segments with minyan:', withMinyan.segs.length, '| without:', noMinyan.segs.length);

// nusach coverage: assemble all 3 nusachim for shacharit
['ashkenaz', 'sfard', 'edot_mizrach'].forEach(n => {
  const r = assemble('2026-06-16', 'shacharit_' + n, { nusach: n });
  const empty = r.segs.filter(s => !s.resolvedText.trim()).length;
  console.log(`   shacharit_${n}: ${r.segs.length} segs, ${empty} empty`);
});
