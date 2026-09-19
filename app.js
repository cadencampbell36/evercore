/* Evercore Prep Suite — engine
   Storage: claude.use("db").  Grading: claude.use("sample").  Export: claude.use("downloads").
   Never localStorage for progress (spec §8); theme preference only is a per-viewer convenience. */

const DAY = 86400000;
const GENERATIVE = new Set(["def", "frq", "grid", "spoken"]);
const MODE_NAME = {binary:"Binary", card:"Flashcard", def:"Definition", mc:"Multiple choice",
                   calc:"Calc", grid:"Three-statement", frq:"Free response", spoken:"Spoken check"};
const TARGET = {binary:8, card:30, def:45, mc:30, calc:120, grid:180, frq:90, spoken:90};

const byId = {}; CONCEPTS.forEach(c => byId[c.id] = c);
const epochDay = t => Math.floor(t / DAY);
const dayKey = t => new Date(t).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ── state ──────────────────────────────────────────────────────────────── */
const S = {
  db: null, sample: null, downloads: null, persisted: false,
  sched: {},                 // conceptId -> scheduling + mastery state
  recent: [],                // compact attempts, capped, for the readiness score
  meta: {interviewDate: "2026-11-30", bank: "400", theme: "light", diagnostic: null, totals: {}},
  session: null,
  dirty: new Set(), saveTimer: null, view: "session",
};

const freshState = () => ({
  st: 0, i: 0, e: 2.3, n: 0, due: 0, last: 0,
  cc: 0, days: [], sess: [], gen: false, ret: false,
  miss: [], shaky: false, cycles: 0, decays: 0, seen: 0
});
const st = id => (S.sched[id] || (S.sched[id] = freshState()));


/* ── storage ─────────────────────────────────────────────────────────────
   Two backends behind one interface. Inside a Claude artifact this is
   claude.use("db"); on a static host (GitHub Pages) there is no server, so it is
   IndexedDB. The spec's "never localStorage" rule assumed the artifact store existed;
   on a static host the only alternative to browser storage is a backend, so progress
   lives in IndexedDB and export/import is how it moves between machines. */
function idbStore() {
  const NAME = "evercore-prep", STORE = "docs";
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    doc(path) {
      return {
        path,
        async get() {
          try { const v = await tx("readonly", st => st.get(path));
                return {exists: v !== undefined, data: () => v}; }
          catch (e) { return {exists: false, data: () => undefined}; }
        },
        async set(data) { await tx("readwrite", st => st.put(data, path)); },
      };
    },
    async all() {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(STORE, "readonly"), st = t.objectStore(STORE), out = {};
        const c = st.openCursor();
        c.onsuccess = e => { const cur = e.target.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); } else res(out); };
        c.onerror = () => rej(c.error);
      });
    },
    async clear() { await tx("readwrite", st => st.clear()); },
    local: true,
  };
}

/* ── persistence ────────────────────────────────────────────────────────── */
const AREAS_K = Object.keys(AREAS);
const shardOf = id => (byId[id] ? byId[id].area : "accounting");

async function boot() {
  // claude.use resolves null when a view cannot run a capability, and the global itself is
  // absent outside a viewer. Branch on absence; never block the first paint on it.
  const use = async n => {
    try { return (typeof claude !== "undefined" && claude.use) ? await claude.use(n) : null; }
    catch (e) { return null; }
  };
  render();                       // paint immediately, then light up what resolves
  S.db = await use("db");
  if (!S.db && typeof indexedDB !== "undefined") S.db = idbStore();
  S.sample = await use("sample");
  S.downloads = await use("downloads");
  if (S.db) {
    try {
      const reads = await Promise.all([
        ...AREAS_K.map(a => S.db.doc("progress/sched_" + a).get()),
        S.db.doc("progress/stats").get(),
        S.db.doc("progress/meta").get(),
      ]);
      AREAS_K.forEach((a, i) => {
        const d = reads[i]; if (d.exists) Object.assign(S.sched, d.data().items || {});
      });
      const stats = reads[AREAS_K.length], meta = reads[AREAS_K.length + 1];
      if (stats.exists) S.recent = stats.data().recent || [];
      if (meta.exists) Object.assign(S.meta, meta.data());
      S.persisted = true;
    } catch (e) { S.persisted = false; }
  }
  applyTheme();
  render();
}

