import { useState } from 'react';
import { useApp } from '../app/AppState';
import type { TableSource } from '../duckdb/loader';

interface SlotState {
  /** logical table name registered in DuckDB */
  name: string;
  file: File | null;
}

const SLOTS: { key: string; defaultName: string; label: string; required: boolean }[] = [
  { key: 'subjects', defaultName: 'subjects', label: 'Subjects table (parquet / csv)', required: true },
  { key: 'files', defaultName: 'files', label: 'Files table (optional)', required: false },
  { key: 'junction', defaultName: 'subject_files', label: 'Junction table (optional)', required: false },
];

export function DataUploader({ onClose }: { onClose: () => void }) {
  const { loadCustom } = useApp();
  const [slots, setSlots] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(SLOTS.map((s) => [s.key, { name: s.defaultName, file: null }])),
  );
  const [overrideFile, setOverrideFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSlotFile = (key: string, file: File | null) =>
    setSlots((prev) => ({ ...prev, [key]: { ...prev[key], file } }));
  const setSlotName = (key: string, name: string) =>
    setSlots((prev) => ({ ...prev, [key]: { ...prev[key], name } }));

  const subjectsReady = !!slots.subjects?.file;

  const submit = async () => {
    if (!subjectsReady) {
      setError('A subjects table is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sources: TableSource[] = [];
      for (const s of SLOTS) {
        const slot = slots[s.key];
        if (!slot.file) continue;
        const buffer = new Uint8Array(await slot.file.arrayBuffer());
        sources.push({ name: slot.name.trim() || s.defaultName, buffer, fileName: slot.file.name });
      }
      let override: { name: string; text: string } | undefined;
      if (overrideFile) {
        override = { name: overrideFile.name, text: await overrideFile.text() };
      }
      await loadCustom(sources, override);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Load your own data">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Load your own data</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="rounded-md bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
            The subjects table is required. Provide a junction table and a files table for many-to-many file filters.
          </p>
          <p className="flex items-start gap-1.5 rounded-md bg-emerald-50 p-2.5 text-xs leading-relaxed text-emerald-800">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <path d="M12 3l7 3v5c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              Your data stays in your browser. Files are read locally and queried in-memory with
              DuckDB-WASM; nothing is uploaded to a server and nothing is persisted after you close
              the tab.
            </span>
          </p>

          {SLOTS.map((s) => (
            <div key={s.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  {s.label}
                  {s.required && <span className="ml-1 text-sens-high">*</span>}
                </span>
                <input
                  type="text"
                  value={slots[s.key].name}
                  onChange={(e) => setSlotName(s.key, e.target.value)}
                  aria-label={`${s.label} table name`}
                  className="w-32 rounded border border-slate-300 px-2 py-0.5 text-xs focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                />
              </div>
              <input
                type="file"
                accept=".parquet,.csv,.tsv"
                onChange={(e) => setSlotFile(s.key, e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-500 file:mr-3 file:rounded file:border-0 file:bg-cyan-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-cyan-700 hover:file:bg-cyan-100"
              />
            </div>
          ))}

          <div className="space-y-1.5 border-t border-slate-100 pt-3">
            <span className="text-xs font-medium text-slate-700">Override spec (optional: .yaml / .yml / .toml / .json)</span>
            <input
              type="file"
              accept=".yaml,.yml,.toml,.json"
              onChange={(e) => setOverrideFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-500 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </div>

          {error && <p role="alert" className="rounded-md bg-sens-high/10 p-2 text-xs text-sens-high">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!subjectsReady || submitting}
            className="rounded-md bg-cyan-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Loading…' : 'Load data'}
          </button>
        </div>
      </div>
    </div>
  );
}
