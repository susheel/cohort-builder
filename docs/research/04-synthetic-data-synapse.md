# Synthetic Biomedical Cohort Data + Synapse Conventions

Research for the browser-based Cohort Builder (DuckDB-WASM), targeting ~25,000 synthetic
subjects and ~6,000 synthetic data files for an aging / Alzheimer's disease (AD) cohort
discovery tool.

Goal: generate fake-but-plausible data whose distributions, prevalences, genotype
frequencies, and subject<->file relationships are realistic enough that the tool's filters,
facets, and correlations behave like a real AD/aging portal (e.g. the AD Knowledge Portal),
without exposing any real participant data.

Confidence: High on Synapse conventions and APOE/comorbidity prevalences (multiple
authoritative sources agree). Medium on exact comorbidity co-occurrence coefficients
(literature reports patterns and odds ratios more than clean correlation matrices, so the
proposed values are calibrated approximations, not canonical constants).

---

## 1. Synapse ID conventions and the entity/file model

### 1.1 The `syn` accession format

Every object in Synapse is assigned a globally unique, immutable identifier of the form
`syn` followed by digits, e.g. `syn12345678`, commonly called a **synID**. The ID never
changes even if the entity is renamed or moved. ([Synapse docs][syn-docs], [Sage Bionetworks][synapse-org])

- Format in practice: `syn` + an integer with no leading zeros, historically 6 to 9 digits
  as the accession space has grown.
- The target regex `syn[0-9]{6,9}` is a sound validator for synthetic data. To match a
  whole token, anchor it: `^syn[0-9]{6,9}$`. (Real Synapse can in principle exceed 9 digits
  as the namespace fills, but 6 to 9 digits comfortably covers the realistic range and keeps
  generated IDs visually authentic.)
- A synID can be suffixed with a version, `syn12345678.3`, but the bare accession is the
  canonical reference. For synthetic file rows, omit versions unless versioning is modelled.

### 1.2 What is a Synapse "entity"

Synapse is a platform for collaborative, shared biomedical datasets run by Sage Bionetworks.
The unit of content is an **entity**. Entity types that receive a synID include:
**File, Folder, Project, Table, EntityView (View), Dataset, DatasetCollection,
MaterializedView, SubmissionView, VirtualTable, Link, Wiki, and Docker repository.**
([Synapse docs][syn-docs])

Key types for this tool:

- **Project**: top-level container for a study/program. Has its own synID.
- **Folder**: hierarchical container within a project. Has its own synID.
- **File**: a stored data object (FASTQ, BAM, VCF, CSV, etc.). Has its own synID and is the
  thing users browse and select. This is the entity our `files` table represents.
- **Dataset**: a curated, flat, versioned collection of File entities (a "manifest" of
  files drawn from anywhere in the project). A file can appear in multiple datasets.
- **DatasetCollection**: a collection of Datasets.
- **EntityView / Table**: query layer that surfaces files and their annotations as rows;
  this is conceptually what a portal's "Explore Data" grid is built on.

So the real-world hierarchy is roughly: **Project -> Folder(s) -> File(s)**, with **Datasets**
and **Views** providing flat, query-friendly groupings on top. A File belongs to exactly one
parent Folder/Project (its storage location) but can be referenced by many Datasets and
Views, which is the natural origin of many-to-many behaviour.

### 1.3 File metadata: annotations and controlled vocabularies

Synapse metadata lives as **annotations**: key-value pairs attached to an entity, where the
key names an aspect (e.g. `assay`, `dataType`, `fileFormat`, `species`, `tissue`) and the
value is the controlled term (e.g. `rnaSeq`, `geneExpression`, `fastq`, `Human`).
([Synapse annotations][syn-annot])

The **AD Knowledge Portal** (Sage-hosted, AMP-AD) is the most directly relevant model.
([AD KP metadata help][adkp-meta], [AD KP overview paper][adkp-paper]) Its data model splits
metadata into three linked tables plus file annotations:

1. **Individual** metadata: one row per subject (human/animal/cell line) - demographics,
   diagnosis, APOE, etc.
2. **Biospecimen** metadata: one row per specimen derived from an individual (e.g. a brain
   region, a blood draw). One individual -> many specimens.
3. **Assay** metadata: details of the assay run on a specimen (library prep, platform).

