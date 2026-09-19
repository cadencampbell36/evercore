/* Rubric points are split out of the guide's answers, so some are lead-ins and stage
   directions rather than checkable content ("This is a simple OpEx increase:", "Walk me
   through each step SEPARATELY."). Those give a fuzzy grader nothing to match and let
   unrelated text score against them. Drop them; fall back to sentences of the answer. */
const fs = require("fs");
const path = "bank.js";
let src = fs.readFileSync(path, "utf8");
const R = eval(src + "; ({CONCEPTS})");

const META = /^(walk me through|walk through|now walk|this is a|here('s| is)|for example|note that|remember|let's|lets|assume|next,|then,|finally,|first,|second,|third,|in other words|as a reminder|continuing|suppose)/i;
const STOPWORDS = new Set("a an the of to in for on at by with and or is are was were be it its this that as from into if then than so you your we our i".split(" "));
const content = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w && !STOPWORDS.has(w));

function good(p) {
  const t = String(p).trim();
  if (t.length < 30) return false;
  if (META.test(t)) return false;
  if (/[:：]$/.test(t)) return false;              // a lead-in to a list, not a point
  if (/\?$/.test(t)) return false;                // restating the question
  if (content(t).length < 5) return false;
  return true;
}

let dropped = 0, refilled = 0, before = 0, after = 0;
for (const c of R.CONCEPTS) {
  if (!c.rub || !c.rub.length) continue;
  before += c.rub.length;
  // Points split at a source line wrap arrive as fragments: one ends mid-sentence and the
  // next starts lowercase. Re-join those before judging them.
  const joined = [];
  for (const p of c.rub) {
    const t = String(p).trim();
    const prev = joined[joined.length - 1];
    const continues = prev && /^[a-z(“"]/.test(t) && !/[.!?:]$/.test(prev);
    if (continues) joined[joined.length - 1] = prev + " " + t;
    else joined.push(t);
  }
  let kept = joined.filter(good);
  if (kept.length < 2 && c.a) {                    // rebuild from the answer's own sentences
    const sents = String(c.a).split(/(?<=[.!?])\s+|•/).map(s => s.replace(/\s+/g, " ").trim());
    const extra = sents.filter(s => good(s) && !kept.includes(s)).slice(0, 5);
    if (extra.length) refilled++;
    kept = kept.concat(extra);
  }
  dropped += Math.max(0, c.rub.length - kept.length);
  c.rub = kept.slice(0, 7);
  after += c.rub.length;
}
console.log(`rubric points ${before} -> ${after}  (dropped ${dropped} lead-ins, rebuilt ${refilled} concepts from answer text)`);
console.log(`concepts with fewer than 2 points: ${R.CONCEPTS.filter(c => !c.rub || c.rub.length < 2).length}`);

// splice the new CONCEPTS array back into bank.js, leaving the rest of the file untouched
const start = src.indexOf("const CONCEPTS = ");
const end = src.indexOf(";\nconst AREAS");
src = src.slice(0, start) + "const CONCEPTS = " + JSON.stringify(R.CONCEPTS) + src.slice(end);
fs.writeFileSync(path, src);
console.log("bank.js rewritten");
