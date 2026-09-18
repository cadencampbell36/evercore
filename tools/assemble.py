import json, re, unicodedata, subprocess, os
C = json.load(open("concepts.json"))

# ---- load the hand-authored drill layer (binary / mc / calc / def, each verified) ----
PARTS = ["bank-accounting.js","bank-ev.js","bank-val.js","bank-lbo-ma.js","bank-market-grid.js"]
# Read the hand-authored PARTS, never the generated bank.js: reading the generated file
# would re-attach the previous build onto the new one.
_src = "\n".join(open("build/" + f).read() for f in PARTS)
_src += "\nprocess.stdout.write(JSON.stringify([].concat(ACCOUNTING,EV,VAL,LBO,MA,MARKET)));\n"
open("_drills.js","w").write(_src)
drills = json.loads(subprocess.run(["node","_drills.js"], capture_output=True, text=True, check=True).stdout)
print("curated drill concepts:", len(drills))

STOP = set("""a an the of to in for on at by with and or is are be do does did how what why which
when who this that these those it its as from into if then than so you your we our me my i can
could would should will may might must not no yes about more most other some any each between
over under again further once here there all both few many much such only own same too very just
also have has had having was were am being""".split())
def toks(s):
    s = unicodedata.normalize("NFKD", s).lower().replace("&"," and ").replace("/"," ")
    s = re.sub(r"[\$£€]|\d[\d,\.]*%?|\bx\b"," ",s); s = re.sub(r"[^a-z ]"," ",s)
    return {w for w in s.split() if len(w)>1 and w not in STOP}
def jac(a,b): return len(a&b)/len(a|b) if a and b else 0.0

CT = [toks(c["q"]) for c in C]
attached = 0; extra = []
for dr in drills:
    dt = toks(dr.get("q",""))
    best, bi = 0.0, -1
    for i,c in enumerate(C):
        if c["area"] != dr["area"]: continue
        s = jac(dt, CT[i])
        if s > best: best, bi = s, i
    if best >= 0.45:
        tgt = C[bi]
        for k in ("binary","mc","calc","def","obj"):
            if dr.get(k) and not tgt.get(k): tgt[k] = dr[k]
        tgt.setdefault("drill_from", dr["id"])
        if dr.get("tags"): tgt["tags"] = sorted(set(tgt["tags"]) | set(dr["tags"]))
        attached += 1
    else:
        e = dict(dr); e.update(section="Authored drill", a=dr.get("ans",""), in400=False,
                               sources=["authored"], variants=[], t=dr.get("target", 60),
                               rub=dr.get("rub",[]), modes=sorted({"card","frq"} |
                               {k for k in ("binary","mc","calc","def") if dr.get(k)}))
        extra.append(e)
print(f"attached to BIWS concepts: {attached}   |   kept as standalone drills: {len(extra)}")

for e in extra: C.append(e)
for c in C:
    c["modes"] = sorted(set(c.get("modes",[])) | {k for k in ("binary","mc","calc","def") if c.get(k)})
    c.pop("idx", None)

ids=set()
for i,c in enumerate(C):
    base = c.get("id") or re.sub(r"[^a-z0-9]+","-", (c["area"]+"-"+c["q"][:40]).lower()).strip("-")
    cid, n = base, 2
    while cid in ids: cid = f"{base}-{n}"; n += 1
    ids.add(cid); c["id"] = cid

from collections import Counter
print("\nfinal concepts:", len(C))
print("by area:", dict(Counter(c["area"] for c in C)))
print("modes:", dict(Counter(m for c in C for m in c["modes"])))
print("in The 400:", sum(1 for c in C if c.get("in400")))
json.dump(C, open("concepts.json","w"), indent=0, ensure_ascii=False)
