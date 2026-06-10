# Cohort Spec format

The Cohort Spec is the one declarative file that configures the entire Cohort
Builder. The UI, the DuckDB-WASM query builder, and the statistical disclosure
control (SDC) engine all read from a single resolved `CohortSpec`
(`src/spec/types.ts`).

## How a spec is produced

```
                 data file(s)                 optional override
                 (parquet/csv)                (YAML / TOML / JSON)
                      │                                │
                      ▼                                │
            ┌───────────────────┐                      │
            │  inference engine │  introspect schema,  │
            │  (DuckDB SUMMARIZE│  sample values,      │
            │   + heuristics)   │  guess widgets,      │
            └───────────────────┘  category,           │
                      │             sensitivity         │
                      ▼                                  ▼
              inferred base spec  ───────⊕──────►  effective CohortSpec
                                     deep-merge      (drives everything)
```

- **Zero-config**: drop a data file, get a working cohort builder from inferred
  metadata alone.
- **Override**: supply a partial spec to correct sensitivity levels, pick
  widgets, add controlled vocabularies, declare many-to-many relationships, or
  tune the SDC policy. Overrides win; anything you omit is inherited.
- **Compiled**: the bundled example specs are compiled from the ELITE workbook
  sheets (`scripts/compile_specs.py`) into override files under `public/specs/`.

## Top-level shape

| Field | Meaning |
|---|---|
| `schemaVersion` | spec format version (`"1.0"`) |
| `id`, `title`, `description` | identity |
| `primaryEntity` | logical table that is one unit of the cohort (e.g. `subjects`) |
| `tables` | map of logical table name → `TableSpec` (columns, PK, source file, role) |
| `relationships` | many-to-many / one-to-many links via junction tables |
| `variables` | the filterable variables, each bound to a table column + widget |
| `sdc` | the disclosure-control policy (per sensitivity level + global guards) |

## Widgets

| Widget | For | Filter semantics |
|---|---|---|
| `boolean` | `hasX` flags, status booleans | tri-state Any / Yes / No |
| `multiselect` | controlled vocab (race, diagnosis, APOE…) | OR within the variable |
| `bins` | age and other bucketed numerics | OR across selected buckets |
| `minCount` | "n+ visits" style | `column >= min` |
| `range` | free numeric | `min <= column <= max` |
| `internal` | present in data, not a filter | excluded from the panel |

Across variables, filters combine with **AND**; an **Exclude** region negates.

## Sensitivity → SDC treatment (defaults)

| Level | `thresholdK` | rounding | complementary | boolean-only |
|---|---|---|---|---|
| None | 1 | none | no | no |
| Low | 5 | nearest 5 | no | no |
| Medium | 10 | up to 10 | yes | no |
| High | 20 | up to 20 | yes | **yes** |

Global guards: `minQuerySetSize`, `queryRepetitionLimit`. Every parameter is
editable at runtime in the Settings panel, and overridable per-spec.

## Override semantics (merge rules)

- **Scalars** (`title`, `primaryEntity`, …): override replaces base.
- **`tables`**: merged by key; columns merged by column `name`.
- **`variables`**: merged by `name`. Fields present in the override replace the
  inferred fields; a variable name not in the base is appended. Set
  `"visible": false` to hide an inferred column.
- **`relationships`**: if the override provides any, they replace the inferred
  set (relationships are hard to infer, so this is usually where they come from).
- **`sdc`**: deep-merged level by level; omitted parameters inherit the default.

## Minimal override example (YAML)

```yaml
schemaVersion: "1.0"
id: my-cohort
title: My Cohort
primaryEntity: subjects
relationships:
  - from: subjects
    to: files
    via: subject_files
    fromKey: subject_id
    toKey: syn_id
variables:
  - name: apoeGenotype
    sensitivity: High        # promote from inferred Low
    widget: multiselect
    values: [e2/e2, e2/e3, e2/e4, e3/e3, e3/e4, e4/e4]
  - name: internal_hash
    visible: false
sdc:
  levels:
    High:
      booleanOnly: true
      thresholdK: 20
```
