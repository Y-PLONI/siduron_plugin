/* catalog.js — רשימת התפילות הראשיות והנוסחים. */
(function (global) {
  'use strict';

  // סדר העדפת סיומות לכל נוסח (הראשון שקיים נבחר)
  var NUSACHIM = [
    { id: 'edot', he: 'עדות המזרח', suffixes: ['', 'Sf'] },
    { id: 'sefard', he: 'ספרד', suffixes: ['Sf', ''] },
    { id: 'teiman', he: 'תימן', suffixes: ['Tm'] },
    { id: 'ashkenaz', he: 'אשכנז', suffixes: ['Ash'] }
  ];

  // התפילות הראשיות. baseId = שם הקובץ ללא סיומת נוסח.
  var SERVICES = [
    { base: 'Shaharit', he: 'שחרית' },
    { base: 'Minha', he: 'מנחה' },
    { base: 'Arvit', he: 'ערבית' },
    { base: 'MusafHodesh', he: 'מוסף לראש חודש' },
    { base: 'MusafRegel', he: 'מוסף לרגל' },
    { base: 'Amida', he: 'עמידה' },
    { base: 'ShmaOnBed', he: 'קריאת שמע על המיטה' },
    { base: 'BirkatMazon', he: 'ברכת המזון' },
    { base: 'FullHalel', he: 'הלל' },
    { base: 'Slihot', he: 'סליחות' },
    { base: 'AvinuMalkenu', he: 'אבינו מלכנו' },
    { base: 'Ashrei', he: 'אשרי' },
    { base: 'Aleinu', he: 'עלינו לשבח' },
    { base: 'Ketoret', he: 'קטורת' },
    { base: 'MegilatEster', he: 'מגילת אסתר' }
  ];

  // מאתר את שם הקובץ הקיים עבור (base, נוסח).
  function resolve(base, nusach, has) {
    var n = NUSACHIM.filter(function (x) { return x.id === nusach; })[0] || NUSACHIM[0];
    var tries = [];
    n.suffixes.forEach(function (s) { tries.push(base + s); });
    // גיבוי: כל הסיומות
    ['', 'Sf', 'Tm', 'Ash'].forEach(function (s) {
      if (tries.indexOf(base + s) < 0) tries.push(base + s);
    });
    for (var i = 0; i < tries.length; i++) if (has(tries[i])) return tries[i];
    return null;
  }

  global.SiduronCatalog = { NUSACHIM: NUSACHIM, SERVICES: SERVICES, resolve: resolve };
})(typeof window !== 'undefined' ? window : this);
