#!/usr/bin/env python3
"""
Synthetic cohort data generator for the ELITE Cohort Builder.

Two modes:
  elite      (default) -- 25,000-subject ELITE dataset with correlated,
                          realistic distributions.  Outputs to
                          public/data/elite/.
  from-spec  <spec>    -- Generic mode: reads a CohortSpec JSON (or bare
                          variables array) and produces plausible synthetic
                          data for any spec.  Outputs to public/data/<id>/.

Usage
-----
  python scripts/generate_data.py
  python scripts/generate_data.py elite
  python scripts/generate_data.py from-spec public/specs/ad-v1.spec.json
  python scripts/generate_data.py from-spec src/registry/variables.json \
      --subjects 3000 --files 800 --out /tmp/test_out
"""

import argparse
import csv
import json
import math
import os
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SEED = 42
N_SUBJECTS = 25_000
N_FILES = 6_000

# APOE allele frequencies (Hardy-Weinberg)
APOE_ALLELE_FREQ = {"e2": 0.084, "e3": 0.779, "e4": 0.137}
APOE_ALLELES = list(APOE_ALLELE_FREQ.keys())
APOE_ALLELE_P = [APOE_ALLELE_FREQ[a] for a in APOE_ALLELES]

# Demographics
SEX_VALUES = ["Female", "Male", "Unknown"]
SEX_PROBS = [0.58, 0.41, 0.01]

RACE_VALUES = [
    "White",
    "Black or African American",
    "Asian",
    "American Indian or Alaska Native",
    "Native Hawaiian or Pacific Islander",
    "Ashkenazi Jewish",
    "Multiracial",
    "Other",
    "Unknown",
]
RACE_PROBS = [0.78, 0.13, 0.04, 0.01, 0.005, 0.005, 0.02, 0.005, 0.005]

ETHNICITY_VALUES = ["Hispanic or Latino", "Not Hispanic or Latino", "Unknown"]
ETHNICITY_PROBS = [0.09, 0.90, 0.01]

ETHNIC_GROUP_VALUES = [
    "Northern European",
    "Southern European",
    "Ashkenazi",
    "East Asian",
    "African",
    "Admixed",
    "Unknown",
]
ETHNIC_GROUP_PROBS = [0.45, 0.18, 0.05, 0.06, 0.13, 0.08, 0.05]

# Cohorts and their properties
COHORT_VALUES = ["CHS", "Centenarian", "Denmark Family", "SOF", "LLFS", "Arivale"]
COHORT_PROBS = [0.25, 0.08, 0.10, 0.15, 0.25, 0.17]
# Cohorts that are family-based
FAMILY_COHORTS = {"LLFS", "Denmark Family"}

STUDY_CODE_VALUES = ["CDCP", "ILO", "LC", "LG", "LLFS", "ASDOEL", "HSDOA"]
STUDY_CODE_PROBS = [0.14, 0.12, 0.14, 0.12, 0.20, 0.14, 0.14]

COUNTRY_CODE_VALUES = ["US", "Denmark"]
COUNTRY_CODE_PROBS = [0.85, 0.15]

FIELD_CENTER_VALUES = ["BU", "DK", "NY", "PT"]
FIELD_CENTER_PROBS = [0.25, 0.25, 0.25, 0.25]

# Diagnoses and macro groups
DIAGNOSIS_VALUES = [
    "Control",
    "Longevity / Centenarian",
    "Alzheimer's Disease",
    "Mild Cognitive Impairment",
    "Vascular Dementia",
    "Frontotemporal Dementia",
    "Lewy Body Dementia",
    "Parkinson's Disease",
    "Major Depressive Disorder",
    "Anxiety Disorder",
    "Breast Cancer",
    "Prostate Cancer",
    "Lung Cancer",
    "Colorectal Cancer",
    "Other",
]
DIAGNOSIS_PROBS = [
    0.30,  # Control
    0.05,  # Longevity / Centenarian
    0.22,  # Alzheimer's Disease
    0.12,  # MCI
    0.06,  # Vascular Dementia
    0.03,  # FTD
    0.03,  # Lewy Body
    0.05,  # Parkinson's
    0.04,  # Major Depressive
    0.03,  # Anxiety
    0.02,  # Breast Cancer
    0.02,  # Prostate Cancer
    0.01,  # Lung Cancer
    0.01,  # Colorectal Cancer
    0.01,  # Other
]
DIAGNOSIS_MACRO = {
    "Control": "Control",
    "Longevity / Centenarian": "Control",
    "Alzheimer's Disease": "Neurodegenerative",
    "Mild Cognitive Impairment": "Cognitive",
    "Vascular Dementia": "Neurodegenerative",
    "Frontotemporal Dementia": "Neurodegenerative",
    "Lewy Body Dementia": "Neurodegenerative",
    "Parkinson's Disease": "Neurodegenerative",
    "Major Depressive Disorder": "Psychiatric",
    "Anxiety Disorder": "Psychiatric",
    "Breast Cancer": "Cancer",
    "Prostate Cancer": "Cancer",
    "Lung Cancer": "Cancer",
    "Colorectal Cancer": "Cancer",
    "Other": "Other",
}
# Diagnoses that imply dementia
DEMENTIA_DIAGNOSES = {
    "Alzheimer's Disease",
    "Vascular Dementia",
    "Frontotemporal Dementia",
    "Lewy Body Dementia",
}

# File assay->data_type->format mappings (coherent combos)
# (assay_type, data_type, formats, size_range_bytes)
# Note: multi_specimen_prob removed; multi-specimen logic is now handled
# separately in _generate_sparse_junction (see SPARSE COVERAGE section).
ASSAY_PROFILES = [
    ("RNAseq",           "gene expression",   ["FASTQ", "BAM", "processed counts (CSV)"],  (500_000_000,   8_000_000_000)),
    ("scRNAseq",         "gene expression",   ["FASTQ", "BAM", "processed counts (CSV)"],  (200_000_000,   4_000_000_000)),
    ("WGS",              "variant calls",     ["FASTQ", "CRAM", "VCF"],                    (50_000_000,  150_000_000_000)),
    ("WES",              "variant calls",     ["FASTQ", "BAM", "VCF"],                     (5_000_000,   20_000_000_000)),
    ("proteomics",       "protein abundance", ["mzML", "processed counts (CSV)"],          (100_000_000,   5_000_000_000)),
    ("metabolomics",     "metabolite levels", ["mzML", "processed counts (CSV)"],          (50_000_000,    2_000_000_000)),
    ("methylation array","DNA methylation",   ["IDAT", "processed counts (CSV)"],          (100_000_000,   1_000_000_000)),
]

# Assay type names in the same order as ASSAY_PROFILES
ASSAY_NAMES = [p[0] for p in ASSAY_PROFILES]

# ---------------------------------------------------------------------------
# SPARSE COVERAGE: per-assay marginal prevalences (targets)
#   WGS ~70%, WES ~30%, RNAseq ~45%, methylation ~35%,
#   proteomics ~22%, metabolomics ~18%, scRNAseq ~10%
# Order matches ASSAY_PROFILES: RNAseq, scRNAseq, WGS, WES,
#                                proteomics, metabolomics, methylation array
# ---------------------------------------------------------------------------
ASSAY_MARGINAL_P = [0.45, 0.10, 0.70, 0.30, 0.22, 0.18, 0.35]

# Conditional probability boosts: if subject has assay A, P(B | A) is higher.
# List of (A_index, B_index, conditional_p) where A_index < B_index.
# A=scRNAseq -> B=RNAseq: very likely to also have RNAseq
# A=proteomics -> B=metabolomics: often paired
ASSAY_CORRELATIONS = [
    (1, 0, 0.85),   # scRNAseq (1) -> RNAseq (0):  85% of scRNAseq subjects also have RNAseq
    (4, 5, 0.60),   # proteomics (4) -> metabolomics (5): 60% overlap
]

# Target fraction of total files that are multi-specimen.
# 8% of 6000 = 480 cohort files x ~600 eligible subjects each provides broad
# assay-level coverage, keeping per-subject file counts in range (median ~6-10)
# while ensuring assay coverage tracks the marginal prevalences.
MULTI_SPECIMEN_FRACTION = 0.08  # ~8% of 6000 = ~480 cohort-level files

# Weights for assigning assay types to per-sample files
# (proportional to marginal prevalence * average files per subject for that assay)
ASSAY_FILE_WEIGHTS = [0.22, 0.10, 0.18, 0.15, 0.12, 0.10, 0.13]

# Comorbidity base prevalences (marginal, pre-adjustment)
COMORBIDITY_BASES = {
    "has_hypertension":           0.70,
    "has_diabetes":               0.28,
    "has_c_v_d":                  0.35,
    "has_c_o_p_d":                0.14,
    "has_atrial_fibrillation":    0.08,
    "has_stroke":                 0.10,
    "has_depression":             0.18,
    "has_cancer":                 0.20,
    "has_dementia":               0.00,  # derived from diagnosis
    "has_parkinsons":             0.04,
    "has_anxiety":                0.15,
    "has_arthritis":              0.30,
    "has_asthma":                 0.09,
    "has_c_a_b_g":                0.07,
    "has_c_h_f":                  0.08,
    "has_d_v_t":                  0.05,
    "has_glaucoma":               0.06,
    "has_m_i":                    0.12,
    "has_osteoporosis":           0.15,
    "has_peripheral_artery_disease": 0.08,
    "has_t_i_a":                  0.06,
}

