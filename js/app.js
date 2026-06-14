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
      if (tp.fontFamily) r.style.setProperty('--font-main', "'" + tp.fontFamily + "', 'David', serif");
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
    var t = await fetch('data/texts.json').then(function (r) { return r.json(); });
    var ti = await fetch('data/titles.json').then(function (r) { return r.json(); });
    TEXTS = t; TITLES = ti;
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
      var heDate = (jd.day || '') + ' ' + (jd.monthName || '') + ' ' + toHebYear(jd.year);
      hd.textContent = heDate;
    } else { hd.textContent = ''; }

    if (jd && jd.holidays && jd.holidays.length) {
      hh.innerHTML = jd.holidays.map(function (h) {
        return '<span class="chip">' + esc(h.text) + '</span>';
      }).join('');
      hh.style.display = '';
    } else { hh.style.display = 'none'; hh.innerHTML = ''; }

    if (times && typeof times === 'object') {
      var order = [
        ['alotHashachar', 'עלות השחר'], ['misheyakir', 'משיכיר'],
        ['sunrise', 'הנץ החמה'], ['netz', 'הנץ החמה'],
        ['sofZmanShemaMGA', 'סו"ז ק"ש (מג"א)'], ['sofZmanShema', 'סוף זמן ק"ש'],
        ['sofZmanTfila', 'סוף זמן תפילה'], ['chatzot', 'חצות'],
        ['minchaGedola', 'מנחה גדולה'], ['minchaKetana', 'מנחה קטנה'],
        ['plagHamincha', 'פלג המנחה'], ['sunset', 'שקיעה'], ['shkia', 'שקיעה'],
        ['tzet', 'צאת הכוכבים'], ['tzetHakochavim', 'צאת הכוכבים']
      ];
      var seen = {}, html = '';
      order.forEach(function (p) {
        var key = p[0];
        if (times[key] != null && !seen[p[1]]) {
          seen[p[1]] = 1;
          html += '<div class="zman"><span class="z-name">' + esc(p[1]) +
            '</span><span class="z-val">' + esc(String(times[key])) + '</span></div>';
        }
      });
      // הוספת מפתחות שלא במיפוי
      Object.keys(times).forEach(function (k) {
        if (!order.some(function (p) { return p[0] === k; })) {
          html += '<div class="zman"><span class="z-name">' + esc(k) +
            '</span><span class="z-val">' + esc(String(times[k])) + '</span></div>';
        }
      });
      ht.innerHTML = html;
    } else { ht.innerHTML = '<div class="muted">זמני היום אינם זמינים</div>'; }
  }

  function toHebYear(y) {
    if (!y) return '';
    return 'ה\'' + (y % 1000); // תצוגה פשוטה; אוצריא כבר נותן את התאריך העברי
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

  // כפתור פתיחת/סגירת התפריט בנייד
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.getElementById('menu-toggle');
    if (toggle) toggle.onclick = function () {
      document.getElementById('sidebar').classList.toggle('open');
    };
  });
})();
