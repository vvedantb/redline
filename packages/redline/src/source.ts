import type { SourceLocation } from './types';

/** DOM attribute added to every tagged JSX host element. */
export const SOURCE_ATTR = 'data-redline-source';

export function formatSource(file: string, startLine: number, endLine: number): string {
  return `${file}:${startLine}-${endLine}`;
}

/** Parse `path/to/File.tsx:12-18` (or `path:12`) into a location. */
export function parseSource(value: string | null | undefined): SourceLocation | null {
  if (!value) return null;
  const m = /^(.+):(\d+)(?:-(\d+))?$/.exec(value);
  if (!m) return null;
  const startLine = Number(m[2]);
  const endLine = m[3] ? Number(m[3]) : startLine;
  return { file: m[1], startLine, endLine: Math.max(startLine, endLine) };
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
