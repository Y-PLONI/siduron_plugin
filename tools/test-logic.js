/* test-logic.js — regression tests for the halachic-logic bugs fixed in the
 * calendar / services / assembler layers (no DOM needed).
 *   node tools/test-logic.js
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console: { log() {} } });
ctx.window = ctx;
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'data/services-data.js',
  'data/shabbat-data.js', 'js/calendar.js', 'js/assembler.js', 'js/services.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const BASE = { isInIsrael: true, gender: 'male', nusach: 'sfard', withMinyan: true, purimDate: 'fourteenth' };
function flagsFor(iso, over) {
  const u = Object.assign({}, BASE, over || {});
  return vm.runInContext(
    `SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T12:00:00')}), ${JSON.stringify(u)})`, ctx);
}
function has(iso, flag, over) { return flagsFor(iso, over).flags.indexOf(flag) >= 0; }
function render(iso, nusach, svc, over) {
  const u = Object.assign({}, BASE, { nusach: nusach }, over || {});
  return vm.runInContext(
    `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T12:00:00')}),${JSON.stringify(u)});` +
    `return SiduronServices.render(${JSON.stringify(nusach)},${JSON.stringify(svc)},df);})()`, ctx);
}
// Plain comparable text: tags + nikud + punctuation stripped.
function plain(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/[֑-ׇ]/g, '')
    .replace(/[׳״'",:.־׀׃()\[\]]/g, '').replace(/\s+/g, ' ').trim();
}
const NUSACHIM = ['ashkenaz', 'sfard', 'edot_mizrach'];

console.log('\n── חנוכה: אין דגל בערב חנוכה, 8 ימים בדיוק ──');
// 5787 (מעוברת): כ"ה בכסלו = 5.12.2026
check('כ"ד בכסלו (ערב חנוכה) — לא חנוכה ולא על הנסים', !has('2026-12-04', 'chanukah') && !has('2026-12-04', 'al_hanisim'));
check('כ"ה בכסלו — חנוכה, יום 1', has('2026-12-05', 'chanukah') && has('2026-12-05', 'chanukah_day_1'));
check('ב\' בטבת — יום 8', has('2026-12-12', 'chanukah_day_8'));
check('ג\' בטבת — כבר לא חנוכה', !has('2026-12-13', 'chanukah'));
check('דגל על הנסים רק בחנוכה/פורים (שנתיים, כל הימים)', (function () {
  for (let d = new Date(2026, 0, 1); d < new Date(2028, 0, 1); d.setDate(d.getDate() + 1)) {
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const f = flagsFor(iso).flags;
    if (f.indexOf('al_hanisim') >= 0 && f.indexOf('chanukah') < 0 && f.indexOf('purim') < 0) return false;
  }
  return true;
})());

console.log('\n── דליפת דגלים ליום חול ──');
check('18 בתמוז 5786 (ו\' 3.7.2026): לא שבת ולא על הנסים', (function () {
  const f = flagsFor('2026-07-03').flags;
  return f.indexOf('shabbat') < 0 && f.indexOf('al_hanisim') < 0 && f.indexOf('erev_shabbat') >= 0;
})());
check('פסח שני (י"ד באייר) אינו "פסח"', !has('2026-05-01', 'pesach') && has('2026-05-01', 'pesach_sheni'));
check('ח\' באב (ערב תשעה באב) אינו תשעה באב ואינו תענית', (function () {
  const f = flagsFor('2026-07-22').flags;
  return f.indexOf('tisha_beav') < 0 && f.indexOf('fast_day') < 0;
})());
check('ט\' באב — תשעה באב ותענית', has('2026-07-23', 'tisha_beav') && has('2026-07-23', 'fast_day'));
check('יום כיפור קטן אינו תענית ציבור', has('2026-11-09', 'yom_kippur_katan') && !has('2026-11-09', 'fast_day'));
check('תענית בכורות (ערב פסח בחו"ל) אינה תענית ציבור', !has('2026-04-01', 'fast_day', { isInIsrael: false }));
check('שבת/מוצאי שבת: shabbat רק בשבת (שנתיים)', (function () {
  for (let d = new Date(2026, 0, 1); d < new Date(2028, 0, 1); d.setDate(d.getDate() + 1)) {
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (has(iso, 'shabbat') !== (d.getDay() === 6)) return false;
    if (has(iso, 'motzaei_shabbat') !== (d.getDay() === 0)) return false;
  }
  return true;
})());
check('ערבית ביום ה\' בלילה שלפני תענית (17 בתמוז): אין "ועננו"', (function () {
  // ערבית של ליל 17 בתמוז נגזרת מהיום 17 בתמוז (fast_day) — ועננו אינו נאמר בערבית.
  for (const n of ['ashkenaz', 'sfard']) {
    const r = render('2026-07-02', n, 'arvit');
    if (plain(r.html).indexOf('ועננו בורא עולם') >= 0) return false;
  }
  return true;
})());
check('מנחה בתענית: "ועננו" נאמר', plain(render('2026-07-02', 'sfard', 'mincha').html).indexOf('ועננו בורא עולם') >= 0);

console.log('\n── ותן טל ומטר ──');
check('א"י: ג\' תשרי..כ"ג בתשרי — ותן ברכה (4.10.2026 = כ"ג תשרי)', !has('2026-10-04', 'tal_umatar') && !has('2026-10-03', 'tal_umatar') && !has('2026-10-10', 'tal_umatar'));
check('א"י: ו\' מרחשוון — עדיין ותן ברכה', !has('2026-10-17', 'tal_umatar') && has('2026-10-17', 'mashiv_haruach'));
check('א"י: ז\' מרחשוון (19.10.2026... לפי התאריך) מתחיל ותן טל ומטר', (function () {
  // מצא את ז' מרחשוון 5787 ואת היום שלפניו.
  const d7 = vm.runInContext(`(function(){var h=new hebcal.HDate(7, hebcal.months.CHESHVAN, 5787);var g=h.greg();return g.getFullYear()+'-'+String(g.getMonth()+1).padStart(2,'0')+'-'+String(g.getDate()).padStart(2,'0');})()`, ctx);
  const d6 = vm.runInContext(`(function(){var h=new hebcal.HDate(6, hebcal.months.CHESHVAN, 5787);var g=h.greg();return g.getFullYear()+'-'+String(g.getMonth()+1).padStart(2,'0')+'-'+String(g.getDate()).padStart(2,'0');})()`, ctx);
  return has(d7, 'tal_umatar') && !has(d6, 'tal_umatar');
})());
check('חו"ל 2026 (2027 לא מעוברת): יום ראשון 5.12; 4.12 עדיין לא', !has('2026-12-04', 'tal_umatar', { isInIsrael: false }) && has('2026-12-05', 'tal_umatar', { isInIsrael: false }));
check('חו"ל 2027 (2028 מעוברת): יום ראשון 6.12; 5.12 עדיין לא', !has('2027-12-05', 'tal_umatar', { isInIsrael: false }) && has('2027-12-06', 'tal_umatar', { isInIsrael: false }));
check('חו"ל: אוקטובר/נובמבר — ותן ברכה', !has('2026-10-04', 'tal_umatar', { isInIsrael: false }) && !has('2026-11-20', 'tal_umatar', { isInIsrael: false }));
check('משיב הרוח מכ"ב בתשרי (שמיני עצרת) עד י"ד בניסן', (function () {
  function iso(day, month, year) {
    return vm.runInContext('(function(){var g=new hebcal.HDate(' + day + ', hebcal.months.' + month + ', ' + year +
      ').greg();return g.getFullYear()+"-"+String(g.getMonth()+1).padStart(2,"0")+"-"+String(g.getDate()).padStart(2,"0");})()', ctx);
  }
  return has(iso(22, 'TISHREI', 5787), 'mashiv_haruach') && !has(iso(21, 'TISHREI', 5787), 'mashiv_haruach') &&
    has(iso(14, 'NISAN', 5787), 'mashiv_haruach') && !has(iso(15, 'NISAN', 5787), 'mashiv_haruach');
})());

console.log('\n── אבינו מלכנו ──');
function amHeaders(html) { return (html.match(/<h3[^>]*>[^<]*אבינו מלכנו[^<]*<\/h3>/g) || []).length; }
function amLines(html) {
  const t = plain(html);
  return {
    katvenu: (t.match(/אבינו מלכנו כתבנו בספר/g) || []).length,
    zochrenu: (t.match(/אבינו מלכנו זכרנו ל/g) || []).length,   // "זכרנו לחיים/לגאולה…" (לא "זכרנו בזכרון טוב" הקבוע)
    chadesh: (t.match(/אבינו מלכנו חדש עלינו/g) || []).length,
    barech: (t.match(/אבינו מלכנו ברך עלינו/g) || []).length,
  };
}
NUSACHIM.forEach(function (n) {
  const ayt = render('2026-09-15', n, 'shacharit');      // ד' תשרי (שלישי)
  const hA = amHeaders(ayt.html), lA = amLines(ayt.html);
  check(n + ' עשי"ת שחרית: קטע אחד בלבד', hA === 1, 'headers=' + hA);
  if (n !== 'edot_mizrach' || lA.katvenu + lA.zochrenu > 0) {
    check(n + ' עשי"ת: "כתבנו" ולא "זכרנו"; "חדש" ולא "ברך"', lA.katvenu >= 1 && lA.zochrenu === 0 && lA.chadesh === 1 && lA.barech === 0, JSON.stringify(lA));
  }
  check(n + ' עשי"ת מנחה: קטע אחד', amHeaders(render('2026-09-15', n, 'mincha').html) === 1);
  check(n + ' יום חול רגיל: אין אבינו מלכנו', amHeaders(render('2026-11-03', n, 'shacharit').html) === 0 && amHeaders(render('2026-11-03', n, 'mincha').html) === 0);
  check(n + ' צום גדליה (עשי"ת): שחרית ומנחה, כתבנו בלבד', (function () {
    const a = render('2026-09-14', n, 'shacharit').html, b = render('2026-09-14', n, 'mincha').html;
    const la = amLines(a), lb = amLines(b);
    return amHeaders(a) === 1 && amHeaders(b) === 1 && la.zochrenu === 0 && lb.zochrenu === 0 && la.barech === 0 && lb.barech === 0;
  })());
  check(n + ' ערב יום כיפור (ט\' תשרי): אין אבינו מלכנו', amHeaders(render('2026-09-20', n, 'shacharit').html) === 0 && amHeaders(render('2026-09-20', n, 'mincha').html) === 0);
});
['ashkenaz', 'sfard'].forEach(function (n) {
  const s = render('2026-07-02', n, 'shacharit').html, m = render('2026-07-02', n, 'mincha').html;
  check(n + ' י"ז בתמוז: אבינו מלכנו במנחה בלבד', amHeaders(s) === 0 && amHeaders(m) === 1);
  const lm = amLines(m);
  check(n + ' י"ז בתמוז מנחה: "זכרנו" ולא "כתבנו"; "ברך" ולא "חדש"', lm.zochrenu >= 1 && lm.katvenu === 0 && lm.barech === 1 && lm.chadesh === 0, JSON.stringify(lm));
});
check('תשעה באב: אין אבינו מלכנו', amHeaders(render('2026-07-23', 'sfard', 'mincha').html) === 0 && !has('2026-07-23', 'avinu_malkeinu'));
check('שבת שובה (שבת בעשי"ת): הדגל לא מופעל', !has('2026-09-19', 'avinu_malkeinu') && !has('2026-09-19', 'avinu_malkeinu_ayt'));
check('דגלי אבינו מלכנו: ערב יה"כ לא; עשי"ת כן; תענית ציבור (לא עשי"ת) — fast בלבד', !has('2026-09-20', 'avinu_malkeinu') &&
  has('2026-09-16', 'avinu_malkeinu_ayt') && has('2026-07-02', 'avinu_malkeinu_fast') && !has('2026-07-02', 'avinu_malkeinu_ayt'));

console.log('\n── מצב "לא במניין" ──');
NUSACHIM.forEach(function (n) {
  const r = render('2026-07-02', n, 'shacharit', { withMinyan: false });
  const t = plain(r.html);
  check(n + ': אין קדיש/ברכו גלויים; י"ג מידות נשארו ליחיד', !/יתגדל ויתקדש/.test(t) && !/ברכו את יהוה המבורך/.test(t) &&
    /יהוה יהוה אל רחום וחנון/.test(t));
  const a = plain(render('2026-11-03', n, 'arvit', { withMinyan: false }).html);
  check(n + ' ערבית: אין "יתגדל ויתקדש" ואין "ברכו את יהוה המבורך"', !/יתגדל ויתקדש/.test(a) && !/ברכו את יהוה המבורך/.test(a));
});

console.log('\n── קריאת התורה: הלוי — הפסוק מוכפל (בלי הוראת "חוזר מ") ──');
(function () {
  // יום ראשון... ראש חודש חול: ב' בכסלו? — נבחר ר"ח כסלו 5787 (13.11.2026, ו'? — לפי hebcal).
  const rcIso = vm.runInContext(`(function(){var h=new hebcal.HDate(1, hebcal.months.KISLEV, 5787);var g=h.greg();return g.getFullYear()+'-'+String(g.getMonth()+1).padStart(2,'0')+'-'+String(g.getDate()).padStart(2,'0');})()`, ctx);
  const u = Object.assign({}, BASE, { nusach: 'ashkenaz' });
  const segs = vm.runInContext(
    `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(rcIso + 'T12:00:00')}),${JSON.stringify(u)});` +
    `return SiduronAssembler.assemble('shacharit_ashkenaz',${JSON.stringify(u)},df);})()`, ctx);
  const seg = segs.filter(function (s) { return s.id === 'kriah_rc'; })[0];
  if (!seg) { check('מקטע kriah_rc נמצא בהרכבת ר"ח', false, rcIso); return; }
  const t = plain(seg.resolvedText);
  check('אין הוראה "חוזר מ" בקריאת ר"ח', t.indexOf('חוזר מ') < 0);
  const m = t.match(/ואמרת להם זה האשה/g) || [];
  check('הפסוק "ואמרת להם זה האשה" מופיע פעמיים (לפני ואחרי "לוי")', m.length === 2, 'count=' + m.length);
})();

console.log('\n── פורים: שושן פורים (מצב ברירת מחדל) הוא יום רגיל לקריאה ──');
(function () {
  // 15 באדר 5787 (שנה מעוברת: אדר ב')
  const iso = vm.runInContext(`(function(){var h=new hebcal.HDate(15, hebcal.months.ADAR_II, 5787);var g=h.greg();return g.getFullYear()+'-'+String(g.getMonth()+1).padStart(2,'0')+'-'+String(g.getDate()).padStart(2,'0');})()`, ctx);
  const f = flagsFor(iso);
  const dow = vm.runInContext(`new Date(${JSON.stringify(iso + 'T12:00:00')}).getDay()`, ctx);
  check('שושן פורים: לא "פורים" (פורים בי"ד), יש שושן פורים', f.flags.indexOf('purim') < 0 && f.flags.indexOf('shushan_purim') >= 0, iso);
  check('שושן פורים: ק"ת רק אם ב\'/ה\'', (f.flags.indexOf('kriat_hatorah') >= 0) === (dow === 1 || dow === 4 || dow === 6), 'dow=' + dow);
  const f2 = flagsFor(iso, { purimDate: 'fifteenth' });
  check('purimDate=fifteenth: ט"ו באדר הוא פורים עם ק"ת פורים', f2.flags.indexOf('purim') >= 0 && f2.flags.indexOf('kriat_hatorah_purim') >= 0);
})();

console.log('\n── ליל שבת / מוצאי שבת: דגלי היום ש"פותח" את הלילה ──');
check('ליל שבת = דגלי שבת (ערבית בכניסת שבת)', has('2026-07-04', 'shabbat'));
check('מוצאי שבת = ראשון, flag motzaei_shabbat', has('2026-07-05', 'motzaei_shabbat') && !has('2026-07-05', 'shabbat'));
check('ערבית של מוצאי שבת: אתה חוננתנו/הבדלה מופיעים', plain(render('2026-07-05', 'sfard', 'arvit').html).length > plain(render('2026-07-06', 'sfard', 'arvit').html).length);
check('יום שישי חול: erev_shabbat, ללא shabbat', has('2026-07-03', 'erev_shabbat') && !has('2026-07-03', 'shabbat'));

console.log('\n── בה"ב: דגלי לוח + סליחות (שנתיים) ──');
(function () {
  const BH = [
    ['2025-11-03', 'bahab_sheni_kama'], ['2025-11-06', 'bahab_chamishi'], ['2025-11-10', 'bahab_sheni_batra'],
    ['2026-04-27', 'bahab_sheni_kama'], ['2026-04-30', 'bahab_chamishi'], ['2026-05-04', 'bahab_sheni_batra'],
    ['2026-10-19', 'bahab_sheni_kama'], ['2026-10-22', 'bahab_chamishi'], ['2026-10-26', 'bahab_sheni_batra'],
    ['2027-05-17', 'bahab_sheni_kama'], ['2027-05-20', 'bahab_chamishi'], ['2027-05-24', 'bahab_sheni_batra'],
  ];
  BH.forEach(function (b) {
    check('בה"ב ' + b[0] + ' → ' + b[1] + ' + bahab_day', has(b[0], b[1]) && has(b[0], 'bahab_day'));
  });
  ['2025-11-17', '2025-10-20', '2026-03-30', '2026-05-11', '2026-11-02'].forEach(function (d) {
    check('יום רגיל ' + d + ' בלי דגל בה"ב', !has(d, 'bahab_day'));
  });
  // סליחות בה"ב: מוצגות בשחרית ספרד (קיים טקסט), רק ביום המתאים; באשכנז/עדות אין טקסט מלא — אין שינוי.
  const base = render('2025-11-17', 'sfard', 'shacharit').html.length;
  BH.slice(0, 3).concat(BH.slice(6, 9)).forEach(function (b) {
    const L = render(b[0], 'sfard', 'shacharit').html.length;
    check('ספרד ' + b[0] + ': סליחות בה"ב מוצגות (ארוך משחרית רגילה)', L - base > 3000, 'delta=' + (L - base));
  });
  const a1 = render('2025-11-17', 'ashkenaz', 'shacharit').html.length;
  const a2 = render('2025-11-03', 'ashkenaz', 'shacharit').html.length;
  check('אשכנז: אין תוספת סליחות בה"ב', Math.abs(a2 - a1) < 3000, 'delta=' + (a2 - a1));
})();

// ── אבינו מלכנו: ר"ה / יה"כ / ערב שבת ──
console.log('\n── אבינו מלכנו: ר"ה, יום כיפור, ערב שבת ──');
NUSACHIM.forEach(function (n) {
  check(n + ' ר"ה (ב\' תשרי): אין אבינו מלכנו בשחרית ובמנחה', amHeaders(render('2026-09-13', n, 'shacharit').html) === 0 &&
    amHeaders(render('2026-09-13', n, 'mincha').html) === 0 && !has('2026-09-13', 'avinu_malkeinu_ayt') && !has('2026-09-13', 'avinu_malkeinu'));
  check(n + ' יום כיפור: אבינו מלכנו בשחרית בלבד', amHeaders(render('2026-09-21', n, 'shacharit').html) === 1 &&
    amHeaders(render('2026-09-21', n, 'mincha').html) === 0);
  check(n + ' שישי בעשי"ת: שחרית כן, מנחה לא', amHeaders(render('2026-09-18', n, 'shacharit').html) === 1 &&
    amHeaders(render('2026-09-18', n, 'mincha').html) === 0);
  check(n + ' שלישי בעשי"ת: מנחה עדיין כן', amHeaders(render('2026-09-15', n, 'mincha').html) === 1);
});

// ── לדוד ה' אורי: מר"ח אלול עד הושענא רבה כולל ──
console.log('\n── לדוד ה\' אורי ──');
const LD_RE = /לדוד (?:ה\S*|יהוה|יי) אורי וישעי/;
function hasLd(html) { return LD_RE.test(plain(html)); }
function shab(iso, nusach, svc) {
  const u = Object.assign({}, BASE, { nusach: nusach });
  return vm.runInContext(
    `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T12:00:00')}),${JSON.stringify(u)});` +
    `return SiduronServices.renderShabbat(${JSON.stringify(nusach)},${JSON.stringify(svc)},df);})()`, ctx).html;
}
check('דגל ladavid_season: ר"ח אלול כן; כ"א תשרי (הושענא רבה) כן; כ"ב תשרי לא; תמוז לא',
  has('2026-08-14', 'ladavid_season') && has('2026-10-02', 'ladavid_season') &&
  !has('2026-10-03', 'ladavid_season') && !has('2026-07-18', 'ladavid_season'));
['shacharit', 'maariv'].forEach(function (svc) {
  check('אשכנז שבת ' + svc + ': לדוד ה\' אורי באלול', hasLd(shab('2026-08-15', 'ashkenaz', svc)));
  check('אשכנז שבת ' + svc + ': לדוד ה\' אורי בעשי"ת', hasLd(shab('2026-09-19', 'ashkenaz', svc)));
  check('אשכנז שבת ' + svc + ': אין לדוד ה\' אורי בתמוז', !hasLd(shab('2026-07-18', 'ashkenaz', svc)));
  check('אשכנז שבת ' + svc + ': אין לדוד ה\' אורי אחרי הושענא רבה', !hasLd(shab('2026-10-10', 'ashkenaz', svc)));
  check('אשכנז שבת ' + svc + ': אין לדוד ה\' אורי בחשוון/כסלו', !hasLd(shab('2026-11-07', 'ashkenaz', svc)));
});
check('אשכנז חול שחרית: לדוד ה\' אורי בעשי"ת ובהושענא רבה, לא אחרי / לא בחודש רגיל',
  hasLd(render('2026-09-15', 'ashkenaz', 'shacharit').html) && hasLd(render('2026-10-02', 'ashkenaz', 'shacharit').html) &&
  !hasLd(render('2026-10-05', 'ashkenaz', 'shacharit').html) && !hasLd(render('2026-11-03', 'ashkenaz', 'shacharit').html));

// ── ABBR_RE: המרת ה' קצר לשם ה' — רק כשזה באמת השם ──
console.log('\n── המרת ה\' קצר (ABBR_RE) ──');
(function () {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const a = src.indexOf('var ABBR_RE'), b = src.indexOf('function renderAbbrName');
  const c = src.indexOf('function applyDivineName'), d = src.indexOf('// Plain-text variant');
  if (a < 0 || b < 0 || c < 0 || d < 0) { check('חילוץ ABBR_RE מ-app.js', false); return; }
  const code = src.slice(a, b) + 'function renderAbbrName(mode){return mode==="yy"?"יי":"ה׳";}\n' +
    'var TETRA_RE=/$^/g, MARK_RE=/\\p{Mn}/u, STATE={divineName:"yy"};\n' +
    'function hasThreeLettersBefore(){return false;}\n' + src.slice(c, d) +
    '\nthis.__conv = applyDivineName;';
  const sb = {}; vm.createContext(sb); vm.runInContext(code, sb);
  const conv = sb.__conv;
  const keep = ["תהלים ה'", "שמות כד, ה'", "תהלים קיט, ה'", "(ה')", "ליל ה'", "ה' באייר", "ה' בניסן", "פרק ה'",
    "יום ה'", "ד' ה' ו'", "ויקרא כג, ה'", "במדבר ה'"];
  keep.forEach(function (t) { check('לא מומר: ' + t, conv(t) === t, conv(t)); });
  const change = ["ה' אלהי", "לה' הארץ", "וה' אמר", "הודו לה'", "ברוך אתה, ה' אלהינו", "ויאמר ה' אל משה"];
  change.forEach(function (t) { check('מומר: ' + t, conv(t) !== t && conv(t).indexOf('יי') >= 0, conv(t)); });
})();

// ── הושענות: חוה"מ סוכות (חול + שבת) והושענא רבה, כל נוסח ──
console.log('\n── הושענות (data-overrides/hoshanot_*.json) ──');
(function () {
  const OVD = path.join(ROOT, 'tools/data-overrides');
  const items = {};
  NUSACHIM.forEach(function (n) { items[n] = JSON.parse(fs.readFileSync(path.join(OVD, 'hoshanot_' + n + '.json'), 'utf8')).items; });
  const norm = function (t) { return plain(String(t).replace(/ /g, ' ')); };
  function titles(n, id) {
    const it = items[n].find(function (x) { return x.id === id; });
    return it.segments.filter(function (s) { return s.kind === 'title'; }).map(function (s) { return norm(s.text); });
  }
  function navOf(iso, n, svc, shabbatSvc, over) {
    const u = Object.assign({}, BASE, { nusach: n }, over || {});
    const call = shabbatSvc ? 'renderShabbat' : 'render';
    return vm.runInContext(
      `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T12:00:00')}),${JSON.stringify(u)});` +
      `return SiduronServices.${call}(${JSON.stringify(n)},${JSON.stringify(svc)},df);})()`, ctx).nav.map(function (x) { return norm(x.label); });
  }
  function count(nav, t) { return nav.filter(function (x) { return x === t; }).length; }
  // 5787: ט"ו תשרי = שבת 26.9.2026 (יום 1), הושענא רבה = 2.10.2026; שבת חוה"מ = 11.10.2025 (יום 5 של 5786).
  const DAYS = { 2: '2026-09-27', 3: '2026-09-28', 4: '2026-09-29', 5: '2026-09-30', 6: '2026-10-01' };
  const HR = '2026-10-02', SHABBAT_CHM = '2025-10-11';
  const ALLT = {};
  NUSACHIM.forEach(function (n) {
    ALLT[n] = {};
    items[n].forEach(function (it) { ALLT[n][it.id] = titles(n, it.id); });
  });
  ALLT.edot_mizrach.hoshana_rabba = [norm('הושענות להושענא רבה')];   // הכותרת הוחלפה (במקור: שם מחזור)

  NUSACHIM.forEach(function (n) {
    Object.keys(DAYS).forEach(function (d) {
      const nav = navOf(DAYS[d], n, 'shacharit');
      const mine = n === 'sfard' ? ALLT[n].chol_hamoed : ALLT[n]['day' + d];
      check(n + ' שחרית יום ' + d + ' דחוה"מ: ההושענות של היום מופיעות פעם אחת',
        mine.every(function (t) { return count(nav, t) === 1; }), JSON.stringify(mine.map(function (t) { return count(nav, t); })));
      if (n !== 'sfard') {
        check(n + ' שחרית יום ' + d + ': לא מופיעות הושענות של יום אחר / הושענא רבה / שבת',
          Object.keys(DAYS).filter(function (x) { return x !== d; }).every(function (x) { return count(nav, ALLT[n]['day' + x][0]) === 0; }) &&
          count(nav, ALLT[n].hoshana_rabba[0]) === 0 && count(nav, ALLT[n].shabbat[0]) === 0);
      } else {
        check(n + ' שחרית יום ' + d + ': אין הושענא רבה/שבת', count(nav, ALLT[n].hoshana_rabba[0]) === 0 && count(nav, ALLT[n].shabbat[0]) === 0);
      }
      check(n + ' שחרית יום ' + d + ': אין כותרת "הושענות" כפולה מהקורפוס הישן', count(nav, norm('הושענות')) === 0);
    });
    const hr = navOf(HR, n, 'shacharit');
    check(n + ' שחרית הושענא רבה: סדר הושענא רבה פעם אחת, בלי ימי חוה"מ',
      count(hr, ALLT[n].hoshana_rabba[0]) === 1 &&
      (n === 'sfard' ? count(hr, ALLT[n].chol_hamoed[0]) === 0 : [2, 3, 4, 5, 6].every(function (d) { return count(hr, ALLT[n]['day' + d][0]) === 0; })));
    const sh = navOf(SHABBAT_CHM, n, 'shacharit', true);
    check(n + ' שחרית שבת חוה"מ: הושענות לשבת פעם אחת, לא של חול ולא הושענא רבה',
      ALLT[n].shabbat.every(function (t) { return count(sh, t) === 1; }) &&
      count(sh, ALLT[n].hoshana_rabba[0]) === 0 &&
      (n === 'sfard' ? count(sh, ALLT[n].chol_hamoed[0]) === 0 : count(sh, ALLT[n].day5[0]) === 0));
    const every = [];
    Object.keys(ALLT[n]).forEach(function (id) { ALLT[n][id].forEach(function (t) { every.push(t); }); });
    ['2026-11-03', '2026-10-03', '2026-04-01', '2026-12-10', '2026-09-20'].forEach(function (iso) {
      const nav = navOf(iso, n, 'shacharit');
      check(n + ' שחרית ' + iso + ' (לא חוה"מ סוכות): אין הושענות', every.every(function (t) { return count(nav, t) === 0; }));
    });
    const shOut = navOf('2026-11-07', n, 'shacharit', true);
    check(n + ' שחרית שבת רגילה: אין הושענות', every.every(function (t) { return count(shOut, t) === 0; }));
    const mn = navOf(DAYS[3], n, 'mincha');
    check(n + ' מנחה בחוה"מ סוכות: אין הושענות', every.every(function (t) { return count(mn, t) === 0; }));
  });
  const abroad = navOf(DAYS[3], 'ashkenaz', 'shacharit', false, { isInIsrael: false });
  check('אשכנז חו"ל: שחרית יום 3 — הושענות של יום 3 פעם אחת', count(abroad, ALLT.ashkenaz.day3[0]) === 1);
  check('דגלי sukkot_day_N וגם hoshana_raba בהושענא רבה', has(HR, 'sukkot_day_7') && has(HR, 'hoshana_raba') && has(DAYS[2], 'sukkot_day_2') && !has(DAYS[2], 'hoshana_raba'));
  check('evalTag: sukkotDayN לפי הדגל בלבד', (function () {
    const ev = vm.runInContext('SiduronServices._evalTag', ctx);
    return ev('sukkotDay3', function (f) { return f === 'sukkot_day_3'; }) === true &&
      ev('sukkotDay3', function (f) { return f === 'sukkot_day_4'; }) === false;
  })());
})();

console.log('\n=== LOGIC: ' + (fail ? 'FAIL' : 'PASS') + ' (' + pass + ' passed, ' + fail + ' failed) ===');
process.exit(fail ? 1 : 0);
