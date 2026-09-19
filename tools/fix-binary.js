/* Two problems with the binary prompts:
   1. A trailing ellipsis reads as a truncated question rather than a sentence to complete.
   2. The generated transaction-matrix items labelled option A "Rises" or "Falls" when it was
      the answer and "Changes" when it was not, which tells you the answer without thinking. */
const fs = require("fs");
let src = fs.readFileSync("bank.js", "utf8");
const R = eval(src + "; ({CONCEPTS})");

let ell = 0, tell = 0;
for (const c of R.CONCEPTS) {
  if (!c.binary) continue;
  const b = c.binary;
  if (/…\s*$/.test(b.p)) { b.p = b.p.replace(/\s*…\s*$/, ":"); ell++; }
  // normalise every "does enterprise value move?" item to the same neutral pair
  const pair = [b.a, b.b].map(x => String(x).toLowerCase());
  if (pair.includes("unchanged") && /^(changes|rises|falls)$/.test(pair[0])) {
    const answerIsUnchanged = b.c === 1;
    b.a = "Changes"; b.b = "Unchanged"; b.c = answerIsUnchanged ? 1 : 0;
    tell++;
  }
}
console.log(`ellipsis prompts rewritten: ${ell}`);
console.log(`direction-leaking option labels neutralised: ${tell}`);

const start = src.indexOf("const CONCEPTS = ");
const end = src.indexOf(";\nconst AREAS");
fs.writeFileSync("bank.js", src.slice(0, start) + "const CONCEPTS = " + JSON.stringify(R.CONCEPTS) + src.slice(end));

// no binary item may be answerable from the option labels alone
const R2 = eval(fs.readFileSync("bank.js", "utf8") + "; ({CONCEPTS})");
const bad = R2.CONCEPTS.filter(c => c.binary && /…$/.test(c.binary.p));
// Only the generated matrix family had a mechanical tell. The hand-authored items pair
// "Unchanged" against a specific magnitude and their answers vary, so they are fine.
const leak = R2.CONCEPTS.filter(c => c.id.indexOf("ev.matrix") === 0 && c.binary &&
  !/^changes$/i.test(c.binary.a));
console.log(`remaining ellipses: ${bad.length}   remaining leaky pairs: ${leak.length}`);
process.exit(bad.length || leak.length ? 1 : 0);
