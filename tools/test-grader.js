/* Calibration: the grader must pass the guide's own answer and fail nonsense. */
const fs = require("fs");
const src = fs.readFileSync("bank.js","utf8") + "\n" + fs.readFileSync("grade.js","utf8")
  + "\n;module.exports={CONCEPTS,gradeLocal,toks,coverage};";
fs.writeFileSync("/tmp/_g.js", src);
const {CONCEPTS, gradeLocal} = require("/tmp/_g.js");

const withRub = CONCEPTS.filter(c => c.rub && c.rub.length >= 2 && c.a && c.a.length > 200);
const sample = withRub.filter((_, i) => i % 7 === 0).slice(0, 120);

const stat = name => ({name, n:0, c2:0, c1:0, c0:0, cov:0});
const push = (s, r) => { s.n++; s["c"+r.correctness]++; s.cov += r.coverage; };

const ref = stat("guide's own answer");
const nonsense = stat("nonsense");
const empty = stat("one word");
const partial = stat("first sentence only");
const keyword = stat("keyword soup");

for (const c of sample) {
  push(ref, gradeLocal(c, "frq", c.a));
  push(nonsense, gradeLocal(c, "frq", "The mitochondria is the powerhouse of the cell and I enjoy long walks on the beach in winter."));
  push(empty, gradeLocal(c, "frq", "yes"));
  push(partial, gradeLocal(c, "frq", (c.a.split(/(?<=[.!?])\s+/)[0] || "").slice(0, 300)));
  push(keyword, gradeLocal(c, "frq", (c.rub||[]).join(" ").split(/\s+/).slice(0,12).join(" ")));
}
const row = s => `  ${s.name.padEnd(22)} n=${String(s.n).padStart(3)}  full=${String(s.c2).padStart(3)}  partial=${String(s.c1).padStart(3)}  none=${String(s.c0).padStart(3)}  mean coverage=${(s.cov/s.n).toFixed(2)}`;
console.log("CALIBRATION over " + sample.length + " concepts\n");
[ref, partial, keyword, nonsense, empty].forEach(s => console.log(row(s)));

const falseNeg = ref.c0;
const falsePos = nonsense.c2 + nonsense.c1 + empty.c2 + empty.c1;
console.log(`\n  false negatives (guide's answer scored 'none'): ${falseNeg}`);
console.log(`  false positives (nonsense scored any credit) : ${falsePos}`);
process.exit(falseNeg > sample.length * 0.1 || falsePos > 0 ? 1 : 0);
