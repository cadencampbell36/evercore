/* Local autograder.
   There is no model on a static host, so typed answers are scored here: fuzzy coverage of
   the rubric, plus detection of the specific imprecisions in the error profile. It is
   deliberately generous about wording and strict about substance - the opposite of a string
   match. Where a model grader is available (inside the artifact), that runs instead. */

/* Finance shorthand, so "EV rises and EqV is unchanged" matches a rubric written out in full. */
const ALIASES = {
  "ev": "enterprise value", "tev": "enterprise value", "eqv": "equity value",
  "mktcap": "equity value", "marketcap": "equity value",
  "cfo": "cash flow from operations", "cfi": "cash flow from investing",
  "cff": "cash flow from financing", "ocf": "cash flow from operations",
  "ni": "net income", "re": "retained earnings", "se": "shareholders equity",
  "da": "depreciation amortization", "d&a": "depreciation amortization",
  "dep": "depreciation", "amort": "amortization",
  "wc": "working capital", "nwc": "working capital", "owc": "working capital",
  "fcf": "free cash flow", "ufcf": "unlevered free cash flow", "lfcf": "levered free cash flow",
  "wacc": "weighted average cost of capital", "coe": "cost of equity", "cod": "cost of debt",
  "capm": "capital asset pricing model", "erp": "equity risk premium", "rf": "risk free rate",
  "tv": "terminal value", "pv": "present value", "npv": "net present value",
  "irr": "internal rate of return", "moic": "multiple on invested capital", "mom": "multiple of money",
  "ebitda": "earnings before interest taxes depreciation amortization",
  "ebit": "operating income", "ebt": "pre-tax income", "pti": "pre-tax income",
  "ar": "accounts receivable", "ap": "accounts payable", "dr": "deferred revenue",
  "dta": "deferred tax asset", "dtl": "deferred tax liability", "nol": "net operating loss",
  "sbc": "stock based compensation", "nci": "noncontrolling interest",
  "ppe": "property plant equipment", "pp&e": "property plant equipment",
  "is": "income statement", "bs": "balance sheet", "cfs": "cash flow statement",
  "l&e": "liabilities equity", "lbo": "leveraged buyout", "capex": "capital expenditures",
  "pik": "paid in kind", "tsm": "treasury stock method", "eps": "earnings per share",
  "p/e": "price earnings", "pe": "price earnings", "s&u": "sources uses",
  "cogs": "cost of goods sold", "opex": "operating expenses", "sga": "operating expenses",
  "roic": "return on invested capital", "roe": "return on equity", "roa": "return on assets",
  "gaap": "accounting standard", "ifrs": "accounting standard", "ltm": "trailing",
  "ntm": "forward", "yoy": "year over year", "cagr": "growth rate",
};

const STOP = new Set(("a an the of to in for on at by with and or is are was were be been being am "
  + "it its this that these those as from into if then than so you your we our i me my he she they "
  + "them their there here what which who whom when where why how can could would should will shall "
  + "may might must do does did done have has had having not no nor but also just only very much "
  + "more most other some any each both few many too all about over under again further once s t "
  + "because while during before after above below up down out off own same such").split(" "));

/* Weighted higher because getting these right is the whole point. */
const SIGNAL = new Set(("asset assets liability liabilities equity cash investing financing operating "
  + "increase increases increased rise rises rising decrease decreases decreased fall falls falling "
  + "higher lower unchanged accretive dilutive debit credit add adds added subtract subtracts "
  + "retained earnings income statement balance sheet flow section side").split(" "));

function stem(w) {
  if (w.length <= 3) return w;
  return w.replace(/(ies)$/, "y").replace(/(sses|shes|ches|xes)$/, "$1".slice(0, -2))
          .replace(/(ations|ation)$/, "ate").replace(/(ing|ed|es|s)$/, "")
          .replace(/(ly)$/, "");
}