A **subset** of metadata is also stored as annotations directly on the data files, while the
full metadata lives in separate CSV manifests. The Explore UI builds facets from file
annotations such as **Assay** and **Tissue**. ([AD KP metadata help][adkp-meta])

Common annotation keys and example controlled-vocabulary values (drawn from the AD KP data
model and Synapse annotation examples):

| Annotation key | Purpose | Example controlled values |
|---|---|---|
| `dataType` | High-level data category | `geneExpression`, `genomicVariants`, `proteomics`, `clinical`, `image`, `metabolomics`, `epigenetics` |
| `assayType` / `assay` | Experimental assay | `rnaSeq`, `scrnaSeq`, `wholeGenomeSeq`, `wholeExomeSeq`, `snpArray`, `ChIPSeq`, `methylationArray`, `LC-MSMS`, `MRI`, `PET` |
| `fileFormat` | Physical file format | `fastq`, `bam`, `cram`, `vcf`, `bed`, `csv`, `tsv`, `bigwig`, `mzML`, `dcm`, `nii`, `idat` |
| `species` | Organism | `Human`, `Mouse` |
| `tissue` / `organ` | Sample origin | `dorsolateral prefrontal cortex`, `temporal cortex`, `blood`, `cerebellum`, `hippocampus` |
| `isMultiSpecimen` | Whether file aggregates many specimens | `true`, `false` |
| `consortium` / `study` | Provenance grouping | `AMP-AD`, `ROSMAP`, `MSBB`, `Mayo` |

For synthetic data, the key insight is: **facets/filters in the UI are driven by these
controlled vocabularies**, so the generator should draw `dataType`, `assayType`, and
`fileFormat` from coherent value sets where assay implies plausible format (e.g.
`wholeGenomeSeq` -> {`fastq`, `bam`, `cram`, `vcf`}; `rnaSeq` -> {`fastq`, `bam`, `bigwig`}).

---

## 2. Realistic value distributions and controlled vocabularies

These are intended to make generated data plausible, not perfectly epidemiologically exact.
Citations support the order of magnitude so correlations and facet counts look believable.

### 2.1 Demographics

**Age** - aging cohorts skew old. NACC / ADRC participants cluster in the 70s
(mean age ~73 in cognitively normal subsets). ([NACC representativeness][nacc])
Model age as a **truncated, right-shifted distribution over 60-100+**, e.g. a normal
centred ~74 with SD ~8, truncated to [60, 102], or a gamma shifted to start at 60. Aim for:

| Age band | Approx. share |
|---|---|
| 60-69 | 25% |
| 70-79 | 40% |
| 80-89 | 28% |
| 90-100+ | 7% |

**Sex** - AD/aging research cohorts are female-skewed (often ~60-65% women; one NACC
cognitively-normal subset was 64.9% women). ([NACC representativeness][nacc]) Use
**~58% female / 42% male** as a default; allow a config knob.

**Race / Ethnicity** - US ADRC cohorts are predominantly non-Hispanic White, with Black/
African American the largest minority and Asian/Indigenous groups under-represented.
([NACC representativeness][nacc]) A defensible default distribution:

| Race | Share | Ethnicity | Share |
|---|---|---|---|
| White | 78% | Not Hispanic or Latino | 90% |
| Black or African American | 13% | Hispanic or Latino | 9% |
| Asian | 4% | Unknown / not reported | 1% |
| American Indian / Alaska Native | 1% | | |
| More than one race | 3% | | |
| Unknown / not reported | 1% | | |

(Treat race and ethnicity as independent fields, mirroring the US Census/NIH two-axis model.)

### 2.2 Comorbidity prevalences in 65+ populations

More than **90%** of adults 65+ have at least one chronic condition; multimorbidity rises
to ~80% in those 85+. ([CDC chronic disease][cdc-chronic], [multimorbidity review][multimorb-rev])
Suggested baseline marginal prevalences for the 65+ aging cohort (binary flags):

