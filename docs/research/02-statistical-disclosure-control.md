# Statistical Disclosure Control for an Interactive Cohort-Count Tool

Research note for the cohort-builder tool: an interactive aggregate-query / cohort-count
interface over sensitive ageing and Alzheimer's cohorts. Researchers filter on demographic,
comorbidity, and genetic variables and see how many subjects match. For sensitive variables
we must SUPPRESS exact counts that are too small while still returning a BOOLEAN answer
("data exists" vs "no data") for the query.

Variables are tagged with a 4-level sensitivity scheme: **None, Low, Medium, High**.
Roughly 29 of 47 variables are tagged **High**, so the High treatment dominates the user
experience and must be both safe and usable.

---

## 1. Small-cell suppression and threshold rules

### The core idea

Statistical disclosure control (SDC) is "the assessment of the risk of re-identification
attached to a data item or statistical output, and the use of appropriate methods to reduce
the disclosure risk" (OpenSAFELY). The canonical tool is **small-cell suppression**: any cell
whose count is below a threshold *k* is replaced with a marker (`*`, `[REDACTED]`, or a
boolean) so that small, potentially identifying groups are not published directly.

This is closely related to **k-anonymity** (Sweeney): each released combination of
quasi-identifiers must correspond to at least *k* individuals, so any individual is
indistinguishable from at least *k-1* others. A minimum cell size of *k* is the tabular-data
expression of k-anonymity. The i2b2 privacy paper explicitly frames its counts work against
"k-level anonymity ... where k represents the number of peoples' records that must be
indistinguishable" and warns that k-anonymity alone "has been shown to be subject to reverse
engineering" (Murphy et al. 2011), which is why thresholds are combined with noise and rounding.

### Standard thresholds in health and official statistics

| Authority / system | Suppression threshold | Notes |
|---|---|---|
| **NHS England HES / ECDS** | Suppress cells **1-7** (values 1-7 replaced with `*`); then secondary suppression | National rule for Hospital Episode Statistics and Emergency Care Data Set. Rounding to nearest 5 also applied in some HES outputs. |
| **ONS (births and deaths)** | Suppress cells **< 3** (0, 1, 2); a **minimum cell count of 5** is recommended for higher-risk tables | "Common SDC techniques include rounding to a base (usually 3 or 5) and suppressing very small numbers (usually < 3)." |
| **ONS / NHS Test and Trace (small geographies)** | Threshold of **5** treated as low risk | Balancing disclosure risk vs utility. |
| **NHS BSA** | Suppress counts **1-9** at all geographic levels | More conservative; prescribing data. |
| **OpenSAFELY (NHS GP data via Bennett Institute)** | Redact any statistic describing **<= 7 patients**, then round to nearest 5 | Threshold 7 chosen so that "redacting <=7 followed by rounding [to 5] provides the same protection for all counts" (avoids a count of 5 being inferable as 6 or 7). |
| **All of Us Research Program** | Counts **1-20 censored**; round counts up to nearest multiple of 20 | NIH precision-medicine cohort; see s4. |
| **TriNetX** | Threshold and round up to nearest **10** | Federated EHR network; see s4. |
| **DataSHIELD** | Default minimum non-zero subset count **3** (configurable to 1 for rare disease, or 5) | Federated analysis; see s4. |
| **ISO/IEC 27559:2022** | No single number; risk-based framework | "Privacy enhancing data de-identification framework"; sets out threat analysis, identifiability assessment, adversary testing, governance. Builds on ISO/IEC 20889:2018 (de-identification terminology and techniques). |

### Why 5 vs 10 (vs 3, 7, 20)?

- **3** is the minimum defensible threshold: it only stops counts of 1 and 2, where an
  individual is trivially identifiable or near-identifiable. ONS uses < 3 for low-risk
  birth/death tables; DataSHIELD defaults to 3. It protects against the most blatant
  primary disclosure but little else.
- **5** is the de-facto international standard for health data. It is large enough to give
  meaningful group anonymity, is round and easy to communicate, and is the value ONS, the US
  CDC/state agencies, and most census agencies converge on. OpenSAFELY notes 5 "is commonly
  used for safe dissemination of health statistics ... used by statistical agencies such as
  the ONS for high-risk data."
