import json, re
C = json.load(open("concepts.json"))

def has(p, s): return bool(re.search(p, s, re.I))

WALK = r"walk me through|walk through|how (do|does).{0,30}(statement|three statements|3 statements)|affects? the (3|three) statements|changes? on the (financial )?statements|how the (financial )?statements change"
NUMQ = r"what(’s| is| are)? the (irr|moic|multiple|ebitda|tax rate|p ?/ ?e|value|price|goodwill|dtl|wacc|cost of equity|beta|terminal value|diluted equity value|new eps|accretion|dilution)|calculate the|how much"

for c in C:
    q, a = c["q"], c["a"]
    body = q + " \n " + a
    sec = c["section"]
    tags, modes = set(), set()

    # ---- error tags, mapped from spec S6 -----------------------------------
    if has(r"\bCFI\b|\bCFF\b|cash flow from (investing|financing)|(investing|financing) activit|capitaliz", body):
        tags.add("CFI_CFF")
    if has(r"accrued|deferred revenue|deferred tax|\bDTA\b|\bDTL\b|which side|assets side|l&e side|liabilities side|noncontrolling|payable|receivable", body):
        tags.add("BS_SIDE")
    if has(r"^(what is|what are|what does|define|what’s|what's)\b", q) or has(r"\bmean\b|definition", q):
        tags.add("DEFINITIONAL")
    if has(WALK, body):
        tags.update(["LEVEL_NOT_DELTA", "WRONG_STATEMENT", "NI_FOR_RE", "NO_BALANCE_CHK"])
    if has(r"accretive or dilutive|higher or lower|increase or decrease|go up or down|more or less|which (one )?(is|should be) (worth more|higher)|positive or negative", body):
        tags.add("DIRECTION")
    if has(r"equity value|enterprise value|\bTEV\b|equity val", body):
        tags.add("EV_VS_EQV")
    if has(r"retained earnings", body):
        tags.add("NI_FOR_RE")

    # ---- mode fitness -------------------------------------------------------
    # grid: the guide groups these into explicit statement-change sections
    if has(r"Changes on the Financial Statements|Accounting \u2013 Calculations|Advanced Accounting Scenarios", sec) \
       or (has(WALK, q) and c["area"] == "accounting"):
        modes.add("grid")
    if has(r"^(what is|what are|what does|define|what’s|what's)\b", q) and len(q) < 120:
        modes.add("def")
    # calc: a numeric ask with numbers in the stem. The guide's "Calculations" sections
    # and the IRR/accretion families are exactly the Evercore first-round archetypes.
    numeric_stem = has(r"\$|\b\d+ ?x\b|\d+ ?%|\bmillion\b|\bbillion\b", q)
    numeric_ask  = has(NUMQ, q) or has(r"\bwhat(’s| is|'s)\b.*\?|how much|how many|calculate|what would|find the", q)
    if numeric_stem and numeric_ask:
        modes.add("calc")
    modes.add("frq")          # every concept is answerable as free response
    if c["area"] not in ("behavioral", "market"):
        modes.add("card")     # mechanics are flashcard-able; a personal story is not

    # ---- difficulty 1-5 -----------------------------------------------------
    d = 2
    if "Calculation" in sec or "calc" in modes: d += 1
    if "Multi-Step" in sec or "Advanced" in sec or "More Advanced" in sec: d += 1
    if len(a) > 1400: d += 1
    if len(a) > 2400: d += 1
    if has(r"\bPIK\b|\b382\b|purchase accounting|338\(h\)|convertible|mid-year|stub period|unlever|relever|sum-of-the-parts|dividend recap", body): d += 1
    if has(r"^(what is|what are|what does)\b", q) and len(a) < 700: d -= 1
    if has(r"^(what is|what are)\b", q) and len(a) < 400: d -= 1
    c["d"] = max(1, min(5, d))

    # ---- target seconds -----------------------------------------------------
    if "grid" in modes: t = 180
    elif has(r"paper lbo|irr|moic", q) and "calc" in modes: t = 300
    elif "calc" in modes: t = 120
    elif has(WALK, q): t = 120
    elif "def" in modes: t = 45
    else: t = 90
    c["t"] = t

    # rubric: the guide's own answer, split into checkable points
    pts = re.split(r"(?:•|\n|(?<=[.!?])\s+(?=[A-Z0-9]))", a)
    pts = [re.sub(r"\s+", " ", p).strip(" •-") for p in pts]
    pts = [p for p in pts if 25 < len(p) < 300][:7]
    c["rub"] = pts
    # Fallback so nothing is invisible to the error ledger: a concept with no specific
    # pattern still belongs to its area's dominant failure mode.
    if not tags:
        tags.add({"accounting":"BS_SIDE","ev":"EV_VS_EQV","ma":"DIRECTION",
                  "lbo":"DIRECTION","valuation":"DEFINITIONAL","market":"DEFINITIONAL",
                  "behavioral":"DEFINITIONAL"}[c["area"]])
    c["tags"] = sorted(tags)
    c["modes"] = sorted(modes)

from collections import Counter
print("concepts:", len(C))
print("\nerror-tag coverage:")
for t,n in Counter(t for c in C for t in c["tags"]).most_common(): print(f"  {n:4d}  {t}")
print("\nmode fitness:")
for m,n in Counter(m for c in C for m in c["modes"]).most_common(): print(f"  {n:4d}  {m}")
print("\ndifficulty:", dict(sorted(Counter(c["d"] for c in C).items())))
print("untagged concepts:", sum(1 for c in C if not c["tags"]))
print("concepts with no rubric points:", sum(1 for c in C if not c["rub"]))
json.dump(C, open("concepts.json","w"), indent=0, ensure_ascii=False)
