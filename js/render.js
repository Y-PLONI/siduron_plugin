/* render.js — turns assembled segments into the prayer HTML.
 *
 * Input: [{ id, resolvedText, optional, groupId }] from SiduronAssembler.
 * Output: { html, nav } where nav = [{ id, label, anchor }] for jump-to-section.
 *
 * Rendering rules (mirrors smart-siddur's UX intent):
 *   • A segment with a label but no body text  → a section HEADER (<h3>).
 *   • A segment with body text                 → prayer lines; if it also has
 *     a label, a small inline section title precedes it.
 *   • optional:true segments                   → collapsed <details> accordion
 *     (rarely-said alternates the engine left in).
 *   • consecutive segments sharing a groupId    → one collapsed accordion
 *     (e.g. חזרת הש״ץ).
 *   • <b>…</b> inside text is preserved as bold; everything else is escaped.
 *
 * The engine has already decided what applies *today*, so applicable inserts
 * render inline with no toggle — the siddur shows the correct text by default.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Escape HTML but keep <b>/</b> bold tags coming from the data/post-processors.
  function escKeepBold(s) {
    return esc(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
  }

  function label(id) { return global.SiduronAssembler ? global.SiduronAssembler.label(id) : ''; }

  // Group display label: try groupId, then groupId+'_header', else fallback.
  function groupLabel(groupId, firstSeg) {
    return label(groupId) || label(groupId + '_header') ||
      (firstSeg && label(firstSeg.id)) || 'הרחבה';
  }

  // Wrap the first visible word of an (already-escaped) line in a span so it can
  // be enlarged. Leading whitespace and HTML tags (e.g. an opening <b>) are kept
  // as a prefix so tag nesting isn't broken; the first run of non-space, non-'<'
  // characters is treated as the word.
  function wrapFirstWord(html) {
    var m = /^(\s*(?:<[^>]+>\s*)*)([^\s<]+)/.exec(html);
    if (!m) { return html; }
    return m[1] + '<span class="s-firstword">' + m[2] + '</span>' + html.slice(m[0].length);
  }

  // Render a single prayer text block (no header) → lines with preserved bold.
  // When leadWord is true, the first word of the block is emphasised (larger).
  function renderText(text, leadWord) {
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

  // A non-grouped, non-optional segment.
  function renderSegment(seg, nav, anchorSeq) {
    var lbl = label(seg.id);
    var body = (seg.resolvedText || '').trim();
    var html = '';
    if (lbl && !body) {
      // Pure section header.
      var anchor = 's-anchor-' + (anchorSeq.n++);
      nav.push({ id: seg.id, label: lbl, anchor: anchor });
      return '<h3 class="s-section" id="' + anchor + '">' + esc(lbl) + '</h3>';
    }
    if (lbl && body) {
      var a2 = 's-anchor-' + (anchorSeq.n++);
      nav.push({ id: seg.id, label: lbl, anchor: a2 });
      html += '<h4 class="s-subsection" id="' + a2 + '">' + esc(lbl) + '</h4>';
    }
    if (body) html += '<div class="s-seg">' + renderText(body, true) + '</div>';
    return html;
  }

  function renderOptional(seg) {
    var lbl = label(seg.id) || 'תוספת';
    var body = (seg.resolvedText || '').trim();
    if (!body) return '';
    return '<details class="s-optional"><summary>' + esc(lbl) +
      ' <span class="s-hint">(לחצו להצגה)</span></summary>' +
      '<div class="s-optional-body">' + renderText(body, true) + '</div></details>';
  }

  // Render a whole group as one collapsed accordion.
  function renderGroup(groupId, groupSegs, nav, anchorSeq) {
    var lbl = groupLabel(groupId, groupSegs[0]);
    var anchor = 's-anchor-' + (anchorSeq.n++);
    nav.push({ id: groupId, label: lbl, anchor: anchor });
    var inner = '';
    for (var i = 0; i < groupSegs.length; i++) {
      var s = groupSegs[i];
      var slbl = label(s.id);
      var body = (s.resolvedText || '').trim();
      if (slbl && !body) { inner += '<h4 class="s-subsection">' + esc(slbl) + '</h4>'; continue; }
      if (slbl && body) inner += '<h4 class="s-subsection">' + esc(slbl) + '</h4>';
      if (body) inner += '<div class="s-seg">' + renderText(body, true) + '</div>';
    }
    return '<details class="s-group" id="' + anchor + '"><summary>' + esc(lbl) +
      ' <span class="s-hint">(לחצו להצגה)</span></summary>' +
      '<div class="s-group-body">' + inner + '</div></details>';
  }

  function render(segments) {
    var nav = [];
    var anchorSeq = { n: 0 };
    var out = [];
    var i = 0;
    while (i < segments.length) {
      var seg = segments[i];
      var gid = seg.groupId || '';

      if (gid) {
        // Collect the consecutive run sharing this groupId.
        var run = [];
        while (i < segments.length && (segments[i].groupId || '') === gid) {
          run.push(segments[i]); i++;
        }
        out.push(renderGroup(gid, run, nav, anchorSeq));
        continue;
      }
      if (seg.optional) { out.push(renderOptional(seg)); i++; continue; }
      out.push(renderSegment(seg, nav, anchorSeq)); i++;
    }
    return { html: out.join('\n'), nav: nav };
  }

  // Loading / empty / error state block (DESIGN_GUIDE "loading, empty and error states"):
  // an icon (spinner while loading), a title, an optional message and — for an error —
  // a "נסה שוב" button the caller wires up through its [data-retry] attribute.
  var STATE_ICONS = {
    error: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12" y2="16.2"/>',
    empty: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  };
  // kind: 'loading' | 'empty' | 'error'. opts: { message, retry }. Texts are escaped.
  function stateHtml(kind, title, opts) {
    opts = opts || {};
    var icon = kind === 'loading'
      ? '<span class="spinner" aria-hidden="true"></span>'
      : '<svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        (STATE_ICONS[kind] || STATE_ICONS.empty) + '</svg>';
    return '<div class="state state-' + kind + '" role="' + (kind === 'error' ? 'alert' : 'status') + '">' + icon +
      '<div class="state-title">' + esc(title) + '</div>' +
      (opts.message ? '<div class="state-msg">' + esc(opts.message) + '</div>' : '') +
      (opts.retry ? '<button type="button" class="set-action state-retry" data-retry>נסה שוב</button>' : '') +
      '</div>';
  }

  global.SiduronRender = { render: render, esc: esc, stateHtml: stateHtml };
})(typeof window !== 'undefined' ? window : this);