function normalize(text) {
  let s = " " + String(text || "").toLowerCase() + " ";
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/(\d),(\d)/g, "$1$2");                      // 1,200 -> 1200
  s = s.replace(/\$\s*/g, " ");                             // the currency mark carries no meaning
  // expand shorthand on word boundaries, longest keys first so pp&e beats pe
  for (const k of Object.keys(ALIASES).sort((a, b) => b.length - a.length)) {
    const esc = k.replace(/[.*+?^${}()|[\]\\&/]/g, "\\$&");
    s = s.replace(new RegExp("(^|[^a-z0-9])" + esc + "(?![a-z0-9])", "g"), "$1 " + ALIASES[k] + " ");
  }
  return s;
}

function toks(text) {
  const out = [];
  for (const raw of normalize(text).split(/[^a-z0-9.%-]+/)) {
    if (!raw) continue;
    const w = raw.replace(/^[.%-]+|[.%-]+$/g, "");
    if (!w || STOP.has(w)) continue;
    out.push(/^\d/.test(w) ? w : stem(w));
  }
  return out;
}
const bigrams = arr => { const b = new Set(); for (let i = 1; i < arr.length; i++) b.add(arr[i-1]+" "+arr[i]); return b; };
const weightOf = t => (/^\d/.test(t) ? 2.2 : SIGNAL.has(t) ? 1.6 : 1);

/* How much of one rubric point appears in the answer, 0..1. */
function coverage(point, ansSet, ansBigrams) {
  const pt = toks(point);
  if (!pt.length) return 0;
  let got = 0, total = 0, matched = 0;
  for (const t of pt) {
    const w = weightOf(t);
    total += w;
    if (ansSet.has(t)) { got += w; matched++; }
  }
  // A short point matched on one or two incidental words is not coverage; stemming alone can
  // collide ("long walks on the beach" against "walk me through").
  if (matched < Math.min(3, pt.length)) return 0;
  let score = total ? got / total : 0;
  const pb = bigrams(pt);
  if (pb.size) {                                  // phrase-level agreement, not just bag of words
    let hit = 0;
    pb.forEach(b => { if (ansBigrams.has(b)) hit++; });
    score = Math.min(1, score + 0.25 * (hit / pb.size));
  }
  return score;
}

const COVERED = 0.42, PARTIAL = 0.25;

/* The §6 error profile, detected from the text itself. Conservative on purpose: a false
   accusation from a tool the user is trusting to correct him is worse than a miss. */
function detectErrors(concept, answer, refText) {
  const a = " " + String(answer).toLowerCase().replace(/\s+/g, " ") + " ";
  const errs = new Set(), notes = [];
  // A walkthrough is a question that asks what happens ACROSS the statements, not merely any
  // question with the word "statement" in it - that caught "What's the most important statement?".
  const isWalk = (concept.modes || []).includes("grid")
    || /walk me through|walk through/i.test(concept.q)
    || (/what happens|how (do|does|would)/i.test(concept.q)
        && /(the )?(3|three) statements|financial statements/i.test(concept.q));
  const hasFigures = /\d/.test(a);
  const changeVerb = /(increase|decrease|rise|ris|fall|fell|drop|go(es)? up|go(es)? down|up by|down by|higher|lower|change)/i.test(a);

  if (isWalk && hasFigures && !changeVerb) {
    errs.add("LEVEL_NOT_DELTA");
    notes.push("You gave figures without saying which way they moved. Every number in a walkthrough is a change: “net income falls by $7.50”, not “net income of $7.50”.");
  }
  if (/net income[^.]{0,60}(on|to|top of)[^.]{0,20}balance sheet/.test(a)) {
    errs.add("WRONG_STATEMENT");
    notes.push("You put net income on the balance sheet. Net income is an income statement figure; it flows into retained earnings.");
  }
  // Only when net income is named AS a balance sheet line. Saying equity fell because of net
  // income is correct, and the guide itself phrases it that way.
  if (/net income (line )?(on|in|under|within) the balance sheet|balance sheet[^.]{0,30}net income (line|balance|account)/.test(a)
      && !/retained earnings/.test(a)) {
    errs.add("NI_FOR_RE");
    notes.push("On the balance sheet the line is retained earnings, not net income.");
  }
  if (isWalk && !/balanc|both sides|assets equal|a = l|ties out/.test(a)) {
    errs.add("NO_BALANCE_CHK");
    notes.push("You never confirmed it balances. Close every walkthrough by stating that both sides moved by the same amount.");
  }
  // section and side confusions, checked only where the reference is unambiguous
  const refSays = p => new RegExp(p, "i").test(refText);
  if (refSays("cash flow from investing|\\bCFI\\b") && /financing/.test(a) && !/investing/.test(a)) {
    errs.add("CFI_CFF");
    notes.push("This is an investing item, not financing. Classify on the verb: bought or sold is investing, issued or repaid is financing.");
  }
  if (refSays("cash flow from financing|\\bCFF\\b") && /investing/.test(a) && !/financing/.test(a)) {
    errs.add("CFI_CFF");
    notes.push("This is a financing item, not investing. Issued or repaid is financing, whatever the instrument is called.");
  }
  if (refSays("\\bliabilit") && /\bas an asset\b|\bis an asset\b/.test(a)) {
    errs.add("BS_SIDE");
    notes.push("You called it an asset. It is a liability - the company owes it.");
  }
  if (refSays("unchanged|does not change|stays the same") &&
      /(increase|rise|go(es)? up|higher)/.test(a) && !/unchanged|does not change|no change|stays the same/.test(a)) {
    errs.add("DIRECTION");
    notes.push("The reference answer has this unchanged; you moved it. Work the bridge rather than the intuition.");
  }
  return {errs: [...errs], notes};
}

