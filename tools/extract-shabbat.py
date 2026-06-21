#!/usr/bin/env python3
"""extract-shabbat.py — extract Shabbat (and later Yom-Tov) services from the
Otzaria seforim.db into a tracked data file (data/shabbat-data.js).

The DB is a LOCAL source (not a build dependency), so we extract its text ONCE
into a committed JS data file — mirroring how data-overrides/ pin DB-sourced
corrections. Re-run only when refreshing from a newer DB.

Output: window.SIDURON_SHABBAT = { <nusach>: { <service>: [ {kind,text} ... ] } }
  kind: 'header' | 'instruction' | 'text'   (rendered by js/services.js)

Run: python3 tools/extract-shabbat.py [path-to-seforim.db]
"""
import sqlite3, json, re, sys, os

DB = sys.argv[1] if len(sys.argv) > 1 else '/Users/david/Downloads/otzaria_latest/otzaria/seforim.db'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'shabbat-data.js')

# Per-nusach config: which book, and each app-service → ordered list of DB
# section-prefixes (matched against heRef). Musaf folds into the shacharit tab.
CONFIG = {
    'edot_mizrach': {
        'book': 5777,
        'services': {
            'maariv':    ['קבלת שבת', 'ערבית של שבת'],
            'shacharit': ['שחרית של שבת', 'מוסף של שבת'],
            'mincha':    ['מנחה של שבת'],
        },
    },
    'sfard': {
        'book': 5775,   # סידור ספרד לשבת
        'services': {
            'maariv':    ['קבלת שבת', 'תפלת ערבית לשבת'],
            'shacharit': ['תפלת שחרית', 'תפלת מוסף'],
            'mincha':    ['מנחה לשבת'],
        },
    },
    'ashkenaz': {
        'book': 5780,   # סידור אשכנז → seder "שבת"
        'services': {
            'maariv':    ['שבת, קבלת שבת', 'שבת, מעריב'],
            'shacharit': ['שבת, שחרית', 'שבת, מוסף לשבת'],
            'mincha':    ['שבת, מנחה'],
        },
    },
}

def strip_tags(s, keep_bold=True):
    s = re.sub(r'</?big>', '', s)
    s = re.sub(r'</?small>', '', s)
    if not keep_bold:
        s = re.sub(r'</?b>', '', s)
    return re.sub(r'[ \t]+', ' ', s).strip()

def is_pure_rubric(s):
    # a line whose visible content lives entirely inside <small>…</small>
    if '<small>' not in s:
        return False
    without_small = re.sub(r'<small>.*?</small>', '', s, flags=re.S)
    return strip_tags(without_small, keep_bold=False) == ''

def line_to_seg(content):
    c = content.strip()
    if not c:
        return None
    if c.startswith('<big>'):
        return {'kind': 'header', 'text': strip_tags(c, keep_bold=False)}
    if is_pure_rubric(c):
        return {'kind': 'instruction', 'text': strip_tags(c, keep_bold=False)}
    return {'kind': 'text', 'text': strip_tags(c, keep_bold=True)}

def subsection(heref):
    # heRef = "book, sederA, sederB, …, <letter>"; return the component before the
    # trailing letter (the prayer/section name), or '' if none.
    parts = [p.strip() for p in (heref or '').split(',')]
    return parts[-2] if len(parts) >= 2 else ''

def rows_to_segs(rows):
    segs, last_sub = [], None
    for heref, content in rows:
        sub = subsection(heref)
        seg = line_to_seg(content)
        if seg is None:
            continue
        if sub and sub != last_sub and seg['kind'] != 'header':
            segs.append({'kind': 'header', 'text': sub})
        last_sub = sub
        segs.append(seg)
    return segs

conn = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)

# עדות-מזרח quirk: 5777's "שחרית של שבת" is a CONTINUATION — it opens with the
# rubric "מתפללים שחרית של חול עד סוף ה' מלך וממשיכים". So for EM shacharit we
# prepend the weekday morning (השכמת הבוקר + שחרית לימי החול through "הושיענו",
# lineIndex ≤ 168 — line 169 is the "בשבת ממשיכים…" seam) so the service is
# self-contained like sfard/ashkenaz. (Sfard 5775 / Ashkenaz 5780 already inline
# the full morning in their shabbat sections, so no prepend needed there.)
def em_weekday_morning():
    rows = conn.execute(
        "SELECT heRef, content FROM line WHERE bookId=5777 AND "
        "(heRef LIKE '%סדר השכמת הבוקר%' OR (heRef LIKE '%שחרית לימי החול%' AND lineIndex <= 168)) "
        "ORDER BY lineIndex").fetchall()
    return rows_to_segs(rows)

out = {}
for nusach, cfg in CONFIG.items():
    book = cfg['book']
    out[nusach] = {}
    for svc, prefixes in cfg['services'].items():
        segs = []
        for prefix in prefixes:
            rows = conn.execute(
                "SELECT heRef, content FROM line WHERE bookId=? AND heRef LIKE ? ORDER BY lineIndex",
                (book, '%' + prefix + '%')).fetchall()
            segs.extend(rows_to_segs(rows))
        if nusach == 'edot_mizrach' and svc == 'shacharit':
            # drop the now-redundant "מתפללים שחרית של חול…" lead-in, then prepend
            # the weekday morning so the service is self-contained.
            segs = [s for s in segs if 'מתפללים שחרית של חול' not in s.get('text', '')]
            segs = em_weekday_morning() + segs
        out[nusach][svc] = segs

