# Cohort Query UI Patterns: How Biomedical Tools Let Users Compose Boolean Queries

**Status:** Research synthesis (interaction model focus)
**Date:** 2026-06-10
**Scope:** How established biomedical cohort-builder / cohort-discovery tools let users compose compound boolean queries (AND / OR / NOT / IN / RANGE / "at least N of"). Focus is strictly on the **interaction model and visual layout** (widgets, nesting, grouping, drag-and-drop, how operators are chosen), not the underlying science. Goal: inform a redesign of a React cohort builder whose current AND/OR-group dropdown is unintuitive.

> Companion to `03-cohort-builder-ux.md` (which covers broader UX and SDC). This file drills specifically into the **compound-query composition mechanics** of each tool.

---

## 0. TL;DR dominant pattern

Across all six tools, the dominant interaction model is:

> **A vertical stack of "criteria groups". Within a group, items combine one way (usually OR); groups combine the other way (usually AND). Exclusion (NOT) is a separate visual region or a per-group toggle, NEVER a raw `NOT` operator typed by the user. A live patient count updates as criteria change.**

The crucial design insight: **none of the mature, novice-facing tools expose a free-form boolean expression editor with parenthesised AND/OR/NOT tokens.** They all constrain the user to a fixed two-level shape (group / criteria) and *label the operators in plain language or fix them by position*. The friction in our current build (an "AND/OR-group dropdown") comes from making the operator a free choice on a control the user has to reason about, rather than fixing it by structure or expressing it as a labelled region.

---

## 1. OHDSI ATLAS — cohort definition builder

**Audience:** expert epidemiologists building reproducible phenotypes over OMOP CDM.
**Conceptual model:** a cohort = **initial (entry) event** + **inclusion rules** + **exit criteria**. Strictly hierarchical and explicit. ATLAS is the most *expressive* tool surveyed and the cautionary tale for novice UIs.

### How a compound query is built (exact flow)

1. New cohort -> name it -> **"Add initial event"**. Pick a **domain** (Condition Occurrence, Drug Exposure, Measurement, etc.). Each domain is a "building block".
2. Attach a reusable **Concept Set** (a saved bag of standard vocabulary concepts, with descendant / mapped / excluded flags). This is the **IN / set-membership** primitive: "drug IN {ACE inhibitors and descendants}".
3. Add **domain-specific attributes** to the event: age at event, sex, nth occurrence, value ranges (`VALUE_AS_NUMBER`, `RANGE_HIGH`), and **temporal windows** ("starts between 365 days before and 0 days after index").
4. **Inclusion criteria**: click **"New inclusion criteria"** to add a named rule. Each rule contains a **criteria group**.
5. Inside a rule, click **"+Add criteria to group"** to add one or more criteria. Multiple criteria in a group exist because there may be several ways to find the same clinical entity (a condition record OR a drug used as a proxy OR a measurement). This is the OR-style use of a group.
6. **Group cardinality quantifier** (the key widget): at the top of a criteria group the user chooses *"having **all** / **any** / **at least N** / **at most N** of the following criteria"*. This is how AND / OR / threshold logic is expressed in ATLAS — as a **plain-language dropdown of cardinality**, not as AND/OR tokens.
7. **Nesting:** groups can contain demographic sub-criteria and further nested criteria groups, each with its own all/any/at-least quantifier, giving arbitrarily deep boolean trees.
8. **NOT / exclusion:** ATLAS has **no NOT operator**. The docs are explicit: *"ATLAS only consumes inclusion criteria. You must use logical operators to indicate when you [want absence]."* Absence is encoded as a **count constraint of "exactly 0 occurrences"** within a window (e.g. "0 occurrences of HT drugs all days before index"). This is genuinely confusing for users and the Book of OHDSI flags it as a known stumbling block.
9. **RANGE / IN:** ranges via attribute operators (between / >= / <=, with units); IN via Concept Sets.

### Conceptual model summary
- group -> criteria: yes, explicitly, with **nesting**.
- AND/OR set by: **per-group cardinality dropdown** ("all / any / at least N / at most N").
- NOT expressed as: **count = 0** within a window (no NOT primitive).
- ranges / IN: attribute operators + Concept Sets.

