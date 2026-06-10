# Cohort Builder UX Research: Interaction Patterns for a React Cohort Discovery UI

**Status:** Research synthesis
**Date:** 2026-06-10
**Scope:** Interaction models of established biomedical cohort-builder tools, distilled into concrete component and information-architecture recommendations for our React UI over a synthetic aging cohort (~47 variables, live counts, statistical disclosure control).

---

## 1. Executive summary

Five mature tools dominate biomedical cohort discovery, and they converge on a remarkably consistent interaction model despite different audiences:

- A **browse/search panel** for finding variables or concepts (category tree + typeahead).
- A **query canvas** built from **groups of criteria**, where the canonical Boolean shape is **OR within a group, AND across groups**, with an explicit **exclude/NOT** region.
- A **persistent live count** that updates as criteria change, usually with an explicit recompute affordance for expensive queries.
- A **characterisation / breakdown** view (counts per category, simple charts) over the current cohort.
- A **privacy layer** that suppresses, rounds, or perturbs small counts, with user-facing copy explaining why a number is not exact.

Our build differs from these tools in two ways that should shape the design: (1) we have a **fixed, finite variable set (~47)** rather than an open ontology of millions of concepts, so we can favour a **curated faceted-filter panel** over a heavyweight concept-search/drag-drop builder; and (2) many of our variables are **boolean "hasX" comorbidity flags and availability flags**, which call for compact toggle/checkbox treatments rather than per-criterion modal editors.

**Headline recommendation:** Build a **two-panel faceted filter layout** (left: categorised, searchable filter panel; centre/right: live count + readable query summary + characterisation), with an **optional advanced "query builder" mode** for AND/OR/NOT group composition. Treat SDC as a first-class, honest UI concern, not an afterthought: every count carries provenance (exact / rounded / suppressed / boolean-available-only).

---

## 2. Tool-by-tool interaction model

### 2.1 OHDSI ATLAS — cohort definition builder

ATLAS is the heavyweight, expressive end of the spectrum, aimed at epidemiologists building reproducible phenotypes against OMOP CDM data.

**Interaction model:**
- A cohort = **entry event(s)** + **inclusion rules** + exit/observation logic. Structure is hierarchical and explicit.
- **Concept Sets** are first-class, reusable objects: you assemble a set of standard vocabulary concepts (with descendants/mapped/excluded flags) once, then reference them across criteria.
- **Cohort entry**: define the index event (e.g. a condition occurrence), then "Restrict initial events" with attributes (age at event, sex, date windows, nth occurrence).
- **Inclusion criteria** are added as named rules ("New inclusion criteria"), each containing a **criteria group**. At the top of a group you choose the quantifier: *having all / any / at least N / at most N of the following criteria* — this is how AND/OR/threshold logic is expressed.
- Each criterion can have **nested attributes and time windows** ("during the following time period relative to index: from X days before to Y days after").
- An **attrition / inclusion-impact table** shows how each successive rule shrinks the cohort (count after each rule) — a powerful "why did my count drop" explanation.

**What to steal:** the explicit *"having all / any / at least N of the following"* quantifier per group (clearer than raw AND/OR tokens for non-programmers); the **attrition breakdown** showing count-after-each-rule; reusable concept sets (analogue for us: saved variable selections).
**What to avoid:** ATLAS's full temporal-window expressiveness and concept-set descendant logic is overkill for 47 curated variables and intimidates non-expert users. It is the cautionary tale of "too much power in the default view."

### 2.2 i2b2 Web Client — query tool (the canonical Boolean model)

i2b2's query tool is the most-copied interaction pattern in the field and defines the Boolean semantics most cohort tools imitate.

**Interaction model:**
- Left: a **navigable ontology tree** of terms (concepts) grouped into folders. Right: the **Query Tool** with numbered **Query Groups (panels)** (Groups 1–3 shown by default, more addable).
- **Drag and drop**: drag a term from the tree into a Group panel. Dropping opens a **constraint window**.
- **Boolean semantics (important and worth quoting exactly):** *items within each Group are first **ORed** together; the Groups are then **ANDed** together.* So Group1=(MI OR Angina) AND Group2=(male) means "(MI or angina) and male." This OR-within / AND-across convention is the de facto standard.
- **Exclusion**: a per-group **"Exclude"** checkbox turns that group into a NOT (e.g. "AND NOT diabetes").
- **Constraints** attached to a dropped item:
  - **Occurrence constraint** ("Occurs > Nx") — at least N instances.
  - **Date constraint** — group-level or per-item date window.
  - **Value constraint** — numeric (operator + value + units), categorical, text, or flags (high/low). The value window opens automatically on drop.
