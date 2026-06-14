/* assembler.js — Prayer assembler.
 *
 * Faithful JS port of smart-siddur's prayer_assembler.dart. Walks a template,
 * applies the condition/exclude gate at template-entry AND section level,
 * recurses into sub-templates, then runs the post-processors (Sefirat HaOmer,
 * Sukkot korban, Mon/Thu Torah reading, RC-Tevet composite, Gr"a Shir Shel Yom).
 *
 * Data source: window.SIDDUR_DATA (built by tools/build-data.js):
 *   { common:{id->seg}, nusach:{<n>:{id->seg}}, templates:{id->tmpl}, mappings, labels }
 *
 * Output: a flat list of assembled segments:
 *   [{ id, resolvedText, optional, groupId }]
 */
(function (global) {
  'use strict';

  function data() { return global.SIDDUR_DATA; }

  // text field may be String or Array<String>; arrays join with a single space.
  function joinText(t) {
    if (t == null) return '';
    return Array.isArray(t) ? t.join(' ') : String(t);
  }

  // ── segment / template resolution (mirrors prayer_local_datasource.dart) ────
  function loadTemplate(templateId) {
    var t = data().templates[templateId];
    if (!t) throw new Error('Template "' + templateId + '" not found');
    return t;
  }
  function loadNusachSegment(nusach, segmentId) {
    var byNusach = data().nusach[nusach];
    if (byNusach && byNusach[segmentId]) return byNusach[segmentId];
    var common = data().common[segmentId];
    if (common) return common;
    throw new Error('Segment "' + segmentId + '" missing for nusach "' + nusach + '"');
  }

  // ── the gate ────────────────────────────────────────────────────────────────
  function buildContextKeys(ctx, dayFlags) {
    // dayFlags.flags already include gender_*, in_israel/not_in_israel,
    // with_minyan (added by the calendar engine). Add the nusach key.
    return dayFlags.flags.concat(['nusach_' + ctx.nusach]);
  }

  function arrEvery(arr, fn) { for (var i = 0; i < arr.length; i++) if (!fn(arr[i])) return false; return true; }
  function arrAny(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return true; return false; }

  function entryPasses(entry, ctx, keys) {
    var allowed = entry.allowed_nusach || [];
    if (allowed.length && allowed.indexOf(ctx.nusach) < 0) return false;
    var cond = entry.condition_flags || [];
    var excl = entry.exclude_flags || [];
    if (!arrEvery(cond, function (k) { return keys.indexOf(k) >= 0; })) return false;
    if (arrAny(excl, function (k) { return keys.indexOf(k) >= 0; })) return false;
    return true;
  }

  function assembleSections(sections, keys) {
    var out = [];
    for (var i = 0; i < (sections || []).length; i++) {
      var s = sections[i];
      var cond = s.condition_flags || [];
      var excl = s.exclude_flags || [];
      if (!arrEvery(cond, function (k) { return keys.indexOf(k) >= 0; })) continue;
      if (arrAny(excl, function (k) { return keys.indexOf(k) >= 0; })) continue;
      var t = joinText(s.text);
      if (t) out.push(t);
    }
    return out.join('\n');
  }

  // ── recursive assembly ──────────────────────────────────────────────────────
  function assembleTemplate(templateId, ctx, keys, inheritedGroup) {
    var template = loadTemplate(templateId);
    var results = [];
    var segs = template.segments || [];
    for (var i = 0; i < segs.length; i++) {
      var entry = segs[i];
      if (!entryPasses(entry, ctx, keys)) continue;
      var effGroup = inheritedGroup || entry.group_id || '';

      if (entry.sub_template_id) {
        var sub = assembleTemplate(entry.sub_template_id, ctx, keys, effGroup);
        for (var j = 0; j < sub.length; j++) results.push(sub[j]);
        continue;
      }
      var segment = loadNusachSegment(ctx.nusach, entry.segment_id);
      results.push({
        id: segment.id,
        resolvedText: assembleSections(segment.sections, keys),
        optional: !!(entry.optional || segment.optional),
        groupId: effGroup,
      });
    }
    return results;
  }

  // ── main ──────────────────────────────────────────────────────────────────
  function assemble(templateId, ctx, dayFlags) {
    var keys = buildContextKeys(ctx, dayFlags);
    var out = assembleTemplate(templateId, ctx, keys, '');

    // Post-processors (only run when the relevant day-state is present).
    if (dayFlags.omerDay != null) out = applyOmer(out, dayFlags.omerDay, ctx.nusach);
    if (dayFlags.sukkotDay != null) out = applySukkotKorban(out, dayFlags.sukkotDay, ctx.isInIsrael);
    if (dayFlags.flags.indexOf('kriat_hatorah_mon_thu') >= 0 && dayFlags.upcomingParshah) {
      out = applyMonThuReading(out, dayFlags.upcomingParshah);
    }
    if (dayFlags.flags.indexOf('rc_tevet') >= 0 && dayFlags.chanukahDay != null) {
      out = applyRcTevet(out, dayFlags.chanukahDay);
    }
    if (dayFlags.flags.indexOf('gra_ssy_day') >= 0) out = applyGraSsy(out, dayFlags);

    // Safety net: strip any placeholder a post-processor couldn't fill (e.g.
    // the Omer service opened off-season) so no raw {{token}} reaches the user.
    for (var i = 0; i < out.length; i++) {
      if (/\{\{[a-z_]+\}\}/.test(out[i].resolvedText)) {
        out[i] = { id: out[i].id, optional: out[i].optional, groupId: out[i].groupId,
          resolvedText: out[i].resolvedText.replace(/\s*\{\{[a-z_]+\}\}\s*/g, ' ').trim() };
      }
    }
    return out;
  }

  function replaceSegText(segs, id, fn) {
    return segs.map(function (s) {
      if (s.id !== id) return s;
      var copy = {}; for (var k in s) copy[k] = s[k];
      copy.resolvedText = fn(s.resolvedText);
      return copy;
    });
  }

  // ── Sefirat HaOmer ──────────────────────────────────────────────────────────
  function omerDayData(day) {
    var m = data().mappings.omer_mapping;
    if (!m || !m.days) return null;
    return m.days[day - 1] || null;
  }
  function omerTextFor(d, nusach) {
    if (!d) return '';
    return d['text_' + nusach] || d.text_edot_mizrach || d.text_sfard || d.text_ashkenaz || '';
  }
  function applyOmer(segs, omerDay, nusach) {
    var d = omerDayData(omerDay);
    if (!d) return segs;
    segs = replaceSegText(segs, 'sefirat_haomer_day_count', function (t) {
      return t.replace(/\{\{omer_day_count\}\}/g, omerTextFor(d, nusach));
    });
    segs = replaceSegText(segs, 'sefirat_haomer_ribono_shel_olam', function (t) {
      return t.replace(/\{\{omer_sefira\}\}/g, d.sefira || '');
    });
    segs = replaceSegText(segs, 'sefirat_haomer_lamenatzeach', function (t) {
      return processLamenatzeach(t, d);
    });
    segs = replaceSegText(segs, 'sefirat_haomer_ana_bekoach', function (t) {
      return processAnaBekoach(t, d);
    });
    return segs;
  }

  // ── Sukkot daily korban ─────────────────────────────────────────────────────
  function applySukkotKorban(segs, sukkotDay, isInIsrael) {
    var m = data().mappings.sukkot_korbanot_mapping;
    if (!m || !m.days) return segs;
    var d = m.days[sukkotDay - 1];
    if (!d) return segs;
    var pasuk = isInIsrael ? (d.pasuk_israel || '') : (d.pasuk_chu_l || d.pasuk_israel || '');
    return segs.map(function (s) {
      if (s.resolvedText.indexOf('{{daily_korban}}') < 0) return s;
      var copy = {}; for (var k in s) copy[k] = s[k];
      copy.resolvedText = s.resolvedText.replace(/\{\{daily_korban\}\}/g, pasuk);
      return copy;
    });
  }

  // ── Mon/Thu Torah reading ───────────────────────────────────────────────────
  // hebcal parsha english → smart-siddur slug, aligned by Torah order against
  // hebcal.parshiot (both 54 singles in the same order).
  var _slugMap = null;
  function parshaSlug(upcoming) {
    var map = data().mappings.kriah_mon_thu_mapping || {};
    if (!_slugMap) {
      _slugMap = {};
      // hebcal.parshiot (53, Bereshit…Ha'azinu) aligns by Torah order with the
      // first 53 mapping keys; the 54th (V'zot HaBerachah) is never a Mon/Thu
      // reading, so a length mismatch is fine — align over the shorter length.
      var ssKeys = Object.keys(map);
      var hp = (global.hebcal && global.hebcal.parshiot) || [];
      var len = Math.min(hp.length, ssKeys.length);
      for (var i = 0; i < len; i++) _slugMap[hp[i].toLowerCase()] = ssKeys[i];
    }
    // upcoming.names[0] is the (collapsed-to-first) hebcal english name.
    var en = (upcoming.names && upcoming.names[0] || '').toLowerCase();
    return _slugMap[en] || null;
  }
  function applyMonThuReading(segs, upcoming) {
    var slug = parshaSlug(upcoming);
    var map = data().mappings.kriah_mon_thu_mapping || {};
    var segId = map[slug];
    if (!segId) return segs;
    var seg = data().common[segId];
    if (!seg) return segs;
    var text = assembleSectionsRaw(seg.sections);
    return replaceSegText(segs, 'kriat_hatorah_reading_text', function () { return text; });
  }
  // Join all sections unconditionally (reading texts carry no flags).
  function assembleSectionsRaw(sections) {
    var parts = [];
    for (var i = 0; i < (sections || []).length; i++) {
      var t = joinText(sections[i].text);
      if (t) parts.push(t);
    }
    return parts.join('\n');
  }

  // ── RC Tevet composite + Gr"a SSY (best-effort lookups) ────────────────────
  function applyRcTevet(segs, chanukahDay) {
    // Composite: RC olim 1-3 + Chanukah day-N. We approximate by injecting the
    // Chanukah day-N reading into the rc_tevet placeholder if present.
    var seg = data().common['kriah_chanukah_day_' + chanukahDay];
    if (!seg) return segs;
    var text = assembleSectionsRaw(seg.sections);
    return replaceSegText(segs, 'kriah_rc_tevet', function (t) {
      return /\{\{[a-z_]+\}\}/.test(t) ? text : (t || text);
    });
  }
  function applyGraSsy(segs, dayFlags) {
    var m = data().mappings.gra_ssy_mapping;
    if (!m) return segs;
    var chag = dayFlags.sukkotDay != null ? 'sukkot' : 'pesach';
    var dayInChag = dayFlags.sukkotDay != null ? dayFlags.sukkotDay : dayFlags.pesachDay;
    var wd = dayFlags.chagYt1Weekday;
    // Mapping shape is best-effort; resolve gracefully if a chapter is found.
    var chapter = resolveGraChapter(m, chag, wd, dayInChag);
    if (chapter == null) return segs;
    var segId = 'tehillim_' + ('00' + chapter).slice(-3);
    var seg = data().common[segId];
    var text = seg ? assembleSectionsRaw(seg.sections) : null;
    if (!text) return segs;
    return replaceSegText(segs, 'shir_shel_yom_gra', function () { return text; });
  }
  function resolveGraChapter(m, chag, yt1Weekday, dayInChag) {
    try {
      var byChag = m[chag];
      if (!byChag) return null;
      var byWd = byChag[String(yt1Weekday)] || byChag[yt1Weekday];
      if (!byWd) return null;
      return byWd[String(dayInChag)] || byWd[dayInChag] || null;
    } catch (e) { return null; }
  }

  // ── Omer bold helpers (port of omer_post_processor.dart) ────────────────────
  function isHebConsonant(code) { return code >= 0x05D0 && code <= 0x05EA; }
  function isHebMark(code) {
    return (code >= 0x0591 && code <= 0x05BD) || code === 0x05BF ||
      (code >= 0x05C1 && code <= 0x05C2) || (code >= 0x05C4 && code <= 0x05C5) ||
      code === 0x05C7;
  }
  function boldNthWord(text, n) {
    var re = /\S+/g, matches = [], m;
    while ((m = re.exec(text)) !== null) matches.push({ s: m.index, e: re.lastIndex });
    if (n < 1 || n > matches.length) return text;
    var w = matches[n - 1];
    return text.slice(0, w.s) + '<b>' + text.slice(w.s, w.e) + '</b>' + text.slice(w.e);
  }
  function findBareSubstring(text, needle) {
    var positions = [], buf = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (isHebConsonant(c)) { positions.push(i); buf += String.fromCharCode(c); }
      else if (!isHebMark(c)) {
        if (buf.length && buf.charCodeAt(buf.length - 1) !== 0x20) { positions.push(i); buf += ' '; }
      }
    }
    var bare = '';
    for (var k = 0; k < needle.length; k++) { var cc = needle.charCodeAt(k); if (isHebConsonant(cc)) bare += needle[k]; }
    if (!bare) return null;
    var idx = buf.indexOf(bare);
    if (idx < 0) return null;
    return positions[idx];
  }
  function nthConsonantAt(text, startPos, n) {
    var count = 0;
    for (var i = startPos; i < text.length; i++) {
      if (isHebConsonant(text.charCodeAt(i))) { count++; if (count === n) return i; }
    }
    return null;
  }
  function wrapCluster(text, pos) {
    var end = pos + 1;
    while (end < text.length && isHebMark(text.charCodeAt(end))) end++;
    return text.slice(0, pos) + '<b>' + text.slice(pos, end) + '</b>' + text.slice(end);
  }
  function processLamenatzeach(text, day) {
    var headingEnd = text.indexOf(':');
    if (headingEnd < 0) return text;
    var head = text.slice(0, headingEnd + 1);
    var body = text.slice(headingEnd + 1);
    body = boldNthWord(body, day.day);
    var yismStart = findBareSubstring(body, 'ישמחו');
    if (yismStart != null) {
      var pos = nthConsonantAt(body, yismStart, day.day);
      if (pos != null) body = wrapCluster(body, pos);
    }
    return head + body;
  }
  function processAnaBekoach(text, day) {
    var lines = text.split('\n');
    var idx = day.week - 1;
    if (idx < 0 || idx >= lines.length) return text;
    if (day.day_in_week === 7) {
      var re = /\([^()]+\)/g, last = null, m;
      while ((m = re.exec(lines[idx])) !== null) last = m;
      if (last) lines[idx] = lines[idx].slice(0, last.index) + '<b>' + last[0] + '</b>' + lines[idx].slice(last.index + last[0].length);
    } else {
      lines[idx] = boldNthWord(lines[idx], day.day_in_week);
    }
    return lines.join('\n');
  }

  global.SiduronAssembler = {
    assemble: assemble,
    label: function (id) { return (data().labels && data().labels[id]) || ''; },
  };
})(typeof window !== 'undefined' ? window : this);
