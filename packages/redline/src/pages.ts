import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from './paths';
import { affectedRoutes, isDynamicRoute, type AffectedRoute } from './routes/affected';
import { matchPattern } from './routes/pattern';
import { normalizePath } from './source';
import type { ChangedPage, DiffFile } from './types';

/** The parts of `redline.config.json` the overlay uses. */
export interface PageConfig {
  seeds: string[];
  exclude: string[];
  error?: string;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** `seeds` and `exclude` from `redline.config.json` in `appDir`. A missing file is an empty config. */
export function readPageConfig(appDir: string): PageConfig {
  let text: string;
  try {
    text = fs.readFileSync(path.join(appDir, CONFIG_FILE), 'utf8');
  } catch {
    return { seeds: [], exclude: [] };
  }
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object') return { seeds: [], exclude: [] };
    return { seeds: strings(Reflect.get(data, 'seeds')), exclude: strings(Reflect.get(data, 'exclude')) };
  } catch (err) {
    return { seeds: [], exclude: [], error: `${CONFIG_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Changed and deleted files of a diff, relative to `appDir`. Diff paths are relative to `root`;
 * files outside the app are dropped. A rename counts as the old path deleted and the new one changed.
 */
export function appFiles(files: DiffFile[], root: string, appDir: string): { changed: string[]; deleted: string[] } {
  const rel = (p: string) => {
    const r = normalizePath(path.relative(appDir, path.join(root, p)));
    return r.startsWith('../') || r === '..' || path.isAbsolute(r) ? null : r;
  };
  const changed = new Set<string>();
  const deleted = new Set<string>();
  for (const f of files) {
    const target = f.status === 'deleted' ? deleted : changed;
    const p = rel(f.path);
    if (p) target.add(p);
    const old = f.status === 'renamed' && f.oldPath ? rel(f.oldPath) : null;
    if (old) deleted.add(old);
  }
  return { changed: [...changed].sort(), deleted: [...deleted].sort() };
}

const CONFIDENCE = { high: 0, medium: 1, low: 2 };
const depth = (p: ChangedPage) => p.sources[0]?.depth ?? Infinity;

/** A seed's path, without query or hash, for matching against a route pattern. */
const seedPath = (seed: string) => seed.split(/[?#]/)[0] || '/';

export interface ChangedPagesResult {
  pages: ChangedPage[];
  unplaced: string[];
}

/**
 * Pages that `changed` and `deleted` files reach, from `affectedRoutes`. Static routes link to
 * themselves, dynamic ones to the first matching seed. Routes or URLs in `exclude` are left out.
 */
export function changedPages(appDir: string, files: { changed: string[]; deleted: string[] }, config: PageConfig): ChangedPagesResult {
  const result = affectedRoutes({ root: appDir, changedFiles: files.changed, deletedFiles: files.deleted });
  const entry = (r: AffectedRoute, status: ChangedPage['status']): ChangedPage => {
    const dynamic = isDynamicRoute(r.route);
    const url = status === 'removed' ? null : dynamic ? config.seeds.find((s) => matchPattern(r.route, seedPath(s))) ?? null : r.route;
    return { route: r.route, status, url, needsExample: status === 'changed' && dynamic && url === null, confidence: r.confidence, reason: r.reason, sources: r.sources };
  };
  const excluded = new Set(config.exclude);
  const pages = [...result.routes.map((r) => entry(r, 'changed')), ...result.removed.map((r) => entry(r, 'removed'))]
    .filter((p) => !excluded.has(p.route) && !(p.url && excluded.has(seedPath(p.url))))
    .sort(
      (a, b) =>
        Number(a.status === 'removed') - Number(b.status === 'removed') ||
        depth(a) - depth(b) ||
        CONFIDENCE[a.confidence] - CONFIDENCE[b.confidence] ||
        a.route.localeCompare(b.route),
    );
  return { pages, unplaced: result.unplaced };
}

const MAX_CACHED = 20;
const cache = new Map<string, ChangedPagesResult>();

/**
 * `changedPages`, cached. The import-graph scan takes 0.2 to 0.5 s on a large app, and the overlay
 * asks again whenever the diff changes. The key holds the baseline and head SHAs, the changed
 * files (uncommitted edits change them without moving HEAD) and the config.
 */
export function cachedChangedPages(
  key: { appDir: string; baselineSha: string | null; headSha: string | null },
  files: { changed: string[]; deleted: string[] },
  config: PageConfig,
  fresh = false,
): ChangedPagesResult & { cached: boolean } {
  const id = JSON.stringify([key.appDir, key.baselineSha, key.headSha, files.changed, files.deleted, config.seeds, config.exclude]);
  const hit = fresh ? undefined : cache.get(id);
  if (hit) return { ...hit, cached: true };
  const result = changedPages(key.appDir, files, config);
  cache.delete(id);
  cache.set(id, result);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value ?? id);
  return { ...result, cached: false };
}