function markDirty(k) { S.dirty.add(k); scheduleSave(); }
function scheduleSave() {
  if (S.saveTimer) return;
  S.saveTimer = setTimeout(flush, 2000);       // coalesce a burst of answers into one write
}
async function flush() {
  S.saveTimer = null;
  if (!S.db || !S.dirty.size) return;
  const keys = [...S.dirty]; S.dirty.clear();
  for (const k of keys) {                       // one write at a time per document
    try {
      if (k.startsWith("sched:")) {
        const area = k.slice(6);
        const items = {};
        for (const id in S.sched) if (shardOf(id) === area) items[id] = S.sched[id];
        await S.db.doc("progress/sched_" + area).set({items, at: Date.now()});
      } else if (k === "stats") {
        await S.db.doc("progress/stats").set({recent: S.recent.slice(-600), at: Date.now()});
      } else if (k === "meta") {
        await S.db.doc("progress/meta").set(S.meta);
      } else if (k === "session" && S.session) {
        await S.db.doc("sessions/" + S.session.id).set(sessionDoc());
      }
    } catch (e) { /* a failed write retries on the next flush; never block the UI */ }
  }
}
window.addEventListener("pagehide", () => { flush(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

/* ── scheduling: SM-2, horizon-capped, with an overnight gate ────────────── */
function daysToInterview() {
  const t = Date.parse(S.meta.interviewDate + "T00:00:00");
  return Math.max(1, Math.round((t - Date.now()) / DAY));
}
function maxInterval() { return Math.max(2, Math.floor(0.25 * daysToInterview())); }

function quality(correctness, ms, target) {
  if (correctness === 0) return 1;
  if (correctness === 1) return 2;                       // partial credit
  if (ms < 0.6 * target * 1000) return 5;
  if (ms <= 1.5 * target * 1000) return 4;
  return 3;                                              // correct but slow
}

function schedule(s, q, sameDay) {
  const ef = s.e + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  s.e = Math.min(2.6, Math.max(1.3, ef));
  if (q < 3) { s.n = 1; s.i = 1; }
  else if (sameDay) { s.i = Math.max(s.i, 1); }          // overnight gate: no advance today
  else if (s.n <= 1) { s.n = 2; s.i = 1; }
  else if (s.n === 2) { s.n = 3; s.i = 3; }
  else { s.n += 1; s.i = Math.round(s.i * s.e); }
  s.i = Math.min(s.i, maxInterval());
  if (s.st === 3) s.i = Math.min(s.i, 2);                // decayed items stay hot (spec §7)
  s.due = epochDay(Date.now()) + s.i;
}

/* ── mastery state machine (spec §7) ─────────────────────────────────────── */
function applyMastery(s, ok, slow, mode, isRetention, sessionId, now) {
  const dk = dayKey(now);
  if (ok) {
    if (!s.days.includes(dk)) s.days.push(dk);
    if (!s.sess.includes(sessionId)) s.sess.push(sessionId);
    if (GENERATIVE.has(mode)) s.gen = true;
    if (isRetention) s.ret = true;
    s.cc += 1;
    if (slow) { s.shaky = true; return "slow"; }         // correct-but-slow never promotes
    if (s.st === 3) {
      // recovery is easy: 2 consecutive correct across 2 sessions on different days
      if (s.cc >= 2 && s.days.length >= 2 && s.sess.length >= 2) {
        s.st = 2; s.cycles += 1; s.shaky = false; resetRun(s); return "recovered";
      }
    } else if (s.st !== 2) {
      s.st = 1;
      // mastery is hard: 3 consecutive, 2+ days, 2+ sessions, one retention, one generative
      if (s.cc >= 3 && s.days.length >= 2 && s.sess.length >= 2 && s.gen && s.ret) {
        s.st = 2; s.shaky = false; resetRun(s); return "mastered";
      }
    } else if (s.shaky) { s.shaky = false; return "steadied"; }
    return null;
  }
  // a miss
  s.cc = 0; resetRun(s);
  s.miss = s.miss.filter(t => now - t < 30 * DAY); s.miss.push(now);
  if (s.st === 2) {
    if (s.miss.length >= 2) { s.st = 3; s.decays += 1; s.shaky = false; return "decayed"; }
    s.shaky = true; return "shaky";
  }
  if (s.st !== 3) s.st = 1;
  return null;
}
function resetRun(s) { s.days = []; s.sess = []; s.gen = false; s.ret = false; }
const isConceptGap = s => s.cycles >= 3;

/* ── recording an attempt ───────────────────────────────────────────────── */
function record(conceptId, mode, correctness, ms, tags, precision) {
  const now = Date.now(), s = st(conceptId);
  const gapH = s.last ? (now - s.last) / 3600000 : 0;
  const isRetention = s.last > 0 && gapH >= 24;
  const target = (byId[conceptId] && byId[conceptId].t) || TARGET[mode] || 60;
  const ok = correctness === 2, slow = ok && ms > 2 * target * 1000;
  const sameDay = s.last > 0 && dayKey(s.last) === dayKey(now);

  const event = applyMastery(s, ok, slow, mode, isRetention, S.session ? S.session.id : "adhoc", now);
  schedule(s, quality(correctness, ms, target), sameDay);
  s.last = now; s.seen += 1;

  const a = [Math.round(now / 1000), conceptId, mode, correctness, Math.round(ms),
             Math.round(gapH), (tags || []).join(","), precision == null ? -1 : precision];
  S.recent.push(a); if (S.recent.length > 600) S.recent.shift();
  if (S.session) {
    S.session.attempts.push(a);
    if (event) S.session.events.push({id: conceptId, event, at: now});
    if (!ok) S.session.requeue.push(conceptId);          // missed items return this session
  }
  if (S.session && S.session.adaptive) {            // escalate on a hit, drop back on a miss
    const ar = byId[conceptId] ? byId[conceptId].area : null;
    if (ar && S.session.level[ar] != null) {
      S.session.level[ar] = Math.max(1, Math.min(5, S.session.level[ar] + (ok ? 0.8 : -1.0)));
    }
  }
  markDirty("sched:" + shardOf(conceptId)); markDirty("stats"); markDirty("session");
  return {event, isRetention, slow, target};
}

/* ── readiness score ────────────────────────────────────────────────────── */
function readiness() {
  const R = S.recent;
  if (R.length < 12) return null;
  let aw = 0, an = 0;
  R.forEach((a, i) => {                                   // weighted toward recent attempts
    const w = Math.exp((i - R.length) / 120);
    aw += w * (a[3] / 2); an += w;
  });
  const accuracy = an ? aw / an : 0;

  const ret = R.filter(a => a[5] >= 24);
  const retention = ret.length ? ret.reduce((x, a) => x + a[3] / 2, 0) / ret.length : null;

  const good = R.filter(a => a[3] === 2);
  const speed = good.length ? good.reduce((x, a) => {
    const t = ((byId[a[1]] && byId[a[1]].t) || TARGET[a[2]] || 60) * 1000;
    return x + Math.min(1, t / Math.max(a[4], 1));
  }, 0) / good.length : null;

  const prec = R.filter(a => a[7] >= 0);
  const precision = prec.length ? prec.reduce((x, a) => x + a[7], 0) / prec.length : null;

  // An unmeasured component contributes nothing and its weight is not redistributed, so
  // the headline cannot be inflated by simply never attempting the modes that measure it.
  const parts = [[accuracy, 40], [retention, 25], [speed, 20], [precision, 15]];
  const score = parts.reduce((x, [v, w]) => x + (v == null ? 0 : v * w), 0);
  return {score: Math.round(score), accuracy, retention, speed, precision,
          measured: parts.filter(p => p[0] != null).reduce((x, p) => x + p[1], 0)};
}

function areaBreakdown() {
  const out = {};
  for (const k of AREAS_K) out[k] = {mastered: 0, shaky: 0, decayed: 0, learning: 0, untested: 0, gaps: 0, total: 0};
  for (const c of CONCEPTS) {
    if (S.meta.bank === "400" && !c.in400) continue;
    const o = out[c.area], s = S.sched[c.id];
    o.total++;
    if (!s || s.st === 0) o.untested++;
    else if (s.st === 3) o.decayed++;
    else if (s.st === 2) { o.mastered++; if (s.shaky) o.shaky++; }
    else o.learning++;
    if (s && isConceptGap(s)) o.gaps++;
  }
  return out;
}

/* ── the pool, the queue, and the session ───────────────────────────────── */
function pool(modeFilter) {
  return CONCEPTS.filter(c => {
    if (S.meta.bank === "400" && !c.in400) return false;
    if (modeFilter && !c.modes.includes(modeFilter)) return false;
    return true;
  });
}
function pickMode(c, preferred) {
  if (preferred && c.modes.includes(preferred)) return preferred;
  // Definitional modes are weighted up: the confirmed weak layer is definitions, not mechanics.
  const order = ["def", "grid", "frq", "calc", "mc", "binary", "card"];
  const have = order.filter(m => c.modes.includes(m));
  const weights = have.map(m => (m === "def" ? 3 : m === "frq" ? 2 : m === "card" ? 0.5 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < have.length; i++) { r -= weights[i]; if (r <= 0) return have[i]; }
  return have[have.length - 1];
}
function retentionCandidates() {
  const now = Date.now();
  return CONCEPTS
    .filter(c => (S.meta.bank !== "400" || c.in400) && S.sched[c.id] && S.sched[c.id].last)
    .map(c => ({c, s: S.sched[c.id], gap: (now - S.sched[c.id].last) / 3600000}))
    .filter(x => x.gap >= 24)
    .sort((a, b) => {                     // decayed first, then most overdue
      const rank = x => (x.s.st === 3 ? 0 : x.s.shaky ? 1 : 2);
      return rank(a) - rank(b) || b.gap - a.gap;
    });
}
function interleave(items) {
  // No two consecutive items from the same area (spec §7, per Agent 2 on interleaving).
  const out = [], buckets = {};
  items.forEach(it => (buckets[it.c.area] = buckets[it.c.area] || []).push(it));
  let last = null;
  while (out.length < items.length) {
    const keys = Object.keys(buckets).filter(k => buckets[k].length);
    if (!keys.length) break;
    const pickFrom = keys.filter(k => k !== last);
    const k = (pickFrom.length ? pickFrom : keys)
      .sort((a, b) => buckets[b].length - buckets[a].length)[0];
    out.push(buckets[k].shift()); last = k;
  }
  return out;
}
function buildQueue(n, modeFilter) {
  const today = epochDay(Date.now());
  const p = pool(modeFilter);
  const due = [], fresh = [];
  for (const c of p) {
    const s = S.sched[c.id];
    if (!s || !s.last) fresh.push(c);
    else if (s.due <= today || s.st === 3 || s.shaky) due.push(c);
  }
  due.sort((a, b) => {
    const sa = S.sched[a.id], sb = S.sched[b.id];
    return (sa.st === 3 ? 0 : 1) - (sb.st === 3 ? 0 : 1) || sa.due - sb.due;
  });
  fresh.sort((a, b) => a.d - b.d);
  const items = [];
  for (const c of due) { if (items.length >= n) break; items.push({c, mode: pickMode(c, modeFilter)}); }
  for (const c of fresh) { if (items.length >= n) break; items.push({c, mode: pickMode(c, modeFilter), isNew: true}); }
  return interleave(items);
}

function startSession(opts) {
  const o = opts || {};
  // In a single-mode session the openers must honour that mode too, or "Binary" opens with
  // five free-response items. Only concepts that actually carry the mode are eligible.
  const openers = retentionCandidates()
    .filter(x => !o.mode || x.c.modes.includes(o.mode))
    .slice(0, 5)
    .map(x => ({c: x.c, mode: pickMode(x.c, o.mode), retention: true}));
  const rest = buildQueue((o.n || 24) - openers.length, o.mode)
    .filter(it => !openers.some(x => x.c.id === it.c.id));
  S.session = {
    id: uid(), startedAt: Date.now(), mode: o.mode || null, bank: S.meta.bank,
    queue: openers.concat(rest), i: 0, attempts: [], events: [], requeue: [],
    openerCount: openers.length, fatigueWarned: false, breakAt: Date.now() + 25 * 60000,
    readinessBefore: (readiness() || {}).score ?? null,
  };
  markDirty("session");
}
function sessionDoc() {
  const s = S.session;
  return {id: s.id, startedAt: s.startedAt, endedAt: s.endedAt || null, bank: s.bank,
          mode: s.mode, attempts: s.attempts, events: s.events,
          readinessBefore: s.readinessBefore, readinessAfter: s.readinessAfter ?? null};
}
function current() {
  const s = S.session;
  if (!s) return null;
  if (s.adaptive && s.i >= s.queue.length && s.queue.length < s.target) {
    const nx = nextDiagnosticItem();
    if (nx) s.queue.push(nx);
  }
  if (s.i < s.queue.length) return s.queue[s.i];
  while (s.requeue.length) {                    // missed items return within the session
    const id = s.requeue.shift(), c = byId[id];
    if (!c) continue;
    if (s.mode && !c.modes.includes(s.mode)) continue;   // keep a single-mode session single-mode
    s.queue.push({c, mode: pickMode(c, s.mode), again: true});
    return s.queue[s.i];
  }
  return null;
}
function advance() { S.session.i++; render(); }

/* ── model grading ──────────────────────────────────────────────────────── */
const ERROR_PROFILE = `The person answering has these confirmed recurring errors. Penalise each one
even when the conclusion is correct, and name it explicitly in your feedback when it appears:
1. CFI vs CFF inversion - classifying on the noun (bonds, stock, securities) rather than the verb.
   Bought/sold is investing. Issued/repaid is financing. Capitalised costs are investing.
2. Accrued and deferred items placed on the wrong side of the balance sheet, almost always calling
   a liability an asset (accrued compensation, accrued expenses, accrued interest, deferred revenue).
3. Reasons toward a definition instead of stating it. A definition should be a formula or a
   category, not a description of what the item is for.
4. States levels instead of deltas - "net income of $7.50" instead of "net income falls by $7.50".
   Every figure in a walkthrough is a change.
5. Names the wrong statement mid-walkthrough, e.g. "net income flows to the top of the balance sheet".
6. Says "net income" for retained earnings on the balance sheet. There is no net income line there.
7. Drops the closing balance check - a walkthrough that never confirms both sides move together.
8. Direction inversion: right inputs, wrong read.
9. Confuses equity value and enterprise value in transactions. Funding source drives equity value;
   cash movement drives enterprise value.`;

async function gradeText(concept, mode, answer) {
  if (!S.sample) return null;
  const prompt = `You are grading one answer to an investment banking interview question. Be strict:
this is preparation for an Evercore first round, not an exam to be passed.

${ERROR_PROFILE}

QUESTION:
${concept.q}

REFERENCE ANSWER (from the candidate's own study guide):
${(concept.a || "").slice(0, 2600)}

RUBRIC - the elements a complete answer contains:
${(concept.rub || []).map((r, i) => `${i + 1}. ${r}`).join("\n")}

THE CANDIDATE'S ANSWER:
${answer.slice(0, 4000)}

Reply with only a JSON object:
{"correctness":0|1|2, "precision":0.0-1.0, "hit":[rubric numbers covered],
 "missed":["short phrase naming each rubric element not covered"],
 "errors":["CFI_CFF"|"BS_SIDE"|"DEFINITIONAL"|"LEVEL_NOT_DELTA"|"WRONG_STATEMENT"|"NI_FOR_RE"|"NO_BALANCE_CHK"|"DIRECTION"|"EV_VS_EQV"],
 "feedback":"two or three sentences, addressed to the candidate, naming what to fix"}
correctness: 2 = conclusion and mechanism both right, 1 = partially right, 0 = wrong or absent.
precision is language quality alone: dock it for levels-instead-of-deltas, a wrongly named statement,
"net income" used for retained earnings, and a missing balance check, even when the logic is right.`;
  try {
    const r = await S.sample.json(prompt, {modelTier: mode === "def" ? "quick" : "default"});
    return {
      correctness: Math.max(0, Math.min(2, Number(r.correctness) || 0)),
      precision: Math.max(0, Math.min(1, Number(r.precision) || 0)),
      missed: Array.isArray(r.missed) ? r.missed : [],
      errors: Array.isArray(r.errors) ? r.errors.filter(e => ERROR_TAGS[e]) : [],
      feedback: String(r.feedback || ""),
    };
  } catch (e) {
    return {failed: true, code: e && e.code};
  }
}


/* ── the guide's teaching, shown only after an answer ────────────────────
   620k characters of BIWS Key Rules, Core Concepts and debt reference. Loaded lazily,
   and never reachable before submitting: reading is the thing this tool replaces. */
let REF_LOADED = null;
function loadReference() {
  if (REF_LOADED) return REF_LOADED;
  REF_LOADED = new Promise(res => {
    if (typeof REFERENCE !== "undefined") return res(true);
    // Behind the gate the reference is ciphertext, so the gate hands us a loader that
    // holds the key. Unencrypted hosts (the artifact) just fetch the plain file.
    if (typeof window.__loadReference === "function") return res(window.__loadReference());
    const sc = document.createElement("script");
    sc.src = "reference.js";
    sc.onload = () => res(true);
    sc.onerror = () => res(false);
    document.head.appendChild(sc);
  });
  return REF_LOADED;
}
const REF_STOP = new Set(("a an the of to in for on at by with and or is are be do does how what why which "
  + "when who this that it its as from into if then than so you your we our can could would should will "
  + "not no yes about more most other some any each between over under all both few many much such only "
  + "same too very just also have has had was were being").split(" "));
const refToks = t => new Set(String(t).toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/)
  .filter(w => w.length > 2 && !REF_STOP.has(w)));
function refMatches(c, limit) {
  if (typeof REFERENCE === "undefined") return [];
  const q = refToks(c.q + " " + (c.tags || []).join(" "));
  return REFERENCE.map(r => {
    const title = refToks(r.title);
    let score = 0;
    title.forEach(w => { if (q.has(w)) score += 3; });
    const head = refToks(r.text.slice(0, 1800));
    q.forEach(w => { if (head.has(w)) score += 1; });
    if (r.area === c.area) score += 4;
    return {r, score};
  }).filter(x => x.score >= 6).sort((a, b) => b.score - a.score).slice(0, limit || 3).map(x => x.r);
}
function refBlock(c) {
  const hits = refMatches(c, 3);
  if (!hits.length) return `<p class="mut">No matching section in the guide's teaching content.</p>`;
  return hits.map(r => `<details><summary><b>${esc(r.module)}</b> \u00b7 ${esc(r.title)}
      <span class="mut">${(r.chars / 1000).toFixed(0)}k</span></summary>
    <div class="ansbox" style="margin-top:var(--s2);max-height:460px;overflow-y:auto">${
      esc(r.text).replace(/\n/g, "<br>")}</div></details>`).join("");
}

/* ── view helpers ───────────────────────────────────────────────────────── */
const V = () => document.getElementById("view");
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
const money = n => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n * 100) / 100);
function h(html) { const d = document.createElement("div"); d.innerHTML = html; return d; }
function applyTheme() {
  // Cream is the default, not the OS preference. Positive polarity reads measurably faster
  // over long sessions, and Times New Roman's hairline serifs bloom badly on a dark ground.
  const t = S.meta.theme || "light";
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
let timerStart = 0;
let keyHandler = null;      // set by the live renderer; cleared when the item changes
document.addEventListener("keydown", e => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  if (keyHandler) keyHandler(e);
});
const startTimer = () => (timerStart = performance.now());
const elapsed = () => performance.now() - timerStart;

function sessionChrome() {
  const s = S.session; if (!s) return "";
  const mins = (Date.now() - s.startedAt) / 60000;
  let warn = "";
  if (mins >= 180 && !s.fatigueWarned) {
    warn = `<div class="banner"><b>Three hours in.</b> Your recorded fatigue pattern starts here:
      inventing figures that were not in the question, and mislabelling balance sheet sides while the
      mechanics stay correct. Anything you answer from now on is worth less than a break.</div>`;
  }
  const dots = s.queue.map((q, i) => {
    const a = s.attempts.find(x => x[1] === q.c.id);
    const cls = i === s.i ? "now" : (i < s.i ? (a && a[3] === 2 ? "done" : "miss") : "");
    return `<i class="${cls}"></i>`;
  }).join("");
  const openers = s.openerCount && s.i < s.openerCount
    ? `<span class="tag">Retention opener ${s.i + 1} of ${s.openerCount}</span>` : "";
  return warn + `<div id="dots">${dots}</div>
    <div class="sb" style="margin-bottom:var(--s4)">
      <div class="mut">${s.i} of ${s.queue.length} answered ${openers}</div>
      <div class="mut">${Math.floor(mins)} min</div>
    </div>`;
}

/* ── mode renderers ─────────────────────────────────────────────────────── */
function renderItem(item) {
  const c = item.c, mode = item.mode;
  const head = `<div class="sb"><div class="mut">${esc(AREAS[c.area])} · ${esc(MODE_NAME[mode])}</div>
    <div class="mut">${item.retention ? "Retention check" : item.again ? "Again" : c.in400 ? "The 400" : "Full bank"}</div></div><hr>`;
  const f = {binary: rBinary, card: rCard, def: rText, frq: rText, mc: rMC, calc: rCalc,
             grid: rGrid, spoken: rSpoken}[mode] || rCard;
  keyHandler = null;
  V().innerHTML = sessionChrome() + head + `<div id="item"></div>`;
  f(c, mode);
  startTimer();
}

function feedback(c, res, extra) {
  const tagLine = (res.errors || []).length
    ? `<p class="mut2">Flagged: ${res.errors.map(e => `<span class="tag bad">${esc(ERROR_TAGS[e].n)}</span>`).join(" ")}</p>` : "";
  const ev = res.event ? `<p class="${res.event === "decayed" ? "bad" : res.event === "mastered" || res.event === "recovered" ? "ok" : "warn"}">
      ${esc(eventCopy(res.event, c))}</p>` : "";
  const slow = res.slow ? `<p class="warn">Correct, but ${(res.ms / 1000).toFixed(0)}s against a ${res.target}s target — counted as shaky, not mastered.</p>` : "";
  return `<hr>${ev}${slow}${tagLine}${extra || ""}
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="next">Next</button>
      <button class="g" id="showref">Show the guide's answer</button>
      <button class="g" id="showteach">What the guide teaches</button>
    </div>
    <div id="teach" hidden></div>
    <div id="ref" hidden><hr><div class="ansbox">${esc(c.a).replace(/•/g, "<br>•")}</div>
      ${c.obj ? `<div class="obj"><b>Objective.</b> ${esc(c.obj)}</div>` : ""}
      ${(c.v || []).length ? `<p class="mut">Also asked as: ${esc(c.v[0].q)}</p>` : ""}</div>`;
}
function eventCopy(ev, c) {
  const n = c.tags && c.tags[0] ? ERROR_TAGS[c.tags[0]].n : "This item";
  return {
    decayed: `${n} — you had this, you've now missed it twice. Back in the queue.`,
    shaky: `Missed once. Still counted as mastered, but it is flagged shaky and comes back today.`,
    mastered: `Mastered — three correct across two sessions on different days, including a retention check and a generative answer.`,
    recovered: `Recovered from decayed. Two correct on two different days.`,
    steadied: `Shaky flag cleared.`,
    slow: `Correct but slow — held at shaky rather than promoted.`,
  }[ev] || "";
}
function wireNext(c) {
  const n = document.getElementById("next"); if (n) n.onclick = advance;
  const r = document.getElementById("showref");
  if (r) r.onclick = () => { document.getElementById("ref").hidden = false; r.disabled = true; };
  const t = document.getElementById("showteach");
  if (t) t.onclick = async () => {
    t.disabled = true;
    const box = document.getElementById("teach");
    box.hidden = false; box.innerHTML = `<hr><p class="mut">Loading the guide\u2026</p>`;
    const ok = await loadReference();
    box.innerHTML = "<hr>" + (ok ? refBlock(c) : `<p class="warn">Could not load the reference content.</p>`);
  };
}
function finish(c, mode, correctness, tags, precision, extra) {
  const ms = elapsed();
  const res = record(c.id, mode, correctness, ms, tags, precision);
  res.errors = tags; res.ms = ms;
  document.getElementById("item").insertAdjacentHTML("beforeend", feedback(c, res, extra));
  wireNext(c);
}

function rBinary(c) {
  const b = c.binary;
  const target = TARGET.binary;
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(b.p)}</p>
    <div class="binwrap">
      <button class="bigbtn" data-i="0">${esc(b.a)}<span class="kbd">1</span></button>
      <button class="bigbtn" data-i="1">${esc(b.b)}<span class="kbd">2</span></button>
    </div>
    <div class="binmeta">
      <span>Press 1 or 2. Target ${target}s.</span>
      <span class="lat" id="lat"></span>
    </div>
    <div id="fb"></div>`;

  const btns = [...V().querySelectorAll(".bigbtn")];
  const tick = setInterval(() => {
    const el = document.getElementById("lat");
    if (el) el.textContent = (elapsed() / 1000).toFixed(1) + "s";
  }, 100);

  const answer = pick => {
    if (btns[0].disabled) return;
    clearInterval(tick);
    const ms = elapsed(), ok = pick === b.c;
    btns.forEach((x, i) => {
      x.disabled = true;
      if (i === b.c) x.classList.add("right");
      else if (i === pick) x.classList.add("wrong");
      else x.classList.add("dim");
    });
    const lat = document.getElementById("lat");
    lat.textContent = (ms / 1000).toFixed(1) + "s";
    lat.className = "lat " + (ms < target * 1000 ? "fast" : ms > target * 2000 ? "slow" : "");
    document.getElementById("fb").innerHTML = `
      <div class="verdict ${ok ? "ok" : "bad"}">
        <span class="vmark">${ok ? "✓" : "✗"}</span>
        <div><b>${ok ? "Correct." : "Wrong."}</b> ${esc(b.why || "")}</div>
      </div>`;
    timerStart = performance.now() - ms;
    finish(c, "binary", ok ? 2 : 0, ok ? [] : (c.tags || []).slice(0, 1), null);
  };

  btns.forEach(btn => btn.onclick = () => answer(+btn.dataset.i));
  keyHandler = e => {
    if (e.key === "1" || e.key === "ArrowLeft") { e.preventDefault(); answer(0); }
    else if (e.key === "2" || e.key === "ArrowRight") { e.preventDefault(); answer(1); }
    else if (e.key === "Enter" || e.key === " ") {
      const n = document.getElementById("next");
      if (n) { e.preventDefault(); n.click(); }
    }
  };
}

function rMC(c) {
  const m = c.mc, LETTERS = ["A", "B", "C", "D", "E", "F"];
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(m.p || c.q)}</p>
    <div id="opts">${m.o.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="mk">${LETTERS[i]}</span>${esc(o)}</button>`).join("")}</div>
    <p class="mut">Press ${m.o.map((_, i) => LETTERS[i]).join(", ")} or click.</p>
    <div id="fb"></div>`;

  const opts = [...V().querySelectorAll(".opt")];
  const answer = pick => {
    if (opts[0].disabled) return;
    const ok = pick === m.c;
    opts.forEach((x, i) => {
      x.disabled = true;
      if (i === m.c) x.classList.add("right");
      else if (i === pick) x.classList.add("wrong");
    });
    const why = m.why || [];
    // The explanation covers the option actually chosen, not only the correct one.
    document.getElementById("fb").innerHTML = `
      <div class="verdict ${ok ? "ok" : "bad"}">
        <span class="vmark">${ok ? "✓" : "✗"}</span>
        <div>${ok ? "" : `<p><b>${LETTERS[pick]} — your answer.</b> ${esc(why[pick] || "")}</p>`}
          <p><b>${LETTERS[m.c]} — correct.</b> ${esc(why[m.c] || "")}</p></div>
      </div>`;
    finish(c, "mc", ok ? 2 : 0, ok ? [] : [m.t && m.t[pick]].filter(Boolean), null);
  };
  opts.forEach(btn => btn.onclick = () => answer(+btn.dataset.i));
  keyHandler = e => {
    const i = LETTERS.indexOf(e.key.toUpperCase());
    if (i >= 0 && i < m.o.length) { e.preventDefault(); answer(i); }
    else if (e.key === "Enter") {
      const n = document.getElementById("next");
      if (n) { e.preventDefault(); n.click(); }
    }
  };
}

function rCalc(c) {
  const q = c.calc;
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(q.p)}</p>
    <div class="row" style="margin-top:var(--s4);max-width:420px">
      <input type="number" step="any" id="ans" placeholder="Answer${q.unit ? " in " + q.unit : ""}" autocomplete="off">
      <button class="b" id="sub">Submit</button>
    </div><p class="mut">Work it on paper first. No calculator — that is the point.</p><div id="fb"></div>`;
  const go = () => {
    const raw = document.getElementById("ans").value;
    if (raw === "") return;
    const v = parseFloat(raw), ok = Math.abs(v - q.ans) <= (q.tol || 0.01);
    document.getElementById("ans").disabled = true; document.getElementById("sub").disabled = true;
    document.getElementById("fb").innerHTML = `<hr>
      <p class="${ok ? "ok" : "bad"}"><b>${ok ? "Correct." : "Wrong."}</b> The answer is
        ${esc(String(q.ans))}${esc(q.unit || "")}${ok ? "" : `, you said ${esc(raw)}${esc(q.unit || "")}`}.</p>
      <div class="obj">${esc(q.work || "")}</div>`;
    finish(c, "calc", ok ? 2 : 0, ok ? [] : (c.tags || []).slice(0, 1), null);
  };
  document.getElementById("sub").onclick = go;
  document.getElementById("ans").onkeydown = e => { if (e.key === "Enter") go(); };
  document.getElementById("ans").focus();
}