### Good / bad for novices
- **Good:** the *"having all / any / at least N of the following"* phrasing is far clearer than raw AND/OR for non-programmers; the **attrition / inclusion-impact table** (count remaining after each rule) is an outstanding "why did my count drop" explainer; reusable Concept Sets.
- **Bad:** overwhelming default surface; "exactly 0 occurrences" for NOT is a notorious novice trap; deep temporal windows on every criterion are intimidating; no drag-and-drop, lots of nested modal panels.

### Drag-and-drop? **No.** All composition is via buttons ("Add initial event", "+Add criteria to group") and inline dropdowns.

---

## 2. i2b2 Web Client — query tool (the canonical model the field copies)

**Audience:** clinical researchers, honest-broker count queries. This is the **most-imitated** cohort-query interaction in biomedicine and defines the de-facto boolean convention.

### How a compound query is built (exact flow)

- **Layout:** left = navigable **ontology tree** of terms in folders; right = the **Query Tool** with numbered **Groups (panels)**. **Groups 1, 2, 3 are shown by default**; more added via **"New Group"**.
- **Drag and drop is central:** the user **drags a term from the ontology tree into a Group panel**. Dropping triggers a constraint window. Saved/previous queries can also be dragged into a panel or into the Query Name field.
- **Boolean semantics fixed by structure (quoted from the wiki):**
  - Items **within each Group are ORed** together. The group's info box turns **green** and reads **"one or more of these"**.
  - **Groups are ANDed** together. The moment a second populated panel exists, an explicit **"AND" label box appears between the panels** ("each panel will be joined with an AND operator").
  - An empty group shows a **yellow** box reading **"drop a term on here"**.
  - So the canonical shape is literally rendered: **OR-within (green) / AND-across (the AND box)**.
- **Per-group constraints (opened from the panel header):**
  - **Exclude** checkbox -> turns the group into NOT; the info box text changes to **"none of these"** and the **background turns pink**. This colour + plain-language change is the clearest NOT affordance of any tool surveyed.
  - **"Occurs > Nx"** -> at least N instances (the "at least N" primitive at the *fact* level).
  - **Dates** -> per-group date-range constraint.
  - **Value constraint** opens automatically on drop for numeric/lab terms: operator + value + units, or categorical/flag (high/low).
- **Cross-group timing toggle** (panel-level): *Non-temporal: treat all groups independently* / *Non-temporal: selected groups occur in the same financial encounter* / **Temporal: define sequence of events** (ordered A-before-B).
- **Run Query** -> Number of Patients / Patient set / Patient breakdowns. Counts are obfuscated with noise (± indicator) and repeated-query lockout (SDC — see file 02/03).

### Conceptual model summary
- group -> criteria: yes (panels of terms).
- AND/OR set by: **fixed by position** — OR inside a panel, AND between panels. The user never picks an operator; they choose *where to drop the term*.
- NOT expressed as: **per-group "Exclude" checkbox** -> "none of these", pink panel.
- ranges / IN: value-constraint popup (operator + value + units); IN by dropping multiple terms into one panel (OR).
- "at least N": **"Occurs > Nx"** per-item occurrence constraint.

### Good / bad for novices
- **Good:** operator chosen by *placement* not by a dropdown -> low cognitive load; colour + words ("one or more of these" green / "none of these" pink / "drop a term on here" yellow) make the live boolean state legible without boolean literacy; explicit AND label box between panels removes ambiguity; drag-drop matches the "build it up" mental model.
- **Bad:** the OR-within/AND-across convention is powerful but *implicit* — a novice can be surprised that adding a term to an existing panel loosens (OR) rather than tightens; three empty default panels can look like mandatory slots; temporal-sequence query is advanced and easy to misuse.

### Drag-and-drop? **Yes, the defining interaction** — drag concept from tree into a numbered Group panel; drag saved queries in too.

---

## 3. All of Us Researcher Workbench — Cohort Builder

