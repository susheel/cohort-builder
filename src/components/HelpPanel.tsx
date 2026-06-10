import type { ReactNode } from 'react';

/**
 * Reference panel: how to structure the data tables and the cohort spec, plus
 * the important configuration values. Content mirrors docs/spec-format.md and
 * docs/research/00-decisions-and-architecture.md so it stays usable offline.
 */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title="Help: data + spec reference" onClose={onClose}>
      <Intro />
      <DataModel />
      <CohortSpecSection />
      <WidgetsSection />
      <SdcSection />
      <ConfigSection />
      <BringYourOwn />
      <Limitations />
    </Drawer>
  );
}

/* --------------------------------- sections ------------------------------ */

function Intro() {
  return (
    <Section title="Overview">
      <P>
        The Cohort Builder is driven entirely by a declarative <Code>cohort spec</Code> plus a
        set of data files queried in your browser with DuckDB-WASM. You provide three tables
        (subjects, files, and a junction) and, optionally, a spec that refines how each variable
        is filtered and disclosure-controlled. With no spec, everything is inferred from the data.
      </P>
    </Section>
  );
}

function DataModel() {
  return (
    <Section title="1. Data model (three tables)">
      <P>
        The model is a many-to-many relationship between subjects (the cohort unit) and files
        (the underlying data, identified by a Synapse-style id), joined through a junction table.
      </P>

      <TableCard
        name="subjects"
        role="entity (the cohort unit)"
        pk="subject_id"
        note="One row per subject. Holds all subject-level attributes: demographics, comorbidity flags, genetics, assessment-availability flags, study design fields."
        rows={[
          ['subject_id', 'VARCHAR', 'Primary key, e.g. SUB_000001'],
          ['age', 'INTEGER', 'Numeric; drives the age bins'],
          ['sex / race / diagnosis ...', 'VARCHAR', 'Controlled-vocabulary columns'],
          ['has_hypertension ...', 'BOOLEAN', 'true/false flags (one per condition)'],
          ['apoe_genotype', 'VARCHAR', 'e.g. e3/e4'],
        ]}
      />

      <TableCard
        name="files"
        role="attribute (the data files)"
        pk="syn_id"
        note="One row per file. syn_id must match the pattern syn followed by 6 to 9 digits."
        rows={[
          ['syn_id', 'VARCHAR', 'Primary key, matches ^syn[0-9]{6,9}$'],
          ['data_type', 'VARCHAR', 'e.g. gene expression, variant calls'],
          ['assay_type', 'VARCHAR', 'e.g. WGS, RNAseq, proteomics'],
          ['file_format', 'VARCHAR', 'e.g. FASTQ, BAM, VCF'],
          ['is_multi_specimen', 'BOOLEAN', 'Cohort-level file linking many subjects'],
          ['file_size_bytes', 'BIGINT', 'Optional'],
        ]}
      />

      <TableCard
        name="subject_files"
        role="junction (many-to-many)"
        pk="(subject_id, syn_id)"
        note="One row per subject-file link. A file may link to many subjects (cohort-level files) and a subject may link to many files."
        rows={[
          ['subject_id', 'VARCHAR', 'References subjects.subject_id'],
          ['syn_id', 'VARCHAR', 'References files.syn_id'],
        ]}
      />

      <Callout>
        Guarantee referential integrity: every subject should have at least one file and every
        file at least one subject. For file-availability filters to be meaningful, keep coverage
        <strong> sparse</strong>: a subject should have data for only some assay types, not all.
      </Callout>
    </Section>
  );
}