| Condition | Approx. prevalence (65+) | Source note |
|---|---|---|
| Hypertension | 60-75% (use ~70%) | ~50% at 60-69, ~75% at 70+ ([CDC/NHANES 65+][hyp-65]) |
| Hyperlipidaemia / dyslipidaemia | ~50% | ([CDC/NHANES 65+][hyp-65]) |
| Diabetes (type 2) | ~27-29% (use ~28%) | ~29.2% of 65+ ([diabetes 65+][dm-65]) |
| Cardiovascular disease (any) | ~30-40% (use ~35%) | "1 in 3 adults 65+ has a cardiac/renal/metabolic condition" ([CDC MCC][cdc-mcc]) |
| Coronary heart disease / prior MI | ~12-20% (use ~15%) | rises steeply with age ([CDC chronic][cdc-chronic]) |
| Stroke (history) | ~8-12% (use ~10%) | higher in diabetics (~22%) ([diabetes 65+][dm-65]) |
| Atrial fibrillation | ~6-9% (use ~8%) | 7.6% at 75, up to ~13% at 85+ ([AF prevalence][af-prev]) |
| COPD | ~12-15% (use ~14%) | global pooled ~15% in 65+ ([COPD 65+][copd-65]) |
| Depression | ~15-25% (use ~18%) | higher (~44%) in COPD subgroups ([COPD 65+][copd-65]) |
| Cancer (history of any) | ~18-25% (use ~20%) | rises with age ([CDC chronic][cdc-chronic]) |
| Dementia / cognitive impairment | enriched by design | see note below |

**Dementia note**: in a generic 65+ population dementia is ~10%, but an **AD cohort is
enriched by design**. For an AD/aging discovery tool, model a clinical-diagnosis field
(`cognitiveStatus` in {`normal`, `MCI`, `dementia`}) with an enriched split such as
**45% normal / 25% MCI / 30% dementia**, then let dementia status raise the probability of
depression, stroke, and AF (see co-occurrence below). This mirrors ADRC over-sampling.

### 2.3 APOE genotype frequencies

APOE has three alleles (e2, e3, e4) -> six genotypes. US allele frequencies are roughly
**e2 ~8.4%, e3 ~77.9%, e4 ~13.7%**. ([ScienceInsights/US][apoe-us], [APOE world distribution][apoe-world])
Under Hardy-Weinberg from those allele frequencies, the genotype distribution is approximately:

| Genotype | Approx. frequency (general US/European-ancestry) | AD relevance |
|---|---|---|
| e3/e3 | ~61% | reference risk |
| e3/e4 | ~21% | ~3x increased AD risk |
| e2/e3 | ~13% | protective |
| e4/e4 | ~2% | highest AD risk (~12-15x) |
| e2/e4 | ~2.3% | mixed |
| e2/e2 | ~0.7% | protective, rare |

Two modelling options:
1. **Sample alleles** independently at (e2=0.084, e3=0.779, e4=0.137) and pair them
   (Hardy-Weinberg). Simple and reproducible.
2. **Sample genotypes** directly from the table above. Use this if you want exact control
   of e4 carrier rate.

**Enrichment hook**: tie APOE to `cognitiveStatus`. In a real AD cohort, e4 carriers are
over-represented among dementia cases. After sampling cognitive status, up-weight e4-carrying
genotypes for dementia subjects (e.g. raise e3/e4 + e4/e4 combined from ~23% baseline to
~45-55% among dementia cases) so the tool's APOE-by-diagnosis crosstab looks real.

### 2.4 Comorbidity co-occurrence (multimorbidity)

Flags must not be independent. Hypertension and diabetes cluster strongly; cardiometabolic
conditions co-occur; depression tracks with chronic burden; AF/stroke/MI form a
cardiovascular cluster. ([multimorbidity patterns][multimorb-clust], [DM+HTN co-occurrence][dm-htn])

Practical generation strategy (latent-burden + conditional bumps):

1. Draw a per-subject **latent frailty/burden score** `b ~ Beta`, increasing with age. This
   single shared factor induces positive correlation across all conditions (sicker subjects
   get more flags) without hand-tuning every pair.
2. For each condition, set probability = `baseline_prevalence` adjusted by `b` and age, then
   apply **pairwise conditional bumps** for known clusters:
   - Diabetes present -> multiply hypertension odds up (HTN ~80%+ given DM). ([DM+HTN][dm-htn])
   - Hypertension/diabetes present -> raise CVD, CHD, stroke probabilities.
   - CVD or AF present -> raise stroke and MI probabilities (cardiovascular cluster).
   - Any 2+ chronic conditions -> raise depression probability.
   - Dementia present -> raise depression, stroke, AF probabilities.
