import { useEffect, useState } from 'react';
import { useApp } from './AppState';
import { DatasetPicker } from '../components/DatasetPicker';
import { VariablePalette } from '../components/VariablePalette';
import { QuerySummary } from '../components/QuerySummary';
import { QueryBuilderPanel } from '../components/QueryBuilderPanel';
import { BuilderModeToggle } from '../components/BuilderModeToggle';
import { GuidedBuilder } from '../components/GuidedBuilder';
import { TemplatePicker } from '../components/TemplatePicker';
import { DescribeCohort } from '../components/DescribeCohort';
import { Characterisation } from '../components/Characterisation';
import { DataFilesTable } from '../components/DataFilesTable';
import { PrivacyPanel } from '../components/PrivacyPanel';
import { CountRail } from '../components/CountRail';
import { SettingsPanel } from '../components/SettingsPanel';
import { DataUploader } from '../components/DataUploader';
import { HelpPanel } from '../components/HelpPanel';
import { asset } from '../util/asset';

export function App() {
  const { catalogue, status, error, activeDatasetId, loadDataset } = useApp();
  const [showSettings, setShowSettings] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // auto-select the first catalogue entry once available and nothing is loaded
  useEffect(() => {
    if (status === 'idle' && !activeDatasetId && catalogue.length > 0) {
      void loadDataset(catalogue[0].id);
    }
  }, [status, activeDatasetId, catalogue, loadDataset]);

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <h1 className="text-base font-bold text-slate-800">Cohort Builder</h1>
        <div className="ml-2">
          <DatasetPicker />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            Load your own data
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Disclosure control settings"
            title="Disclosure control settings"
            className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <GearIcon />
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            aria-label="Help: data and spec reference"
            title="Help: data and spec reference"
            className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <HelpIcon />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {status === 'idle' && <EmptyState />}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={() => activeDatasetId && void loadDataset(activeDatasetId)} />}
        {status === 'ready' && <ReadyLayout />}
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showUploader && <DataUploader onClose={() => setShowUploader(false)} />}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function ReadyLayout() {
  const { mode } = useApp();
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 lg:grid lg:grid-cols-[340px_minmax(0,1fr)_300px] lg:gap-4 lg:overflow-hidden lg:p-4">
      <aside className="rounded-lg border border-slate-200 bg-white shadow-sm lg:overflow-hidden">
        <div className="h-full lg:overflow-y-auto">
          <VariablePalette />
        </div>
      </aside>

      <section className="flex min-w-0 flex-col gap-4 lg:overflow-y-auto">
        <BuilderModeToggle />
        <div className="flex flex-wrap items-start gap-2">
          <TemplatePicker />
        </div>
        <DescribeCohort />
        {mode === 'guided' ? <GuidedBuilder /> : <QueryBuilderPanel />}
        <QuerySummary />
        <Characterisation />
        <DataFilesTable />
        <PrivacyPanel />
      </section>

      <aside className="lg:sticky lg:top-0 lg:self-start">
        <CountRail />
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <p className="text-lg font-semibold text-slate-700">Pick a dataset to begin</p>
        <p className="mt-2 text-sm text-slate-500">
          Choose a dataset from the picker above, or load your own data, to start building a cohort.
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      {/* Animated Sage logo (CSS opacity pulse lives inside the SVG) */}
      <img src={asset('sage-loading.svg')} alt="" width={76} height={81} aria-hidden="true" />
      <p className="text-sm text-slate-500">Loading data…</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-sens-high/40 bg-sens-high/5 p-5 text-center">
        <p className="text-sm font-semibold text-sens-high">Failed to load dataset</p>
        <p className="mt-2 break-words text-xs text-slate-600">{error ?? 'Unknown error.'}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md bg-sens-high px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-sens-high/40"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7L5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.4.9-1.4 1.8v.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="11.9" cy="16.6" r="0.9" fill="currentColor" />
    </svg>
  );
}
