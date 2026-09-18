# Regenerating the question bank

`bank.js` and `reference.js` are generated from the BIWS source PDFs. Those PDFs are not in this
repository. To rebuild, put the extracted text in `txt/` and run `./run.sh`, which chains:

| Step | Does |
|---|---|
| `parse400.py` | Q&A pairs from the 400 guide, 23 sections |
| `parsemod.py` | Q&A from the six IBIG modules' Interview Questions sections |
| `parseref.py` | Key Rules teaching content, Core Concepts, debt reference |
| `dedup.py` | One canonical concept per idea; alternate phrasings kept as variants |
| `enrich.py` | Error tags, mode fitness, difficulty, rubric points |
| `assemble.py` | Attaches the hand-authored drills to matching concepts |
| `txnmatrix.py` | Generates the EV transaction-effect matrix, bridge-verified |
| `emit.py` | Writes `bank.js` and `reference.js` |

## Two things worth knowing

**Question boundaries.** The source PDFs wrap question text mid-sentence, so a naive split leaks
answer prose into questions. The parser uses two signals — a line ends a sentence *and* is
shorter than the measured wrap width (87–96 characters across 5,706 lines). Verified: zero
numbering gaps across all 23 sections of the 400, and no answer begins mid-sentence.

**Calc items are hand-verified only.** Expected numeric answers are never extracted from the
guide's prose. Getting one wrong would mark correct answers wrong, on a schedule designed to
make things stick. BIWS's numeric questions still ship — as free response, with the guide's full
worked answer.

Coverage of the source text: 83%. The remainder is the industry and restructuring chapters
(out of scope), front matter, and marketing pages.
