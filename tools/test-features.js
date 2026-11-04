/* test-features.js — covers the v3.6 fixes, one section per reported issue:
 *
 *   1. RTL icon           — manifest tool-tab glyph + the mirrored icon/icon.png
 *   2. תפילה ללא מניין     — minyan-only sections/קדיש/ברכו are dropped, the rest stays
 *   3. קיצור דרך           — the real host error surfaces (not a blanket "no permission")
 *   4. תצוגת שם ה׳         — ה׳ / יְיָ / יְדֹוָד, vowels carried over, mid-word guard kept
 *   5. מודל היום לערבית    — Otzaria's date rolls over at שקיעה; ערבית follows the night
 *   6. תשעה באב            — no תחנון and no אבינו מלכנו (also fixes mincha on any
 *                            day without תחנון)
 *   7. כיוון תפילה         — the compass button opens the separate plugin, shows
 *                            only when it's installed, and explains failures
 *
 * Run: node tools/test-features.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { JSDOM } = require(path.join(ROOT, 'references/hebcal-build/node_modules/jsdom'));

let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function section(title) { console.log('\n══ ' + title + ' ══'); }

/* Nikud/te'amim-insensitive view of rendered HTML, for content assertions. */
function norm(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\p{Mn}/gu, '')
    .replace(/[׳״'"־׀׃]/g, '').replace(/\s+/g, ' ');
}

/* ────────────────────────── 1. RTL icon ────────────────────────── */
section('1. סמל התוסף');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const iconName = manifest.contributes.toolTab.iconName;
// book_24_regular is drawn as a closed book bound on the LEFT — an LTR book.
// Fluent has no book_rtl glyph, and a plugin cannot ask the host to mirror one,
// so the tool tab must use a glyph that reads the same in both directions.
check('tool-tab icon is not the left-bound book', iconName !== 'book_24_regular', iconName);
check('tool-tab icon is the direction-neutral open book', iconName === 'book_open_24_regular', iconName);
check('tool-tab icon is a valid Fluent 24px name', /^[a-z0-9_]+_24_(regular|filled)$/.test(iconName));

// icon/icon.png: text lines must be RIGHT-aligned (RTL) — every line ends at the
// same right edge, and the short last line is the one that stops early on the left.
function readPng(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    off += len + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { w: w, h: h, px: out };
}
const png = readPng(path.join(ROOT, 'icon', 'icon.png'));
// The icon is a picture (a gilded סידור, 512×512) — no longer the old text-line
// glyph, so check the format rather than the layout of text lines.
check('icon is a square PNG of at least 256px', png.w === png.h && png.w >= 256, png.w + 'x' + png.h);
check('icon has visible content (not blank)', (function () {
  let opaque = 0;
  for (let i = 3; i < png.px.length; i += 4) if (png.px[i] > 100) opaque++;
  return opaque > png.w * png.h / 4;
})());

/* ─────────────── 2. תפילה ללא מניין (js/services.js) ─────────────── */
section('2. תפילה ללא מניין');
const svcCtx = vm.createContext({ console });
svcCtx.window = svcCtx;
['data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js', 'js/services.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), svcCtx));
const SVC = svcCtx.SiduronServices;
const CORPORA = {
  weekday: { data: () => svcCtx.SIDURON_SERVICES, render: SVC.render, services: ['shacharit', 'mincha', 'arvit'],
    flags: ['day_monday', 'monday_thursday', 'kriat_hatorah', 'kriat_hatorah_mon_thu'] },
  shabbat: { data: () => svcCtx.SIDURON_SHABBAT, render: SVC.renderShabbat, services: ['maariv', 'shacharit', 'mincha'],
    flags: ['shabbat', 'day_shabbat', 'musaf_day', 'kriat_hatorah'] },
  yomtov: { data: () => svcCtx.SIDURON_YOMTOV, render: SVC.renderYomtov, services: ['maariv', 'shacharit', 'mincha'],
    flags: ['pesach', 'day_tuesday', 'musaf_day', 'kriat_hatorah', 'full_hallel'] },
};
const NUSACHIM = ['edot_mizrach', 'sfard', 'ashkenaz'];
// A segment that may only be said with a מניין, recognised independently of the
// implementation (so the test would catch a filter that silently stops working).
function isMinyanOnlySeg(text) {
  const t = norm(text).trim();
  if (/^.{0,30}?יתגדל ויתקדש/.test(t)) return 'קדיש';
  if (t.length <= 60 && /ברכו את (יהוה|השם|ה|הי) המברך/.test(t)) return 'ברכו';
  return null;
}
let leftovers = 0, shrank = 0, corporaChecked = 0, notesSeen = 0;
Object.keys(CORPORA).forEach(kind => {
  const C = CORPORA[kind];
  NUSACHIM.forEach(nusach => C.services.forEach(svc => {
    const segs = C.data()[nusach] && C.data()[nusach][svc];
    if (!segs) return;
    corporaChecked++;
    const withM = C.render(nusach, svc, { flags: C.flags.concat(['with_minyan']) });
    const noM = C.render(nusach, svc, { flags: C.flags });
    if (noM.html.length < withM.html.length) shrank++;
    if (/s-minyan-note/.test(noM.html)) notesSeen++;
    const body = norm(noM.html);
    segs.forEach(s => {
      const why = isMinyanOnlySeg(s.text);
      if (!why) return;
      const needle = norm(s.text).trim().slice(0, 40);
      if (needle.length > 12 && body.indexOf(needle) >= 0) {
        leftovers++;
        if (leftovers <= 3) console.log('    leftover ' + why + ' in ' + kind + '/' + nusach + '/' + svc);
      }
    });
  }));
});
check('all corpora rendered (3 nuschaot × 3 corpora × services)', corporaChecked === 27, String(corporaChecked));
check('no קדיש/ברכו survives without a minyan, anywhere', leftovers === 0, String(leftovers));
check('every service gets shorter without a minyan', shrank === corporaChecked, shrank + '/' + corporaChecked);
check('every service explains what was skipped', notesSeen === corporaChecked, notesSeen + '/' + corporaChecked);

// The individual's own prayer must survive untouched.
NUSACHIM.forEach(nusach => {
  const noM = norm(SVC.render(nusach, 'shacharit', { flags: CORPORA.weekday.flags }).html);
  check('[' + nusach + '] שמע ישראל kept without a minyan', /שמע ישראל/.test(noM));
  check('[' + nusach + '] the silent עמידה kept without a minyan', /(שים שלום|שלום רב)/.test(noM));
  check('[' + nusach + '] עלינו לשבח kept without a minyan', /עלינו לשבח/.test(noM));
  const withM = norm(SVC.render(nusach, 'shacharit', { flags: CORPORA.weekday.flags.concat(['with_minyan']) }).html);
  check('[' + nusach + '] קדיש + חזרת הש״ץ present WITH a minyan',
    /יתגדל ויתקדש/.test(withM) && /(נקדישך|נקדש את שמך|נקדישך ונעריצך)/.test(withM));
  check('[' + nusach + '] no skip notes WITH a minyan',
    !/s-minyan-note/.test(SVC.render(nusach, 'shacharit', { flags: CORPORA.weekday.flags.concat(['with_minyan']) }).html));
});
// Torah reading needs ten; Monday's reading must go, and be announced.
const monNoMinyan = SVC.render('ashkenaz', 'shacharit', { flags: CORPORA.weekday.flags });
check('קריאת התורה of Monday is skipped and announced',
  /נאמר(ים)? במניין בלבד/.test(monNoMinyan.html) && !/הוצאת ספר תורה/.test(monNoMinyan.html));
check('jump-to-section list drops the skipped headers',
  monNoMinyan.nav.every(n => !/חזרת הש|קדושה|מודים דרבנן|ברכת כהנים/.test(n.label)));
// A section that does not apply today must not be announced either.
check('a section irrelevant today is not announced (הפטרה on a Monday)',
  !/הפטרה/.test(monNoMinyan.html));

/* ─────────────── 5+6. flags: sunset day model & תשעה באב ─────────────── */
section('6. תשעה באב — אין תחנון ואין אבינו מלכנו');
const calCtx = vm.createContext({ console });
calCtx.window = calCtx;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/hebcal.js'), 'utf8'), calCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/calendar.js'), 'utf8'), calCtx);
const baseUser = { nusach: 'edot_mizrach', gender: 'male', isInIsrael: true, withMinyan: true, purimDate: 'fourteenth' };
function flagsOn(iso, over) {
  const user = Object.assign({}, baseUser, over || {});
  const mk = vm.runInContext('(function(y,m,d){return new Date(y,m,d,12,0,0);})', calCtx);
  const p = iso.split('-').map(Number);
  return calCtx.SiduronCalendar.flagsFor(mk(p[0], p[1] - 1, p[2]), user);
}
const TB = '2026-07-23';                     // ט' באב תשפ"ו (Thursday)
const tb = flagsOn(TB).flags;
check('תשעה באב detected', tb.indexOf('tisha_beav') >= 0);
check('תשעה באב: no תחנון in shacharit', tb.indexOf('skip_tachanun') >= 0);
check('תשעה באב: no תחנון in mincha', tb.indexOf('skip_tachanun_mincha') >= 0);
check('תשעה באב: no למנצח יענך', tb.indexOf('skip_lamenatzeach') >= 0);
check('תשעה באב: no אבינו מלכנו flag', tb.indexOf('avinu_malkeinu') < 0);
// …and the rendered service really has neither. Section names are read off the
// jump-to-section list: the words themselves also occur inside אהבת עולם
// ("אבינו מלכנו, בעבור שמך הגדול…"), which is of course still said.
function sections(nusach, svc, flags) {
  return SVC.render(nusach, svc, flags).nav.map(n => norm(n.label).trim());
}
NUSACHIM.forEach(nusach => {
  ['shacharit', 'mincha'].forEach(svc => {
    const secs = sections(nusach, svc, flagsOn(TB));
    check('[' + nusach + '/' + svc + '] no אבינו מלכנו section on תשעה באב',
      secs.indexOf('אבינו מלכנו') < 0, secs.join(', '));
    check('[' + nusach + '/' + svc + '] no תחנון section on תשעה באב', secs.indexOf('תחנון') < 0);
  });
  const kinot = norm(SVC.render(nusach, 'shacharit', flagsOn(TB)).html);
  check('[' + nusach + '] תשעה באב content still shown (קינות/איכה/הפטרה/ציון)',
    /(קינות|איכה|הפטרה|ציון)/.test(kinot));
});
// Regression: a day without תחנון in shacharit must not show it at mincha either
// (this used to leak — the mincha tag was keyed to a flag that was only set for
// the ערב-שבועות case, so ראש חודש/חנוכה/ניסן mincha showed תחנון).
['2026-07-15' /* ר"ח אב */, '2026-12-08' /* חנוכה */, '2026-04-15' /* ניסן */].forEach(iso => {
  const f = flagsOn(iso).flags;
  check('no תחנון at mincha on ' + iso,
    f.indexOf('skip_tachanun') >= 0 && f.indexOf('skip_tachanun_mincha') >= 0);
  NUSACHIM.forEach(nusach => {
    const secs = sections(nusach, 'mincha', flagsOn(iso));
    check('[' + nusach + '] mincha of ' + iso + ' has no תחנון/אבינו מלכנו section',
      secs.indexOf('תחנון') < 0 && secs.indexOf('אבינו מלכנו') < 0, secs.join(', '));
  });
});
// The invariant behind that fix, over a whole year.
let violations = 0, tachanunDays = 0;
for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
  const f = flagsOn('2026-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')).flags;
  if (f.indexOf('skip_tachanun') >= 0 && f.indexOf('skip_tachanun_mincha') < 0) violations++;
  if (f.indexOf('skip_tachanun') < 0) tachanunDays++;
}
check('no day skips תחנון in shacharit but says it at mincha', violations === 0, String(violations));
check('most days still say תחנון (the fix did not silence everything)', tachanunDays > 150, String(tachanunDays));
// A plain weekday still says תחנון.
const plain = flagsOn('2026-06-25').flags;
check('a plain weekday still says תחנון',
  plain.indexOf('skip_tachanun') < 0 && plain.indexOf('skip_tachanun_mincha') < 0);
