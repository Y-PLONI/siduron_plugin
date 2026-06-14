/* extras.js — standalone prayers / brachot ("תוספות").
 *
 * Renders items from window.SIDDUR_EXTRAS (built by tools/build-extras.js).
 * Each item is a list of segments {kind, text, cond[]} where cond[] holds
 * Tfilon condition tags evaluated here against the day's flags, so e.g.
 * birkat hamazon shows Ya'aleh VeYavo only on Rosh Chodesh, Al HaNisim only
 * on Chanukah/Purim, the מגדיל/מגדול closing per the day, etc.
 */
(function (global) {
  'use strict';

  function data() { return global.SIDDUR_EXTRAS; }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escKeepBold(s) { return esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>'); }

  // Map one Tfilon condition tag → boolean, given a flag-set lookup `has`.
  function evalTag(tag, has) {
    switch (tag) {
      case 'rh': return has('rosh_chodesh');
      case 'chanuka': return has('chanukah');
      case 'chanuka1': return has('chanukah_day_1');
      case 'purim': return has('purim');
      case 'pesach': return has('pesach') || has('chol_hamoed_pesach');
      case 'sucot': return has('sukkot');
      case 'shacharitTachanun': return !has('skip_tachanun');
      case 'noShacharitTachanun': return has('skip_tachanun');
      case 'magdil': return !(has('rosh_chodesh') || has('musaf_day'));
      case 'migdol': return has('rosh_chodesh') || has('musaf_day');
      case 'ayt': return has('aseret_yemei_teshuva');
      case 'noayt': case 'noAyt': return !has('aseret_yemei_teshuva');
      case 'israel': return has('in_israel');
      case 'sun': return has('day_sunday');
      case 'mon': return has('day_monday');
      case 'tue': return has('day_tuesday');
      case 'wed': return has('day_wednesday');
      case 'thu': return has('day_thursday');
      case 'fri': return has('day_friday');
      case 'noRachel': return false;   // tikkun chatzot: default to the Rachel path
      case 'threeWeeks': return false; // niche; not auto-detected
      default: return true;            // unknown tag → show (safe default)
    }
  }
  function condPasses(cond, has) {
    for (var i = 0; i < (cond || []).length; i++) if (!evalTag(cond[i], has)) return false;
    return true;
  }

  function makeHas(dayFlags) {
    var set = {};
    (dayFlags && dayFlags.flags || []).forEach(function (f) { set[f] = true; });
    return function (f) { return !!set[f]; };
  }

  function findItem(id) {
    var items = (data() && data().items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  function renderTextBlock(text) {
    var lines = String(text == null ? '' : text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t) out.push('<div class="s-line">' + escKeepBold(t) + '</div>');
    }
    return out.join('');
  }

  // Render one extra → { html, nav } (nav = section headers for jump-to-section).
  function renderExtra(id, nusach, dayFlags) {
    var item = findItem(id);
    if (!item) return { html: '<div class="muted center">התוספת אינה זמינה.</div>', nav: [] };
    var segs = item.nusachim[nusach] || item.nusachim.ashkenaz ||
      item.nusachim[Object.keys(item.nusachim)[0]] || [];
    var has = makeHas(dayFlags);
    var out = [], nav = [], n = 0;

    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      // Seasonal blocks gate on the precipitation flag.
      if (s.kind === 'winter' && !has('mashiv_haruach')) continue;
      if (s.kind === 'summer' && has('mashiv_haruach')) continue;
      if (!condPasses(s.cond, has)) continue;

      if (s.kind === 'header') {
        var a = 'x-anchor-' + (n++);
        nav.push({ label: s.text, anchor: a });
        out.push('<h3 class="s-section" id="' + a + '">' + esc(s.text) + '</h3>');
      } else if (s.kind === 'instruction') {
        out.push('<div class="s-instruction">' + renderTextBlock(s.text) + '</div>');
      } else if (s.kind === 'special' || s.kind === 'winter' || s.kind === 'summer') {
        out.push('<div class="s-special">' + renderTextBlock(s.text) + '</div>');
      } else {
        out.push('<div class="s-seg">' + renderTextBlock(s.text) + '</div>');
      }
    }
    return { html: out.join('\n'), nav: nav };
  }

  // Render the extras menu (grouped by category) → HTML with data-extra buttons.
  function renderMenu() {
    var items = (data() && data().items) || [];
    if (!items.length) return '<div class="muted center">אין תוספות.</div>';
    var byCat = {}, order = [];
    items.forEach(function (it) {
      if (!byCat[it.category]) { byCat[it.category] = []; order.push(it.category); }
      byCat[it.category].push(it);
    });
    var html = '';
    order.forEach(function (cat) {
      html += '<div class="extras-cat">' + esc(cat) + '</div><div class="extras-grid">';
      byCat[cat].forEach(function (it) {
        html += '<button class="extra-card" data-extra="' + it.id + '">' + esc(it.title) + '</button>';
      });
      html += '</div>';
    });
    return html;
  }

  function list() { return (data() && data().items) || []; }

  global.SiduronExtras = {
    renderMenu: renderMenu,
    renderExtra: renderExtra,
    list: list,
    esc: esc,
  };
})(typeof window !== 'undefined' ? window : this);
