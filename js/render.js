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

  // Render a single prayer text block (no header) → lines with preserved bold.
  function renderText(text) {
    var lines = String(text == null ? '' : text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { continue; }
      out.push('<div class="s-line">' + escKeepBold(t) + '</div>');
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
    if (body) html += '<div class="s-seg">' + renderText(body) + '</div>';
    return html;
  }

  function renderOptional(seg) {
    var lbl = label(seg.id) || 'תוספת';
    var body = (seg.resolvedText || '').trim();
    if (!body) return '';
    return '<details class="s-optional"><summary>' + esc(lbl) +
      ' <span class="s-hint">(לחצו להצגה)</span></summary>' +
      '<div class="s-optional-body">' + renderText(body) + '</div></details>';
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
      if (body) inner += '<div class="s-seg">' + renderText(body) + '</div>';
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

  global.SiduronRender = { render: render, esc: esc };
})(typeof window !== 'undefined' ? window : this);
