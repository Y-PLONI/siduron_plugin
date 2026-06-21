/* services.js — renders the MAIN services (שחרית/מנחה/ערבית, with מוסף/שבת
 * folded in) for עדות המזרח / ספרד / אשכנז from window.SIDURON_SERVICES
 * (built by tools/build-services.js from the Tfilon corpus).
 *
 * Each service is a flat list of segments {kind, text, cond[]} where cond[] are
 * Tfilon condition tags. We evaluate them here against the day's flags
 * (js/calendar.js) so the siddur shows exactly today's text — weekday vs שבת,
 * מוסף on its days, the right seasonal ברכה (טל/גשם), תחנון / הלל / קריאת התורה
 * only when said, the correct fast's סליחות, etc.
 *
 * Output mirrors SiduronRender/SiduronExtras: { html, nav } with nav = section
 * headers for jump-to-section.
 */
(function (global) {
  'use strict';

  function data() { return global.SIDURON_SERVICES; }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escKeepBold(s) { return esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>'); }

  // Tags we couldn't map are logged once (dev aid) so coverage gaps surface.
  var _unknown = {};

  // Map one Tfilon condition tag → boolean, given a flag lookup `has`.
  // Unknown tags default to TRUE (show) but are recorded in _unknown.
  function evalTag(tag, has) {
    switch (tag) {
      // ── גבורות: משיב הרוח ומוריד הגשם / מוריד הטל (boundary = Shemini Atzeret … Pesach) ──
      case 'winterTal': return has('mashiv_haruach');
      case 'summerTal': return !has('mashiv_haruach');
      // ── ברכת השנים: ותן טל ומטר / ותן ברכה (boundary = 7 Cheshvan / ז' בחו"ל … Pesach) ──
      // Distinct from גבורות — there's a ~5-week window (Shemini Atzeret→7 Cheshvan)
      // where it's משיב הרוח yet still ותן ברכה, so gate on tal_umatar, NOT mashiv_haruach.
      case 'winterBracha': return has('tal_umatar');
      case 'summerBracha': return !has('tal_umatar');
      // ── עשרת ימי תשובה ──
      case 'ayt': return has('aseret_yemei_teshuva');
      case 'noayt': case 'noAyt': return !has('aseret_yemei_teshuva');
      // ── שבת ──
      case 'shabbat': return has('shabbat');
      case 'noShabbat': return !has('shabbat');
      // ── מוסף ──
      case 'musaf': return has('musaf_day');
      case 'noMusaf': return !has('musaf_day');
      // ── ראש חודש ──
      case 'rh': return has('rosh_chodesh');
      // ── תשעה באב ──
      case 'tishaaBeav': case 'tishaaBeavFire': case 'fire': return has('tisha_beav');
      case 'noTishaaBeav': return !has('tisha_beav');
      // ── תעניות ──
      case 'taanit': case 'vaanenu': return has('fast_day');
      case 'noTaanit': return !has('fast_day');
      case '17tammuz': return has('fast_17_tammuz');
      case '10tevet': return has('fast_10_tevet');
      case 'gedalya': return has('fast_gedalia');
      case 'noGedalya': return !has('fast_gedalia');
      case 'ester': return has('fast_esther');
      case '11tishrei': return has('day_after_yom_kippur');
      // ── מועדים ──
      case 'chanuka': return has('chanukah');
      case 'chanuka1': return has('chanukah_day_1');
      case 'purim': return has('purim');
      case 'megilatEster': return has('purim');
      case 'pesach': return has('pesach') || has('chol_hamoed_pesach');
      case 'sucot': return has('sukkot') || has('chol_hamoed_sukkot');
      case 'hoshanaRaba': case 'hoshanaraba': case 'HoshanaRaba': return has('hoshana_raba');
      case 'noHoshanaRaba': case 'noHoshanaraba': return !has('hoshana_raba');
      case 'lulav_shehecheyanu': return has('lulav_day');
      case 'omer': return has('omer_period');
      // ── הלל ──
      case 'fullHallel': return has('full_hallel');
      case 'hallel': return has('full_hallel') || has('half_hallel');
      // ── קריאת התורה ──
      case 'tora': return has('kriat_hatorah');
      case 'noTora': return !has('kriat_hatorah');
      case 'monThu': return has('monday_thursday');
      case 'noMonThu': return !has('monday_thursday');
      case 'monThuTachanun': case 'lErechApayim': return has('monday_thursday') && !has('skip_tachanun');
      // ── תחנון / סליחות ──
      case 'shacharitTachanun': return !has('skip_tachanun');
      case 'noShacharitTachanun': return has('skip_tachanun');
      case 'minchaTachanun': return !has('skip_tachanun_mincha');
      case 'noMinchaTachanun': return has('skip_tachanun_mincha');
      case 'lamnatzeach': return !has('skip_tachanun');     // למנצח … יענך before תחנון
      case 'noSlichot': return true;
      // ── מזמורי פתיחה ──
      case 'toda': return !has('skip_mizmor_letodah');      // מזמור לתודה
      // ── שיר של יום placement (avoid showing it twice) ──
      case 'shirShelYomAtEnd': return !has('musaf_day');
      case 'shirOpenD': return has('musaf_day');
      case 'ShirOpenND': return !has('musaf_day');
      // ── ימי השבוע (שיר של יום) ──
      case 'sun': return has('day_sunday');
      case 'mon': return has('day_monday');
      case 'tue': return has('day_tuesday');
      case 'wed': return has('day_wednesday');
      case 'thu': return has('day_thursday');
      case 'fri': return has('day_friday');
      case 'noFri': return !has('day_friday');
      // ── מיקום / ארץ ──
      case 'chul': return has('not_in_israel');
      case 'israel': return has('in_israel');
      case 'ledavid': return has('ladavid_season');
      case 'tfilin': return !has('skip_tefillin');
      // ── יום כיפור ──
      case 'kipur': case 'avinu_malkenu_kipur': return has('yom_kippur');
      // ── מוצאי שבת (ערבית): אתה חוננתנו + ויהי נועם / הבדלה ──
      // The weekday מעריב here concludes Shabbat when the selected day is שבת
      // (matches the time-of-day auto-pick: Saturday after sunset → מעריב).
      // TODO: also treat מוצאי יום טוב.
      case 'chonantanu': case 'havdala': return has('shabbat');
      case 'noChonantanu': return !has('shabbat');
      // ── kedusha wording variants — structural, always present in context ──
      case 'kadosh': case 'em_kadosh': return true;
      // ── personal / optional inserts hidden by default ──
      case 'doctor': return false;                           // מי שברך לחולה (personal addition)
      // ── occasions we deliberately omit / can't yet detect → hide ──
      case 'atzmaut': case 'zikaron': return false;          // State/IDF additions (content policy)
      case 'yerushalayim': return false;                     // TODO: Jerusalem-specific text
      case 'leap': return false;                             // TODO: leap-year flag
      case 'kaparatPasha': case 'leap_keferat_pashay': return false;
      case 'purim_meshulash_tachanun_message': return false;
      default:
        if (!_unknown[tag]) { _unknown[tag] = true; if (global.console) console.log('[services] unmapped condition tag:', tag); }
        return true;
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

  function renderTextBlock(text) {
    var lines = String(text == null ? '' : text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t) out.push('<div class="s-line">' + escKeepBold(t) + '</div>');
    }
    return out.join('');
  }

  function has(nusach, service) {
    var d = data();
    return !!(d && d[nusach] && d[nusach][service] && d[nusach][service].length);
  }

  // Render a flat seg list ({kind,text,cond?}) → { html, nav }.
  function renderSegs(segs, dayFlags) {
    var hasF = makeHas(dayFlags);
    var out = [], nav = [], n = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      // Seasonal (winter/summer) blocks in the services always carry an explicit
      // cond tag (winterTal/summerTal for גבורות, winterBracha/summerBracha for
      // ברכת השנים), so gating is done purely via condPasses — the block kind is
      // only a styling hint here (unlike the תוספות, where kind is the gate).
      if (!condPasses(s.cond, hasF)) continue;

      if (s.kind === 'header') {
        var a = 'svc-anchor-' + (n++);
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

  // Weekday services (Tfilon) — window.SIDURON_SERVICES.
  function render(nusach, service, dayFlags) {
    var d = data();
    var segs = (d && d[nusach] && d[nusach][service]);
    if (!segs || !segs.length) return null;   // caller falls back
    return renderSegs(segs, dayFlags);
  }

  // Shabbat / Yom-Tov services (seforim.db) — window.SIDURON_SHABBAT.
  function shabbatData() { return global.SIDURON_SHABBAT; }
  function hasShabbat(nusach, service) {
    var d = shabbatData();
    return !!(d && d[nusach] && d[nusach][service] && d[nusach][service].length);
  }
  function renderShabbat(nusach, service, dayFlags) {
    var d = shabbatData();
    var segs = (d && d[nusach] && d[nusach][service]);
    if (!segs || !segs.length) return null;
    return renderSegs(segs, dayFlags);
  }

  // Yom-Tov services (seforim.db) — window.SIDURON_YOMTOV.
  function yomtovData() { return global.SIDURON_YOMTOV; }
  function hasYomtov(nusach, service) {
    var d = yomtovData();
    return !!(d && d[nusach] && d[nusach][service] && d[nusach][service].length);
  }
  function renderYomtov(nusach, service, dayFlags) {
    var d = yomtovData();
    var segs = (d && d[nusach] && d[nusach][service]);
    if (!segs || !segs.length) return null;
    return renderSegs(segs, dayFlags);
  }

  global.SiduronServices = {
    render: render, has: has,
    renderShabbat: renderShabbat, hasShabbat: hasShabbat,
    renderYomtov: renderYomtov, hasYomtov: hasYomtov,
    _evalTag: evalTag,
  };
})(typeof window !== 'undefined' ? window : this);
