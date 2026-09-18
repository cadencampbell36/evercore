import re, json
DROP = re.compile(r'^(Access the (Financial Modeling Course|Full IB Interview Guide|Rest of the IB Interview Guide)|\d+ of \d+ https?://breakingintowallstreet\.com|https?://breakingintowallstreet\.com|Return to Top\.|<<<PAGE \d+>>>)\s*$')
def lines(p): return [l.rstrip() for l in open(p) if l.strip() and not DROP.match(l.rstrip())]

MODS = {"mod-acct":("Accounting & the 3 Statements","accounting"),
        "mod-proj":("Projecting the 3 Statements","accounting"),
        "mod-ev":("Equity Value & Enterprise Value","ev"),
        "mod-dcf":("Valuation & DCF Analysis","valuation"),
        "mod-ma":("M&A Deals & Merger Models","ma"),
        "mod-lbo":("Leveraged Buyouts & LBO Models","lbo")}
KR = re.compile(r'^Key Rule #(\d+):\s*(.+?)\s*$')
out=[]
for key,(label,area) in MODS.items():
    L=lines(f"txt/{key}.txt")
    # body headers only: a TOC line ends in dot-leaders + page number
    marks=[(i,int(m.group(1)),m.group(2)) for i,l in enumerate(L)
           if (m:=KR.match(l)) and not re.search(r'\.{4,}\s*\d+$', l)]
    # drop the TOC block: keep the last run where numbers ascend from 1
    body=[]
    for i,n,t in marks:
        if n==1: body=[(i,n,t)]
        else: body.append((i,n,t))
    stop=next((i for i,l in enumerate(L) if l.strip()=="Interview Questions" and i>(body[0][0] if body else 0)), len(L))
    for j,(i,n,title) in enumerate(body):
        end = body[j+1][0] if j+1<len(body) else stop
        if i>=stop: continue
        text="\n".join(L[i+1:end]).strip()
        if len(text)<200: continue
        # sub-headings inside a rule, for navigation
        subs=[l for l in L[i+1:end] if re.match(r'^\d\)\s+\S|^[A-Z][^.?!]{8,60}$', l) and len(l)<70][:8]
        out.append({"id":f"{key}.kr{n}","module":label,"area":area,
                    "n":n,"title":title,"text":text,"subs":subs,"chars":len(text)})
for key,label,area in [("mod-core","Core Concepts","valuation"),("ref-debt","Types of Debt & Debt Lingo","lbo")]:
    L=lines(f"txt/{key}.txt")
    marks=[(i,l) for i,l in enumerate(L) if re.match(r'^[A-Z][^.?!]{6,70}$', l) and len(l)<72]
    if not marks: marks=[(0,label)]
    for j,(i,title) in enumerate(marks):
        end = marks[j+1][0] if j+1<len(marks) else len(L)
        text="\n".join(L[i+1:end]).strip()
        if len(text)<400: continue
        out.append({"id":f"{key}.s{j}","module":label,"area":area,"n":j+1,
                    "title":title,"text":text,"subs":[],"chars":len(text)})
json.dump(out,open("reference.json","w"),indent=0,ensure_ascii=False)
tot=sum(r["chars"] for r in out)
print(f"reference sections: {len(out)}   total {tot:,} chars")
from collections import Counter
for m,c in Counter(r["module"] for r in out).most_common():
    print(f"  {c:3d}  {m:36s} {sum(r['chars'] for r in out if r['module']==m):8,d} chars")
