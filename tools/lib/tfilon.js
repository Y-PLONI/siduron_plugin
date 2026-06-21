/* tools/lib/tfilon.js — shared parser for the Tfilon corpus.
 *
 * Both build-extras.js (standalone prayers) and build-services.js (the main
 * shacharit/mincha/arvit/musaf services) parse the same Tfilon text format, so
 * the parsing/normalisation/correction logic lives here to stay identical.
 *
 * Tfilon markup:
 *   ()path [cond[,cond…]]   recursive include, optionally gated by condition tags
 *   (: … :)                 instruction / rubric          → kind:'instruction'
 *   ([ … ])                 special-day insert            → kind:'special'
 *   (--- … ---)             winter (Mashiv haRuach) block → kind:'winter'
 *   (=== … ===)             summer (Morid haTal) block    → kind:'summer'
 *   -----Heading            section header                → kind:'header'
 * Encoding quirks: '~' = pre-censored divine name (remove), 'K' = kamatz-katan
 *   marker (→ kamatz), ';' = sof-pasuk (→ ':').
 *
 * Each emitted segment: { kind, text, cond:[tags] } where cond = the AND of all
 * include-chain condition tags in scope (evaluated at runtime in the browser).
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ── Text normalisation ───────────────────────────────────────────────────────
function normalizeText(s) {
  return s
    .replace(/~/g, '')          // un-censor divine names (י~הוה → יהוה)
    .replace(/K/g, 'ָ')         // kamatz-katan marker → kamatz vowel
    .replace(/;/g, ':')         // sof-pasuk → colon
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ── Text corrections ─────────────────────────────────────────────────────────
// Targeted fixes for text the Tfilon corpus got wrong, applied after
// normalizeText. The find string is built from explicit codepoints because the
// corpus stores some nikud in a non-canonical order (e.g. dagesh-before-sheva)
// that an editor-typed literal won't match.
const CC = (...c) => String.fromCharCode(...c);
const CORRECTIONS = [
  // הָרַחֲמָן הוּא יוֹלִיכֵנוּ … קוֹמְמִיּוּת בְּאַרְצֵנוּ  →  … לְאַרְצֵנוּ
  // (em_mazon: standard text is "קוממיות לארצנו"; "בארצנו" is an error —
  //  confirmed vs Otzaria seforim.db across all nuschaot.)
  { find: 'קוֹמְמִיּוּת ' + CC(0x5d1, 0x5bc, 0x5b0, 0x5d0, 0x5b7, 0x5e8, 0x5b0, 0x5e6, 0x5b5, 0x5e0, 0x5d5, 0x5bc),
    repl: 'קוֹמְמִיּוּת לְאַרְצֵנוּ' },
];
function applyCorrections(text) {
  let t = text;
  for (const c of CORRECTIONS) t = t.split(c.find).join(c.repl);
  return t;
}

// ── Content policy ───────────────────────────────────────────────────────────
// Omit modern prayers/blessings for the State of Israel and the IDF. Matching is
// nikud-insensitive: strip vowel/cantillation marks, then test.
const NIKUD = /[֑-ׇ]/g;
const FORBIDDEN = [
  'מדינת ישראל', 'ראשית צמיחת', 'שלום המדינה', 'צבא ההגנה', 'צבא הגנה',
  'כחות הבטחון', 'כוחות הביטחון', 'שתי הבקשות הבאות',
];
function isForbidden(text) {
  const bare = (text || '').replace(NIKUD, '');
  return FORBIDDEN.some(f => bare.includes(f));
}

// ── Recursive parse ──────────────────────────────────────────────────────────
const BLOCKS = [
  { open: '(:', close: ':)', kind: 'instruction' },
  { open: '([', close: '])', kind: 'special' },
  { open: '(---', close: '---)', kind: 'winter' },
  { open: '(===', close: '===)', kind: 'summer' },
];

// createParser(tfDir) → { parseEntry(name) -> segs[] }
function createParser(tfDir) {
  function readFile(name) {
    const p = path.join(tfDir, name);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function parseFile(name, condChain, depth, out, kind) {
    if (depth > 30) return;
    const text = readFile(name);
    if (text == null) { out.push({ kind: 'missing', text: '⟨MISSING:' + name + '⟩', cond: condChain.slice() }); return; }
    parseText(text, condChain, depth, out, kind);
  }

  // Scan for block markers; plain regions are line-processed; a block's inner
  // content is parsed recursively (so includes inside it resolve), tagged with
  // that block's styling kind which propagates through its nested includes.
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
      const t = applyCorrections(normalizeText(buf.join('\n')));
      if (t) out.push({ kind: kind || 'text', text: t, cond: condChain.slice() });
      buf = [];
    }
    for (let raw of lines) {
      const line = raw.trim();
      const inc = line.match(/^\(\)(\S+)(?:\s+(\S+))?\s*$/);
      if (inc) {
        flush();
        // Condition token may be comma-separated (AND), e.g. "shacharitTachanun,17tammuz".
        const childCond = inc[2] ? condChain.concat(inc[2].split(',').filter(Boolean)) : condChain;
        parseFile(inc[1], childCond, depth + 1, out, kind);
        continue;
      }
      const hdr = line.match(/^-{5,}\s*(.*)$/);
      if (hdr) { flush(); if (hdr[1]) out.push({ kind: 'header', text: hdr[1].trim(), cond: condChain.slice() }); continue; }
      buf.push(raw);
    }
    flush();
  }

  function parseEntry(name) {
    const out = [];
    parseFile(name, [], 0, out, null);
    return out;
  }

  return { parseEntry, readFile };
}

module.exports = { createParser, normalizeText, applyCorrections, isForbidden, NIKUD };
