/* conditions.js — בונה הקשר תאריך מנתוני אוצריא ומסווג תוספות מותנות.
 * הסיווג קובע אם תוספת חלה היום (applies=true/false) או לא ודאי (null).
 * עיקרון בטיחות: כשלא ניתן להכריע — applies=null והתוכן מוצג במלואו.
 */
(function (global) {
  'use strict';

  // קודי חודש כפי שמופיעים בשמות קובצי העומר: ניסן=9, אייר=10, סיון=11
  var OMER_MONTH_CODE = { 'ניסן': 9, 'אייר': 10, 'סיון': 11, 'סיוון': 11 };

  // סדר החודשים מתשרי (לקביעת עונת טל/גשם)
  var MONTH_ORDER = {
    'תשרי': 1, 'חשון': 2, 'חשוון': 2, 'מרחשון': 2, 'מרחשוון': 2,
    'כסלו': 3, 'טבת': 4, 'שבט': 5, 'אדר': 6, 'אדר א': 6, "אדר א'": 6,
    'אדר ב': 7, "אדר ב'": 7, 'ניסן': 8, 'אייר': 9, 'סיון': 10, 'סיוון': 10,
    'תמוז': 11, 'אב': 12, 'אלול': 13
  };

  function normMonth(name) { return (name || '').replace(/['"]/g, '').trim(); }

  // בונה הקשר תאריך נוח מתוך JewishDate + holidays + יום בשבוע.
  function buildContext(jd, isoDate) {
    jd = jd || {};
    var month = normMonth(jd.monthName);
    var day = jd.day || jd.numericDay || 0;
    var holidays = jd.holidays || [];
    var kinds = holidays.map(function (h) { return h.kind; });
    var texts = holidays.map(function (h) { return h.text || ''; }).join(' | ');

    function hasText(re) { return re.test(texts); }

    var dow = 0; // 0=ראשון .. 6=שבת
    try { dow = new Date(isoDate || jd.gregorian).getDay(); } catch (e) {}

    var isShabbat = !!jd.isShabbat || dow === 6;
    var isRoshChodesh = kinds.indexOf('roshChodesh') >= 0 || day === 30 || day === 1 || hasText(/ראש חודש/);
    var isYomTov = kinds.indexOf('yomTov') >= 0;
    var isTaanit = kinds.indexOf('taanit') >= 0 || hasText(/צום|תענית|עשרה בטבת|שבעה עשר|תשעה באב|גדליה|אסתר/);
    var isCholHamoed = hasText(/חול ?המועד/);
    var isChanukah = hasText(/חנוכה/);
    var isPurim = hasText(/פורים/);
    var isPesach = hasText(/פסח/);
    var isSukkot = hasText(/סוכות|סכות/);

    // עשרת ימי תשובה: א'–י' תשרי
    var isAseret = (month === 'תשרי' && day >= 1 && day <= 10);

    // עונת גשם: ממוסף שמיני עצרת (כב' תשרי) עד שחרית א' דפסח (טו' ניסן)
    var ord = MONTH_ORDER[month] || 0;
    var geshem;
    if (ord === 1) geshem = day >= 22;            // תשרי
    else if (ord >= 2 && ord <= 7) geshem = true; // חשון..אדר
    else if (ord === 8) geshem = day < 15;        // ניסן (עד טו')
    else geshem = false;                          // אייר..אלול

    // ספירת העומר: טז' ניסן (יום 1) .. ה' סיון (יום 49)
    var omerDay = 0, omerCode = 0;
    if (month === 'ניסן' && day >= 16) { omerDay = day - 15; }
    else if (month === 'אייר') { omerDay = 15 + day; }
    else if ((month === 'סיון' || month === 'סיוון') && day <= 5) { omerDay = 44 + day; }
    if (omerDay > 0) omerCode = OMER_MONTH_CODE[month] || 0;

    return {
      jd: jd, month: month, day: day, dow: dow,
      isShabbat: isShabbat, isRoshChodesh: isRoshChodesh, isYomTov: isYomTov,
      isTaanit: isTaanit, isCholHamoed: isCholHamoed, isChanukah: isChanukah,
      isPurim: isPurim, isPesach: isPesach, isSukkot: isSukkot, isAseret: isAseret,
      geshem: geshem, omerDay: omerDay, omerCode: omerCode,
      isMotzashTime: dow === 0,          // מוצאי שבת ≈ ליל ראשון
      holidaysText: texts
    };
  }

  // קבוצות שמות שהן רכיבי קבע (תמיד נכללים).
  var ALWAYS = [
    /^HatziKadish/, /^KadishYehe/, /^KadishYatom/, /^KadishTitkabal/, /^KadishAlIsrael/,
    /^KadishDaatid/, /^KadishDrabanan/, /^Kadish/,
    /^Ashrei/, /^Amida$/, /^Amida(Sf|Tm|Ash)$/, /^Shma/, /^Alenu/, /^Aleinu/,
    /^ModimDrabanan/, /^Ketoret/, /^KetoretShort/, /^Cohanim/, /^AtaKadoshNormal/,
    /^KedushaNormal/, /^MishpatNormal/, /^Magdil$/, /^Migdol$/, /^Ata/, /^YehiShem/,
    /^SimShalom/, /^RachemNormal/, /^BarchenuSummer/, /^Lamnatzeah/, /^UvaLetzion/,
    /^MizmorLetoda/, /^ToraShaharit/, /^Halel$/, /^HalelTm$/, /^HalelAsh$/, /^HalelSf$/
  ];

  function matchAny(name, arr) {
    for (var i = 0; i < arr.length; i++) if (arr[i].test(name)) return true;
    return false;
  }

  // מסווג שם-קובץ מותנה -> {kind, applies, label}
  function makeClassifier(ctx) {
    return function classify(name) {
      var n = String(name || '');

      if (matchAny(n, ALWAYS)) return { kind: 'always', applies: null, label: '' };

      // ספירת העומר: Omer[suffix]_<day>_<code>
      var mO = n.match(/^Omer(?:Ash|Sf|Tm)?_(\d+)_(\d+)$/);
      if (mO) {
        var d = +mO[1], code = +mO[2];
        var applies = (ctx.omerDay > 0 && d === ctx.omerDay && code === ctx.omerCode);
        return { kind: 'omer', applies: applies, label: 'ספירת העומר — יום ' + d };
      }
      if (/^Omer(Ash|Sf|Tm)?$/.test(n)) {
        return { kind: 'omer', applies: ctx.omerDay > 0, label: 'ברכת ספירת העומר' };
      }

      // עשרת ימי תשובה
      if (/^Aseret(Ash|Sf|Tm)?\d+$/.test(n) || /^Aseret\d+$/.test(n)) {
        return { kind: 'aseret', applies: ctx.isAseret, label: 'תוספת לעשרת ימי תשובה' };
      }

      // יעלה ויבוא — ראש חודש / חול המועד / יום טוב
      if (/^YaaleVeyavo/.test(n)) {
        return { kind: 'yaale', applies: (ctx.isRoshChodesh || ctx.isCholHamoed || ctx.isYomTov),
          label: 'יעלה ויבוא (ר"ח / חוה"מ / יו"ט)' };
      }

      // על הנסים — חנוכה / פורים
      if (/^AlHanisim/.test(n)) {
        return { kind: 'alhanisim', applies: (ctx.isChanukah || ctx.isPurim), label: 'על הנסים' };
      }
      if (/^Hanuka/.test(n) || /^YomHanuka/.test(n) || /^ShirHanuka/.test(n)) {
        return { kind: 'hanuka', applies: ctx.isChanukah, label: 'חנוכה' };
      }
      if (/^Purim(14|15|Both|Ash|Sf|Tm)?$/.test(n) || /^Purim/.test(n)) {
        return { kind: 'purim', applies: ctx.isPurim, label: 'פורים' };
      }

      // עננו — תענית ציבור
      if (/^Anenu/.test(n)) {
        return { kind: 'anenu', applies: ctx.isTaanit, label: 'עננו (תענית ציבור)' };
      }

      // טל / גשם
      if (/Geshem/.test(n)) {
        return { kind: 'geshem', applies: ctx.geshem, label: 'מוריד הגשם (עונת החורף)' };
      }

      // מוצאי שבת
      if (/^Motza(sh|ei)/.test(n)) {
        return { kind: 'motzash', applies: ctx.isMotzashTime, label: 'מוצאי שבת' };
      }

      // ראש חודש (מוסף/ברכי נפשי וכו')
      if (/RoshHodesh|MusafHodesh|YomRoshHodesh|BarchiNafshi/.test(n)) {
        return { kind: 'roshchodesh', applies: ctx.isRoshChodesh, label: 'ראש חודש' };
      }

      // שיר של יום: Yom1..Yom7 / SYom1..6
      var mY = n.match(/^S?Yom(\d)(Tm|Sf|Ash)?(Tahanun)?$/);
      if (mY) {
        var ynum = +mY[1];
        return { kind: 'shir-yom', applies: (ynum === ctx.dow + 1), label: 'שיר של יום (יום ' + ynum + ')' };
      }

      // רגלים
      if (/^Pesah/.test(n)) return { kind: 'festival', applies: ctx.isPesach, label: 'פסח' };
      if (/^Sukot/.test(n)) return { kind: 'festival', applies: ctx.isSukkot, label: 'סוכות' };
      if (/^MusafRegel/.test(n)) return { kind: 'festival', applies: ctx.isYomTov, label: 'מוסף לרגל' };

      // ברירת מחדל: לא ידוע — מציגים במלואו
      return { kind: 'unknown', applies: null, label: '' };
    };
  }

  global.SiduronConditions = {
    buildContext: buildContext,
    makeClassifier: makeClassifier
  };
})(typeof window !== 'undefined' ? window : this);
