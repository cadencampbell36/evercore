# Evercore Prep Suite

Retrieval practice for Evercore M&A technicals. Built for one person, one interview.

This is **not** a reader. The single job is to force active retrieval, catch errors you don't
know you're making, and resurface them on a schedule until they stop happening. Every feature
has to pass one test: *does this make you generate an answer before you see one?*

## Running it

It's a static site — no build step, no dependencies.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Published via GitHub Pages from the repository root.

## What's in it

| | |
|---|---|
| Canonical concepts | 597, deduplicated across the 400 guide and the IBIG modules |
| From The 400 | 237 (the M&A track; industry and restructuring chapters are out of scope) |
| Alternate phrasings | 76 concepts carry variants, so the same idea is asked differently across sessions |
| Three-statement scenarios | 14, from 10 composable templates |
| Guide teaching content | 93 sections, 620k characters, shown only *after* you answer |

## Modes

**Binary** — two options, latency tracked. Thirty to forty calls in five minutes.
**Flashcards** — self-graded against a rubric checklist, not a "did I know it" button.
**Definitions** — typed, because generating beats recognising.
**Multiple choice** — every distractor is a real error pattern, and the explanation covers why
the option you picked is wrong, not just why the answer is right.
**Calc** — numeric back-solves, the archetype in real Evercore first rounds.
**Three-statement grid** — the centrepiece. Place every balance sheet item on a side and every
cash flow in a section, then run the balance check yourself. The tool does not total your
figures for you.
**Free response** and **spoken check** — full answers against a rubric and a clock.

## Scheduling

Modified SM-2 with two additions that matter more than the base algorithm:

- **Horizon cap.** No interval exceeds a quarter of the days left before the interview, so the
  whole bank compresses on its own as the date approaches.
- **Overnight gate.** An item's repetition count can only advance across a calendar day. Nothing
  you do inside a single session can mark anything learned.

On top of that sits a mastery state machine — untested, learning, mastered, decayed — that is
deliberately asymmetric. Mastery takes three correct answers across two sessions on two
different days, including one retention check and one generative answer. Two misses in a
rolling 30-day window lose it. Recovery takes two. An item that completes that cycle three
times stops being treated as an item and is flagged as a concept gap.

## Storage

Progress lives in IndexedDB, per browser. Export before switching machines, import after;
importing merges, and the newer record of each item wins, so an old file can't undo newer work.

There is no model grader on a static host, so written answers are scored against the rubric by
you, with the guide's own teaching one click away.

## Publishing

The site is hosted on GitHub Pages from a **public** repo, so the question bank is encrypted
rather than served in the clear. `bank.js` and `reference.js` are gitignored; only `bank.enc`
and `reference.enc` ship.

```bash
tools/run.sh                 # rebuild bank.js and reference.js from source (only if changed)
node tools/encrypt.js        # prompts for a passphrase, writes bank.enc and reference.enc
git add -f bank.enc reference.enc && git commit -m "Update the encrypted bank" && git push
```

AES-256-GCM, key derived with PBKDF2-SHA256 at 600,000 iterations. There is no stored password
to compare against: the wrong passphrase simply fails the GCM tag. Unlocking takes well under a
second. "Remember this device" keeps the derived key in that browser, with a **Forget this
device** control in Settings.

**What this does and does not protect.** The ciphertext is indistinguishable from random
(7.9998 bits per byte), so a visitor without the passphrase gets nothing readable. But the blob
is downloadable by anyone with the URL, so the passphrase can be attacked offline. Use several
unrelated words, not one word. Rotating it means re-running `encrypt.js` and committing again;
every device is then asked for the new one.

## Source material

Built from Breaking Into Wall Street's *400 Questions Guide* and the IB Interview Guide modules.
Question and answer text belongs to BIWS; this repository is a private study tool, not a
redistribution. `data/` is not committed — see `PIPELINE.md` for how the bank is regenerated.
