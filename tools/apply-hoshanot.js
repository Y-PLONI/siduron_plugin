/* apply-hoshanot.js — one-off, idempotent splice of the ready-made הושענות
 * (tools/data-overrides/hoshanot_<nusach>.json) into data/services-data.js
 * (weekday חוה"מ/הושענא רבה) and data/shabbat-data.js (שבת חוה"מ).
 *   node tools/apply-hoshanot.js
 * Replaces the old generic "sucot" הושענות block of each nusach (found by its
 * contiguous run of segments whose cond contains "sucot"/"hoshanaraba").
 * Day tags (sukkotDayN, dowNNN) are resolved in js/services.js evalTag.
 * Idempotent: every spliced segment carries `src: "hoshanot"`; a re-run removes
 * those and splices the fresh block at the same place. So after a full rebuild
 * (build-services.js / extract-shabbat.py → apply-shabbat-fixes.js) just run
 * this again.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OV = path.join(__dirname, 'data-overrides');
function dump(v) {            // python json.dumps(ensure_ascii=False) spacing, as the generators write
  if (Array.isArray(v)) return '[' + v.map(dump).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).map(k => JSON.stringify(k) + ': ' + dump(v[k])).join(', ') + '}';
  return JSON.stringify(v);
}
const strip = s => String(s).replace(/[\u0591-\u05C7]/g, '').replace(/[׳״'",:.־׀׃()\[\]]/g, '').replace(/\s+/g, ' ').trim();
const clean = s => String(s).replace(/\u2003/g, ' ');

// "כשחל ביום ג', ד', או ו':" → 'dow346' (1 = יום א' … 7 = שבת). The Ashkenaz
// הושענות for some days depend on the weekday; the rubric and the text under it
// (until the next rubric / the closing "לאחר אמירת ההושענא…") get that tag, so
// only the variant for today's weekday is shown.
const DOW_LETTERS = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7 };
function dowTag(plainText) {
  const m = /^כשחל ביום (.+)$/.exec(plainText);
  if (!m) return null;
  const ds = m[1].replace(/או/g, ' ').split(/\s+/).filter(Boolean).map(w => DOW_LETTERS[w]);
  if (!ds.length || ds.some(d => !d)) throw new Error('unparsed weekday rubric: ' + plainText);
  return 'dow' + ds.join('');
}
function convert(item, cond, opts) {
  const out = [];
  let variant = null;
  item.segments.forEach((s, i) => {
    let text = clean(s.text), kind = s.kind === 'title' ? 'header' : s.kind;
    const p = strip(text);
    if (kind === 'instruction' && p === 'קדיש שלם') return;       // the service already has its own קדיש
    if (opts && opts.hrTitle && i === 0 && kind === 'header') text = 'הושענות להושענא רבה';
    const dt = dowTag(p);
    if (dt) { variant = dt; kind = 'instruction'; }
    else if (/^לאחר אמירת ההושענא/.test(p)) { variant = null; kind = 'instruction'; }
    out.push({ kind: kind, text: text, cond: variant ? cond.concat([variant]) : cond.slice(), src: 'hoshanot' });
  });
  return out;
}
const load = n => JSON.parse(fs.readFileSync(path.join(OV, 'hoshanot_' + n + '.json'), 'utf8')).items;
const byId = (items, id) => items.find(x => x.id === id);

// ── weekday blocks (services-data.js, shacharit) ──
const WK = {
  ashkenaz: { base: ['sucot'], dayItems: ['day2', 'day3', 'day4', 'day5', 'day6'] },
  sfard: { base: ['hallel', 'sucot'], single: true },
  edot_mizrach: { base: ['musaf', 'sucot'], dayItems: ['day2', 'day3', 'day4', 'day5', 'day6'] },
};
function weekdayBlock(n) {
  const items = load(n), w = WK[n], out = [];
  if (w.single) {
    const c = w.base.concat(['noHoshanaRaba']);
    out.push.apply(out, convert(byId(items, 'pre'), c));
    out.push.apply(out, convert(byId(items, 'chol_hamoed'), c));
  } else {
    w.dayItems.forEach(id => out.push.apply(out, convert(byId(items, id), w.base.concat(['sukkotDay' + id.slice(3)]))));
  }
  out.push.apply(out, convert(byId(items, 'hoshana_rabba'), w.base.concat(['hoshanaRaba']), { hrTitle: n === 'edot_mizrach' }));
  return out;
}
// Remove a previously spliced block (src: "hoshanot"); returns where it started, or -1.
function removeApplied(arr) {
  const at = arr.findIndex(s => s.src === 'hoshanot');
  if (at < 0) return -1;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].src === 'hoshanot') arr.splice(i, 1);
  return at;
}
function findOld(arr) {       // contiguous run starting at the "הושענות" header with cond sucot
  const isOld = s => (s.cond || []).indexOf('sucot') >= 0;
  let a = arr.findIndex(s => s.kind === 'header' && isOld(s) && strip(s.text) === 'הושענות');
  if (a < 0) return null;
  let b = a; while (b + 1 < arr.length && isOld(arr[b + 1]) && !(arr[b + 1].kind === 'header' && strip(arr[b + 1].text) !== 'הושענות')) b++;
  return [a, b];
}

function patchFile(file, fn, ser) {
  ser = ser || dump;
  const p = path.join(ROOT, file);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = /^(window\.\w+ = )([\s\S]*?)(;\r?)$/.exec(l);
    if (!m) return;
    const o = JSON.parse(m[2]);
    if (ser(o) !== m[2]) throw new Error('round-trip mismatch in ' + file);
    fn(m[1].trim().split(' ')[0], o);
    lines[i] = m[1] + ser(o) + m[3];
  });
  fs.writeFileSync(p, lines.join('\n'));
}

patchFile('data/services-data.js', function (name, o) {
  Object.keys(WK).forEach(n => {
    const arr = o[n].shacharit, blk = weekdayBlock(n);
    const prev = removeApplied(arr);
    if (prev >= 0) {
      console.log(n, 'weekday: re-applied', blk.length, 'at', prev);
      arr.splice(prev, 0, ...blk);
      return;
    }
    const r = findOld(arr);
    if (!r) throw new Error('old block not found: ' + n);
    console.log(n, 'weekday: replaced', r[1] - r[0] + 1, 'by', blk.length, 'at', r[0]);
    arr.splice(r[0], r[1] - r[0] + 1, ...blk);
  });
}, JSON.stringify);

// ── Shabbat chol-hamoed (shabbat-data.js, shacharit) — only SIDURON_SHABBAT ──
const SH = {
  ashkenaz: { headerText: 'קדיש שלם', base: ['sucot'] },          // after musaf amidah, before קדיש שלם
  // "בשבת אין לומר הושענות, וכן המנהג בארץ ישראל" — so only in חו"ל.
  edot_mizrach: { at: s => s.kind === 'instruction' && strip(s.text).startsWith('ואומר החזן קדיש תתקבל'), base: ['sucot', 'chul'] },
  sfard: { at: s => s.kind === 'text' && strip(s.text) === 'היום שבת קדש', base: ['sucot'] },
};
patchFile('data/shabbat-data.js', function (name, o) {
  if (name !== 'window.SIDURON_SHABBAT') return;
  Object.keys(SH).forEach(n => {
    const arr = o[n].shacharit, items = load(n), c = SH[n].base;
    removeApplied(arr);         // re-run: drop the old block; the anchor below finds the same place
    let blk = [];
    if (n === 'sfard') blk = blk.concat(convert(byId(items, 'pre'), c));
    blk = blk.concat(convert(byId(items, 'shabbat'), c));
    let at = -1;
    if (SH[n].headerText) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].kind === 'header' && strip(arr[i].text) === SH[n].headerText) { at = i; break; } }
    else { for (let i = arr.length - 1; i >= 0; i--) if (SH[n].at(arr[i])) { at = i; break; } }
    if (at < 0) throw new Error('anchor not found: ' + n);
    console.log(n, 'shabbat: inserted', blk.length, 'at', at);
    arr.splice(at, 0, ...blk);
  });
});