COMORBIDITY_COLS = list(COMORBIDITY_BASES.keys())


# ---------------------------------------------------------------------------
# Seeded RNG helpers
# ---------------------------------------------------------------------------

def _setup_rng(seed: int):
    """Return a numpy default_rng AND seed stdlib random for full determinism."""
    rng = np.random.default_rng(seed)
    random.seed(seed)
    return rng


def _weighted_choice(rng, values, probs, n):
    """Draw n samples from values according to probs (numpy)."""
    probs = np.array(probs, dtype=float)
    probs /= probs.sum()
    return rng.choice(values, size=n, p=probs)


# ---------------------------------------------------------------------------
# Age generation (truncated right-skewed, mean ~74)
# ---------------------------------------------------------------------------

def _generate_ages(rng, n: int) -> np.ndarray:
    """
    Truncated normal centred at 74, SD 8, clipped to [60, 102].
    Re-draws until all values are in range (fast because most are in range).
    """
    ages = np.zeros(n, dtype=int)
    remaining = np.ones(n, dtype=bool)
    while remaining.sum() > 0:
        k = remaining.sum()
        raw = rng.normal(74.0, 8.0, k).round().astype(int)
        raw = np.clip(raw, 60, 102)
        ages[remaining] = raw
        remaining[remaining] = (raw < 60) | (raw > 102)  # should be empty
    return ages


def _age_bin(age: int) -> str:
    if age < 70:
        return "<70"
    elif age <= 74:
        return "70-74"
    elif age <= 79:
        return "75-79"
    elif age <= 84:
        return "80-84"
    elif age <= 89:
        return "85-89"
    return "90+"


# ---------------------------------------------------------------------------
# APOE generation with dementia enrichment
# ---------------------------------------------------------------------------

def _sample_apoe_alleles(rng, n: int) -> list[str]:
    """Sample two alleles per subject under Hardy-Weinberg, return sorted genotype."""
    a1 = rng.choice(APOE_ALLELES, size=n, p=APOE_ALLELE_P)
    a2 = rng.choice(APOE_ALLELES, size=n, p=APOE_ALLELE_P)
    genotypes = []
    for x, y in zip(a1, a2):
        pair = sorted([x, y])
        genotypes.append(f"{pair[0]}/{pair[1]}")
    return genotypes


def _enrich_apoe_for_dementia(rng, genotypes: list[str], is_dementia: np.ndarray) -> list[str]:
    """
    For dementia subjects with no e4 allele, probabilistically swap genotype
    to an e4-carrying one so that ~50% of dementia subjects carry e4
    (vs ~23% baseline).
    """
    target_e4_rate = 0.50
    genotypes = genotypes[:]  # copy
    e4_genotypes = ["e3/e4", "e4/e4", "e2/e4"]
    e4_g_p = np.array([0.60, 0.25, 0.15])

    dem_idx = np.where(is_dementia)[0]
    current_e4_carriers = [i for i in dem_idx if "e4" in genotypes[i]]
    current_rate = len(current_e4_carriers) / max(len(dem_idx), 1)
    needed = target_e4_rate - current_rate
    if needed > 0:
        non_e4_dem = [i for i in dem_idx if "e4" not in genotypes[i]]
        n_swap = min(int(needed * len(dem_idx)), len(non_e4_dem))
        swap_idx = rng.choice(non_e4_dem, size=n_swap, replace=False)
        for i in swap_idx:
            genotypes[i] = rng.choice(e4_genotypes, p=e4_g_p)
    return genotypes


# ---------------------------------------------------------------------------
# Comorbidity generation (latent burden + conditional bumps)
# ---------------------------------------------------------------------------

def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def _generate_comorbidities(rng, ages: np.ndarray, diagnoses: np.ndarray) -> dict:
    """
    Latent frailty/burden strategy:
      b ~ Beta(2,5) scaled with age so older -> higher burden.
      Each flag: p = base + b*scale, capped at plausible ceiling.
      Then pairwise conditional bumps.
    Returns dict of col_name -> bool array.
    """
    n = len(ages)
    age_norm = (ages - 60.0) / 42.0  # 0..1 over [60,102]

    # Latent burden score
    b_base = rng.beta(2.0, 5.0, n)
    burden = b_base * (0.4 + 0.6 * age_norm)  # 0..1, higher with age

    u = rng.random((n, len(COMORBIDITY_COLS)))
    flags = {}

    # Whether subject has a dementia diagnosis (for co-occurrence logic)
    is_dementia_dx = np.isin(diagnoses, list(DEMENTIA_DIAGNOSES))
    is_parkinsons_dx = (diagnoses == "Parkinson's Disease")

    BURDEN_SCALE = 0.12

    for i, col in enumerate(COMORBIDITY_COLS):
        base = COMORBIDITY_BASES[col]

        if col == "has_dementia":
            is_mci = (diagnoses == "Mild Cognitive Impairment")
            p = np.where(is_dementia_dx, 1.0,
                np.where(is_mci, 0.15, 0.02))
        elif col == "has_parkinsons":
            p = np.where(is_parkinsons_dx, 1.0, base + burden * 0.04)
        else:
            p = base + burden * BURDEN_SCALE

        p = np.clip(p, 0.0, 0.98)
        flags[col] = (u[:, i] < p).astype(bool)

    # Pairwise conditional bumps
    dm = flags["has_diabetes"]
    ht = flags["has_hypertension"]
    missing_ht = dm & ~ht
    flags["has_hypertension"] = ht | (missing_ht & (rng.random(n) < 0.40))

    cvd = flags["has_c_v_d"]
    flags["has_m_i"] = flags["has_m_i"] | (cvd & ~flags["has_m_i"] & (rng.random(n) < 0.08))
    flags["has_stroke"] = flags["has_stroke"] | (cvd & ~flags["has_stroke"] & (rng.random(n) < 0.07))
    flags["has_c_h_f"] = flags["has_c_h_f"] | (cvd & ~flags["has_c_h_f"] & (rng.random(n) < 0.08))
    flags["has_atrial_fibrillation"] = (
        flags["has_atrial_fibrillation"]
        | (cvd & ~flags["has_atrial_fibrillation"] & (rng.random(n) < 0.05))
    )

    flags["has_t_i_a"] = (
        flags["has_t_i_a"]
        | (flags["has_stroke"] & ~flags["has_t_i_a"] & (rng.random(n) < 0.15))
    )

    dem = flags["has_dementia"]
    flags["has_depression"] = (
        flags["has_depression"]
        | (dem & ~flags["has_depression"] & (rng.random(n) < 0.18))
    )
    flags["has_stroke"] = (
        flags["has_stroke"]
        | (dem & ~flags["has_stroke"] & (rng.random(n) < 0.05))
    )
    flags["has_atrial_fibrillation"] = (
        flags["has_atrial_fibrillation"]
        | (dem & ~flags["has_atrial_fibrillation"] & (rng.random(n) < 0.03))
    )

    copd = flags["has_c_o_p_d"]
    flags["has_depression"] = (
        flags["has_depression"]
        | (copd & ~flags["has_depression"] & (rng.random(n) < 0.15))
    )

    flags["has_peripheral_artery_disease"] = (
        flags["has_peripheral_artery_disease"]
        | (dm & cvd & ~flags["has_peripheral_artery_disease"] & (rng.random(n) < 0.12))
    )

    flags["has_c_a_b_g"] = (
        flags["has_c_a_b_g"]
        | (flags["has_m_i"] & ~flags["has_c_a_b_g"] & (rng.random(n) < 0.15))
    )

    old_mask = ages >= 85
    flags["has_d_v_t"] = (
        flags["has_d_v_t"]
        | (old_mask & ~flags["has_d_v_t"] & (rng.random(n) < 0.03))
    )

    return flags


# ---------------------------------------------------------------------------
# Mortality (higher with age + burden)
# ---------------------------------------------------------------------------

def _generate_mortality(rng, ages: np.ndarray, comorbidity_count: np.ndarray) -> np.ndarray:
    age_norm = (ages - 60.0) / 42.0
    burden_norm = comorbidity_count / 21.0
    p = 0.05 + 0.30 * age_norm + 0.15 * burden_norm
    p = np.clip(p, 0.0, 0.90)
    return rng.random(len(ages)) < p


# ---------------------------------------------------------------------------
# Family ID generation
# ---------------------------------------------------------------------------

