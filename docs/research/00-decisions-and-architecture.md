# Cohort Builder — Decisions & Architecture

Single source of truth for the build. Synthesises the four research reports
(`01`–`04` in this folder) and the requirements locked with the user in two
interview rounds.

## 1. What we are building

A **reusable, client-side Cohort Builder web app**. A researcher filters a
synthetic aging/Alzheimer's cohort on ~47 variables and sees a live count of
matching subjects. The data lives in local files queried entirely in the
browser with **DuckDB-WASM** — no backend. For sensitive variables, a
**statistical disclosure control (SDC)** layer suppresses counts that are too
small, while still answering the boolean question *"do we have any data?"*.

Each subject is linked to one or more underlying synthetic data files,
identified by **Synapse IDs** (`syn[0-9]{6,9}`). The mapping is
**many-to-many**: a file can belong to many subjects (e.g. a cohort-level VCF)
and a subject can have many files.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| In-browser engine | DuckDB-WASM `1.32.0`, self-hosted bundles, singleton + React context |
| Data format | Parquet (primary) + CSV (fallback), bundled as static assets **and** drag-drop upload to re-point |
| Variable scope | All 47 variables from the spec |
| Data scale | ~25,000 subjects, ~6,000 files, many-to-many junction |
| SDC | Configurable policy; defaults below |
| High-sensitivity vars | **Boolean-only by default, overridable** in settings |
| Suppression depth | Primary small-cell suppression **+ rounding + complementary (secondary) suppression** on cross-tabs |
| Differencing defences | Client-side min-query-set + repeated-query guard, **documented as best-effort** |

## 3. SDC policy (default)

Per-sensitivity-level treatment. All parameters are runtime-configurable via a
settings panel.

| Level | `k` (threshold) | Rounding | Complementary suppression | Boolean-only | Display |
|---|---|---|---|---|---|
| None | 1 | none | no | no | exact count |
| Low | 5 | nearest 5 | no | no | count; `<5` if suppressed |
| Medium | 10 | up to 10 | yes | no | rounded count; `<10` if suppressed |
| High | 20 | up to 20 | yes | **yes (default)** | "Data available (≥20)" / "Insufficient data" |

**Algorithm order (load-bearing):** zero-check → boolean mode → primary
suppression → rounding → recompute totals → complementary pass on cross-tabs.

1. If `count == 0`: suppress if `zero_is_disclosive`, else show `0`.
2. If `boolean_only`: return `count >= k` as availability boolean.
3. If `count < k`: suppress (render `<k`).
4. Else round to base (`up` / `nearest` / `random`). For `random`, seed the RNG
   from a hash of the canonical query string so repeated identical queries
   cannot be averaged out.
5. Cross-tabs: mark primary-suppressed cells, then iteratively suppress the
   next-smallest cell in any row/column that has exactly one suppression and a
   visible total, until stable; recompute all totals from the rounded/suppressed
   values.

**Exposed parameters (per level):** `threshold_k`, `rounding_base`,
`rounding_mode`, `complementary_suppression`, `boolean_only`,
`zero_is_disclosive`. **Global:** `min_query_set_size`, `query_repetition_limit`.

**Honesty rule:** never conflate *suppressed* with *zero*. Distinct visual
states for: exact count, rounded (`≈`), suppressed (`<k`), boolean-available,
and true-zero.

## 4. Data model (3 tables)

```
subjects(subject_id PK, age, age_bin, sex, race, ethnicity, ethnic_group_code,
         diagnosis, diagnosis_macro, diagnosis_status, cohort, study_code,
         country_code, field_center_code, mortality_status, family_study_participant,
         family_id, has_mz_twin_data, apoe_genotype, visit_count,
         has_education, has_biomarker_data, has_functional_assessment,
         has_anthropometrics, has_cognitive_assessment,
         <21 comorbidity booleans>, comorbidity_count)

files(syn_id PK /^syn[0-9]{6,9}$/, data_type, assay_type, file_format,
      is_multi_specimen, file_size_bytes, study_code)

subject_files(subject_id, syn_id)   -- composite PK, many-to-many
```

