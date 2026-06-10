import { useEffect, useState } from 'react';
import { useApp } from '../app/AppState';
import type { DataFilesPage } from '../app/AppState';
import { formatCount } from '../sdc/format';
import { FacetCount } from './FacetCount';

const PAGE_SIZE = 25;

/** Human-readable column header from a raw column name. */
function headerLabel(col: string): string {
  return col
    .replace(/_/g, ' ')
    .replace(/\bid\b/i, 'ID')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Format file size in bytes to a human string, e.g. 1.4 GB. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / 1024 ** i;
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** Render a single cell value with column-aware formatting. */
function renderCell(col: string, raw: unknown) {
  if (raw == null || raw === '') return <span className="text-slate-300">—</span>;

  if (col === 'is_multi_specimen') {
    const yes = raw === true || raw === 'true' || raw === 1 || raw === '1';
    return <span>{yes ? 'Yes' : 'No'}</span>;
  }
  if (col === 'file_size_bytes') {
    return <span className="tabular-nums">{formatBytes(Number(raw))}</span>;
  }
  if (col === 'syn_id' || /(^|_)id$/i.test(col)) {
    return <span className="font-mono text-[11px] text-slate-700">{String(raw)}</span>;
  }
  return <span>{String(raw)}</span>;
}

export function DataFilesTable() {
  const { spec, query, sdc, getDataFiles } = useApp();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<DataFilesPage>({ columns: [], rows: [], total: 0 });
  const [loading, setLoading] = useState(false);

  // reset to first page whenever the cohort changes
  useEffect(() => {
    setPage(0);
  }, [query, sdc]);

  useEffect(() => {
    if (!spec) {
      setData({ columns: [], rows: [], total: 0 });
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      getDataFiles({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch(() => {
          if (!cancelled) setData({ columns: [], rows: [], total: 0 });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [spec, query, sdc, page, getDataFiles]);

  if (!spec) return null;

  const { columns, rows, total } = data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const end = Math.min(total, (page + 1) * PAGE_SIZE);

  // file-level datasets only: hide entirely if there is no file table
  if (columns.length === 0 && total === 0 && !loading) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Data files</h2>
        <span className="text-xs text-slate-500" aria-live="polite">
          {formatCount(total)} file{total === 1 ? '' : 's'} linked to the cohort
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 font-semibold">
                  {headerLabel(col)}
                </th>
              ))}
              <th className="px-2 py-1.5 font-semibold">Matching subjects</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-6 text-center text-slate-400">
                  {loading ? 'Loading files…' : 'No files linked to the current cohort.'}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="border-b border-slate-100 text-slate-700 hover:bg-slate-50">
                  {columns.map((col) => (
                    <td key={col} className="px-2 py-1.5 align-top">
                      {renderCell(col, row.cells[col])}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 align-top">
                    <FacetCount result={row.subjectCount} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
        <p className="text-[11px] text-slate-400">
          Files linked to the current cohort. Subject counts are disclosure-controlled.
        </p>
        {total > 0 && (
          <div className="flex items-center gap-2">
            <span aria-live="polite">
              {start}–{end} of {formatCount(total)}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1 || loading}
              className="rounded border border-slate-300 px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