- **7** (OpenSAFELY) is a refinement of 5: when you ALSO round to base 5, a published "5"
  could be a true 5, 6, or 7, so redacting up to 7 before rounding closes that inference gap.
- **10** (TriNetX) is chosen for interactive, repeatable, multi-site query systems where the
  same query can be re-run and combined. A larger threshold buys margin against differencing
  and averaging attacks (s3). It is "based in the best practices of a variety of federal and
  state agencies."
- **20** (All of Us) is the most conservative, reflecting (a) genomic data, which is
  inherently re-identifying, and (b) a public-facing self-service query tool where adversarial
  querying must be assumed. The higher the re-identification stakes and the more open the
  query interface, the higher the threshold.

**Implication for us.** Because ~29/47 variables are High and include genetic data (e.g. APOE
genotype) over an ageing/Alzheimer's population, our High tier should sit at the conservative
end (10-20), in line with All of Us and TriNetX, not at the official-statistics minimum of 5.

---

## 2. Primary vs complementary (secondary) suppression

### Definitions

- **Primary suppression**: hiding the cells that are themselves disclosive (count below
  threshold). In OpenSAFELY's worked example, a table showing "1 person aged 21-30 has heart
  disease" is primary disclosure; you redact that cell.
- **Secondary (complementary) suppression**: hiding ADDITIONAL, non-sensitive cells so that
  the primary-suppressed cell cannot be recovered by arithmetic from row totals, column
  totals, or the grand total.

The attack secondary suppression defends against: if a row has cells `[*, 10, 15, 25]` with a
published total of `51`, the attacker computes `51 - 10 - 15 - 25 = 1` and recovers the
suppressed cell exactly. As the search literature puts it, "suppression of the primary cells
alone can be easily attacked through the margin totals. It is therefore necessary to suppress
additional cells, termed complementary cells."

### The algorithm conceptually

The general **cell suppression problem (CSP)** is: given a table with published margins and a
set of primary-suppressed cells, choose a minimum-cost set of additional cells to suppress
such that no suppressed cell's value can be derived (or narrowed to a tight interval) from the
linear constraints implied by the margins. CSP is **NP-hard** in general; statistical agencies
solve it with integer/linear-programming formulations (network-flow models for 2-D tables,
branch-and-cut for exact solutions). Tools: tau-ARGUS, sdcTable (R), the ESSnet handbook.

The constraint is linear because every margin is a linear equation over the cells. If exactly
one cell in a linear equation is suppressed, it is recoverable; therefore the rule of thumb is
**each constraint (row, column) that contains a primary suppression must contain at least one
further suppression**, and the secondary cell must itself appear in another equation that is
also protected (so you cannot unwind it from a perpendicular margin).

### A simple version implementable client-side

For our tool, an exact LP solver is overkill. A pragmatic heuristic for a 2-D contingency
table (e.g. sensitive variable x demographic stratum) that runs in the browser:

1. **Mark primary suppressions.** For every cell with `0 < count < k`, mark it suppressed.
   (Also mark `count == 0` if zeros are disclosive for that variable; see s5.)
2. **Row pass.** For each row that contains exactly one suppressed cell but whose total is
   published, suppress the smallest additional non-zero cell in that row. Now the row has >= 2
   suppressed cells, so neither is solvable from the row total alone.
3. **Column pass.** Repeat for each column.
4. **Iterate** rows and columns until no row or column contains exactly one suppressed cell.
   This converges quickly (each pass only adds suppressions).
5. **Prefer suppressing the smallest eligible cell** at each step to minimise utility loss.

This "smallest-neighbour" heuristic does not guarantee minimality and does not handle 3-D or
linked-table differencing, but for a single displayed cross-tab it removes the trivial
subtraction attack. The most robust simplification, and the one we recommend below, is to
**round all displayed counts to a common base** (s3): rounding makes margins inconsistent with
exact cell recovery and largely sidesteps the need for full complementary suppression.