def _generate_family_data(rng, is_family: np.ndarray) -> tuple[list, list]:
    """
    For family participants, assign family IDs and family_study_participant flag.
    Non-family subjects get None for family_id.
    """
    n = len(is_family)
    family_ids = [None] * n
    fam_members = np.where(is_family)[0].tolist()
    rng.shuffle(fam_members)
    fam_counter = 1
    pos = 0
    while pos < len(fam_members):
        size = int(rng.integers(2, 7))
        fam_id = f"FAM{fam_counter:05d}"
        for idx in fam_members[pos: pos + size]:
            family_ids[idx] = fam_id
        fam_counter += 1
        pos += size
    return family_ids


# ---------------------------------------------------------------------------
# syn_id generation (unique, ^syn[0-9]{6,9}$)
# ---------------------------------------------------------------------------

def _generate_syn_ids(rng, n: int) -> list[str]:
    """Generate n unique syn IDs matching ^syn[0-9]{6,9}$."""
    generated = set()
    result = []
    low, high = 100_000, 999_999_999
    batch = rng.integers(low, high + 1, size=n * 2)
    for v in batch:
        sid = f"syn{v}"
        if sid not in generated:
            generated.add(sid)
            result.append(sid)
            if len(result) == n:
                break
    while len(result) < n:
        v = rng.integers(low, high + 1)
        sid = f"syn{v}"
        if sid not in generated:
            generated.add(sid)
            result.append(sid)
    return result


# ---------------------------------------------------------------------------
# SPARSE COVERAGE: assay assignment per subject
# ---------------------------------------------------------------------------

def _assign_subject_assays(rng, n_subjects: int) -> np.ndarray:
    """
    Return a boolean array of shape (n_subjects, n_assays) indicating which
    assays each subject has data for.

    Uses ASSAY_MARGINAL_P as independent Bernoulli draws, then applies
    ASSAY_CORRELATIONS as conditional over-rides (higher P if prerequisite
    assay is present).

    Ensures every subject ends up with at least 1 assay.
    """
    n_assays = len(ASSAY_NAMES)
    # Independent draws
    raw_u = rng.random((n_subjects, n_assays))
    has_assay = raw_u < np.array(ASSAY_MARGINAL_P)  # shape (n_sub, n_assay)

    # Apply correlations: for each (a_idx, b_idx, cond_p), if subject has
    # assay a, re-draw b with probability cond_p.
    for a_idx, b_idx, cond_p in ASSAY_CORRELATIONS:
        a_present = has_assay[:, a_idx]
        # Where a is present, override b's flag with probability cond_p
        new_b_u = rng.random(n_subjects)
        # Only affects subjects that have assay A
        has_assay[a_present, b_idx] = new_b_u[a_present] < cond_p

    # Guarantee every subject has at least 1 assay
    no_assay = ~has_assay.any(axis=1)
    if no_assay.any():
        # Assign each such subject one random assay, weighted by marginal probs
        marginals = np.array(ASSAY_MARGINAL_P, dtype=float)
        marginals /= marginals.sum()
        forced = rng.choice(n_assays, size=int(no_assay.sum()), p=marginals)
        has_assay[no_assay] = False
        for i, ai in zip(np.where(no_assay)[0], forced):
            has_assay[i, ai] = True

    return has_assay


# ---------------------------------------------------------------------------
# File generation (sparse-aware)
# ---------------------------------------------------------------------------

def _generate_files_sparse(
    rng,
    n_files: int,
    study_codes: list[str],
    subject_ids: list[str],
    subject_assays: np.ndarray,
) -> tuple[list[dict], list[tuple]]:
    """
    Generate files and the subject_files junction with realistic sparse coverage.

    Design:
      - Per-sample files (is_multi_specimen=False): the majority.
        Each file links to exactly ONE subject.  Only subjects who have the
        assigned assay receive a file for it.  1-3 files per (subject, assay).
      - Cohort-level files (is_multi_specimen=True): a minority (~5%).
        Each cohort file is assigned one assay_type and links 100-800
        subjects drawn from those who HAVE that assay.

    Subjects-per-assay tracks the marginals because every (subject, assay)
    pair that exists in subject_assays gets at least one per-sample file.
    When the mandatory pair count exceeds the per-sample budget, we sample
    proportionally across assays so each assay loses coverage equally.

    Returns: (file_rows_dicts, junction_pairs_list)
    """
    n_subjects = len(subject_ids)
    n_assays = len(ASSAY_NAMES)

    # Build per-assay subject index lists for O(1) lookups
    assay_subject_idx = [
        np.where(subject_assays[:, i])[0] for i in range(n_assays)
    ]

    # File type weight vector (normalised)
    fw = np.array(ASSAY_FILE_WEIGHTS, dtype=float)
    fw /= fw.sum()

    # Split file budget
    n_multi = max(1, int(round(n_files * MULTI_SPECIMEN_FRACTION)))
    n_per_sample_budget = n_files - n_multi

    # ----------------------------------------------------------------
    # Build the mandatory per-sample assignment list:
    # one entry per (subject, assay) pair, meaning each eligible subject
    # gets exactly 1 file per assay they have.  Then add 0-2 extra files
    # per pair (Poisson extras) up to n_per_sample_budget.
    # If mandatory > budget, proportionally subsample across assays.
    # ----------------------------------------------------------------
    mandatory_pairs = []
    for ai in range(n_assays):
        for sub_i in assay_subject_idx[ai]:
            mandatory_pairs.append((int(sub_i), ai))

    mandatory_arr = np.array(mandatory_pairs, dtype=np.int32)
    rng.shuffle(mandatory_arr)
    n_mandatory = len(mandatory_arr)

    if n_mandatory <= n_per_sample_budget:
        # Room for extras after mandatory
        n_extra = n_per_sample_budget - n_mandatory
        extra_assays = rng.choice(n_assays, size=n_extra, p=fw)
        extra_pairs_list = []
        for ea in extra_assays:
            elig = assay_subject_idx[int(ea)]
            if len(elig) == 0:
                extra_pairs_list.append((int(rng.integers(0, n_subjects)), int(ea)))
            else:
                extra_pairs_list.append((int(rng.choice(elig)), int(ea)))
        if extra_pairs_list:
            extra_arr = np.array(extra_pairs_list, dtype=np.int32)
            per_sample_assignments = np.vstack([mandatory_arr, extra_arr])
        else:
            per_sample_assignments = mandatory_arr
    else:
        # More mandatory pairs than budget: sample proportionally per assay
        # so each assay keeps roughly equal fraction of its subjects.
        fraction = n_per_sample_budget / n_mandatory
        sampled = []
        for ai in range(n_assays):
            elig = assay_subject_idx[ai]
            if len(elig) == 0:
                continue
            n_keep = max(1, int(round(len(elig) * fraction)))
            n_keep = min(n_keep, len(elig))
            chosen = rng.choice(elig, size=n_keep, replace=False)
            for sub_i in chosen:
                sampled.append((int(sub_i), ai))
        per_sample_assignments = np.array(sampled, dtype=np.int32)
        rng.shuffle(per_sample_assignments)
        # Trim/pad to exactly n_per_sample_budget
        if len(per_sample_assignments) > n_per_sample_budget:
            per_sample_assignments = per_sample_assignments[:n_per_sample_budget]
        elif len(per_sample_assignments) < n_per_sample_budget:
            deficit = n_per_sample_budget - len(per_sample_assignments)
            extra_assays = rng.choice(n_assays, size=deficit, p=fw)
            extra_pairs_list = []
            for ea in extra_assays:
                elig2 = assay_subject_idx[int(ea)]
                if len(elig2) == 0:
                    extra_pairs_list.append((int(rng.integers(0, n_subjects)), int(ea)))
                else:
                    extra_pairs_list.append((int(rng.choice(elig2)), int(ea)))
            if extra_pairs_list:
                extra_arr2 = np.array(extra_pairs_list, dtype=np.int32)
                per_sample_assignments = np.vstack([per_sample_assignments, extra_arr2])

    rng.shuffle(per_sample_assignments)

    # Generate syn IDs for all n_files
    all_syn_ids = _generate_syn_ids(rng, n_files)
    file_study = rng.choice(study_codes, size=n_files)

    file_rows_dicts = []
    junction_pairs = set()

    # Ext map for filename construction
    ext_map = {
        "FASTQ": "fastq.gz",
        "BAM": "bam",
        "CRAM": "cram",
        "VCF": "vcf.gz",
        "processed counts (CSV)": "counts.csv",
        "mzML": "mzML",
        "IDAT": "idat",
    }

    # ----------------------------------------------------------------
    # Multi-specimen (cohort-level) files -- assigned assay indices
    # ----------------------------------------------------------------
    multi_assay_idx = rng.choice(n_assays, size=n_multi, p=fw)

    for j in range(n_multi):
        ai = int(multi_assay_idx[j])
        profile = ASSAY_PROFILES[ai]
        assay_type, data_type, formats, size_range = profile
        file_format = str(rng.choice(formats))
        size_lo, size_hi = size_range
        file_size = int(rng.integers(size_lo, size_hi + 1))
        syn_id = all_syn_ids[j]

        ext = ext_map.get(file_format, "bin")
        file_name = f"cohort_{assay_type.lower().replace(' ', '_')}_{j:06d}.{ext}"

        file_rows_dicts.append({
            "syn_id": syn_id,
            "file_name": file_name,
            "data_type": data_type,
            "assay_type": assay_type,
            "file_format": file_format,
            "is_multi_specimen": True,
            "file_size_bytes": file_size,
            "study_code": str(file_study[j]),
        })

        # Link to a sample of subjects who HAVE this assay.
        # 200-1500 subjects per cohort file: large enough to provide meaningful
        # assay coverage via multi-specimen files, small enough that
        # files-per-subject max stays bounded (~60 at most).
        eligible = assay_subject_idx[ai]
        if len(eligible) == 0:
            chosen_idx = [int(rng.integers(0, n_subjects))]
        else:
            lo = min(200, len(eligible))
            hi = min(1500, len(eligible))
            k = int(rng.integers(lo, hi + 1))
            chosen_idx = rng.choice(eligible, size=k, replace=False)
        for idx in chosen_idx:
            junction_pairs.add((subject_ids[int(idx)], syn_id))

    # Now generate file records for the per-sample assignments
    file_idx = n_multi  # running index into all_syn_ids
    for k, (sub_i, ai) in enumerate(per_sample_assignments):
        ai = int(ai)
        sub_i = int(sub_i)
        profile = ASSAY_PROFILES[ai]
        assay_type, data_type, formats, size_range = profile
        file_format = str(rng.choice(formats))
        size_lo, size_hi = size_range
        file_size = int(rng.integers(size_lo, size_hi + 1))
        syn_id = all_syn_ids[file_idx % len(all_syn_ids)]
        file_idx += 1

        ext = ext_map.get(file_format, "bin")
        rand_suffix = int(rng.integers(1000, 99999))
        file_name = f"sample{rand_suffix}_{assay_type.lower().replace(' ', '_')}_{k:06d}.{ext}"

        file_rows_dicts.append({
            "syn_id": syn_id,
            "file_name": file_name,
            "data_type": data_type,
            "assay_type": assay_type,
            "file_format": file_format,
            "is_multi_specimen": False,
            "file_size_bytes": file_size,
            "study_code": str(file_study[min(file_idx - 1, len(file_study) - 1)]),
        })
        junction_pairs.add((subject_ids[sub_i], syn_id))

    # Guarantee every subject has at least 1 file
    covered_subs = {p[0] for p in junction_pairs}
    missing_subs = [s for s in subject_ids if s not in covered_subs]
    if missing_subs and file_rows_dicts:
        for sid in missing_subs:
            file_rec = file_rows_dicts[int(rng.integers(0, len(file_rows_dicts)))]
            junction_pairs.add((sid, file_rec["syn_id"]))

    # Guarantee every file has at least 1 subject
    covered_files = {p[1] for p in junction_pairs}
    missing_files = [f["syn_id"] for f in file_rows_dicts if f["syn_id"] not in covered_files]
    if missing_files and subject_ids:
        for syn in missing_files:
            sid = subject_ids[int(rng.integers(0, len(subject_ids)))]
            junction_pairs.add((sid, syn))

    return file_rows_dicts, list(junction_pairs)