3. Sanity-check the resulting marginal prevalences against section 2.2 after generation and
   rescale baselines if drift exceeds a few points.

This yields believable multimorbidity (correlated flags, age gradient) while keeping the
generator simple and seedable.

---

## 3. Many-to-many subject<->file data modelling

### 3.1 Why many-to-many

In real portals a single file can map to many subjects (a cohort-level multi-sample VCF, a
QC summary, a genotype matrix) and a single subject can map to many files (their FASTQ, BAM,
VCF, RNA-seq, imaging). The AD KP's own three-table individual/biospecimen/assay split
reflects exactly this fan-out. ([AD KP metadata help][adkp-meta]) A junction table is the
clean relational expression of it.

### 3.2 Proposed three-table schema (DuckDB DDL)

```sql
-- 1) Subjects (the "individual" table)
CREATE TABLE subjects (
    subject_id        VARCHAR PRIMARY KEY,   -- e.g. 'SUB_000001'
    age               INTEGER NOT NULL,      -- 60..102
    sex               VARCHAR NOT NULL,      -- 'Female' | 'Male'
    race              VARCHAR NOT NULL,      -- controlled vocab (sec 2.1)
    ethnicity         VARCHAR NOT NULL,      -- 'Hispanic or Latino' | 'Not Hispanic or Latino' | 'Unknown'
    cognitive_status  VARCHAR NOT NULL,      -- 'normal' | 'MCI' | 'dementia'
    apoe_genotype     VARCHAR NOT NULL,      -- 'e3/e3','e3/e4','e2/e3','e4/e4','e2/e4','e2/e2'
    apoe_e4_carrier   BOOLEAN NOT NULL,      -- derived convenience flag
    -- comorbidity flags (sec 2.2 / 2.4)
    hypertension      BOOLEAN NOT NULL,
    hyperlipidemia    BOOLEAN NOT NULL,
    diabetes          BOOLEAN NOT NULL,
    cvd               BOOLEAN NOT NULL,
    coronary_mi       BOOLEAN NOT NULL,
    stroke            BOOLEAN NOT NULL,
    atrial_fib        BOOLEAN NOT NULL,
    copd              BOOLEAN NOT NULL,
    depression        BOOLEAN NOT NULL,
    cancer            BOOLEAN NOT NULL,
    dementia          BOOLEAN NOT NULL,      -- = (cognitive_status='dementia')
    comorbidity_count INTEGER NOT NULL       -- precomputed sum of flags, handy for facets
);

-- 2) Files (Synapse File entities)
CREATE TABLE files (
    syn_id            VARCHAR PRIMARY KEY,   -- 'syn' + 6..9 digits, matches ^syn[0-9]{6,9}$
    file_name         VARCHAR NOT NULL,
    data_type         VARCHAR NOT NULL,      -- 'geneExpression','genomicVariants','proteomics','clinical','image',...
    assay_type        VARCHAR NOT NULL,      -- 'rnaSeq','wholeGenomeSeq','scrnaSeq','MRI','PET',...
    file_format       VARCHAR NOT NULL,      -- 'fastq','bam','cram','vcf','csv','nii','dcm',...
    is_multi_specimen BOOLEAN NOT NULL,      -- true => cohort/aggregate file (many subjects)
    file_size_bytes   BIGINT,                -- plausible per-format size
    study             VARCHAR                -- 'ROSMAP','MSBB','Mayo', etc. (optional facet)
);

-- 3) Junction (subject <-> file, many-to-many)
CREATE TABLE subject_files (
    subject_id        VARCHAR NOT NULL REFERENCES subjects(subject_id),
    syn_id            VARCHAR NOT NULL REFERENCES files(syn_id),
    PRIMARY KEY (subject_id, syn_id)
);
CREATE INDEX idx_sf_syn     ON subject_files(syn_id);
CREATE INDEX idx_sf_subject ON subject_files(subject_id);
```

Notes:
- `apoe_e4_carrier`, `dementia`, and `comorbidity_count` are denormalised on purpose: they
  are cheap precomputed facets that keep DuckDB-WASM queries fast in the browser.
