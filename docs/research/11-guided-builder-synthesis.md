# Guided (visual) cohort builder — synthesis & design

Synthesises research docs 08 (clinical tools), 09 (visual paradigms), 10
(boolean cognition + clinical mental models). All three converged
independently on the same answer.

## The verdict

Build a **guided Inclusion / Exclusion builder shaped like an attrition
funnel**, offered as a second editing surface alongside the existing
react-querybuilder "Advanced" mode. Both edit the **same underlying query
tree**, so counts, characterisation, the files table, and the SDC engine are
reused unchanged.

### Why this paradigm

- It matches what clinicians already author daily: **protocol inclusion /
  exclusion criteria** and **CONSORT attrition diagrams**. (08, 10)
- It makes the three operators disappear by *structure*, not syntax:
  - **AND** = add another criterion row (each narrows the cohort).
  - **OR** = multiple values inside one criterion ("Diagnosis is any of: AD,
    MCI"). OR never appears *between* rows.
  - **NOT** = put the criterion in the **Exclude** zone ("remove patients
    who…").
- The AND/OR conflation is one of the most replicated findings in IR/HCI: lay
  and expert users invert the operators because English "and" usually means set
  union. Hiding them is evidence-based, not cosmetic. (10)
- A **live running count per step** (the funnel) teaches effect empirically
  (dynamic queries, Ahlberg & Shneiderman) — no manual to read. (09, 10)
- Venn/set diagrams test *worse* than text for this task: avoid them. (10)

## Proposed layout

```
 ┌─ Build your cohort ──────────────────────  Guided | Advanced ─┐
 │                                                               │
 │  Start: All subjects                                25,000    │
 │                                                               │
 │  INCLUDE — keep patients who…                                 │
 │   ▸ Age is 70–84                          ─────────►  18,400  │
 │   ▸ Diagnosis is any of  [AD] [MCI] (+)   ─────────►   4,025  │
 │   ▸ Have data of type    [WGS]            ─────────►   3,110  │
 │   [ + Add inclusion criterion ]                               │
 │                                                               │
 │  EXCLUDE — remove patients who…                               │
 │   ▸ APOE genotype is  [e4/e4]             ─────────►  ≈ 1,180 │
 │   [ + Add exclusion criterion ]                               │
 │                                                               │
 │  Matching cohort:  ≈ 1,180  (rounded to protect privacy)      │
 │  Plain English: keep patients aged 70–84 with AD or MCI who   │
 │  have WGS data, then remove those with APOE e4/e4.            │
 └───────────────────────────────────────────────────────────────┘
```

Each criterion row: a variable (added from a searchable picker), a small set of
**plain-language verbs** matched to the widget — "is" / "is any of" / "is
between" / "have data of type" — and an inline value editor (the chips / bins /
range / Yes-No we already have). A running count sits at the right of each row;
removing a row updates everything (TriNetX-style).

## Mapping to our architecture (low engine cost)

The guided surface is a thin editor over the canonical `RuleGroupType`:

```
root: AND
  ├─ <include criterion 1>            // a rule (OR within via 'in')
  ├─ <include criterion 2>
  └─ NOT group (combinator OR)        // the Exclude zone
        ├─ <exclude criterion 1>
        └─ <exclude criterion 2>      // NOT(a OR b) = exclude anyone matching either
```

- Include rows = rules AND'd at the root (each may be an `in`/`between`/`=`).
- Exclude rows = one `not: true` group with `combinator: 'or'`.
- The per-row funnel count = run `treeCountSql` with include rows `1..k`
  applied (cumulative), each through the SDC engine.
- Switching Guided ⇄ Advanced just swaps the editor; the query, count,
  characterisation, files table, and SDC are identical. (A tree that does not
  fit the simple include/exclude shape — deep nesting authored in Advanced —
  shows a gentle "open in Advanced to edit" note in Guided.)

## Must-haves (from doc 10)

- **Plain-English read-back** of the whole cohort as a sentence (we have the
  pieces in `QuerySummary`).
- **Honest SDC**: every count tagged exact / rounded / suppressed / availability;
  show suppressed as "fewer than k (hidden for privacy)", never 0; and
  **suppress per-step drop-off deltas** so small cells can't be back-calculated
  by subtraction down the funnel.
- `aria-live="polite"` on the running counts (WCAG 4.1.3); plain language; no
  jargon; recognition over recall (searchable picker, not typed field names).
- Sensible defaults, preview-before-commit feel (the live count *is* the
  preview), and easy remove/undo.

## Optional, later (flagged, not default)

- **"Describe your cohort" front door** (natural language → drafted criteria).
  Powerful for novices, but it needs an LLM call, which breaks the current
  "no backend, fully offline on GitHub Pages, data never leaves the browser"
  property and adds a trust/verification burden. If pursued: send only the
  *query intent text* (never data), and require the user to confirm the
  generated, visible, editable criteria before anything runs. (09)
- **Template / criteria library** ("start from a template cohort"): cheap, no
  backend, good for onboarding. (08, 09)

## Recommendation

Build the **Guided Inclusion/Exclusion funnel as a mode toggle** over the
existing query, no new backend, reusing the count/SDC/charts pipeline. Defer the
LLM front door; optionally add a small template library. This is the highest-
value, lowest-risk improvement for the clinical-researcher audience.
