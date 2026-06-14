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
    isInIsrael: true,
    withMinyan: true,
    purimDate: 'fourteenth',    // fourteenth | fifteenth | both
    censorNames: false,
    fontSize: 22,
    service: null,              // current service id
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
    tu_bav: ['ט״ו באב', 'b-green'],
  };
  // Order badges appear in.
  var BADGE_ORDER = ['shabbat', 'rosh_hashanah', 'yom_kippur', 'aseret_yemei_teshuva',
    'pesach', 'chol_hamoed_pesach', 'shavuot', 'sukkot', 'chol_hamoed_sukkot',
    'hoshana_raba', 'shemini_atzeret', 'simchat_torah', 'rosh_chodesh', 'chanukah',
    'purim', 'fast_day', 'tisha_beav', 'tu_bishvat', 'lag_baomer', 'tu_bav',
    'pesach_sheni', 'isru_chag', 'omer_period'];

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
    if (cs.primary) set('--c-primary-subtle', hexToRgba(cs.primary, 0.12));
    document.body.classList.toggle('dark', theme.mode === 'dark');
    if (theme.typography) {
      var tp = theme.typography;
      if (tp.lineHeight) r.style.setProperty('--line-height', String(tp.lineHeight));
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

  /* ────────────── Date + flags ────────────── */
  async function refreshDate() {
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
  async function renderZmanim() {
    var el = document.getElementById('zmanim-body');
    if (!el) return;
    var times = await call('calendar.getDailyTimes');
    if (!times || typeof times !== 'object') { el.innerHTML = '<div class="muted">זמני היום אינם זמינים</div>'; return; }
    var html = '';
    for (var i = 0; i < ZMAN_ORDER.length; i++) {
      var lbl = ZMAN_ORDER[i][0], keys = ZMAN_ORDER[i][1], val = null;
      for (var k = 0; k < keys.length; k++) if (times[keys[k]] != null) { val = times[keys[k]]; break; }
      if (val == null) continue;
      html += '<div class="zman"><span class="z-name">' + lbl + '</span><span class="z-val">' + val + '</span></div>';
    }
    el.innerHTML = html || '<div class="muted">זמני היום אינם זמינים</div>';
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
    var titleEl = document.getElementById('hdr-title');
    if (titleEl) titleEl.textContent = svc.he;
    contentEl.innerHTML = '<div class="prayer fade-in">' + applyCensor(result.html) + '</div>';
    contentEl.scrollTop = 0;
    var sc = document.getElementById('reader-scroll'); if (sc) sc.scrollTop = 0;
    renderNavList();
  }

  function rerender() {
    STATE.dayFlags = window.SiduronCalendar.flagsFor(STATE.date, userContext());
    renderHeader();
    renderTabs();
    if (STATE.service) openService(STATE.service);
  }

  /* ────────────── Jump-to-section ────────────── */
  function renderNavList() {
    var el = document.getElementById('nav-body');
    if (!el) return;
    if (!STATE.nav.length) { el.innerHTML = '<div class="muted">אין קטעים</div>'; return; }
    el.innerHTML = STATE.nav.map(function (n) {
      return '<button class="nav-item" data-anchor="' + n.anchor + '">' + window.SiduronRender.esc(n.label) + '</button>';
    }).join('');
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
  function buildSettings() {
    // Nusach radios
    var nu = document.getElementById('set-nusach');
    nu.innerHTML = NUSACHIM.map(function (n) {
      return '<button class="pill' + (STATE.nusach === n.id ? ' active' : '') + '" data-nusach="' + n.id + '">' + n.he + '</button>';
    }).join('');
    nu.querySelectorAll('[data-nusach]').forEach(function (b) {
      b.onclick = function () { STATE.nusach = this.getAttribute('data-nusach'); storageSet('nusach', STATE.nusach); buildSettings(); rerender(); };
    });
    // Gender
    var gn = document.getElementById('set-gender');
    gn.innerHTML = [['male', 'זכר'], ['female', 'נקבה']].map(function (g) {
      return '<button class="pill' + (STATE.gender === g[0] ? ' active' : '') + '" data-gender="' + g[0] + '">' + g[1] + '</button>';
    }).join('');
    gn.querySelectorAll('[data-gender]').forEach(function (b) {
      b.onclick = function () { STATE.gender = this.getAttribute('data-gender'); storageSet('gender', STATE.gender); buildSettings(); rerender(); };
    });
    // Toggles
    setToggle('set-israel', STATE.isInIsrael, function (v) { STATE.isInIsrael = v; storageSet('isInIsrael', v); rerender(); });
    setToggle('set-minyan', STATE.withMinyan, function (v) { STATE.withMinyan = v; storageSet('withMinyan', v); rerender(); });
    setToggle('set-censor', STATE.censorNames, function (v) { STATE.censorNames = v; storageSet('censorNames', v); if (STATE.service) openService(STATE.service); });
    // Purim date
    var pd = document.getElementById('set-purim');
    pd.innerHTML = [['fourteenth', 'י״ד'], ['fifteenth', 'ט״ו'], ['both', 'שניהם']].map(function (p) {
      return '<button class="pill' + (STATE.purimDate === p[0] ? ' active' : '') + '" data-purim="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
    pd.querySelectorAll('[data-purim]').forEach(function (b) {
      b.onclick = function () { STATE.purimDate = this.getAttribute('data-purim'); storageSet('purimDate', STATE.purimDate); buildSettings(); rerender(); };
    });
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
    var keys = ['nusach', 'gender', 'isInIsrael', 'withMinyan', 'purimDate', 'censorNames', 'fontSize', 'service'];
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
    window.Otzaria.on('plugin.boot', function (payload) { applyTheme(payload && payload.theme); boot(); });
    window.Otzaria.on('theme.changed', applyTheme);
    window.Otzaria.on('calendar.date_changed', function () { refreshDate().then(function () { if (STATE.service) { renderTabs(); openService(STATE.service); } }); });
    window.Otzaria.on('settings.changed', function () { /* font/theme handled via theme.changed */ });
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
    state: STATE,
  };
})();
