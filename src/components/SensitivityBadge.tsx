import type { Sensitivity } from '../spec/types';

/**
 * Tailwind classes per sensitivity tier. The sens-* colours are defined in
 * tailwind.config: none=slate, low=cyan, medium=amber, high=red.
 */
export function sensitivityClasses(s: Sensitivity): { text: string; bg: string; border: string } {
  switch (s) {
    case 'Low':
      return { text: 'text-sens-low', bg: 'bg-sens-low/10', border: 'border-sens-low/30' };
    case 'Medium':
      return { text: 'text-sens-medium', bg: 'bg-sens-medium/10', border: 'border-sens-medium/30' };
    case 'High':
      return { text: 'text-sens-high', bg: 'bg-sens-high/10', border: 'border-sens-high/30' };
    case 'None':
    default:
      return { text: 'text-sens-none', bg: 'bg-sens-none/10', border: 'border-sens-none/20' };
  }
}

export function SensitivityBadge({
  sensitivity,
  title,
}: {
  sensitivity: Sensitivity;
  title?: string;
}) {
  const c = sensitivityClasses(sensitivity);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.text} ${c.bg} ${c.border}`}
      title={title ?? `Sensitivity: ${sensitivity}`}
    >
      {sensitivity}
    </span>
  );
}