function rCard(c) {
  const front = c.def ? c.def.term : c.q;
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(front)}</p>
    <p class="mut">Say the answer out loud before you turn it over. Turning it over first is re-reading.</p>
    <button class="b" id="flip" style="margin-top:var(--s3)">Turn over</button>
    <div id="back" hidden></div>`;
  document.getElementById("flip").onclick = () => {
    const ms = elapsed();
    document.getElementById("flip").hidden = true;
    // Self-grade against the rubric's components, not a bare "I knew it" - that is the
    // fluency illusion this mode is otherwise most exposed to.
    document.getElementById("back").hidden = false;
    document.getElementById("back").innerHTML = `<hr>
      <div class="ansbox">${esc(c.a).replace(/•/g, "<br>•")}</div>
      <hr><p><b>Which of these did you actually produce?</b></p>
      ${(c.rub || []).map((r, i) => `<label class="ckrow"><input type="checkbox" data-i="${i}"> <span>${esc(r)}</span></label>`).join("")}
      <button class="b" id="gr" style="margin-top:var(--s3)">Score it</button><div id="fb"></div>`;
    document.getElementById("gr").onclick = () => {
      const boxes = [...document.querySelectorAll('#back input[type=checkbox]')];
      const hit = boxes.filter(b => b.checked).length, total = boxes.length || 1;
      const frac = hit / total;
      const correctness = frac >= 0.8 ? 2 : frac >= 0.4 ? 1 : 0;
      timerStart = performance.now() - ms;
      document.getElementById("gr").disabled = true;
      finish(c, "card", correctness, correctness === 2 ? [] : (c.tags || []).slice(0, 1), null,
        `<p class="mut2">${hit} of ${total} rubric elements.</p>`);
    };
  };
}

function rText(c, mode) {
  const isDef = mode === "def";
  const prompt = isDef && c.def ? `Define: ${c.def.term}` : c.q;
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(prompt)}</p>
    <textarea id="ta" rows="${isDef ? 5 : 10}" placeholder="Type your answer. Produce it before you look at anything."></textarea>
    <div class="row" style="margin-top:var(--s3)">
      <button class="b" id="sub" disabled>Submit for grading</button>
      <button class="g" id="cant">I cannot produce this</button>
      <span class="mut" id="cnt">0 characters</span>
    </div><div id="fb"></div>`;
  const ta = document.getElementById("ta"), sub = document.getElementById("sub");
  ta.oninput = () => {
    document.getElementById("cnt").textContent = ta.value.length + " characters";
    sub.disabled = ta.value.trim().length < 40;     // generation floor
  };
  ta.focus();
  document.getElementById("cant").onclick = () => {
    ta.disabled = sub.disabled = true; document.getElementById("cant").disabled = true;
    finish(c, mode, 0, (c.tags || []).slice(0, 1), 0,
      `<p class="bad">Logged as a hard failure. That is the honest entry — it schedules the item tightly.</p>`);
  };
  sub.onclick = async () => {
    const ms = elapsed(), text = ta.value;
    ta.disabled = sub.disabled = true; document.getElementById("cant").disabled = true;
    const fb = document.getElementById("fb");
    fb.innerHTML = `<hr><p class="mut">Grading…</p>`;
    // Claude grades it where a model is available; otherwise the local fuzzy grader does,
    // which is the case on the static host. Both return the same shape.
    const modelResult = S.sample ? await gradeText(c, mode, text) : null;
    const r = (!modelResult || modelResult.failed) ? gradeLocal(c, mode, text) : modelResult;
    timerStart = performance.now() - ms;

    const verdict = r.correctness === 2 ? "Complete" : r.correctness === 1 ? "Partial" : "Not there";
    const cls = r.correctness === 2 ? "ok" : r.correctness === 1 ? "warn" : "bad";
    fb.innerHTML = `<hr>
      <div class="verdict ${cls}">
        <span class="vmark">${r.correctness === 2 ? "\u2713" : r.correctness === 1 ? "\u2013" : "\u2717"}</span>
        <div>
          <b>${verdict}.</b> Precision ${Math.round(r.precision * 100)}%.
          <div class="mut">${r.local ? "Graded on this device against the rubric" : "Graded by Claude"}</div>
        </div>
      </div>
      <p class="ansbox">${esc(r.feedback)}</p>
      ${(r.notes || []).length > 1 ? `<ul class="notes">${r.notes.slice(1).map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${(r.hit || []).length ? `<p class="lblsm ok">Covered</p><ul class="rubl ok">${
        r.hit.map(x => `<li>${esc(x.length > 120 ? x.slice(0, 120) + "\u2026" : x)}</li>`).join("")}</ul>` : ""}
      ${(r.missed || []).length ? `<p class="lblsm bad">Missing</p><ul class="rubl bad">${
        r.missed.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
    finish(c, mode, r.correctness, r.errors, r.precision);
  };
}

/* ── the three-statement grid (spec §3, the centrepiece) ────────────────── */
function expand(sc) {
  const agg = {};
  for (const [tpl, amt] of sc.steps) {
    for (const [stmt, line, delta, section, side, why] of TEMPLATES[tpl].cells(amt, sc.t)) {
      const k = stmt + "|" + line;
      if (!agg[k]) agg[k] = {stmt, line, delta: 0, section, side, why: []};
      agg[k].delta += delta;
      if (why) agg[k].why.push(why);
    }
  }
  return agg;
}
function scenarioLabel(sc) {
  const parts = sc.steps.map(([tpl, amt], i) => {
    const l = TEMPLATES[tpl].label(amt);
    // keep the subject on later clauses: "Depreciation increases by $20; and the company
    // accrues $30..." rather than a dangling "and accrues $30...".
    return i === 0 ? l : l.replace(/^([A-Z])/, m => m.toLowerCase());
  });
  const joined = parts.length > 1
    ? parts.slice(0, -1).join("; ") + "; and " + parts[parts.length - 1]
    : parts[0];
  return joined + `. Tax rate ${Math.round(sc.t * 100)}%.`;
}
function rGrid(c) {
  const pick = c.gridScenario || SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const sc = typeof pick === "string" ? SCENARIOS.find(x => x.id === pick) || SCENARIOS[0] : pick;
  const exp = expand(sc);
  const rows = (stmt, lines) => lines.map(l => {
    const k = stmt + "|" + l;
    return `<tr data-k="${esc(k)}">
      <td>${esc(l)}</td>
      <td><input type="number" step="any" class="d" placeholder="0" aria-label="Change in ${esc(l)}"></td>
      ${stmt === "CFS" ? `<td><select class="sec" aria-label="Section for ${esc(l)}">
          <option value="">section…</option><option>CFO</option><option>CFI</option><option>CFF</option></select></td>` : ""}
      ${stmt === "BS" ? `<td><select class="side" aria-label="Side for ${esc(l)}">
          <option value="">side…</option><option value="asset">Asset</option>
          <option value="liability">Liability</option><option value="equity">Equity</option></select></td>` : ""}
      <td class="fb mut"></td></tr>`;
  }).join("");
  document.getElementById("item").innerHTML = `
    <p class="stem"><b>${esc(scenarioLabel(sc))}</b></p>
    <p class="mut">Enter the change for every line that moves. Leave a line blank to assert it does not change.
       Every cash flow line needs its section and every balance sheet line needs its side.</p>
    <h3 style="margin-top:var(--s4)">Income statement</h3>
    <table class="gridtbl"><thead><tr><th>Line</th><th>Change</th><th></th></tr></thead><tbody id="tIS">${rows("IS", IS_LINES)}</tbody></table>
    <h3 style="margin-top:var(--s4)">Cash flow statement</h3>
    <table class="gridtbl"><thead><tr><th>Line</th><th>Change</th><th>Section</th><th></th></tr></thead><tbody id="tCFS">${rows("CFS", CFS_LINES)}</tbody></table>
    <h3 style="margin-top:var(--s4)">Balance sheet</h3>
    <table class="gridtbl"><thead><tr><th>Line</th><th>Change</th><th>Side</th><th></th></tr></thead><tbody id="tBS">${rows("BS", BS_LINES)}</tbody></table>
    <hr class="hv">
    <h3>Does it balance?</h3>
    <p class="mut">Add up your own two sides and enter the <em>change</em> in each. The tool will not
       total your figures for you, and it will not say whether they agree until you submit.</p>
    <div class="balrow">
      <label class="fieldlab">Change in total assets
        <input type="number" step="any" id="balA" placeholder="0"></label>
      <label class="fieldlab">Change in liabilities + equity
        <input type="number" step="any" id="balL" placeholder="0"></label>
      <button class="g" id="runbal">Run the balance check</button>
    </div>
    <div id="balfb"></div>
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="sub" disabled>Submit</button>
      <span class="mut" id="subnote">Run the balance check first.</span>
    </div><div id="fb"></div>`;

  let balanceRun = false, balA = null, balL = null;
  document.getElementById("runbal").onclick = () => {
    const a = document.getElementById("balA").value, l = document.getElementById("balL").value;
    if (a === "" || l === "") {
      document.getElementById("balfb").innerHTML = `<p class="warn">Enter both sides first.</p>`;
      return;
    }
    balanceRun = true; balA = parseFloat(a); balL = parseFloat(l);
    document.getElementById("balfb").innerHTML = Math.abs(balA - balL) < 0.005
      ? `<p class="ok">Your two sides agree at ${money(balA)}. Whether that is the <em>right</em>
         figure is checked when you submit.</p>`
      : `<p class="warn">Your sides disagree by ${money(balA - balL)}. You can still submit, but a
         real walkthrough would stop here and find it.</p>`;
    document.getElementById("sub").disabled = false;
    document.getElementById("subnote").textContent = "";
  };

  document.getElementById("sub").onclick = () => {
    const errs = new Set(); let right = 0, wrong = 0;
    V().querySelectorAll("tbody tr").forEach(tr => {
      const k = tr.dataset.k, e = exp[k];
      const dEl = tr.querySelector(".d"), secEl = tr.querySelector(".sec"), sideEl = tr.querySelector(".side");
      const given = dEl.value === "" ? 0 : parseFloat(dEl.value);
      const want = e ? e.delta : 0;
      const valOK = Math.abs(given - want) < 0.005;
      let secOK = true, sideOK = true;
      if (secEl) { const v = secEl.value; secOK = want === 0 ? true : v === e.section; if (!secOK) errs.add("CFI_CFF"); }
      if (sideEl) { const v = sideEl.value; sideOK = want === 0 ? true : v === e.side; if (!sideOK) errs.add("BS_SIDE"); }
      const cellOK = valOK && secOK && sideOK;
      if (want !== 0 || given !== 0) { cellOK ? right++ : wrong++; }
      dEl.disabled = true; if (secEl) secEl.disabled = true; if (sideEl) sideEl.disabled = true;
      if (!cellOK) {
        if (!valOK) dEl.classList.add("cellbad");
        if (!secOK) secEl.classList.add("cellbad");
        if (!sideOK) sideEl.classList.add("cellbad");
        const bits = [];
        if (!valOK) bits.push(`should be ${want === 0 ? "no change" : money(want)}`);
        if (!secOK) bits.push(`section is ${e.section}`);
        if (!sideOK) bits.push(`${e.side} side`);
        tr.querySelector(".fb").innerHTML = `<span class="bad">${esc(bits.join("; "))}.</span>
          ${e && e.why.length ? " " + esc(e.why[0]) : ""}`;
      } else if (want !== 0) {
        dEl.classList.add("cellok"); tr.querySelector(".fb").innerHTML = `<span class="ok">✓</span>`;
      }
    });
    const bs = Object.values(exp).filter(x => x.stmt === "BS");
    const trueA = bs.filter(x => x.side === "asset").reduce((a, x) => a + x.delta, 0);
    const trueL = bs.filter(x => x.side !== "asset").reduce((a, x) => a + x.delta, 0);
    const balOK = balanceRun && Math.abs(balA - trueA) < 0.005 && Math.abs(balL - trueL) < 0.005;
    if (!balOK) errs.add("NO_BALANCE_CHK");
    document.getElementById("sub").disabled = true;
    document.getElementById("runbal").disabled = true;
    document.getElementById("balA").disabled = true;
    document.getElementById("balL").disabled = true;
    const total = right + wrong;
    const correctness = wrong === 0 && balOK ? 2 : (right > wrong ? 1 : 0);
    document.getElementById("fb").innerHTML = `<hr>
      <p class="${correctness === 2 ? "ok" : correctness === 1 ? "warn" : "bad"}">
        <b>${right} of ${total} cells right.</b>
        ${balOK ? `Balance check correct: both sides move ${money(trueA)}.` : balanceRun
          ? `You had assets ${money(balA)} and liabilities plus equity ${money(balL)}; they should each be ${money(trueA)}.`
          : "You did not run the balance check."}</p>`;
    finish(c, "grid", correctness, [...errs], null);
  };
}

/* ── spoken check: real capture where the browser allows it, timer otherwise ── */
function rSpoken(c) {
  const target = c.t || 90;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  document.getElementById("item").innerHTML = `
    <p class="stem">${esc(c.q)}</p>
    <p class="mut">Target: ${target} seconds. Say it out loud, in full, as you would in the room.</p>
    <div class="row" style="margin-top:var(--s3)">
      <button class="b" id="rec">${SR ? "Start speaking" : "Start the timer"}</button>
      <button class="g" id="stop" disabled>Stop</button>
      <span class="score" id="clock" style="font-size:30px">0s</span>
    </div>
    <p class="mut" id="mode">${SR ? "Using the browser's speech recognition. If the microphone is refused this falls back to the timer."
      : "This browser has no speech recognition, so this is the timer fallback: speak aloud, then type back the answer you actually gave."}</p>
    <div id="cap" hidden style="margin-top:var(--s3)">
      <textarea id="ta" rows="8" placeholder="The transcript appears here. Correct it, or type what you said."></textarea>
      <div class="row" style="margin-top:var(--s3)"><button class="b" id="sub">Submit for grading</button></div>
    </div><div id="fb"></div>`;
  let t0 = 0, tick = null, rec = null, secs = 0;
  const clock = document.getElementById("clock");
  const stopAll = () => {
    clearInterval(tick); if (rec) { try { rec.stop(); } catch (e) {} }
    document.getElementById("stop").disabled = true;
    document.getElementById("cap").hidden = false;
    document.getElementById("ta").focus();
  };
  document.getElementById("rec").onclick = () => {
    t0 = Date.now(); document.getElementById("rec").disabled = true;
    document.getElementById("stop").disabled = false;
    tick = setInterval(() => {
      secs = Math.round((Date.now() - t0) / 1000);
      clock.textContent = secs + "s";
      clock.className = "score " + (secs > target * 1.5 ? "bad" : secs > target ? "warn" : "ok");
    }, 250);
    if (SR) {
      try {
        rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
        rec.onresult = e => {
          let s = "";
          for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
          document.getElementById("ta").value = s;
          document.getElementById("cap").hidden = false;
        };
        rec.onerror = ev => {
          document.getElementById("mode").innerHTML =
            `<span class="warn">Speech capture unavailable here (${esc(ev.error || "refused")}) — timer fallback: type back what you said.</span>`;
          rec = null;
        };
        rec.start();
      } catch (e) { rec = null; }
    }
  };
  document.getElementById("stop").onclick = stopAll;
  document.getElementById("sub").onclick = async () => {
    const text = document.getElementById("ta").value.trim();
    if (text.length < 40) { document.getElementById("fb").innerHTML = `<p class="warn">Type what you said first.</p>`; return; }
    document.getElementById("sub").disabled = true;
    document.getElementById("fb").innerHTML = `<hr><p class="mut">Grading…</p>`;
    timerStart = performance.now() - secs * 1000;     // score against spoken time, not typing time
    const modelResult = S.sample ? await gradeText(c, "spoken", text) : null;
    const r = (!modelResult || modelResult.failed) ? gradeLocal(c, "spoken", text) : modelResult;
    const overtime = secs > target * 1.5;
    document.getElementById("fb").innerHTML = `<hr>
      <p class="${r.correctness === 2 ? "ok" : r.correctness === 1 ? "warn" : "bad"}"><b>Content:
        ${r.correctness === 2 ? "complete" : r.correctness === 1 ? "partial" : "not there"}.</b>
        Precision ${Math.round(r.precision * 100)}%. Time ${secs}s against ${target}s${overtime ? " — too long for the room" : ""}.</p>
      <p class="ansbox">${esc(r.feedback)}</p>
      ${r.missed.length ? `<p class="mut2"><b>Missing:</b> ${r.missed.map(esc).join("; ")}</p>` : ""}`;
    finish(c, "spoken", overtime && r.correctness === 2 ? 1 : r.correctness, r.errors, r.precision);
  };
}

/* ── views ──────────────────────────────────────────────────────────────── */
function vSession() {
  const s = S.session, item = current();
  if (s && item) return renderItem(item);
  if (s && !item) return vSessionEnd();
  const due = buildQueue(999).length, ret = retentionCandidates().length;
  const r = readiness();
  V().innerHTML = `
    <div class="pagehead"><div class="eyebrow">Practice</div><h1>Session</h1></div>
    <p class="mut2" style="max-width:62ch">Every session opens with five retention items from earlier
      sessions before any new material. That is not a setting.</p>
    ${!S.persisted ? `<div class="banner">Progress storage is not available in this view, so nothing
      will be saved. Practice still works.</div>` : ""}
    <hr>
    <table style="max-width:460px">
      <tr><td>Retention items waiting</td><td class="num">${ret}</td></tr>
      <tr><td>Items due or flagged</td><td class="num">${due}</td></tr>
      <tr><td>Bank</td><td class="num">${S.meta.bank === "400" ? "The 400" : "Full bank"}</td></tr>
      <tr><td>Days to the interview</td><td class="num">${daysToInterview()}</td></tr>
      <tr><td>Longest interval right now</td><td class="num">${maxInterval()} days</td></tr>
    </table>
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="go">Start a session</button>
      <button class="g" id="go40">Long session (40)</button>
    </div>
    ${r ? `<hr><p class="mut">Readiness ${r.score}. ${decayNote()}</p>` : ""}`;
  document.getElementById("go").onclick = () => { startSession({n: 24}); render(); };
  document.getElementById("go40").onclick = () => { startSession({n: 40}); render(); };
}
function vSessionEnd() {
  const s = S.session;
  s.endedAt = Date.now();
  if (s.diag && !s.recorded) {
    s.recorded = true;
    const byArea = {};
    for (const at of s.attempts) {
      const c = byId[at[1]]; if (!c) continue;
      const o = byArea[c.area] || (byArea[c.area] = {n: 0, right: 0,
        level: s.level ? s.level[c.area] : 2.5});
      o.n++; if (at[3] === 2) o.right++;
    }
    S.meta.diagnostic = {at: Date.now(), byArea, total: s.attempts.length,
      correct: s.attempts.filter(x => x[3] === 2).length};
    markDirty("meta");
  }
  const r = readiness(); s.readinessAfter = r ? r.score : null;
  const ok = s.attempts.filter(a => a[3] === 2).length;
  const delta = (s.readinessBefore != null && s.readinessAfter != null) ? s.readinessAfter - s.readinessBefore : null;
  const evs = s.events.filter(e => ["mastered", "decayed", "recovered"].includes(e.event));
  markDirty("session"); flush();
  V().innerHTML = `
    <h1>Session complete</h1>
    <table style="max-width:460px">
      <tr><td>Answered</td><td class="num">${s.attempts.length}</td></tr>
      <tr><td>Correct</td><td class="num">${ok} (${Math.round(100 * ok / Math.max(1, s.attempts.length))}%)</td></tr>
      <tr><td>Minutes</td><td class="num">${Math.round((s.endedAt - s.startedAt) / 60000)}</td></tr>
      <tr><td>Readiness</td><td class="num">${s.readinessAfter ?? "—"}${delta != null ? ` <span class="${delta < 0 ? "bad" : delta > 0 ? "ok" : "mut"}">${delta > 0 ? "+" : ""}${delta}</span>` : ""}</td></tr>
    </table>
    ${evs.length ? `<hr><h3>State changes</h3>${evs.map(e =>
      `<p class="${e.event === "decayed" ? "bad" : "ok"}">${esc(byId[e.id] ? byId[e.id].q.slice(0, 90) : e.id)}
       — ${esc(e.event)}</p>`).join("")}` : ""}
    <p class="mut" style="margin-top:var(--s4)">In-session accuracy is not the number that matters.
      What matters is what you get right tomorrow, which is what the retention opener measures.</p>
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="again">Another session</button>
      <button class="g" id="rd">Readiness</button>
    </div>`;
  document.getElementById("again").onclick = () => { S.session = null; startSession({n: 24}); render(); };
  document.getElementById("rd").onclick = () => { S.session = null; S.view = "readiness"; render(); };
}
function decayNote() {
  const d = CONCEPTS.filter(c => S.sched[c.id] && S.sched[c.id].st === 3).length;
  return d ? `${d} item${d > 1 ? "s have" : " has"} decayed since you last had ${d > 1 ? "them" : "it"}.` : "Nothing has decayed.";
}

function vMode(mode) {
  const p = pool(mode);
  if (!p.length) {
    V().innerHTML = `<h1>${esc(MODE_NAME[mode])}</h1><p class="mut2">No items in this bank carry this mode.
      ${S.meta.bank === "400" ? "Try the full bank." : ""}</p>`;
    return;
  }
  if (S.session && S.session.mode === mode) return vSession();
  V().innerHTML = `<h1>${esc(MODE_NAME[mode])}</h1>
    <p class="mut2" style="max-width:62ch">${esc(MODE_BLURB[mode] || "")}</p>
    <p class="mut">${p.length} items available in ${S.meta.bank === "400" ? "The 400" : "the full bank"}.</p>
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="go">Start</button>
      ${mode === "binary" ? `<button class="g" id="go40">Rapid fire (40)</button>` : ""}
    </div>`;
  document.getElementById("go").onclick = () => { startSession({mode, n: mode === "binary" ? 30 : 15}); render(); };
  const g40 = document.getElementById("go40");
  if (g40) g40.onclick = () => { startSession({mode, n: 40}); render(); };
}
const MODE_BLURB = {
  binary: "Two options, fast. Thirty to forty calls in under five minutes. Latency is recorded, not just accuracy — a slow right answer is not a right answer in an interview.",
  card: "Say the answer aloud before you turn the card over, then tick the rubric elements you actually produced. Ticking nothing is a legitimate answer.",
  def: "You type the definition. Harder than a flashcard because you have to generate it, and graded on completeness against a rubric rather than on string match.",
  mc: "Four options. Every wrong option is one of your own recorded error patterns, not filler, and the explanation covers why the one you picked is wrong.",
  calc: "Numeric back-solves, the archetype in real Evercore first rounds. Paper only.",
  grid: "The centrepiece. Fill in the changes, place every balance sheet item on a side and every cash flow in a section, then run the balance check yourself.",
  frq: "A full written answer, graded against a rubric on conclusion, mechanism, precision and completeness.",
  spoken: "Say it out loud against the clock, then have the transcript graded like a free response.",
};

function vReadiness() {
  const r = readiness(), b = areaBreakdown();
  const decayed = CONCEPTS.filter(c => S.sched[c.id] && S.sched[c.id].st === 3);
  const gaps = CONCEPTS.filter(c => S.sched[c.id] && isConceptGap(S.sched[c.id]));
  V().innerHTML = `
    <div class="pagehead"><div class="eyebrow">Progress</div><h1>Evercore readiness</h1></div>
    ${r ? `<div class="score">${r.score}</div><div class="scorerule"></div>
      <p class="mut">out of 100${r.measured < 100 ? ` · only ${r.measured} of 100 points are measured so far. Unmeasured components score zero rather than being redistributed, so the headline cannot be inflated by avoiding the modes that measure them.` : ""}</p>
      <div class="statrow">
        ${[["Accuracy", r.accuracy, 40], ["Retention", r.retention, 25],
           ["Speed", r.speed, 20], ["Precision", r.precision, 15]]
          .map(([n, v, w]) => `<div class="stat"><div class="k">${n}</div>
            <div class="v">${v == null ? "—" : Math.round(v * 100) + "%"}</div>
            <div class="w">${w}% of the score</div></div>`).join("")}
      </div>
      <hr>
      <table style="max-width:560px">
        ${[["Accuracy", r.accuracy, 40, "recent attempts weighted more heavily"],
           ["Retention", r.retention, 25, "items answered after a gap of 24 hours or more"],
           ["Speed", r.speed, 20, "latency against the target for each question type"],
           ["Precision", r.precision, 15, "language quality from graded written and spoken answers"]]
          .map(([n, v, w, d]) => `<tr><td><b>${n}</b><br><span class="mut">${d}</span></td>
            <td class="num">${v == null ? "—" : Math.round(v * 100) + "%"}</td>
            <td class="num mut">${w}%</td>
            <td style="width:120px"><div class="meter"><i style="width:${v == null ? 0 : Math.round(v * 100)}%"></i></div></td></tr>`).join("")}
      </table>`
      : `<p class="mut2">Not enough attempts yet. The score appears after a dozen answers, and it is
         deliberately hard to move.</p>`}
    <hr class="hv">
    <h2>By area</h2>
    <table>
      <thead><tr><th>Area</th><th class="num">Mastered</th><th class="num">Learning</th>
        <th class="num">Decayed</th><th class="num">Untested</th><th class="num">Coverage</th></tr></thead>
      ${AREAS_K.map(k => {
        const o = b[k], cov = o.total ? Math.round(100 * Math.max(0, o.mastered - o.decayed) / o.total) : 0;
        return `<tr><td>${esc(AREAS[k])}${o.gaps ? ` <span class="tag bad">${o.gaps} concept gap${o.gaps > 1 ? "s" : ""}</span>` : ""}</td>
          <td class="num">${o.mastered}${o.shaky ? ` <span class="warn">(${o.shaky} shaky)</span>` : ""}</td>
          <td class="num">${o.learning}</td>
          <td class="num ${o.decayed ? "bad" : ""}">${o.decayed}</td>
          <td class="num mut">${o.untested}</td>
          <td class="num">${cov}%</td></tr>`;
      }).join("")}
    </table>
    ${decayed.length ? `<hr><h2 class="bad">Decayed</h2>
      <p class="mut2">You had these. You have now missed each of them twice.</p>
      ${decayed.slice(0, 12).map(c => `<p>· ${esc(c.q.slice(0, 110))}
        <span class="mut">${esc(AREAS[c.area])}</span></p>`).join("")}` : ""}
    ${gaps.length ? `<hr><h2 class="bad">Concept gaps</h2>
      <p class="mut2">These have gone mastered, decayed and back three times or more. That is not
        learning, it is cramming. Stop doing reps on them and go back to the guide.</p>
      ${gaps.map(c => `<p>· ${esc(c.q.slice(0, 110))}</p>`).join("")}` : ""}`;
}

function vLedger() {
  const counts = {};
  for (const k in ERROR_TAGS) counts[k] = {seen: 0, missed: 0, last: 0, recent: []};
  for (const a of S.recent) {
    const tags = a[6] ? a[6].split(",") : [];
    const c = byId[a[1]];
    for (const t of (c && c.tags) || []) if (counts[t]) { counts[t].seen++; counts[t].recent.push(a[3] === 2); }
    for (const t of tags) if (counts[t]) { counts[t].missed++; counts[t].last = Math.max(counts[t].last, a[0] * 1000); }
  }
  const rows = Object.keys(ERROR_TAGS).map(k => ({k, ...counts[k]}))
    .sort((a, b) => b.missed - a.missed || b.seen - a.seen);
  V().innerHTML = `
    <div class="pagehead"><div class="eyebrow">Progress</div><h1>Error ledger</h1></div>
    <p class="mut2" style="max-width:62ch">Your ten recorded error patterns, and what the attempt
      history actually says about each. This is keyed to the error, not to the question — the same
      mistake counts wherever it shows up.</p>
    <hr>
    <table>
      <thead><tr><th>Pattern</th><th class="num">Attempts</th><th class="num">Flagged</th>
        <th class="num">Last 5</th><th class="num">Last flagged</th></tr></thead>
      ${rows.map(r => {
        const last5 = r.recent.slice(-5);
        return `<tr>
          <td><b>${esc(ERROR_TAGS[r.k].n)}</b><br><span class="mut">${esc(ERROR_TAGS[r.k].d)}</span></td>
          <td class="num">${r.seen}</td>
          <td class="num ${r.missed ? "bad" : "ok"}">${r.missed}</td>
          <td class="num">${last5.length ? last5.map(x => x ? "✓" : "✗").join(" ") : "—"}</td>
          <td class="num mut">${r.last ? new Date(r.last).toISOString().slice(0, 10) : "—"}</td></tr>`;
      }).join("")}
    </table>`;
}

function vDiagnostic() {
  if (S.session && S.session.diag) return vSession();
  const done = S.meta.diagnostic;
  V().innerHTML = `
    <div class="pagehead"><div class="eyebrow">Placement</div><h1>Diagnostic</h1></div>
    <p class="lead">Twenty-five questions across all areas. It escalates when you are right and drops
      back when you are wrong, so it spends its questions where your level actually is rather than
      asking twenty you find trivial. Quick modes only &mdash; about fifteen minutes.</p>
    <p class="lead">The output is a per-area starting estimate that seeds the schedule. Treat it as
      provisional: a handful of questions per area can point in a direction and no more.</p>
    ${done ? `<hr><table style="max-width:560px">
      <thead><tr><th>Area</th><th class="num">Score</th><th class="num">Level reached</th></tr></thead>
      ${Object.keys(done.byArea || {}).map(k => `<tr><td>${esc(AREAS[k] || k)}</td>
        <td class="num">${done.byArea[k].right}/${done.byArea[k].n}</td>
        <td class="num">${done.byArea[k].level.toFixed(1)} of 5</td></tr>`).join("")}
      </table><p class="mut">Taken ${esc(new Date(done.at).toISOString().slice(0, 10))}.</p>` : ""}
    <div class="row" style="margin-top:var(--s4)">
      <button class="b" id="go">${done ? "Retake" : "Start"} the diagnostic</button>
    </div>`;
  document.getElementById("go").onclick = () => {
    S.session = {
      id: uid(), startedAt: Date.now(), diag: true, adaptive: true, bank: S.meta.bank, mode: null,
      queue: [], i: 0, attempts: [], events: [], requeue: [], openerCount: 0, target: 25,
      level: {}, seen: [],
      readinessBefore: (readiness() || {}).score ?? null,
    };
    AREAS_K.forEach(k => S.session.level[k] = 2.5);   // start mid-difficulty everywhere
    render();
  };
}

/* The next diagnostic item: whichever area has been asked least, at that area's current
   level, in the quickest mode the concept supports. */
function nextDiagnosticItem() {
  const s = S.session;
  const asked = {};
  AREAS_K.forEach(k => asked[k] = 0);
  s.queue.forEach(q => asked[q.c.area]++);
  const area = AREAS_K.slice().sort((x, y) => asked[x] - asked[y])[0];
  const want = s.level[area];
  const FAST = ["binary", "mc", "calc", "def"];
  const pool = CONCEPTS.filter(c => c.area === area && s.seen.indexOf(c.id) < 0
    && (S.meta.bank !== "400" || c.in400)
    && c.modes.some(m => FAST.indexOf(m) >= 0));
  if (!pool.length) return null;
  pool.sort((x, y) => Math.abs((x.d || 3) - want) - Math.abs((y.d || 3) - want));
  const c = pool[Math.floor(Math.random() * Math.min(4, pool.length))];
  s.seen.push(c.id);
  const mode = FAST.filter(m => c.modes.indexOf(m) >= 0)[0];
  return {c, mode, diagnostic: true};
}

function vSettings() {
  V().innerHTML = `
    <div class="pagehead"><h1>Settings</h1></div>
    <hr>
    <h3>Interview date</h3>
    <p class="mut">Every repetition interval is capped at a quarter of the time remaining, so the whole
      bank compresses on its own as the date approaches.</p>
    <div class="row" style="max-width:420px"><input type="date" id="idate" value="${esc(S.meta.interviewDate)}"></div>
    <p class="mut">${daysToInterview()} days away · longest interval currently ${maxInterval()} days.</p>
    <hr>
    <h3>Theme</h3>
    <div class="row">
      <button class="g${(S.meta.theme || "light") === "light" ? " on" : ""}" data-t="light">Cream</button>
      <button class="g${S.meta.theme === "dark" ? " on" : ""}" data-t="dark">Dark</button>
      <button class="g${S.meta.theme === "system" ? " on" : ""}" data-t="system">Match system</button>
    </div>
    <p class="mut" style="max-width:62ch">Cream is the default on purpose: positive polarity reads
      measurably faster over long sessions, and Times New Roman's hairline serifs bloom worse than
      most faces on a dark ground. Dark is there if you want it late at night.</p>
    <hr>
    <h3>Move your progress</h3>
    <p class="mut">Progress lives in this browser, so it does not follow you to another machine.
      Export before you switch and import after. Importing merges: whichever record of an item is
      newer wins, so an old file cannot undo newer work.</p>
    <div class="row"><button class="b" id="exp">Export progress</button><span class="mut" id="expn"></span></div>
    <div class="row" style="margin-top:var(--s3)">
      <button class="g" id="imp">Import a file</button>
      <input type="file" id="impf" accept="application/json,.json" hidden>
      <span class="mut" id="impn"></span>
    </div>
    <div class="row" style="margin-top:var(--s3)"><button class="g" id="wipe">Erase all progress</button></div>
    ${typeof window.__forgetDevice === "function" ? `<hr>
      <h3>This device</h3>
      <p class="mut">The unlock key is stored in this browser so you are not asked again. Forgetting it
        does not touch your progress \u2014 you will just enter the passphrase next time.</p>
      <div class="row"><button class="g" id="forget">Forget this device</button></div>` : ""}
    <hr>
    <h3>Storage</h3>
    <p class="mut">${!S.persisted ? "Not connected — nothing from this session will be saved."
      : S.db && S.db.local
        ? "Progress is saved in this browser (IndexedDB). It survives reloads but does not follow you to another browser or machine — export and import for that."
        : "Progress is saved to this artifact's store and survives republishes."}
      ${S.sample ? "Written answers are graded by Claude against the rubric and your error profile."
        : "There is no model grader on a static host, so you score written answers against the rubric yourself, with the guide's own teaching one click away."}</p>
    <p class="mut">${CONCEPTS.length} concepts · ${CONCEPTS.filter(c => c.in400).length} from The 400
      · ${CONCEPTS.filter(c => c.v).length} with alternate phrasings · ${SCENARIOS.length} grid scenarios
      · ${AREAS_K.length} areas.</p>`;
  document.getElementById("idate").onchange = e => {
    S.meta.interviewDate = e.target.value; markDirty("meta"); render();
  };
  V().querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
    S.meta.theme = b.dataset.t; applyTheme(); markDirty("meta");
    try { localStorage.setItem("evp-theme", S.meta.theme || "system"); } catch (e) {}
    render();
  });
  document.getElementById("exp").onclick = async () => {
    const data = JSON.stringify({v: 1, exportedAt: new Date().toISOString(), meta: S.meta,
      sched: S.sched, recent: S.recent, conceptCount: CONCEPTS.length}, null, 2);
    const name = `evercore-prep-${new Date().toISOString().slice(0, 10)}.json`;
    const note = document.getElementById("expn");
    if (S.downloads) {                          // inside the artifact viewer
      try { await S.downloads.save({filename: name, data}); note.textContent = "Saved."; }
      catch (e) { note.textContent = "Declined or unavailable."; }
      return;
    }
    try {                                       // an ordinary web page: a real download
      const url = URL.createObjectURL(new Blob([data], {type: "application/json"}));
      const el = document.createElement("a");
      el.href = url; el.download = name; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      note.textContent = "Saved to your downloads.";
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = data; ta.rows = 12; ta.style.marginTop = "16px";
      document.getElementById("exp").after(ta);
    }
  };
  document.getElementById("imp").onclick = () => document.getElementById("impf").click();
  document.getElementById("impf").onchange = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const note = document.getElementById("impn");
    try {
      const j = JSON.parse(await f.text());
      if (!j.sched || !j.recent) throw new Error("this is not an export file");
      // Merge rather than replace: the newer record of each item wins, so importing an older
      // file onto a browser you have since used cannot silently undo that work.
      let kept = 0, took = 0;
      for (const id in j.sched) {
        const mine = S.sched[id], theirs = j.sched[id];
        if (!mine || (theirs.last || 0) > (mine.last || 0)) { S.sched[id] = theirs; took++; }
        else kept++;
      }
      const seen = new Set(S.recent.map(x => x[0] + "|" + x[1]));
      for (const x of j.recent) if (!seen.has(x[0] + "|" + x[1])) S.recent.push(x);
      S.recent.sort((x, y) => x[0] - y[0]);
      if (S.recent.length > 600) S.recent = S.recent.slice(-600);
      if (j.meta && j.meta.interviewDate) S.meta.interviewDate = j.meta.interviewDate;
      AREAS_K.forEach(k => markDirty("sched:" + k));
      markDirty("stats"); markDirty("meta"); await flush();
      note.innerHTML = `<span class="ok">Imported. ${took} item${took === 1 ? "" : "s"} taken from the
        file, ${kept} kept because this browser already had something newer.</span>`;
      render();
    } catch (err) {
      note.innerHTML = `<span class="bad">Could not read that file: ${esc(err.message)}</span>`;
    }
  };
  const fg = document.getElementById("forget");
  if (fg) fg.onclick = () => {
    window.__forgetDevice();
    fg.disabled = true; fg.textContent = "Forgotten \u2014 you will be asked next visit";
  };
  document.getElementById("wipe").onclick = async () => {
    const b = document.getElementById("wipe");
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1"; b.textContent = "Click again to erase everything"; b.classList.add("bad");
      setTimeout(() => { b.dataset.armed = ""; b.textContent = "Erase all progress";
                         b.classList.remove("bad"); }, 6000);
      return;
    }
    S.sched = {}; S.recent = []; S.session = null;
    if (S.db && S.db.clear) { try { await S.db.clear(); } catch (e) {} }
    AREAS_K.forEach(k => markDirty("sched:" + k));
    markDirty("stats"); await flush(); render();
  };
}


/* Reading the guide is what this tool exists to replace, so this view is deliberately
   separate from drilling: it records nothing and touches no schedule. It is here because
   sometimes you just want to look something up. */
let readSection = null;
function vRead() {
  const items = CONCEPTS.filter(c => c.in400 && c.section);
  const sections = [...new Set(items.map(c => c.section))];
  if (!readSection || !sections.includes(readSection)) readSection = sections[0];
  const shown = items.filter(c => c.section === readSection);
  V().innerHTML = `
    <div class="pagehead">
      <div class="eyebrow">Reference</div>
      <h1>The 400</h1>
    </div>
    <p class="lead">${items.length} questions with the guide's own answers, by chapter. Nothing here
      is recorded and nothing is scheduled &mdash; reading is not practice. Use it to look something
      up after you have already tried to produce the answer.</p>
    <div class="readnav">${sections.map(s =>
      `<button data-s="${esc(s)}" class="${s === readSection ? "on" : ""}">${esc(s)}
        <span class="mut">${items.filter(c => c.section === s).length}</span></button>`).join("")}</div>
    <div class="secthead"><b>${esc(readSection)}</b> <span class="mut">${shown.length} questions</span></div>
    ${shown.map((c, i) => `<div class="qa">
      <div class="qn">${String(i + 1).padStart(2, "0")} &middot; ${esc(AREAS[c.area] || c.area)}</div>
      <h3>${esc(c.q)}</h3>
      <div class="body">${esc(c.a).replace(/•/g, "\n•")}</div>
      ${(c.v || []).length ? `<p class="mut">Also asked as: ${esc(c.v[0].q)}</p>` : ""}
    </div>`).join("")}`;
  V().querySelectorAll(".readnav button").forEach(b => b.onclick = () => {
    readSection = b.dataset.s; render();
  });
}

/* ── router ─────────────────────────────────────────────────────────────── */
function render() {
  document.querySelectorAll("#side .nav").forEach(b => {
    b.setAttribute("aria-current", String(b.dataset.view === S.view ||
      (b.dataset.bank && b.dataset.bank === S.meta.bank)));
  });
  document.getElementById("ct400").textContent = CONCEPTS.filter(c => c.in400).length;
  document.getElementById("ctfull").textContent = CONCEPTS.length;
  document.getElementById("ctdue").textContent = retentionCandidates().length || "";
  document.getElementById("brandsub").textContent =
    `${CONCEPTS.length} concepts · ${daysToInterview()}d to interview`;
  const v = S.view;
  if (v === "session") vSession();
  else if (v.startsWith("mode-")) vMode(v.slice(5));
  else if (v === "readiness") vReadiness();
  else if (v === "ledger") vLedger();
  else if (v === "diagnostic") vDiagnostic();
  else if (v === "read") vRead();
  else if (v === "settings") vSettings();
  else vSession();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#side .nav").forEach(b => b.onclick = () => {
  if (b.dataset.bank) { S.meta.bank = b.dataset.bank; S.session = null; markDirty("meta"); }
  else { if (S.session && !S.session.diag && S.view !== b.dataset.view) S.session = null; S.view = b.dataset.view; }
  render();
});
// Theme is the one per-viewer convenience kept in browser storage, so the page paints in
// the right theme before the store answers. Progress never goes here (spec §8).
try { const t = localStorage.getItem("evp-theme"); if (t) S.meta.theme = t; } catch (e) {}
applyTheme();
boot();