# ── Yom-Tov (שלש רגלים) ───────────────────────────────────────────────────────
# The DB encodes ALL festivals inline with rubrics (בפסח/בשבועות/בסוכות/בש"ע, and
# בשבת for a festival that falls on Shabbat), so one festival amidah/musaf serves
# all regalim. EM (5777) stores only the INSERT content ("תפילה לשלש רגלים":
# psalms + shared amidah + musaf) — the rest of the service is the regular
# framework. We COMPOSE a self-contained service: weekday framework + festival
# amidah + Hallel + (torah-reading rubric) + festival musaf. Full Hallel & the
# festival amidah replace the weekday ones; the festival torah reading itself is
# not in this siddur (read from the חומש) so we mark it with a rubric.
# sfard (5775) / ashkenaz (5780) yom-tov are a later pass.
def fetch(book, where, params=()):
    rows = conn.execute(
        "SELECT heRef, content FROM line WHERE bookId=? AND " + where + " ORDER BY lineIndex",
        (book,) + params).fetchall()
    return rows_to_segs(rows)

yomtov = {}
EM = 5777
em_morning = fetch(EM, "(heRef LIKE '%סדר השכמת הבוקר%' OR (heRef LIKE '%שחרית לימי החול%' AND lineIndex < 222))")
em_arvit_fw = fetch(EM, "heRef LIKE '%ערבית לימי החול%' AND lineIndex BETWEEN 658 AND 683")  # ברכו + ק"ש, before עמידה
em_mincha_fw = fetch(EM, "heRef LIKE '%מנחה לימי החול%' AND lineIndex BETWEEN 502 AND 518")    # קרבנות, before עמידה
em_hallel = fetch(EM, "heRef LIKE '%הלל לראש חודש ולמועדים%'")
em_yt_psalms = fetch(EM, "heRef LIKE '%לשלש רגלים%' AND heRef LIKE '%מזמור%'")
em_yt_amida = fetch(EM, "heRef LIKE '%לשלש רגלים, עמידה%'")
# the מוסף heRef block also carries the יו"ט-night kiddushim/אושפיזין/זוהר as inline
# <big> content from line 2501 on — keep only the musaf amidah itself (2442–2500).
em_yt_musaf = fetch(EM, "heRef LIKE '%לשלש רגלים, מוסף%' AND lineIndex < 2501")
torah_rubric = [{'kind': 'instruction',
                 'text': 'כאן מוציאים ספר תורה וקוראים את קריאת היום של החג (מן החומש), ואחריה ההפטרה.'}]
yomtov['edot_mizrach'] = {
    'maariv':    em_arvit_fw + em_yt_amida,
    'shacharit': em_morning + em_yt_psalms + em_yt_amida + em_hallel + torah_rubric + em_yt_musaf,
    'mincha':    em_mincha_fw + em_yt_amida,
}

# ── Sfard (5775) — framework + shared festival amidah + hallel + musaf ─────────
s = 5775
s_morning   = fetch(s, "heRef LIKE '%תפלת שחרית%' AND lineIndex < 6573")
s_arvit_fw  = fetch(s, "heRef LIKE '%תפלת ערבית לשבת%' AND lineIndex < 1762")
s_mincha_fw = fetch(s, "heRef LIKE '%מנחה לשבת ויום טוב%' AND lineIndex < 9710")
s_hallel    = fetch(s, "heRef LIKE '%, הלל,%'")
s_yt_amida  = fetch(s, "heRef LIKE '%עמידה ליום טוב לערבית%'")
# full musaf: עמידה (opening) + קדושת השם (body/korban) + ברכת כהנים + תפלת טל/גשם
s_yt_musaf  = fetch(s, "heRef LIKE '%מוסף לשלש רגלים%'")
yomtov['sfard'] = {
    'maariv':    s_arvit_fw + s_yt_amida,
    'shacharit': s_morning + s_yt_amida + s_hallel + torah_rubric + s_yt_musaf,
    'mincha':    s_mincha_fw + s_yt_amida,
}

# ── Ashkenaz (5780) — shabbat framework + festival amidah (per-bracha) + hallel + musaf ──
a = 5780
a_morning   = fetch(a, "heRef LIKE '%, שבת, שחרית,%' AND lineIndex < 2015")
a_arvit_fw  = fetch(a, "heRef LIKE '%, שבת, מעריב,%' AND lineIndex < 1340")
a_mincha_fw = fetch(a, "heRef LIKE '%, שבת, מנחה,%' AND lineIndex < 2593")
a_hallel    = fetch(a, "heRef LIKE '%ראש חודש, הלל%'")
a_yt_amida  = fetch(a, "heRef LIKE '%תפילות לשלוש רגלים, עמידה לערבית%'")
a_yt_musaf  = fetch(a, "heRef LIKE '%תפילות לשלוש רגלים, מוסף%'")
yomtov['ashkenaz'] = {
    'maariv':    a_arvit_fw + a_yt_amida,
    'shacharit': a_morning + a_yt_amida + a_hallel + torah_rubric + a_yt_musaf,
    'mincha':    a_mincha_fw + a_yt_amida,
}

conn.close()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
header = ('/* shabbat-data.js — GENERATED by tools/extract-shabbat.py from Otzaria\n'
          ' * seforim.db (authoritative). Shabbat/Yom-Tov services per nusach.\n'
          ' * Do not edit by hand; re-run the extractor to refresh. */\n')
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(header + 'window.SIDURON_SHABBAT = ' + json.dumps(out, ensure_ascii=False) + ';\n'
            + 'window.SIDURON_YOMTOV = ' + json.dumps(yomtov, ensure_ascii=False) + ';\n')

kb = os.path.getsize(OUT) / 1024
print('Wrote data/shabbat-data.js (%.0f KB)' % kb)
for nusach in out:
    for svc, segs in out[nusach].items():
        hdrs = [s['text'] for s in segs if s['kind'] == 'header']
        print('  %-13s %-10s segs=%-4d headers=%d' % (nusach, svc, len(segs), len(hdrs)))
