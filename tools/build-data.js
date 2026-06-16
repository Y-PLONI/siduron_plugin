/* build-data.js — ports the smart-siddur prayer corpus into a single
 * self-contained JS file the Otzaria plugin can load via a <script> tag.
 *
 * Why a <script> file and not JSON+fetch: Otzaria loads the plugin from a
 * file:// origin where fetch() is blocked, so all data must be inlined as a
 * global (window.SIDDUR_DATA), exactly like the legacy data/texts.js.
 *
 * Source: ../smart-siddur/assets/prayers (manifest-indexed JSON segments +
 * templates) + Hebrew segment labels parsed out of the Flutter constants file.
 *
 * Run:  node tools/build-data.js
 * Out:  data/siddur-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SS = path.join(ROOT, 'smart-siddur');
const PRAYERS = path.join(SS, 'assets', 'prayers');
const MANIFEST = path.join(PRAYERS, '_manifest.json');
const LABELS_DART = path.join(SS, 'lib', 'presentation', 'constants', 'segment_labels.dart');
const OUT = path.join(ROOT, 'data', 'siddur-data.js');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Resolve a manifest path (already repo-relative, e.g. "assets/prayers/..")
// against the smart-siddur root.
function resolveAsset(rel) { return path.join(SS, rel); }

const manifest = readJson(MANIFEST);

const out = {
  common: {},
  nusach: { ashkenaz: {}, sfard: {}, edot_mizrach: {} },
  templates: {},
  mappings: {},
  labels: {},
};

let counts = { common: 0, ashkenaz: 0, sfard: 0, edot_mizrach: 0, templates: 0, mappings: 0 };
const missing = [];

// ── common segments (and the mapping files that live under common) ──────────
for (const [id, rel] of Object.entries(manifest.common)) {
  const p = resolveAsset(rel);
  if (!fs.existsSync(p)) { missing.push(rel); continue; }
  const data = readJson(p);
  if (id.startsWith('_')) {            // _gra_ssy_mapping / _kriah_mon_thu_mapping
    out.mappings[id.replace(/^_/, '')] = data;
    counts.mappings++;
  } else {
    out.common[id] = data;
    counts.common++;
  }
}

// ── per-nusach segments ─────────────────────────────────────────────────────
for (const nusach of ['ashkenaz', 'sfard', 'edot_mizrach']) {
  const map = manifest.nusach[nusach] || {};
  for (const [id, rel] of Object.entries(map)) {
    const p = resolveAsset(rel);
    if (!fs.existsSync(p)) { missing.push(rel); continue; }
    out.nusach[nusach][id] = readJson(p);
    counts[nusach]++;
  }
}

// ── templates ───────────────────────────────────────────────────────────────
for (const [id, rel] of Object.entries(manifest.templates)) {
  const p = resolveAsset(rel);
  if (!fs.existsSync(p)) { missing.push(rel); continue; }
  out.templates[id] = readJson(p);
  counts.templates++;
}

// ── Nusach fix: Edot HaMizrach birkot-hashachar order ───────────────────────
// The Sephardic rite says the morning blessings (הנותן לשכוי … the שלא-עשני
// series, concluding with המעביר שינה + the יהי-רצון) BEFORE ברכות התורה, which
// in turn precede ציצית & תפילין. The ported template carried the Ashkenaz
// order (ברכות התורה + ציצית/תפילין first), so move the whole birkot-hashachar
// block up to just before ברכות התורה. Keyed by segment id → no-ops safely if
// the upstream template changes.
function moveSegmentBlock(segs, startId, endId, beforeId) {
  const idOf = s => s.segment_id || s.sub_template_id;
  const start = segs.findIndex(s => idOf(s) === startId);
  const end = segs.findIndex(s => idOf(s) === endId);
  if (start < 0 || end < 0 || start > end) return segs;
  const block = segs.slice(start, end + 1);
  const rest = segs.slice(0, start).concat(segs.slice(end + 1));
  const at = rest.findIndex(s => idOf(s) === beforeId);
  if (at < 0) return segs;
  rest.splice(at, 0, ...block);
  return rest;
}
{
  const t = out.templates['shacharit_lifnei_hatfila_edot_mizrach'];
  if (t && Array.isArray(t.segments)) {
    const before = t.segments.length;
    t.segments = moveSegmentBlock(t.segments, 'birkot_hashachar_header', 'yehi_ratzon_shelo_yavo', 'birchot_hatorah_la_asok');
    if (t.segments.length !== before) console.log('! birkot-hashachar reorder changed segment count — check template');
  }
}

// ── Nusach gap: Ashkenaz ברכי נפשי (תהלים ק״ד) on Rosh Chodesh ───────────────
// On Rosh Chodesh, after Shir Shel Yom, Ashkenaz adds ברכי נפשי (then a kaddish).
// The segment exists in the corpus and is wired for sfard/edot but was missing
// from the Ashkenaz flow. Insert it right after the post-Shir-Shel-Yom kaddish.
{
  const t = out.templates['shacharit_sof_hatfila_ashkenaz'];
  if (t && Array.isArray(t.segments)) {
    const idOf = s => s.segment_id || s.sub_template_id;
    if (!t.segments.some(s => idOf(s) === 'barchi_nafshi')) {
      const ssy = t.segments.findIndex(s => idOf(s) === 'shir_shel_yom');
      let k = -1;
      for (let i = ssy + 1; ssy >= 0 && i < t.segments.length; i++) {
        if (idOf(t.segments[i]) === 'kaddish_yatom') { k = i; break; }
      }
      if (k >= 0) {
        const entry = (id, key, flags) => ({ [key]: id, condition_flags: flags, exclude_flags: [], optional: false, allowed_nusach: [] });
        t.segments.splice(k + 1, 0,
          entry('barchi_nafshi', 'segment_id', ['rosh_chodesh']),
          entry('kaddish_yatom', 'sub_template_id', ['rosh_chodesh', 'with_minyan']));
      } else {
        console.log('! barchi_nafshi anchor (shir_shel_yom kaddish) not found in sof_hatfila_ashkenaz');
      }
    }
  }
}

// ── Common-segment text overrides ───────────────────────────────────────────
// Corrected/restored segment texts that the upstream corpus got wrong, kept as
// tracked JSON in tools/data-overrides/ so the fix survives regeneration.
//   hodu.json — full Ashkenaz הודו (the ported text was truncated: it dropped the
//   "אתה ה' לא תכלא … אל נקמות … ה' צבאות … הושיעה את עמך …" collection and had a
//   stray ×3 "והוא רחום"). Sourced from "סידור אשכנז" (Otzaria seforim.db).
{
  const ovDir = path.join(__dirname, 'data-overrides');
  if (fs.existsSync(ovDir)) {
    for (const name of fs.readdirSync(ovDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.replace(/\.json$/, '');
      out.common[id] = readJson(path.join(ovDir, name));
      console.log('  override common segment:', id);
    }
  }
}

// ── extra mapping files not indexed in manifest.common (omer, korbanot) ─────
// Glob for any "_*mapping*.json" or "_omer*.json" / "_sukkot*.json" under the
// prayers tree and bucket them by a normalised basename key.
function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
const allFiles = walk(PRAYERS, []);
for (const full of allFiles) {
  const base = path.basename(full);
  if (!/^_.*\.json$/.test(base)) continue;          // only "_*.json" data files
  if (base === '_manifest.json') continue;          // the index itself, not data
  const key = base.replace(/^_/, '').replace(/\.json$/, '');
  if (out.mappings[key]) continue;                  // already captured via manifest
  out.mappings[key] = readJson(full);
  counts.mappings++;
}

// ── segment labels (parse the Dart const map) ───────────────────────────────
{
  const src = fs.readFileSync(LABELS_DART, 'utf8');
  // Match  'key': 'value',  and  'key': "value",  (Hebrew values, may contain ")
  const re = /'([^']+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g;
  let m, n = 0;
  while ((m = re.exec(src)) !== null) {
    out.labels[m[1]] = m[2];
    n++;
  }
  counts.labels = n;
}

// ── emit ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const header =
  '/* siddur-data.js — GENERATED by tools/build-data.js. Do not edit by hand.\n' +
  ' * Prayer corpus ported from smart-siddur (RefaelGamliel). Strictly Orthodox.\n' +
  ' */\n';
fs.writeFileSync(
  OUT,
  header + 'window.SIDDUR_DATA = ' + JSON.stringify(out) + ';\n',
  'utf8'
);

const bytes = fs.statSync(OUT).size;
console.log('Wrote', path.relative(ROOT, OUT), '(' + (bytes / 1024 / 1024).toFixed(2) + ' MB)');
console.log('counts:', JSON.stringify(counts));
console.log('mapping keys:', Object.keys(out.mappings).join(', '));
console.log('templates:', Object.keys(out.templates).length);
if (missing.length) console.log('MISSING (' + missing.length + '):', missing.slice(0, 10).join('\n  '));