**Critical detail (from OpenSAFELY and All of Us):** after suppressing/rounding cells,
**recompute the row and column totals from the suppressed/rounded values**. Never publish a
true total alongside suppressed components, or the total leaks the hidden cells.

---

## 3. Differencing attacks and defences

### The attack

A **differencing attack** recovers a suppressed or about-an-individual value by subtracting two
query results that each individually pass the threshold. Classic example (from the security
literature and OpenSAFELY): in a database with a "reject queries < 10 people" rule, an
attacker asks "count of patients with diagnosis D" and "count of patients with diagnosis D who
are NOT patient X" (e.g. add one extra distinguishing filter). Both counts exceed 10, neither
is rejected, but the difference reveals whether X has D. The OpenSAFELY docs show the
tabular form: differencing a "total population" table against a "male population" table on the
same age bands reveals that exactly one female aged 21-30 has heart disease, even though no
single published cell is small.

Related attacks on interactive count systems:
- **Averaging attack**: re-run the same noisy query many times and average out the noise to
  recover the true count. This is why i2b2 monitors query repetition (s4).
- **Tracker / linking attacks**: combine many overlapping query sets to triangulate a record.

### Defences

| Defence | Mechanism | Strength / weakness |
|---|---|---|
| **Query-set-size restriction** | Refuse to answer if the result set is smaller than *k*. | Necessary but **insufficient on its own**: differencing succeeds when both queries exceed *k* but their difference isolates a record. |
| **Random rounding** | Round each count up or down to a multiple of base *b* probabilistically (e.g. round 13 to 15 with prob 3/5, to 10 with prob 2/5). | Adds uncertainty; **vulnerable to averaging** if the same query returns a fresh random value each time. Mitigate by caching the rounded answer per query (seeded/deterministic per query string). |
| **Controlled rounding** | Round so that rounded cells still sum to rounded margins (table stays additive). Rounds to the nearest multiple more often than unbiased rounding. | Preserves table consistency; central to official tabular SDC. |
| **Deterministic rounding to base** (round to nearest *b*) | Always map count to nearest multiple of *b* (TriNetX: nearest 10; All of Us: nearest 20). | Stable under repetition (no averaging attack), simple, communicable. Still leaks coarse magnitude; differencing across DIFFERENT queries still partially possible but limited to +/- b resolution. |
| **Perturbation / noise (Gaussian)** | Add random noise to each count (i2b2: truncated Gaussian, random integer roughly in [-10, +10]). | Strong against single-shot; needs **query-repetition monitoring** and per-query determinism to resist averaging. |
| **Threshold + round + boolean for the most sensitive** | Combine the above; for High sensitivity return only "data exists / no data". | See below. |

### Why "boolean availability" reduces but does not eliminate risk

Returning only a boolean (">= 1 subject matches" vs "0 subjects match"), or a thresholded
boolean ("at least *k* match" vs "fewer than *k*"), is the strongest count-suppression option
short of refusing the query. It removes the exact count, so direct primary disclosure of a
small count is impossible.

But it does **not** eliminate inference:
- A naive boolean of "exists vs not" (threshold 1) still answers "is there at least one
  patient with rare variant V and condition C and age 80-85?" which can be highly disclosive
  for a unique individual. **The boolean must be thresholded at *k***: report `true` only when
  the count is `>= k`, and `false` (or "fewer than k / suppressed") otherwise. With a `>= k`
  boolean, a `true` guarantees a group of at least *k*, and a `false` only tells the attacker
  the group is somewhere in 0..k-1 (it does not pin down 1).
- **Differencing still applies to thresholded booleans across queries**: if query A returns
  `true (>=k)` and a slightly narrowed query B returns `false (<k)`, the attacker learns the
  excluded sliver is small. Defences: query-set-size restriction on every sub-query,
  rate-limiting / repeated-query monitoring, and refusing queries whose only difference from a
  prior query is a single distinguishing predicate.
- A boolean reveals **less magnitude** than a rounded count, so for the most sensitive
  variables (genetic, stigmatising comorbidities) it is the right default, accepting reduced
  utility.

---

## 4. How real cohort-discovery tools handle this

