/* test-today.js — the plugin follows TODAY, never Otzaria's calendar selection.
 *
 *   - the date Otzaria's calendar has selected is ignored (getSelectedDate is not used)
 *   - the halachic day rolls over at שקיעה, and stays "night" until עלות השחר
 *   - another day can be picked by hand; it is clearly marked and never saved
 *   - "today" moves on by itself (liveStale) at שקיעה / midnight / עלות השחר
 *
 * Run: node tools/test-today.js   (needs references/hebcal-build/node_modules/jsdom)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));

let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
const win = dom.window, doc = win.document;
const errors = [];
win.addEventListener('error', e => errors.push(String(e.error && e.error.stack || e.message)));

// A controllable clock + an Otzaria mock whose calendar sits on a DIFFERENT day.
win.eval(`
  var __NOW = new Date(2026, 6, 23, 14, 0, 0);
  var __RealDate = Date;
  Date = class extends __RealDate {
    constructor(...a) { if (a.length) super(...a); else super(__NOW.getTime()); }
    static now() { return __NOW.getTime(); }
  };
`);
const calls = [];
const handlers = {};
win.Otzaria = {
  call: (m, p) => {
    calls.push([m, p]);
    if (m === 'calendar.getSelectedDate') return Promise.resolve({ success: true, data: '2026-04-08T00:00:00.000Z' });
    if (m === 'calendar.getDailyTimes') {
      return Promise.resolve({ success: true, data: { shkiah: '19:45', alotHaShachar: '04:30', chatzot: '12:40', _date: p && p.date } });
    }
    return Promise.resolve({ success: true, data: null });
  },
  on: (ev, fn) => { handlers[ev] = fn; }, off() {},
};
['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js',
  'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js',
  'js/services.js', 'js/extras.js', 'js/app.js'].forEach(f => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    doc.body.appendChild(s);
  });

const setNow = (y, m, d, hh, mm) => win.eval(`__NOW = new __RealDate(${y}, ${m - 1}, ${d}, ${hh}, ${mm || 0}, 0);`);
const ymd = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();

setTimeout(async function () {
  const A = win.SiduronApp, I = A._internals, S = A.state;

  // The host boots the plugin; the SDK's selected date is April 8th.
  handlers['plugin.boot']({ app: { platform: 'windows' }, permissions: ['calendar.read'] });
  await new Promise(r => setTimeout(r, 200));

  console.log('\n══ today, not Otzaria\'s selection ══');
  check('shows today (23 Jul), not the calendar selection (8 Apr)', ymd(S.date) === '2026-7-23', ymd(S.date));
  check('getSelectedDate is never called', !calls.some(c => c[0] === 'calendar.getSelectedDate'));
  check('times are requested for today explicitly',
    calls.some(c => c[0] === 'calendar.getDailyTimes' && c[1] && c[1].date === '2026-07-23'));
  check('daytime: not advanced', S.dayAdvanced === false);
  check('no "custom date" badge on today', !doc.getElementById('hdr-custom'));
  check('calendar.date_changed is not subscribed', !handlers['calendar.date_changed']);

  console.log('\n══ שקיעה rolls the day ══');
  setNow(2026, 7, 23, 20, 0);
  await I.refreshDate();
  check('Thu 20:00 → halachic day is Friday 24', ymd(S.date) === '2026-7-24', ymd(S.date));
  check('Thu 20:00 → advanced (night)', S.dayAdvanced === true);
  check('Thu 20:00 → tomorrow\'s times fetched',
    calls.some(c => c[0] === 'calendar.getDailyTimes' && c[1] && c[1].date === '2026-07-24'));
  setNow(2026, 7, 24, 2, 0);
  await I.refreshDate();
  check('Fri 02:00 (small hours) → still the night of Friday', ymd(S.date) === '2026-7-24' && S.dayAdvanced === true);
  setNow(2026, 7, 24, 6, 0);
  await I.refreshDate();
  check('Fri 06:00 → day, not advanced', ymd(S.date) === '2026-7-24' && S.dayAdvanced === false);

  console.log('\n══ today moves on by itself ══');
  setNow(2026, 7, 23, 14, 0);
  await I.refreshDate();
  check('14:00 fresh state is not stale', I.liveStale(new win.Date()) === false);
  setNow(2026, 7, 23, 19, 50);
  check('after שקיעה the state is stale → refresh', I.liveStale(new win.Date()) === true);
  await I.refreshDate();
  check('…and fresh again after the refresh', I.liveStale(new win.Date()) === false);
  setNow(2026, 7, 24, 0, 5);
  check('after midnight the state is stale', I.liveStale(new win.Date()) === true);
  await I.refreshDate();
  setNow(2026, 7, 24, 5, 0);
  check('at עלות השחר the night ends → stale', I.liveStale(new win.Date()) === true);

  console.log('\n══ picking another day ══');
  setNow(2026, 7, 23, 14, 0);
  await I.refreshDate();
  await I.setCustomDate('2026-12-25');
  check('custom day shown', ymd(S.date) === '2026-12-25', ymd(S.date));
  check('custom day: never "advanced"', S.dayAdvanced === false);
  check('custom day: header badge visible', !!doc.getElementById('hdr-custom'));
  check('custom day: date input holds it', doc.getElementById('set-date').value === '2026-12-25');
  check('custom day: "back to today" button shown', doc.getElementById('set-date-today').hidden === false);
  check('custom day: not saved to storage', !calls.some(c => c[0] === 'storage.set' && /date/i.test(String(c[1] && c[1].key))));
  setNow(2026, 7, 23, 20, 0);
  check('custom day never goes stale', I.liveStale(new win.Date()) === false);
  doc.getElementById('hdr-custom').click();
  await new Promise(r => setTimeout(r, 100));
  check('badge click returns to today (rolled to Fri after שקיעה)', S.customDate === null && ymd(S.date) === '2026-7-24', ymd(S.date));
  check('badge gone after returning', !doc.getElementById('hdr-custom'));
  await I.setCustomDate('not-a-date');
  check('invalid input is ignored (stays on today)', S.customDate === null);

  check('no runtime errors', errors.length === 0, errors[0]);
  console.log('\n=== TODAY: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail ? 1 : 0);
}, 300);
