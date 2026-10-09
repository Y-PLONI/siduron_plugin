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
      // ערבית נאמרת בכניסת היום, ולכן ערבית של מוצאי שבת היא הערבית של יום
      // ראשון — ראו motzaei_shabbat ב-calendar.js ואת בחירת יום הערבית ב-app.js.
      // TODO: also treat מוצאי יום טוב.
      case 'chonantanu': case 'havdala': return has('motzaei_shabbat');
      case 'noChonantanu': return !has('motzaei_shabbat');
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

  /* ────────────── תפילה ללא מניין ──────────────
   * The Tfilon corpus (and the seforim.db Shabbat/Yom-Tov corpora) carry no
   * "with minyan" condition tag, so the מניין preference has to be applied here.
   * Whatever needs a מניין of ten is dropped and replaced by one muted note, so
   * the reader sees *why* a familiar section is missing instead of a silent hole.
   *
   * Three rules, in order of reliability:
   *   1. Section headers that are minyan-only (חזרת הש"ץ, קדושה, קריאת התורה …).
   *      The skip runs until the next header that is NOT minyan-only — this is
   *      essential, because the tail of חזרת הש"ץ (שים שלום) sits under the
   *      ברכת כהנים header, not under a header of its own.
   *   2. קדיש — the opening line plus the segments continuing it. Continuation
   *      phrases only count while a קדיש run is open, so "עושה שלום במרומיו"
   *      at the end of the עמידה is never swallowed.
   *   3. Lines spoken by the חזן / הקהל (ברכו and its response, וחוזר החזן …),
   *      plus the "חזן:" / "קהל וחזן:" labels that introduce a dropped line.
   */
  // Header text (nikud/quotes stripped) → the label shown in the note.
  var MINYAN_ONLY_SECTIONS = {
    'חזרת השץ': 'חזרת הש״ץ',
    'קדושה': 'קדושה',
    'מודים דרבנן': 'מודים דרבנן',
    'ברכת כהנים': 'ברכת כהנים',
    'הוצאת ספר תורה': 'קריאת התורה',
    'קריאת התורה': 'קריאת התורה',
    'סדר קריאת התורה בשבת': 'קריאת התורה',
    'סדר קריאת התורה': 'קריאת התורה',
    'הפטרה': 'הפטרה',
    'ברכות ההפטרה': 'הפטרה',
    'הכנסת ספר תורה': 'הכנסת ספר תורה',
    'ברכת הגומל': 'ברכת הגומל',
    'הכרזת ראש חדש': 'הכרזת ראש חודש',
    'הכרזת תענית': 'הכרזת תענית',
    'מי שברך לקהל': 'מי שברך לקהל',
    'סדר זבד הבת': 'זבד הבת',
    'לשבת חתן': 'שבת חתן',
  };
  // קדיש: the opening line (possibly behind a short label such as "קדיש יתום"
  // or "חזן") and the lines that continue it.
  var KADDISH_OPEN_RE = /^.{0,30}?יתגדל ויתקדש/;
  var KADDISH_CONT_RE = /^(?:לעלא|על ישראל ועל רבנן|יהא שלמא רבא|עושה שלום במרומיו|תתקבל|יהא שמה רבא|יתברך וישתבח|ואמרו אמן|יהי שם יהוה מברך)/;
  // A short instruction that merely *names* a קדיש ("חצי קדיש", "קדיש תתקבל",
  // "ואומרים קדיש על ישראל"). The length guard keeps real halachic notes that
  // happen to mention קדיש from being treated as the קדיש itself.
  var KADDISH_LABEL_RE = /קדיש/;
  // A line said by the חזן or answered by the ציבור. Hebrew letters are not \w,
  // so the boundary after the role name must be spelled out — \b never matches
  // between a Hebrew letter and a space.
  var CHAZAN_LINE_RE = /^(?:ואומרים|ואומר|ויאמר|וחוזר|ועונים|אומרים|אומר|וקורא|מכריז)?\s*(?:ה?חזן|ה?קהל|ה?ציבור|ה?שץ|שליח הציבור|הכהנים)(?=\s|$)/;
  // ברכו and its response. Matched anywhere inside a SHORT segment, so wrappers
  // like "ואומר החזן ברכו…" / "העולה מברך ברכו…" are covered, while the phrase
  // inside a long passage (e.g. "שיר המעלות … הנה ברכו את ה'") is not.
  var BARCHU_RE = /ברכו את (?:יהוה|השם|ה|הי) המברך|ברוך (?:יהוה|השם|ה|הי) המברך לעולם ועד/;
  var BARCHU_MAX_LEN = 60;

  // Strip HTML tags, nikud/te'amim and Hebrew punctuation → a comparable key.
  function plain(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\p{Mn}/gu, '')
      .replace(/[׳״'"״,:.־׀׃׳״()\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function sectionLabel(headerText) {
    return MINYAN_ONLY_SECTIONS[plain(headerText)] || null;
  }

  // Mark every segment that may only be said with a מניין.
  // Returns { drop: bool[], note: (string|null)[] } — note[i] holds the label for
  // the first dropped segment of each run (the one that gets the muted line).
  function markMinyanOnly(segs) {
    var drop = [], note = [], i, sectionSkip = null, inKaddish = false;
    for (i = 0; i < segs.length; i++) { drop.push(false); note.push(null); }

    for (i = 0; i < segs.length; i++) {
      var s = segs[i], txt = plain(s.text);

      if (s.kind === 'header') {
        var lbl = sectionLabel(s.text);
        inKaddish = false;
        if (lbl) {
          // A new minyan-only section: note it only when it opens a fresh run,
          // so consecutive minyan sections collapse into a single note.
          if (sectionSkip === null) note[i] = lbl;
          else if (sectionSkip !== lbl) note[i] = lbl;
          sectionSkip = lbl;
          drop[i] = true;
          continue;
        }
        sectionSkip = null;            // a normal header ends the skipped run
      }
      if (sectionSkip !== null) { drop[i] = true; continue; }

      if (s.kind === 'instruction' && KADDISH_LABEL_RE.test(txt) && txt.length <= 60) {
        drop[i] = true; inKaddish = true;
        note[i] = 'קדיש';
        continue;
      }
      if (KADDISH_OPEN_RE.test(txt)) {
        drop[i] = true;
        if (!inKaddish) note[i] = 'קדיש';
        inKaddish = true;
        continue;
      }
      if (inKaddish && KADDISH_CONT_RE.test(txt)) { drop[i] = true; continue; }
      inKaddish = false;

      if (txt.length <= BARCHU_MAX_LEN && BARCHU_RE.test(txt)) {
        drop[i] = true; note[i] = 'ברכו'; continue;
      }
      // A PRAYER LINE said by the חזן or answered by the ציבור, with the role
      // inline ("וחוזר החזן: ה' אלהיכם אמת"). Rubric-only markers ("חזן:",
      // "קהל ואחריו שליח הציבור:") are left to the pass below, so a marker whose
      // text stays (e.g. inside סליחות) keeps its heading.
      if (s.kind !== 'header' && s.kind !== 'instruction' && CHAZAN_LINE_RE.test(txt)) {
        drop[i] = true;
        continue;
      }
    }

    // A bare "חזן:" / "קהל וחזן:" label is only meaningful together with the
    // line it introduces; drop it when that line is dropped.
    for (i = segs.length - 2; i >= 0; i--) {
      if (drop[i] || segs[i].kind !== 'instruction') continue;
      if (drop[i + 1] && CHAZAN_LINE_RE.test(plain(segs[i].text))) drop[i] = true;
    }
    // Notes deliberately stay on their own segment: the renderer collects them
    // per dropped run, and each note is announced only if THAT segment's cond
    // applies today (moving a note elsewhere would announce e.g. הפטרה של תשעה
    // באב on an ordinary Monday).
    return { drop: drop, note: note };
  }

  // Mirrors render.js: wrap the first visible word so it can be enlarged,
  // keeping leading whitespace/HTML tags as a prefix to preserve tag nesting.
  function wrapFirstWord(html) {
    var m = /^(\s*(?:<[^>]+>\s*)*)([^\s<]+)/.exec(html);
    if (!m) { return html; }
    return m[1] + '<span class="s-firstword">' + m[2] + '</span>' + html.slice(m[0].length);
  }

  function renderTextBlock(text, leadWord) {
    var lines = String(text == null ? '' : text).split('\n');
    var out = [];
    var didLead = false;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { continue; }
      var h = escKeepBold(t);
      if (leadWord && !didLead) { h = wrapFirstWord(h); didLead = true; }
      out.push('<div class="s-line">' + h + '</div>');
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
    // 'with_minyan' is added by the flag engine from the user's profile
    // (js/calendar.js) — absent means "מתפלל ביחידות".
    var noMinyan = !hasF('with_minyan');
    var mark = noMinyan ? markMinyanOnly(segs) : null;
    var out = [], nav = [], n = 0, pending = [];
    function flushMinyanNote() {
      if (!pending.length) return;
      var many = pending.length > 1;
      var names = many
        ? pending.slice(0, -1).join(', ') + ' ו' + pending[pending.length - 1]
        : pending[0];
      out.push('<div class="s-minyan-note">' + esc(names) +
        (many ? ' — נאמרים במניין בלבד' : ' — נאמר במניין בלבד') + '</div>');
      pending = [];
    }
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (mark && mark.drop[i]) {
        // Collect the labels of this dropped run; they're flushed as ONE muted
        // line when the run ends, so חזרת הש"ץ + קדושה + מודים דרבנן + ברכת
        // כהנים read as a single note instead of four. Only sections that apply
        // today are announced (e.g. הפטרה of תשעה באב stays silent otherwise).
        if (mark.note[i] && condPasses(s.cond, hasF) && pending.indexOf(mark.note[i]) < 0) {
          pending.push(mark.note[i]);
        }
        continue;
      }
      flushMinyanNote();
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
        out.push('<div class="s-seg">' + renderTextBlock(s.text, true) + '</div>');
      }
    }
    flushMinyanNote();
    return { html: out.join('\n'), nav: nav };
  }

  // Weekday services (Tfilon) — window.SIDURON_SERVICES.
  function render(nusach, service, dayFlags) {
    var d = data();
    var segs = (d && d[nusach] && d[nusach][service]);
    if (!segs || !segs.length) return null;   // caller falls back
    // פסוקי דזמרא עם טעמים (אם הוגדר) — מחליף את הקטעים בפסוקים מאוצריא.
    if (global.SiduronTeamim) segs = global.SiduronTeamim.transform(nusach, service, segs);
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
