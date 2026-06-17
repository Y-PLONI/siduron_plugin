/* app.js — Siduron v2 orchestration.
 *
 * Wires the Otzaria SDK to the flag engine (calendar.js) → assembler
 * (assembler.js) → renderer (render.js), and drives the UI: service tabs,
 * the halachic header with flag badges, the profile/settings panel, the
 * zmanim panel, jump-to-section, font size, and divine-name display.
 *
 * The Hebrew date comes from Otzaria's selected date; all halachic flags
 * (omer, parsha, tal/geshem, yaaleh-veyavo, …) are computed locally with
 * @hebcal/core, since the SDK does not expose them.
 */
(function () {
  'use strict';

  var STATE = {
    nusach: 'edot_mizrach',     // edot_mizrach | sfard | ashkenaz
    gender: 'male',             // male | female
    isInIsrael: true,           // derived from the city chosen in Otzaria (not a manual toggle)
    city: null,                 // selected city name (from Otzaria's calendar), or null
    country: null,              // its country (Hebrew), or null
    withMinyan: true,
    purimDate: 'fourteenth',    // fourteenth | fifteenth | both
    censorNames: false,
    fontSize: 22,
    fontFamily: '',             // '' = follow Otzaria's font; else a specific family
    textWidth: '760',           // content max-width in px, or 'full'
    themeFont: '',              // Otzaria's typography.fontFamily (captured from theme)
    platform: '',               // host OS (from plugin.boot): windows|linux|macos|android|ios
    service: null,              // current service id
    extra: null,                // current extra id (within the תוספות view)
    date: null,                 // JS Date (the day we're rendering)
    dayFlags: null,
    nav: [],
  };

  var SERVICES = [
    { id: 'shacharit', he: 'שחרית', template: function (n) { return 'shacharit_' + n; } },
    { id: 'mincha', he: 'מנחה', template: function () { return 'mincha'; } },
    { id: 'maariv', he: 'מעריב', template: function (n) { return 'maariv_' + n; } },
    { id: 'omer', he: 'ספירת העומר', template: function (n) { return 'sefirat_haomer_' + n; },
      showIf: function () { return STATE.dayFlags && STATE.dayFlags.omerDay != null; } },
    { id: 'extras', he: 'תוספות', extras: true },
  ];

  var NUSACHIM = [
    { id: 'edot_mizrach', he: 'עדות המזרח' },
    { id: 'sfard', he: 'ספרד' },
    { id: 'ashkenaz', he: 'אשכנז' },
  ];

  // Flag → badge {label, cls}. Only "display-worthy" flags surface.
  var FLAG_BADGES = {
    shabbat: ['שבת', 'b-blue'], rosh_chodesh: ['ראש חודש', 'b-blue'],
    chanukah: ['חנוכה', 'b-amber'], purim: ['פורים', 'b-amber'],
    pesach: ['פסח', 'b-green'], chol_hamoed_pesach: ['חול המועד פסח', 'b-green'],
    sukkot: ['סוכות', 'b-green'], chol_hamoed_sukkot: ['חול המועד סוכות', 'b-green'],
    hoshana_raba: ['הושענא רבה', 'b-green'], shemini_atzeret: ['שמיני עצרת', 'b-green'],
    simchat_torah: ['שמחת תורה', 'b-green'], shavuot: ['שבועות', 'b-green'],
    rosh_hashanah: ['ראש השנה', 'b-purple'], yom_kippur: ['יום כיפור', 'b-purple'],
    aseret_yemei_teshuva: ['עשי״ת', 'b-purple'], fast_day: ['תענית', 'b-red'],
    tisha_beav: ['תשעה באב', 'b-red'], omer_period: ['ספירת העומר', 'b-teal'],
    tu_bishvat: ['ט״ו בשבט', 'b-green'], lag_baomer: ['ל״ג בעומר', 'b-amber'],
    isru_chag: ['אסרו חג', 'b-green'], pesach_sheni: ['פסח שני', 'b-green'],
    tu_bav: ['ט״ו באב', 'b-green'], yom_kippur_katan: ['יום כיפור קטן', 'b-purple'],
  };
  // Order badges appear in.
  var BADGE_ORDER = ['shabbat', 'rosh_hashanah', 'yom_kippur', 'aseret_yemei_teshuva',
    'pesach', 'chol_hamoed_pesach', 'shavuot', 'sukkot', 'chol_hamoed_sukkot',
    'hoshana_raba', 'shemini_atzeret', 'simchat_torah', 'rosh_chodesh', 'chanukah',
    'purim', 'fast_day', 'tisha_beav', 'tu_bishvat', 'lag_baomer', 'tu_bav',
    'pesach_sheni', 'isru_chag', 'yom_kippur_katan', 'omer_period'];

  /* ────────────── Otzaria SDK helpers ────────────── */
  function hasOtzaria() { return typeof window.Otzaria !== 'undefined' && window.Otzaria.call; }
  async function call(method, params) {
    if (!hasOtzaria()) return null;
    try { var r = await window.Otzaria.call(method, params || {}); return r && r.success ? r.data : null; }
    catch (e) { return null; }
  }
  async function storageGet(key) { var v = await call('storage.get', { key: key }); return v; }
  function storageSet(key, value) { if (hasOtzaria()) window.Otzaria.call('storage.set', { key: key, value: value }); }

  /* ────────────── Theme ────────────── */
  function applyTheme(theme) {
    if (!theme || !theme.colorScheme) return;
    var cs = theme.colorScheme, r = document.documentElement;
    function set(k, v) { if (v) r.style.setProperty(k, v); }
    set('--c-primary', cs.primary); set('--c-on-primary', cs.onPrimary);
    set('--c-secondary', cs.secondary);
    set('--c-secondary-container', cs.secondaryContainer);
    set('--c-on-secondary-container', cs.onSecondaryContainer);
    set('--c-surface', cs.surface); set('--c-on-surface', cs.onSurface);
    set('--c-on-surface-variant', cs.onSurfaceVariant);
    set('--c-surface-container', cs.surfaceContainer);
    set('--c-surface-container-high', cs.surfaceContainerHigh);
    set('--c-surface-container-highest', cs.surfaceContainerHighest);
    set('--c-outline', cs.outline); set('--c-outline-variant', cs.outlineVariant);
    set('--c-error', cs.error);
    if (cs.primary) {
      set('--c-primary-subtle', hexToRgba(cs.primary, 0.12));
      set('--c-primary-border', hexToRgba(cs.primary, 0.22));
    }
    if (cs.onSurface) {
      set('--c-on-surface-subtle', hexToRgba(cs.onSurface, 0.07));
      set('--c-on-surface-hover', hexToRgba(cs.onSurface, 0.12));
    }
    document.body.classList.toggle('dark', theme.mode === 'dark');
    if (theme.typography) {
      var tp = theme.typography;
      if (tp.lineHeight) r.style.setProperty('--line-height', String(tp.lineHeight));
      // Remember Otzaria's chosen font so "default" follows the rest of the app.
      if (tp.fontFamily) { STATE.themeFont = tp.fontFamily; applyFont(); }
    }
  }
  function hexToRgba(hex, a) {
    try {
      return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) +
        ',' + parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
    } catch (e) { return 'rgba(103,80,164,' + a + ')'; }
  }

  /* ────────────── Hebrew date / numerals ────────────── */
  function hebNum(n) {
    n = parseInt(n, 10); if (!n || n < 1) return '';
    var ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    var tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    var huns = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
    n = n % 1000; var s = huns[Math.floor(n / 100)]; n = n % 100;
    if (n === 15) s += 'טו'; else if (n === 16) s += 'טז';
    else s += tens[Math.floor(n / 10)] + ones[n % 10];
    return s;
  }
  function gershize(s) {
    if (!s) return ''; if (s.length === 1) return s + '׳';
    return s.slice(0, -1) + '״' + s.slice(-1);
  }

  /* ────────────── Divine-name display ────────────── */
  // Consonant skeleton of the Tetragrammaton (any nikud/te'amim between).
  var TETRA_RE = /י[֑-ׇ]*ה[֑-ׇ]*ו[֑-ׇ]*ה/g;
  function applyCensor(html) {
    if (!STATE.censorNames) return html;
    return html.replace(TETRA_RE, 'ה׳');
  }

  /* ────────────── Location (from Otzaria's selected city) ────────────── */
  // We no longer ask the user "are you in Israel?" — we read the city they
  // picked in Otzaria's calendar (settings key 'key-selected-city') and derive
  // both the display label and ארץ-ישראל/חו״ל from it, mirroring the host's own
  // city→country table (data/locations.js). Falls back to Israel when unknown
  // (e.g. standalone preview, or a city missing from the table).
  var ISRAEL_COUNTRY = 'ארץ ישראל';
  async function refreshLocation() {
    var city = await call('settings.get', { key: 'key-selected-city' });
    if (typeof city !== 'string' || !city) city = null;
    var byCity = (window.SIDURON_LOCATIONS && window.SIDURON_LOCATIONS.byCity) || {};
    var country = city ? (byCity[city] || null) : null;
    STATE.city = city;
    STATE.country = country;
    STATE.isInIsrael = country ? (country === ISRAEL_COUNTRY) : true;
  }
  // Short, human label for the day-times strip, e.g. "בני ברק, ישראל".
  function locationLabel() {
    if (!STATE.city) return '';
    var country = STATE.country === ISRAEL_COUNTRY ? 'ישראל' : STATE.country;
    return country ? STATE.city + ', ' + country : STATE.city;
  }

  /* ────────────── Date + flags ────────────── */
  async function refreshDate() {
    await refreshLocation();
    var iso = await call('calendar.getSelectedDate');
    var d;
    if (iso) { d = new Date(iso); if (isNaN(d.getTime())) d = new Date(); }
    else d = new Date();
    // Normalise to local noon to avoid TZ day-shift in hebcal.
    STATE.date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    STATE.dayFlags = window.SiduronCalendar.flagsFor(STATE.date, userContext());
    renderHeader();
    await renderZmanim();
  }

  // Set both the in-content title and the compact header title (shown on scroll).
  function setTitle(t) {
    var a = document.getElementById('hdr-title'); if (a) a.textContent = t || '';
    var b = document.getElementById('hdr-svc'); if (b) b.textContent = t || '';
  }

  function userContext() {
    return {
      nusach: STATE.nusach, gender: STATE.gender, isInIsrael: STATE.isInIsrael,
      withMinyan: STATE.withMinyan, purimDate: STATE.purimDate,
    };
  }

  function renderHeader() {
    var df = STATE.dayFlags, hd = df && df.hd;
    var dateEl = document.getElementById('hdr-date');
    if (hd) {
      // hebcal renders the full Hebrew date with gershayim, e.g. "כ״ט סיון תשפ״ו".
      var s;
      try { s = hd.renderGematriya(true); } catch (e) { s = ''; }
      if (!s) s = gershize(hebNum(hd.getDate())) + ' ' + hd.getMonthName();
      dateEl.textContent = s;
    } else dateEl.textContent = '';

    // Flag badges.
    var bEl = document.getElementById('hdr-badges');
    var flags = df ? df.flags : [];
    var html = '';
    for (var i = 0; i < BADGE_ORDER.length; i++) {
      var f = BADGE_ORDER[i];
      if (flags.indexOf(f) >= 0 && FLAG_BADGES[f]) {
        html += '<span class="badge ' + FLAG_BADGES[f][1] + '">' + FLAG_BADGES[f][0] + '</span>';
      }
    }
    if (df && df.omerDay != null) {
      html += '<span class="badge b-teal">עומר: יום ' + df.omerDay + '</span>';
    }
    if (df && df.upcomingParshah && df.upcomingParshah.he) {
      html += '<span class="badge b-ghost">' + df.upcomingParshah.he + '</span>';
    }
    bEl.innerHTML = html || '<span class="badge b-ghost">יום חול</span>';

    // Tal/Geshem hint.
    var seasonEl = document.getElementById('hdr-season');
    if (df) {
      var season = flags.indexOf('mashiv_haruach') >= 0 ? 'משיב הרוח ומוריד הגשם' : 'מוריד הטל';
      var tu = flags.indexOf('tal_umatar') >= 0 ? ' · ותן טל ומטר' : '';
      seasonEl.textContent = season + tu;
    }
  }

  var ZMAN_ORDER = [
    ['עלות השחר', ['alotHaShachar', 'alos72Zmanis', 'alos72Degrees', 'alotHashachar']],
    ['משיכיר', ['misheyakir', 'misheyakir11', 'misheyakir10point2']],
    ['הנץ החמה', ['sunrise', 'netz', 'seaLevelSunrise']],
    ['סו״ז ק״ש מג״א', ['sofZmanShmaMGA', 'sofZmanShmaMGA72Degrees', 'sofZmanShmaMGA72Zmanis']],
    ['סו״ז ק״ש גר״א', ['sofZmanShma', 'sofZmanShmaGRA']],
    ['סו״ז תפילה גר״א', ['sofZmanTfilla', 'sofZmanTfilaGRA']],
    ['חצות', ['chatzot', 'chatzos']],
    ['מנחה גדולה', ['minchaGedola', 'minchaGedolaGRA']],
    ['מנחה קטנה', ['minchaKetana']],
    ['פלג המנחה', ['plagHaMincha', 'plagGRA']],
    ['שקיעה', ['shkiah', 'sunset', 'seaLevelSunset']],
    ['צאת הכוכבים', ['tzeit', 'tzet', 'tzeitGeonim8point5']],
  ];
  // Location strip above the times — surfaces which city the times were
  // computed for, so a wrong city in Otzaria can't silently skew the zmanim.
  function renderLocationStrip() {
    var place = locationLabel();
    if (!place) return '';
    return '<div class="zmanim-loc" title="המיקום נקבע לפי העיר שנבחרה באוצריא">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>' +
      '<span>' + window.SiduronRender.esc(place) + '</span></div>';
  }
  async function renderZmanim() {
    var el = document.getElementById('zmanim-body');
    if (!el) return;
    var loc = renderLocationStrip();
    var times = await call('calendar.getDailyTimes');
    if (!times || typeof times !== 'object') { el.innerHTML = loc + '<div class="muted">זמני היום אינם זמינים</div>'; return; }
    var html = '';
    for (var i = 0; i < ZMAN_ORDER.length; i++) {
      var lbl = ZMAN_ORDER[i][0], keys = ZMAN_ORDER[i][1], val = null;
      for (var k = 0; k < keys.length; k++) if (times[keys[k]] != null) { val = times[keys[k]]; break; }
      if (val == null) continue;
      html += '<div class="zman"><span class="z-name">' + lbl + '</span><span class="z-val">' + val + '</span></div>';
    }
    el.innerHTML = loc + (html ? '<div class="panel-card">' + html + '</div>' : '<div class="muted">זמני היום אינם זמינים</div>');
  }

  /* ────────────── Service tabs + rendering ────────────── */
  function renderTabs() {
    var bar = document.getElementById('tabs');
    bar.innerHTML = '';
    SERVICES.forEach(function (s) {
      if (s.showIf && !s.showIf()) return;
      var b = document.createElement('button');
      b.className = 'tab' + (STATE.service === s.id ? ' active' : '');
      b.textContent = s.he;
      b.onclick = function () { openService(s.id); };
      bar.appendChild(b);
    });
  }

  function serviceById(id) { for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i]; return null; }

  function openService(id) {
    var svc = serviceById(id);
    // Fall back when the requested service isn't available today (e.g. the
    // Omer tab on a non-Omer day, restored from saved state).
    if (!svc || (svc.showIf && !svc.showIf())) { svc = serviceById('shacharit'); }
    if (!svc) return;
    id = svc.id;
    STATE.service = id;
    storageSet('service', id);
    renderTabs();

    if (svc.extras) { renderExtrasView(); return; }
    STATE.extra = null;

    var contentEl = document.getElementById('content');
    var templateId = svc.template(STATE.nusach);
    var result;
    try {
      var segs = window.SiduronAssembler.assemble(templateId, userContext(), STATE.dayFlags);
      result = window.SiduronRender.render(segs);
    } catch (e) {
      contentEl.innerHTML = '<div class="muted center">שגיאה בהרכבת התפילה: ' + window.SiduronRender.esc(String(e && e.message || e)) + '</div>';
      return;
    }
    STATE.nav = result.nav;
    setTitle(svc.he);
    contentEl.innerHTML = '<div class="prayer fade-in">' + applyCensor(result.html) + '</div>';
    contentEl.scrollTop = 0;
    var sc = document.getElementById('reader-scroll'); if (sc) sc.scrollTop = 0;
    renderNavList();
  }

  /* ────────────── Extras (תוספות) view ────────────── */
  function renderExtrasView() {
    var contentEl = document.getElementById('content');
    var sc = document.getElementById('reader-scroll'); if (sc) sc.scrollTop = 0;
    contentEl.scrollTop = 0;

    if (!window.SiduronExtras) { contentEl.innerHTML = '<div class="muted center">התוספות לא נטענו.</div>'; return; }

    if (!STATE.extra) {
      // Menu of extras.
      setTitle('תוספות וברכות');
      STATE.nav = [];
      contentEl.innerHTML = '<div class="extras-menu fade-in">' + window.SiduronExtras.renderMenu() + '</div>';
      var cards = contentEl.querySelectorAll('[data-extra]');
      for (var i = 0; i < cards.length; i++) {
        cards[i].onclick = function () { STATE.extra = this.getAttribute('data-extra'); renderExtrasView(); };
      }
      return;
    }
    // A specific extra.
    var item = null, list = window.SiduronExtras.list();
    for (var k = 0; k < list.length; k++) if (list[k].id === STATE.extra) item = list[k];
    setTitle(item ? item.title : 'תוספת');
    var result = window.SiduronExtras.renderExtra(STATE.extra, STATE.nusach, STATE.dayFlags);
    STATE.nav = result.nav || [];
    contentEl.innerHTML =
      '<button class="extras-back" id="extras-back">‹ חזרה לרשימת התוספות</button>' +
      '<div class="prayer fade-in">' + applyCensor(result.html) + '</div>';
    var back = document.getElementById('extras-back');
    if (back) back.onclick = function () { STATE.extra = null; renderExtrasView(); };
    renderNavList();
  }

  function rerender() {
    STATE.dayFlags = window.SiduronCalendar.flagsFor(STATE.date, userContext());
    renderHeader();
    renderTabs();
    if (STATE.service) openService(STATE.service);
  }

  // Re-read date + location from Otzaria, recompute flags, and repaint
  // everything (header, tabs, current service, zmanim, settings label).
  // Used on both calendar.date_changed and city changes.
  function refreshAndRerender() {
    return refreshDate().then(function () {
      renderTabs();
      if (STATE.service) openService(STATE.service);
      buildSettings();
    });
  }

  /* ────────────── Jump-to-section ────────────── */
  function renderNavList() {
    var el = document.getElementById('nav-body');
    if (!el) return;
    if (!STATE.nav.length) { el.innerHTML = '<div class="muted">אין קטעים</div>'; return; }
    el.innerHTML = '<div class="panel-card">' + STATE.nav.map(function (n) {
      return '<button class="nav-item" data-anchor="' + n.anchor + '">' + window.SiduronRender.esc(n.label) + '</button>';
    }).join('') + '</div>';
    var btns = el.querySelectorAll('.nav-item');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var a = this.getAttribute('data-anchor');
        var target = document.getElementById(a);
        closeAllPanels();
        if (target) {
          // expand a parent accordion if collapsed.
          var det = target.closest('details');
          if (det && !det.open) det.open = true;
          if (target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    }
  }

  /* ────────────── Service auto-selection by time ────────────── */
  function pickServiceByTime(times) {
    // Only meaningful when the selected date is "today".
    var now = new Date();
    var sameDay = STATE.date && now.toDateString() === STATE.date.toDateString();
    if (!sameDay || !times) return 'shacharit';
    function mins(v) { if (!v) return null; var m = String(v).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] * 60 + +m[2]) : null; }
    var nowM = now.getHours() * 60 + now.getMinutes();
    var chatzot = mins(times.chatzot || times.chatzos);
    var sunset = mins(times.shkiah || times.sunset || times.seaLevelSunset);
    if (chatzot != null && nowM < chatzot) return 'shacharit';
    if (sunset != null && nowM < sunset) return 'mincha';
    return 'maariv';
  }

  /* ────────────── Settings panel ────────────── */
  // Build a connected segmented control (single-select), like SegmentedSettingsTile.
  // opts: array of [value, label]. onPick(value) is called on selection.
  function buildSegment(elId, opts, current, onPick) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = opts.map(function (o) {
      var sel = current === o[0];
      return '<button type="button" class="' + (sel ? 'active' : '') +
        '" data-val="' + o[0] + '" aria-pressed="' + sel + '">' + o[1] + '</button>';
    }).join('');
    el.querySelectorAll('[data-val]').forEach(function (b) {
      b.onclick = function () { onPick(this.getAttribute('data-val')); };
    });
  }

  // Build a dropdown (single-select), like DropdownSettingsTile — for long option lists.
  // opts: array of [value, label]. onPick(value) is called on selection.
  function buildSelect(elId, opts, current, onPick) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (current === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    el.onchange = function () { onPick(this.value); };
  }

  function buildSettings() {
    // Nusach
    buildSegment('set-nusach', NUSACHIM.map(function (n) { return [n.id, n.he]; }), STATE.nusach,
      function (v) { STATE.nusach = v; storageSet('nusach', v); buildSettings(); rerender(); });
    // Gender
    buildSegment('set-gender', [['male', 'זכר'], ['female', 'נקבה']], STATE.gender,
      function (v) { STATE.gender = v; storageSet('gender', v); buildSettings(); rerender(); });
    // Purim date (walled cities)
    buildSegment('set-purim', [['fourteenth', 'י״ד'], ['fifteenth', 'ט״ו'], ['both', 'שניהם']], STATE.purimDate,
      function (v) { STATE.purimDate = v; storageSet('purimDate', v); buildSettings(); rerender(); });
    // Font family (first = default: follow Otzaria). Dropdown — long labels.
    buildSelect('set-font',
      [['', 'ברירת מחדל'], ['FrankRuhlCLM', 'פרנק רוהל'], ['David', 'דוד'], ['TaameyFrankCLM', 'טעמי פרנק'], ['Shofar', 'שופר']],
      STATE.fontFamily,
      function (v) { STATE.fontFamily = v; storageSet('fontFamily', v); applyFont(); });
    // Text width.
    buildSegment('set-width', [['600', 'צר'], ['760', 'בינוני'], ['920', 'רחב'], ['full', 'מלא']], STATE.textWidth,
      function (v) { STATE.textWidth = v; storageSet('textWidth', v); applyWidth(); buildSettings(); });
    // Location (read-only — derived from the city chosen in Otzaria).
    var locEl = document.getElementById('set-location');
    if (locEl) {
      var place = locationLabel();
      locEl.textContent = place
        ? place + ' · נקבע לפי העיר שנבחרה באוצריא'
        : 'נקבע לפי העיר שנבחרה באוצריא';
    }
    // Desktop shortcut — only meaningful on desktop hosts.
    var shortcutCard = document.getElementById('card-shortcut');
    if (shortcutCard) shortcutCard.hidden = !isDesktop();
    var shortcutBtn = document.getElementById('set-shortcut');
    if (shortcutBtn) shortcutBtn.onclick = createShortcut;
    // Toggles
    setToggle('set-minyan', STATE.withMinyan, function (v) { STATE.withMinyan = v; storageSet('withMinyan', v); rerender(); });
    setToggle('set-censor', STATE.censorNames, function (v) { STATE.censorNames = v; storageSet('censorNames', v); if (STATE.service) openService(STATE.service); });
    var fv = document.getElementById('fs-val'); if (fv) fv.textContent = String(STATE.fontSize);
  }
  function setToggle(id, on, onChange) {
    var el = document.getElementById(id); if (!el) return;
    el.classList.toggle('on', !!on);
    el.onclick = function () { var v = !el.classList.contains('on'); el.classList.toggle('on', v); onChange(v); };
  }

  /* ────────────── Font size ────────────── */
  var FS_MIN = 16, FS_MAX = 40;
  function applyFontSize(px) {
    px = Math.max(FS_MIN, Math.min(FS_MAX, parseInt(px, 10) || 22));
    STATE.fontSize = px;
    document.documentElement.style.setProperty('--font-size-base', px + 'px');
    var v = document.getElementById('fs-val'); if (v) v.textContent = String(px);
  }
  function changeFont(d) { applyFontSize(STATE.fontSize + d); storageSet('fontSize', STATE.fontSize); }

  /* ────────────── Font family ────────────── */
  // Built-in serif fallbacks appended so the prayer text always renders nicely.
  var FONT_FALLBACK = "'David', 'Noto Serif Hebrew', serif";
  function applyFont() {
    var fam = STATE.fontFamily || STATE.themeFont || 'FrankRuhlCLM';
    document.documentElement.style.setProperty('--prayer-font', "'" + fam + "', " + FONT_FALLBACK);
  }

  /* ────────────── Text width ────────────── */
  function applyWidth() {
    var w = STATE.textWidth === 'full' ? '100%' : (parseInt(STATE.textWidth, 10) || 760) + 'px';
    document.documentElement.style.setProperty('--content-width', w);
  }

  /* ────────────── Desktop shortcut (shortcut.create) ────────────── */
  // Shortcuts are a desktop-only host capability; the host builds a safe
  // deep-link (otzaria://open/plugin/<id>) and shows its own confirm dialog,
  // so the plugin only supplies a label.
  function isDesktop() {
    return ['windows', 'linux', 'macos'].indexOf(STATE.platform) >= 0;
  }
  async function createShortcut() {
    var btn = document.getElementById('set-shortcut');
    if (btn) btn.disabled = true;
    var res = await call('shortcut.create', { label: 'סידורון', location: 'desktop' });
    if (btn) btn.disabled = false;
    if (res && res.created) {
      call('ui.showSuccess', { message: 'נוצר קיצור דרך לסידורון בשולחן העבודה.' });
    } else if (res && res.created === false) {
      // User dismissed the host's confirm dialog — nothing to do.
    } else {
      call('ui.showError', { message: 'לא ניתן היה ליצור קיצור דרך. ודאו שהענקתם לתוסף הרשאה ליצירת קיצורי דרך.' });
    }
  }

  /* ────────────── Panels ────────────── */
  function closeAllPanels() {
    var open = document.querySelectorAll('.panel.open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
    var bd = document.getElementById('backdrop'); if (bd) bd.classList.remove('open');
  }
  function togglePanel(panelId) {
    var p = document.getElementById(panelId); if (!p) return;
    var wasOpen = p.classList.contains('open');
    closeAllPanels();
    if (!wasOpen) { p.classList.add('open'); document.getElementById('backdrop').classList.add('open'); }
  }

  /* ────────────── Load / save settings ────────────── */
  async function loadSettings() {
    // 'isInIsrael' is intentionally absent — it's derived from Otzaria's
    // selected city (see refreshLocation), not stored as a manual preference.
    var keys = ['nusach', 'gender', 'withMinyan', 'purimDate', 'censorNames', 'fontSize', 'fontFamily', 'textWidth', 'service'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]; var v = await storageGet(k);
      if (v == null) continue;
      if (k === 'fontSize') STATE.fontSize = v;
      else STATE[k] = v;
    }
  }

  /* ────────────── Boot ────────────── */
  function wireUi() {
    document.getElementById('btn-zmanim').onclick = function () { togglePanel('panel-zmanim'); };
    document.getElementById('btn-nav').onclick = function () { renderNavList(); togglePanel('panel-nav'); };
    document.getElementById('btn-settings').onclick = function () { buildSettings(); togglePanel('panel-settings'); };
    var bd = document.getElementById('backdrop'); if (bd) bd.onclick = closeAllPanels;
    var closers = document.querySelectorAll('[data-close]');
    for (var i = 0; i < closers.length; i++) closers[i].onclick = closeAllPanels;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllPanels(); });
    document.getElementById('fs-dec').onclick = function () { changeFont(-1); };
    document.getElementById('fs-inc').onclick = function () { changeFont(1); };

    // Collapse the header (tabs + badges) on scroll, surfacing the compact
    // prayer title — gives the text more vertical room while reading.
    var sc = document.getElementById('reader-scroll');
    if (sc) {
      var collapsed = false;
      sc.addEventListener('scroll', function () {
        var should = sc.scrollTop > 36;
        if (should !== collapsed) { collapsed = should; document.body.classList.toggle('scrolled', should); }
      });
    }
  }

  // Standalone (no Otzaria): inject a date simulator bar for QA/preview.
  function injectDevBar() {
    if (document.getElementById('dev-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'dev-bar';
    bar.style.cssText = 'position:fixed;bottom:14px;inset-inline-end:14px;z-index:60;display:flex;gap:6px;align-items:center;background:var(--c-surface-container-highest);padding:6px 10px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.2);font-family:var(--ui-font);font-size:.8rem;';
    var iso = STATE.date ? STATE.date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    bar.innerHTML = '<span style="opacity:.7">תאריך (תצוגה):</span>' +
      '<input type="date" id="dev-date" value="' + iso + '" style="font-family:inherit;border:1px solid var(--c-outline-variant);border-radius:8px;padding:3px 6px;background:var(--c-surface);color:var(--c-on-surface)">';
    document.body.appendChild(bar);
    document.getElementById('dev-date').onchange = function () {
      if (this.value) window.SiduronApp.setDate(this.value);
    };
  }

  async function boot() {
    try {
      await loadSettings();
      applyFontSize(STATE.fontSize);
      applyFont();
      applyWidth();
      await refreshDate();
      if (!hasOtzaria()) injectDevBar();
      // Auto-pick the service by time of day, unless one was saved.
      if (!STATE.service) {
        var times = await call('calendar.getDailyTimes');
        STATE.service = pickServiceByTime(times);
      }
      renderTabs();
      buildSettings();
      openService(STATE.service || 'shacharit');
    } catch (e) {
      document.getElementById('content').innerHTML =
        '<div class="muted center">שגיאה בטעינת הסידור: ' + window.SiduronRender.esc(String(e && e.message || e)) + '</div>';
    }
  }

  /* ────────────── Init ────────────── */
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(wireUi);

  if (typeof window.Otzaria !== 'undefined' && window.Otzaria.on) {
    window.Otzaria.on('plugin.boot', function (payload) {
      if (payload && payload.app && payload.app.platform) STATE.platform = payload.app.platform;
      applyTheme(payload && payload.theme);
      boot();
    });
    window.Otzaria.on('theme.changed', applyTheme);
    window.Otzaria.on('calendar.date_changed', refreshAndRerender);
    window.Otzaria.on('settings.changed', function (e) {
      // The selected city lives in the calendar state; changing it re-derives
      // our location + ארץ-ישראל and can flip flags (tefillin, mussaf, …),
      // so recompute everything just like a date change.
      if (e && e.key === 'key-selected-city') refreshAndRerender();
    });
  } else {
    // Standalone (dev / browser preview) — boot when the DOM is ready.
    onReady(boot);
  }

  // Expose a tiny dev API for the standalone preview harness.
  window.SiduronApp = {
    setDate: function (iso) {
      var d = new Date(iso);
      STATE.date = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
      rerender();
    },
    // Simulate Otzaria's selected city (no SDK in standalone) — derives the
    // location label + ארץ-ישראל from the same table the host uses.
    setCity: function (city) {
      var byCity = (window.SIDURON_LOCATIONS && window.SIDURON_LOCATIONS.byCity) || {};
      STATE.city = city || null;
      STATE.country = STATE.city ? (byCity[STATE.city] || null) : null;
      STATE.isInIsrael = STATE.country ? (STATE.country === ISRAEL_COUNTRY) : true;
      rerender();
      renderZmanim();
      buildSettings();
    },
    state: STATE,
  };
})();
