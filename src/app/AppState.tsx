import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RuleGroupType } from 'react-querybuilder';
import { query as runQuery, resetConnection, scalar } from '../duckdb/db';
import type { TableSource } from '../duckdb/loader';
import { parseOverride } from '../spec/parse';
import { resolveSpec } from '../spec/resolve';
import {
  DEFAULT_SDC,
  sensitivityRank,
  type CohortSpec,
  type SdcConfig,
  type Sensitivity,
  type VariableSpec,
} from '../spec/types';
import {
  applyCount,
  canonicalizeQuery,
  checkQuerySetSize,
  RepeatedQueryTracker,
  type CountResult,
} from '../sdc/engine';
import {
  breakdownSql,
  dataFilesCountSql,
  dataFilesSql,
  EMPTY_QUERY,
  facetSql,
  fieldsInTree,
  treeCountSql,
} from '../query/compileTree';
import { dataFileColumns } from '../query/builder';
import {
  effectiveQuasiIdentifiers,
  privacyMetricsSql,
  resolveSensitiveAttribute,
  type PrivacyMetrics,
} from '../query/privacy';
import { buildFields, fieldByName, type CohortField } from '../query/fields';
import {
  funnelSteps,
  guidedToTree,
  makeCriterion,
  treeToGuided,
  type Criterion,
  type GuidedModel,
} from '../query/guided';
import { makeLlmClient } from '../llm';
import type { DraftedCohort, LlmConfig, LlmProgress, LlmTrace } from '../llm/types';
import { TEMPLATES, type CohortTemplate } from '../data/templates';
import { asset } from '../util/asset';

export interface DatasetRef {
  id: string;
  title: string;
  description?: string;
  overrideUrl?: string;
  tables: { name: string; url: string }[];
  primaryEntity?: string;
  variableCount?: number;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BreakdownCell {
  bucket: string;
  result: CountResult;
}

export interface FacetCell {
  value: string;
  result: CountResult;
}

export interface FileRow {
  cells: Record<string, unknown>;
  subjectCount: CountResult;
}

export interface DataFilesPage {
  columns: string[];
  rows: FileRow[];
  total: number;
}

export type BuilderMode = 'guided' | 'advanced';

export interface FunnelRow {
  kind: 'start' | 'include' | 'exclude';
  criterion?: Criterion;
  result: CountResult;
}

const LLM_CONFIG_KEY = 'cohort-builder.llmConfig';

/** Privacy target for k-anonymity risk banding (the widely-cited minimum). */
const K_ANON_TARGET = 5;

function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as LlmConfig;
  } catch {
    /* ignore */
  }
  return { provider: 'webllm' };
}

let ruleId = 0;

interface AppStateValue {
  catalogue: DatasetRef[];
  status: LoadStatus;
  error: string | null;
  activeDatasetId: string | null;
  spec: CohortSpec | null;
  rowCounts: Record<string, number>;
  population: number;

  sdc: SdcConfig;
  setSdc: (next: SdcConfig) => void;
  resetSdc: () => void;
  revealRaw: boolean;
  setRevealRaw: (v: boolean) => void;

  /** react-querybuilder field list derived from the spec */
  fields: CohortField[];
  /** the canonical query tree */
  query: RuleGroupType;
  setQuery: (q: RuleGroupType) => void;
  clearQuery: () => void;
  /** append a rule for a field (used by the variable palette); presetValues
   * pre-selects values for array-valued widgets (multiselect / bins). */
  addRule: (field: string, presetValues?: string[]) => void;
  /** number of active leaf predicates */
  ruleCount: number;

  /** editing surface: guided inclusion/exclusion vs advanced rule tree */
  mode: BuilderMode;
  setMode: (m: BuilderMode) => void;
  /** the query viewed as include/exclude criteria */
  guided: GuidedModel;
  setGuided: (include: Criterion[], exclude: Criterion[]) => void;
  /** per-step attrition counts (SDC-applied) for the funnel */
  getFunnelCounts: () => Promise<FunnelRow[]>;

