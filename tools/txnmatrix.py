import json
A = 100
# Each transaction: deltas to equity value, debt, cash, and operating-asset value.
# EV is DERIVED from the bridge (EV = EqV + Debt - Cash) and cross-checked against the
# change in operating assets. Any row where the two disagree is a bug, not a question.
T = [
 ("issues $100 of common stock and holds the proceeds in cash",                    +A, 0, +A, 0),
 ("issues $100 of debt and holds the proceeds in cash",                             0,+A, +A, 0),
 ("issues $100 of stock to buy a factory worth $100",                              +A, 0,  0,+A),
 ("issues $100 of debt to buy a factory worth $100",                                0,+A,  0,+A),
 ("uses $100 of existing cash to buy a factory worth $100",                         0, 0, -A,+A),
 ("uses $100 of existing cash to acquire a business worth $100",                    0, 0, -A,+A),
 ("repurchases $100 of its own stock using cash",                                  -A, 0, -A, 0),
 ("pays a $100 common dividend in cash",                                           -A, 0, -A, 0),
 ("finds $100 on the ground",                                                      +A, 0, +A, 0),
 ("sells a factory carried at $100 for $100 in cash",                               0, 0, +A,-A),
 ("repays $100 of debt principal using cash",                                       0,-A, -A, 0),
 ("issues $100 of debt and immediately pays it out as a dividend",                 -A,+A,  0, 0),
 ("issues $100 of stock and uses the proceeds to repay $100 of debt",              +A,-A,  0, 0),
 ("writes down a factory carried at $100 to zero (ignore taxes)",                  -A, 0,  0,-A),
]
def word(d): return "rises by $100" if d>0 else ("falls by $100" if d<0 else "is unchanged")
out=[]
for txt,de,dd,dc,doa in T:
    dev = de + dd - dc                      # the bridge
    assert dev == doa, f"BRIDGE/OPERATING MISMATCH: {txt}: bridge {dev} vs operating {doa}"
    correct = f"Equity value {word(de)}, enterprise value {word(dev)}"
    # Distractors are the user's error patterns, drawn from the full 3x3 outcome space
    # so there is always a distinct pool of four even when a leg is unchanged.
    def opt(e, v): return f"Equity value {word(e)}, enterprise value {word(v)}"
    typed = [
        (opt(dev, de), "EV_VS_EQV",
         "The two are swapped. Funding source drives equity value; cash movement drives enterprise value. Run the two tests separately."),
        (opt(-de, dev), "DIRECTION",
         "Right on enterprise value, inverted on equity value. Ask who funded it, and whether shares were issued or retired."),
        (opt(de, -dev), "DIRECTION",
         "Right on equity value, inverted on enterprise value. Enterprise value moves only when the operating business changes."),
        (opt(de, de), "EV_VS_EQV",
         "Both legs moved together. That only holds when a transaction hits the operating business and the shareholders identically, which it does not here."),
        (opt(0, 0), "DIRECTION",
         "Nothing moved. Work the bridge, EV = equity value + debt \u2212 cash, rather than reading the transaction intuitively."),
        (opt(-de, -dev), "DIRECTION",
         "Both legs inverted. Getting the mechanics right and the sign wrong is the failure mode this question is built to catch."),
    ]
    seen = {correct}
    opts, tags, why = [correct], [None], [
        (f"Correct. Equity value {word(de)}, and through EV = equity value + debt \u2212 cash, enterprise value {word(dev)} "
         f"\u2014 matching the ${abs(doa)} change in operating assets.") if doa else
        (f"Correct. Equity value {word(de)}; the financing and cash legs offset in the bridge, so enterprise value is unchanged "
         f"\u2014 the operating business did not change.")]
    for text, tag, expl in typed:
        if len(opts) >= 4 or text in seen: continue
        seen.add(text); opts.append(text); tags.append(tag); why.append(expl)
    # When both legs are unchanged every typed distractor collapses to the same string,
    # so fall back to the rest of the 3x3 space. These are still the real confusions:
    # believing debt raises enterprise value, or that raising cash raises equity value.
    generic = {
      (+A, 0): "Thinks the financing leg alone moved shareholder value. Raising money is not the same as creating it.",
      (0, +A): "Thinks raising debt raises enterprise value. Debt up and cash up offset in the bridge; the operating business is untouched.",
      (+A, +A): "Moves both legs on a transaction that only shuffled the balance sheet.",
      (-A, 0): "Inverted. Nothing here reduces the shareholders' claim.",
      (0, -A): "Inverted. Nothing here shrinks the operating business.",
      (-A, -A): "Moves both legs, and in the wrong direction.",
    }
    for (e, v), expl in generic.items():
        if len(opts) >= 4: break
        text = opt(e, v)
        if text in seen: continue
        seen.add(text); opts.append(text); tags.append("EV_VS_EQV"); why.append(expl)
    assert len(opts) == 4, f"only {len(opts)} options for: {txt}"
    order = [0, 1, 2, 3]
    import random; random.Random(abs(hash(txt)) % 9999).shuffle(order)
    out.append({
      "id":"ev.matrix."+txt.split()[0]+"-"+str(len(out)),
      "area":"ev","section":"EV & Equity Value — Transaction effects","in400":False,
      "sources":["generated:transaction-matrix"],"variants":[],"d":3,"t":45,
      "tags":sorted({"EV_VS_EQV","DIRECTION"}),
      "q":f"A company {txt}. What happens to equity value and enterprise value?",
      "a":f"{correct}. Work it from the bridge: EV = equity value + debt − cash. "
          f"Equity value moves only when shares are issued or retired or when value is paid out to shareholders; "
          f"enterprise value moves only when the operating business changes — here operating assets change by ${doa}.",
      "rub":[f"Equity value {word(de)}","Enterprise value "+word(dev),
             "Works it from the bridge rather than from intuition",
             "States both as changes, not levels"],
      "mc":{"p":f"A company {txt}. What happens to equity value and enterprise value?",
            "o":[opts[i] for i in order],"c":order.index(0),
            "t":[tags[i] for i in order],"why":[why[i] for i in order]},
      "binary":{"p":f"{txt[0].upper()+txt[1:]} — enterprise value:",
                "a":word(dev).replace("is ","").replace("rises by $100","Rises").replace("falls by $100","Falls") if dev else "Changes",
                "b":"Unchanged" if dev else "Unchanged",
                "c":1 if dev==0 else 0,
                "why":f"Enterprise value {word(dev)}. It tracks the operating business only; the bridge nets the financing legs out."},
      "modes":["binary","card","frq","mc"],
    })
print(f"generated {len(out)} transaction-effect concepts, all bridge-verified")
unchanged = sum(1 for o in out if "unchanged, enterprise value is unchanged" in o["a"] or "enterprise value is unchanged" in o["a"])
print(f"  of which enterprise value is unchanged: {unchanged}  (README: do not bias toward questions where something moves)")
json.dump(out, open("txnmatrix.json","w"), indent=0, ensure_ascii=False)