# ---------------------------------------------------------------------------
# DuckDB Parquet writer
# ---------------------------------------------------------------------------

def _coerce_value(value, col_type: str):
    """Coerce a Python value to the native type matching the DuckDB column type."""
    if value is None:
        return None
    t = col_type.upper()
    if t == "BOOLEAN":
        return bool(value)
    if t in ("INTEGER", "BIGINT"):
        return int(value)
    # VARCHAR / fallback
    return str(value)


def _write_parquet_and_csv(
    out_dir: Path,
    table_name: str,
    columns: list[str],
    rows: list,
    col_types: list[str],
):
    """
    Use DuckDB to write a typed Parquet file and a CSV file.

    `rows` is a list of sequences matching `columns` order.
    `col_types` is a parallel list of DuckDB type names
    (e.g. 'VARCHAR', 'INTEGER', 'BIGINT', 'BOOLEAN'), so the emitted
    Parquet carries correct logical types instead of all-VARCHAR.
    """
    assert len(columns) == len(col_types), (
        f"{table_name}: {len(columns)} columns but {len(col_types)} types"
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = str(out_dir / f"{table_name}.parquet")
    csv_path = str(out_dir / f"{table_name}.csv")

    con = duckdb.connect(":memory:")

    col_defs = ", ".join(f'"{c}" {t}' for c, t in zip(columns, col_types))
    con.execute(f"CREATE TABLE {table_name} ({col_defs})")

    if rows:
        placeholders = ", ".join("?" for _ in columns)
        CHUNK = 50_000
        for start in range(0, len(rows), CHUNK):
            chunk = rows[start: start + CHUNK]
            typed_chunk = [
                tuple(_coerce_value(v, t) for v, t in zip(row, col_types))
                for row in chunk
            ]
            con.executemany(
                f"INSERT INTO {table_name} VALUES ({placeholders})",
                typed_chunk,
            )

    con.execute(f"COPY {table_name} TO '{parquet_path}' (FORMAT PARQUET, COMPRESSION SNAPPY)")
    con.execute(f"COPY {table_name} TO '{csv_path}' (FORMAT CSV, HEADER TRUE)")
    con.close()
    print(f"  Wrote {parquet_path}  ({len(rows):,} rows)")
    print(f"  Wrote {csv_path}")


# ---------------------------------------------------------------------------
# MODE A: ELITE generator
# ---------------------------------------------------------------------------

def generate_elite(out_dir: Path, n_subjects: int = N_SUBJECTS, n_files: int = N_FILES):
    rng = _setup_rng(SEED)
    print(f"Generating ELITE dataset: {n_subjects:,} subjects, {n_files:,} files ...")

    # ------------------------------------------------------------------
    # 1. Subjects
    # ------------------------------------------------------------------
    ages = _generate_ages(rng, n_subjects)
    age_bins = [_age_bin(a) for a in ages]

    sex = _weighted_choice(rng, SEX_VALUES, SEX_PROBS, n_subjects)
    race = _weighted_choice(rng, RACE_VALUES, RACE_PROBS, n_subjects)
    ethnicity = _weighted_choice(rng, ETHNICITY_VALUES, ETHNICITY_PROBS, n_subjects)
    ethnic_group_code = _weighted_choice(rng, ETHNIC_GROUP_VALUES, ETHNIC_GROUP_PROBS, n_subjects)
    cohort = _weighted_choice(rng, COHORT_VALUES, COHORT_PROBS, n_subjects)
    study_code = _weighted_choice(rng, STUDY_CODE_VALUES, STUDY_CODE_PROBS, n_subjects)
    country_code = _weighted_choice(rng, COUNTRY_CODE_VALUES, COUNTRY_CODE_PROBS, n_subjects)
    field_center_code = _weighted_choice(rng, FIELD_CENTER_VALUES, FIELD_CENTER_PROBS, n_subjects)
    diagnosis = _weighted_choice(rng, DIAGNOSIS_VALUES, DIAGNOSIS_PROBS, n_subjects)
    diagnosis_macro = np.array([DIAGNOSIS_MACRO[d] for d in diagnosis])
    diagnosis_status = ~np.isin(diagnosis, ["Control", "Longevity / Centenarian"])

    is_dementia_dx = np.isin(diagnosis, list(DEMENTIA_DIAGNOSES))
    apoe_raw = _sample_apoe_alleles(rng, n_subjects)
    apoe_genotype = _enrich_apoe_for_dementia(rng, apoe_raw, is_dementia_dx)
    apoe_e4_carrier = np.array(["e4" in g for g in apoe_genotype])

    visit_count = rng.choice([1, 2, 3, 4], size=n_subjects, p=[0.40, 0.30, 0.20, 0.10])

    has_education = rng.random(n_subjects) < 0.70
    has_biomarker_data = rng.random(n_subjects) < 0.60
    has_functional_assessment = rng.random(n_subjects) < 0.55
    has_anthropometrics = rng.random(n_subjects) < 0.65
    has_cognitive_assessment = rng.random(n_subjects) < 0.58

    is_family = np.isin(cohort, list(FAMILY_COHORTS))
    family_ids = _generate_family_data(rng, is_family)
    family_study_participant = is_family
    has_mz_twin_data = is_family & (rng.random(n_subjects) < 0.03)

    comorbidity_flags = _generate_comorbidities(rng, ages, diagnosis)
    comorbidity_count = np.sum(
        [comorbidity_flags[c].astype(int) for c in COMORBIDITY_COLS], axis=0
    )

    mortality_status = _generate_mortality(rng, ages, comorbidity_count)

    subject_ids = [f"SUB_{i:06d}" for i in range(1, n_subjects + 1)]

    subject_cols = [
        "subject_id", "age", "age_bin", "sex", "race", "ethnicity", "ethnic_group_code",
        "diagnosis", "diagnosis_macro", "diagnosis_status", "cohort", "study_code",
        "country_code", "field_center_code", "mortality_status", "family_study_participant",
        "family_id", "has_m_z_twin_data", "apoe_genotype", "apoe_e4_carrier", "visit_count",
        "has_education", "has_biomarker_data", "has_functional_assessment",
        "has_anthropometrics", "has_cognitive_assessment",
    ] + COMORBIDITY_COLS + ["comorbidity_count"]

    subject_types = [
        "VARCHAR",   # subject_id
        "INTEGER",   # age
        "VARCHAR",   # age_bin
        "VARCHAR",   # sex
        "VARCHAR",   # race
        "VARCHAR",   # ethnicity
        "VARCHAR",   # ethnic_group_code
        "VARCHAR",   # diagnosis
        "VARCHAR",   # diagnosis_macro
        "BOOLEAN",   # diagnosis_status
        "VARCHAR",   # cohort
        "VARCHAR",   # study_code
        "VARCHAR",   # country_code
        "VARCHAR",   # field_center_code
        "BOOLEAN",   # mortality_status
        "BOOLEAN",   # family_study_participant
        "VARCHAR",   # family_id (nullable)
        "BOOLEAN",   # has_m_z_twin_data
        "VARCHAR",   # apoe_genotype
        "BOOLEAN",   # apoe_e4_carrier
        "INTEGER",   # visit_count
        "BOOLEAN",   # has_education
        "BOOLEAN",   # has_biomarker_data
        "BOOLEAN",   # has_functional_assessment
        "BOOLEAN",   # has_anthropometrics
        "BOOLEAN",   # has_cognitive_assessment
    ] + ["BOOLEAN"] * len(COMORBIDITY_COLS) + ["INTEGER"]

    subject_rows = []
    for i in range(n_subjects):
        row = [
            subject_ids[i],
            int(ages[i]),
            age_bins[i],
            str(sex[i]),
            str(race[i]),
            str(ethnicity[i]),
            str(ethnic_group_code[i]),
            str(diagnosis[i]),
            str(diagnosis_macro[i]),
            bool(diagnosis_status[i]),
            str(cohort[i]),
            str(study_code[i]),
            str(country_code[i]),
            str(field_center_code[i]),
            bool(mortality_status[i]),
            bool(family_study_participant[i]),
            family_ids[i],
            bool(has_mz_twin_data[i]),
            str(apoe_genotype[i]),
            bool(apoe_e4_carrier[i]),
            int(visit_count[i]),
            bool(has_education[i]),
            bool(has_biomarker_data[i]),
            bool(has_functional_assessment[i]),
            bool(has_anthropometrics[i]),
            bool(has_cognitive_assessment[i]),
        ] + [bool(comorbidity_flags[c][i]) for c in COMORBIDITY_COLS] + [int(comorbidity_count[i])]
        subject_rows.append(row)

    # ------------------------------------------------------------------
    # 2. Sparse assay assignment
    # ------------------------------------------------------------------
    print("Assigning sparse assay coverage ...")
    subject_assays = _assign_subject_assays(rng, n_subjects)

    # ------------------------------------------------------------------
    # 3. Files + junction (sparse)
    # ------------------------------------------------------------------
    print("Generating files and subject_files junction (sparse coverage) ...")
    file_rows_dicts, junction_pairs = _generate_files_sparse(
        rng, n_files, STUDY_CODE_VALUES, subject_ids, subject_assays
    )

    file_cols = ["syn_id", "file_name", "data_type", "assay_type", "file_format",
                 "is_multi_specimen", "file_size_bytes", "study_code"]
    file_types = [
        "VARCHAR",   # syn_id
        "VARCHAR",   # file_name
        "VARCHAR",   # data_type
        "VARCHAR",   # assay_type
        "VARCHAR",   # file_format
        "BOOLEAN",   # is_multi_specimen
        "BIGINT",    # file_size_bytes
        "VARCHAR",   # study_code
    ]
    file_rows = [
        [r["syn_id"], r["file_name"], r["data_type"], r["assay_type"],
         r["file_format"], r["is_multi_specimen"], r["file_size_bytes"], r["study_code"]]
        for r in file_rows_dicts
    ]

    junction_cols = ["subject_id", "syn_id"]
    junction_types = ["VARCHAR", "VARCHAR"]
    junction_rows = list(junction_pairs)

    # ------------------------------------------------------------------
    # 4. Write output
    # ------------------------------------------------------------------
    print(f"Writing to {out_dir} ...")
    _write_parquet_and_csv(out_dir, "subjects", subject_cols, subject_rows, subject_types)
    _write_parquet_and_csv(out_dir, "files", file_cols, file_rows, file_types)
    _write_parquet_and_csv(out_dir, "subject_files", junction_cols, junction_rows, junction_types)

    # ------------------------------------------------------------------
    # 5. Manifest
    # ------------------------------------------------------------------
    n_junc = len(junction_rows)

    def pct(col):
        return round(sum(1 for r in subject_rows if r[subject_cols.index(col)] is True) / n_subjects * 100, 2)

    from collections import defaultdict
    subs_per_file = defaultdict(int)
    files_per_sub = defaultdict(int)
    for sid, syn in junction_rows:
        subs_per_file[syn] += 1
        files_per_sub[sid] += 1

    spf_vals = sorted(subs_per_file.values())
    fps_vals = sorted(files_per_sub.values())

    def median_of(vals):
        if not vals:
            return 0
        mid = len(vals) // 2
        return vals[mid]

    def avg_of(vals):
        if not vals:
            return 0
        return round(sum(vals) / len(vals), 1)

    # Realised subjects per assay type (from junction + files)
    con_v = duckdb.connect(":memory:")
    subjects_p = str(out_dir / "subjects.parquet")
    files_p = str(out_dir / "files.parquet")
    junc_p = str(out_dir / "subject_files.parquet")
    con_v.execute(f"CREATE VIEW subjects AS SELECT * FROM read_parquet('{subjects_p}')")
    con_v.execute(f"CREATE VIEW files AS SELECT * FROM read_parquet('{files_p}')")
    con_v.execute(f"CREATE VIEW subject_files AS SELECT * FROM read_parquet('{junc_p}')")
    assay_coverage = dict(con_v.execute(
        "SELECT f.assay_type, COUNT(DISTINCT sf.subject_id) "
        "FROM subject_files sf JOIN files f ON sf.syn_id = f.syn_id "
        "GROUP BY f.assay_type ORDER BY f.assay_type"
    ).fetchall())
    con_v.close()

    manifest = {
        "seed": SEED,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "row_counts": {
            "subjects": n_subjects,
            "files": len(file_rows),
            "subject_files": n_junc,
        },
        "realised_prevalences_pct": {
            "has_hypertension": pct("has_hypertension"),
            "has_diabetes": pct("has_diabetes"),
            "has_c_v_d": pct("has_c_v_d"),
            "has_c_o_p_d": pct("has_c_o_p_d"),
            "has_stroke": pct("has_stroke"),
            "has_atrial_fibrillation": pct("has_atrial_fibrillation"),
            "has_depression": pct("has_depression"),
            "has_cancer": pct("has_cancer"),
            "has_dementia": pct("has_dementia"),
            "mortality_status": round(
                sum(1 for r in subject_rows if r[subject_cols.index("mortality_status")] is True)
                / n_subjects * 100, 2
            ),
        },
        "subjects_per_assay_type": {k: int(v) for k, v in assay_coverage.items()},
        "file_cardinality": {
            "subjects_per_file_min": int(min(spf_vals)) if spf_vals else 0,
            "subjects_per_file_median": int(median_of(spf_vals)),
            "subjects_per_file_max": int(max(spf_vals)) if spf_vals else 0,
            "files_per_subject_min": int(min(fps_vals)) if fps_vals else 0,
            "files_per_subject_median": int(median_of(fps_vals)),
            "files_per_subject_avg": float(avg_of(fps_vals)),
            "files_per_subject_max": int(max(fps_vals)) if fps_vals else 0,
        },
        "apoe_e4_rate_pct": round(sum(1 for r in subject_rows if r[subject_cols.index("apoe_e4_carrier")] is True) / n_subjects * 100, 2),
    }

    manifest_path = out_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  Wrote {manifest_path}")

    # ------------------------------------------------------------------
    # 6. Validation
    # ------------------------------------------------------------------
    print("\nValidating ...")
    _validate_elite(out_dir, manifest)

    return manifest


def _validate_elite(out_dir: Path, manifest: dict):
    """Run DuckDB queries against the written parquet files to verify invariants."""
    con = duckdb.connect(":memory:")
    subjects_p = str(out_dir / "subjects.parquet")
    files_p = str(out_dir / "files.parquet")
    junc_p = str(out_dir / "subject_files.parquet")

    con.execute(f"CREATE VIEW subjects AS SELECT * FROM read_parquet('{subjects_p}')")
    con.execute(f"CREATE VIEW files AS SELECT * FROM read_parquet('{files_p}')")
    con.execute(f"CREATE VIEW subject_files AS SELECT * FROM read_parquet('{junc_p}')")

    checks = {}

    # Row counts
    checks["subject_count"] = con.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    checks["file_count"] = con.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    checks["junction_count"] = con.execute("SELECT COUNT(*) FROM subject_files").fetchone()[0]

    # syn_id format
    bad_syn = con.execute(
        "SELECT COUNT(*) FROM files WHERE syn_id NOT SIMILAR TO 'syn[0-9]{6,9}'"
    ).fetchone()[0]
    checks["syn_id_format_violations"] = bad_syn

    # Uniqueness
    dup_syn = con.execute(
        "SELECT COUNT(*) FROM (SELECT syn_id, COUNT(*) c FROM files GROUP BY syn_id HAVING c > 1)"
    ).fetchone()[0]
    checks["duplicate_syn_ids"] = dup_syn

    # Many-to-many: max subjects per file
    checks["max_subjects_per_file"] = con.execute(
        "SELECT MAX(cnt) FROM (SELECT syn_id, COUNT(*) cnt FROM subject_files GROUP BY syn_id)"
    ).fetchone()[0]

    # Files-per-subject distribution
    fps_stats = con.execute(
        "SELECT MIN(cnt), MEDIAN(cnt), AVG(cnt), MAX(cnt) "
        "FROM (SELECT subject_id, COUNT(*) cnt FROM subject_files GROUP BY subject_id)"
    ).fetchone()
    checks["files_per_subject_min"] = int(fps_stats[0])
    checks["files_per_subject_median"] = int(fps_stats[1])
    checks["files_per_subject_avg"] = round(float(fps_stats[2]), 1)
    checks["files_per_subject_max"] = int(fps_stats[3])

    # Subjects per assay type (the key sparsity check)
    assay_rows = con.execute(
        "SELECT f.assay_type, COUNT(DISTINCT sf.subject_id) AS n_subjects "
        "FROM subject_files sf JOIN files f ON sf.syn_id = f.syn_id "
        "GROUP BY f.assay_type ORDER BY f.assay_type"
    ).fetchall()
    checks["subjects_per_assay"] = {r[0]: r[1] for r in assay_rows}

    # Distinct assay types per subject histogram
    assay_dist = con.execute(
        "SELECT n_assays, COUNT(*) AS n_subjects "
        "FROM (SELECT subject_id, COUNT(DISTINCT assay_type) AS n_assays "
        "      FROM subject_files sf JOIN files f ON sf.syn_id = f.syn_id "
        "      GROUP BY subject_id) "
        "GROUP BY n_assays ORDER BY n_assays"
    ).fetchall()
    checks["assay_types_per_subject_hist"] = {r[0]: r[1] for r in assay_dist}

    # Orphan subjects (no files)
    checks["orphan_subjects"] = con.execute(
        "SELECT COUNT(*) FROM subjects s WHERE NOT EXISTS (SELECT 1 FROM subject_files sf WHERE sf.subject_id = s.subject_id)"
    ).fetchone()[0]

    # Orphan files (no subjects)
    checks["orphan_files"] = con.execute(
        "SELECT COUNT(*) FROM files f WHERE NOT EXISTS (SELECT 1 FROM subject_files sf WHERE sf.syn_id = f.syn_id)"
    ).fetchone()[0]

    con.close()

    print("\n=== Validation Results ===")
    for k, v in checks.items():
        if isinstance(v, dict):
            print(f"  {k}:")
            for kk, vv in v.items():
                print(f"    {kk}: {vv:,}" if isinstance(vv, int) else f"    {kk}: {vv}")
        else:
            print(f"  {k}: {v}")

    assert checks["syn_id_format_violations"] == 0, "syn_id format violations found!"
    assert checks["duplicate_syn_ids"] == 0, "Duplicate syn_ids found!"
    assert checks["orphan_subjects"] == 0, "Orphan subjects found!"
    assert checks["orphan_files"] == 0, "Orphan files found!"

    # Sparsity assertions: WGS must NOT cover all subjects
    wgs_count = checks["subjects_per_assay"].get("WGS", 0)
    n_sub = checks["subject_count"]
    assert wgs_count < n_sub, f"WGS covers all {n_sub} subjects -- sparse coverage not working!"
    assert wgs_count > n_sub * 0.50, f"WGS coverage {wgs_count} is below 50% of {n_sub}"

    scrnaseq_count = checks["subjects_per_assay"].get("scRNAseq", 0)
    assert scrnaseq_count < n_sub * 0.30, f"scRNAseq coverage {scrnaseq_count} is above 30% -- not sparse enough"

    # files-per-subject: median must be sane
    assert checks["files_per_subject_median"] <= 60, f"Median files/subject {checks['files_per_subject_median']} too high"
    assert checks["files_per_subject_max"] <= 500, f"Max files/subject {checks['files_per_subject_max']} too high"

    print("  All invariants PASSED.")

    print("\n=== Manifest Summary ===")
    print(json.dumps(manifest, indent=2))


# ---------------------------------------------------------------------------
# MODE B: from-spec generator
# ---------------------------------------------------------------------------

def generate_from_spec(
    spec_path: str,
    out_dir: Path,
    n_subjects: int = 3_000,
    n_files: int = 800,
):
    """
    Generic generator for any CohortSpec JSON or bare variables array.
    Reads variables[], emits columns of the right type with plausible values.
    File-level assay/dataType/fileFormat variables receive sparse subject
    coverage so that file-modality filters actually partition the cohort.
    """
    rng = _setup_rng(SEED)

    with open(spec_path) as f:
        raw = json.load(f)

    if isinstance(raw, list):
        variables = raw
        spec_id = Path(spec_path).stem
        spec_title = spec_id
    else:
        variables = raw.get("variables", [])
        spec_id = raw.get("id", Path(spec_path).stem)
        spec_title = raw.get("title", spec_id)

    print(f"from-spec: {spec_id} ({len(variables)} variables), {n_subjects} subjects, {n_files} files")

    def _is_file_entity(v: dict) -> bool:
        return str(v.get("entity", "")).lower() in ("file", "files")

    file_vars = [v for v in variables if _is_file_entity(v)]
    subject_vars = [v for v in variables if not _is_file_entity(v)]

    # ------------------------------------------------------------------
    # Subjects
    # ------------------------------------------------------------------
    subject_ids = [f"S{i:06d}" for i in range(1, n_subjects + 1)]
    sub_cols = ["subject_id"]
    sub_types = ["VARCHAR"]
    sub_rows = [[sid] for sid in subject_ids]

    for var in subject_vars:
        col = var.get("column", var.get("name", "unknown"))
        vals = _spec_generate_column(rng, var, n_subjects)
        sub_cols.append(col)
        sub_types.append(_spec_column_type(var))
        for i, v in enumerate(vals):
            sub_rows[i].append(v)

    # ------------------------------------------------------------------
    # Files (sparse coverage for assay/dataType/fileFormat variables)
    # ------------------------------------------------------------------
    file_ids = _generate_syn_ids(rng, n_files)
    f_cols = ["syn_id"]
    f_types = ["VARCHAR"]
    f_rows = [[fid] for fid in file_ids]

    # Detect if spec has an assay-type-like column on files so we can
    # drive sparse junction logic.  Key column names to recognise:
    ASSAY_COL_NAMES = {"assay_type", "assay", "data_type", "datatype"}

    spec_assay_col = None  # column name if found among file vars
    spec_assay_values = None  # list of distinct values for that column

    for var in file_vars:
        col = var.get("column", var.get("name", "unknown"))
        vals = _spec_generate_column(rng, var, n_files)
        f_cols.append(col)
        f_types.append(_spec_column_type(var))
        for i, v in enumerate(vals):
            f_rows[i].append(v)
        # Track first assay-like column to drive sparse junction
        if spec_assay_col is None and col.lower().replace("-", "_") in ASSAY_COL_NAMES:
            spec_assay_col = col
            spec_assay_values = var.get("values", [])

    # If no file vars, add minimal file columns
    if not file_vars:
        assay_vals = ["RNAseq", "WGS", "proteomics", "methylation array"]
        fmt_vals = ["FASTQ", "BAM", "VCF", "processed counts (CSV)"]
        f_cols += ["assay_type", "file_format", "is_multi_specimen"]
        f_types += ["VARCHAR", "VARCHAR", "BOOLEAN"]
        for i in range(n_files):
            f_rows[i] += [
                rng.choice(assay_vals),
                rng.choice(fmt_vals),
                bool(rng.random() < 0.20),
            ]
        spec_assay_col = "assay_type"
        spec_assay_values = assay_vals

    # ------------------------------------------------------------------
    # Junction: sparse many-to-many
    #
    # If we detected an assay-like column, use sparse logic:
    #   - identify distinct assay values in the generated file rows
    #   - assign each subject a sparse subset of assay values
    #   - per-sample files link to subjects who HAVE that assay
    #   - cohort-level files (is_multi_specimen=True) link to a sample
    #     of subjects who HAVE that assay
    # ------------------------------------------------------------------
    is_multi_col = "is_multi_specimen"
    ms_col_idx = f_cols.index(is_multi_col) if is_multi_col in f_cols else None
    assay_col_idx = f_cols.index(spec_assay_col) if spec_assay_col in f_cols else None

    if assay_col_idx is not None:
        # Discover distinct assay values actually in the file rows
        distinct_assays = sorted({str(f_rows[i][assay_col_idx]) for i in range(n_files)})
        n_assay_types = len(distinct_assays)
        assay_to_idx = {a: j for j, a in enumerate(distinct_assays)}

        # Assign subjects a sparse subset of assay types
        # Use marginal prevalence ~50% per type by default, with no correlations
        sparse_p = min(0.55, 1.0 / max(1, n_assay_types / 3.5))
        sub_has_assay = rng.random((n_subjects, n_assay_types)) < sparse_p
        # Ensure every subject has at least one assay
        no_assay = ~sub_has_assay.any(axis=1)
        if no_assay.any():
            forced_assay = rng.integers(0, n_assay_types, size=int(no_assay.sum()))
            for i, ai in zip(np.where(no_assay)[0], forced_assay):
                sub_has_assay[i, int(ai)] = True

        # Build per-assay subject index lists
        assay_sub_idx = [np.where(sub_has_assay[:, j])[0] for j in range(n_assay_types)]

        # Multi-specimen fraction
        n_multi = max(1, int(round(n_files * MULTI_SPECIMEN_FRACTION)))
        junction_pairs = set()

        for i, row in enumerate(f_rows):
            syn_id = row[0]
            assay_val = str(row[assay_col_idx])
            ai = assay_to_idx.get(assay_val, 0)
            eligible = assay_sub_idx[ai]

            is_multi = False
            if ms_col_idx is not None:
                raw_ms = row[ms_col_idx]
                is_multi = (str(raw_ms).lower() == "true") if not isinstance(raw_ms, bool) else bool(raw_ms)

            if is_multi or i < n_multi:
                # Cohort-level: link to a sample of eligible subjects.
                # Cap at 10% of n_subjects to prevent files-per-subject inflation.
                if len(eligible) == 0:
                    chosen = [int(rng.integers(0, n_subjects))]
                else:
                    lo = min(20, len(eligible))
                    hi = min(max(20, int(n_subjects * 0.10)), len(eligible))
                    if hi < lo:
                        hi = lo
                    k = int(rng.integers(lo, hi + 1))
                    chosen = rng.choice(eligible, size=k, replace=False).tolist()
                for idx in chosen:
                    junction_pairs.add((subject_ids[int(idx)], syn_id))
            else:
                # Per-sample: link to exactly 1 eligible subject
                if len(eligible) == 0:
                    idx = int(rng.integers(0, n_subjects))
                else:
                    idx = int(rng.choice(eligible))
                junction_pairs.add((subject_ids[idx], syn_id))

    else:
        # No assay column detected: fall back to original junction logic
        if ms_col_idx is not None:
            file_dicts = [
                {"syn_id": f_rows[i][0], "is_multi_specimen": str(f_rows[i][ms_col_idx]).lower() == "true"}
                for i in range(n_files)
            ]
        else:
            file_dicts = [
                {"syn_id": f_rows[i][0], "is_multi_specimen": (i % 5 == 0)}
                for i in range(n_files)
            ]
        junction_pairs_list = _generate_junction_legacy(rng, subject_ids, file_dicts)
        junction_pairs = set(junction_pairs_list)

    # Guarantee every subject has >= 1 file
    covered_subs = {p[0] for p in junction_pairs}
    missing_subs = [s for s in subject_ids if s not in covered_subs]
    if missing_subs and f_rows:
        for sid in missing_subs:
            file_rec_syn = f_rows[int(rng.integers(0, len(f_rows)))][0]
            junction_pairs.add((sid, file_rec_syn))

    # Guarantee every file has >= 1 subject
    covered_files = {p[1] for p in junction_pairs}
    missing_files = [f_rows[i][0] for i in range(len(f_rows)) if f_rows[i][0] not in covered_files]
    if missing_files and subject_ids:
        for syn in missing_files:
            sid = subject_ids[int(rng.integers(0, len(subject_ids)))]
            junction_pairs.add((sid, syn))

    junction_rows = list(junction_pairs)
    junction_cols = ["subject_id", "syn_id"]
    junction_types = ["VARCHAR", "VARCHAR"]

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------
    print(f"Writing to {out_dir} ...")
    _write_parquet_and_csv(out_dir, "subjects", sub_cols, sub_rows, sub_types)
    _write_parquet_and_csv(out_dir, "files", f_cols, f_rows, f_types)
    _write_parquet_and_csv(out_dir, "subject_files", junction_cols, junction_rows, junction_types)

    # Manifest
    from collections import defaultdict
    subs_per_file = defaultdict(int)
    files_per_sub = defaultdict(int)
    for sid, syn in junction_rows:
        subs_per_file[syn] += 1
        files_per_sub[sid] += 1

    spf_vals = sorted(subs_per_file.values())
    fps_vals = sorted(files_per_sub.values())

    def median_of(vals):
        if not vals:
            return 0
        mid = len(vals) // 2
        return vals[mid]

    def avg_of(vals):
        if not vals:
            return 0
        return round(sum(vals) / len(vals), 1)

    # Subjects per assay type (where assay column exists)
    assay_coverage_spec = {}
    if assay_col_idx is not None:
        con_sp = duckdb.connect(":memory:")
        files_p_sp = str(out_dir / "files.parquet")
        junc_p_sp = str(out_dir / "subject_files.parquet")
        con_sp.execute(f"CREATE VIEW files AS SELECT * FROM read_parquet('{files_p_sp}')")
        con_sp.execute(f"CREATE VIEW subject_files AS SELECT * FROM read_parquet('{junc_p_sp}')")
        assay_col_safe = spec_assay_col.replace('"', '""')
        try:
            rows_sp = con_sp.execute(
                f'SELECT f."{assay_col_safe}", COUNT(DISTINCT sf.subject_id) '
                f'FROM subject_files sf JOIN files f ON sf.syn_id = f.syn_id '
                f'GROUP BY f."{assay_col_safe}" ORDER BY f."{assay_col_safe}"'
            ).fetchall()
            assay_coverage_spec = {str(r[0]): int(r[1]) for r in rows_sp}
        except Exception:
            pass
        con_sp.close()

    manifest = {
        "seed": SEED,
        "spec_id": spec_id,
        "spec_title": spec_title,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "row_counts": {
            "subjects": n_subjects,
            "files": n_files,
            "subject_files": len(junction_rows),
        },
        "subjects_per_assay_type": assay_coverage_spec,
        "file_cardinality": {
            "subjects_per_file_min": int(min(spf_vals)) if spf_vals else 0,
            "subjects_per_file_median": int(median_of(spf_vals)),
            "subjects_per_file_max": int(max(spf_vals)) if spf_vals else 0,
            "files_per_subject_min": int(min(fps_vals)) if fps_vals else 0,
            "files_per_subject_median": int(median_of(fps_vals)),
            "files_per_subject_avg": float(avg_of(fps_vals)),
            "files_per_subject_max": int(max(fps_vals)) if fps_vals else 0,
        },
    }
    manifest_path = out_dir / "manifest.json"
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)
    print(f"  Wrote {manifest_path}")
    print("\n=== from-spec Manifest ===")
    print(json.dumps(manifest, indent=2))

    # ------------------------------------------------------------------
    # Verification queries
    # ------------------------------------------------------------------
    _validate_from_spec(out_dir, spec_id, assay_col_idx, spec_assay_col)