  /** natural-language -> criteria via the configured LLM provider */
  llmConfig: LlmConfig;
  setLlmConfig: (c: LlmConfig) => void;
  llmAvailable: () => Promise<{ ok: boolean; reason?: string }>;
  draftFromText: (
    text: string,
    onProgress?: (p: LlmProgress) => void,
    onTrace?: (t: LlmTrace) => void,
  ) => Promise<DraftedCohort>;
  applyDraft: (draft: DraftedCohort) => void;

  templates: CohortTemplate[];
  applyTemplate: (t: CohortTemplate) => void;

  /** highest sensitivity touched by the active query */
  activeSensitivity: Sensitivity;
  count: CountResult | null;
  rawCount: number | null;
  counting: boolean;
  populationWarning: string | null;
  repetitionWarning: string | null;
  /** true when the whole cohort is below threshold: gate charts + files table */
  cohortSuppressed: boolean;
  /** k-anonymity / l-diversity for the cohort (null if no quasi-identifiers) */
  getPrivacyMetrics: () => Promise<PrivacyMetrics | { suppressed: true } | null>;

  chartVars: string[];
  addChart: (variable: string) => void;
  removeChart: (variable: string) => void;

  loadDataset: (id: string) => Promise<void>;
  loadCustom: (sources: TableSource[], overrideText?: { name: string; text: string }) => Promise<void>;
  getBreakdown: (variableName: string) => Promise<BreakdownCell[]>;
  getFacetCounts: (variableName: string) => Promise<FacetCell[]>;
  getDataFiles: (opts: { limit: number; offset: number }) => Promise<DataFilesPage>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function useApp(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used within AppStateProvider');
  return v;
}

function countLeaves(g: RuleGroupType): number {
  let n = 0;
  for (const r of g.rules) {
    if ('rules' in r) n += countLeaves(r);
    else n += 1;
  }
  return n;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [catalogue, setCatalogue] = useState<DatasetRef[]>([]);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [spec, setSpec] = useState<CohortSpec | null>(null);
  const [fields, setFields] = useState<CohortField[]>([]);
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({});
  const [population, setPopulation] = useState(0);

  const [sdc, setSdc] = useState<SdcConfig>(DEFAULT_SDC);
  const [revealRaw, setRevealRaw] = useState(false);
  const [query, setQuery] = useState<RuleGroupType>(EMPTY_QUERY);
  const [chartVars, setChartVars] = useState<string[]>([]);
  const [mode, setMode] = useState<BuilderMode>('guided');
  const [llmConfig, setLlmConfigState] = useState<LlmConfig>(loadLlmConfig);

  const [count, setCount] = useState<CountResult | null>(null);
  const [rawCount, setRawCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [populationWarning, setPopulationWarning] = useState<string | null>(null);
  const [repetitionWarning, setRepetitionWarning] = useState<string | null>(null);

  const tracker = useRef(new RepeatedQueryTracker(DEFAULT_SDC));

  useEffect(() => {
    fetch(asset('catalogue.json'))
      .then((r) => r.json())
      .then((j: { datasets: DatasetRef[] }) => setCatalogue(j.datasets ?? []))
      .catch(() => setCatalogue([]));
  }, []);

  const applySpec = useCallback((resolved: CohortSpec, counts: Record<string, number>) => {
    setSpec(resolved);
    setFields(buildFields(resolved));
    setRowCounts(counts);
    setPopulation(counts[resolved.primaryEntity] ?? 0);
    setSdc(resolved.sdc);
    setQuery({ combinator: 'and', rules: [] });
    const visibleCat = resolved.variables.filter(
      (v) => v.visible !== false && (v.widget === 'multiselect' || v.widget === 'bins' || v.widget === 'boolean'),
    );
    const defaults = (resolved.defaultCharts ?? []).filter((n) =>
      resolved.variables.some((v) => v.name === n && v.visible !== false),
    );
    setChartVars(defaults.length ? defaults : visibleCat.slice(0, 1).map((v) => v.name));
    tracker.current.reset();
    setRepetitionWarning(null);
  }, []);

  const loadDataset = useCallback(
    async (id: string) => {
      const ds = catalogue.find((d) => d.id === id);
      if (!ds) return;
      setStatus('loading');
      setError(null);
      try {
        await resetConnection();
        let override;
        if (ds.overrideUrl) {
          const resp = await fetch(asset(ds.overrideUrl));
          if (resp.ok) override = parseOverride(ds.overrideUrl, await resp.text());
        }
        const { spec: resolved, rowCounts: counts } = await resolveSpec({
          sources: ds.tables.map((t) => ({ name: t.name, url: asset(t.url) })),
          override,
          primaryEntity: ds.primaryEntity,
        });
        applySpec(resolved, counts);
        setActiveDatasetId(id);
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [catalogue, applySpec],
  );

  const loadCustom = useCallback(
    async (sources: TableSource[], overrideText?: { name: string; text: string }) => {
      setStatus('loading');
      setError(null);
      try {
        await resetConnection();
        const override = overrideText ? parseOverride(overrideText.name, overrideText.text) : undefined;
        const { spec: resolved, rowCounts: counts } = await resolveSpec({ sources, override });
        applySpec(resolved, counts);
        setActiveDatasetId('custom');
        setStatus('ready');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [applySpec],
  );

  const clearQuery = useCallback(() => setQuery({ combinator: 'and', rules: [] }), []);

  const addRule = useCallback(
    (field: string, presetValues?: string[]) => {
      const f = fieldByName(fields, field);
      if (!f) return;
      ruleId += 1;
      // Preset values only apply to array-valued widgets (multiselect / bins);
      // other widgets keep their default value.
      const value =
        presetValues && presetValues.length && Array.isArray(f.defaultValue)
          ? presetValues
          : (f.defaultValue ?? []);
      const rule = {
        id: `r-${ruleId}`,
        field,
        operator: (f.defaultOperator as string) ?? 'in',
        value,
      };
      setQuery((prev) => ({ ...prev, rules: [...prev.rules, rule] }));
    },
    [fields],
  );

  const addChart = useCallback((variable: string) => {
    setChartVars((prev) => (prev.includes(variable) ? prev : [...prev, variable]));
  }, []);
  const removeChart = useCallback((variable: string) => {
    setChartVars((prev) => prev.filter((v) => v !== variable));
  }, []);
  const resetSdc = useCallback(() => setSpec((s) => (s ? (setSdc(s.sdc), s) : s)), []);

  const ruleCount = useMemo(() => countLeaves(query), [query]);

  const guided = useMemo(() => treeToGuided(query), [query]);

  const setGuided = useCallback((include: Criterion[], exclude: Criterion[]) => {
    setQuery(guidedToTree(include, exclude));
  }, []);

  const sensitivityOf = useCallback(
    (q: RuleGroupType): Sensitivity => {
      if (!spec) return 'None';
      let max: Sensitivity = 'None';
      for (const name of fieldsInTree(spec, q)) {
        const v = spec.variables.find((x) => x.name === name);
        if (v && sensitivityRank(v.sensitivity) > sensitivityRank(max)) max = v.sensitivity;
      }
      return max;
    },
    [spec],
  );

  const getFunnelCounts = useCallback(async (): Promise<FunnelRow[]> => {
    if (!spec) return [];
    const steps = funnelSteps(guided);
    const seedBase = canonicalizeQuery({ id: spec.id, funnel: true });
    const out: FunnelRow[] = [];
    for (const step of steps) {
      const raw = await scalar<number>(treeCountSql(spec, step.query));
      const level = step.kind === 'start' ? 'None' : sensitivityOf(step.query);
      const seed = `${seedBase}:${out.length}`;
      out.push({
        kind: step.kind,
        criterion: step.criterion,
        result: applyCount(Number(raw), level, sdc, seed),
      });
    }
    return out;
  }, [spec, guided, sdc, sensitivityOf]);

  const setLlmConfig = useCallback((c: LlmConfig) => {
    setLlmConfigState(c);
    try {
      localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
  }, []);

  const llmAvailable = useCallback(async () => {
    try {
      const client = makeLlmClient(llmConfig);
      const ok = await client.available();
      return { ok, reason: ok ? undefined : client.unavailableReason };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }, [llmConfig]);

  const draftFromText = useCallback(
    async (
      text: string,
      onProgress?: (p: LlmProgress) => void,
      onTrace?: (t: LlmTrace) => void,
    ): Promise<DraftedCohort> => {
      if (!spec) return { include: [], exclude: [] };
      const client = makeLlmClient(llmConfig);
      return client.draftCohort(text, spec, onProgress, onTrace);
    },
    [spec, llmConfig],
  );

  // keep only criteria whose field exists and is visible in the current spec
  const validCriteria = useCallback(
    (items: { field: string; operator: string; value: unknown }[]): Criterion[] => {
      if (!spec) return [];
      const visible = new Set(
        spec.variables.filter((v) => v.visible !== false && v.widget !== 'internal').map((v) => v.name),
      );
      return items
        .filter((c) => visible.has(c.field))
        .map((c) => makeCriterion(c.field, c.operator, c.value));
    },
    [spec],
  );

  const applyDraft = useCallback(
    (draft: DraftedCohort) => {
      setGuided(validCriteria(draft.include), validCriteria(draft.exclude));
      setMode('guided');
    },
    [setGuided, validCriteria],
  );

  const applyTemplate = useCallback(
    (t: CohortTemplate) => {
      setGuided(validCriteria(t.include), validCriteria(t.exclude));
      setMode('guided');
    },
    [setGuided, validCriteria],
  );

  const activeSensitivity = useMemo<Sensitivity>(() => {
    if (!spec) return 'None';
    let max: Sensitivity = 'None';
    for (const name of fieldsInTree(spec, query)) {
      const v = spec.variables.find((x) => x.name === name);
      if (v && sensitivityRank(v.sensitivity) > sensitivityRank(max)) max = v.sensitivity;
    }
    return max;
  }, [spec, query]);

  useEffect(() => {
    if (!spec || status !== 'ready') return;
    let cancelled = false;
    setCounting(true);
    (async () => {
      try {
        const raw = await scalar<number>(treeCountSql(spec, query));
        if (cancelled) return;
        const seed = canonicalizeQuery({ id: spec.id, query, sdc });
        setRawCount(Number(raw));
        setCount(applyCount(Number(raw), activeSensitivity, sdc, seed));

        const guard = checkQuerySetSize(population, sdc);
        setPopulationWarning(guard.ok ? null : (guard.reason ?? null));

        tracker.current.record(seed);
        const reps = tracker.current.getCount(seed);
        setRepetitionWarning(
          reps > sdc.global.queryRepetitionLimit
            ? `This near-identical query has been run ${reps} times this session (limit ${sdc.global.queryRepetitionLimit}). Repeated querying can enable differencing attacks.`
            : null,
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setCounting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, query, sdc, activeSensitivity, population, status]);

  const getBreakdown = useCallback(
    async (variableName: string): Promise<BreakdownCell[]> => {
      if (!spec) return [];
      const v: VariableSpec | undefined = spec.variables.find((x) => x.name === variableName);
      if (!v) return [];
      const sql = breakdownSql(spec, query, v);
      if (!sql) return [];
      const { rows } = await runQuery<{ bucket: string; n: number }>(sql);
      const seed = canonicalizeQuery({ id: spec.id, query, by: variableName });
      return rows.map((r) => ({
        bucket: r.bucket ?? 'Unknown',
        result: applyCount(Number(r.n), v.sensitivity, sdc, `${seed}:${r.bucket}`),
      }));
    },
    [spec, query, sdc],
  );

  const getFacetCounts = useCallback(
    async (variableName: string): Promise<FacetCell[]> => {
      if (!spec) return [];
      const v = spec.variables.find((x) => x.name === variableName);
      if (!v) return [];
      const sql = facetSql(spec, query, v);
      if (!sql) return [];
      const { rows } = await runQuery<{ value: string; n: number }>(sql);
      const seed = canonicalizeQuery({ id: spec.id, query, facet: variableName });
      return rows.map((r) => ({
        value: r.value ?? 'Unknown',
        result: applyCount(Number(r.n), v.sensitivity, sdc, `${seed}:${r.value}`),
      }));
    },
    [spec, query, sdc],
  );

  const getDataFiles = useCallback(
    async (opts: { limit: number; offset: number }): Promise<DataFilesPage> => {
      if (!spec) return { columns: [], rows: [], total: 0 };
      const info = dataFileColumns(spec);
      const sql = dataFilesSql(spec, query, opts);
      const countQ = dataFilesCountSql(spec, query);
      if (!info || !sql) return { columns: [], rows: [], total: 0 };
      const { rows } = await runQuery<Record<string, unknown>>(sql);
      let total = rows.length;
      if (countQ) {
        try {
          total = Number(await scalar<number>(countQ));
        } catch {
          /* keep page length */
        }
      }
      const seed = canonicalizeQuery({ id: spec.id, query, files: true });
      const fileRows: FileRow[] = rows.map((r) => {
        const cells: Record<string, unknown> = {};
        for (const c of info.cols) cells[c] = r[c];
        const raw = Number(r.subject_count ?? 0);
        return {
          cells,
          subjectCount: applyCount(raw, activeSensitivity, sdc, `${seed}:${String(r[info.cols[0]])}`),
        };
      });
      return { columns: info.cols, rows: fileRows, total };
    },
    [spec, query, sdc, activeSensitivity],
  );

  // the whole cohort is below threshold (or strict-availability says insufficient):
  // gate the charts and the data files table on this.
  const cohortSuppressed = useMemo(() => {
    if (!count) return false;
    return count.kind === 'suppressed' || (count.kind === 'boolean' && !count.available);
  }, [count]);

  const getPrivacyMetrics = useCallback(async () => {
    if (!spec) return null;
    if (cohortSuppressed) return { suppressed: true } as const;
    // QIs are recomputed per query: the spec baseline plus the subject-level
    // categorical dimensions this query constrains. The sensitive attribute is
    // never also a quasi-identifier.
    const sensitive = resolveSensitiveAttribute(spec);
    const qis = effectiveQuasiIdentifiers(spec, query).filter((v) => v.name !== sensitive?.name);
    if (qis.length === 0) return null;
    const sqlTemplate = privacyMetricsSql(spec, query, { qis, sensitive });
    if (!sqlTemplate) return null;
    // k-anonymity is judged against its own privacy target (commonly 5), NOT the
    // count-suppression threshold (which can be 1 when no sensitive variable is
    // filtered). A unique record (k=1) is always high risk.
    const threshold = K_ANON_TARGET;
    const sql = sqlTemplate.replaceAll('{K}', String(threshold));
    const { rows } = await runQuery<{
      k_anon: number;
      l_div: number | null;
      classes: number;
      total: number;
      records_at_risk: number;
      classes_at_risk: number;
    }>(sql);
    const r = rows[0];
    if (!r || r.total == null) return null;
    return {
      kAnonymity: Number(r.k_anon ?? 0),
      lDiversity: r.l_div == null ? null : Number(r.l_div),
      classes: Number(r.classes ?? 0),
      total: Number(r.total ?? 0),
      recordsAtRisk: Number(r.records_at_risk ?? 0),
      classesAtRisk: Number(r.classes_at_risk ?? 0),
      threshold,
      qiLabels: qis.map((v) => v.label),
      sensitiveLabel: sensitive?.label,
    } satisfies PrivacyMetrics;
  }, [spec, query, cohortSuppressed]);

  const value: AppStateValue = {
    catalogue,
    status,
    error,
    activeDatasetId,
    spec,
    rowCounts,
    population,
    sdc,
    setSdc,
    resetSdc,
    revealRaw,
    setRevealRaw,
    fields,
    query,
    setQuery,
    clearQuery,
    addRule,
    ruleCount,
    mode,
    setMode,
    guided,
    setGuided,
    getFunnelCounts,
    llmConfig,
    setLlmConfig,
    llmAvailable,
    draftFromText,
    applyDraft,
    templates: TEMPLATES,
    applyTemplate,
    activeSensitivity,
    count,
    rawCount,
    counting,
    populationWarning,
    repetitionWarning,
    cohortSuppressed,
    getPrivacyMetrics,
    chartVars,
    addChart,
    removeChart,
    loadDataset,
    loadCustom,
    getBreakdown,
    getFacetCounts,
    getDataFiles,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
