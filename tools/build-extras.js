/* build-extras.js — ports a curated set of standalone prayers/brachot from the
 * Tfilon corpus (decompiled APK assets) into data/extras-data.js.
 *
 * Tfilon stores each prayer as plain vocalized Hebrew text with a small markup:
 *   ()path [cond]      recursive include, optionally gated by a condition tag
 *   (: ... :)          instruction / rubric
 *   ([ ... ])          special-day insert (shown styled, like a printed rubric)
 *   (--- ... ---)      winter (Mashiv haRuach) insert
 *   (=== ... ===)      summer (Morid haTal) insert
 *   -----Heading       section header / skip anchor
 * Encoding quirks: '~' = pre-censored divine name (remove → full name),
 *   'K' = kamatz-katan marker (→ a kamatz vowel), ';' = sof-pasuk (→ ':').
 *
 * Conditions are evaluated at RUNTIME (js/extras.js) against the day's flags.
 *
 * Run:  node tools/build-extras.js
 * Out:  data/extras-data.js   (window.SIDDUR_EXTRAS)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createParser, isForbidden } = require('./lib/tfilon');

const ROOT = path.resolve(__dirname, '..');
const TF = path.join(ROOT, 'tfilon.tfilon_38_1734630-1', 'assets');
const SS = path.join(ROOT, 'smart-siddur', 'assets', 'prayers');
const OUT = path.join(ROOT, 'data', 'extras-data.js');
const tfilon = createParser(TF);

// ── Curated extras. Each maps a stable id+title+category to per-nusach entry
// files (Tfilon prefixes a_=Ashkenaz, s_=Sefard, em_=Edot Mizrach). ──────────
const EXTRAS = [
  { id: 'birkat_hamazon', title: 'ברכת המזון', category: 'ברכות הנהנין',
    files: { ashkenaz: 'a_mazon', sfard: 's_mazon', edot_mizrach: 'em_mazon' } },
  { id: 'meein_shalosh', title: 'ברכה מעין שלוש (על המחיה)', category: 'ברכות הנהנין',
    files: { ashkenaz: 'a_shalosh', sfard: 's_shalosh', edot_mizrach: 'em_shalosh' } },
  { id: 'borei_nefashot', title: 'בורא נפשות', category: 'ברכות הנהנין',
    files: { ashkenaz: 'a_nefashot', sfard: 's_nefashot', edot_mizrach: 'em_nefashot' } },
  { id: 'asher_yatzar', title: 'אשר יצר', category: 'ברכות הנהנין', smartSiddur: 'asher_yatzar' },
  { id: 'tefilat_haderech', title: 'תפילת הדרך', category: 'תפילות',
    files: { ashkenaz: 'a_derech', sfard: 's_derech', edot_mizrach: 'em_derech' } },
  { id: 'kriat_shema_al_hamita', title: 'קריאת שמע שעל המיטה', category: 'תפילות',
    files: { ashkenaz: 'a_mita', sfard: 's_mita', edot_mizrach: 'em_mita' } },
  { id: 'kiddush_levana', title: 'קידוש לבנה', category: 'תפילות',
    files: { ashkenaz: 'a_levana', sfard: 's_levana', edot_mizrach: 'em_levana' } },
  { id: 'tikkun_chatzot', title: 'תיקון חצות', category: 'תפילות',
    files: { ashkenaz: 'tikun_chatzot', sfard: 'tikun_chatzot', edot_mizrach: 'tikun_chatzot' } },
  { id: 'avinu_malkenu', title: 'אבינו מלכנו', category: 'תפילות',
    files: { ashkenaz: 'a_avinuMalkenu', sfard: 's_avinuMalkenu', edot_mizrach: 'em_avinuMalkenu' } },
  { id: 'havdala', title: 'הבדלה', category: 'תפילות',
    files: { ashkenaz: 'a_havdala', sfard: 'a_havdala', edot_mizrach: 'em_havdala' } },
  { id: 'hadlakat_ner_chanukah', title: 'הדלקת נרות חנוכה', category: 'מועדים ואירועים',
    // a_nerot/em_nerot = ברכות + הנרות הללו + מעוז צור (fuller than chanukaBrachot alone)
    files: { ashkenaz: 'a_nerot', edot_mizrach: 'em_nerot' } },
  { id: 'sheva_brachot', title: 'שבע ברכות', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_shevaBrachot', sfard: 's_shevaBrachot', edot_mizrach: 'em_shevaBrachot' } },
  { id: 'brit_milah', title: 'סדר ברית מילה', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_brit', sfard: 's_brit', edot_mizrach: 'em_brit' } },
  // ── Standalone prayers ported from the Tfilon corpus (nusach-shared unless noted;
  // missing nusachim fall back to ashkenaz in the renderer). ──────────────────
  { id: 'megillat_esther', title: 'מגילת אסתר', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_ester', edot_mizrach: 'em_ester_arvit' } },
  { id: 'megillat_eicha', title: 'מגילת איכה', category: 'מועדים ואירועים',
    files: { ashkenaz: 'eicha' } },
  { id: 'kinot_tisha_beav', title: 'קינות לליל תשעה באב', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_kinotNight' } },
  { id: 'vayiten_lecha', title: 'ויתן לך (מוצאי שבת)', category: 'תפילות',
    files: { ashkenaz: 'veyiten' } },
  { id: 'tefila_lecholeh', title: 'תפילה לרפואת חולה', category: 'תפילות',
    files: { ashkenaz: 'a_doctor' } },
];

const NIKUD = /[֑-ׇ]/g;

// ── Navigation sections ──────────────────────────────────────────────────────
// Inject jump-to-section headers (kind:'header') into long prayers so the
// "קפיצה לקטע" panel can navigate them. Each section is anchored to a segment
// whose nikud-stripped text contains one of `anyOf`.
//   mode 'first' (default): header before the FIRST matching segment only.
//   mode 'each': header before EVERY match — used for blocks that exist in
//     mutually-exclusive conditional variants (the opening psalm; the
//     Rosh-Chodesh/festival Ya'aleh-VeYavo). With inheritCond:true the header
//     carries its segment's cond, so it shows only when that variant shows.
const SECTIONS = {
  birkat_hamazon: [
    { label: 'מזמור פתיחה',  anyOf: ['על נהרות בבל', 'שיר המעלות בשוב'], mode: 'each', inheritCond: true },
    { label: 'זימון',         anyOf: ['שלשה שאכלו'] },
    { label: 'ברכת הזן',      anyOf: ['הזן את העולם', 'האל הזן אותנו'] },
    { label: 'ברכת הארץ',     anyOf: ['נודה לך'] },
    { label: 'בונה ירושלים',  anyOf: ['ועל ירושלים עירך'] },
    { label: 'יעלה ויבוא',    anyOf: ['יעלה ויבוא ויגיע'], mode: 'each', inheritCond: true },
    { label: 'הטוב והמטיב',   anyOf: ['הטוב והמטיב'] },
    { label: 'הרחמן',         anyOf: ['הרחמן הוא'] },
  ],
  kriat_shema_al_hamita: [
    { label: 'המפיל',     anyOf: ['המפיל חבלי שנה'] },      // edot only (ashk/sfard already have a source header)
    { label: 'קריאת שמע', anyOf: ['שמע ישראל'] },
    { label: 'וידוי',     anyOf: ['תבא לפניך תפלתנו'], inheritCond: true }, // recited on tachanun days only
    { label: 'אנא בכח',   anyOf: ['בכח גדלת ימינך'] },
  ],
  kiddush_levana: [
    { label: 'ברכת הלבנה', anyOf: ['אשר במאמרו ברא שחקים'] }, // (עלינו לשבח already a source header)
  ],
  brit_milah: [
    { label: 'ברוך הבא',   anyOf: ['ברוך הבא'] },
    { label: 'כסא אליהו',  anyOf: ['זה הכסא של אליהו'] },
    { label: 'ברכת המילה', anyOf: ['וצונו על המילה'] },
    { label: 'מתן שם',     anyOf: ['קים את'] },
  ],
};
function insertSections(itemId, segs) {
  const secs = SECTIONS[itemId];
  if (!secs) return segs;
  const existing = new Set(segs.filter(s => s.kind === 'header').map(s => s.text)); // headers already present from source
  const usedFirst = new Set();
  const out = [];
  for (const seg of segs) {
    const bare = (seg.text || '').replace(NIKUD, '');
    for (const sec of secs) {
      if (existing.has(sec.label)) continue;            // don't duplicate a source header
      const mode = sec.mode || 'first';
      if (mode === 'first' && usedFirst.has(sec.label)) continue;
      if (sec.anyOf.some(p => bare.includes(p))) {
        out.push({ kind: 'header', text: sec.label, cond: sec.inheritCond ? (seg.cond || []).slice() : [] });
        if (mode === 'first') usedFirst.add(sec.label);
        break; // at most one header per segment
      }
    }
    out.push(seg);
  }
  return out;
}

// Parse one Tfilon entry file → segment list, dropping any unresolved includes.
function parseFile(name, _condChain, _depth, out) {
  const segs = tfilon.parseEntry(name);
  for (const s of segs) {
    if (s.kind === 'missing') { console.log('  ! missing include:', s.text); continue; }
    out.push(s);
  }
}

// ── smart-siddur source for asher_yatzar (per-nusach or common segment) ──────
let _ssManifest = null;
function ssManifest() {
  return _ssManifest || (_ssManifest = JSON.parse(fs.readFileSync(path.join(SS, '_manifest.json'), 'utf8')));
}
function smartSiddurSegment(segId, nusach) {
  const m = ssManifest();
  const rel = (m.nusach[nusach] && m.nusach[nusach][segId]) || m.common[segId];
  if (!rel) return null;
  const seg = JSON.parse(fs.readFileSync(path.join(ROOT, 'smart-siddur', rel), 'utf8'));
  const text = (seg.sections || []).map(s => Array.isArray(s.text) ? s.text.join(' ') : s.text).filter(Boolean).join('\n');
  return text ? [{ kind: 'text', text: text, cond: [] }] : null;
}

// ── Build ─────────────────────────────────────────────────────────────────────
const items = [];
for (const ex of EXTRAS) {
  const byNusach = {};
  for (const nusach of ['ashkenaz', 'sfard', 'edot_mizrach']) {
    let segs;
    if (ex.smartSiddur) segs = smartSiddurSegment(ex.smartSiddur, nusach);
    else {
      const file = ex.files[nusach];
      segs = [];
      if (file) parseFile(file, [], 0, segs);   // nusach not provided → leave empty (renderer falls back to ashkenaz)
      if (!segs.length) segs = null;
    }
    if (segs) segs = segs.filter(seg => !isForbidden(seg.text));
    if (segs && segs.length) segs = insertSections(ex.id, segs);
    if (segs && segs.length) byNusach[nusach] = segs;
  }
  if (Object.keys(byNusach).length) {
    items.push({ id: ex.id, title: ex.title, category: ex.category, nusachim: byNusach });
  } else {
    console.log('  ! no content for', ex.id);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const header = '/* extras-data.js — GENERATED by tools/build-extras.js. Do not edit by hand.\n' +
  ' * Standalone prayers ported from the Tfilon corpus (+ asher_yatzar from smart-siddur).\n */\n';
fs.writeFileSync(OUT, header + 'window.SIDDUR_EXTRAS = ' + JSON.stringify({ items: items }) + ';\n', 'utf8');

const bytes = fs.statSync(OUT).size;
console.log('Wrote', path.relative(ROOT, OUT), '(' + (bytes / 1024).toFixed(0) + ' KB)');
items.forEach(it => {
  const ns = Object.keys(it.nusachim);
  const segCount = ns.map(n => it.nusachim[n].length);
  console.log('  ' + it.id.padEnd(22) + ' [' + ns.join(',') + '] segs=' + segCount.join('/'));
});
