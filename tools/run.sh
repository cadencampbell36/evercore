#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 parse400.py | head -1
python3 parsemod.py | tail -1
python3 - <<'P'
import json
from collections import Counter
from parsemod import MODS
d=json.load(open("qmods.json"))
c=Counter(x["section"] for x in d); small={s for s,n in c.items() if n<3}
for x in d:
    if x["section"] in small: x["section"]=MODS[x["source"]][0]
json.dump(d,open("qmods.json","w"),indent=0,ensure_ascii=False)
P
python3 parseref.py | head -1
python3 dedup.py   | sed -n '1,6p'
python3 enrich.py  | sed -n '1p'
python3 assemble.py| tail -4
python3 txnmatrix.py | head -1
python3 emit.py
