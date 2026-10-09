/* teamim.js — הצגת פסוקי דזמרא עם טעמי המקרא.
 *
 * הפסוקים נשלפים מספריית אוצריא עצמה (library.getBookContent, הרשאה
 * library.content.read) ולא מוטמעים בתוסף. לכל ספר נקראים כל קטעי הטקסט פעם
 * אחת, מפוענחים לפרקים ופסוקים, ורק הפסוקים הנדרשים נשמרים במטמון באחסון
 * התוסף — כך שבפתיחות הבאות אין קריאות נוספות.
 *
 * ממשק:
 *   SiduronTeamim.setEnabled(bool)
 *   SiduronTeamim.isActive(nusach, service)  — האם יש מיפוי לשירות הזה
 *   SiduronTeamim.prefetch(nusach, service)  — Promise<boolean> (true = נטענו פסוקים חדשים)
 *   SiduronTeamim.transform(nusach, service, segs) — מחזיר רשימת קטעים עם הטקסט המוחלף
 */
(function (global) {
  'use strict';

  var CACHE_KEY = 'teamimCacheV1';
  var CHUNK = 5000;
  var MAX_CHUNKS = 600;              // רשת ביטחון מפני לולאה אינסופית

  var enabled = false;
  var cache = {};                    // 'ספר|פרק|פסוק' -> טקסט מנוקה
  var cacheLoaded = false;
  var bookState = {};                // ספר -> 'loading' | 'done' | 'failed'
  var inflight = {};                 // מפתח prefetch -> Promise

  /* ───── Otzaria helpers ───── */
  function hasOtzaria() { return typeof global.Otzaria !== 'undefined' && global.Otzaria.call; }
  async function call(method, params) {
    if (!hasOtzaria()) return null;
    try { var r = await global.Otzaria.call(method, params || {}); return r && r.success ? r.data : null; }
    catch (e) { return null; }
  }

  async function loadCache() {
    if (cacheLoaded) return;
    cacheLoaded = true;
    var v = await call('storage.get', { key: CACHE_KEY });
    if (v && typeof v === 'object') cache = v;
    else if (typeof v === 'string') { try { cache = JSON.parse(v) || {}; } catch (e) { cache = {}; } }
  }
  function saveCache() {
    if (hasOtzaria()) global.Otzaria.call('storage.set', { key: CACHE_KEY, value: cache });
  }

  /* ───── מספרים עבריים (גימטריה) ───── */
  var GEM = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ך': 20,
    'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90,
    'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400 };
  function gematria(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) { var v = GEM[s.charAt(i)]; if (v) n += v; }
    return n;
  }

  /* ───── ניקוי שורת פסוק מהמרקאפ של ספריית אוצריא ───── */
  function cleanVerse(raw) {
    var s = String(raw);
    s = s.replace(/^\s*\(([א-ת"'׳״]{1,5})\)\s*/, '');                       // (א)
    s = s.replace(/<span class="mam-spi-[a-z]+">[\s\S]*?<\/span>/g, '');      // {פ} {ס}
    s = s.replace(/<br\s*\/?>/gi, '');
    // כתיב וקרי: משאירים את הקרי בלבד
    s = s.replace(/<span class="mam-kq">\s*<span class="mam-kq-k">[\s\S]*?<\/span>\s*<span class="mam-kq-q">\[?([\s\S]*?)\]?<\/span>\s*<\/span>/g, '$1');
    s = s.replace(/&thinsp;/g, ' ').replace(/&nbsp;/g, ' ');
    s = s.replace(/<[^>]+>/g, '');                                            // כל תג שנותר (maqaf, small, b...)
    s = s.replace(/\s*׀\s*/g, ' ׀ ');
    s = s.replace(/׃/g, ':');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /* ───── פענוח טקסט ספר → פרקים ופסוקים ───── */
  var CH_RE = /^\s*(?:<h2[^>]*>)?\s*פרק\s+([א-ת"'׳״]+)\s*(?:<\/h2>)?\s*$/;
  function parseBook(title, text, wanted) {
    var lines = text.split(/\r?\n/);
    var chapter = 0, ord = 0, count = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = CH_RE.exec(line);
      if (m) { chapter = gematria(m[1]); ord = 0; continue; }
      if (!chapter) continue;
      if (/^\s*<h\d/.test(line) || !line.trim()) continue;
      ord++;
      var vm = /^\s*\(([א-ת"'׳״]{1,5})\)/.exec(line);
      var verse = vm ? gematria(vm[1]) : ord;
      var cleaned = cleanVerse(line);
      if (!cleaned) continue;
      var ck = title + '|' + chapter + '|' + verse;
      if (wanted && !wanted[ck]) continue;       // שומרים במטמון רק את מה שנדרש
      cache[ck] = cleaned;
      count++;
    }
    return count;
  }

  /* ───── קריאת ספר שלם מאוצריא ───── */
  async function readWholeBook(title) {
    var text = '', offset = 0;
    for (var i = 0; i < MAX_CHUNKS; i++) {
      var chunk = await call('library.getBookContent', { bookId: title, offset: offset, limit: CHUNK });
      if (chunk && typeof chunk === 'object') chunk = chunk.content || chunk.text || '';
      if (typeof chunk !== 'string' || !chunk.length) break;
      text += chunk;
      offset += chunk.length;                  // offset ביחידות UTF-16, כמו length של מחרוזת JS
      if (chunk.length < CHUNK) break;
    }
    return text;
  }

  /* ───── מיפוי: רשימת הפסוקים הנדרשת ───── */
  var REF_RE = /^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/;
  function expandRef(ref) {
    var m = REF_RE.exec(ref);
    if (!m) return [];
    var out = [], from = +m[3], to = m[4] ? +m[4] : from;
    for (var v = from; v <= to; v++) out.push({ book: m[1], chapter: +m[2], verse: v });
    return out;
  }
  function entriesFor(nusach, service) {
    var map = global.SIDURON_TEAMIM_MAP;
    return (map && map[nusach] && map[nusach][service]) || [];
  }
  function neededVerses(entries) {
    var list = [];
    entries.forEach(function (e) {
      e.lines.forEach(function (line) {
        line.forEach(function (it) { if (it.r) list = list.concat(expandRef(it.r)); });
      });
    });
    return list;
  }
  function key(v) { return v.book + '|' + v.chapter + '|' + v.verse; }

  /* ───── API ───── */
  function stripMarks(s) { return String(s || '').replace(/\u05BE/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/\s+/g, ' ').trim(); }

  async function prefetch(nusach, service) {
    if (!enabled) return false;
    var entries = entriesFor(nusach, service);
    if (!entries.length) return false;
    var k = nusach + '/' + service;
    if (inflight[k]) return inflight[k];
    inflight[k] = (async function () {
      try {
        await loadCache();
        var need = neededVerses(entries).filter(function (v) { return !cache[key(v)]; });
        if (!need.length) return false;
        var wanted = {}, books = [];
        need.forEach(function (v) { wanted[key(v)] = true; });
        need.forEach(function (v) { if (books.indexOf(v.book) < 0) books.push(v.book); });
        var changed = false;
        for (var i = 0; i < books.length; i++) {
          var b = books[i];
          if (bookState[b] === 'failed') continue;
          var text = await readWholeBook(b);
          if (!text) { bookState[b] = 'failed'; continue; }
          if (parseBook(b, text, wanted) > 0) { bookState[b] = 'done'; changed = true; }
          else bookState[b] = 'failed';
        }
        if (changed) saveCache();
        return changed;
      } finally { delete inflight[k]; }
    })();
    return inflight[k];
  }

  // פסוקי הקטע מתוך המטמון; null אם חסר פסוק כלשהו (אז נשאר הטקסט המקורי).
  function buildLines(entry, originalText) {
    var origSentences = String(originalText).split(/\n+/).join(' ').split(/(?<=[:.])\s+/);
    var out = [];
    for (var li = 0; li < entry.lines.length; li++) {
      var parts = [];
      var line = entry.lines[li];
      for (var ii = 0; ii < line.length; ii++) {
        var it = line[ii];
        if (it.r) {
          var vs = expandRef(it.r);
          if (!vs.length) return null;
          for (var vi = 0; vi < vs.length; vi++) {
            var t = cache[key(vs[vi])];
            if (!t) return null;
            parts.push(t);
          }
        } else if (it.k) {
          var found = null;
          for (var si = 0; si < origSentences.length; si++) {
            if (stripMarks(origSentences[si]).indexOf(it.k) === 0) { found = origSentences[si]; break; }
          }
          if (found == null) return null;
          parts.push(found);
        }
      }
      out.push(parts.join(' '));
    }
    return out.join('\n');
  }

  // ההחלפה חלה רק בתוך אזור פסוקי דזמרא (בין הכותרות), כדי שלא תיגע בקטעים
  // זהים במקומות אחרים בתפילה (למשל "אשרי" שבסוף שחרית).
  function transform(nusach, service, segs) {
    if (!enabled) return segs;
    var entries = entriesFor(nusach, service);
    if (!entries.length) return segs;
    var region = ((global.SIDURON_TEAMIM_MAP || {}).regions || {})[nusach + '/' + service];
    var inRegion = !region;
    return segs.map(function (s) {
      if (region && s.kind === 'header') {
        var h = stripMarks(s.text);
        if (h.indexOf(region.from) === 0) inRegion = true;
        else if (h.indexOf(region.to) === 0) inRegion = false;
      }
      if (!inRegion || s.kind !== 'text' || !s.text) return s;
      var plain = stripMarks(s.text);
      // 1) החלפת הקטע כולו (m = תחילת הקטע)
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].m && plain.indexOf(entries[i].m) === 0) {
          var txt = buildLines(entries[i], s.text);
          if (txt == null) return s;
          var copy = {}; for (var p in s) copy[p] = s[p];
          copy.text = txt;
          return copy;
        }
      }
      // 2) החלפת שורה אחת בתוך קטע (ln = תחילת השורה), למשל "הודו" שבתוך קטע ברוך שאמר
      var hasLn = entries.some(function (e) { return !!e.ln; });
      if (!hasLn) return s;
      var lines = String(s.text).split('\n'), changed = false;
      for (var li = 0; li < lines.length; li++) {
        var lp = stripMarks(lines[li]);
        for (var ei = 0; ei < entries.length; ei++) {
          if (entries[ei].ln && lp.indexOf(entries[ei].ln) === 0) {
            var rep = buildLines(entries[ei], lines[li]);
            if (rep != null) { lines[li] = rep; changed = true; }
            break;
          }
        }
      }
      if (!changed) return s;
      var copy2 = {}; for (var q in s) copy2[q] = s[q];
      copy2.text = lines.join('\n');
      return copy2;
    });
  }

  global.SiduronTeamim = {
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    failedBooks: function () { return Object.keys(bookState).filter(function (b) { return bookState[b] === 'failed'; }); },
    retry: function () { bookState = {}; },
    isActive: function (nusach, service) { return entriesFor(nusach, service).length > 0; },
    prefetch: prefetch,
    transform: transform,
    // לבדיקות
    _cleanVerse: cleanVerse, _parseBook: parseBook, _cache: function () { return cache; },
    _reset: function () { cache = {}; cacheLoaded = true; bookState = {}; inflight = {}; }
  };
})(typeof window !== 'undefined' ? window : this);
