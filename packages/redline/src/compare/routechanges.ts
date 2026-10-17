import type { AffectedRoutesResult } from '../routes/affected';
import type { ReportPage, RouteChange, RouteChanges } from './report';

export interface RouteChangeInput {
  /** Route patterns found at the base commit. */
  before: string[];
  /** Route patterns found at the head commit. */
  after: string[];
  affected: AffectedRoutesResult;
  pages: Pick<ReportPage, 'id' | 'path' | 'pattern'>[];
}

/**
 * Added and removed routes come from comparing the route patterns of the two commits. Changed
 * routes are the ones `affectedRoutes` traced from changed files that exist at both commits.
 */
export function buildRouteChanges({ before, after, affected, pages }: RouteChangeInput): RouteChanges {
  const inBefore = new Set(before);
  const inAfter = new Set(after);
  const sources = new Map([...affected.routes, ...affected.removed].map((r) => [r.route, r.sources]));
  const make = (pattern: string): RouteChange => {
    const page = pages.find((p) => p.pattern === pattern) ?? pages.find((p) => p.path === pattern);
    const files = sources.get(pattern) ?? [];
    return { path: page?.path ?? pattern, pattern, pageId: page?.id ?? null, files: files.map((s) => s.file), kind: files.some((s) => s.depth === 0) ? 'page' : 'import' };
  };
  const byPattern = (a: RouteChange, b: RouteChange) => a.pattern.localeCompare(b.pattern);
  const added = [...inAfter].filter((p) => !inBefore.has(p));
  const removed = [...new Set([...inBefore].filter((p) => !inAfter.has(p)).concat(affected.removed.map((r) => r.route)))].filter((p) => !inAfter.has(p));
  const changed = affected.routes.map((r) => r.route).filter((p) => !added.includes(p) && !removed.includes(p));
  return { added: added.map(make).sort(byPattern), changed: changed.map(make).sort(byPattern), removed: removed.map(make).sort(byPattern) };
}
