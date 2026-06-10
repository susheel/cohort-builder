import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../app/AppState';
import type { BreakdownCell } from '../app/AppState';
import type { VariableSpec } from '../spec/types';

interface ChartDatum {
  bucket: string;
  /** numeric height; 0 for suppressed/unavailable so the bar marker still shows */
  value: number;
  suppressed: boolean;
  rounded: boolean;
  label: string;
}

const SUPPRESSED_FILL = 'url(#hatch)';
const NORMAL_FILL = '#0891b2';
const ROUNDED_FILL = '#f59e0b';

function toDatum(cell: BreakdownCell): ChartDatum {
  const { kind, value, available, displayLabel } = cell.result;
  const suppressed = kind === 'suppressed' || (kind === 'boolean' && !available);
  const rounded = kind === 'rounded';
  return {
    bucket: cell.bucket,
    value: typeof value === 'number' ? value : 0,
    suppressed,
    rounded,
    label: suppressed ? displayLabel : kind === 'boolean' ? 'available' : rounded ? `≈ ${value}` : String(value ?? 0),
  };
}

export function Characterisation() {
  const { spec, chartVars, addChart, removeChart, cohortSuppressed, sdc, activeSensitivity } = useApp();

  // candidate variables for breakdown: any visible categorical-ish widget,
  // subject- or file-level.
  const candidates = useMemo<VariableSpec[]>(() => {
    if (!spec) return [];
    return spec.variables.filter(
      (v) =>
        v.visible !== false &&
        (v.widget === 'multiselect' || v.widget === 'bins' || v.widget === 'boolean'),
    );
  }, [spec]);

  const available = useMemo(
    () => candidates.filter((v) => !chartVars.includes(v.name)),
    [candidates, chartVars],
  );

  const [pending, setPending] = useState('');

  if (!spec) return null;

  const thresholdK = sdc.levels[activeSensitivity]?.thresholdK ?? 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Characterisation</h2>
        {!cohortSuppressed && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Add chart
            <select
              value={pending}
              onChange={(e) => {
                const name = e.target.value;
                if (name) {
                  addChart(name);
                  setPending('');
                }
              }}
              disabled={available.length === 0}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-50"
            >
              <option value="">{available.length === 0 ? 'All shown' : 'Choose a variable…'}</option>
              {available.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {cohortSuppressed ? (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600"
          role="status"
        >
          <p className="font-semibold text-slate-700">Characterisation hidden</p>
          <p className="mt-1.5 leading-relaxed">
            The matching cohort is below the disclosure threshold (k = {thresholdK}), so breakdowns
            are suppressed to protect privacy. Broaden the cohort to see charts.
          </p>
        </div>
      ) : chartVars.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
          No charts. Use “Add chart” to break the cohort down by a variable.
        </div>
      ) : (
        <div className="space-y-3">
          {chartVars.map((name) => {
            const v = candidates.find((c) => c.name === name);
            if (!v) return null;
            return <ChartPanel key={name} variable={v} onRemove={() => removeChart(name)} />;
          })}
        </div>
      )}
    </div>
  );
}

function ChartPanel({ variable, onRemove }: { variable: VariableSpec; onRemove: () => void }) {
  const { spec, query, sdc, getBreakdown } = useApp();
  const [cells, setCells] = useState<BreakdownCell[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spec) {
      setCells([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getBreakdown(variable.name)
      .then((c) => {
        if (!cancelled) setCells(c);
      })
      .catch(() => {
        if (!cancelled) setCells([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spec, variable.name, query, sdc, getBreakdown]);

  const data = useMemo(() => cells.map(toDatum), [cells]);
  const hasSuppressed = data.some((d) => d.suppressed);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{variable.label}</h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${variable.label} chart`}
          title="Remove chart"
          className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Computing breakdown…</p>
      ) : data.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">No data for this breakdown.</p>
      ) : (
        <>
          <div style={{ width: '100%', height: Math.max(140, data.length * 34) }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={data} margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
                <defs>
                  <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="#e2e8f0" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeWidth="2" />
                  </pattern>
                </defs>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="bucket"
                  width={120}
                  tick={{ fontSize: 11, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  formatter={(_v: number, _n: string, item: { payload?: ChartDatum }) => [
                    item.payload?.label ?? '',
                    'count',
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} minPointSize={4}>
                  {data.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.suppressed ? SUPPRESSED_FILL : d.rounded ? ROUNDED_FILL : NORMAL_FILL}
                    />
                  ))}
                  <LabelList dataKey="label" position="right" style={{ fontSize: 11, fill: '#475569' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <LegendSwatch color={NORMAL_FILL} label="Exact count" />
            <LegendSwatch color={ROUNDED_FILL} label="Rounded (≈)" />
            {hasSuppressed && <LegendSwatch hatch label="Suppressed (below threshold, shown as <k)" />}
          </div>
        </>
      )}
    </div>
  );
}

function LegendSwatch({ color, hatch, label }: { color?: string; hatch?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm border border-slate-300"
        style={
          hatch
            ? {
                backgroundImage:
                  'repeating-linear-gradient(45deg, #94a3b8 0, #94a3b8 2px, #e2e8f0 2px, #e2e8f0 4px)',
              }
            : { backgroundColor: color }
        }
      />
      {label}
    </span>
  );
}