- **Query timing**: *Independent* (facts any time), *Same financial encounter* (facts in the same visit), or *Temporal Query* (ordered sequence: event A before event B).
- **Run**: results come back as **Number of Patients**, **Patient/Encounter Set**, or **Patient Breakdowns** (e.g. top-20 diagnoses, top-20 meds, length-of-stay, inpatient/outpatient).
- **Count obfuscation (the key SDC pattern):** total patient counts are **obfuscated with truncated Gaussian noise**, and the UI displays the count with a **"± 3"** indicator. Repeated identical queries are detected and locked out to prevent averaging-out the noise (the "query throttling / lockout" defence against differencing attacks).

**What to steal:** OR-within/AND-across as the default mental model; per-group **Exclude** toggle for NOT; **value constraints opened inline on selection**; patient-breakdown result type; and crucially the **honest "± noise" count display** plus repeated-query throttling as a defence against differencing.

### 2.3 All of Us Researcher Workbench — Cohort Builder (the best non-expert model)

All of Us is the closest analogue to our audience and data shape: point-and-click, no ontology mastery required, live count, strong privacy policy.

**Interaction model:**
- **"Add Criteria"** opens a drop-down of **program data / domains / concepts**; user **searches or browses** then selects.
- Criteria are organised into **groups**, with an explicit **AND / OR** choice when adding more criteria. The UI states the rule plainly: *"Use AND when you want participants to meet all criteria; use OR when you want participants to meet any criteria."*
- A separate **"And Exclude Participants"** section holds exclusion groups (clean visual separation of include vs exclude rather than a per-row NOT — easier to read).
- **Optional Modifiers**: after a criterion is added (a "shopping-cart" metaphor), you can "Apply Modifiers" (e.g. age at event, event date, number of occurrences). Modifiers are optional and vary by data type.
- **Live count**: the **right panel shows a running "Total Count"** of matching participants; a **"Refresh"** button recomputes after edits (decoupling expensive recompute from every keystroke).
- A **percentage/breakdown toggle** shows results by category (charts of demographic breakdowns).
- **SDC**: the program **cannot display any participant count < 20**; counts are **rounded to the nearest multiple of 20** (1–20 all show as 20; 426 shows as 440). **A count of zero is permitted.** The public Data Browser applies the same rounding so "8 participants with condition X" displays as 20.

**What to steal:** plain-language AND/OR copy; **physically separating include and exclude regions**; the **shopping-cart + optional modifiers** flow; **right-rail running count with explicit Refresh**; round-to-nearest-k with the "0 allowed, small values floored to k" policy.

### 2.4 UK Biobank — Data Showcase / Cohort Browser

UK Biobank is the model for **organising a large but finite, well-catalogued variable set** — directly relevant to our 47 variables (which are a small catalogue by comparison).

**Interaction model:**
- The **Showcase** organises ~thousands of fields into a **Category browse tree** (hierarchical categories group related fields: demographics, cognitive function, biomarkers, imaging, etc.).
- Each field has a **data dictionary entry**: type (categorical single/multiple, continuous, integer, date), value coding, units, participant counts, and collection notes.
- On the Research Analysis Platform, the **Cohort Browser** lets you build a cohort by adding **"tiles"** (each tile is a field/filter), filter on values, and combine tiles; phenotypic + genomic data are explorable together.

**What to steal:** the **category tree as primary IA** for a finite variable catalogue; rich **per-variable metadata** (type, coding, units, n) surfaced near the filter; the **"tile" idea** as a unit of one applied filter that can be added, edited, and removed independently.

### 2.5 TriNetX — LIVE Query Builder

TriNetX is the polished commercial no-code model with a strong "explain the impact of each criterion" story.

**Interaction model:**
- **Query Builder**: specify diagnoses, procedures, labs, etc., with **drag-and-drop logical connectors** (AND/OR/NOT) between criteria blocks; temporal and logical relations expressed visually. No coding or terminology mastery required.
- **Explore Cohort / Base Analytics**: prevalence of diagnoses/treatments/procedures within the cohort, lab means and SDs, and crucially **quantify the impact of each criterion on cohort size** (the attrition story again).
- **SDC**: patient counts are **rounded up to the nearest 10** for all cohort sizes as a privacy measure.