**Audience:** broad researcher base, "point-and-click" by design.
**Conceptual model:** two top-level regions — **"Include Participants"** (left) and **"And Exclude Participants"** (right) — each containing numbered **Groups**, each group containing criteria.

### How a compound query is built (exact flow)

1. **+** next to "Cohorts" -> Build Cohort Criteria page shows **Include Participants > Group 1 > Add Criteria**.
2. **"Add Criteria"** opens a dropdown / browser of program data, domains, concepts (demographics, surveys, physical measurements, conditions, procedures...). Search or browse a hierarchy.
3. Select a concept -> a concept-specific panel appears (e.g. physical measurements -> blood pressure / heart rate / BMI). Define the value, optionally toggle **"Show results as source concepts"** (ICD9/10).
4. **"Finish & Review"** -> right-hand summary "shopping cart" of selected criteria -> **"Save Criteria"**.
5. **Adding more criteria — the AND vs OR decision (this is the part most relevant to our redesign):**
   - **OR:** a gray **"OR" text** sits between criteria *inside the same Group*; clicking the **"Add Criteria"** below the OR adds an alternative within that group. "Participants meet the criteria above the OR **or** the criteria below."
   - **AND:** a gray **"AND" circle** sits *between two Group cards*; clicking **"Add Criteria"** under the AND starts a **new Group**. "Participants meet the criteria in **both** groups."
   - So like i2b2: **OR within a group card, AND across group cards** — but here the operator labels (OR text inside, AND circle between) are *rendered as fixed connectors the user clicks under*, rather than a dropdown they set.
6. **Exclusion:** the entire **"And Exclude Participants"** region on the right is the NOT. It has its own Groups with the same OR-within / AND-across rules. NOT is therefore a **spatial region**, not an operator or checkbox.
7. **Modifiers:** per-criterion **"Apply Modifiers"** (age at event, occurrence count, date windows, etc.) — the RANGE / "at least N" / temporal primitives, optional and tucked behind a button.
8. **Per-criterion menu (vertical ellipsis):** Edit name, Edit criteria, **"suppress criteria from total count"**, Delete, Add to concept set.
9. **Live count:** right-hand **"Total Count"** panel with a **Refresh** button (manual recompute) and a toggle to show **% vs count**, broken down by race / age.

### Conceptual model summary
- group -> criteria: yes, as **Group cards**.
- AND/OR set by: **fixed connectors you add criteria beneath** — "OR" between criteria inside a card, "AND" circle between cards. (Adding "AND" criteria literally creates a new group card.)
- NOT expressed as: **a separate "Exclude Participants" region** with its own groups.
- ranges / IN / at-least-N: per-criterion **Modifiers**; IN by OR-ing concepts in one group.

### Good / bad for novices
- **Good:** plain-language coaching baked into the UI ("Use AND when you want participants to meet **both**... Use OR when you want **one of**..."); NOT as a clearly separated *Exclude* column is intuitive; group **cards** make the two-level structure visually obvious; the OR/AND connectors are visible labels, not hidden state.
- **Bad:** the distinction "add criteria under the OR" vs "add criteria under the AND circle" is subtle and easy to confuse (both are "Add Criteria" buttons just placed differently); a Group can be a single criterion, so "Group" terminology feels heavy for one item; manual **Refresh** for counts breaks the live-feedback loop.

### Drag-and-drop? **No.** Composition is "Add Criteria" buttons + a finish-and-review shopping-cart confirmation. NOT a drag interaction.

---

## 4. UK Biobank RAP / Genomics England — DNAnexus Cohort Browser

**Audience:** data scientists on the Research Analysis Platform.
**Conceptual model:** start from an "all patients" cohort, then **add filter tiles**; filters from the same category auto-form a **filter group**; cohorts themselves are **set-algebra objects** that can be combined.

### How a compound query is built (exact flow)

