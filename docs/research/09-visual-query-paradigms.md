# Visual Query-Composition Paradigms: Expressing Compound Logic Without AND/OR/NOT

**Status:** Research synthesis (cross-domain paradigm survey + ranked recommendation)
**Date:** 2026-06-10
**Scope:** A broad survey of *visual* query-composition paradigms across domains (behavioural analytics, productivity tools, set-theory UIs, clinical informatics, LLM interfaces) that let **non-technical users express compound boolean logic without ever typing AND / OR / NOT**. Each paradigm is described with concrete products, how it encodes AND vs OR vs NOT *implicitly*, an ASCII mockup for a clinical cohort, and pros/cons. The report then ranks the paradigms for our specific audience: **clinical researchers (mostly non-engineers) building cohorts over a finite variable set (tens to ~170 variables) with a live count and statistical disclosure control (SDC)**.

> Companion to `03-cohort-builder-ux.md` (broad UX + SDC), `05-cohort-query-ui-patterns.md` (compound-query composition mechanics in biomedical tools), and `07-drag-and-drop-query-composition.md`. This file widens the aperture to **non-clinical domains** and asks which paradigm best *hides* boolean operators for novices.

---

## 0. TL;DR

The single most important finding across every mature, novice-facing tool is that **none of them expose a free-form boolean expression with parenthesised AND/OR/NOT tokens.** They make the boolean structure *fall out of the layout*:

- **Stacking criteria = AND** (each row/step you add narrows the result).
- **Multi-select inside one criterion = OR** (tick several values of the same variable).
- **A separate "exclude / remove" region or a per-criterion toggle = NOT** (never a raw `NOT`).

The paradigm that does this most legibly *and* most naturally carries a live running count is the **funnel / progressive-narrowing builder** (Amplitude, Mixpanel, clinical attrition tables). The paradigm that best matches how clinicians already write protocols is the **inclusion/exclusion two-region layout** (i2b2, OHDSI ATLAS, TriNetX). Our recommendation is a **hybrid of these two**, with an **LLM "describe your cohort" front door that compiles to the same visible criteria rows** (never executing silently). Set/Venn composition and pure card/canvas flow builders are demoted for this audience.

A vital constraint for us that the analytics tools do *not* face: **the live count must stay honest under SDC.** Every count shown beside a step or chip must carry provenance (exact / rounded-to-10 / suppressed `<11` / availability-only), and the UI must avoid letting a user *back-calculate* a suppressed cell by differencing two steps.

---

## 1. FUNNEL / progressive-narrowing builders

**Domains/products:** Amplitude, Mixpanel, Heap, PostHog (behavioural-analytics cohort & funnel builders); clinical **attrition funnels / CONSORT-style flow** (OHDSI ATLAS "attrition", TriNetX query refinement, i2b2 "previous query" chaining).

**Core idea:** the cohort is a *running population* that starts at the full N and shrinks as each criterion is appended. The screen is read top-to-bottom as "start with everyone, then keep only those who...".