function CohortSpecSection() {
  return (
    <Section title="2. The cohort spec (optional override)">
      <P>
        The effective spec is the inferred base merged with your override. An override is a partial
        spec (YAML, TOML, or JSON) matched to the data by column. Top-level fields:
      </P>
      <DefList
        items={[
          ['schemaVersion', '"1.0"'],
          ['id, title, description', 'Identity shown in the picker'],
          ['primaryEntity', 'The cohort-unit table name, e.g. "subjects"'],
          ['tables', 'Map of table name to {primaryKey, columns, role, source}'],
          ['relationships', 'Many-to-many links via a junction (see below)'],
          ['variables', 'The filterable variables, each bound to a column + widget'],
          ['sdc', 'The disclosure-control policy (per sensitivity level + global)'],
          ['defaultCharts', 'Variable names shown as default characterisation charts'],
        ]}
      />
      <P className="mt-3">A minimal override that declares the relationship and refines two variables:</P>
      <Pre>{`schemaVersion: "1.0"
id: my-cohort
title: My Cohort
primaryEntity: subjects
relationships:
  - from: subjects
    to: files
    via: subject_files
    fromKey: subject_id
    toKey: syn_id
defaultCharts: [studyCode]
variables:
  - name: apoeGenotype
    column: apoe_genotype
    sensitivity: High        # promote from inferred
    widget: multiselect
    values: [e2/e2, e2/e3, e2/e4, e3/e3, e3/e4, e4/e4]
  - name: internalHash
    visible: false           # hide an inferred column
sdc:
  levels:
    High:
      booleanOnly: true
      thresholdK: 20`}</Pre>
      <Callout>
        Merge rules: scalars replace; <Code>variables</Code> match by column (override fields win,
        new names are appended, <Code>visible: false</Code> hides one); <Code>relationships</Code>
        replace the inferred set when provided; <Code>sdc</Code> is deep-merged per level.
      </Callout>
    </Section>
  );
}

function WidgetsSection() {
  return (
    <Section title="3. Variable widgets">
      <Grid
        head={['widget', 'for', 'operators']}
        rows={[
          ['boolean', 'hasX flags, status booleans', 'is (Yes / No)'],
          ['multiselect', 'controlled vocab (race, diagnosis, APOE)', 'is any of / is all of / is none of'],
          ['bins', 'bucketed numerics (age)', 'is in / is not in'],
          ['minCount', '"n+ of" (visit count)', 'at least'],
          ['range', 'free numeric', 'between'],
          ['internal', 'present in data, not a filter', '(hidden)'],
        ]}
      />
      <Callout>
        <strong>is all of</strong> only applies to file-level variables: it means the subject is
        linked, through the junction, to files covering <em>every</em> selected value (e.g. has both
        WGS and RNAseq). Across conditions, logic is set by structure: AND/OR per group, with a
        per-group Exclude (NOT) toggle.
      </Callout>
    </Section>
  );
}

function SdcSection() {
  return (
    <Section title="4. Sensitivity to disclosure-control (defaults)">
      <P>
        Each variable carries a sensitivity (None / Low / Medium / High). The count and every chart
        cell are treated according to the most sensitive variable in the query.
      </P>
      <Grid
        head={['level', 'threshold k', 'rounding', 'complementary', 'boolean-only']}
        rows={[
          ['None', '1', 'none', 'no', 'no'],
          ['Low', '5', 'nearest 5', 'no', 'no'],
          ['Medium', '10', 'up to 10', 'yes', 'no'],
          ['High', '20', 'up to 20', 'yes', 'yes'],
        ]}
      />
      <DefList
        items={[
          ['thresholdK', 'Counts below this (but above zero) are suppressed'],
          ['roundingBase / roundingMode', 'Granularity and method (none / nearest / up / random)'],
          ['complementarySuppression', 'Secondary suppression on cross-tabs to block differencing'],
          ['booleanOnly', 'Return only "data available / insufficient", never a number'],
          ['zeroIsDisclosive', 'Treat a true zero as disclosive and suppress it too'],
        ]}
      />
      <Callout>
        Suppressed is never shown as a number and is visually distinct from a true zero. High-
        sensitivity queries return availability only by default. All values are editable at runtime
        in the Settings panel.
      </Callout>
    </Section>
  );
}

