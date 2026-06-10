import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';
import type { CohortSpecOverride } from './types';

export type OverrideFormat = 'yaml' | 'toml' | 'json';

export function detectFormat(fileName: string, text: string): OverrideFormat {
  const n = fileName.toLowerCase();
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.toml')) return 'toml';
  if (n.endsWith('.yaml') || n.endsWith('.yml')) return 'yaml';
  // sniff content
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^\s*\[[\w.]+\]\s*$/m.test(text)) return 'toml';
  return 'yaml';
}

/** Parse an override file (YAML, TOML, or JSON) into a CohortSpecOverride. */
export function parseOverride(fileName: string, text: string): CohortSpecOverride {
  const fmt = detectFormat(fileName, text);
  let obj: unknown;
  switch (fmt) {
    case 'json':
      obj = JSON.parse(text);
      break;
    case 'toml':
      obj = parseToml(text);
      break;
    case 'yaml':
      obj = parseYaml(text);
      break;
  }
  if (obj == null || typeof obj !== 'object') {
    throw new Error('override file did not parse to an object');
  }
  return obj as CohortSpecOverride;
}