def _validate_from_spec(out_dir: Path, spec_id: str, assay_col_idx, spec_assay_col):
    """Run DuckDB verification queries and print the results."""
    con = duckdb.connect(":memory:")
    subjects_p = str(out_dir / "subjects.parquet")
    files_p = str(out_dir / "files.parquet")
    junc_p = str(out_dir / "subject_files.parquet")
    con.execute(f"CREATE VIEW subjects AS SELECT * FROM read_parquet('{subjects_p}')")
    con.execute(f"CREATE VIEW files AS SELECT * FROM read_parquet('{files_p}')")
    con.execute(f"CREATE VIEW subject_files AS SELECT * FROM read_parquet('{junc_p}')")

    print(f"\n=== from-spec Validation: {spec_id} ===")

    n_subjects = con.execute("SELECT COUNT(*) FROM subjects").fetchone()[0]
    n_files = con.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    n_junc = con.execute("SELECT COUNT(*) FROM subject_files").fetchone()[0]
    orphan_sub = con.execute(
        "SELECT COUNT(*) FROM subjects s WHERE NOT EXISTS (SELECT 1 FROM subject_files sf WHERE sf.subject_id = s.subject_id)"
    ).fetchone()[0]
    orphan_file = con.execute(
        "SELECT COUNT(*) FROM files f WHERE NOT EXISTS (SELECT 1 FROM subject_files sf WHERE sf.syn_id = f.syn_id)"
    ).fetchone()[0]
    fps_stats = con.execute(
        "SELECT MIN(cnt), MEDIAN(cnt)::INT, AVG(cnt), MAX(cnt) "
        "FROM (SELECT subject_id, COUNT(*) cnt FROM subject_files GROUP BY subject_id)"
    ).fetchone()
    bad_syn = con.execute(
        "SELECT COUNT(*) FROM files WHERE syn_id NOT SIMILAR TO 'syn[0-9]{6,9}'"
    ).fetchone()[0]

    print(f"  subjects: {n_subjects:,}, files: {n_files:,}, junction rows: {n_junc:,}")
    print(f"  orphan_subjects: {orphan_sub}, orphan_files: {orphan_file}")
    print(f"  files_per_subject: min={fps_stats[0]}, median={fps_stats[1]}, avg={round(fps_stats[2],1)}, max={fps_stats[3]}")
    print(f"  syn_id_format_violations: {bad_syn}")

    if assay_col_idx is not None and spec_assay_col:
        assay_col_safe = spec_assay_col.replace('"', '""')
        try:
            assay_rows = con.execute(
                f'SELECT f."{assay_col_safe}", COUNT(DISTINCT sf.subject_id) AS n_subjects '
                f'FROM subject_files sf JOIN files f ON sf.syn_id = f.syn_id '
                f'GROUP BY f."{assay_col_safe}" ORDER BY f."{assay_col_safe}"'
            ).fetchall()
            print(f"  subjects_per_{spec_assay_col}:")
            for r in assay_rows:
                pct = round(r[1] / n_subjects * 100, 1)
                print(f"    {r[0]}: {r[1]:,} ({pct}%)")
        except Exception as e:
            print(f"  (assay coverage query failed: {e})")

    con.close()

    assert orphan_sub == 0, f"{spec_id}: orphan subjects found!"
    assert orphan_file == 0, f"{spec_id}: orphan files found!"
    assert bad_syn == 0, f"{spec_id}: syn_id format violations!"
    print(f"  Invariants PASSED.")