**What to steal:** drag-and-drop **connector tokens** for advanced users who want explicit AND/OR/NOT; the **"impact of each criterion on cohort size"** analytic (pairs with ATLAS attrition); round-up-to-k count display.

### 2.6 cBioPortal — Study View (the characterisation-first model)

cBioPortal inverts the usual flow: instead of building a query then seeing results, you **start from a dashboard of charts and filter by clicking**.

**Interaction model:**
- **Study View** shows a **grid of clinical/genomic charts** (pie charts for categoricals, histograms for continuous, bar charts, survival plots). ~20 charts shown by default; more added via an **"Add Charts"** dropdown.
- **Filter-by-clicking**: selecting a pie slice (e.g. "Glioblastoma") or a histogram range filters the entire cohort; all other charts and the **case count** update live. This is **cross-filtering / brushing** — every chart is both an output and an input.
- A **filter pill bar** shows the active selections as removable chips.
- **Comparison View** compares two or more selected groups across attributes.

**What to steal:** **cross-filtering** (charts double as filters), the **chart-type-per-variable mapping** (pie for low-cardinality categorical, histogram for continuous, bar for ordinal), the **removable filter-pill bar** as the readable query summary, and **"Add Charts"** to manage breakdown density.

### 2.7 Sage Bionetworks Synapse — faceted data portals

Synapse is annotation-driven: data is tagged with **controlled-vocabulary key–value annotations** (assay, species, data type, etc.), and **faceted search** lets users narrow file/dataset lists by ticking facet values with live result counts beside each value. This is the lightweight faceted model: **each facet = one variable, each facet value carries its own count**. Relevant as the simplest, most scalable pattern for our boolean/categorical flags.

---

## 3. Cross-tool pattern synthesis

| Pattern | i2b2 | ATLAS | All of Us | UK Biobank | TriNetX | cBioPortal |
|---|---|---|---|---|---|---|
| Variable discovery | ontology tree | concept sets | search + browse | category tree | search | chart grid |
| Boolean default | OR-in / AND-across | "all/any/N of" | explicit AND/OR | tile combine | drag connectors | click-to-filter |
| NOT / exclude | per-group Exclude | exclusion rules | separate Exclude section | — | NOT connector | deselect |
| Live count | obfuscated total | attrition table | right-rail + Refresh | tile count | per-criterion impact | live case count |
| Breakdown | patient breakdowns | inclusion impact | %/category view | data dictionary | Explore Cohort | cross-filter charts |
| SDC method | Gaussian noise ± 3 + lockout | (deployment policy) | round to 20, floor small→20, 0 ok | (controlled access) | round up to 10 | (controlled access) |

**Consensus defaults worth adopting:** OR-within / AND-across; physically separated exclude region; persistent right-rail count with explicit recompute; per-variable metadata; chart-type matched to variable type; honest count provenance.

---

## 4. Recommendations for OUR build

### 4.1 Information architecture

Recommended layout: **three regions** in a responsive two-/three-column shell.

```
+----------------------+--------------------------------+-------------------+
|  FILTER PANEL        |  QUERY SUMMARY + RESULTS       |  COUNT RAIL       |
|  (left, scrollable)  |  (centre)                      |  (right, sticky)  |
|                      |                                |                   |
|  [search variables]  |  Readable query as text:       |  Matching         |
|                      |  "Age 65-74 AND has           |  subjects         |
|  v Demographics      |   diabetes AND (APOE e4/e4     |   ≈ 1,240         |
|    Age   [range]     |   OR e3/e4) AND has MRI,       |  (rounded to 10)  |
|    Sex   [multi]     |   EXCLUDING has cancer"        |                   |
|    Race  [multi]     |                                |  [Update count]   |
|  v Comorbidities     |  [filter pills, removable]     |                   |
|    [x] has diabetes  |                                |  Breakdown:       |
|    [ ] has CKD ...   |  Characterisation charts       |   by sex (pie)    |
|  v Data modality     |  (counts per category)         |   by age (bar)    |
|  v Genetics          |                                |                   |
|  v Assessments       |                                |                   |
+----------------------+--------------------------------+-------------------+
```

