// Exercise the spec §7 state machine against the transitions it specifies.
const src = require('fs').readFileSync('app.js','utf8');
const slice = src.slice(src.indexOf('const DAY ='), src.indexOf('/* ── the pool'));
const stub = `
  const CONCEPTS=[{id:'x',area:'accounting',t:60,tags:['BS_SIDE'],modes:['def'],q:'q',a:'a',rub:[]}];
  const AREAS={accounting:'Accounting'}; const ERROR_TAGS={BS_SIDE:{n:'side',d:''}};
  const claude=undefined; const window={addEventListener(){}}; const document={addEventListener(){}};
`;
const mod = new Function(stub + slice + `
  return {st, applyMastery, schedule, freshState, isConceptGap, S, quality, resetRun};
`)();
const {st, applyMastery, schedule, freshState, isConceptGap, S} = mod;
S.meta.interviewDate = new Date(Date.now()+70*86400000).toISOString().slice(0,10);

const D = 86400000;
let fails = 0;
const chk = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${name}`);
};
const STATE = ['untested','learning','mastered','decayed'];
const fresh = () => { const s = freshState(); return s; };

console.log('\n1. three correct in ONE sitting must NOT master (spec: that is working memory)');
{ const s = fresh(), t0 = Date.now();
  for (let i=0;i<3;i++) applyMastery(s, true, false, 'def', false, 'sess1', t0 + i*60000);
  chk('state after 3 same-session correct', STATE[s.st], 'learning'); }

console.log('\n2. mastery needs 3 correct, 2+ days, 2+ sessions, one retention, one generative');
{ const s = fresh(), t0 = Date.now();
  applyMastery(s, true, false, 'mc',  false, 'sess1', t0);              // recognition, not generative
  applyMastery(s, true, false, 'mc',  true,  'sess2', t0 + 2*D);
  const ev1 = applyMastery(s, true, false, 'mc', true, 'sess3', t0 + 4*D);
  chk('3 correct but no generative mode', [STATE[s.st], ev1], ['learning', null]);
  const ev2 = applyMastery(s, true, false, 'def', true, 'sess4', t0 + 6*D);
  chk('promotes once a generative answer lands', [STATE[s.st], ev2], ['mastered','mastered']); }

console.log('\n3. mastery without a retention check must not promote');
{ const s = fresh(), t0 = Date.now();
  applyMastery(s, true, false, 'def', false, 's1', t0);
  applyMastery(s, true, false, 'def', false, 's2', t0 + 2*D);
  applyMastery(s, true, false, 'def', false, 's3', t0 + 4*D);
  chk('no retention check yet', STATE[s.st], 'learning'); }

console.log('\n4. losing mastery is easy: one miss = shaky, two within 30d = decayed');
{ const s = fresh(), t0 = Date.now(); s.st = 2;
  const e1 = applyMastery(s, false, false, 'def', false, 's5', t0);
  chk('first miss', [STATE[s.st], s.shaky, e1], ['mastered', true, 'shaky']);
  const e2 = applyMastery(s, false, false, 'def', false, 's6', t0 + 3*D);
  chk('second miss within 30 days', [STATE[s.st], e2, s.decays], ['decayed','decayed',1]); }

console.log('\n5. two misses more than 30 days apart do NOT decay');
{ const s = fresh(), t0 = Date.now(); s.st = 2;
  applyMastery(s, false, false, 'def', false, 's7', t0);
  applyMastery(s, false, false, 'def', false, 's8', t0 + 40*D);
  chk('rolling 30-day window', STATE[s.st], 'mastered'); }

console.log('\n6. correct-but-slow is shaky, never a promotion');
{ const s = fresh(), t0 = Date.now();
  applyMastery(s, true, false, 'def', false, 's1', t0);
  applyMastery(s, true, false, 'def', true, 's2', t0 + 2*D);
  const ev = applyMastery(s, true, true, 'def', true, 's3', t0 + 4*D);   // slow
  chk('slow third answer holds at learning', [STATE[s.st], ev, s.shaky], ['learning','slow',true]); }

console.log('\n7. recovery from decayed is easy: 2 correct, 2 days, 2 sessions, no generative needed');
{ const s = fresh(), t0 = Date.now(); s.st = 3;
  applyMastery(s, true, false, 'mc', false, 'r1', t0);
  const ev = applyMastery(s, true, false, 'mc', false, 'r2', t0 + 1*D);
  chk('recovered without a generative answer', [STATE[s.st], ev], ['mastered','recovered']); }

console.log('\n8. oscillation: 3 mastered->decayed->mastered cycles flags a concept gap');
{ const s = fresh(), t0 = Date.now(); s.st = 3;
  for (let c=0;c<3;c++){
    applyMastery(s, true, false, 'mc', false, `a${c}`, t0 + c*10*D);
    applyMastery(s, true, false, 'mc', false, `b${c}`, t0 + c*10*D + D);
    if (c<2){ s.st = 2;
      applyMastery(s, false, false, 'mc', false, `c${c}`, t0 + c*10*D + 2*D);
      applyMastery(s, false, false, 'mc', false, `d${c}`, t0 + c*10*D + 3*D); }
  }
  chk('cycles counted / gap flagged', [s.cycles, isConceptGap(s)], [3, true]); }

console.log('\n9. overnight gate: a same-day repeat cannot advance the interval');
{ const s = fresh(); s.n = 3; s.i = 7; s.e = 2.3;
  schedule(s, 5, true);
  chk('same-day correct does not grow the interval', s.i, 7); 
  const before = s.i; schedule(s, 5, false);
  chk('next-day correct does grow it', s.i > before, true); }

console.log('\n10. horizon cap: no interval exceeds a quarter of the days remaining');
{ const s = fresh(); s.n = 9; s.i = 300; s.e = 2.6;
  schedule(s, 5, false);
  const cap = Math.max(2, Math.floor(0.25 * 70));
  chk(`interval capped at ${cap}d`, s.i <= cap, true); }

console.log('\n11. decayed items stay hot regardless of ease');
{ const s = fresh(); s.st = 3; s.n = 5; s.i = 20; schedule(s, 4, false);
  chk('decayed interval <= 2 days', s.i <= 2, true); }

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall mastery-machine assertions passed');
process.exit(fails ? 1 : 0);