# ---------------------------------------------------------------------------
# Legacy junction generator (fallback for from-spec with no assay column)
# ---------------------------------------------------------------------------

def _generate_junction_legacy(rng, subject_ids: list[str], files: list[dict]) -> list[tuple]:
    """
    Original many-to-many junction logic, used as fallback in from-spec mode
    when no assay-type column is present in the file rows.
    """
    n_sub = len(subject_ids)
    sub_idx = np.arange(n_sub)
    pairs = set()

    per_sample = [f for f in files if not f["is_multi_specimen"]]
    multi_spec = [f for f in files if f["is_multi_specimen"]]

    n_per = len(per_sample)
    if n_per > 0:
        raw_counts = rng.negative_binomial(2, 0.4, n_sub).astype(float) + 1
        raw_counts_int = raw_counts.astype(int)
        total_desired = raw_counts_int.sum()
        scale = n_per / max(total_desired, 1)
        counts = np.maximum(1, (raw_counts_int * scale).round().astype(int))

        diff = n_per - int(counts.sum())
        if diff > 0:
            extra_idx = rng.choice(n_sub, size=int(diff), replace=True)
            for ei in extra_idx:
                counts[ei] += 1
        elif diff < 0:
            to_remove = int(-diff)
            removed = 0
            while removed < to_remove:
                c = np.where(counts > 1)[0]
                if len(c) == 0:
                    break
                pick = rng.choice(c)
                counts[pick] -= 1
                removed += 1

        assignment = np.repeat(sub_idx, counts)
        rng.shuffle(assignment)
        assign_len = len(assignment)
        for j, file_rec in enumerate(per_sample):
            sid = subject_ids[int(assignment[j % assign_len])]
            pairs.add((sid, file_rec["syn_id"]))

    for file_rec in multi_spec:
        lo = min(500, n_sub)
        hi = min(8000, n_sub)
        k = int(rng.integers(lo, hi + 1))
        chosen = rng.choice(subject_ids, size=k, replace=False)
        for sid in chosen:
            pairs.add((sid, file_rec["syn_id"]))

    covered_subs = {p[0] for p in pairs}
    missing_subs = [s for s in subject_ids if s not in covered_subs]
    if missing_subs and files:
        for sid in missing_subs:
            file_rec = files[int(rng.integers(0, len(files)))]
            pairs.add((sid, file_rec["syn_id"]))

    covered_files = {p[1] for p in pairs}
    missing_files = [f["syn_id"] for f in files if f["syn_id"] not in covered_files]
    if missing_files and subject_ids:
        for syn in missing_files:
            sid = subject_ids[int(rng.integers(0, len(subject_ids)))]
            pairs.add((sid, syn))

    return list(pairs)


