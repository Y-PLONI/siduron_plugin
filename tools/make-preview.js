/* make-preview.js — renders a real service to a standalone, openable HTML file
 * with the plugin CSS inlined (light theme), so the visual result can be viewed
 * without Otzaria. Run: node tools/make-preview.js [YYYY-MM-DD] [nusach] [service]
 * Out: preview.html
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const iso = process.argv[2] || new Date().toISOString().slice(0, 10);
const nusach = process.argv[3] || 'edot_mizrach';
const service = process.argv[4] || 'shacharit';
const tmpl = service === 'mincha' ? 'mincha' :
  service === 'omer' ? 'sefirat_haomer_' + nusach : service + '_' + nusach;

const ctx = vm.createContext({ console });
ctx.window = ctx;
for (const f of ['vendor/hebcal.js', 'data/siddur-data.js', 'js/calendar.js', 'js/assembler.js', 'js/render.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const uc = { nusach: nusach, gender: 'male', isInIsrael: true, withMinyan: true, purimDate: 'both' };
const out = vm.runInContext(
  `(function(){var df=SiduronCalendar.flagsFor(new Date(${JSON.stringify(iso + 'T08:00:00')}),${JSON.stringify(uc)});` +
  `var segs=SiduronAssembler.assemble(${JSON.stringify(tmpl)},${JSON.stringify(uc)},df);` +
  `var r=SiduronRender.render(segs);return {html:r.html, date:df.hd.renderGematriya(true), flags:df.flags};})()`,
  ctx);

const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
const titleHe = { shacharit: 'שחרית', mincha: 'מנחה', maariv: 'מעריב', omer: 'ספירת העומר' }[service] || service;
const nusachHe = { edot_mizrach: 'עדות המזרח', sfard: 'ספרד', ashkenaz: 'אשכנז' }[nusach];

const page = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<title>סידורון — תצוגה מקדימה</title><style>${css}</style></head>
<body><div class="app">
<header class="header"><div style="font-weight:700;font-size:1.05rem;color:var(--c-on-surface);margin-bottom:6px">סידורון · תצוגה מקדימה (${nusachHe})</div>
<div class="header-date"><span class="hdr-date">${out.date}</span></div></header>
<div class="reader-scroll"><h2 class="service-title">${titleHe}</h2>
<section class="content"><div class="prayer">${out.html}</div></section></div></div></body></html>`;

fs.writeFileSync(path.join(ROOT, 'preview.html'), page, 'utf8');
console.log('Wrote preview.html —', titleHe, nusachHe, iso, '(' + out.date + ')');
console.log('flags:', out.flags.filter(f => !/^(gender_|in_israel|not_in_israel|with_minyan|day_)/.test(f)).join(' '));