File-level variables (`dataType`, `assayType`, `fileFormat`, `isMultiSpecimen`)
filter on `files` and require a join through `subject_files` to count subjects.
`family_id` is **internal** (not a user-facing filter) but surfaces in
non-independence warnings and summaries.

### Realistic distributions (see doc 04 for full tables + citations)

- Age right-shifted (mean ~74, range 60–100+); ≥90 collapsed to `90+` (HIPAA).
- Sex ~58% female; race ~78% White; cognitive status enriched 45/25/30
  normal/MCI/dementia.
- APOE alleles e2 8.4% / e3 77.9% / e4 13.7%, paired via Hardy-Weinberg
  (e3/e3 ~61%, e3/e4 ~21%), up-weighted for dementia cases.
- Comorbidity marginals: hypertension ~70%, diabetes ~28%, CVD ~35%,
  COPD ~14%, AF ~8%, stroke ~10%, depression ~18%, cancer ~20%.
- Comorbidities correlate via a shared latent burden score + pairwise bumps
  (DM→HTN, CVD→stroke/MI) so flags are not independent.
- File cardinality: per-sample files (FASTQ/BAM/VCF, `is_multi_specimen=false`)
  link to one subject; cohort files (multi-sample VCF, matrices, manifests,
  `is_multi_specimen=true`) link to thousands.

## 5. Frontend architecture

- **DuckDB layer**: module-level cached-promise singleton (`AsyncDuckDB` + one
  long-lived connection), wrapped in a React context + `useDuckDB()` hook.
  Survives Strict-Mode double-mount. Self-host bundles via Vite `?url`;
  `optimizeDeps.exclude: ['@duckdb/duckdb-wasm']`. `castBigIntToDouble: true` so
  `COUNT`/`SUM` come back as JS numbers. Load bundled Parquet via
  `registerFileBuffer` + `CREATE TABLE AS SELECT * FROM read_parquet(...)`;
  drag-drop via `registerFileHandle`.
- **Query builder**: compiles filter state → parameterised SQL. OR within a
  variable, AND across variables, with an Exclude region. Joins to `files` only
  when a file-level filter is active.
- **SDC engine**: pure TS module, fully unit-tested, independent of React.
  Wraps every count/cross-tab result before display.
- **UI shell** (three regions):
  - **Left**: searchable filter accordion grouped by the 6 categories +
    typeahead. Tri-state Any/Yes/No toggles for boolean `hasX`/availability
    flags; multi-select comboboxes for controlled vocab; bin checklists for age
    and visit count.
  - **Centre**: plain-English query summary with removable pills +
    SDC-aware characterisation charts.
  - **Right**: sticky live-count rail with honest provenance labels and an
    explicit "Update count" action.
  - **Settings**: SDC policy editor (per-level k, rounding, toggles) + global
    differencing guards.

## 6. Build plan (parallelised)

1. **Shared contract** (this author): `variables.json` registry + decisions doc.
2. **Synthetic data generator** (sub-agent): seeded Python → Parquet + CSV +
   manifest in `public/data/`.
3. **SDC engine + tests** (sub-agent): pure TS + Vitest.
4. **App scaffold + DuckDB layer** (this author): Vite/React/TS/Tailwind,
   DuckDB singleton, query builder.
5. **UI** (this author): filter panel, summary, count rail, charts, settings.
6. **Integration + verify + README**.

## 7. Honest limitations

- All controls are **client-side and bypassable**; a production deployment
  needs server-side enforcement of SDC and differencing limits. This app
  demonstrates the *policy and UX*, not a hardened privacy boundary.
- Synthetic data only. Distributions are plausible, not real; correlations are
  approximate. No real person is represented.
- Complementary suppression is a greedy heuristic, not optimal cell
  suppression (which is NP-hard). It defends common subtraction attacks, not all.