- In Parquet, booleans + dictionary-encoded low-cardinality strings (`race`, `assay_type`,
  `file_format`) compress extremely well and are fast to filter in DuckDB-WASM.

### 3.3 File-type -> cardinality patterns

Drive the junction generation from each file's `assay_type`/`is_multi_specimen`, so the
fan-out matches real data shapes:

| File category | `is_multi_specimen` | Subjects per file | Files per subject (typical) |
|---|---|---|---|
| Per-sample raw seq (FASTQ, BAM, CRAM) | false | 1 | several (one per assay run) |
| Per-sample single-sample VCF | false | 1 | 1-2 |
| Cohort multi-sample VCF / joint-genotyped | true | hundreds to all subjects | shared |
| Genotype/expression matrix (CSV/TSV) | true | many (a study's subjects) | shared |
| Imaging (MRI `nii`, PET `dcm`) | false | 1 | 1-3 series |
| Clinical/metadata manifest (CSV) | true | many / all | shared |
| QC / summary reports | true | many | shared |

### 3.4 Generating the mapping (to hit ~25k subjects, ~6k files)

1. Generate **25,000** subjects (section 2).
2. Generate **6,000** files. Assign each a `data_type`/`assay_type`/`file_format` from the
   coherent vocab map, and set `is_multi_specimen` per the category table (most files are
   per-sample, a minority are cohort-level).
3. Build `subject_files`:
   - **Per-sample files** (`is_multi_specimen=false`): attach to exactly one subject. Bias
     selection so subjects with richer assay profiles (e.g. dementia/e4 subjects in a
     deeply-phenotyped substudy) get more files - draw each subject's file count from a
     skewed distribution (e.g. negative binomial / Zipf) so some subjects have many files
     and most have few.
   - **Multi-specimen files** (`is_multi_specimen=true`): attach to a large random subset
     (e.g. a study's worth, 500-5,000 subjects, or "all subjects" for a cohort VCF).
   - Result: a realistic many-to-many where a handful of cohort files dominate edge count
     and a long tail of per-sample files each touch one subject.
4. Recompute `comorbidity_count` and validate marginal prevalences and the
   APOE-by-cognitive_status crosstab before writing output.

Expect the junction table to have on the order of 10^5-10^6 rows (a few cohort-level files
each linking thousands of subjects dominate the total), which DuckDB-WASM handles easily.

---

## 4. Recommended generation approach (local, reproducible)

### 4.1 Toolchain

Python with `numpy` + `pandas`, optional `Faker` for names/IDs, `pyarrow` for Parquet.
A single seeded script, no network, no `Date.now`/`Math.random` constraints (this is a normal
local build step, not browser runtime code).

```
python -m venv .venv && source .venv/bin/activate
pip install numpy pandas pyarrow faker
```

### 4.2 Structure of the generator

```python
import numpy as np, pandas as pd
rng = np.random.default_rng(42)   # fixed seed => reproducible

N_SUBJECTS = 25_000
N_FILES    = 6_000

# 1. subjects
#    - age: truncated normal centred ~74, SD ~8, clipped to [60,102]
#    - sex, race, ethnicity: rng.choice with p= the section-2.1 weights
#    - cognitive_status: rng.choice(['normal','MCI','dementia'], p=[0.45,0.25,0.30])
#    - APOE: sample alleles at p={e2:.084,e3:.779,e4:.137}, pair (HWE),
#            then up-weight e4 carriers among dementia subjects
#    - latent burden b ~ Beta scaled by age; comorbidity flags via
#      baseline prevalence * burden/age adjustment + pairwise conditional bumps
#    - comorbidity_count = row-sum of flags

# 2. files
#    - assign assay_type, then choose file_format from the assay->format map,
#      derive data_type from assay; set is_multi_specimen by category weights
#    - plausible file_size_bytes by format (FASTQ ~GBs, VCF ~MBs, CSV ~KB-MB)
#    - syn_id: 'syn' + str(rng.integers(10**6, 10**9))  (matches syn[0-9]{6,9}),
#      enforce uniqueness

# 3. subject_files junction (section 3.4)

# 4. write outputs
for name, df in [('subjects',subjects),('files',files),('subject_files',links)]:
    df.to_parquet(f'data/{name}.parquet', index=False)   # preferred for DuckDB-WASM
    df.to_csv(f'data/{name}.csv', index=False)            # human-readable fallback
```

### 4.3 Output format

- **Parquet (preferred)**: columnar, dictionary-encoded, compressed; DuckDB-WASM reads it
  directly and lazily over HTTP range requests, which keeps the browser fast and memory-light
  for 25k subjects + a 10^5-10^6-row junction. Emit one Parquet per table.
- **CSV (secondary)**: same data for inspection, diffing, and non-DuckDB consumers.
- Set a **fixed seed** (`default_rng(42)`) and pin library versions so the dataset is byte-
  reproducible. Optionally write a small `manifest.json` recording seed, row counts, library
  versions, and realised marginal prevalences for audit.

### 4.4 Validation before shipping

- Assert `files.syn_id` all match `^syn[0-9]{6,9}$` and are unique.
- Assert junction FKs resolve (no orphan subject_id/syn_id).
- Print realised vs target marginals for each comorbidity and the APOE-by-cognitive_status
  crosstab; rescale baselines and re-run if drift is large.
- Confirm at least one cohort-level file links thousands of subjects and at least some
  subjects link to 5+ files (sanity of the many-to-many shape).

---

## Sources

- [Synapse documentation - entities, synID format, entity types][syn-docs]
- [Synapse - About / platform overview (Sage Bionetworks)][synapse-org]
- [Synapse - Annotating Data With Metadata (annotations as key-value pairs)][syn-annot]
- [AD Knowledge Portal - About Metadata (individual/biospecimen/assay model, file annotations)][adkp-meta]
- [The AD Knowledge Portal: A Repository for Multi-Omic Data on AD and Aging (PMC)][adkp-paper]
- [NACC data representativeness - demographics across ADRC centres (PMC)][nacc]
- [CDC - About Chronic Diseases (90%+ of 65+ have a chronic condition)][cdc-chronic]
- [CDC PCD - Prevalence of Multiple Chronic Conditions Among US Adults, 2018][cdc-mcc]
- [Prevalence/management of hypertension, dyslipidaemia, diabetes in US adults 65+ (PMC)][hyp-65]
- [Diabetes prevalence ~29% in 65+ / stroke 22% in older diabetics][dm-65]
- [Atrial fibrillation prevalence by age (7.6% at 75, ~13% at 85+)][af-prev]
- [COPD ~15% pooled prevalence in 65+; depression in COPD subgroup (PMC)][copd-65]
- [APOE allele frequencies in the US population (e2 8.4%, e3 77.9%, e4 13.7%)][apoe-us]
- [APOE distribution in world populations (PubMed)][apoe-world]
- [Multimorbidity patterns / disease clustering in the elderly (PMC)][multimorb-clust]
- [Prevalence of disease clusters in older adults - systematic review (PMC)][multimorb-rev]
- [Co-occurring diabetes and hypertension in community-dwelling older adults (PubMed)][dm-htn]

[syn-docs]: https://docs.synapse.org/synapse-docs/downloading-data-programmatically-from-a-portal
[synapse-org]: https://www.synapse.org/
[syn-annot]: https://help.synapse.org/docs/Annotating-Data-With-Metadata.2667708522.html
[adkp-meta]: https://help.adknowledgeportal.org/apd/About-Metadata.2241626149.html
[adkp-paper]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7587039/
[nacc]: https://pmc.ncbi.nlm.nih.gov/articles/PMC12445991/
[cdc-chronic]: https://www.cdc.gov/chronic-disease/about/index.html
[cdc-mcc]: https://www.cdc.gov/pcd/issues/2020/20_0130.htm
[hyp-65]: https://pmc.ncbi.nlm.nih.gov/articles/PMC2655011/
[dm-65]: https://pmc.ncbi.nlm.nih.gov/articles/PMC12351518/
[af-prev]: https://pmc.ncbi.nlm.nih.gov/articles/PMC10568548/
[copd-65]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7740199/
[apoe-us]: https://scienceinsights.org/what-is-the-apoe-gene-function-variants-and-risk/
[apoe-world]: https://pubmed.ncbi.nlm.nih.gov/17092867/
[multimorb-clust]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3012106/
[multimorb-rev]: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3823581/
[dm-htn]: https://pubmed.ncbi.nlm.nih.gov/30094913/