1. **"Add Tile" / "Add Filter"** -> field browser organised in a folder tree (UK Biobank Showcase structure).
2. Pick a field -> **"Edit Filter"** -> choose operators and enter values (RANGE for continuous, IN for categorical) -> **"Apply Filter"**. Patient **count updates immediately** (visualisations need a manual "Refresh Visualizations").
3. **Filter groups & operator toggle (the distinctive bit):** multiple filters in the same category (e.g. *Patient*) **auto-group**. They default to **AND**; **clicking the operator токen toggles the whole group between AND and OR**. Note: this is the *opposite default* to i2b2 (AND-within here vs OR-within in i2b2) and the operator is a *single shared toggle for the group*, not per-pair.
4. **Join filters (nested / cross-entity):** to relate entities (Patient / Visit / Medication / Lab Test), build a **join filter** with **"Add additional criteria"** and nested branches. Within one join level, criteria are **all-AND or all-OR** (you cannot mix at a level — a deliberate simplification). OR joins apply an existence condition: "where exists, join 1 OR join 2".
5. **Genomic filters** are deliberately constrained: germline = **1 filter max**; somatic / expression = up to 10 criteria.
6. **NOT / exclusion via set algebra, not an operator.** This is the standout idea:
   - **"Combine Cohorts"**: **Intersection** (A ∩ B ∩ C), **Union** (A ∪ B ∪ C), **Subtraction** (A − B), **Unique** ((A−B) ∪ (B−A)). Up to 5 cohorts.
   - **"Not In"**: produce the complement U − A (the dataset minus the current cohort). This is how NOT is expressed at the cohort level.
   - **Compare** mode shows two cohorts (or a cohort vs its complement) side by side before combining.

### Conceptual model summary
- group -> criteria: yes (auto-formed filter groups + join branches with nesting).
- AND/OR set by: **a single clickable operator toggle per group** (default AND); join levels are all-AND or all-OR.
- NOT expressed as: **set algebra** — "Not In" (complement) and "Subtraction" between saved cohorts.
- ranges / IN: native in the Edit Filter operator/value editor.

### Good / bad for novices
- **Good:** filter tiles are tangible; immediate count feedback; **set-algebra "Combine Cohorts" is a very legible way to do complex logic** ("the people in A but not B") without ever writing NOT; "all-AND or all-OR per level" prevents the worst nesting confusion.
- **Bad:** two ways to express logic (in-group operator toggle vs cohort set-algebra) can confuse; join filters are powerful but conceptually heavy; the AND-default-within-group is the opposite of i2b2, so users moving between tools get burned; a tiny single operator toggle is easy to miss.

### Drag-and-drop? **No.** Tiles and "Add Filter" buttons; set-algebra via a Combine dialog.

---

## 5. TriNetX & Epic SlicerDicer — consumer-grade clinical cohorting (avoid raw operators)

These two are the most instructive for a **novice-friendly** redesign because they deliberately hide boolean machinery.

### 5a. TriNetX Query Builder

- The query builder is framed in plain English as two regions: the **"MUST have" (inclusion)** criteria and the **"CANNOT have" (exclusion)** criteria. The user never sees the word NOT — they put a term in the CANNOT-have region.
- Find terms via search bar or a **branching hierarchy tree / fly-out menu** to drill into a coding hierarchy and pick the right code(s).
- **AND/OR:** as you add terms, the connector defaults to **AND**; **hover over the "AND" and toggle it to "OR"** (an inline, hover-revealed toggle on the connector itself).
- **"Create Group"** to bundle terms that share a constraint — e.g. to apply a **Time Constraint** (a draggable **time ruler** or explicit dates) to a procedure within a window.
- **"Count Patients"** button (top right) gives an instant population count after any change; a query card summarises the logic.
- RANGE/IN via the term editor and the age/sex sliders on the Population Graph.

### 5b. Epic SlicerDicer

