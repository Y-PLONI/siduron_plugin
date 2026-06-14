/* parser.js — ממיר את פורמט הסימון של סידורון ל-HTML.
 * תגיות נתמכות:
 *   [MARK]..[/]            כותרת קטע
 *   [NOTE]..[/]            הערת הדרכה
 *   [ADD]..[/]             תוספת לימים מיוחדים (תוכן או שם-קובץ לשילוב)
 *   [DIRECT]..[/]          הפניה לקטע המשך
 *   [EXPANDER title=..]..[/EXPANDER]  קטע מתקפל
 *   [PHEAD]מילה[/]         מילת פתיחה מודגשת
 *   [LINEHEAD]תווית[/]     תווית בתחילת שורה (מספר פסוק וכו')
 *   [INLINE type=fix]..[/] / [INLINE type=note]..[/]  טקסט פנימי בתוך שורה
 *   [WIDE]..[/]            טבלה דו-טורית (מופרד ב-&)
 *   שורה שכולה שם-קובץ      = שילוב (include) של קובץ אחר
 */
(function (global) {
  'use strict';

  function esc(s) {
    return (s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // המרת טקסט חופשי (ללא תגיות) ל-HTML: שורות -> <br>, צמצום ריווח עודף.
  function textToHtml(text) {
    text = text.replace(/\n{3,}/g, '\n\n');
    return esc(text).replace(/\n/g, '<br>');
  }

  function renderWide(body) {
    var rows = body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var html = '<table class="s-wide">';
    rows.forEach(function (r) {
      var cells = r.split('&');
      html += '<tr>' + cells.map(function (c) {
        return '<td>' + esc(c.trim()) + '</td>';
      }).join('') + '</tr>';
    });
    return html + '</table>';
  }

  /* ---- מנתח בלוקים: מפצל לפי שורות, מזהה תגיות-בלוק והכללות ---- */
  // ctx.resolveInclude(name) -> HTML (או null). אם אין ctx, ההכללה מוצגת כתווית.
  function parse(raw, ctx, knownNames, depth) {
    ctx = ctx || {};
    knownNames = knownNames || {};
    depth = depth || 0;
    if (depth > 30) return '';            // הגנה מפני לולאה
    raw = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var out = [];
    var i = 0;
    var lines = raw.split('\n');

    // טוקניזציה גסה לפי שורות, עם איסוף בלוקים רב-שורתיים שנסגרים ב-[/].
    function readBlock(startIdx) {
      // אוסף שורות עד שורה שכולה "[/]"
      var buf = [];
      var j = startIdx;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === '[/]') break;
        buf.push(lines[j]);
      }
      return { body: buf.join('\n'), next: j + 1 };
    }

    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();

      // ---- EXPANDER ----
      var mExp = t.match(/^\[EXPANDER([^\]]*)\]$/);
      if (mExp) {
        var title = (mExp[1].match(/title=(.*)$/) || [, ''])[1].trim();
        var buf = [];
        var j = i + 1;
        for (; j < lines.length; j++) {
          if (lines[j].trim() === '[/EXPANDER]') break;
          buf.push(lines[j]);
        }
        out.push('<details class="s-expander"><summary>' + esc(title || 'הרחבה') +
          '</summary><div class="s-expander-body">' +
          parse(buf.join('\n'), ctx, knownNames, depth + 1) + '</div></details>');
        i = j + 1;
        continue;
      }

      // ---- בלוקים שנפתחים בשורה משלהם ----
      var mBlock = t.match(/^\[(MARK|NOTE|ADD|DIRECT|WIDE)\]$/);
      if (mBlock) {
        var b = readBlock(i + 1);
        var kind = mBlock[1];
        var bodyRaw = b.body;
        if (kind === 'MARK') {
          out.push('<h3 class="s-mark">' + textToHtml(stripBrackets(bodyRaw.trim())) + '</h3>');
        } else if (kind === 'NOTE') {
          out.push('<div class="s-note">' + parseInline(bodyRaw, ctx, knownNames, depth) + '</div>');
        } else if (kind === 'DIRECT') {
          out.push('<div class="s-direct">' + parseInline(bodyRaw, ctx, knownNames, depth) + '</div>');
        } else if (kind === 'WIDE') {
          out.push(renderWide(bodyRaw));
        } else if (kind === 'ADD') {
          out.push(renderAdd(bodyRaw, ctx, knownNames, depth));
        }
        i = b.next;
        continue;
      }

      // ---- שורת הכללה (שם-קובץ בלבד) ----
      var bare = t.replace(/^[‏‎﻿]+/, '').trim();
      if (bare && knownNames[bare]) {
        out.push(renderInclude(bare, ctx, knownNames, depth, false));
        i += 1;
        continue;
      }

      // ---- שורה רגילה (כולל תגיות פנימיות) ----
      if (t === '') {
        out.push('<div class="s-gap"></div>');
      } else {
        out.push('<div class="s-line">' + parseInline(line, ctx, knownNames, depth) + '</div>');
      }
      i += 1;
    }
    return out.join('\n');
  }

  function stripBrackets(s) {
    return s.replace(/^\[/, '').replace(/\]$/, '');
  }

  // תגיות פנימיות בתוך טקסט: PHEAD / LINEHEAD / INLINE, נסגרות ב-[/]
  function parseInline(segment, ctx, knownNames, depth) {
    segment = String(segment == null ? '' : segment);
    var html = '';
    var re = /\[(PHEAD|LINEHEAD|INLINE)([^\]]*)\]([\s\S]*?)\[\/\]/g;
    var last = 0, m;
    while ((m = re.exec(segment)) !== null) {
      html += textToHtml(segment.slice(last, m.index));
      var tag = m[1], attrs = m[2] || '', inner = m[3];
      if (tag === 'PHEAD') {
        html += '<b class="s-phead">' + textToHtml(inner) + '</b>';
      } else if (tag === 'LINEHEAD') {
        html += '<span class="s-linehead">' + textToHtml(inner) + '</span>';
      } else if (tag === 'INLINE') {
        var type = (attrs.match(/type=([a-z]+)/) || [, 'fix'])[1];
        html += '<span class="s-inline-' + esc(type) + '">' + textToHtml(inner) + '</span>';
      }
      last = re.lastIndex;
    }
    html += textToHtml(segment.slice(last));
    return html;
  }

  // [ADD] — גוף עשוי להיות טקסט, או שם-קובץ לשילוב, או תערובת.
  function renderAdd(bodyRaw, ctx, knownNames, depth) {
    var trimmed = bodyRaw.trim().replace(/^[‏‎﻿]+/, '').trim();
    if (trimmed && knownNames[trimmed]) {
      // תוספת מותנית שהיא שם-קובץ
      return renderInclude(trimmed, ctx, knownNames, depth, true);
    }
    // תוספת טקסטואלית מותנית
    var inner = parse(bodyRaw, ctx, knownNames, depth + 1);
    var cls = classifyName(extractCondName(bodyRaw), ctx);
    return wrapConditional(inner, cls, 'תוספת');
  }

  function extractCondName() { return null; }

  // שילוב קובץ אחר, עם הערכת תנאי (אם ctx.classify קיים)
  function renderInclude(name, ctx, knownNames, depth, isAdd) {
    var content = ctx.getText ? ctx.getText(name) : null;
    var innerHtml = content != null ? parse(content, ctx, knownNames, depth + 1) : '';
    var cls = (ctx.classify ? ctx.classify(name) : { kind: 'unknown', applies: null, label: '' });
    if (!isAdd && cls.kind === 'always') {
      return '<div class="s-include">' + innerHtml + '</div>';
    }
    return wrapConditional(innerHtml, cls, ctx.titleOf ? ctx.titleOf(name) : name);
  }

  // עוטף תוכן מותנה: מציג עם תג "להיום" אם חל; אחרת מתקפל עם תווית.
  function wrapConditional(innerHtml, cls, fallbackLabel) {
    if (!cls) cls = { kind: 'unknown', applies: null, label: '' };
    var label = cls.label || fallbackLabel || 'תוספת';
    if (cls.applies === true) {
      return '<div class="s-cond s-cond-on"><div class="s-cond-badge">היום • ' +
        escAttr(label) + '</div>' + innerHtml + '</div>';
    }
    if (cls.applies === false) {
      return '<details class="s-cond s-cond-off"><summary>' + escAttr(label) +
        ' <span class="s-cond-hint">(לא נאמר היום — לחצו להצגה)</span></summary>' +
        '<div class="s-cond-body">' + innerHtml + '</div></details>';
    }
    // לא ידוע — מציגים את התוכן עם תווית עדינה (לא מסתירים דבר)
    return '<div class="s-cond s-cond-maybe"><div class="s-cond-note">' +
      escAttr(label) + '</div>' + innerHtml + '</div>';
  }

  function escAttr(s) { return esc(String(s || '')); }

  // classifyName מסופק בפועל ע"י conditions.js דרך ctx.classify.
  function classifyName() { return { kind: 'unknown', applies: null, label: '' }; }

  global.SiduronParser = { parse: parse, esc: esc };
})(typeof window !== 'undefined' ? window : this);
