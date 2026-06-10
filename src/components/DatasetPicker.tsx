import { useApp } from '../app/AppState';

export function DatasetPicker() {
  const { catalogue, activeDatasetId, loadDataset, status } = useApp();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Dataset</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:opacity-60"
        value={activeDatasetId ?? ''}
        disabled={status === 'loading' || catalogue.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          if (id) void loadDataset(id);
        }}
        aria-label="Select dataset"
      >
        {catalogue.length === 0 && <option value="">No datasets available</option>}
        {activeDatasetId === 'custom' && <option value="custom">Custom upload</option>}
        {catalogue.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
            {d.variableCount != null ? ` (${d.variableCount} variables)` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
