/**
 * Resolve a runtime asset URL against the app's base path.
 *
 * Vite rewrites base for imported assets automatically, but URLs we build at
 * runtime (catalogue.json, the bundled /data and /specs files, the loading SVG)
 * must be prefixed with import.meta.env.BASE_URL so the app works both at the
 * site root (dev) and under a sub-path such as /cohort-builder/ (GitHub Pages).
 */
export function asset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base + path.replace(/^\//, '');
}
