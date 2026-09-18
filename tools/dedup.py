import json, re, unicodedata
from collections import defaultdict

q400 = json.load(open("q400.json"))
for x in q400: x.setdefault("source","400"); x.setdefault("bank","400")
qmod = json.load(open("qmods.json"))
ALL = q400 + qmod
for i,x in enumerate(ALL): x["idx"]=i

STOP = set("""a an the of to in for on at by with and or is are be been do does did how what why
which when who whom this that these those it its as from into if then than so you your we our
me my i s t can could would should will shall may might must not no yes about more most other
some any each between over under again further once here there all both few many much such only
own same too very just also have has had having was were am being does doing""".split())
SYN = {
 "3":"three","two":"two","tev":"ev","enterprise":"ev","equityvalue":"eqv",
 "statements":"statement","financials":"statement","multiples":"multiple",
 "companies":"company","co":"company","calculate":"calculation","calculating":"calculation",
 "affects":"affect","affected":"affect","impacts":"affect","impact":"affect","change":"affect",
 "changes":"affect","differ":"difference","different":"difference","differences":"difference",
 "walkthrough":"walk","assets":"asset","liabilities":"liability","values":"value",
 "rates":"rate","flows":"flow","models":"model","deals":"deal","shares":"share",
 "dcfs":"dcf","comps":"comp","comparable":"comp","transactions":"transaction",
 "precedents":"precedent","questions":"question","mean":"meaning","means":"meaning",
}
def toks(s):
    s = unicodedata.normalize("NFKD", s).lower()
    s = s.replace("&"," and ").replace("/"," ")
    s = re.sub(r"[\$£€]|\d[\d,\.]*%?|\bx\b", " ", s)     # drop magnitudes: same concept, new numbers
    s = re.sub(r"[^a-z ]", " ", s)
    out=set()
    for w in s.split():
        if len(w)<2 or w in STOP: continue
        out.add(SYN.get(w,w))
    return out

def jac(a,b):
    if not a or not b: return 0.0
    return len(a&b)/len(a|b)

QT = [toks(x["q"]) for x in ALL]
AT = [toks(x["a"][:900]) for x in ALL]

# blocking on area keeps this to ~50k comparisons instead of 174k
byarea=defaultdict(list)
for x in ALL: byarea[x["area"]].append(x["idx"])

parent=list(range(len(ALL)))
def find(i):
    while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
    return i
def union(i,j):
    a,b=find(i),find(j)
    if a!=b: parent[max(a,b)]=min(a,b)

pairs=0
for area, idxs in byarea.items():
    for ii in range(len(idxs)):
        for jj in range(ii+1, len(idxs)):
            i,j = idxs[ii], idxs[jj]
            qs = jac(QT[i],QT[j])
            if qs < 0.40: continue
            if qs >= 0.62 or (qs >= 0.45 and jac(AT[i],AT[j]) >= 0.45):
                union(i,j); pairs+=1

groups=defaultdict(list)
for x in ALL: groups[find(x["idx"])].append(x)

RANK = {"400":0}
concepts=[]
for root, members in groups.items():
    # canonical = the 400's phrasing when the concept appears there (spec S4)
    members.sort(key=lambda m:(RANK.get(m["source"],1), -len(m["a"])))
    c = dict(members[0]); c["variants"]=[{"q":m["q"],"a":m["a"],"section":m["section"],"source":m["source"]} for m in members[1:]]
    c["in400"] = any(m["source"]=="400" for m in members)
    c["sources"] = sorted({m["source"] for m in members})
    concepts.append(c)

concepts.sort(key=lambda c:(c["area"], c["section"], c["n"]))
json.dump(concepts, open("concepts.json","w"), indent=0, ensure_ascii=False)

from collections import Counter
print(f"raw Q&A           : {len(ALL)}")
print(f"merge operations  : {pairs}")
print(f"canonical concepts: {len(concepts)}")
print(f"  with variants   : {sum(1 for c in concepts if c['variants'])}")
print(f"  in The 400      : {sum(1 for c in concepts if c['in400'])}")
print(f"  full-bank only  : {sum(1 for c in concepts if not c['in400'])}")
print("\nby area:", dict(Counter(c["area"] for c in concepts)))
big=sorted(concepts,key=lambda c:-len(c["variants"]))[:6]
print("\nlargest clusters:")
for c in big:
    print(f"  [{len(c['variants'])+1}] {c['q'][:88]}")
    for v in c["variants"][:3]: print(f"        ~ {v['q'][:84]}")
