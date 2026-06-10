# Clinical Cohort UX Without Visible Booleans

How real clinical and biomedical cohort-discovery tools let non-technical clinical
researchers (clinicians, epidemiologists, trial coordinators) build cohorts
without exposing explicit `AND`/`OR`/`NOT` operators. This report focuses on the
**interaction model** and the **mental model** each tool assumes, not the science.

Companion to `05-cohort-query-ui-patterns.md` (Boolean composition mechanics) and
`03-cohort-builder-ux.md` (general interaction patterns). This file narrows the
lens to the *low-Boolean, clinician-facing* angle and adds tools not covered
elsewhere (Aetion, Flatiron, Genomics England, Palantir, Komodo, and the clinical
trial eligibility framing).

---

## 0. The headline finding

The dominant clinician-friendly metaphor across every approachable tool is the
**clinical trial eligibility sheet**: two stacked lists, **"Include patients who..."**
and **"Exclude patients who..."**, each holding plain-language criteria.

Clinicians already author and read these lists daily (every protocol, every
referral, every guideline is structured this way). So the winning tools do not
ask the user to learn Boolean algebra; they ask the user to **fill in two lists
they already know how to write**. The Boolean structure is then *inferred* from
position and from a small set of natural-language toggles, never typed.

The four moves that hide Boolean logic:

1. **Inclusion vs exclusion = two zones**, not a `NOT` operator.
2. **`AND` = "add another criterion / another row"** (stacking implies conjunction).
3. **`OR` = "multiple values inside one criterion"** (a multi-select pill, a
   value chip list, or an explicit "Has any of" toggle).
4. **Live count feedback** turns query construction into a tactile, exploratory
   loop so the user never has to reason about logic in the abstract.

---

## 1. TriNetX — the live patient-count funnel

**Core metaphor:** a **funnel**. The user starts from the whole network population
and each criterion narrows it; the funnel visualisation is the centrepiece.

**How compound logic is expressed without operators**

- The user builds a **query** by searching for clinical concepts (diagnoses,
  medications, labs, procedures) and dropping each into the query as a row. The
  system applies temporal logic, exclusions and qualifications behind the row.
- Multiple criteria stacked in the query are implicitly conjunctive ("must have").
- "Any of these codes" is handled at the *concept* level: a single criterion can
  hold a whole code group, so within-criterion `OR` is absorbed into the concept
  set rather than shown as an operator.
- Temporal relationships (within X days of, before/after) are set on a **draggable
  time ruler / window control**, not written as logic.

**Inclusion vs exclusion**

- Criteria are tagged **"must have"** (inclusion) vs **"cannot have"** (exclusion).
  At least one inclusion criterion is required from the diagnosis category.
- There is no `NOT` keyword; exclusion is a property of the criterion.

**Count / feedback**

- The signature feature: the platform **precalculates cohort size for every
  permutation** of the eligibility criteria and renders an **interactive funnel**.
  Each level of the funnel is one criterion's impact on the count. Users can
  **remove a criterion from the funnel and watch the count change in real time**.
  This is the clearest "see the consequence of each rule" loop of any tool here.

**Approachable for clinicians?** Yes, strongly. The funnel maps directly onto the
trial-feasibility question ("how many patients survive each eligibility rule?").
Clinical analysts already review "each criterion alone and in combination" — the
funnel literally draws that. The mental model is *attrition*, which is native to
recruitment work.

---

## 2. Epic SlicerDicer — consumer-grade self-service

**Core metaphor:** **start with a population, then refine.** "You start with the
entire population and add criteria to hone in." The base population is a named
data model (e.g. "Patients"); criteria are added on top as **filter pills**.

**How compound logic is expressed without operators**

- User clicks **+ Add Criteria**, browses folders (Diagnosis, Medication, Lab,
  Demographics) and picks a value. Each becomes a criterion. Stacking criteria
  narrows the population — implicit `AND`, never shown.
- Within one criterion, selecting several values (e.g. three diagnosis codes) is
  an implicit `OR` over those values — again no operator visible.
