/* test-calendar.js — sanity-checks js/calendar.js against known dates.
 * Loads the real browser bundle + engine into one vm realm (so Date matches).
 * Run: node tools/test-calendar.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const ctx = vm.createContext({ console });
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'hebcal.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'calendar.js'), 'utf8'), ctx);

const baseCtx = { nusach: 'edot_mizrach', gender: 'male', isInIsrael: true, withMinyan: true, purimDate: 'fourteenth' };

function show(label, iso, over) {
  const userCtx = Object.assign({}, baseCtx, over || {});
  // build Date INSIDE the realm so hebcal's Date check passes
  const r = vm.runInContext(
    `SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T12:00:00')}), ${JSON.stringify(userCtx)})`,
    ctx
  );
  const interesting = r.flags.filter(x =>
    !/^(gender_|in_israel|not_in_israel|with_minyan|day_)/.test(x)).sort();
  console.log(`\n● ${label}  [${iso}${over ? ' ' + JSON.stringify(over) : ''}]`);
  console.log('   ' + interesting.join('  '));
  const extra = [];
  if (r.omerDay) extra.push('omer=' + r.omerDay);
  if (r.sukkotDay) extra.push('sukkotDay=' + r.sukkotDay);
  if (r.pesachDay) extra.push('pesachDay=' + r.pesachDay);
  if (r.chanukahDay) extra.push('chanukahDay=' + r.chanukahDay);
  if (r.chagYt1Weekday) extra.push('yt1wd=' + r.chagYt1Weekday);
  if (r.upcomingParshah) extra.push('parsha=' + r.upcomingParshah.he + '(' + r.upcomingParshah.slug + ')');
  if (extra.length) console.log('   ' + extra.join('  '));
}

show('Regular weekday (Tue)', '2026-06-16');
show('Regular Thursday (mon/thu kriah)', '2026-06-18');
show('Friday / Erev Shabbat', '2026-06-19');
show('Shabbat', '2026-06-20');
show('Rosh Chodesh Sivan (Sun)', '2026-05-17');
show('Chanukah day 3', '2025-12-16');
show('RC Tevet during Chanukah', '2025-12-22');
show('Purim (14 Adar)', '2026-03-03');
show('Shushan Purim', '2026-03-04', { purimDate: 'both' });
show('Pesach YT1', '2026-04-02');
show('CHM Pesach (IL)', '2026-04-05');
show('CHM Pesach (chul)', '2026-04-05', { isInIsrael: false });
show('Shavuot (IL)', '2026-05-22');
show('Sukkot YT1', '2025-10-07');
show('CHM Sukkot day 4', '2025-10-10');
show('Hoshana Raba', '2025-10-13');
show('Shemini Atzeret (IL)', '2025-10-14');
show('Shemini Atzeret (chul)', '2025-10-14', { isInIsrael: false });
show('Yom Kippur', '2025-10-02');
show('Rosh Hashana', '2025-09-23');
show('Aseret Yemei Teshuva (5 Tishrei)', '2025-09-27');
show('Tzom Gedaliah', '2025-09-25');
show('Tisha B Av', '2026-07-23');
show('Lag BaOmer', '2026-05-05');
show('Omer day 8', '2026-04-10');
show('Tu BiShvat', '2026-02-02');
show('Elul weekday', '2026-09-01');
show('Summer tal/geshem off', '2026-07-01');
show('Tal umatar (IL, 8 Cheshvan)', '2025-10-30');
show('Tal umatar (chul, Dec 10)', '2025-12-10', { isInIsrael: false });