def _spec_column_type(var: dict) -> str:
    """
    Map a VariableSpec widget to the DuckDB column type the generated values
    are emitted as, so the Parquet/CSV carry correct logical types:
      boolean                  -> BOOLEAN
      bins / minCount / range  -> INTEGER
      internal / multiselect   -> VARCHAR
    """
    widget = var.get("widget", "multiselect")
    if widget == "boolean":
        return "BOOLEAN"
    if widget in ("bins", "minCount", "range"):
        return "INTEGER"
    return "VARCHAR"


def _spec_generate_column(rng, var: dict, n: int) -> list:
    """
    Generate n synthetic values for a single VariableSpec variable.
    """
    widget = var.get("widget", "multiselect")
    col_name = var.get("column", var.get("name", "unknown"))

    if widget == "internal":
        return [f"{col_name}_{i:06d}" for i in range(1, n + 1)]

    elif widget == "boolean":
        p_true = 0.30
        high_p_cols = {
            "has_hypertension": 0.70, "has_diabetes": 0.28,
            "has_c_v_d": 0.35, "mortality_status": 0.20,
            "family_study_participant": 0.35, "diagnosis_status": 0.65,
            "has_education": 0.70, "has_biomarker_data": 0.60,
            "has_cognitive_assessment": 0.58, "has_anthropometrics": 0.65,
            "has_functional_assessment": 0.55, "is_multi_specimen": 0.17,
        }
        p_true = high_p_cols.get(col_name, p_true)
        return [bool(rng.random() < p_true) for _ in range(n)]

    elif widget == "multiselect":
        values = var.get("values", [])
        if not values:
            values = [f"{col_name}_{chr(65 + j)}" for j in range(4)]
        probs = np.ones(len(values)) / len(values)
        chosen = rng.choice(values, size=n, p=probs)
        return chosen.tolist()

    elif widget == "bins":
        bins = var.get("bins", [])
        if not bins:
            return [int(rng.integers(0, 100)) for _ in range(n)]
        out = []
        n_bins = len(bins)
        for _ in range(n):
            b = bins[int(rng.integers(0, n_bins))]
            lo = int(b.get("min", 0))
            hi = int(b.get("max", lo))
            hi = min(hi, 200)
            if hi < lo:
                hi = lo
            out.append(int(rng.integers(lo, hi + 1)))
        return out

    elif widget == "minCount":
        return [int(rng.integers(1, 5)) for _ in range(n)]

    elif widget == "range":
        rng_spec = var.get("range", {"min": 0, "max": 100})
        lo = int(rng_spec.get("min", 0))
        hi = int(rng_spec.get("max", 100))
        return [int(rng.integers(lo, hi + 1)) for _ in range(n)]

    else:
        return [f"{col_name}_val_{i % 10}" for i in range(n)]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Synthetic cohort data generator."
    )
    subparsers = parser.add_subparsers(dest="mode")

    elite_p = subparsers.add_parser("elite", help="Generate ELITE dataset (default).")
    elite_p.add_argument("--subjects", type=int, default=N_SUBJECTS)
    elite_p.add_argument("--files", type=int, default=N_FILES)
    elite_p.add_argument(
        "--out",
        type=str,
        default=None,
        help="Output directory (default: public/data/elite/ relative to repo root).",
    )

    spec_p = subparsers.add_parser("from-spec", help="Generate data from a CohortSpec JSON.")
    spec_p.add_argument("spec", type=str, help="Path to spec JSON file.")
    spec_p.add_argument("--subjects", type=int, default=3_000)
    spec_p.add_argument("--files", type=int, default=800)
    spec_p.add_argument("--out", type=str, default=None)

    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent

    if args.mode is None or args.mode == "elite":
        subjects_n = getattr(args, "subjects", N_SUBJECTS)
        files_n = getattr(args, "files", N_FILES)
        out_arg = getattr(args, "out", None)
        out_dir = Path(out_arg) if out_arg else repo_root / "public" / "data" / "elite"
        generate_elite(out_dir, subjects_n, files_n)

    elif args.mode == "from-spec":
        spec_path = Path(args.spec)
        if not spec_path.is_absolute():
            spec_path = Path.cwd() / spec_path
        if not spec_path.exists():
            print(f"ERROR: spec file not found: {spec_path}", file=sys.stderr)
            sys.exit(1)

        if args.out:
            out_dir = Path(args.out)
        else:
            with open(spec_path) as f:
                raw = json.load(f)
            spec_id = raw.get("id", spec_path.stem) if isinstance(raw, dict) else spec_path.stem
            out_dir = repo_root / "public" / "data" / spec_id

        generate_from_spec(str(spec_path), out_dir, args.subjects, args.files)


if __name__ == "__main__":
    main()