function gradeLocal(concept, mode, answer) {
  const text = String(answer || "").trim();
  const rub = (concept.rub && concept.rub.length ? concept.rub : [concept.a || ""]).slice(0, 8);
  const at = toks(text);
  const ansSet = new Set(at), ansBi = bigrams(at);

  const scored = rub.map(p => ({point: p, score: coverage(p, ansSet, ansBi)}));
  const hit = scored.filter(s => s.score >= COVERED);
  const part = scored.filter(s => s.score >= PARTIAL && s.score < COVERED);
  const missed = scored.filter(s => s.score < PARTIAL);
  const frac = rub.length ? (hit.length + 0.5 * part.length) / rub.length : 0;

  const {errs, notes} = detectErrors(concept, text, concept.a || "");

  // Relevance gate: an answer that shares almost no substance with the rubric scores zero
  // however the ratios fall out. Without it, unrelated prose collects partial credit from
  // one loosely matched point.
  const rubTerms = new Set();
  rub.forEach(p => toks(p).forEach(t => rubTerms.add(t)));
  let shared = 0;
  rubTerms.forEach(t => { if (ansSet.has(t)) shared++; });

  let correctness = frac >= 0.7 ? 2 : frac >= 0.35 ? 1 : 0;
  if (shared < 4) correctness = 0;
  // A complete answer that commits a recorded error is not a clean answer.
  if (correctness === 2 && errs.length) correctness = 1;
  if (at.length < 8) correctness = 0;

  let precision = Math.max(0, Math.min(1, frac - 0.18 * errs.length));
  if (text.length < 60) precision = Math.min(precision, 0.5);

  const bits = [];
  bits.push(frac >= 0.7 ? "You covered the substance."
    : frac >= 0.35 ? "Part of the answer is there."
    : "Most of the required content is missing.");
  if (notes.length) bits.push(notes[0]);
  else if (missed.length) bits.push("The gaps are listed below - check them against the guide's own answer.");
  if (!errs.length && frac >= 0.7) bits.push("No imprecision flagged in the phrasing.");

  return {
    correctness, precision,
    missed: missed.map(m => m.point.length > 110 ? m.point.slice(0, 110) + "…" : m.point),
    hit: hit.map(h => h.point),
    errors: errs, notes,
    feedback: bits.join(" "),
    local: true, coverage: frac,
  };
}