NUSACHIM.forEach(nusach => {
  const secs = sections(nusach, 'shacharit', flagsOn('2026-06-25'));
  check('[' + nusach + '] a plain weekday shows the תחנון section', secs.indexOf('תחנון') >= 0);
});
check('a plain weekday says nothing about מוצאי שבת', plain.indexOf('motzaei_shabbat') < 0);
check('Sunday is flagged מוצאי שבת (for אתה חוננתנו/הבדלה)',
  flagsOn('2026-06-21').flags.indexOf('motzaei_shabbat') >= 0);
check('אתה חוננתנו/הבדלה now keyed to מוצאי שבת, not to שבת',
  SVC._evalTag('chonantanu', f => f === 'motzaei_shabbat') === true &&
  SVC._evalTag('chonantanu', f => f === 'shabbat') === false);

/* ───────── 3+4+5 in the live UI (jsdom) ───────── */
section('4. תצוגת שם ה׳ (יחידה)');
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
const win = dom.window, doc = win.document;
const errors = [];
win.addEventListener('error', e => errors.push(String(e.error && e.error.stack || e.message)));
// jsdom does not fetch <script src> — inject index.html's scripts in order.
['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js',
  'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js',
  'js/services.js', 'js/extras.js', 'js/app.js'].forEach(f => {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
    doc.body.appendChild(s);
  });