- Aimed at clinicians/managers with zero query training. Start with the whole population in a **Data Model**, then **add criteria** from a curated, pre-built filter set (diagnoses, demographics, procedures, encounter type, location). Keyword search suggests criteria.
- **No AND/OR operators exposed.** Multiple criteria are **implicitly ANDed** (each added criterion narrows the population). There is no user-facing OR between top-level criteria; "OR-like" breadth is achieved by selecting a *category/grouping* of codes.
- **NOT = an inclusive/exclusive toggle per criterion.** A criterion defaults to **inclusive** ("criterion is true"); flipping it to **exclusive** ("criterion is false") removes those patients. Settable when adding the criterion or via the customization button. This per-criterion include/exclude switch is the cleanest NOT model for non-technical users.
- **"Slices":** after the population is defined, the user **slices** it into buckets by a variable (age, sex, diagnosis category, insurance, location) — this is for *breakdown/visualisation*, not for boolean composition (worth distinguishing in our design: filtering vs grouping-for-display are different jobs).

### Conceptual model summary (both)
- group -> criteria: TriNetX has explicit Groups for shared constraints; SlicerDicer is a flat list of criteria.
- AND/OR set by: TriNetX **hover-toggle on the AND/OR connector** (default AND); SlicerDicer **AND-only** (no OR exposed).
- NOT expressed as: **labelled regions/toggles** — TriNetX "CANNOT have" region; SlicerDicer per-criterion **inclusive/exclusive** switch.
- ranges / IN: time ruler, age/sex sliders (TriNetX); curated filter editors (SlicerDicer).

### Good / bad for novices
- **Good:** *no boolean vocabulary at all*; "MUST have / CANNOT have" and "inclusive / exclusive" are immediately understandable; instant counts; curated filter sets remove the "which of a million codes" problem (directly relevant to our **~47-variable** finite set).
- **Bad:** the trade-off is expressiveness — SlicerDicer can't easily do "(A OR B) AND NOT C"; users hit a ceiling and must escalate to TriNetX/i2b2/ATLAS. For ~47 curated variables this ceiling is largely acceptable.

### Drag-and-drop? TriNetX uses a **draggable time ruler** (for windows) but not drag-to-compose. SlicerDicer: **no.**

---

## 6. Secondary references: cBioPortal & REDCap

### cBioPortal
- **Study View** is a **faceted-filter dashboard**: every clinical attribute is a chart/tile; clicking bars/ranges filters the cohort and **all other tiles + the count update live** (cross-filtering). This is filter-by-clicking-the-data, not an operator builder — implicit AND across facets.
- Complex logic happens via **Group Comparison**: save selections as named groups, then compare / intersect them (set algebra, like DNAnexus). NOT/overlap is shown as a Venn-style group comparison rather than typed operators.
- **Custom Selection** lets advanced users paste case lists; an "Annotations Filter" button toggles custom categories. Good model: *clicking the visualisation is the query*.

### REDCap (report filters)
- The **only** tool here that exposes **raw boolean syntax**. Simple reports: pick field, operator (`= < > <= >= <>`), value, then choose **AND/OR** and repeat — a row-based builder.
- For real nesting it offers **"Use advanced logic"** -> a **Logic Editor** where you type parenthesised boolean text: `([v1]='1' OR [v2]='1') AND [v3]='2'`.
- There is also a **Drag-N-Drop Logic Builder** for *simple* (and/or/=) logic, with the text editor reserved for advanced operators. The split — **drag-drop builder for the common case, raw text escape hatch for the 5% who need full nesting** — is a useful pattern to copy.

---

## 7. Comparison table