function ConfigSection() {
  return (
    <Section title="5. Important configuration values">
      <DefList
        items={[
          ['sdc.enabled', 'Master switch for the whole disclosure-control layer'],
          ['sdc.global.minQuerySetSize', 'Reject queries whose unfiltered population is below this'],
          ['sdc.global.queryRepetitionLimit', 'Warn after this many near-identical queries in a session'],
          ['defaultCharts', 'Which variables open as characterisation charts (e.g. ["studyCode"])'],
          ['relationships[].via / fromKey / toKey', 'The junction table and its two key columns'],
          ['tables[t].source.url / format', 'Where a bundled table is fetched from (parquet or csv)'],
          ['variable.visible', 'Set false to keep a column out of the filter UI'],
        ]}
      />
      <P className="mt-2 text-xs text-slate-500">
        The shipped example specs live under <Code>public/specs/</Code> and their data under
        <Code> public/data/&lt;id&gt;/</Code>, indexed by <Code>public/catalogue.json</Code>.
      </P>
    </Section>
  );
}

function BringYourOwn() {
  return (
    <Section title="6. Bring your own data">
      <ol className="ml-4 list-decimal space-y-1 text-sm text-slate-700">
        <li>Click <strong>Load your own data</strong> in the top bar.</li>
        <li>Provide a <Code>subjects</Code> file (Parquet or CSV). This is required.</li>
        <li>Optionally add a <Code>files</Code> table and a <Code>subject_files</Code> junction to enable file-level filters and the files table.</li>
        <li>Optionally add an override spec (.yaml / .toml / .json) to correct sensitivities, widgets, vocabularies, and the SDC policy.</li>
      </ol>
      <P className="mt-2">
        With no override the app infers column types, widgets, categories, and a heuristic
        sensitivity, then applies the default SDC policy.
      </P>
      <Callout>
        Your data stays in your browser. Uploaded files are read locally and queried in-memory with
        DuckDB-WASM; nothing is uploaded to a server, and nothing is persisted once you close the
        tab. On a static host (such as GitHub Pages) there is no backend that could receive it.
      </Callout>
    </Section>
  );
}

function Limitations() {
  return (
    <Section title="Honest limitations">
      <P className="text-xs text-slate-500">
        All controls run in the browser and are bypassable: this PoC demonstrates the policy and the
        UX, not a hardened privacy boundary. A production deployment must enforce disclosure control
        and query restrictions server-side. The bundled data is synthetic and represents no real
        person.
      </P>
    </Section>
  );
}

/* ----------------------------- presentational ---------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 border-b border-slate-100 pb-1 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-sm leading-relaxed text-slate-600 ${className}`}>{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">{children}</code>;
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">
      {children}
    </pre>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-cyan-50 p-2.5 text-xs leading-relaxed text-cyan-900">{children}</p>
  );
}

function TableCard({
  name,
  role,
  pk,
  note,
  rows,
}: {
  name: string;
  role: string;
  pk: string;
  note: string;
  rows: [string, string, string][];
}) {
  return (
    <div className="mt-3 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <code className="font-mono text-sm font-semibold text-slate-800">{name}</code>
        <span className="text-xs text-slate-500">{role}</span>
        <span className="ml-auto text-xs text-slate-500">
          PK: <code className="font-mono text-slate-700">{pk}</code>
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
      <table className="mt-2 w-full text-left text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="py-1 pr-2 font-medium">column</th>
            <th className="py-1 pr-2 font-medium">type</th>
            <th className="py-1 font-medium">notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([c, t, n]) => (
            <tr key={c} className="border-t border-slate-100">
              <td className="py-1 pr-2 font-mono text-slate-700">{c}</td>
              <td className="py-1 pr-2 font-mono text-slate-500">{t}</td>
              <td className="py-1 text-slate-500">{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Grid({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead>
        <tr className="text-slate-400">
          {head.map((h) => (
            <th key={h} className="py-1 pr-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]} className="border-t border-slate-100">
            {r.map((c, i) => (
              <td key={i} className={`py-1 pr-2 ${i === 0 ? 'font-mono text-slate-700' : 'text-slate-500'}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DefList({ items }: { items: [string, string][] }) {
  return (
    <dl className="mt-2 space-y-1.5">
      {items.map(([term, def]) => (
        <div key={term} className="grid grid-cols-[minmax(0,200px)_1fr] gap-2">
          <dt>
            <code className="font-mono text-xs text-slate-700">{term}</code>
          </dt>
          <dd className="text-xs text-slate-500">{def}</dd>
        </div>
      ))}
    </dl>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
