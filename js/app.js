/* app.js — חיבור הכל יחד: טעינת נתונים, theme, לוח שנה, ניווט ורינדור. */
(function () {
  'use strict';

  var TEXTS = {};      // name -> raw markup
  var TITLES = {};     // name -> כותרת עברית
  var HASNAME = {};    // name -> true
  var STATE = {
    nusach: 'edot',
    current: null,     // base id של התפילה הנבחרת
    ctx: null,         // הקשר תאריך
    classify: null,
    isoDate: null
  };

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    if (!theme || !theme.colorScheme) return;
    var cs = theme.colorScheme, r = document.documentElement;
    function set(k, v) { if (v) r.style.setProperty(k, v); }
    set('--color-primary', cs.primary); set('--color-on-primary', cs.onPrimary);
    set('--color-secondary', cs.secondary); set('--color-on-secondary', cs.onSecondary);
    set('--color-secondary-container', cs.secondaryContainer);
    set('--color-on-secondary-container', cs.onSecondaryContainer);
    set('--color-surface', cs.surface); set('--color-on-surface', cs.onSurface);
    set('--color-on-surface-variant', cs.onSurfaceVariant);
    set('--color-surface-container', cs.surfaceContainer);
    set('--color-surface-container-high', cs.surfaceContainerHigh);
    set('--color-surface-container-highest', cs.surfaceContainerHighest);
    set('--color-error', cs.error); set('--color-on-error', cs.onError);
    set('--color-outline', cs.outline); set('--color-outline-variant', cs.outlineVariant);
    if (cs.primary) {
      r.style.setProperty('--color-primary-subtle', hexToRgba(cs.primary, 0.12));
    }
    if (cs.secondary) {
      r.style.setProperty('--color-secondary-subtle', hexToRgba(cs.secondary, 0.12));
    }
    document.body.classList.toggle('dark-mode', theme.mode === 'dark');
    if (theme.typography) {
      var tp = theme.typography;
      // גופן התוסף קבוע (Segoe UI מתוך fonts/) — לא נדרס מ-theme.
      // מכבדים רק גודל וריווח שורה מהגדרות אוצריא.
      if (tp.fontSize) r.style.setProperty('--font-size-base', tp.fontSize + 'px');
      if (tp.lineHeight) r.style.setProperty('--line-height', String(tp.lineHeight));
    }
  }
  function hexToRgba(hex, a) {
    try {
      var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    } catch (e) { return 'rgba(103,80,164,' + a + ')'; }
  }

  /* ---------- API helpers ---------- */
  async function call(method, params) {
    try {
      var res = await Otzaria.call(method, params || {});
      return res && res.success ? res.data : null;
    } catch (e) { return null; }
  }

  /* ---------- טעינת נתוני הסידור ---------- */
  async function loadData() {
    // בטעינה מ-file:// (כפי שאוצריא טוען את התוסף) הפקודה fetch חסומה,
    // לכן הנתונים נטענים דרך תגי <script> (data/texts.js, data/titles.js).
    // ה-fetch נשאר כגיבוי עבור הרצה משרת http בפיתוח.
    if (window.SIDURON_TEXTS && window.SIDURON_TITLES) {
      TEXTS = window.SIDURON_TEXTS;
      TITLES = window.SIDURON_TITLES;
    } else {
      TEXTS = await fetch('data/texts.json').then(function (r) { return r.json(); });
      TITLES = await fetch('data/titles.json').then(function (r) { return r.json(); });
    }
    Object.keys(TEXTS).forEach(function (k) { HASNAME[k] = true; });
  }

  /* ---------- הקשר תאריך + זמנים ---------- */
  async function refreshDate() {
    STATE.isoDate = await call('calendar.getSelectedDate');
    var jd = await call('calendar.getJewishDate');
    var times = await call('calendar.getDailyTimes');
    STATE.ctx = SiduronConditions.buildContext(jd || {}, STATE.isoDate);
    STATE.classify = SiduronConditions.makeClassifier(STATE.ctx);
    renderHeader(jd, times);
  }

  function renderHeader(jd, times) {
    var hd = document.getElementById('hdr-date');
    var ht = document.getElementById('hdr-times');
    var hh = document.getElementById('hdr-holidays');
    if (jd) {
      var heDate = gershize(hebNum(jd.day)) + ' ' + (jd.monthName || '') +
        ' ' + toHebYear(jd.year);
      hd.textContent = heDate.trim();
    } else { hd.textContent = ''; }

    if (jd && jd.holidays && jd.holidays.length) {
      hh.innerHTML = jd.holidays.map(function (h) {
        return '<span class="chip">' + esc(h.text) + '</span>';
      }).join('');
      hh.style.display = '';
    } else { hh.style.display = 'none'; hh.innerHTML = ''; }

    if (times && typeof times === 'object') {
      // אוצריא מחזיר את כל מערך הזמנים של ספריית KosherJava (עשרות מפתחות
      // טכניים באנגלית). מציגים רק רשימה נבחרת עם תוויות עבריות, לפי סדר היום.
      // לכל זמן רשומים כמה שמות-מפתח אפשריים; נבחר הראשון הקיים.
      var order = [
        ['עלות השחר', ['alos72Zmanis', 'alos72Degrees', 'alotHashachar', 'alos90Degrees']],
        ['משיכיר', ['misheyakir11', 'misheyakir10point2', 'misheyakir11point5', 'misheyakir']],
        ['הנץ החמה', ['sunrise', 'netz', 'seaLevelSunrise']],
        ['סו"ז ק"ש מג"א', ['sofZmanShmaMGA72Degrees', 'sofZmanShmaMGA72Zmanis', 'sofZmanShemaMGA']],
        ['סו"ז ק"ש גר"א', ['sofZmanShmaGRA', 'sofZmanShema']],
        ['סו"ז תפילה מג"א', ['sofZmanTfilaMGA72Degrees', 'sofZmanTfilaMGA72Zmanis']],
        ['סו"ז תפילה גר"א', ['sofZmanTfilaGRA', 'sofZmanTfila']],
        ['חצות', ['chatzos', 'chatzot']],
        ['מנחה גדולה', ['minchaGedolaGRA', 'minchaGedola30', 'minchaGedola16point1', 'minchaGedola']],
        ['מנחה קטנה', ['minchaKetanaGRA', 'minchaKetana16point1', 'minchaKetana']],
        ['פלג המנחה', ['plagGRA', 'plagHamincha']],
        ['שקיעה', ['sunset', 'shkia', 'seaLevelSunset']],
        ['צאת הכוכבים', ['tzeitGeonim8point5', 'tzeitGeonim7point083', 'tzet', 'tzetHakochavim']],
        ['ר"ת', ['rt72Zmanis', 'rt72Shavos']]
      ];
      var html = '';
      order.forEach(function (p) {
        var label = p[0], keys = p[1], val = null;
        for (var i = 0; i < keys.length; i++) {
          if (times[keys[i]] != null) { val = times[keys[i]]; break; }
        }
        if (val == null) return;
        html += '<div class="zman"><span class="z-name">' + esc(label) +
          '</span><span class="z-val">' + esc(String(val)) + '</span></div>';
      });
      ht.innerHTML = html || '<div class="muted">זמני היום אינם זמינים</div>';
    } else { ht.innerHTML = '<div class="muted">זמני היום אינם זמינים</div>'; }
  }

  // מספר עברי (גימטריה) ל-1..999, ללא גרשיים.
  function hebNum(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return '';
    var ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    var tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    var huns = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
    n = n % 1000;
    var s = huns[Math.floor(n / 100)];
    n = n % 100;
    if (n === 15) s += 'טו';
    else if (n === 16) s += 'טז';
    else { s += tens[Math.floor(n / 10)] + ones[n % 10]; }
    return s;
  }
  // הוספת גרש/גרשיים למספר עברי.
  function gershize(s) {
    if (!s) return '';
    if (s.length === 1) return s + '׳';
    return s.slice(0, -1) + '״' + s.slice(-1);
  }
  function toHebYear(y) {
    y = parseInt(y, 10);
    if (!y) return '';
    return 'ה׳' + gershize(hebNum(y % 1000)); // לדוגמה: ה'תשפ"ו
  }

  /* ---------- ניווט תפילות ---------- */
  function renderNusachBar() {
    var bar = document.getElementById('nusach-bar');
    bar.innerHTML = '';
    SiduronCatalog.NUSACHIM.forEach(function (n) {
      var b = document.createElement('button');
      b.className = 'pill' + (STATE.nusach === n.id ? ' active' : '');
      b.textContent = n.he;
      b.onclick = function () {
        STATE.nusach = n.id; renderNusachBar(); renderMenu();
        if (STATE.current) openService(STATE.current);
        saveState();
      };
      bar.appendChild(b);
    });
  }

  function renderMenu() {
    var menu = document.getElementById('menu');
    menu.innerHTML = '';
    SiduronCatalog.SERVICES.forEach(function (s) {
      var name = SiduronCatalog.resolve(s.base, STATE.nusach, function (x) { return HASNAME[x]; });
      if (!name) return; // אין קובץ לנוסח זה
      var item = document.createElement('button');
      item.className = 'menu-item' + (STATE.current === s.base ? ' selected' : '');
      item.textContent = s.he;
      item.onclick = function () { openService(s.base); };
      menu.appendChild(item);
    });
  }

  function openService(base) {
    STATE.current = base;
    saveState();
    renderMenu();
    var name = SiduronCatalog.resolve(base, STATE.nusach, function (x) { return HASNAME[x]; });
    var contentEl = document.getElementById('content');
    if (!name || TEXTS[name] == null) {
      contentEl.innerHTML = '<div class="muted center">התפילה אינה זמינה בנוסח זה.</div>';
      return;
    }
    var ctx = {
      getText: function (nm) { return TEXTS[nm] != null ? TEXTS[nm] : null; },
      classify: STATE.classify,
      titleOf: function (nm) { return TITLES[nm] || nm; }
    };
    var html = SiduronParser.parse(TEXTS[name], ctx, HASNAME, 0);
    var title = (SiduronCatalog.SERVICES.filter(function (s) { return s.base === base; })[0] || {}).he || TITLES[name] || name;
    contentEl.innerHTML = '<h2 class="service-title">' + esc(title) + '</h2>' +
      '<div class="prayer fade-in">' + html + '</div>';
    contentEl.scrollTop = 0;
    document.getElementById('reader-scroll').scrollTop = 0;
  }

  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- שמירת מצב ---------- */
  async function saveState() {
    await Otzaria.call('storage.set', { key: 'state', value: { nusach: STATE.nusach, current: STATE.current } });
  }
  async function loadState() {
    var s = await call('storage.get', { key: 'state' });
    if (s && typeof s === 'object') {
      if (s.nusach) STATE.nusach = s.nusach;
      if (s.current) STATE.current = s.current;
    }
  }

  /* ---------- אתחול ---------- */
  Otzaria.on('plugin.boot', async function (payload) {
    applyTheme(payload.theme);
    try {
      await loadData();
      await loadState();
      await refreshDate();
      renderNusachBar();
      renderMenu();
      openService(STATE.current || 'Shaharit');
    } catch (e) {
      document.getElementById('content').innerHTML =
        '<div class="muted center">שגיאה בטעינת הסידור: ' + esc(String(e)) + '</div>';
    }
  });

  Otzaria.on('theme.changed', applyTheme);
  Otzaria.on('calendar.date_changed', function () {
    refreshDate().then(function () { if (STATE.current) openService(STATE.current); });
  });

  /* ---------- חלוניות צד צפות (זמנים / הגדרות) ---------- */
  function setupPanels() {
    var backdrop = document.getElementById('panel-backdrop');
    var map = { 'times-btn': 'times-panel', 'settings-btn': 'settings-panel' };

    function closeAll() {
      var open = document.querySelectorAll('.float-panel.open');
      for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
    }
    function toggle(panelId) {
      var panel = document.getElementById(panelId);
      var wasOpen = panel && panel.classList.contains('open');
      closeAll();
      if (panel && !wasOpen) {
        panel.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
      }
    }

    Object.keys(map).forEach(function (btnId) {
      var b = document.getElementById(btnId);
      if (b) b.onclick = function () { toggle(map[btnId]); };
    });
    if (backdrop) backdrop.onclick = closeAll;
    var closers = document.querySelectorAll('[data-close]');
    for (var i = 0; i < closers.length; i++) closers[i].onclick = closeAll;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  }

  // כפתורי הכותרת
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('menu-toggle');
    if (toggle) toggle.onclick = function () {
      document.getElementById('sidebar').classList.toggle('open');
    };
    setupPanels();
  });
})();