| Tool | group->criteria? | How AND/OR is set | How NOT/exclude is expressed | RANGE / IN / "at least N" | Drag & drop? | Novice friction |
|---|---|---|---|---|---|---|
| **OHDSI ATLAS** | Yes, nested groups | **Per-group cardinality dropdown**: "all / any / at least N / at most N of the following" | **No NOT** — encode as "exactly 0 occurrences" in a window | attribute operators; IN via Concept Sets; "at least N" = occurrence count | No (buttons + modals) | High; "0 occurrences" trap; deep temporal windows |
| **i2b2 Web Client** | Yes (numbered panels) | **Fixed by position**: OR within panel (green "one or more of these"), AND across panels (explicit AND box) | **Per-group "Exclude" checkbox** -> "none of these", panel turns pink | value popup (op+val+units); IN = multiple terms in one panel; "Occurs >Nx" | **Yes — drag concept from tree into panel** | OR-within is implicit/surprising; 3 empty slots look mandatory |
| **All of Us** | Yes (Group cards) | **Fixed connectors you add under**: "OR" text within card, "AND" circle between cards | **Separate "Exclude Participants" region** with its own groups | per-criterion **Modifiers** (age/count/dates); IN via OR in group | No (Add Criteria + review cart) | OR-vs-AND placement subtle; manual Refresh |
| **DNAnexus / UKB RAP** | Yes (auto filter groups + join branches) | **One operator toggle per group** (default **AND**); join level all-AND or all-OR | **Set algebra**: "Not In" (complement), Subtraction; Combine = Intersect/Union/Unique | native operator+value editor (RANGE/IN) | No (tiles + Combine dialog) | AND-default opposite of i2b2; two logic systems |
| **TriNetX** | Yes (Groups for shared constraints) | **Hover-toggle on AND/OR connector** (default AND) | **"CANNOT have" region** (no NOT word) | time ruler; age/sex sliders | Time ruler only | OR toggle hidden on hover |
| **Epic SlicerDicer** | No (flat criteria list) | **AND-only** (implicit; no OR exposed) | **Per-criterion inclusive/exclusive toggle** | curated filter editors | No | Low friction, low ceiling |
| **cBioPortal** | Facets (+ saved groups) | **Implicit AND across facets**; set algebra in Group Comparison | Group Comparison / Venn; no typed NOT | click chart bar/range = filter | No | Great for explore, weak for explicit logic |
| **REDCap** | Rows (+ advanced text) | **Explicit AND/OR rows**, or raw parenthesised text | typed `<>` / `NOT`-style logic in text editor | typed operators | Drag-N-Drop Logic Builder (simple) | Raw syntax = expert-only; drag builder for simple case |

---

## 8. Dominant pattern(s) extracted

1. **Two-level group/criteria structure with operators fixed by structure, not free choice.** The strongest, most-copied model (i2b2, All of Us) renders OR *within* a group and AND *across* groups, and lets the user pick **where** to place a criterion rather than **which operator** to apply. The user never operates an "AND/OR dropdown" in the most-loved tools — that exact control (our current pain point) is what mature tools avoid.

2. **NOT is a place, not an operator.** Every successful novice-facing tool expresses exclusion as a *visually distinct region or a per-item toggle* — All of Us "Exclude Participants" column, i2b2 pink "none of these" group, TriNetX "CANNOT have", SlicerDicer inclusive/exclusive switch, DNAnexus "Not In". Nobody makes novices type or select `NOT`.

3. **Plain-language operators + live, legible state.** Cardinality is phrased as *"all / any / at least N of the following"* (ATLAS), groups show their current meaning in words and colour (i2b2 green/pink/yellow), and an always-visible patient count gives immediate feedback. The logic is **shown back to the user in English/colour at all times.**

4. **Set algebra for the hard cases.** When two-level groups aren't enough, leading tools (DNAnexus, cBioPortal) let users save cohorts and combine them with **Intersection / Union / Subtraction / Not-In** rather than deepening the boolean tree. This sidesteps parenthesis nesting entirely.

---

## 9. The 3 best ideas to steal (for our ~47-variable React builder)

1. **Kill the AND/OR dropdown; fix operators by structure and label them in plain language.** Adopt the i2b2 / All of Us shape: **OR within a group card, AND between group cards**, with the connector rendered as a *visible, plain-language label* ("Match ANY of these" inside a card; "AND also" between cards). Adding a criterion is a placement decision (inside this card vs as a new card), not an operator selection. For per-group thresholds, offer ATLAS-style **"all / any / at least N of"** as the card header — far clearer than AND/OR for novices.