setTimeout(async function () {
  const I = win.SiduronApp._internals;

  // The Name as printed in siddurim, with the source vowels carried over.
  const NAME = 'יְהֹוָה';
  check('ה׳ mode', I.renderDivineName(NAME, 'hashem') === 'ה׳');
  check('two yods keep the שוא and take the ו\'s קמץ', I.renderDivineName(NAME, 'yy') === 'יְיָ',
    JSON.stringify(I.renderDivineName(NAME, 'yy')));
  check('ידוד keeps every mark in place', I.renderDivineName(NAME, 'yedovid') === 'יְדֹוָד',
    JSON.stringify(I.renderDivineName(NAME, 'yedovid')));
  check('unvocalised source stays unvocalised', I.renderDivineName('יהוה', 'yy') === 'יי');
  check('unvocalised ידוד', I.renderDivineName('יהוה', 'yedovid') === 'ידוד');
  check('four style options offered', I.divineNames.length === 4);
  // Whole-text behaviour: prefixes are replaced, mid-word matches are not
  // (וַיַּגְבִּיהוּהוּ contains the skeleton but is not the Name).
  win.SiduronApp.state.divineName = 'yy';
  const midWord = 'וַיַּגְבִּיהוּהוּ';
  check('mid-word skeleton left alone', I.applyDivineName(midWord) === midWord);
  check('a one-letter prefix is still replaced', /לַיְיָ|לַיָי|לַיי/.test(I.applyDivineName('לַיהֹוָה')),
    JSON.stringify(I.applyDivineName('לַיהֹוָה')));
  win.SiduronApp.state.divineName = 'source';
  check('"as written" leaves the text untouched', I.applyDivineName('בָּרוּךְ ' + NAME) === 'בָּרוּךְ ' + NAME);
  win.SiduronApp.state.divineName = 'yy';

  section('5. מודל היום — התאריך מתגלגל בשקיעה');
  const times = { shkiah: '19:45', chatzot: '12:40' };
  const D = (y, m, d, hh, mm) => new win.Date(y, m - 1, d, hh || 0, mm || 0);
  // Thursday 20:00 — Otzaria already reports Friday.
  check('host date == today → not advanced (still daytime)',
    I.hostDayAdvanced(D(2026, 7, 23), times, D(2026, 7, 23, 14, 0)) === false);
  check('host date == tomorrow after שקיעה → advanced',
    I.hostDayAdvanced(D(2026, 7, 24), times, D(2026, 7, 23, 20, 0)) === true);
  check('host date == tomorrow BEFORE שקיעה → user picked that date, not advanced',
    I.hostDayAdvanced(D(2026, 7, 24), times, D(2026, 7, 23, 14, 0)) === false);
  check('a date further away is never treated as the sunset roll-over',
    I.hostDayAdvanced(D(2026, 7, 30), times, D(2026, 7, 23, 20, 0)) === false);
  check('advanced → ערבית belongs to the reported day itself',
    I.maarivDateFor(D(2026, 7, 24), true).getDate() === 24);
  check('not advanced → ערבית belongs to the coming night',
    I.maarivDateFor(D(2026, 7, 24), false).getDate() === 25);

  // End-to-end: pick the maariv tab in each situation and inspect what renders.
  function tab(name) {
    let t = null;
    doc.querySelectorAll('#tabs .tab').forEach(x => { if (x.textContent === name) t = x; });
    if (t) t.onclick.call(t);
    return doc.getElementById('content').innerHTML;
  }
  function maarivAt(hostIso, now) {
    win.SiduronApp.setDate(hostIso);
    win.SiduronApp.state.times = times;
    I.setPrayerDays(now);
    return tab('מעריב');
  }
  const KABALAT = /לכה דודי/;                       // only in the Shabbat maariv
  const CHONANTANU = /אתה חוננתנו/;                 // only in מוצאי שבת

  // ליל שישי (Thursday night): the reported bug — this used to show ערבית לשבת.
  let html = norm(maarivAt('2026-07-24', D(2026, 7, 23, 20, 0)));
  check('ליל שישי (Thu 20:00): weekday ערבית, no קבלת שבת', !KABALAT.test(html));
  check('ליל שישי: not מוצאי שבת either', !CHONANTANU.test(html));
  check('ליל שישי: title says nothing about שבת', !/ליל שבת/.test(doc.getElementById('hdr-title').textContent));

  // ליל שבת (Friday night, after sunset the host says Saturday).
  html = norm(maarivAt('2026-07-25', D(2026, 7, 24, 20, 0)));
  check('ליל שבת (Fri 20:00): קבלת שבת + ערבית לשבת', KABALAT.test(html));
  check('ליל שבת: title names the night', /ליל שבת/.test(doc.getElementById('hdr-title').textContent));

  // Friday afternoon — the night ahead is שבת, so מעריב is still ערבית לשבת.
  html = norm(maarivAt('2026-07-24', D(2026, 7, 24, 14, 0)));
  check('Friday 14:00: מעריב is already ערבית לשבת', KABALAT.test(html));

  // מוצאי שבת (Saturday night, host says Sunday).
  html = norm(maarivAt('2026-07-26', D(2026, 7, 25, 20, 30)));
  check('מוצאי שבת: weekday ערבית with אתה חוננתנו', CHONANTANU.test(html) && !KABALAT.test(html));
  check('מוצאי שבת: title says מוצאי שבת', /מוצאי שבת/.test(doc.getElementById('hdr-title').textContent));

  // Shabbat morning is unaffected by all of this.
  win.SiduronApp.setDate('2026-07-25');
  I.setPrayerDays(D(2026, 7, 25, 8, 0));
  check('Shabbat morning still uses the Shabbat שחרית',
    I.shabbatServiceKey('shacharit', win.SiduronApp.state.dayFlags) === 'shacharit');
  check('after שקיעה the auto-picked service is מעריב',
    (function () {
      win.SiduronApp.state.dayAdvanced = true;
      const r = I.pickServiceByTime(times);
      win.SiduronApp.state.dayAdvanced = false;
      return r === 'maariv';
    })());
  check('before חצות the auto-picked service is שחרית',
    I.pickServiceByTime({ chatzot: '23:59', shkiah: '23:59' }) === 'shacharit');

  section('3. קיצור דרך בשולחן העבודה');
  check('permission denial names the permissions screen',
    /ניהול הרשאות/.test(I.shortcutErrorMessage({ code: 'permission_denied', message: 'Permission denied: ui.create_shortcut' })));
  check('an old host is reported as an old host, not as a permission problem',
    /עדכנו את אוצריא/.test(I.shortcutErrorMessage({ code: 'error', message: 'Unknown action in shortcut: create' })));
  check('a missing Desktop folder is reported as such',
    /שולחן העבודה/.test(I.shortcutErrorMessage({ code: 'error', message: 'error.unsupported: target folder not found' })) &&
    !/הרשאה/.test(I.shortcutErrorMessage({ code: 'error', message: 'error.unsupported: target folder not found' })));
  check('rate limiting is reported as such',
    /המתינו/.test(I.shortcutErrorMessage({ code: 'error.rate_limited', message: 'Rate limit exceeded' })));
  check('an unknown failure still shows the host message',
    /USERPROFILE/.test(I.shortcutErrorMessage({ code: 'error', message: 'error.internal: USERPROFILE not set' })));

  // The host's error must actually reach the user through ui.showError.
  const calls = [];
  win.Otzaria = {
    call: (m, p) => {
      calls.push([m, p]);
      if (m === 'shortcut.create') {
        return Promise.resolve({ success: false, error: { code: 'permission_denied', message: 'Permission denied: ui.create_shortcut' } });
      }
      return Promise.resolve({ success: true, data: null });
    },
    on() {}, off() {},
  };
  win.SiduronApp.state.platform = 'windows';
  win.SiduronApp.state.permissions = ['calendar.read'];         // grant list without the shortcut
  const btnSettings = doc.getElementById('btn-settings');
  btnSettings.onclick.call(btnSettings);
  check('a missing grant is flagged before clicking',
    /ניהול הרשאות/.test(doc.getElementById('set-shortcut-note').textContent) &&
    doc.getElementById('set-shortcut-note').classList.contains('warn'));
  const sBtn = doc.getElementById('set-shortcut');
  sBtn.onclick.call(sBtn);
  await new Promise(r => setTimeout(r, 20));
  const errCall = calls.filter(c => c[0] === 'ui.showError').pop();
  check('the host error is shown to the user', !!errCall);
  check('the message is actionable, not a blanket "no permission"',
    !!errCall && /ניהול הרשאות/.test(errCall[1].message) && errCall[1].message.length > 40,
    errCall && errCall[1].message);
  check('the button is re-enabled after a failure', sBtn.disabled === false);
  win.SiduronApp.state.permissions = ['ui.create_shortcut'];
  btnSettings.onclick.call(btnSettings);
  check('with the grant present the hint goes back to normal',
    !doc.getElementById('set-shortcut-note').classList.contains('warn'));

  section('7. כיוון תפילה — פתיחת התוסף הנפרד');
  const KIVUN = 'com.shiachrina.kivuntefila';
  const kBtn = doc.getElementById('btn-kivun');
  // This page booted standalone (no host) — nothing could be opened from it.
  check('standalone preview keeps the button hidden after boot', kBtn.hidden === true);
  check('the button starts hidden (no flash for users without the plugin)',
    /<button[^>]*id="btn-kivun"[^>]*\shidden/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
  // jsdom doesn't load css/style.css, so check the rule itself: .tool-btn sets
  // display:inline-flex, which beats the UA's [hidden] { display: none }.
  check('a hidden tool button is really hidden (CSS rule present)',
    /\.tool-btn\[hidden\]\s*\{\s*display:\s*none/.test(fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8')));
  check('manifest declares plugin.open_other', manifest.permissions.indexOf('plugin.open_other') >= 0);
  check('manifest declares app.info.read (listInstalled / getGrantedPermissions)',
    manifest.permissions.indexOf('app.info.read') >= 0);
  const cmpVer = (a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  };
  check('minAppVersion covers plugin.openOther / listInstalled (0.9.97)',
    cmpVer(manifest.minAppVersion, '0.9.97') >= 0, manifest.minAppVersion);

  check('not installed → offers the store',
    /אינו מותקן/.test(I.kivunErrorMessage({ code: 'error.not_found', message: 'plugin not installed: ' + KIVUN })));
  check('missing grant → names the permissions screen and the permission',
    /ניהול הרשאות/.test(I.kivunErrorMessage({ code: 'permission_denied', message: 'Permission denied: plugin.open_other' })) &&
    /פתיחת תוסף אחר/.test(I.kivunErrorMessage({ code: 'permission_denied', message: 'Permission denied: plugin.open_other' })));
  check('another failure keeps the host message and blames nobody',
    /boom/.test(I.kivunErrorMessage({ code: 'error.internal', message: 'boom' })) &&
    !/הרשאה|אינו מותקן/.test(I.kivunErrorMessage({ code: 'error.internal', message: 'boom' })));
  check('a thrown Error is reported too', /lost/.test(I.kivunErrorMessage(new win.Error('bridge lost'))));

  // A scriptable host: what listInstalled / getGrantedPermissions / openOther answer.
  let host;
  const kCalls = [];
  win.Otzaria = {
    call: (m, p) => {
      kCalls.push([m, p]);
      if (m === 'plugin.listInstalled') {
        return Promise.resolve(host.list === null
          ? { success: false, error: { code: 'error.unknown_method', message: 'Unknown action in plugin: listInstalled' } }
          // 0.9.97+743 answered { name, version } only — no pluginId.
          : { success: true, data: host.list.map(id => host.noIds ? { name: id, version: '1.0.0' } : { pluginId: id, name: id, enabled: true }) });
      }
      if (m === 'app.getGrantedPermissions') return Promise.resolve({ success: true, data: { permissions: host.granted } });
      if (m === 'plugin.openOther') return host.open(p);
      return Promise.resolve({ success: true, data: null });
    },
    on() {}, off() {},
  };
  const tick = () => new Promise(r => setTimeout(r, 20));
  const ALL = ['app.info.read', 'plugin.open_other'];

  host = { list: ['com.other.plugin'], granted: ALL };
  await I.updateKivunButton(); await tick();
  check('hidden when the plugin is not installed', kBtn.hidden === true);

  host = { list: ['com.other.plugin', KIVUN], granted: ALL };
  await I.updateKivunButton(); await tick();
  check('shown when the plugin is installed', kBtn.hidden === false);
  check('plain label with the grant', kBtn.title === 'כיוון תפילה' && kBtn.getAttribute('aria-label') === 'כיוון תפילה');

  host = { list: [KIVUN], granted: ['app.info.read'] };
  await I.updateKivunButton(); await tick();
  check('still shown without the grant (a click explains what to do)', kBtn.hidden === false);
  check('the missing grant is hinted in the tooltip', /פתיחת תוסף אחר/.test(kBtn.title) && /פתיחת תוסף אחר/.test(kBtn.getAttribute('aria-label')));

  host = { list: null, granted: null };
  await I.updateKivunButton(); await tick();
  check('shown when the host cannot list plugins (unknown ≠ not installed)', kBtn.hidden === false);

  host = { list: [], granted: ALL };
  await I.updateKivunButton(); await tick();
  host = { list: ['com.moshenahari.siduron', 'com.other.plugin'], granted: ALL, noIds: true };
  await I.updateKivunButton(); await tick();
  check('0.9.97+743 (list without pluginId) counts as "can\'t tell" → shown', kBtn.hidden === false);

  check('a fresh grant list refreshes STATE.permissions (shortcut hint too)',
    win.SiduronApp.state.permissions.indexOf('plugin.open_other') >= 0);

  // Installed after boot: the page becoming visible again re-checks.
  host = { list: [], granted: ALL };
  await I.updateKivunButton(); await tick();
  check('hidden again after uninstall', kBtn.hidden === true);
  host = { list: [KIVUN], granted: ALL };
  Object.defineProperty(doc, 'hidden', { value: false, configurable: true });   // jsdom reports hidden
  doc.dispatchEvent(new win.Event('visibilitychange')); await tick();
  check('visibilitychange re-checks (install while the page was open)', kBtn.hidden === false);
  host = { list: [], granted: ALL };
  win.dispatchEvent(new win.Event('focus')); await tick();
  check('focus re-checks too', kBtn.hidden === true);

  // Out-of-order answers: an older, slower check must not overwrite a newer one.
  let releaseSlow;
  const slow = new Promise(r => { releaseSlow = r; });
  const realCall = win.Otzaria.call;
  win.Otzaria.call = (m, p) => (m === 'plugin.listInstalled' && host.slow)
    ? slow.then(() => ({ success: true, data: [] }))
    : realCall(m, p);
  host = { list: [KIVUN], granted: ALL, slow: true };
  const older = I.updateKivunButton();
  host = { list: [KIVUN], granted: ALL, slow: false };
  await I.updateKivunButton();
  releaseSlow(); await older; await tick();
  check('a stale (older) answer does not override the newer check', kBtn.hidden === false);
  win.Otzaria.call = realCall;

  // Click → plugin.openOther with our id; success shows nothing.
  host = { list: [KIVUN], granted: ALL, open: () => Promise.resolve({ success: true, data: true }) };
  kCalls.length = 0;
  await kBtn.onclick.call(kBtn); await tick();
  const openCall = kCalls.find(c => c[0] === 'plugin.openOther');
  check('click calls plugin.openOther with the kivun-tefila id', !!openCall && openCall[1].pluginId === KIVUN);
  check('success shows no error', !kCalls.some(c => c[0] === 'ui.showError'));

  // Permission denied → actionable message, button stays.
  host.open = () => Promise.resolve({ success: false, error: { code: 'permission_denied', message: 'Permission denied: plugin.open_other' } });
  kCalls.length = 0;
  await kBtn.onclick.call(kBtn); await tick();
  let kErr = kCalls.filter(c => c[0] === 'ui.showError').pop();
  check('permission denial is shown with the permissions screen', !!kErr && /ניהול הרשאות/.test(kErr[1].message), kErr && kErr[1].message);
  check('permission denial keeps the button', kBtn.hidden === false);

  // Uninstalled between the check and the click → message + the button goes away.
  host.open = () => Promise.resolve({ success: false, error: { code: 'error.not_found', message: 'plugin not installed: ' + KIVUN } });
  kCalls.length = 0;
  await kBtn.onclick.call(kBtn); await tick();
  kErr = kCalls.filter(c => c[0] === 'ui.showError').pop();
  check('not_found is shown as "not installed"', !!kErr && /אינו מותקן/.test(kErr[1].message));
  check('not_found hides the button', kBtn.hidden === true);

  // A bridge that throws instead of answering.
  kBtn.hidden = false;
  host.open = () => Promise.reject(new win.Error('bridge lost'));
  kCalls.length = 0;
  await kBtn.onclick.call(kBtn); await tick();
  kErr = kCalls.filter(c => c[0] === 'ui.showError').pop();
  check('a thrown bridge error still reaches the user', !!kErr && /bridge lost/.test(kErr[1].message));

  // A double click while the host is still opening the plugin opens it once.
  let releaseOpen;
  host.open = () => new Promise(r => { releaseOpen = () => r({ success: true, data: true }); });
  kCalls.length = 0;
  kBtn.click();
  check('the button is disabled while opening', kBtn.disabled === true);
  kBtn.click();
  releaseOpen(); await tick();
  check('a double click calls plugin.openOther once', kCalls.filter(c => c[0] === 'plugin.openOther').length === 1);
  check('the button is enabled again afterwards', kBtn.disabled === false);

  // Before plugin.boot the SDK rejects every call ("not ready"). A focus in
  // that window must not read as "can't tell" and flash the button in.
  {
    const dom2 = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
      { runScripts: 'dangerously', url: 'file://' + ROOT + '/index.html' });
    const w2 = dom2.window, d2 = w2.document;
    let booted = false, bootHandler = null;
    const c2 = [];
    w2.Otzaria = {
      call: (m, p) => {
        c2.push(m);
        if (!booted) return Promise.reject(new w2.Error('Otzaria SDK not ready yet'));
        if (m === 'plugin.listInstalled') return Promise.resolve({ success: true, data: [{ pluginId: KIVUN }] });
        if (m === 'app.getGrantedPermissions') return Promise.resolve({ success: true, data: { permissions: ALL } });
        return Promise.resolve({ success: true, data: null });
      },
      on: (topic, fn) => { if (topic === 'plugin.boot') bootHandler = fn; },
      off() {},
    };
    ['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js', 'data/shabbat-data.js', 'data/slichot-data.js',
      'data/extras-data.js', 'data/locations.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js',
      'js/services.js', 'js/extras.js', 'js/app.js'].forEach(f => {
        const s = d2.createElement('script');
        s.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
        d2.body.appendChild(s);
      });
    await tick();
    const b2 = d2.getElementById('btn-kivun');
    w2.dispatchEvent(new w2.Event('focus')); await tick();
    check('before plugin.boot: no host check is attempted', c2.indexOf('plugin.listInstalled') < 0, c2.join(','));
    check('before plugin.boot: the button stays hidden', b2.hidden === true);
    booted = true;
    check('the page registered a plugin.boot handler', typeof bootHandler === 'function');
    if (bootHandler) bootHandler({ permissions: ALL, app: { platform: 'windows' } });
    await new Promise(r => setTimeout(r, 200));
    check('after plugin.boot: installed plugin → button shown', b2.hidden === false);
    w2.close();
  }

  check('no runtime errors in the UI', errors.length === 0, errors[0]);
  console.log('\n=== FEATURES: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
  process.exit(fail === 0 ? 0 : 1);
}, 400);
