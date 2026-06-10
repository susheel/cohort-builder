# Boolean Cognition and Clinical Mental Models: Evidence and Design Principles for a Guided Cohort Query Builder

**Scope.** This is the *evidence and principles* lens, not a tool survey. It grounds the design of a guided visual cohort query builder for clinical researchers in HCI, cognitive-science, information-retrieval, risk-communication and accessibility literature. Confidence is stated per section. Where the literature is thin or contested, that is flagged explicitly.

**Bottom line up front.** The single highest-leverage decision is to *not expose raw boolean AND/OR/NOT at all* as the primary mental model. Decades of evidence show lay (and even professional) users systematically conflate boolean AND/OR because the operators invert the everyday meanings of the English words "and" and "or". Reframe the task as **inclusion / exclusion criteria** (the clinician's native model), give **live feedback** (running counts), and read the query back in **plain language**. These three moves are individually well-evidenced and mutually reinforcing.

---

## 1. The classic boolean-query usability problem

**Confidence: High.** This is one of the most replicated findings in information-retrieval HCI.

### The core confusion: "and" means union in English, intersection in logic

The fundamental problem is a *semantic mismatch* between natural-language conjunctions and boolean operators. In ordinary speech, "patients with diabetes **and** hypertension" is ambiguous and frequently means the *set* of patients who have diabetes together with the set who have hypertension, i.e. a union. Logically, `diabetes AND hypertension` returns only the *intersection* (patients with both). Conversely "diabetic **or** hypertensive" in casual speech is often read as exclusive or even as listing two separate groups. The everyday word "and" routinely encodes set-union ("I'm researching diabetes and hypertension" = both topics), which is exactly `OR` in boolean terms (Hearst, *Search User Interfaces*, Ch.4, Query Specification; Berkeley IR book, "Query Specification").

The practical consequences are well documented:

- **Users pick the wrong operator.** Non-technical users select "AND" when they colloquially "need data matching multiple criteria", not realising AND *narrows* the result set. Many users believe AND *widens* results (more terms = more hits), which is the reverse of boolean semantics (Berkeley IR book; Vega, "The Dreaded Boolean Search").
- **Nonsensical combinations.** Studies of student searchers found queries like `NOT kids AND kids`, accidental OR, and AND/OR confusion, evidencing that the connectors are simply not understood (Lowe et al., *College & Research Libraries*).
- **Operator precedence and grouping.** Even users who grasp AND/OR struggle with precedence and parentheses (`A AND B OR C`), an extra layer of error on top of operator choice (USPTO patent literature on boolean precedence; Berkeley IR book).
- **Professionals are not immune.** Even trained searchers misuse boolean operators in query languages, so this is not solved by "researchers are educated" (Borgman et al., "Use of Query Language Boolean Operators by Professionals", Springer).

### Hearst's synthesis: full boolean syntax is "not sufficiently usable"

Marti Hearst's authoritative synthesis is blunt: *"Full-syntax Boolean query specification is not sufficiently usable for most searchers and is thus not widely used."* This conclusion motivated the entire line of *visual* and *faceted* alternatives (Hearst, Ch.4).

### Young & Shneiderman filter/flow; the Venn-diagram caution

- **Filter/flow (Young & Shneiderman, 1993, *JASIS*).** A direct-manipulation representation in which records "flow" left-to-right through a pipe and each operator is a filter narrowing the stream; AND is filters in series, OR is parallel pipes that merge. Their evaluation found filter/flow let users form and interpret boolean queries *more accurately* than textual syntax. The key insight: a *spatial metaphor* (narrowing pipe = AND, merging pipes = OR) makes the set semantics visible rather than hidden in a word.
- **Venn diagrams are not a free win.** Jones & McInnes' VQuery used Venn diagrams for boolean specification with dynamic result previews. While untrained users *can interpret and draw* Venn-like diagrams consistently, the controlled study found users took **significantly longer** and made **more errors** with the Venn interface than with plain textual boolean. Lesson: visual ≠ automatically usable; an abstract visual that still demands boolean reasoning can be *worse*. (Jones & McInnes; Hearst Ch.4 graphical approaches.)

### Faceted search: the dominant evidence-based answer

Faceted navigation (Flamenco; Yee, Swearingen, Li, Hearst, *Faceted Metadata for Image Search and Browsing*, CHI 2003) sidesteps the boolean-construction problem:

- Users **progressively refine** by selecting facet values rather than authoring expressions. Selecting multiple values *within* a facet is OR; selecting across *different* facets is AND, and this maps to what users already expect, so the boolean logic is *implicit and correct by construction*.
- Hearst's review of user studies found faceted categories *outperform ranked keyword lists* in exploratory tasks, with users reporting greater confidence and lower disorientation.
- Faceted search avoids dead-end zero-result queries by only offering values that still return results.

**Implication for the cohort builder:** prefer a faceted / criterion-row model where within-criterion choices are union and across-criteria are intersection. Reserve any explicit boolean grouping for an advanced mode. If a visual operator metaphor is used, prefer the *flow/narrowing* metaphor (evidenced positive) over abstract Venn (evidenced mixed/negative).

---

## 2. The clinical mental model: how clinicians and epidemiologists conceptualise cohorts

**Confidence: High** for the OHDSI/epidemiology framing; **Medium** for the precise UI mapping (inference from domain norms).

Clinicians and epidemiologists do **not** think in AND/OR/NOT. They think in a small, stable vocabulary that the UI should adopt verbatim:

- **Inclusion and exclusion criteria.** Eligibility is expressed as a list of "who is *in*" rules and "who is *out*" rules. This is the lingua franca of trial protocols, systematic-review eligibility, and observational study design. The OHDSI ATLAS cohort builder is literally structured as an *entry event* plus *inclusion criteria* plus *exit*, and a published evaluation describes implementing trial inclusion/exclusion criteria in ATLAS (Nature *Scientific Reports*, 2023; *The Book of OHDSI*, Ch.10 "Defining Cohorts").
- **The cohort = phenotype.** OHDSI explicitly defines a cohort as "a set of persons who satisfy one or more inclusion criteria for a duration of time", and notes "cohort" and "phenotype" are used interchangeably (*Book of OHDSI*, Ch.10).
- **Index event / index date.** Almost every cohort is anchored to a *qualifying event* (first diagnosis, first prescription, procedure) defining time-zero. Subsequent criteria are expressed *relative to* the index date ("HbA1c > 7% within 90 days before index"). This temporal anchoring is intrinsic to the model and has no clean boolean expression; it is a *first-class concept*, not an afterthought.
- **Target vs outcome cohorts.** Studies pair a target cohort (e.g. ACE-inhibitor initiators) with an outcome cohort (e.g. angioedema). The builder may need to produce *named, reusable* cohorts, not one-off queries.
- **Denominator and numerator.** Researchers reason in rates: a denominator population (at-risk, eligible) and a numerator (events/cases within it). The "cohort count" is usually a *denominator feasibility* number ("how many eligible patients exist?").
- **Washout / look-back / observation windows.** Validity requires a minimum prior-observation period (new-user designs). This is a constraint, not a boolean clause.

**UI framing that matches this thinking:**

| Clinician concept | UI element |
|---|---|
| Index event | A required first step: "Start with patients who first had [event]" |
| Inclusion criteria | "Keep patients who also..." (additive rows; each row narrows) |
| Exclusion criteria | A visually distinct "Remove patients who..." zone |
| Within-criterion alternatives | "any of: [code A], [code B]" (implicit OR) |
| Temporal windows | Per-criterion relative-time controls ("within X days of index") |
| Denominator | A persistent running "eligible patients: N" count |

This mapping converts boolean construction into a *structured form-filling* task (recognition, not recall) and lets the boolean semantics be generated correctly under the hood.

---

## 3. Design principles to reduce cognitive load and error

**Confidence: High** (these are among the best-established HCI heuristics, here applied to the cohort case).

### Recognition over recall (Nielsen heuristic #6)

Users should never have to remember codes, operator semantics, or prior-screen state. Recognition imposes far lower cognitive load than recall (NN/g; Heurilens "Recognition vs Recall"). **Apply:** searchable code pickers with human-readable labels ("Type 2 diabetes mellitus (E11)"), visible current criteria at all times, no requirement to recall ICD codes or boolean syntax.

### Progressive disclosure

Reveal complexity gradually; hide advanced controls behind a clear secondary affordance to keep the default view minimal and reduce error in complex systems (Nielsen 1995; NN/g "Heuristics for Complex Applications"). **Apply:** default to simple additive inclusion/exclusion; tuck nested boolean grouping, temporal logic and code-set editing into expandable "advanced" panels.

### Immediate feedback / live counts (dynamic queries, tight coupling)

Ahlberg & Shneiderman's *dynamic queries* and *tight coupling* (CHI 1994; FilmFinder) showed that rapid, incremental, **reversible** changes with sub-second visual feedback let users explore and learn the data, with output continuously feeding back into the next input. This is *visibility of system status* (Nielsen #1) made continuous. **Apply:** every criterion change updates a live "eligible patients: N" count; users learn operator effects empirically (adding inclusion drops the count, exclusion drops it, widening a code set raises it) without ever reading a definition of AND.

### Plain-language read-back

Hearst and others recommend showing users *how the system interpreted* their query in intuitively obvious language. **Apply:** render the criteria as a sentence: *"Adults aged 18+ who started metformin, who also had a diabetes diagnosis in the year before, excluding anyone with prior insulin use."* This catches operator-intent errors before execution and is itself a usability safeguard.

### Sensible defaults and constrained choices

Constrained inputs (dropdowns, validated code pickers, date-window presets) prevent malformed queries entirely (error *prevention*, Nielsen #5, which NN/g rates above good error messages). Defaults (e.g. a sensible washout window, "first occurrence") reduce decisions and encode methodological good practice. **Apply:** no free-text boolean box in the default path.

### Preview before commit and undo

Match between system and the real world plus user control and freedom (Nielsen #2, #3): show a preview cohort summary before any "save/extract" commit, and make every step reversible. Reversibility is what makes dynamic exploration safe and is core to the dynamic-query findings. **Apply:** non-destructive editing, step history, undo/redo, and an explicit confirm step before data extraction.

### Cognitive load theory

Working memory is limited; extraneous load (parsing boolean syntax, juggling precedence) crowds out germane load (clinical reasoning about the cohort). Reducing extraneous load by chunking, constraining and externalising state (visible criteria list) directly improves performance (cognitive load theory; NN/g cognitive-load guidance).

---

## 4. Health/numeracy literacy and accessibility

**Confidence: High** for risk-communication formats; **High** for WCAG mechanics.

### Numeracy is low even among educated users

Risk-communication research (Gigerenzer; Galesic, Garcia-Retamero & Gigerenzer, *Health Psychology*, "Using icon arrays to communicate medical risks: overcoming low numeracy"; CDC Health Literacy) shows:

- **Natural frequencies beat probabilities.** "8 in 1,000 patients" is comprehended far better than "0.8%" or conditional probabilities, including by older adults and low-numeracy users (Galesic, Gigerenzer & Straubinger).
- **Icon arrays / pictographs** help low-numeracy users compare magnitudes; separated icon arrays especially aid the low-numeracy group (MDPI *Informatics* 2025; Galesic et al.).
- **Graph literacy** is itself variable; do not assume chart-reading skill (Garcia-Retamero & Galesic, "Graph Literacy for Health").

**Apply to counts:** express cohort sizes as whole counts and natural frequencies ("420 of 50,000 eligible patients"), not bare percentages; offer an icon-array/proportion visual for prevalence; keep one consistent denominator.

### Plain language

Use plain-language clinical phrasing, expand abbreviations, avoid jargon and boolean terminology in the primary UI (Coverys plain-language guidance; CDC). The plain-language read-back (Section 3) is also a health-literacy device.

### WCAG and dynamic content for screen readers

Live counts that update without a focus change are *invisible* to screen-reader users unless announced. WAI-ARIA **live regions** solve this (MDN ARIA Live Regions; W3C WAI):

- Wrap the running count in an `aria-live="polite"` region (assertive interrupts and should be reserved for genuinely urgent messages) so updates are announced without stealing focus.
- This maps to **WCAG 2.x SC 4.1.3 Status Messages**, plus 1.3.1 Info and Relationships and 3.3.1 Error Identification.
- Use `aria-atomic="true"` on the count so the full phrase ("Eligible patients: 420") is read, not just the changed digits.
- Avoid flooding: debounce rapid count changes so the screen reader is not overwhelmed by every keystroke (polite, debounced announcements).

Also: full keyboard operability for the criterion builder, visible focus, sufficient colour contrast, and not relying on colour alone to distinguish the inclusion vs exclusion zones.

---

## 5. Honest uncertainty under statistical disclosure control

**Confidence: Medium-High.** The disclosure-control mechanics are well established; the *best way to present* them to non-statisticians is an active, less-settled research area.

Feasibility counts in clinical data systems are routinely **suppressed** (cells below a threshold, e.g. <10, hidden) or **rounded** (controlled rounding to a base, e.g. nearest 5/10) to prevent re-identification (Statistical Disclosure Control in Tabular Data; NISS risk-utility paradigms; StatCan disclosure control; "Privacy protection and aggregate health data", Springer 2016). Naively showing "0" or a blank for a suppressed cell *misleads* non-statisticians into thinking the cohort is empty, and showing rounded numbers as if exact creates false precision.

**Evidence from risk/uncertainty communication:**

- **Communicating uncertainty does not destroy trust.** Presenting uncertainty as a numeric *range* has minimal negative impact on perceived trustworthiness (van der Bles et al., PNAS / *Royal Society Open Science*; PMC review "effects of communicating uncertainty on public trust"). So honesty about suppression/rounding is safe to disclose.
- **Match precision to the audience.** Low-precision representations suffice and can be better for low-numeracy lay users; high-precision uncertainty is for experts (review of uncertainty-visualisation research, arXiv 2411.10482; "Uncertainty as a Form of Transparency", arXiv 2011.07586).

**Apply:**
- For suppressed cells, never show 0 or blank. Show an explicit, plain-language token: **"Fewer than 10 patients (exact number hidden to protect privacy)"** with a tooltip explaining why.
- For rounded counts, signal approximation explicitly: **"about 420 (rounded to nearest 10)"** or use a `~`/"approx." label, so users do not over-interpret precision. Be consistent so users learn the convention.
- Make the *rule* discoverable once (a short "Why are some numbers hidden or rounded?" explainer) rather than re-explaining every cell.
- Distinguish "**0 patients match**" (a genuine empty result) from "**count suppressed**" (data exists but is hidden) with different, unambiguous wording and iconography. Conflating these is the central misleading failure mode.
- Avoid additivity traps: if subtotals are shown, ensure suppressed/rounded values cannot be back-calculated and do not present sums that imply a hidden exact value (secondary/complementary suppression).

---

## 6. Evidence-backed DO / DON'T guidelines and measurable goals

### DO

- **DO frame the task as inclusion/exclusion criteria + index event**, the clinician's native model, generating boolean semantics under the hood (OHDSI; ATLAS evaluation). *[Highest-leverage decision.]*
- **DO use faceted/additive criterion rows**: within a row = OR (any of these codes), across rows = AND. Boolean is implicit and correct-by-construction (Hearst; Flamenco/Yee et al.).
- **DO show a live, sub-second "eligible patients: N" count** that updates on every change (Ahlberg & Shneiderman dynamic queries; Nielsen visibility of status).
- **DO read the query back in plain language** as a sentence before commit (Hearst; error prevention).
- **DO use natural frequencies and whole counts** ("420 of 50,000"), optionally an icon array, not bare percentages (Gigerenzer; Galesic et al.).
- **DO constrain inputs** with validated code pickers, date-window presets and sensible defaults (new-user/washout) to prevent malformed cohorts (Nielsen error prevention).
- **DO make everything reversible** with undo, step history and preview-before-extract (dynamic queries; Nielsen user control).
- **DO announce count updates via `aria-live="polite"` + `aria-atomic`, debounced**, and meet WCAG 4.1.3 (MDN; W3C WAI).
- **DO distinguish "0 match" from "count suppressed" and label rounded numbers as approximate** (disclosure-control + uncertainty-communication literature).
- **DO put nested boolean, temporal logic and code-set editing behind progressive disclosure** (Nielsen/NN/g).

### DON'T

- **DON'T expose a raw boolean expression box / AND-OR-NOT operators as the primary interface.** Users (lay and professional) systematically invert AND/OR; full boolean syntax is "not sufficiently usable" (Hearst; Borgman et al.; Lowe et al.).
- **DON'T use the words "AND"/"OR" as primary operator labels.** Use "all of / any of / except" or "keep / remove" instead.
- **DON'T rely on abstract Venn diagrams as the main metaphor**: evidenced slower and more error-prone than even textual boolean (Jones & McInnes VQuery). Prefer the flow/narrowing metaphor if any is used.
- **DON'T show suppressed cells as 0 or blank**, and don't present rounded counts as exact (misleads non-statisticians).
- **DON'T require recall of ICD/SNOMED codes or operator semantics** (violates recognition-over-recall; raises extraneous cognitive load).
- **DON'T let live counts spam the screen reader** with un-debounced assertive announcements.

### Measurable usability goals

1. **Operator-intent accuracy ≥ 90%.** In task-based testing, ≥90% of users produce a cohort whose plain-language read-back matches their stated intent on first attempt (directly targets the AND/OR-conflation failure). Baseline: compare against a raw-boolean control condition.
2. **Time-to-first-valid-cohort ≤ 3 minutes** for a standard 3-criterion cohort (index event + 1 inclusion + 1 exclusion) by a clinician with no training (tests recognition/progressive-disclosure success).
3. **Zero malformed/zero-result dead-ends**: <5% of sessions reach an unintended empty or syntactically invalid state (tests constrained-choice/error-prevention and faceted dead-end avoidance).
4. **Suppression comprehension ≥ 80%**: when shown a suppressed result, ≥80% of non-statistician users correctly state "data exists but the exact number is hidden for privacy" rather than "there are no patients" (tests the honest-uncertainty presentation).
5. **(Accessibility gate, pass/fail)** Screen-reader users hear the updated eligible-patient count after each criterion change; WCAG 2.2 AA conformance including SC 4.1.3.

---

## Sources

- Hearst, *Search User Interfaces*, Ch.4 Query Specification — https://searchuserinterfaces.com/book/sui_ch4_query_specification.html
- Hearst, *Search User Interfaces*, Ch.10 Information Visualization — https://searchuserinterfaces.com/book/sui_ch10_visualization.html
- Hearst, *Search User Interfaces*, Ch.1 Design — https://www.searchuserinterfaces.com/book/sui_ch1_design.html
- Berkeley IR book, "Query Specification" — https://people.ischool.berkeley.edu/~hearst/irbook/10/node6.html
- Graphical approaches to query specification (IR book) — https://www2.dcc.ufmg.br/livros/irbook/10/node24.html
- Young & Shneiderman, "A Graphical Filter/Flow Representation of Boolean Queries" (*JASIS* 1993) — https://asistdl.onlinelibrary.wiley.com/doi/abs/10.1002/(SICI)1097-4571(199307)44:6%3C327::AID-ASI3%3E3.0.CO;2-J ; PDF: https://www.academia.edu/2900264/A_graphical_filter_flow_representation_of_Boolean_queries_a_prototype_implementation_and_evaluation
- Jones & McInnes, "VQuery: a graphical user interface for Boolean query specification and dynamic result preview" — https://www.semanticscholar.org/paper/VQuery:-a-graphical-user-interface-for-Boolean-and-Jones/b1dad26cadd2811f8c5dcaed933a89c860ef99e3 ; https://link.springer.com/article/10.1007/s007990050048
- Borgman et al., "Use of Query Language Boolean Operators by Professionals" (Springer) — https://link.springer.com/chapter/10.1007/978-1-4684-5472-7_18
- Lowe et al., "The Boolean is Dead, Long Live the Boolean!" (*College & Research Libraries*) — https://crl.acrl.org/index.php/crl/article/view/16729/18669
- Vega, "The Dreaded Boolean Search" — https://medium.com/next-century-user-experience/the-dreaded-boolean-search-413fa757a81c
- Shneiderman, "Clarifying Search: A User-Interface Framework for Text Searches" (D-Lib) — https://www.dlib.org/dlib/january97/retrieval/01shneiderman.html
- Yee, Swearingen, Li & Hearst, "Faceted Metadata for Image Search and Browsing" (CHI 2003) — https://www.semanticscholar.org/paper/Faceted-metadata-for-image-search-and-browsing-Yee-Swearingen/f6e4d44dfb73374d7a3b13549b927f75a6f9cc7e
- Ahlberg & Shneiderman, "Visual Information Seeking: Tight Coupling of Dynamic Query Filters with Starfield Displays" (CHI 1994) — https://www.cs.umd.edu/hcil/trs/93-14/93-14.html
- *The Book of OHDSI*, Ch.10 Defining Cohorts — https://ohdsi.github.io/TheBookOfOhdsi/Cohorts.html
- "Implementation of inclusion and exclusion criteria in clinical studies in OHDSI ATLAS software" (*Scientific Reports* 2023) — https://www.nature.com/articles/s41598-023-49560-w ; https://pmc.ncbi.nlm.nih.gov/articles/PMC10725886/
- Nielsen, 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/ ; complex apps: https://www.nngroup.com/articles/usability-heuristics-complex-applications/
- Recognition vs Recall (NN/g heuristic #6 explainer) — https://heurilens.com/blog/psychology/recognition-vs-recall-ux-principle
- Progressive disclosure (Nielsen/NN/g) — https://www.nngroup.com/articles/progressive-disclosure/
- Galesic, Garcia-Retamero & Gigerenzer, "Using icon arrays to communicate medical risks: overcoming low numeracy" (*Health Psychology*) — https://pacificu.libguides.com/HLeT/Numeracy
- Garcia-Retamero & Galesic, "Graph Literacy for Health" — https://link.springer.com/chapter/10.1007/978-1-4614-4358-2_4
- "Guidelines for Transparent Communication in a Globalized World" (natural frequencies) — https://link.springer.com/chapter/10.1007/978-1-4614-4358-2_14
- CDC Health Literacy — Numeracy — https://www.cdc.gov/health-literacy/php/research-summaries/numeracy.html
- Icon arrays layout & comprehension (MDPI *Informatics* 2025) — https://www.mdpi.com/2227-9709/12/4/105
- Coverys, "Improving Healthcare Literacy Through Plain Language" — https://www.coverys.com/expert-insights/improving-healthcare-literacy-through-plain-language
- MDN, ARIA Live Regions — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
- "Statistical Disclosure Control in Tabular Data" — https://www.researchgate.net/publication/226248627_Statistical_Disclosure_Control_in_Tabular_Data
- NISS, "Risk-Utility Paradigms for Statistical Disclosure Limitation" — https://www.niss.org/sites/default/files/tr179_final.pdf
- StatCan, "Disclosure control" — https://www150.statcan.gc.ca/n1/pub/12-539-x/2009001/control-controle-eng.htm
- "Privacy protection and aggregate health data: a review of tabular cell suppression methods" (Springer 2016) — https://link.springer.com/article/10.1007/s10742-016-0162-8
- "The Noisy Work of Uncertainty Visualisation Research: A Review" (arXiv 2411.10482) — https://arxiv.org/pdf/2411.10482
- "Uncertainty as a Form of Transparency" (arXiv 2011.07586) — https://arxiv.org/pdf/2011.07586
- "The effects of communicating uncertainty around statistics, on public trust" (PMC) — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10663791/
