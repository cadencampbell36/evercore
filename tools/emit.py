import json, subprocess, os
C = json.load(open("concepts.json")) + json.load(open("txnmatrix.json"))
REF = json.load(open("reference.json"))
# `const` inside eval() is block-scoped to the eval, so the extraction expression has to
# live inside the evaluated string, not after it.
_m = """
const fs=require('fs');
const s=fs.readFileSync('build/bank-market-grid.js','utf8');
const R=eval(s+'; ({SCENARIOS,IS_LINES,CFS_LINES,BS_LINES})');
process.stdout.write(JSON.stringify(R));
"""
open("_meta.js","w").write(_m)
meta = json.loads(subprocess.run(["node","_meta.js"],capture_output=True,text=True,check=True).stdout)
AREAS = {"accounting":"Accounting","ev":"EV & Equity Value","valuation":"Valuation",
         "lbo":"LBO","ma":"M&A","market":"Market & Situational","behavioral":"Behavioral & Fit"}
ET = {
 "CFI_CFF":{"n":"CFI vs CFF inversion","d":"Classifying on the noun (bonds, stock, securities) instead of the verb. Bought/sold is investing. Issued/repaid is financing. Capitalised costs are investing."},
 "BS_SIDE":{"n":"Wrong side of the balance sheet","d":"Accrued and deferred items placed as assets when they are liabilities: accrued compensation, accrued expenses, accrued interest, deferred revenue."},
 "DEFINITIONAL":{"n":"Reasons toward a definition","d":"Describes what something is for instead of stating what it is. Mechanics are strong; definitions are not."},
 "LEVEL_NOT_DELTA":{"n":"Level stated instead of delta","d":"'Net income of $7.50' instead of 'net income falls by $7.50'. Every walkthrough figure is a change."},
 "WRONG_STATEMENT":{"n":"Wrong statement named","d":"'Net income flows to the top of the balance sheet.' Naming the wrong statement mid-walkthrough."},
 "NI_FOR_RE":{"n":"'Net income' used for retained earnings","d":"There is no net income line on the balance sheet. Net income flows into retained earnings."},
 "NO_BALANCE_CHK":{"n":"Balance check dropped","d":"Walkthroughs that trail off without confirming both sides move by the same amount."},
 "DIRECTION":{"n":"Direction inversion","d":"Right inputs, wrong read. Buyback effect on equity value; earnings yield vs cost of funding in accretion/dilution."},
 "EV_VS_EQV":{"n":"Equity value vs enterprise value","d":"Funding source determines equity value (stock up, debt/cash unchanged). Cash movement determines enterprise value."},
 "FATIGUE":{"n":"Fatigue signature","d":"Past ~3 hours: invents figures not present in the question and mislabels balance sheet sides while mechanics stay correct."},
}
KEEP = {"id","area","section","q","a","rub","tags","modes","d","t","in400","binary","mc","calc","def","obj","sources"}
slim=[]
for c in C:
    o={k:v for k,v in c.items() if k in KEEP and v not in (None,[],"")}
    o["in400"]=bool(c.get("in400"))
    v=[{"q":x["q"],"a":x["a"]} for x in (c.get("variants") or [])]
    if v: o["v"]=v
    slim.append(o)

def js(name,val): return "const %s = %s;\n" % (name, json.dumps(val, ensure_ascii=False, separators=(",",":")))
out  = "// Evercore Prep Suite - question bank, generated from the BIWS source material.\n"
out += "// %d canonical concepts (%d from The 400), deduplicated across the 400 guide and the\n" % (len(slim), sum(1 for c in slim if c["in400"]))
out += "// IBIG modules; alternate phrasings retained as variants.\n"
out += js("CONCEPTS",slim) + js("AREAS",AREAS) + js("ERROR_TAGS",ET)
for k in ("IS_LINES","CFS_LINES","BS_LINES","SCENARIOS"): out += js(k, meta[k])
tsrc = open("build/bank-market-grid.js").read()
out += tsrc[tsrc.index("const TEMPLATES"):tsrc.index("const SCENARIOS")]
open("build/bank.js","w").write(out)
open("build/reference.js","w").write(
  "// BIWS teaching content: Key Rules from the IBIG modules, plus Core Concepts and the debt\n"
  "// reference. Shown only AFTER an answer is submitted - there is no passive reading mode.\n"
  + js("REFERENCE", REF))
print("bank.js      %8d bytes  %d concepts" % (os.path.getsize("build/bank.js"), len(slim)))
print("reference.js %8d bytes  %d sections, %d chars of guide text"
      % (os.path.getsize("build/reference.js"), len(REF), sum(r["chars"] for r in REF)))
