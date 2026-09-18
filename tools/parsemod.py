import re, json, os

DROP = [re.compile(p) for p in [
 r'^Access the (Financial Modeling Course|Full IB Interview Guide|Rest of the IB Interview Guide)\s*$',
 r'^\d+ of \d+\s+https?://breakingintowallstreet\.com\s*$',
 r'^https?://breakingintowallstreet\.com\s*$',
 r'^<<<PAGE \d+>>>\s*$', r'^Return to Top\.\s*$', r'^\s*$',
]]
ONSET   = re.compile(r'(?<=[.?!])\s+(?=(?:No!|No,|Yes!|Yes,|This question|•))')
SENT_END= re.compile(r'[.!]["”)]?$')
ABBREV  = re.compile(r'(?:\b(?:i\.e|e\.g|vs|etc|Inc|Corp|Co|Ltd|Mr|Ms|Dr|No|approx|U\.S|U\.K)\.|\b[A-Z]\.)["”)]?$')
QNUM    = re.compile(r'^(\d{1,2})\.\s+(.*)$')
WRAP    = 80

def clean(raw):
    return [l.rstrip() for l in raw.split("\n") if not any(p.match(l.rstrip()) for p in DROP)]

def split_qas(body, section, area, source, bank):
    marks, last = [], 0
    for i, ln in enumerate(body):
        m = QNUM.match(ln)
        if m:
            n = int(m.group(1))
            if n == last + 1 or n == 1:
                marks.append((i, n, m.group(2))); last = n
    out = []
    for j, (i, num, rest) in enumerate(marks):
        end = marks[j+1][0] if j+1 < len(marks) else len(body)
        chunk = [rest] + body[i+1:end]
        q_lines, k = [chunk[0]], 1
        while k < len(chunk) and k < 7:
            prev = q_lines[-1].rstrip()
            if prev.endswith(("?", "?”")): break
            if SENT_END.search(prev) and not ABBREV.search(prev) and len(prev) < WRAP: break
            q_lines.append(chunk[k]); k += 1
        q = " ".join(x.strip() for x in q_lines).strip()
        if len(q) > 250:
            m = ONSET.search(q)
            if m:
                chunk = [q[m.start():]] + chunk[k:]; q = q[:m.start()].strip(); k = 0
        a = "\n".join(chunk[k:]).strip()
        # Last resort: if the answer still starts mid-sentence, the question wrapped onto a
        # line the width test accepted. Move that clause back where it belongs.
        if a and a[0].islower():
            first, _, rest = a.partition("\n")
            q = (q + " " + first).strip(); a = rest.strip()
        if len(a) < 40 or len(q) < 12: continue
        out.append({"n":num,"section":section,"area":area,"q":q,"a":a,"source":source,"bank":bank})
    return out

# module sub-section headers -> area
MODS = {
 "mod-acct": ("IBIG Accounting", "accounting"),
 "mod-proj": ("IBIG 3-Statement Projections", "accounting"),
 "mod-ev":   ("IBIG EV & Equity Value", "ev"),
 "mod-dcf":  ("IBIG Valuation & DCF", "valuation"),
 "mod-ma":   ("IBIG M&A & Merger Models", "ma"),
 "mod-lbo":  ("IBIG LBO", "lbo"),
}

def parse_module(key):
    label, area = MODS[key]
    raw = open(f"txt/{key}.txt").read()
    lines = clean(raw)
    starts = [i for i,l in enumerate(lines) if l.strip()=="Interview Questions"]
    if not starts: return []
    i = starts[-1]
    body = lines[i+1:]
    # Sub-headers: short, title-case, unpunctuated lines. Formula fragments such as
    # "Stock * % Preferred Stock" and "Terminal Growth Rate)" also fit that shape, so
    # reject anything carrying math/bracket characters or a trailing period.
    subs=[]
    for j,l in enumerate(body):
        s=l.strip()
        if not (8 < len(s) < 70) or QNUM.match(s): continue
        if s.endswith((".","?",":",",",";")) or not s[0].isupper(): continue
        if any(ch in s for ch in "*()=[]\u2022"): continue
        if sum(c.isdigit() for c in s) or s.count(" ") > 8: continue
        subs.append((j,s))
    out=[]
    if not subs:
        return split_qas(body, label, area, key, "full")
    for idx,(j,name) in enumerate(subs):
        end = subs[idx+1][0] if idx+1 < len(subs) else len(body)
        seg = body[j+1:end]
        if not any(QNUM.match(x) for x in seg): continue
        out += split_qas(seg, f"{label} — {name}", area, key, "full")
    return out

if __name__ == "__main__":
    allq=[]
    for k in MODS:
        r = parse_module(k)
        print(f"{k:10s} {len(r):4d} Q&A")
        allq += r
    json.dump(allq, open("qmods.json","w"), indent=0, ensure_ascii=False)
    print("total module Q&A:", len(allq))