**Group the ~47 variables into ~5 collapsible categories** (mirrors UK Biobank's category tree and reduces to a scannable list):

1. **Demographics** — age (binned range), sex, race (multi-select controlled vocab), ethnicity (multi-select).
2. **Comorbidities** — the many `hasX` boolean flags (diabetes, CKD, hypertension, dementia, etc.).
3. **Data modality** — imaging, omics, EHR, wearable (boolean availability flags by modality).
4. **Genetic stratification** — APOE genotype (multi-select of e2/e3/e4 combinations), other variants.
5. **Assessment availability** — `hasCognitiveAssessment`, `hasGaitAssessment`, etc. (boolean availability flags).

Place a **global typeahead search** above the categories that filters the visible variable list (matches All of Us "search or browse"). Each category is a **collapsible accordion section** (W3C APG accordion pattern). Show an **active-filter count badge per category header** so collapsed sections still signal that they contain active filters.

**Two interaction tiers:**
- **Default (faceted) mode** — the filter panel above. All criteria are implicitly **ANDed across variables**, with **OR within a variable's multi-select** (e.g. selecting race = Black OR White). This matches the i2b2 OR-within/AND-across convention and is what 90% of users need. No drag-drop, no modals.
- **Advanced (query builder) mode** — an opt-in toggle exposing **criteria groups** with explicit group-level "match ALL / match ANY" quantifiers (ATLAS-style, clearer than raw AND/OR) and a **separate Exclude region** (All of Us-style). Use this only when users need cross-variable OR (e.g. "diabetes OR CKD") or nested logic.

### 4.2 Filter widget types matched to our data

| Variable class | Examples | Widget | Notes |
|---|---|---|---|
| Boolean `hasX` flags | comorbidity flags | **Tri-state checkbox / segmented toggle**: *Any / Yes / No* | Default *Any* = not filtered. Avoid plain on/off (loses "explicitly without X"). Show count beside each value (Synapse facet style). |
| Availability flags | hasMRI, hasOmics | **Tri-state toggle** *Any / Available / Not available* | Same control; group under Data modality / Assessments. These are the SDC-friendliest: even when counts are suppressed, "available: yes/no" is itself a publishable boolean. |
| Multi-select controlled vocab | race, ethnicity, diagnosis, APOE genotype | **Multi-select combobox / checklist with typeahead** | OR semantics within the control. Show per-value counts. For APOE, list the genotype pairs explicitly (e2/e2 … e4/e4); allow grouping ("any e4 carrier"). Long lists get an internal search box. |
| Binned continuous | age | **Discrete bin checklist (preferred) or range slider** | Prefer **predefined bins** (e.g. 50-59, 60-69, 70-79, 80+) over a free slider: bins align with SDC (you control cell sizes) and avoid disclosive single-year selections. If a slider is used, snap to bins. |
| Ordinal categorical | severity scores, stage | **Segmented control or ordered checklist** | Preserve order in the UI. |

Design rules for widgets:
- **Show the per-value count next to every facet value** ("has diabetes (≈ 320)"), respecting SDC (rounded/suppressed). This is the single highest-value affordance — it tells users the consequence of a click before they click (Synapse/faceted-search pattern).
- **Default state = unfiltered ("Any")** for every variable; never pre-select.
- Each applied filter becomes a **removable pill** in the centre query summary (cBioPortal pattern).

### 4.3 AND/OR/NOT composition and readable query text

- **Default mode semantics:** AND across variables, OR within a multi-select. Render this as a **plain-English sentence** updated live, e.g.:
  > Subjects aged **65–74**, with **diabetes**, carrying **APOE e3/e4 or e4/e4**, with **MRI available**, **excluding** those with **cancer**.
- Bold the user's chosen values; keep connective words ("with", "or", "excluding") in normal weight. Avoid showing raw `AND`/`OR`/`NOT` tokens in default mode — All of Us's plain-language framing tests better with non-programmers.
- **Advanced mode:** show explicit group cards. Each group header reads **"Subjects must match [ALL ▾ | ANY ▾] of:"** (ATLAS quantifier). A distinct **"Exclude subjects who match:"** card (All of Us separation) holds NOT logic. Connectors between groups render as labelled chips, not just operators.
- Keep a **machine-readable query object** (the canonical state) and render both the pills and the sentence from it. The same object serialises for save/share/export and for the count API.
- Provide **"Edit" affordance on every pill and sentence fragment** (click the fragment to jump to and open that filter).

### 4.4 Live count display with SDC (the honest-uncertainty core)

This is where the design must be most disciplined. Synthesise the three real-world SDC strategies and present provenance honestly.

**Choose an SDC policy and state it once, visibly.** Recommended for a synthetic aging cohort:
- **Suppress + round.** Counts at or below a threshold *k* (e.g. k = 10, following OpenSAFELY's <=7 redaction generalised, or All of Us's 20) are **not shown as a number**. Larger counts are **rounded** (to nearest 10) so a displayed number never pins down an individual.
- **Zero is allowed** (All of Us convention), but beware **0% / 100% disclosure** ("none of subjects in bin X have Y") — flag and optionally suppress these too (OpenSAFELY caution).
- **Guard against differencing / secondary disclosure** (OpenSAFELY's central lesson): rounding each cell independently can leak via subtraction, and repeated near-identical queries can average out noise (i2b2's lockout). Mitigations: round consistently, suppress dependent margins, and **throttle/deduplicate rapid repeated queries** server-side.

**UI presentation of the count rail:**
- **Above threshold (rounded):** `≈ 1,240 subjects` with a subtle `(rounded to nearest 10)` caption and an info tooltip. Use `≈` to signal non-exactness honestly — never show a precise-looking number that is actually rounded.
- **At/below threshold (suppressed):** do **not** show a number. Show a clear state: `Fewer than 10 subjects — count hidden to protect privacy.` Use a distinct visual treatment (muted, lock icon), not a `0` or a blank that could be misread.
- **Boolean fallback for suppressed cells:** where a count is suppressed but the *existence* signal is safe and useful, show the **"data available" boolean** instead of a number: `Matching subjects: hidden (< 10). Data for this combination: available.` This is the honest middle ground — it tells the researcher the cohort is non-empty and queryable without disclosing size. Make the distinction between *suppressed-nonzero* and *true-zero* explicit, because conflating them is the most common way these UIs mislead.
- **Never imply precision you do not have.** Avoid bare integers for rounded values; avoid spinner-then-flash-of-exact-then-round (which leaks the true value); compute SDC server-side and only ever send the disclosure-safe value to the client.
- **Recompute affordance:** debounce cheap recomputes; for expensive ones, follow All of Us — show a **"Update count"** button and a *stale* indicator when filters changed since the last count. Show a skeleton/spinner while computing.

**Suggested copy (British English, honest, non-alarming):**
- Rounded: *"About 1,240 subjects match. Counts are rounded to the nearest 10 to protect participant privacy."*
- Suppressed: *"Fewer than 10 subjects match this combination, so the exact count is hidden. You can broaden your filters to see a count."*
- Boolean fallback: *"The exact count is hidden for privacy. Data for this combination is available."*
- Zero: *"No subjects match these filters."* (true zero, distinct styling from suppressed.)

### 4.5 Characterisation / breakdown panels

Offer an on-demand **characterisation panel** over the current cohort (i2b2 patient breakdowns + cBioPortal study view + All of Us %-view).

Chart-type-per-variable mapping:

| Variable type | Chart | Rationale |
|---|---|---|
| Low-cardinality categorical (sex, modality) | **Pie / donut** or single stacked bar | Quick part-of-whole; cBioPortal default. |
| Multi-category nominal (race, ethnicity, diagnosis) | **Horizontal bar** (sorted) | Readable labels, easy comparison; avoid pies > 5 slices. |
| Ordinal / binned continuous (age bins, severity) | **Vertical bar / histogram** preserving order | Shows distribution shape. |
| Boolean flags (comorbidities, availability) | **Compact "yes / no / unknown" stacked bars or a small-multiples grid** | Many flags at once; sparkline-like density. |
| Genetic strata (APOE) | **Sorted bar** of genotype frequencies | Discrete categories. |

Characterisation rules:
- **Every breakdown cell is SDC-controlled** the same way as the headline count: suppress small cells, round, and watch margins for secondary disclosure (OpenSAFELY differencing). Render suppressed bars/slices as a labelled "< 10 (hidden)" segment rather than dropping them silently (dropping changes the visual total and is itself disclosive).
- **Cross-filtering (optional, advanced):** allow clicking a bar/slice to add that value as a filter (cBioPortal). Powerful, but gate it so casual users do not accidentally narrow the cohort.
- **"Add charts" control** (cBioPortal) to manage density — default to a curated handful (sex, age, top comorbidities, modality availability), let users add the rest.
- Consider an **attrition view** (ATLAS / TriNetX): "count after each filter" so users understand which filter shrank the cohort — but apply SDC to each step and label rounded steps.

### 4.6 Accessibility and honest-uncertainty UI copy

- **Accordion filter sections:** W3C APG accordion pattern — header is a `<button>` with `aria-expanded` and `aria-controls`; panel is the controlled region. Avoid `role="region"` proliferation beyond ~6 panels (WAI guidance) — for our 5 categories this is fine; use `aria-labelledby` on each.
- **Live count as an ARIA live region:** wrap the count rail in `aria-live="polite"` (not assertive — avoid interrupting) so screen-reader users hear the count update after a filter change or recompute. Announce the *full* honest string ("About 1,240 subjects, rounded to nearest 10") not just the digits.
- **Filter pills:** each removable pill is a button with an accessible name ("Remove filter: age 65–74"); manage focus when a pill is removed (move focus to the next pill or the summary).
- **Multi-select comboboxes:** follow APG combobox/listbox patterns; full keyboard operation (type-ahead, arrow navigation, Esc to close); never rely on hover-only for per-value counts.
- **Tri-state toggles:** expose the three states to assistive tech (e.g. radio group "Any / Yes / No" rather than an ambiguous indeterminate checkbox, which screen readers handle inconsistently).
- **Do not rely on colour alone** for suppressed vs zero vs rounded states — pair colour with an icon and text ("hidden", "0", "≈").
- **Honest-uncertainty copy principles:**
  - Name the reason ("to protect participant privacy"), not just the effect.
  - Use `≈` / "About" for rounded numbers consistently.
  - Distinguish *suppressed-but-present* from *genuinely zero* in words, every time.
  - Offer the constructive next step ("broaden your filters to see a count").
  - Never present a privacy-perturbed number with false precision or a trailing-decimal that implies exactness.

### 4.7 Save / share / reproducibility

- Persist the canonical query object; allow **named saved cohorts** (ATLAS/All of Us) and a **shareable serialisation** (URL params or exportable JSON) — useful for our synthetic dataset and reproducible documentation.
- Show **last-computed timestamp** next to the count for provenance.

---

## 5. Suggested React component inventory

- `FilterPanel` — scroll container; hosts global `VariableSearch` (typeahead) + ordered `FilterCategory` accordions.
- `FilterCategory` — APG accordion section; header shows active-filter badge.
- `BooleanFlagFilter` — tri-state Any/Yes/No segmented control with per-value count.
- `MultiSelectVocabFilter` — combobox + checklist with internal search and per-value counts (race, ethnicity, diagnosis, APOE).
- `BinnedRangeFilter` — bin checklist (default) with optional snap-to-bin slider (age).
- `QuerySummary` — renders pills (`FilterPill`) + plain-English sentence from the query object; pills and fragments are editable.
- `QueryBuilderAdvanced` — group cards with ALL/ANY quantifier + separate `ExcludeGroup`.
- `CountRail` — sticky; `CountDisplay` with provenance states (`exact`/`rounded`/`suppressed`/`boolean-available`/`zero`), `UpdateCountButton`, stale indicator, `aria-live="polite"`.
- `Characterisation` — chart grid; `AddChartsMenu`; chart components matched per variable type; each SDC-aware.
- `AttritionPanel` (optional) — count-after-each-filter, SDC-applied.
- A single **`useCohortQuery` hook / reducer** owning the canonical query object, debounced count fetching, and SDC-tagged responses.

---

## 6. Key design decisions (the short list)

1. **Faceted filter panel by default; advanced query-builder mode on demand.** Match the 47-variable curated reality, not ATLAS's open ontology.
2. **OR-within-a-variable, AND-across-variables** as the default Boolean (i2b2 convention); explicit ALL/ANY quantifier + separate Exclude region in advanced mode.
3. **Five collapsible categories** (demographics, comorbidities, data modality, genetics, assessments) with global typeahead.
4. **Tri-state toggles for the many boolean flags**, multi-select comboboxes for controlled vocab, **bin checklists for age**.
5. **Per-value counts beside every facet value**, SDC-respecting.
6. **Honest count provenance**: `≈ rounded` / `< k suppressed` / `data available (boolean fallback)` / `true zero` — never false precision, never conflate suppressed with zero.
7. **Server-side SDC** (suppress at/below k, round above, guard margins, throttle repeated queries) — the client only ever receives disclosure-safe values.
8. **Plain-English readable query** + removable pills generated from one canonical query object.
9. **SDC-aware characterisation charts** matched to variable type; suppressed cells labelled, not dropped.
10. **Accessibility baked in**: APG accordion/combobox patterns, `aria-live` count, icon+text for SDC states.

---

## Sources

- The Book of OHDSI — Chapter 10, Defining Cohorts: https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html
- Implementation of inclusion and exclusion criteria in clinical studies in OHDSI ATLAS software (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC10725886/
- FinnGen Handbook — Examples on cohort building with Atlas: https://docs.finngen.fi/working-in-the-sandbox/which-tools-are-available/atlas/quick-guide/examples-on-cohort-building-with-atlas
- ATLAS User Process Guide (Mount Sinai): https://labs.icahn.mssm.edu/msdw/wp-content/uploads/sites/350/2021/09/ATLAS-User-Process-Guide-1.pdf
- i2b2 Web Client — 3. Query Tool (Community Wiki): https://community.i2b2.org/wiki/display/webclient/3.+Query+Tool
- i2b2 Web Client — Temporal and Panel Timing Constraints: https://community.i2b2.org/wiki/display/webclient/Temporal+and+Panel+Timing+Constraints
- i2b2 Web Client — Query Panel Layout, Detailed Review: https://community.i2b2.org/wiki/display/webclient/Query+Panel+Layout+-+Detailed+Review
- Strategies for maintaining patient privacy in i2b2 (PMC) — Gaussian noise obfuscation, ±3, query lockout: https://pmc.ncbi.nlm.nih.gov/articles/PMC3241166/
- All of Us — Selecting Participants Using the Cohort Builder: https://support.researchallofus.org/hc/en-us/articles/360039585591-Selecting-Participants-Using-the-Cohort-Builder
- All of Us — Using the Temporal Feature within the Cohort Builder: https://support.researchallofus.org/hc/en-us/articles/360043016291-How-to-comply-with-the-All-of-Us-Data-and-Statistics-Dissemination-Policy
- All of Us — How does the Data Browser protect participant privacy? (round to 20, floor small→20, zero allowed): https://www.researchallofus.org/faq/how-does-the-data-browser-protect-participant-privacy/
- All of Us Public Data Browser: https://databrowser.researchallofus.org/
- UK Biobank — Finding data and how it is organised: https://community.ukbiobank.ac.uk/hc/en-gb/articles/26121043854365-Finding-data-and-how-it-is-organised
- UK Biobank Research Analysis Platform — Data structure / Cohort Browser: https://dnanexus.gitbook.io/uk-biobank-rap/getting-started/data-structure
- UK Biobank Showcase Schema: https://biobank.ctsu.ox.ac.uk/crystal/schema.cgi
- TriNetX LIVE Platform: https://trinetx.com/solutions/live-platform/
- TriNetX Advanced Analytics: https://trinetx.com/solutions/live-platform/features/advanced-analytics/
- TriNetX Clinical Query Tool (Mount Sinai deck) — count rounded up to nearest 10: https://labs.icahn.mssm.edu/minervalab/wp-content/uploads/sites/342/2023/10/TriNetX-PPT-101823.pdf
- cBioPortal — Study View customisation / Add Charts: https://docs.cbioportal.org/deployment/customization/studyview/
- cBioPortal — Integrative Analysis (Cerami et al., PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC4160307/
- Sage Bionetworks Synapse — annotations and faceted search: https://help.synapse.org/docs/Glossary.2667938103.html
- Sage Bionetworks — Synapse platform: https://sagebionetworks.org/platform/synapse
- OpenSAFELY — Applying statistical disclosure control (redact <=7, primary vs secondary disclosure, differencing, 0%/100% caution): https://docs.opensafely.org/outputs/sdc/
- W3C WAI-ARIA APG — Accordion pattern: https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
- WAI-ARIA Authoring Practices Guide: https://wai-aria-practices.netlify.app/aria-practices/
