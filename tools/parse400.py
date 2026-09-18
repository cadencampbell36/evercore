import re, json

RAW = open("txt/400.txt").read()

# ---- strip boilerplate ----------------------------------------------------
DROP = [
 re.compile(r'^Access the Financial Modeling Course\s*$'),
 re.compile(r'^Access the Full IB Interview Guide\s*$'),
 re.compile(r'^Access the Rest of the IB Interview Guide\s*$'),
 re.compile(r'^\d+ of \d+ https?://breakingintowallstreet\.com\s*$'),
 re.compile(r'^https?://breakingintowallstreet\.com\s*$'),
 re.compile(r'^Return to Top\.\s*$'),
 re.compile(r'^\s*$'),
]
lines = []
for ln in RAW.split("\n"):
    s = ln.rstrip()
    if any(p.match(s) for p in DROP): continue
    lines.append(s)

# ---- sections we want (M&A track; no RX, no industry-specific) ------------
TECH = [
 ("Finance Concepts","valuation"),
 ("Accounting – Concepts","accounting"),
 ("Accounting – Calculations","accounting"),
 ("Equity Value & Enterprise Value – Concepts","ev"),
 ("Equity Value & Enterprise Value – Calculations","ev"),
 ("Valuation Methodologies","valuation"),
 ("Valuation Metrics and Multiples","valuation"),
 ("Discounted Cash Flow (DCF) – Assumptions and Analysis","valuation"),
 ("Discounted Cash Flow (DCF) – The Discount Rate","valuation"),
 ("Merger Models – Concepts","ma"),
 ("Merger Models – Calculations","ma"),
 ("LBO Models – Concepts","lbo"),
 ("LBO Models – Calculations","lbo"),
]
FIT = [
 ("The “Big 5” Fit Questions","behavioral"),
 ("Teamwork/Leadership","behavioral"),
 ("Strengths & Weaknesses","behavioral"),
 ("Flaws & Failures","behavioral"),
 ("Recruiting Process","behavioral"),
 ("Resume/CV","behavioral"),
 ("Understanding Banking","market"),
 ("“Why Banking?” and “Why Our Firm?”","market"),
 ("“Outside the Box” Questions","behavioral"),
 ("Discussing Transaction Experience","market"),
]
WANT = TECH + FIT
STOP_AT = "Industry and Group-Specific Technical Questions"   # everything after is out of scope

names = [n for n,_ in WANT]
# locate section starts: a line exactly equal to the name, NOT in the TOC (TOC lines have dot leaders, already differ)
starts = {}
for i, ln in enumerate(lines):
    t = ln.strip()
    if t in names and t not in starts:
        # TOC entries were stripped of dots? verify: real headers are followed by prose, TOC by another TOC line
        starts.setdefault(t, []).append(i)
# take the LAST occurrence that is before STOP_AT for tech, first body occurrence otherwise
stop_i = next((i for i,l in enumerate(lines) if l.strip()==STOP_AT and i>200), len(lines))

sec_pos = []
for n,_ in WANT:
    occ = starts.get(n, [])
    body = [i for i in occ if i > 60]     # skip table of contents region
    if not body:
        print("!! section not found:", n); continue
    sec_pos.append((body[0], n))
sec_pos.sort()

ONSET = re.compile(r'(?<=[.?!])\s+(?=(?:No!|No,|Yes!|Yes,|This question|\u2022))')
SENT_END = re.compile(r'[.!][\"\u201d)]?$')
ABBREV  = re.compile(r'(?:\b(?:i\.e|e\.g|vs|etc|Inc|Corp|Co|Ltd|Mr|Ms|Dr|No|approx|U\.S|U\.K)\.|\b[A-Z]\.)[\"\u201d)]?$')
QNUM = re.compile(r'^(\d{1,2})\.\s+(.*)$')

def section_slice(idx):
    start = sec_pos[idx][0]
    end = sec_pos[idx+1][0] if idx+1 < len(sec_pos) else stop_i
    return lines[start+1:end]

area_of = dict(WANT)
out = []
for idx, (pos, name) in enumerate(sec_pos):
    body = section_slice(idx)
    # find question starts
    marks = []
    for i, ln in enumerate(body):
        m = QNUM.match(ln)
        if m:
            marks.append((i, int(m.group(1)), m.group(2)))
    # keep only monotonically sensible numbering runs (1,2,3.. restarting is fine)
    kept = []
    last = 0
    for i, num, rest in marks:
        if num == last + 1 or num == 1:
            kept.append((i, num, rest)); last = num
    for j, (i, num, rest) in enumerate(kept):
        end = kept[j+1][0] if j+1 < len(kept) else len(body)
        chunk = [rest] + body[i+1:end]
        # Question = first paragraph. Two signals, both needed to stop:
        #   (a) the line ends a sentence, and (b) the line is short, i.e. it did not wrap.
        # BIWS wraps at ~87-96 chars (measured over 5,706 lines), so >= WRAP means the
        # paragraph continues even when a sentence happens to end at the line break.
        WRAP = 80
        q_lines, k = [chunk[0]], 1
        while k < len(chunk) and k < 7:
            prev = q_lines[-1].rstrip()
            if prev.endswith(("?", "?\u201d")): break
            ends_sent = bool(SENT_END.search(prev)) and not ABBREV.search(prev)
            if ends_sent and len(prev) < WRAP: break
            q_lines.append(chunk[k]); k += 1
        q = " ".join(x.strip() for x in q_lines).strip()
        # Two questions in 211 have a long final line, so the width test let the answer's
        # opening clause in. Split on an unambiguous answer-onset cue after a sentence end.
        if len(q) > 250:
            m = ONSET.search(q)
            if m:
                chunk = [q[m.start():]] + chunk[k:]
                q = q[:m.start()].strip()
                k = 0
        a = "\n".join(chunk[k:]).strip()
        # Last resort: if the answer still starts mid-sentence, the question wrapped onto a
        # line the width test accepted. Move that clause back where it belongs.
        if a and a[0].islower():
            first, _, rest = a.partition("\n")
            q = (q + " " + first).strip(); a = rest.strip()
        if not a or len(a) < 40: continue
        out.append({"n":num,"section":name,"area":area_of[name],"q":q,"a":a})

print(f"parsed {len(out)} Q&A pairs from {len(sec_pos)} sections")
from collections import Counter
for s,c in Counter(x["section"] for x in out).items(): print(f"  {c:4d}  {s}")
json.dump(out, open("q400.json","w"), indent=0, ensure_ascii=False)
