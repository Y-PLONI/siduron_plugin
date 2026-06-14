/* test-fuzz.js — assemble+render every day for 2 years × 3 nusachim ×
 * shacharit/mincha/maariv (+ omer when applicable). Catches any engine or
 * assembler exception and flags anomalously empty output. Run: node tools/test-fuzz.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}

const driver = `(function(iso, nusach, tmpl, il){
  var uc = {nusach:nusach, gender:'male', isInIsrael:il, withMinyan:true, purimDate:'both'};
  var df = SiduronCalendar.flagsFor(new Date(iso+'T08:00:00'), uc);
  var segs = SiduronAssembler.assemble(tmpl, uc, df);
  var r = SiduronRender.render(segs);
  return { len:r.html.length, nav:r.nav.length, segs:segs.length,
           placeholder: /\\{\\{[a-z_]+\\}\\}/.test(r.html),
           detailsOk: (r.html.match(/<details/g)||[]).length === (r.html.match(/<\\/details>/g)||[]).length };
})`;
const fn = vm.runInContext(driver, ctx);

const nusachim = ['edot_mizrach', 'sfard', 'ashkenaz'];
let total = 0, errors = [], placeholders = [], unbalanced = [], tiny = [];

function services(n) {
  return [['shacharit', 'shacharit_' + n], ['mincha', 'mincha'], ['maariv', 'maariv_' + n], ['omer', 'sefirat_haomer_' + n]];
}

const start = new Date(2025, 0, 1);
for (let d = 0; d < 730; d++) {
  const day = new Date(start.getTime()); day.setDate(day.getDate() + d);
  const iso = day.toISOString().slice(0, 10);
  for (const il of [true, false]) {
    for (const n of nusachim) {
      for (const [svc, tmpl] of services(n)) {
        total++;
        let r;
        try { r = fn(iso, n, tmpl, il); }
        catch (e) { errors.push(`${iso} ${n}/${svc} il=${il}: ${e.message}`); continue; }
        if (r.placeholder) placeholders.push(`${iso} ${n}/${svc} il=${il}`);
        if (!r.detailsOk) unbalanced.push(`${iso} ${n}/${svc} il=${il}`);
        // shacharit/mincha/maariv should always be substantial.
        if (svc !== 'omer' && r.len < 2000) tiny.push(`${iso} ${n}/${svc} il=${il} len=${r.len}`);
      }
    }
  }
}

console.log('assemblies run:', total);
console.log('exceptions:', errors.length);
errors.slice(0, 12).forEach(e => console.log('  ✗', e));
console.log('unresolved {{placeholders}}:', placeholders.length);
placeholders.slice(0, 12).forEach(e => console.log('  ⚠', e));
console.log('unbalanced <details>:', unbalanced.length);
unbalanced.slice(0, 6).forEach(e => console.log('  ✗', e));
console.log('suspiciously tiny (<2KB) shacharit/mincha/maariv:', tiny.length);
tiny.slice(0, 12).forEach(e => console.log('  ⚠', e));

const ok = errors.length === 0 && unbalanced.length === 0;
console.log('\n=== FUZZ:', ok ? 'PASS' : 'FAIL', '===');
process.exit(ok ? 0 : 1);