- **"Slices"** break the current population down by a chosen dimension (e.g. by
  specimen source, by age band) and render as bar / line / map / tree-map charts.
  This is *characterisation*, not filtering, but it lets users explore before
  committing to a criterion.

**Inclusion vs exclusion — the cleanest toggle in the field**

- Every criterion is **inclusive by default** ("include results for whom this is
  true"). To express `NOT`, the user flips the criterion from **inclusive to
  exclusive** — either at add-time or via a customisation button. The words
  "inclusive / exclusive" replace `NOT` entirely. No nesting, no operators.

**Count / feedback**

- The population total updates as criteria are added; visual options let the user
  re-chart instantly. Drill-down to line-level detail and "jump to related records"
  closes the loop from aggregate to patient.

**Approachable for clinicians?** Very. It is explicitly pitched at physicians and
managers with no analytics training. The "refine a population" framing plus the
inclusive/exclusive toggle means a user can build a non-trivial cohort having never
seen `AND`, `OR`, or `NOT`. The main ceiling is that genuinely complex nested logic
is awkward, by design.

---

## 3. Aetion Evidence Platform / Flatiron — regulatory-grade, clinician-facing

**Aetion — core metaphor:** **templated study workflow + Measures.** Rather than a
blank canvas, the Cohort Builder offers **cohort templates** (Descriptive,
Comparative Effectiveness, Prevalence & Incidence, Adherence, Time-0 Sampled
Comparator). The user picks the *shape of the study* first, then fills slots.

**How compound logic is expressed without operators**

- The atomic unit is a **Measure**: a named, reusable clinical definition ("Type 2
  diabetes", "first line therapy") that hides the underlying code lists and date
  logic. Users apply Measures as inclusion/exclusion criteria; they compose
  *clinical concepts*, not Boolean expressions.
- The **Measures Assistant** "translates clinical intent into structured
  definitions without code or manual data mapping" — i.e. natural-language-to-
  definition, so the user states intent and the platform builds the logic.
- "No-code dynamic workflows" deliberately harmonise the same definition across
  data scientists, epidemiologists and market-access users — the operator-level
  logic is an artefact, not something the clinician edits.

**Inclusion vs exclusion:** custom inclusion/exclusion logic applied to a template.
Pre-built Measures carry the clinical definition so the user reasons in disease and
treatment terms.

**Flatiron Health — core metaphor:** **abstraction-backed cohort.** Flatiron's
oncology databases (OncoEMR-derived FHRD) are built so cohort eligibility is
expressed in oncology-native terms (line of therapy, biomarker status, stage),
much of it produced by technology-enabled chart abstraction. The clinician-facing
framing is "patients who meet the inclusion criteria for a study", echoing trial
eligibility directly.

**Approachable for clinicians?** Yes, and notably for the **most regulated**
audience. The lesson: hide logic behind **named, validated clinical definitions
(Measures)** and behind **study templates** so the user never assembles raw
operators — they assemble *clinically meaningful objects*.

---

## 4. OHDSI ATLAS and i2b2 — the contrast cases (too technical)

Included to mark the boundary: what to *avoid* and what to *keep*.

**OHDSI ATLAS**

- **Metaphor:** a formal cohort *definition* = Initial (index) Event → Inclusion
  Rules → Exit/Censoring. It mirrors an epidemiologist's mental model precisely.
- **Compound logic:** within an inclusion rule, criteria are grouped with explicit
  selectors **"ALL of / ANY of / AT LEAST n of / AT MOST n of"** the following
  criteria. This is the *good* part — it is **counting language, not Boolean
  symbols**, and it expresses nested logic in words a clinician can read.
- **Why it is too technical for the target user:** it forces the concept of an
  **index event with an observation window**, requires building **concept sets**
  from vocabularies (SNOMED/RxNorm), and surfaces temporal windows, occurrence
  counts and "restrict to first event" mechanics. The cognitive load is for
  epidemiologists/informaticists, not bedside clinicians or trial coordinators.
- **What to keep:** the **"all / any / at least N of"** phrasing is the single most
  transferable way to express grouped `AND`/`OR`/threshold logic *in words*.

**i2b2 Web Client**

- **Metaphor:** numbered **Group panels**; drag a concept from the ontology tree
  into a Group.
- **Compound logic:** items in the *same* group are `OR`; *separate* groups are
  `AND` (stacked vertically). Occurrence constraints ("≥ N occurrences") and a
  timing selector add temporal logic.
- **Inclusion vs exclusion:** an **Exclude** button on a panel flips it; the panel
  text changes to **"none of these"** and the background turns **pink** — a strong,
  honest visual cue that this panel removes patients.
- **Why too technical:** the same-group-`OR` / different-group-`AND` rule is a
  hidden convention the user must *learn and remember*; nothing on screen explains
  it. Drag-from-tree assumes familiarity with coding hierarchies.
- **What to keep:** **colour + relabel on exclusion** ("none of these", pink) and
  the idea that **spatial position encodes the operator** so it is never typed.

---

## 5. All of Us Researcher Workbench — the best non-expert model

**Core metaphor:** **two columns — "Include Participants" | "And Exclude
Participants"** — each holding numbered criteria **groups**. A point-and-click
"shopping cart" flow assembles each criterion.

**How compound logic is expressed without operators (mostly)**

- **Add Criteria** opens a browser of domains/concepts. The selected criterion goes
  into a review cart ("Finish & Review" → "Save Criteria") before it is committed —
  a deliberate confirmation step that lowers error anxiety.
- Logic *is* labelled `AND`/`OR`, but **every operator is paired with a plain-English
  gloss right next to it**:
  - **"Use AND when you want participants to meet both criteria"** (e.g. answered
    The Basics survey AND shared EHR data) — placed *between* two groups.
  - **"Use OR when you want participants to meet one of the criteria"** — placed
    *within* a group.
- So between-group = `AND`, within-group = `OR`, but unlike i2b2 the rule is
  **explained inline with concrete examples**, not left implicit.
- **Modifiers** (age at occurrence, occurrence count, date) are an optional second
  step per criterion, keeping the first pass simple.

**Inclusion vs exclusion**

- Pure **spatial**: left column includes, right column excludes. There is no `NOT`;
  you put the criterion in the exclude column. A per-criterion menu also offers
  **"suppress criteria from total count"** for what-if exploration.

**Count / feedback**

- A persistent **Total Count** panel on the right with a **Refresh** button, plus a
  toggle to view the breakdown **by count or by percentage**, broken down by race
  and age. Live demographic feedback as the cohort changes.

**Approachable for clinicians?** This is the reference design for the target user.
Two-zone include/exclude + grouped criteria + inline explanation of `AND`/`OR` +
review-before-commit + live demographic counts. Its only "leak" is that it still
prints the words `AND`/`OR` — but it neutralises them with examples.

---

## 6. UK Biobank (DNAnexus RAP) & Genomics England — criteria cards + natural-language toggles

**UK Biobank RAP / DNAnexus Cohort Browser**

- **Metaphor:** **tiles**. "Add Tile" exposes fields organised in a Showcase-style
  folder tree; each tile visualises a field's distribution and doubles as a filter.
- **Compound logic:** filtering tiles narrows the cohort (implicit `AND`); set
  algebra across saved cohorts is done in a **Combine** dialog rather than inline
  operators.
- **Inclusion/exclusion & counts:** filters narrow the live cohort count; genomic
  cohorts can be filtered by gene name, consequence or rsID without writing code.

**Genomics England Participant Explorer — the cleanest natural-language toggles**

- **Metaphor:** **rows of clinical-concept criteria**, "ontology-aware, no-code."
- **Compound logic without symbols:**
  - Per criterion, a toggle reads **"Has Any Of"** vs **"Does NOT Have"** — the
    `OR`-over-values and the `NOT` are both expressed as **plain English on a
    switch**, never as operators.
  - Between rows, `AND`/`OR` is offered with an explicit, *stated precedence rule*
    ("first AND, then OR") so the user is never left guessing how it evaluates.
  - **Natural-language concept search**: "you don't need to know any code systems
    ... it will search with natural language and fill in the codes for you,"
    including descendant and synonym mapping. The user types "breast cancer", the
    tool resolves the ontology.
- **Inclusion vs exclusion — the standout pattern:** to build a **control cohort**,
  the user **"switches the 'Has any of' filters to 'Has none of'."** Same screen,
  same criteria, one toggle flips case → control. This is the most elegant
  case/control mechanism in the survey.

**Approachable for clinicians?** High. Natural-language concept resolution removes
the vocabulary barrier entirely, and the **Has any of / Has none of** toggle is the
single most copyable low-Boolean control found.

---

## 7. Palantir Foundry, Komodo Health, Datavant — enterprise "point-and-click cohorting"

- **Palantir Foundry (Population Health):** explicitly markets **"point-and-click
  cohorting"** that lets "experts of all technical ability quickly iterate on
  inclusion & exclusion criteria to define a patient population." The metaphor is
  **iterate-on-inclusion/exclusion**, backed by the Foundry **Ontology** so users
  filter *objects* (a Patient with typed properties and links) rather than raw
  tables. Less-technical users get no-code apps over the same ontology.
- **Komodo Health MapLab / MapExplorer:** **no-code patient-journey exploration**
  plus a **Definitions Builder** for codesets, complex codesets and patient cohorts.
  The split of "high-code and no-code workflows" over one definition store mirrors
  Aetion's Measures: a cohort is a **reusable named definition**, edited visually.
- **Datavant:** infrastructure (privacy-preserving tokenisation linking datasets),
  not a clinician-facing cohort UI — relevant as the plumbing under cohort tools,
  not as an interaction model.

**Transferable idea:** define a cohort as a **reusable named object** ("Definition"
/ "Measure") layered over a typed **ontology of patient objects**, so non-technical
users filter clinically meaningful entities and reuse definitions, while logic stays
out of sight.

---

## 8. The clinical-trial-eligibility mental model (the framing to lean on)

Clinicians, epidemiologists and trial coordinators already think in **two lists**:

- **Inclusion criteria** — "to be in, a patient must..."
- **Exclusion criteria** — "a patient is out if..."

This is the template behind every protocol, recruitment screen and guideline. It
maps to set logic without any Boolean vocabulary:

- Each inclusion line ANDs into the others (all must hold) — but the user only ever
  "adds a line to the inclusion list".
- Each exclusion line removes patients — the user "adds a line to the exclusion
  list", never writes `NOT`.
- "Any of these qualifies" is a single line with **multiple acceptable values**
  ("on metformin **or** sulfonylurea" becomes one criterion: antidiabetic = [list]).

Because the audience authors eligibility sheets routinely, an interface that *looks
like an eligibility sheet that fills itself in and counts as you go* requires almost
no new mental model. This is why TriNetX (feasibility funnel), All of Us (two
columns) and Genomics England (rows + has-any/has-none) all converge on it.

---

## 9. Comparison table

| Tool | Core metaphor | Compound logic without AND/OR/NOT | Inclusion vs exclusion | Clinician approachability |
|---|---|---|---|---|
| **TriNetX** | Attrition **funnel** | Stacked "must have" criteria = AND; code groups absorb OR; time ruler for temporal | "must have" / "cannot have" tags per criterion | High — funnel = trial feasibility; remove-a-rule-see-count loop |
| **Epic SlicerDicer** | Refine a base **population**; filter **pills** | Stacking pills = AND; multi-value pill = OR; "Slices" for breakdown | Per-criterion **inclusive ↔ exclusive** toggle | Very high — built for untrained physicians |
| **Aetion** | **Study template** + reusable **Measures** | Measures hide code/date logic; Measures Assistant turns intent → definition | Inclusion/exclusion slots on a template | High, even for regulatory users |
| **Flatiron** | Abstraction-backed oncology cohort | Oncology-native terms (line, stage, biomarker) instead of operators | "meets inclusion criteria for a study" framing | High within oncology |
| **OHDSI ATLAS** | Index event → inclusion rules | **"ALL / ANY / AT LEAST n of"** (counting words) | Add a rule that removes patients; explicit | Low — index events, concept sets, windows |
| **i2b2** | Numbered **Group panels** (drag from tree) | Same group = OR, separate groups = AND (hidden convention) | **Exclude** button → "none of these", panel turns **pink** | Low — convention must be learned; tree coding |
| **All of Us** | **Two columns**: Include \| Exclude; grouped criteria; cart | AND/OR shown **with inline plain-English examples**; between-group AND, within-group OR | **Spatial**: left includes, right excludes; suppress-from-count | Reference design for the target user |
| **UK Biobank RAP** | **Tiles** (Add Tile) over field tree | Filtering tiles = AND; set algebra via **Combine** dialog | Filters narrow live count; no NOT keyword | Medium-high (data-savvy users) |
| **Genomics England PX** | Rows of NL clinical-concept criteria | **Has Any Of** toggle = OR; row AND/OR with **stated precedence** | **Has any of ↔ Has none of** toggle flips case→control | High — NL search removes vocabulary barrier |
| **Palantir Foundry** | Point-and-click cohorting over **Ontology objects** | Iterate inclusion/exclusion on typed patient objects | Inclusion & exclusion criteria, iterated | Medium-high (enterprise, no-code apps) |
| **Komodo MapLab** | No-code journey explore + **Definitions Builder** | Cohort = reusable named definition, edited visually | Inclusion/exclusion inside the definition | Medium-high |
| **Trial eligibility sheet** (framing) | **Two lists**: inclusion / exclusion | Add a line = AND; multi-value line = OR; exclusion list = NOT | The two lists *are* the model | Native — clinicians author these daily |

---

## 10. The 4-5 most transferable patterns for a guided clinical cohort UI

### Pattern 1 — Two zones, not three operators (the eligibility-sheet layout)
Lay the builder out as **"Include patients who..."** and **"Exclude patients who..."**
(All of Us two columns; trial eligibility framing). `NOT` disappears: you place a
criterion in the exclude zone. `AND` disappears: you add another line. This single
layout decision removes two of the three Boolean operators from the user's awareness.

### Pattern 2 — Natural-language toggles instead of operators
Borrow Genomics England's **"Has any of" / "Has none of"** and SlicerDicer's
**inclusive / exclusive** switch. A criterion is a sentence with a verb the user
flips. Where grouped logic is unavoidable, use OHDSI's **counting words** —
**"patients matching ALL / ANY / AT LEAST N of these"** — never the symbols
`&&`, `|`, `!` or even the bare words `AND`/`OR`/`NOT` standing alone.

### Pattern 3 — `OR` lives *inside* one criterion as a multi-value chip list
Within-criterion `OR` should be a **multi-select** ("Diagnosis is any of: [chip]
[chip] [chip]") or a code group, exactly as TriNetX, SlicerDicer and Aetion
Measures do. The user never composes an `OR` between two criteria; they add more
acceptable values to one criterion. This collapses the most error-prone Boolean case.

### Pattern 4 — Live count + funnel as the primary feedback loop
TriNetX's **interactive attrition funnel** (and All of Us's refreshable Total Count
with percentage/demographic breakdown) make logic *tangible*. Show the running
count, show **each criterion's marginal drop**, and let the user **toggle a
criterion off to see the count rebound** (mirror All of Us's "suppress from count").
This replaces abstract logical reasoning with direct manipulation and is the feature
clinicians cite as most useful for feasibility.

### Pattern 5 — Reusable named definitions over a typed concept layer
From Aetion Measures, Komodo Definitions Builder and Palantir's ontology: a cohort
criterion should reference a **named, validated clinical concept** ("Type 2
diabetes", resolved from natural-language search with descendant/synonym mapping as
in Genomics England and All of Us) rather than raw codes the user must know. Pair
with a **review-before-commit** step (All of Us "Finish & Review" cart) to lower
error anxiety. This keeps vocabulary complexity and any residual logic out of sight
while keeping definitions reproducible and shareable.

---

## Sources

- TriNetX Network Features — https://trinetx.com/solutions/live-platform/features/
- TriNetX Study Feasibility and Site Identification — https://trinetx.com/clinical-trial-design-optimization/premium/study-feasibility-and-site-identification/
- TriNetX basic cohort analysis tip sheet (Stony Brook) — https://www.stonybrookmedicine.edu/sites/default/files/Tip%20Sheet_TNX_Cohorts28Jul2021.pdf
- Comprehensive review of TriNetX methodologies (PMC) — https://pmc.ncbi.nlm.nih.gov/articles/PMC11931024/
- Epic SlicerDicer (UC Davis Health) — https://health.ucdavis.edu/data/epic-slicer-dicer.html
- Epic SlicerDicer (UCLA Health IT) — https://it.uclahealth.org/about/ohia/products/slicerdicer
- SlicerDicer for Pathologists (Northwestern) — https://www.pathology.northwestern.edu/docs/slicerdicer.pdf
- Epic Slicer Dicer overview (Surety Systems) — https://www.suretysystems.com/insights/epic-slicer-dicer-the-ultimate-tool-for-enhanced-health-data-analysis/
- Aetion Software — https://aetion.com/software
- Aetion Substantiate (no-code workflows) — https://aetion.com/products/substantiate/
- Aetion Evidence Platform overview (IntuitionLabs) — https://intuitionlabs.ai/software/data-interoperability-healthcare-ai/real-world-evidence-rwe/aetion-evidence-platform
- Flatiron Real-World Evidence Services — https://flatiron.com/real-world-evidence/services
- Flatiron / OncoEMR research network (AJMC) — https://www.ajmc.com/view/in-data-race-flatiron-health-touts-tripling-of-global-oncology-research-network
- The Book of OHDSI, Chapter 10 Defining Cohorts — https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html
- ATLAS cohort documentation (OHDSI wiki) — https://www.ohdsi.org/web/wiki/doku.php?id=documentation:software:atlas:cohorts
- Inclusion/exclusion criteria in OHDSI ATLAS (Scientific Reports) — https://www.nature.com/articles/s41598-023-49560-w
- i2b2 Web Client — Query Tool — https://www.i2b2.org/webclient/help/3.-Query-Tool_9995021.html
- i2b2 Query Panel Layout (Community Wiki) — https://community.i2b2.org/wiki/display/webclient/Query+Panel+Layout+-+Detailed+Review
- All of Us — Selecting Participants Using the Cohort Builder — https://support.researchallofus.org/hc/en-us/articles/360039585591-Selecting-Participants-Using-the-Cohort-Builder
- All of Us — Cohort Builder and Dataset Builder — https://support.researchallofus.org/hc/en-us/articles/29767527455124-Cohort-Builder-and-Dataset-Builder
- All of Us — Researcher Workbench — https://www.researchallofus.org/data-tools/workbench/
- UK Biobank RAP — Key concepts (DNAnexus) — https://dnanexus.gitbook.io/uk-biobank-rap/getting-started/key-concepts
- UK Biobank RAP — Quickstart (Cohort Browser) — https://dnanexus.gitbook.io/uk-biobank-rap/getting-started/quickstart
- DNAnexus Cohort Browser docs — https://documentation.dnanexus.com/user/cohort-browser/locus-details-page
- Genomics England — Building cohorts with Participant Explorer — https://re-docs.genomicsengland.co.uk/pxa_cohorts/
- Genomics England — Search for participants (Has Any Of / Does NOT Have) — https://re-docs.genomicsengland.co.uk/pxa_search/
- Palantir Foundry for Population Health — https://www.palantir.com/assets/xrfr7uokpv1b/7EzTCn3cz13pTAx8u3U5WM/29ae2623771441b61b2f7267b6f47789/Foundry_for_Population_Health.pdf
- Palantir Health & Life Sciences — https://www.palantir.com/offerings/health/
- Komodo Health MapLab / MapExplorer — https://www.komodohealth.com/solutions/maplab/mapexplorer/
- Komodo Health & Datavant partnership — https://datavant.com/about/news-press/komodo-health-datavant-expand-partnership-clinical-research-life-sciences/
- FDA — Evaluating Inclusion and Exclusion Criteria in Clinical Trials — https://www.fda.gov/media/134754/download
- AbbVie — What are eligibility criteria in clinical trials — https://www.abbvieclinicaltrials.com/resources/what-are-eligibility-criteria-clinical-trials/
