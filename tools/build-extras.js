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

const ROOT = path.resolve(__dirname, '..');
const TF = path.join(ROOT, 'tfilon.tfilon_38_1734630-1', 'assets');
const SS = path.join(ROOT, 'smart-siddur', 'assets', 'prayers');
const OUT = path.join(ROOT, 'data', 'extras-data.js');

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
    files: { ashkenaz: 'chanukaBrachot', sfard: 'chanukaBrachot', edot_mizrach: 'chanukaBrachot' } },
  { id: 'sheva_brachot', title: 'שבע ברכות', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_shevaBrachot', sfard: 's_shevaBrachot', edot_mizrach: 'em_shevaBrachot' } },
  { id: 'brit_milah', title: 'סדר ברית מילה', category: 'מועדים ואירועים',
    files: { ashkenaz: 'a_brit', sfard: 's_brit', edot_mizrach: 'em_brit' } },
];

// ── Text normalisation ───────────────────────────────────────────────────────
function normalizeText(s) {
  return s
    .replace(/~/g, '')          // un-censor divine names (י~הוה → יהוה)
    .replace(/K/g, 'ָ')    // kamatz-katan marker → kamatz vowel
    .replace(/;/g, ':')         // sof-pasuk → colon
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ── Recursive parse of one Tfilon file → token segments ──────────────────────
// Each segment: { kind:'text'|'instruction'|'special'|'winter'|'summer'|'header',
//                 text, cond:[tags] }  (cond = AND of include-chain conditions)
function readFile(name) {
  const p = path.join(TF, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const BLOCKS = [
  { open: '(:', close: ':)', kind: 'instruction' },
  { open: '([', close: '])', kind: 'special' },
  { open: '(---', close: '---)', kind: 'winter' },
  { open: '(===', close: '===)', kind: 'summer' },
];

function parseFile(name, condChain, depth, out, kind) {
  if (depth > 25) return;
  const text = readFile(name);
  if (text == null) return;
  parseText(text, condChain, depth, out, kind);
}

// Scan for block markers; plain regions are line-processed (includes/headers/
// text); a block's inner content is parsed RECURSIVELY (so includes inside a
// (:…:) / ([…]) / (---…---) / (===…===) block resolve), tagged with that
// block's styling `kind` which then propagates through its nested includes.
function parseText(text, condChain, depth, out, kind) {
  let i = 0;
  while (i < text.length) {
    let best = null;
    for (const b of BLOCKS) {
      const idx = text.indexOf(b.open, i);
      if (idx >= 0 && (best === null || idx < best.idx)) best = { idx, b };
    }
    const sliceEnd = best ? best.idx : text.length;
    processLines(text.slice(i, sliceEnd), condChain, depth, out, kind);
    if (!best) break;
    const b = best.b;
    const closeIdx = text.indexOf(b.close, best.idx + b.open.length);
    if (closeIdx < 0) { processLines(text.slice(best.idx), condChain, depth, out, kind); break; }
    const inner = text.slice(best.idx + b.open.length, closeIdx);
    parseText(inner, condChain, depth + 1, out, b.kind);
    i = closeIdx + b.close.length;
  }
}

function processLines(chunk, condChain, depth, out, kind) {
  const lines = chunk.split('\n');
  let buf = [];
  function flush() {
    if (!buf.length) return;
    const t = normalizeText(buf.join('\n'));
    if (t) out.push({ kind: kind || 'text', text: t, cond: condChain.slice() });
    buf = [];
  }
  for (let raw of lines) {
    const line = raw.trim();
    const inc = line.match(/^\(\)(\S+)(?:\s+(\S+))?\s*$/);
    if (inc) {
      flush();
      const childCond = inc[2] ? condChain.concat([inc[2]]) : condChain;
      parseFile(inc[1], childCond, depth + 1, out, kind);
      continue;
    }
    const hdr = line.match(/^-{5,}\s*(.*)$/);
    if (hdr) { flush(); if (hdr[1]) out.push({ kind: 'header', text: hdr[1].trim(), cond: condChain.slice() }); continue; }
    buf.push(raw);
  }
  flush();
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
      parseFile(file, [], 0, segs);
      if (!segs.length) segs = null;
    }
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