2. **Make NOT a separate "Exclude" region, never an operator.** Split the canvas into **"Include" and "Exclude" columns** (All of Us / TriNetX "MUST have / CANNOT have"). Within ~47 curated variables this covers virtually all real needs and removes the single biggest novice trap (ATLAS's "exactly 0 occurrences"). Pair with a per-criterion include/exclude switch (SlicerDicer) for one-off negations.

3. **Always-on, legible feedback: live count + an English read-back of the query.** Show a continuously updating cohort count (i2b2 / TriNetX / DNAnexus) and a one-line plain-English summary of the current logic ("People with X AND (Y or Z), excluding W"). Because our variable set is finite and many are boolean "hasX" flags, favour **curated faceted filter tiles** (DNAnexus / cBioPortal) over a heavyweight drag-from-ontology builder — but keep i2b2-style **drag-into-group** as an optional advanced affordance if grouping needs to feel tactile. Reserve a REDCap-style raw-logic escape hatch only for power users, behind an "advanced" toggle.

---

## Sources

- OHDSI — *The Book of OHDSI*, Chapter 10 "Defining Cohorts" (rule-based model 10.2; ATLAS implementation 10.7; inclusion criteria & "exactly 0 occurrences" for absence): https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html
- OHDSI — "Implementation of inclusion and exclusion criteria in clinical studies in OHDSI ATLAS software" (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC10725886/
- i2b2 Community Wiki — "Query Panel Layout - Detailed Review" (Groups, OR-within green "one or more of these", AND box, Exclude -> pink "none of these", Occurs >Nx, Dates, timing toggle): https://community.i2b2.org/wiki/display/webclient/Query+Panel+Layout+-+Detailed+Review
- i2b2 Community Wiki — "3. Query Tool": https://community.i2b2.org/wiki/display/webclient/3.+Query+Tool
- i2b2 Web Client Help v1.8.1 (PDF): https://www.i2b2.org/webclient/help/I2B2_Webclient_Help_v1_8_1.pdf
- All of Us Researcher Workbench — "Selecting Participants Using the Cohort Builder" (Include/Exclude regions, AND circle / OR text, Groups, Modifiers, suppress-from-count, Refresh count): https://support.researchallofus.org/hc/en-us/articles/360039585591-Selecting-Participants-Using-the-Cohort-Builder
- All of Us — "Using the temporal feature within the Cohort Builder": https://support.researchallofus.org/hc/en-us/articles/19012423801364
- DNAnexus Documentation — "Defining and Managing Cohorts" (Add Filter, auto filter groups, AND-default + click-to-toggle OR, join filters all-AND/all-OR, Combine Cohorts Intersection/Union/Subtraction/Unique, "Not In" complement): https://documentation.dnanexus.com/user/cohort-browser/defining-cohorts
- DNAnexus Documentation — "Cohort Browser" overview: https://documentation.dnanexus.com/user/cohort-browser
- TriNetX Query Building (Univ. of Utah CTSI BMIC Helpdesk; "MUST have / CANNOT have", hover AND->OR toggle, Create Group, time ruler, Count Patients): https://utahctsi.atlassian.net/wiki/spaces/HELPDESK/pages/2202173442/TRINETX+Query+Building
- TriNetX tip sheet (Stony Brook, "Building queries" PDF): https://rci.stonybrook.edu/sites/default/files/documents/Building%20queries28Oct2024.pdf
- Epic SlicerDicer overview (UC Davis Health; inclusive/exclusive criteria, slices): https://health.ucdavis.edu/data/epic-slicer-dicer.html
- Epic SlicerDicer (Mindbowser feature overview): https://www.mindbowser.com/understanding-epic-slicer-dicer/
- cBioPortal docs — Study View customization & FAQ (faceted filtering, Group Comparison, Custom Selection): https://docs.cbioportal.org/deployment/customization/studyview/ ; https://docs.cbioportal.org/user-guide/faq/
- REDCap report filtering & logic (Brain-CODE / CU Anschutz logic guide; AND/OR rows, "Use advanced logic" text editor, Drag-N-Drop Logic Builder): https://indocconsortium.atlassian.net/wiki/spaces/JSDNXT/pages/995459429/How+to+use+Filtering+and+Logic+in+REDCap+reports ; https://cctsi.cuanschutz.edu/docs/librariesprovider28/redcap/redcap-logic-guide.pdf