### i2b2 (Murphy et al. 2011, JAMIA; i2b2 CRC config)

- **Obfuscation = Gaussian blur + minimum threshold + repetition monitoring.** The Partners
  Healthcare implementation "performs Gaussian function-based blurring of patient counts,
  combined with monitoring the number of query repetitions with similar results to ensure a
  statistical de-identification process" (Murphy et al.).
- Concretely, i2b2 adds a random integer drawn from a (truncated) Gaussian, in practice
  roughly **in the range -10 to +10**, to every reported count.
- A configurable minimum result value:
  `edu.harvard.i2b2.crc.setfinderquery.obfuscation.minimum.value` sets the floor below which
  results are not shown as exact counts.
- **Query lockout**: obfuscated ("aggregated-results-only") users are limited in how many
  times they can run the same query in a project within a time window (Setfinder lockout
  properties), directly countering averaging attacks.
- Five privacy categories tie data granularity to recipient trust; obfuscated users see only
  aggregate counts, never line-level data.

### OHDSI ATLAS

- Provides a configurable **minimum cell count / "censor record counts"** feature: event
  cohorts or characterisation cells with fewer than the configured number of people are
  censored (removed / shown as blank) in output, to protect small groups. Set per-environment
  by the data holder. (OHDSI forums: "Patient count obfuscation in Atlas"; Book of OHDSI ch.
  11 Characterization; Atlas issue #1357 on minimum prevalence thresholds.)
- ATLAS leans on suppression/censoring rather than added noise.

### TriNetX

- **Threshold and round up to the nearest 10.** "Total patient counts greater than 10 are
  rounded up to the nearest 10"; a query returning a single count < 10 reports **10** and the
  cohort cannot be explored further. Every displayed count is divisible by 10.
- **Multi-level obfuscation**: applied at (1) total patient count, (2) site-level counts, and
  (3) subtotals for a specific clinical term, so you cannot difference a subtotal against a
  total to recover small groups.
- Rationale explicitly cited: prevent a series of individual queries from isolating small
  subsets (i.e. differencing defence).

### OpenSAFELY (Bennett Institute, NHS England GP data)

- **Redact any statistic describing <= 7 patients**, directly or indirectly.
- **Then round all counts to the nearest 5** (redact-then-round order matters; threshold 7
  chosen specifically so a rounded 5 cannot be inferred as 6 or 7).
- **Midpoint-6 rounding** for rates: map counts 1-6 to a placeholder "3" (which is below the
  redaction threshold, so it does not break suppression) when you need to distinguish a zero
  rate from a non-zero rate without revealing the true small count.
- **Recompute totals from rounded cells**; explicitly addresses both primary and secondary
  (including cross-table differencing) disclosure.
- Human "output checking": two trained checkers review every release. (Not automatable in our
  tool but informs the conservative default.)

### DataSHIELD (federated analysis, Opal)

- Server-side **disclosure traps**: functions refuse to return results that would be
  disclosive (e.g. subsets below a minimum count, over-saturated regression models).
- `nfilter.subset` / minimum non-zero count of observational units in a subset **defaults to
  3**; configurable to 1 for rare disease or 5 to match the global threshold rule.
- `nfilter.glm` caps model parameters at a proportion of sample size (default 0.33) to stop
  near-saturated, disclosive models.
- Parameters are set by the data custodian; the analyst can see but **cannot change** them.

### UK Biobank

- Guidance "Reporting small numbers in results in research outputs using UK Biobank data"
  defers to **ONS** (births/deaths confidentiality) and **NHS HES** methodology: round or
  suppress small numbers, typically suppress < 5 and round to a base (3 or 5). Sensitive
  phenotypes and aggregate numbers in public materials get extra care.

### All of Us Research Program (NIH)

- **Data and Statistics Dissemination Policy**: no participant count of **1-20** may be
  published or derived; a count of **0 is permitted**.
- **Round up to the nearest 20**: a count of 5 or 9 must be shown as 20; counts above 20 round
  up to the nearest multiple of 20 (e.g. 1245 -> 1260).
- No data or statistic may allow a 1-20 count to be **derived** from other reported cells
  (secondary-disclosure clause). Permitted strategies: collapse cells, coarsen data, suppress
  cells. Exceptions require a formal request.
- This is the closest analogue to our setting (genomic + EHR + interactive query tool) and
  argues for a high threshold on our High tier.

---

## 5. Recommended policy for a configurable-threshold implementation

### Parameters to expose (per sensitivity level, set by data custodian)

| Parameter | Type | Meaning |
|---|---|---|
| `threshold_k` | integer | Minimum cell size. Counts `0 < c < k` are not shown exactly. |
| `rounding_base` | integer (0 = off) | Round displayed counts to nearest (or up to) this base. |
| `rounding_mode` | enum: `nearest` / `up` / `random` | `up` matches All of Us / TriNetX; `random` adds unbiased noise (needs caching). |
| `complementary_suppression` | bool | Apply the row/column secondary-suppression pass to displayed cross-tabs. |
| `boolean_only` | bool | Return only a thresholded boolean (`>= k` vs `< k`), never a count. |
| `zero_is_disclosive` | bool | Treat a 0 / 100% cell as disclosive and suppress it (per OpenSAFELY caution). |
| `query_repetition_limit` | integer | Max identical/near-identical queries per user per window (anti-averaging). |
| `min_query_set_size` | integer | Refuse to evaluate any sub-query whose result set is below this (anti-differencing). |

Custodian-set, analyst-visible-but-immutable (DataSHIELD model).

### Proposed decision table: sensitivity level -> treatment

| Sensitivity | Example variables | Threshold *k* | Rounding | Complementary suppression | Display | Rationale |
|---|---|---|---|---|---|---|
| **None** | Study arm, recruitment site (aggregate), data-availability flags | none (k = 1) | none | no | **Exact count** | Non-personal / already public-grade. |
| **Low** | Coarse age band, sex, broad region | **k = 5** | round to nearest 5 | no | Exact count, suppressed `< 5` shown as `<5` | ONS / UK Biobank standard for low-risk health data. |
| **Medium** | Specific comorbidities, finer demographics, medication classes | **k = 10** | round **up** to nearest 10 | **yes** | Rounded count; `< 10` shown as `<10`; cross-tabs get secondary suppression | TriNetX-style; interactive repeatable queries need margin against differencing. |
| **High** | Genetic variants (APOE etc.), stigmatising diagnoses, rare comorbidities (~29/47 vars) | **k = 20** | round up to nearest 20 (if any count shown at all) | **yes** | **Boolean only**: `Data available (>= 20)` vs `Insufficient data (< 20)` | All of Us standard for genomic / precision-medicine cohorts; boolean removes magnitude leakage. |

Defaults are configurable; the table above is the recommended **starting configuration**.

### Recommended default threshold

**`threshold_k = 10` as the global default**, with per-level overrides as in the table
(5 / 10 / 20 for Low / Medium / High). Ten is the interactive-query consensus (TriNetX), more
conservative than the official-statistics minimum of 5 (appropriate because this is a
self-service, repeatable query tool, not a one-off published table), and below the genomic-tier
20 reserved for High.

### Exact suppression algorithm to implement client-side

Given a query that produces, per displayed cell, a true count `c`, the cell's variable
sensitivity `s`, and the per-level config:

```
function disclose(c, s, cfg):           # cfg = config for sensitivity level s
    k = cfg.threshold_k

    # 1. Zero handling
    if c == 0:
        if cfg.zero_is_disclosive: return SUPPRESSED   # "no data / suppressed"
        else:                      return value(0)

    # 2. Boolean-only mode (High tier)
    if cfg.boolean_only:
        return (c >= k) ? "Data available (>= k)" : "Insufficient data (< k)"

    # 3. Primary suppression
    if c < k:
        return SUPPRESSED          # render as "<k", never the exact value

    # 4. Rounding (apply only to values that survive suppression)
    if cfg.rounding_base > 0:
        c = round_to_base(c, cfg.rounding_base, cfg.rounding_mode)
        # 'up' => ceil to multiple; 'nearest' => round; 'random' => seeded by query hash
    return value(c)
```

For a displayed **cross-tab** (sensitive variable x stratum), wrap the cell loop with the
complementary-suppression pass when `cfg.complementary_suppression` is true:

```
function suppress_table(cells, cfg):
    for cell in cells:                              # step 1: primary
        if 0 < cell.count < cfg.threshold_k: cell.suppressed = true

    repeat until stable:                            # steps 2-4: secondary
        for each row with exactly one suppressed non-total cell and a shown total:
            suppress the smallest unsuppressed non-zero cell in that row
        for each column with exactly one suppressed non-total cell and a shown total:
            suppress the smallest unsuppressed non-zero cell in that column

    apply rounding to every non-suppressed cell (disclose() step 4)
    RECOMPUTE every row/column/grand total from the rounded, non-suppressed cells
    render suppressed cells as the threshold marker ("<k")
```

Cross-cutting controls (server-side, not per-cell): enforce `min_query_set_size` on each
sub-query (reject differencing-style narrow queries), and `query_repetition_limit` per user
per time window (defeat averaging attacks against any noise/random rounding). For `random`
rounding, **seed the RNG from a hash of the canonical query string** so the same query always
returns the same rounded value (otherwise repetition + averaging recovers the true count).

### Operational notes

- **Order matters**: zero-check -> boolean -> primary suppression -> rounding -> recompute
  totals. Rounding before suppression can leak; publishing true totals alongside rounded cells
  leaks.
- **High tier is boolean by default** because ~29/47 variables are High and include genetic
  data; magnitude is rarely needed for cohort feasibility ("is this cohort big enough to
  pursue?"), which a `>= 20` boolean answers.
- **Document the applied SDC** to the user ("counts < 20 shown as availability only; counts
  rounded to nearest 10"), so researchers do not misread suppressed cells as true zeros.
- This client-side scheme handles single-table primary + simple secondary disclosure. It does
  **not** defend against sophisticated multi-query / linked-table differencing on its own;
  pair it with server-side query logging, set-size restriction, and rate limiting, and treat
  full LP-based complementary suppression (tau-ARGUS / sdcTable) as the upgrade path if linked
  publishable tables are ever exported.

---

## Sources

1. NHS England Digital, Disclosure control methodology for Hospital Episode Statistics (HES) and Emergency Care Data Set (ECDS): https://digital.nhs.uk/data-and-information/data-tools-and-services/data-services/hospital-episode-statistics/disclosure-control-methodology-for-hospital-episode-statistics-and-emergency-care-data-set
2. ONS, Policy on protecting confidentiality in tables of birth and death statistics: https://www.ons.gov.uk/methodology/methodologytopicsandstatisticalconcepts/disclosurecontrol/policyonprotectingconfidentialityintablesofbirthanddeathstatistics
3. ONS / GOV.UK, Disclosure risk assessment for NHS Test and Trace: counts at small geographies: https://www.gov.uk/government/publications/office-for-national-statistics-recommendation-for-publishing-data-at-small-geographies-for-nhs-test-and-trace/disclosure-risk-assessment-for-nhs-test-and-trace-counts-at-small-geographies
4. NHSBSA Statistical Disclosure Control protocol (V1.2): https://www.nhsbsa.nhs.uk/sites/default/files/2020-10/nhsbsa-sdc-protocol.pdf
5. OpenSAFELY documentation, Applying statistical disclosure control (redact <=7, round to 5, midpoint-6, primary vs secondary): https://docs.opensafely.org/outputs/sdc/
6. Bennett Institute, "Safe Outputs and Statistical Disclosure Control in OpenSAFELY": https://www.bennett.ox.ac.uk/blog/2023/03/safe-outputs-and-statistical-disclosure-control-in-opensafely/
7. Murphy SN, Gainer V, Mendis M, Churchill S, Kohane I. "Strategies for maintaining patient privacy in i2b2." JAMIA 2011 (Gaussian obfuscation + query-repetition monitoring + k-anonymity discussion): https://pmc.ncbi.nlm.nih.gov/articles/PMC3241166/
8. i2b2 Community Wiki, Setfinder Query Lockout Properties (query repetition limits): https://community.i2b2.org/wiki/display/getstarted/10.4.4.2.4+Setfinder+Query+-+Lockout+Properties
9. OHDSI Forums, "Patient count obfuscation in Atlas": https://forums.ohdsi.org/t/patient-count-obfuscation-in-atlas/16474
10. The Book of OHDSI, Chapter 11 Characterization (minimum cell count censoring): https://ohdsi.github.io/TheBookOfOhdsi/Characterization.html
11. OHDSI/Atlas issue #1357, Limit characterization prevalence results to minimum prevalence threshold: https://github.com/OHDSI/Atlas/issues/1357
12. TriNetX data privacy assessment (B. Malin) and obfuscation/rounding-to-10 description: https://trinetx.com/wp-content/uploads/2021/12/TriNetX-Empirical-Summary-by-Brad-Malin-2020.pdf
13. TriNetX tip sheet (rounding up to nearest 10, threshold behaviour), Stony Brook RCI: https://rci.stonybrook.edu/sites/default/files/documents/Data_from_TNX_21Oct2024.pdf
14. DataSHIELD Community Wiki, Disclosure Control (nfilter defaults, custodian-set parameters): https://wiki.datashield.org/en/opmanag/disclosure-control
15. DataSHIELD disclosure control (Confluence): https://data2knowledge.atlassian.net/wiki/spaces/DSDEV/pages/714768398/Disclosure+control
16. Banerjee S et al. / DataSHIELD team, "DataSHIELD: mitigating disclosure risk in a multi-site federated analysis platform", Bioinformatics Advances 2025: https://academic.oup.com/bioinformaticsadvances/article/5/1/vbaf046/8068803
17. UK Biobank, Reporting small numbers in results in research outputs using UK Biobank data: https://community.ukbiobank.ac.uk/hc/en-gb/articles/24842092764061-Reporting-small-numbers-in-results-in-research-outputs-using-UK-Biobank-data
18. All of Us Research Hub, Data and Statistics Dissemination Policy (count 1-20 censored, round up to 20): https://www.researchallofus.org/faq/data-and-statistics-dissemination-policy/
19. All of Us User Support, How to comply with the Data and Statistics Dissemination Policy: https://support.researchallofus.org/hc/en-us/articles/360043016291-How-to-comply-with-the-All-of-Us-Data-and-Statistics-Dissemination-Policy
20. ISO/IEC 27559:2022, Privacy enhancing data de-identification framework: https://www.iso.org/standard/71677.html
21. IAPP, "A new standard for anonymization" (ISO/IEC 27559 overview): https://iapp.org/news/a/a-new-standard-for-anonymization
22. R. Zhang, L. Chen, Y. Cheng, "Overview of Cell Suppression Methods", ASA SRMS Proceedings 2023 (primary/complementary, (n)/(n,k)/p-percent rules, LP/NP-hardness): http://www.asasrms.org/Proceedings/y2023/files/Overview_of_Cell%20Suppression_Methods.pdf
23. R. A. Dandekar, "Protecting Sensitive Tabular Data by Complementary Cell Suppression", FCSM: https://nces.ed.gov/FCSM/pdf/2005FCSM_Dandekar_IXA.pdf
24. Devron, "Differencing Attack" (knowledge base): https://www.devron.ai/kbase/differencing-attack
25. InventiveHQ, "Database Inference and Aggregation Attacks: The Complete Defense Guide" (query-set-size restriction, n=5/n=11 insufficiency): https://inventivehq.com/blog/database-inference-aggregation-attacks-guide
26. "Averaging Attacks on Bounded Noise-based Disclosure Control Algorithms", arXiv 1902.06414: https://arxiv.org/pdf/1902.06414
27. Salari M et al., controlled rounding and cell perturbation overview (ResearchGate): https://www.researchgate.net/publication/220589932_Controlled_rounding_and_cell_perturbation_Statistical_disclosure_limitation_methods_for_tabular_data
28. Elliot M et al., "The future of statistical disclosure control", arXiv 1812.09204: https://arxiv.org/pdf/1812.09204
