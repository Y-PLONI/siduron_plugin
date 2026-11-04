/* apply-beit-midrash.js — idempotent splice of the two בית-המדרש תפילות
 * (tools/data-overrides/beit_midrash.json, from ויקיטקסט; מקור: ברכות כ"ח ע"ב)
 * into data/extras-data.js, same text for all three nuschaot.
 *   node tools/apply-beit-midrash.js
 * tools/build-extras.js reads the same override file (EXTRAS entries with
 * `override`), so a full rebuild keeps them; this script patches the checked-in
 * data without needing the Tfilon corpus.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = path.resolve(__dirname, '..', 'data', 'extras-data.js');
const ov = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-overrides', 'beit_midrash.json'), 'utf8')).items;
const src = fs.readFileSync(P, 'utf8');
const m = /^([\s\S]*?window\.SIDDUR_EXTRAS = )([\s\S]*?)(;\s*)$/.exec(src);
if (!m) throw new Error('unexpected extras-data.js format');
const data = JSON.parse(m[2]);
ov.forEach(function (it) {
  const entry = { id: it.id, title: it.title, category: it.category, nusachim: {} };
  ['ashkenaz', 'sfard', 'edot_mizrach'].forEach(function (n) { entry.nusachim[n] = it.segments; });
  const i = data.items.findIndex(x => x.id === it.id);
  if (i >= 0) data.items[i] = entry; else data.items.push(entry);
  console.log(it.id, i >= 0 ? 'replaced' : 'added');
});
fs.writeFileSync(P, m[1] + JSON.stringify(data) + m[3]);
