import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/AppState';
import type { CohortTemplate } from '../data/templates';

/**
 * "Start from a template" menu. Selecting a template replaces the current query
 * with the template's include/exclude criteria (criteria invalid for the active
 * dataset are dropped by AppState.applyTemplate) and switches to guided mode.
 */
export function TemplatePicker() {
  const { templates, applyTemplate } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (templates.length === 0) return null;

  const choose = (t: CohortTemplate) => {
    applyTemplate(t);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      >
        Start from a template
        <span aria-hidden="true" className="text-slate-400">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Cohort templates"
          className="absolute left-0 z-20 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {templates.map((t) => (
            <li key={t.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => choose(t)}
                className="block w-full px-3 py-2 text-left hover:bg-cyan-50/60 focus:bg-cyan-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500/40"
              >
                <span className="block text-sm font-medium text-slate-700">{t.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