### How it encodes AND / OR / NOT implicitly
- **AND = the act of adding another step.** Each new row is conjoined to everything above it; the user never sees the word "AND". Amplitude's behavioural-cohort builder and Mixpanel's "did / did not" rows both work this way: criteria are stacked, and stacking is conjunction.
- **OR = a multi-select *within* one step.** Inside a single criterion the user ticks several values (e.g. several diagnosis codes), which OR together. PostHog makes the within-vs-across distinction explicit by nesting "match groups": items in a group OR; groups AND. Amplitude funnels apply a segment filter to one step and per-step filters to others, so the OR stays local to a step.
- **NOT = a "did NOT do / exclude this step" toggle** on the row, framed in plain language ("**exclude** users who...", Mixpanel's "**did not**" verb). It is a property of a step, not a free operator.
- **Running N is the headline feature.** Every step shows the count *after* that step is applied, plus the step-to-step drop (Amplitude/Mixpanel show conversion % and absolute drop-off; clinical attrition shows "n excluded = X"). This is exactly the "live count at each criterion" behaviour we want.

### Clinical ASCII mockup

```
COHORT FUNNEL                                  Starting population: 12,480

┌──────────────────────────────────────────────────────────────────────┐
│  ▣ Step 1  Age at baseline   between [55] and [85]                      │
│            ────────────────────────────────────────────  N = 9,210     │
│                                              (-3,270 excluded)          │
├──────────────────────────────────────────────────────────────────────┤
│  ▣ Step 2  Diagnosis is ANY of:                                         │
│              [✓] Alzheimer's disease   [✓] Mild cognitive impairment    │
│              [ ] Vascular dementia      [+ add value]   ← these OR       │
│            ────────────────────────────────────────────  N = 4,025     │
│                                              (-5,185 excluded)          │
├──────────────────────────────────────────────────────────────────────┤
│  ▣ Step 3  Comorbidity   has [Type 2 diabetes]                          │
│            ────────────────────────────────────────────  N = 1,540     │
│                                              (-2,485 excluded)          │
├──────────────────────────────────────────────────────────────────────┤
│  ⊘ Step 4  EXCLUDE  APOE genotype is [e4/e4]   ← "remove" step (NOT)     │
│            ────────────────────────────────────────────  N = 1,180     │
│                                              (-360 removed)             │
├──────────────────────────────────────────────────────────────────────┤
│  ▣ Step 5  Assay available:  [✓] Plasma proteomics                      │
│            ────────────────────────────────────────────  N = ~640 ⚠    │
│            ⚠ rounded to nearest 10 (disclosure control)                 │
└──────────────────────────────────────────────────────────────────────┘
   [+ Add criterion]            FINAL COHORT  N = ~640   (availability-gated)
```

### Pros
- The mental model ("narrow a population") is the closest match to how clinicians already think about eligibility and to CONSORT/attrition diagrams they read in papers.
- The **running count is intrinsic to the layout**, not bolted on; drop-off per step gives instant feedback on which criterion is costly.
- AND is invisible and effortless; OR is contained and local; NOT is a friendly verb.
- Linear top-to-bottom reading; no nesting depth to get lost in.

### Cons
- Pure funnels struggle with **OR *across* whole criteria** (e.g. "diabetic OR hypertensive" as two distinct variables). PostHog's nested match-groups solve it but reintroduce some grouping concept.
- Order can *imply* causation/precedence to naive users even when steps are commutative.
- **SDC hazard (important):** showing per-step "N excluded" lets users **difference adjacent steps** and reconstruct a suppressed small cell. Mitigation below.

---

## 2. INCLUSION / EXCLUSION two-region layouts and criteria chips/pills

Two related sub-paradigms that both hide operators in layout.

### 2a. Inclusion/exclusion two-column or stacked "keep vs remove"
**Domains/products:** i2b2 (inclusion groups + a separate exclusion treatment), OHDSI ATLAS (inclusion rules; absence encoded separately), TriNetX query builder (per-criterion include/exclude), clinical eligibility forms generally.

**How it encodes logic:** the screen has an **INCLUDE** region and an **EXCLUDE** region. Everything in INCLUDE is ANDed (each row narrows); everything in EXCLUDE is removed (NOT). Within a row, multi-select ORs. The words "AND/OR/NOT" never appear; the two-region geography *is* the logic. This directly mirrors how protocols are written ("Inclusion criteria: ...; Exclusion criteria: ...").

```
┌─────────────── INCLUDE (keep patients who...) ───────────────┐
│  • Age 55–85                                       N 9,210    │
│  • Diagnosis: Alzheimer's  OR  MCI                 N 4,025    │
│  • Comorbidity: Type 2 diabetes                    N 1,540    │
│  [+ add inclusion]                                            │
├─────────────── EXCLUDE (remove patients who...) ─────────────┤
│  • APOE genotype: e4/e4                            −360       │
│  [+ add exclusion]                                            │
└──────────────────────────────────────────────────────────────┘
              MATCHING COHORT   N = ~1,180   (live)
```

### 2b. Criteria chips / pills bar
**Domains/products:** Gmail search chips, Linear filter bar, Notion filter pills, Airtable, Booking.com facet chips. Material 3 / Mobbin codify "filter chips".

**How it encodes logic:** filters render as **chips in a horizontal bar; chips AND together; OR lives *inside* a chip** (a chip like `Diagnosis: is any of [Alzheimer's, MCI]`). NOT is a chip in a negated state (`Diagnosis: is not [...]`) or a strike-through/"−" styling. Booking.com's chip bar is an explicit real-world example of "all chips are AND".

```
Filters:  [ Age: 55–85 ✕ ]  [ Dx: any of Alzheimer's, MCI ✕ ]
          [ Comorbidity: Type 2 diabetes ✕ ]  [ APOE: is NOT e4/e4 ✕ ]
          [ + Add filter ]
          ─────────────────────────────────────────────────────
          Matching patients:  ~1,180     (rounded · SDC)
```

### Pros
- Inclusion/exclusion maps **1:1 onto clinical protocol language** — least translation cost for our audience.
- Chips are extremely compact, familiar from consumer apps, and trivially editable/removable (good for "what if I drop this criterion").
- Both keep AND implicit (geography/adjacency), OR boxed inside one criterion, NOT as a labelled state.

### Cons
- Chip bars hide *value* detail until you open a chip; long clinical chip strings can wrap and become hard to scan.
- Neither sub-paradigm shows a *per-step running count* as naturally as a funnel (chips usually show only the final N). For us this matters — we want stepwise feedback.
- Exclusion-as-absence (ATLAS's "0 occurrences") is a known novice stumbling block when "remove" must express temporal absence rather than a simple flag.

---

## 3. SET / VENN-diagram visual composition

**Domains/products:** VQuery (research system: each query term is a draggable circle; overlaps imply boolean expressions), Venn/UpSet-style set tools, BioVenn, various "drag sets to intersect/union/subtract" demos, SQL-join Venn explainers.

**How it encodes logic:** sets are circles/regions; **overlap region = AND (intersection)**, **combined area = OR (union)**, **A minus B = NOT (difference)**. The user drags circles together to intersect, apart/grouped to union, and subtracts one from another to exclude. Logic is fully spatial.

```
        ┌─────────────┐
        │  Age 55–85  │            Selected region (shaded ▒):
        │   ▒▒▒▒▒▒▒    │ ┌──────────────┐   Age 55–85  AND  (AD OR MCI)
        │  ▒▒▒██████▒▒▒│▒│  Dx: AD/MCI  │       MINUS  APOE e4/e4
        │   ▒▒▒██████  │ │   ▒▒▒▒▒▒      │
        └──────────────┘─└──────────────┘
                    ╲  cut out  ╱
                  ┌──────────────┐
                  │ APOE e4/e4   │  (subtracted)
                  └──────────────┘
              Shaded population N = ~1,180
```

### Pros
- Genuinely intuitive for **two or three** sets; union/intersection/difference are visible at a glance.
- Excellent as a *read-only explainer* of what a query means ("here's why your N dropped").

### Cons
- **Does not scale past ~3 sets.** Our cohorts routinely combine 5–10+ criteria; Venn geometry becomes impossible (this is exactly why UpSet plots replaced Venn for >3 sets).
- Continuous variables (age range, lab thresholds) and "at least N of" do not map cleanly to circles.
- Hard to keep a meaningful **live count per region** when regions multiply.
- Best repurposed as a **visualisation of the current query**, not the primary composition surface.

---

## 4. QUERY-BY-EXAMPLE and TEMPLATE / criteria-library approaches

**Domains/products:** OHDSI Phenotype Library and reusable Concept Sets, eMERGE/PheKB phenotype libraries, "patients like this one" similarity cohorts (phenotype-extraction similarity studies), Criteria2Query (parse a protocol's criteria text into a structured cohort), saved-segment libraries in analytics tools.

**How it encodes logic:** the user **starts from a pre-built cohort/template** (e.g. "Probable Alzheimer's, age 65+") that already contains the boolean structure, then tweaks. Or they pick an **index patient** and ask for "similar" patients (logic is derived, not authored). The user never composes operators from scratch; they *edit a working example*.

```
START FROM A TEMPLATE                         or   PATIENTS LIKE THIS ONE
┌────────────────────────────────────┐            ┌──────────────────────┐
│ ▸ Late-onset AD, biomarker-confirmed│            │ Index patient #4471  │
│ ▸ MCI with APOE-e4 carriers         │  →  edit   │  age 72, AD, T2DM,    │
│ ▸ Cognitively normal controls 60+   │            │  APOE e3/e4, plasma   │
│ ▸ [ blank cohort ]                  │            │  proteomics available │
└────────────────────────────────────┘            └──────────────────────┘
   chosen template loads as editable
   inclusion/exclusion rows (Section 2)            "Find similar"  → N = ~830
```

### Pros
- **Fastest path to a usable cohort** and a superb cold-start / onboarding device.
- Encodes best-practice phenotype logic so novices inherit correct structure (and reproducibility).
- Pairs naturally with any editing surface (funnel or inclusion/exclusion) once the template is loaded.

### Cons
- Templates must be **curated and maintained**; coverage gaps frustrate users with bespoke questions.
- "Patients like this" similarity is **opaque** (why are these similar?) and clinically risky to trust without showing the derived criteria — a transparency obligation similar to the LLM concern below.
- Not a *composition* paradigm on its own; it is a **starting point** that must hand off to one of the others.

---

## 5. NATURAL-LANGUAGE and conversational / wizard builders

**Domains/products:** Atlassian Rovo "structured queries" (type a sentence, deterministically inferred filters + free text), "Mad-libs" sentence/slot-filling builders, step-by-step wizards, and LLM "describe your cohort" systems — Criteria2Query, Text2Cohort, M3 (NL→SQL with the query surfaced for verifiability), PhenoFlow (human+LLM visual analytics over clinical data).

Three flavours:

**5a. Plain-English sentence ("Mad-libs" slot filling).** A fixed sentence with editable slots: *"Find patients aged \[55]–\[85] with \[Alzheimer's / MCI] who \[have] \[Type 2 diabetes] and \[do not have] \[APOE e4/e4]."* Boolean logic is encoded in the **fixed connective words of the template** ("with", "and", "do not have"); the user only fills nouns/values. No operators authored.

**5b. Step-by-step wizard.** One question per screen ("Which age range?" -> "Which diagnoses? (tick any)" -> "Any comorbidities to require?" -> "Anything to exclude?"). AND = progression through steps; OR = multi-select on a step; NOT = the dedicated "exclude" step. Same logic as the funnel, paced as Q&A.

**5c. LLM "describe your cohort" -> structured query + confirmation/preview.** User types free text; an LLM compiles it to structured criteria, which are **shown back as editable rows before running**. M3-style systems explicitly surface the generated query "for verifiability and reproducibility"; reported NL→SQL accuracy ~93% but with strong caveats for imbalanced/nuanced clinical selection.

```
DESCRIBE YOUR COHORT
┌──────────────────────────────────────────────────────────────────┐
│ "older adults with Alzheimer's or MCI, who are diabetic, but not   │
│  APOE e4 homozygotes, and have plasma proteomics"                  │
└──────────────────────────────────────────────────────────────────┘
        │  (LLM compiles — NOT executed yet)
        ▼
WE INTERPRETED THIS AS  — please review before running:        ⚠ verify
  ✔ Age ≥ 60                                  [edit]
  ✔ Diagnosis is ANY of: Alzheimer's, MCI     [edit]   ← OR
  ✔ Comorbidity: Type 2 diabetes              [edit]   ← AND
  ✘ EXCLUDE APOE genotype e4/e4               [edit]   ← NOT
  ✔ Assay available: Plasma proteomics        [edit]
  ⚠ "older adults" → assumed age ≥ 60. Correct?  [yes] [change]
        [ Looks right — run ]   [ Edit as funnel ]   N not yet computed
```

### Pros
- **Lowest floor for true novices**; "describe it in words" removes the blank-canvas problem entirely.
- Mad-libs and wizards make the boolean connectives *grammatical* and invisible.
- An LLM front door can disambiguate clinical synonyms/abbreviations and pre-fill the structured rows.

### Cons / risks (must-address)
- **Accuracy and trust.** LLM compilation is imperfect; silent execution is unacceptable in a clinical/SDC setting. The structured criteria **must be shown and confirmed**, and the resulting query must remain fully editable in a deterministic surface. The LLM is a *drafting aid*, not the executor.
- Mad-libs templates are rigid; complex nested logic strains the sentence form.
- Wizards can feel slow for expert repeat users (mitigate with a "skip to advanced" exit).
- Free-text NL search (Atlassian-style) is great for *finding variables* but weaker for *guaranteeing* the exact eligibility logic.

---

## 6. CARD / CANVAS / BLOCK flow builders (brief)

**Domains/products:** node-graph / block builders (n8n, Node-RED, Tableau/KNIME-style flow canvases, Scratch-like block editors).

**How it encodes logic:** boolean/data operators are **nodes wired on a 2D canvas**; AND/OR/NOT are explicit junction blocks.

```
[Age 55–85]─┐
            ├─(AND)──[ NOT (APOE e4/e4) ]──► [Cohort  N ?]
[AD OR MCI]─┘
```

### Verdict
Powerful and flexible, but **too technical for clinical non-experts**: it re-exposes explicit operator nodes (the very thing we want to hide), demands spatial reasoning, and makes a clean running count awkward. **Not recommended as the primary surface**; possibly an "advanced/power" mode only. Noted briefly per brief.

---

## 7. Keeping the live count honest under SDC

This is the constraint the consumer-analytics paradigms do *not* solve for us, and it shapes the recommendation. Whatever paradigm we pick must enforce:

1. **Provenance on every number.** Tag each count as `exact`, `rounded` (e.g. TriNetX rounds up to the nearest 10), `suppressed` (`<11`, per CMS / NCI small-cell rules), or `availability-only` (we can say a variable is *present* without revealing the count). See `02-statistical-disclosure-control.md`.
2. **No back-calculation via differencing.** The funnel's seductive "N excluded at this step" is a leak: two adjacent rounded/suppressed steps can reveal a small cell by subtraction. Mitigations: round the *per-step N itself* (not the delta), suppress the delta whenever either adjacent N is near threshold, and never show an exact delta alongside two rounded endpoints. Prefer showing **only the post-step population N** (each independently rounded/suppressed) rather than explicit drop-off counts when small cells are in play.
3. **Suppress, don't error.** When a step drives N below threshold, show `N < 11 (suppressed)` and offer "broaden this criterion", rather than a hard zero that itself discloses.
4. **Availability gating as a first-class step.** "Assay available" criteria should report availability honestly even when the residual N is suppressed (a researcher can know proteomics *exists* for the cohort without seeing the exact small N).
5. **LLM/template transparency.** Any auto-generated query must render as the same SDC-aware criteria rows, so the user sees exactly what will be counted and how each count is disclosed.

---

## 8. Ranking for our audience

Audience = clinical researchers, mostly non-engineers; finite variable set (tens to ~170); live count; SDC. Ranked best-fit first.

| Rank | Paradigm | Fit for clinical novices | Live-count fit | SDC safety | Notes |
|------|----------|--------------------------|----------------|-----------|-------|
| **1** | **Inclusion/Exclusion two-region (2a)** | Excellent — matches protocol language | Good (final + optional per-row) | Good — per-row N can be independently rounded | Lowest translation cost; the clinical default |
| **2** | **Funnel / progressive narrowing (1)** | Excellent — matches attrition diagrams | Best — running N is intrinsic | Needs care (differencing leak) | Most engaging count feedback; pair with SDC rules in §7 |
| **3** | **NL/LLM "describe" + confirm (5c) and wizard (5b)** | Best *floor* for novices | N/A until compiled | Safe *iff* compiles to visible SDC rows | Use as a front door, not the executor |
| **4** | **Template / criteria-library + QBE (4)** | Excellent onboarding | Inherits host surface | Safe | Starting point, must hand off to #1/#2 |
| **5** | **Criteria chips/pills (2b)** | Good, familiar | Weak per-step | OK | Great compact summary/edit affordance |
| **6** | **Set / Venn (3)** | Good for ≤3 sets only | Poor at scale | Poor | Repurpose as read-only query *explainer* |
| **7** | **Card/canvas/block (6)** | Poor — too technical | Awkward | Awkward | Advanced mode at most |

---

## 9. Recommendation: prototype 1–2

**Prototype A (primary): a funnel-shaped inclusion/exclusion builder.** Merge ranks #1 and #2 — they are the same logic with two presentations. Build a **vertically stacked criteria list split into an INCLUDE section and an EXCLUDE section**, where:
- each added row narrows the population (AND implicit),
- multi-select within a row ORs values,
- the EXCLUDE section is the only place NOT lives (plain "remove patients who..."),
- **each row shows the post-step population N** with SDC provenance, drop-off deltas suppressed/rounded per §7,
- the whole thing reads top-to-bottom like a CONSORT attrition diagram clinicians already trust.

This gives the funnel's superb running-count feedback *inside* the inclusion/exclusion geography clinicians already know, and it scales to ~170 variables (unlike Venn) via a searchable faceted "add criterion" picker (consistent with `03`/`05`).

**Prototype B (front door): an LLM "describe your cohort" + mandatory confirmation step that compiles into Prototype A's rows.** The LLM never executes; it drafts visible, editable, SDC-aware INCLUDE/EXCLUDE rows that the user confirms. Add a **template/criteria library** as the no-LLM equivalent cold start. This removes the blank-canvas problem for novices while keeping execution deterministic and disclosure-honest.

Deprioritise Venn (use only as a read-only "why did N drop" explainer over the current query) and the card/canvas builder (advanced mode at most). Pure chip bars become the **compact summary** of Prototype A's criteria, not a separate builder.

**One-line mockup of the winner (Prototype A):**
`INCLUDE: [Age 55–85 → N 9,210] [Dx: AD OR MCI → N 4,025] [T2DM → N 1,540]  |  EXCLUDE: [APOE e4/e4]  →  Cohort N ≈ 1,180 (rounded ·10, SDC)`

---

## Sources

- Amplitude — Define a new cohort: https://amplitude.com/docs/analytics/define-cohort
- Amplitude — Behavioral cohorts (identify users with similar behaviors): https://help.amplitude.com/hc/en-us/articles/231881448-Behavioral-cohorts-Identify-users-with-similar-behaviors
- Amplitude — Build a funnel analysis: https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-build
- Amplitude — How filters work in a Funnel Analysis chart: https://help.amplitude.com/hc/en-us/articles/360054203872-FAQ-Funnel-Analysis
- PostHog — Cohorts (AND/OR match groups, behavioural & sequence filters, nested cohorts): https://posthog.com/docs/data/cohorts
- PostHog — Array 1.37.0: Cohorts 2.0: https://posthog.com/blog/the-posthog-array-1-37-0
- OHDSI — The Book of OHDSI, Chapter 10 Defining Cohorts (inclusion rules, attrition, absence-as-zero-count): https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html
- Implementation of inclusion and exclusion criteria in OHDSI ATLAS (Scientific Reports): https://www.nature.com/articles/s41598-023-49560-w
- i2b2 — Query Tool (drag concepts into groups; OR within group, AND across groups; patient counts): https://community.i2b2.org/wiki/display/webclient/3.+Query+Tool
- i2b2 — Query Tool overview (Boston University): https://sites.bu.edu/bu-i2b2/intro-to-i2b2/i2b2-query-tool/
- TriNetX — LIVE platform / Query Builder (temporal + logical relations; rounding to nearest 10; <10 reported as 10): https://trinetx.com/solutions/live-platform/features/
- Smart Interface Design Patterns — Badges vs. Pills vs. Chips vs. Tags: https://smart-interface-design-patterns.com/articles/badges-chips-tags-pills/
- Material Design 3 — Chips (filter chips guidelines): https://m3.material.io/components/chips/guidelines
- Mobbin — Chip UI Design glossary (filter chips, multi-select OR): https://mobbin.com/glossary/chip
- Arounda — 20 Filter UI Examples for SaaS (chip filters AND together, Booking.com): https://arounda.agency/blog/filter-ui-examples
- VQuery / Venn-based visual boolean query building (Assessing Visualization Techniques for the Search Process in Digital Libraries): https://arxiv.org/pdf/1304.4119
- Set theory for SQL joins (Venn = union/intersection/difference): https://jsmshaktisingh.medium.com/set-theory-for-sql-joins-9739b6943eb3
- OHDSI Phenotype Library (reusable phenotype/criteria templates): https://data.ohdsi.org/PhenotypeLibrary/
- Construction of cohorts of similar patients ("patients like this" phenotype similarity): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9808583/
- Review of approaches to identifying patient phenotype cohorts using EHRs (JAMIA): https://academic.oup.com/jamia/article/21/2/221/2909214
- Criteria2Query — natural language interface to clinical databases for cohort definition: https://pmc.ncbi.nlm.nih.gov/articles/PMC6402359/
- Text2Cohort — natural language cohort discovery: https://arxiv.org/pdf/2305.07637
- M3 — Conversational LLMs simplify secure clinical data access (NL→SQL with surfaced query for verifiability; accuracy caveats): https://arxiv.org/html/2507.01053v1
- PhenoFlow — human+LLM visual analytics for clinical datasets: https://arxiv.org/pdf/2407.16329
- Atlassian — Structured queries: enhancing search with natural language and filters (deterministic slot inference): https://www.atlassian.com/blog/company-news/enhancing-search-with-natural-language-and-filters
- CMS Cell Size Suppression Policy (cells 1–10 suppressed): https://resdac.org/articles/cms-cell-size-suppression-policy
- CDC U.S. Cancer Statistics — Suppression of Rates and Counts: https://www.cdc.gov/united-states-cancer-statistics/technical-notes/suppression.html
- NCI Patterns of Care — Small Numbers Reporting Guidelines (report 1–10 as "<11"; back-calculation risk): https://healthcaredelivery.cancer.gov/poc/POC_Small-Denominator-Guidlines_2022-08-22.pdf
