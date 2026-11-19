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
    if (m === 'plugin.setRestoreState') return Promise.resolve({ success: true, data: true });
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

  console.log('\n══ plugin.suspended / plugin.resumed ══');
  {
    const spy = { set: 0, clear: 0 };
    const rs = win.setInterval, rc = win.clearInterval;
    win.setInterval = (...a) => { spy.set++; return rs.apply(win, a); };
    win.clearInterval = (...a) => { spy.clear++; return rc.apply(win, a); };
    check('the host events are handled', typeof handlers['plugin.suspended'] === 'function' && typeof handlers['plugin.resumed'] === 'function');
    handlers['plugin.suspended']();
    check('suspended clears the live timer', spy.clear === 1, spy.clear);
    handlers['plugin.suspended']();
    check('a second suspended is harmless (idempotent stop)', spy.clear === 1, spy.clear);
    handlers['plugin.resumed']();
    check('resumed restarts the timer', spy.set === 1, spy.set);
    handlers['plugin.resumed']();
    check('a second resumed does not start a second timer', spy.set === 1, spy.set);
    handlers['plugin.suspended']();
    win.setInterval = rs; win.clearInterval = rc;
    handlers['plugin.resumed']();
  }

  console.log('\n══ רענון ברקע לא מקפיץ את הקורא ══');
  {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    setNow(2026, 7, 23, 14, 0);
    await I.setCustomDate(null);
    const prayer0 = doc.querySelector('#content .prayer');
    check('a prayer is open', !!prayer0);
    handlers['settings.changed']({ key: 'key-selected-city', newValue: 'ירושלים' });
    await wait(80);
    check('nothing the text is built from changed → no re-render (scroll untouched)',
      doc.querySelector('#content .prayer') === prayer0);
    setNow(2026, 7, 23, 20, 0);                       // שקיעה: the halachic day becomes Friday
    handlers['settings.changed']({ key: 'key-selected-city', newValue: 'ירושלים' });
    await wait(80);
    const prayer1 = doc.querySelector('#content .prayer');
    check('a real day change re-renders…', !!prayer1 && prayer1 !== prayer0);
    check('…in place: no fade-in (the scroll position is kept)', !prayer1.classList.contains('fade-in'));
    // A city refresh racing a day the user picks must not paint over it.
    setNow(2026, 7, 23, 14, 0);
    handlers['settings.changed']({ key: 'key-selected-city', newValue: 'ירושלים' });
    const picking = I.setCustomDate('2026-12-25');
    await picking; await wait(80);
    check('the picked day wins over an overlapping refresh', S.customDate === '2026-12-25' && ymd(S.date) === '2026-12-25', ymd(S.date));
    await I.setCustomDate(null);
  }

  console.log('\n══ plugin.setRestoreState ══');
  {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const saves = calls.filter(c => c[0] === 'plugin.setRestoreState');
    check('the open view is saved on boot/navigation', saves.length > 0);
    check('saved state: schemaVersion 1 + service', saves.every(c => c[1].state && c[1].state.schemaVersion === 1 && typeof c[1].state.service === 'string'));
    const before = calls.filter(c => c[0] === 'plugin.setRestoreState').length;
    const tabs = doc.querySelectorAll('#tabs .tab');
    const other = Array.from(tabs).find(b => !b.classList.contains('active'));
    other.click(); await wait(20);
    const after = calls.filter(c => c[0] === 'plugin.setRestoreState');
    check('switching service saves the new state', after.length === before + 1 && after[after.length - 1][1].state.service !== undefined);
    const activeTab = doc.querySelector('#tabs .tab.active');
    activeTab.click(); await wait(20);
    check('re-opening the same view does not re-save',
      calls.filter(c => c[0] === 'plugin.setRestoreState').length === after.length);

    // A fresh page booted by the host with payload.restore.
    const today = (() => { const d = new Date(); const p2 = n => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); })();
    async function bootWith(restore, hostData, keepOpen) {
      const d2 = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
        { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
      const w2 = d2.window, doc2 = w2.document, h2 = {}, errs = [];
      w2.addEventListener('error', e => errs.push(String(e.message)));
      w2.Otzaria = {
        call: (m, p) => {
          const r = hostData && hostData(m, p);
          if (r && r.__reject) return Promise.reject(new Error('not ready'));
          return r instanceof Error ? Promise.resolve({ success: false, error: { code: 'error.unknown_method', message: m } })
            : Promise.resolve({ success: true, data: r === undefined ? null : r });
        },
        on: (ev, fn) => { h2[ev] = fn; }, off() {},
      };
      ['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js',
        'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js',
        'js/services.js', 'js/extras.js', 'js/app.js'].forEach(f => {
          const sc = doc2.createElement('script');
          sc.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
          doc2.body.appendChild(sc);
        });
      h2['plugin.boot']({ app: { platform: 'windows' }, permissions: [], restore });
      await wait(250);
      const st = w2.SiduronApp.state;
      const ex = w2.SiduronExtras && w2.SiduronExtras.list()[0];
      const out = { inIsrael: st.isInIsrael, country: st.country, city: st.city, nusach: st.nusach, gender: st.gender, textWidth: st.textWidth, fontSize: st.fontSize, fontFamily: st.fontFamily, withMinyan: st.withMinyan, divine: st.divineName, service: st.service, extra: st.extra, errs: errs.length, firstExtra: ex && ex.id };
      Object.defineProperty(out, 'h2', { value: h2 }); Object.defineProperty(out, 'win2', { value: w2 });
      if (!keepOpen) w2.close();
      return out;
    }
    const base = await bootWith(undefined);
    const pick = base.service === 'mincha' ? 'maariv' : 'mincha';
    let r = await bootWith({ reason: 'discarded', state: { schemaVersion: 1, service: pick, extra: null, day: today } });
    check('restore: the saved service is reopened (not the time-of-day pick)', r.service === pick && r.errs === 0, JSON.stringify(r));
    r = await bootWith({ reason: 'discarded', state: { schemaVersion: 1, service: 'extras', extra: base.firstExtra, day: today } });
    check('restore: an open extra is reopened', r.service === 'extras' && r.extra === base.firstExtra && !!base.firstExtra, JSON.stringify(r));
    r = await bootWith({ reason: 'discarded', state: { schemaVersion: 1, service: 'extras', extra: 'no-such-extra', day: today } });
    check('restore: an unknown extra opens the extras menu', r.service === 'extras' && r.extra === null && r.errs === 0, JSON.stringify(r));
    const ignored = [
      ['an unknown schemaVersion', { reason: 'discarded', state: { schemaVersion: 2, service: pick, day: today } }],
      ['an unknown service', { reason: 'discarded', state: { schemaVersion: 1, service: 'nope', day: today } }],
      ['a view saved on another day', { reason: 'discarded', state: { schemaVersion: 1, service: pick, day: '2001-01-01' } }],
      ['a null state', { reason: 'crashed', state: null }],
      ['a malformed state', { reason: 'discarded', state: 'garbage' }],
    ];
    for (const [label, restore] of ignored) {
      r = await bootWith(restore);
      check('restore: ' + label + ' → normal open', r.service === base.service && r.errs === 0, JSON.stringify(r));
    }

    // Stored settings: valid values load, anything unexpected keeps the default.
    const stored = obj => (m, p) => (m === 'storage.get' && p && p.key in obj ? obj[p.key] : undefined);
    const dflt = await bootWith(undefined, stored({}));
    r = await bootWith(undefined, stored({ nusach: 'sfard', gender: 'female', textWidth: '920', fontSize: 30, fontFamily: 'David', withMinyan: false, divineName: 'hashem' }));
    check('stored settings load as before', r.nusach === 'sfard' && r.gender === 'female' && r.textWidth === '920' && r.fontSize === 30 &&
      r.fontFamily === 'David' && r.withMinyan === false && r.divine === 'hashem', JSON.stringify(r));
    r = await bootWith(undefined, stored({ nusach: 'klingon', gender: 7, textWidth: 'huge', fontSize: 'big', fontFamily: "x';}body{", withMinyan: 'yes', divineName: 'nope' }));
    check('unexpected stored values fall back to the defaults',
      r.nusach === dflt.nusach && r.gender === dflt.gender && r.textWidth === dflt.textWidth && r.fontSize === dflt.fontSize &&
      r.fontFamily === dflt.fontFamily && r.withMinyan === dflt.withMinyan && r.divine === dflt.divine && r.errs === 0, JSON.stringify(r) + ' vs ' + JSON.stringify(dflt));
    // storage.set failing (rejected or success:false) never becomes an unhandled rejection.
    const unhandled = [];
    const onUnhandled = e => unhandled.push(String(e));
    process.on('unhandledRejection', onUnhandled);
    const warns = [], realWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    r = await bootWith(undefined, m => m === 'storage.set' ? { __reject: true } : undefined, true);
    r.win2.document.getElementById('btn-settings').onclick();
    r.win2.document.querySelector('#set-gender [data-val="female"]').click();
    await wait(50);
    r.win2.close();
    r = await bootWith(undefined, m => m === 'storage.set' ? new Error('x') : undefined, true);
    r.win2.document.getElementById('btn-settings').onclick();
    r.win2.document.querySelector('#set-gender [data-val="female"]').click();
    await wait(50);
    r.win2.close();
    console.warn = realWarn;
    process.off('unhandledRejection', onUnhandled);
    check('a failing storage.set is not an unhandled rejection', unhandled.length === 0, unhandled.join('|'));
    check('a failing storage.set is logged', warns.some(w => /storage\.set\(gender\)/.test(w)), warns.join('|'));

    // "טוען טעמים…": isLoading is true while the first te'amim load is in flight.
    {
      const dt = new JSDOM('<!doctype html><body></body>', { runScripts: 'dangerously' });
      const wt = dt.window;
      let release;
      const gate = new Promise(res => { release = res; });
      wt.Otzaria = {
        call: (m) => m === 'library.getBookContent' ? gate.then(() => ({ success: true, data: '' })) : Promise.resolve({ success: true, data: null }),
        on() {}, off() {},
      };
      ['data/teamim-map.js', 'js/teamim.js'].forEach(f => wt.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));
      const T = wt.SiduronTeamim;
      check('teamim: not loading while disabled', T.isLoading('ashkenaz', 'shacharit') === false);
      T.setEnabled(true);
      const pf = T.prefetch('ashkenaz', 'shacharit');
      check('teamim: loading while the first prefetch is in flight', T.isLoading('ashkenaz', 'shacharit') === true);
      check('teamim: a service without a mapping is never "loading"', T.isLoading('sfard', 'shacharit') === false);
      release(); await pf;
      check('teamim: not loading once it settled', T.isLoading('ashkenaz', 'shacharit') === false);
      wt.close();
    }

    // inIsrael comes from calendar.getCities (the host's table), locations.js is the fallback.
    const cityHost = (cities, city) => (m) => m === 'calendar.getCities' ? cities : (m === 'settings.get' ? city : undefined);
    r = await bootWith(undefined, cityHost([{ name: 'ניו יורק', country: 'ארצות הברית', inIsrael: false }, { name: 'ירושלים', country: 'ארץ ישראל', inIsrael: true }], 'ניו יורק'));
    check('city: host getCities → חו"ל', r.inIsrael === false && r.country === 'ארצות הברית' && r.city === 'ניו יורק', JSON.stringify(r));
    r = await bootWith(undefined, cityHost([{ name: 'ירושלים', country: 'ארץ ישראל', inIsrael: false }], 'ירושלים'));
    check('city: the host answer wins over locations.js', r.inIsrael === false, JSON.stringify(r));
    r = await bootWith(undefined, cityHost(new Error('unknown'), 'ירושלים'));
    check('city: no getCities → locations.js fallback (Israel)', r.inIsrael === true && r.country === 'ארץ ישראל', JSON.stringify(r));
    r = await bootWith(undefined, cityHost([{ name: 'אחר', country: 'x', inIsrael: false }], 'ירושלים'));
    check('city: a city missing from the host list → locations.js fallback', r.inIsrael === true, JSON.stringify(r));

    // Divine-name default follows Otzaria's holyName display choice.
    const holy = v => (m => m === 'app.getDivineNamesDisplay' ? { holyName: v, otherNames: 'asIs', filtered: v !== 'asIs' } : undefined);
    for (const [hostStyle, mine] of [['asIs', 'source'], ['hehApostrophe', 'hashem'], ['doubleYod', 'yy'], ['daletDalet', 'yedovid'], ['kufKuf', 'yy']]) {
      r = await bootWith(undefined, holy(hostStyle));
      check('divine name default: host ' + hostStyle + ' → ' + mine, r.divine === mine, r.divine);
    }
    r = await bootWith(undefined, m => m === 'app.getDivineNamesDisplay' ? new Error('unknown') : (m === 'settings.get' ? false : undefined));
    check('divine name default: no getDivineNamesDisplay → legacy key-replace-holy-names=false → source', r.divine === 'source', r.divine);
    r = await bootWith(undefined, m => m === 'app.getDivineNamesDisplay' ? { holyName: 'weird' } : undefined);
    check('divine name default: an unknown host style → legacy fallback (yy)', r.divine === 'yy', r.divine);
    r = await bootWith(undefined, m => m === 'app.getDivineNamesDisplay' ? { holyName: 'asIs' } : (m === 'storage.get' ? undefined : undefined));
    // A style the user stored wins over the host's.
    r = await bootWith(undefined, (m, p) => m === 'app.getDivineNamesDisplay' ? { holyName: 'asIs' } : (m === 'storage.get' && p.key === 'divineName' ? 'hashem' : undefined));
    check('divine name: a stored user style wins over the host setting', r.divine === 'hashem', r.divine);
    // Live: settings.changed key-text-display-policy updates a style the user never chose.
    let cur = 'doubleYod';
    r = await bootWith(undefined, m => m === 'app.getDivineNamesDisplay' ? { holyName: cur } : undefined, true);
    check('live: starts on the host style', r.divine === 'yy', r.divine);
    cur = 'daletDalet';
    r.h2['settings.changed']({ key: 'key-text-display-policy', newValue: 'x' });
    await wait(80);
    check('live: key-text-display-policy changes the followed style', r.win2.SiduronApp.state.divineName === 'yedovid', r.win2.SiduronApp.state.divineName);
    r.win2.close();
  }

  console.log('\n══ זמני היום: מזהי זמנים של אוצריא ══');
  setNow(2026, 7, 23, 14, 0);
  const realOtz = win.Otzaria;
  win.Otzaria = {
    call: (m, p) => m === 'calendar.getDailyTimes'
      ? Promise.resolve({ success: true, data: { sunset: '19:45', chatzos: '12:40', minchaGedolaGRA: '13:20', minchaKetanaGRA: '16:35', plagGRA: '18:30' } })
      : realOtz.call(m, p),
    on: realOtz.on, off() {},
  };
  await I.refreshDate();
  const zText = doc.getElementById('zmanim-body').textContent;
  check('zmanim panel shows מנחה קטנה from the host id minchaKetanaGRA', /מנחה קטנה\s*16:35/.test(zText), zText);
  check('zmanim panel shows שקיעה / חצות / פלג from host ids',
    /שקיעה\s*19:45/.test(zText) && /חצות\s*12:40/.test(zText) && /פלג המנחה\s*18:30/.test(zText), zText);
  win.Otzaria = realOtz;

  check('no runtime errors', errors.length === 0, errors[0]);
  console.log('\n=== TODAY: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail ? 1 : 0);
}, 300);
