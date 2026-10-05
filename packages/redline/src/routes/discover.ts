import type { BrowserContext } from 'playwright-core';
import { capturePage, launchBrowser, stableContext, type BrowserOptions } from '../compare/capture';
import { isDynamicRoute, routeEntries, type Framework } from './affected';

export type RouteOrigin = 'file' | 'link' | 'sitemap' | 'seed';

export interface DiscoveredRoute {
  /** Concrete app path, e.g. `/blog/hello`. */
  path: string;
  /** File-system pattern it belongs to, e.g. `/blog/[slug]`, when known. */
  pattern: string | null;
  from: RouteOrigin[];
}

export interface SkippedRoute {
  /** Route pattern or path that was not captured. */
  route: string;
  reason: string;
}

export interface DiscoverOptions {
  /** App directory. File-system routes are read from here. */
  root: string;
  /** Running app, including any base path, e.g. `http://localhost:3000`. Enables the link crawl and sitemap. */
  baseUrl?: string;
  /** Extra paths to include, such as example URLs for dynamic routes. */
  seeds?: string[];
  /** Routes returned at most. Default 50. */
  maxRoutes?: number;
  framework?: Framework;
  browser?: BrowserOptions;
  /** Reuse an open browser context instead of launching one. */
  context?: BrowserContext;
}

export interface DiscoverResult {
  routes: DiscoveredRoute[];
  skipped: SkippedRoute[];
  /** Pattern of every file-system route, static and dynamic. */
  patterns: string[];
}

export const DEFAULT_MAX_ROUTES = 50;
const CRAWL_DEPTH = 2;

function segmentRegex(seg: string): string {
  let m: RegExpMatchArray | null;
  if ((m = seg.match(/^\[\[\.\.\.[^\]]+\]\]$/))) return '(?:/.+)?';
  if ((m = seg.match(/^\[\.\.\.[^\]]+\]$/))) return '/.+';
  if (/^\[[^\]]+\]$/.test(seg) || /^:\w+\??$/.test(seg)) return '/[^/]+';
  if (seg === '*') return '(?:/.*)?';
  return '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `appPath` match a route pattern such as `/blog/[slug]`, `/docs/[...slug]` or `/users/:id`? */
export function matchPattern(pattern: string, appPath: string): boolean {
  const segs = pattern.split('/').filter(Boolean);
  const re = segs.length ? segs.map(segmentRegex).join('') : '/';
  return new RegExp(`^${re}/?$`).test(appPath === '' ? '/' : appPath);
}

/** The pattern that best describes `appPath`: an exact static route first, then the most specific dynamic one. */
export function patternFor(appPath: string, patterns: string[]): string | null {
  if (patterns.includes(appPath)) return appPath;
  const matches = patterns.filter((p) => isDynamicRoute(p) && matchPattern(p, appPath));
  const score = (p: string) => p.split('/').filter((s) => s && !/[[\]:*]/.test(s)).length * 10 - (p.includes('...') ? 5 : 0);
  return matches.sort((a, b) => score(b) - score(a) || b.length - a.length)[0] ?? null;
}

/** File-system routes worth visiting: drops private `_folders` and intercepting `(.)` segments. */
export function fileRoutes(root: string, framework?: Framework): string[] {
  const { entries } = routeEntries(root, { framework });
  const visible = [...new Set(entries.values())].filter((r) => !r.split('/').some((s) => s.startsWith('_') || s.includes('(')));
  return visible.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** `<loc>` entries of a sitemap, as app paths under `baseUrl`. */
export function parseSitemap(xml: string, baseUrl: string): string[] {
  const base = new URL(baseUrl.replace(/\/?$/, '/'));
  const basePath = base.pathname.replace(/\/$/, '');
  const out = new Set<string>();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    let pathname: string;
    try {
      pathname = new URL(m[1].replace(/&amp;/g, '&'), base).pathname;
    } catch {
      continue;
    }
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length);
    out.add(pathname.replace(/\/+$/, '') || '/');
  }
  return [...out];
}

function normalize(p: string): string {
  const clean = ('/' + p.trim().replace(/^\/+/, '')).split(/[?#]/)[0].replace(/\/+$/, '');
  return clean || '/';
}

async function fetchSitemap(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(baseUrl.replace(/\/$/, '') + '/sitemap.xml', { signal: AbortSignal.timeout(5000) });
    if (!res.ok || !/xml/.test(res.headers.get('content-type') ?? '')) return [];
    return parseSitemap(await res.text(), baseUrl);
  } catch {
    return [];
  }
}

/** Same-origin links reachable from `/` within two clicks. */
async function crawl(context: BrowserContext, baseUrl: string, limit: number): Promise<string[]> {
  const prefix = baseUrl.replace(/\/$/, '');
  const found = new Set<string>(['/']);
  let frontier = ['/'];
  for (let depth = 1; depth <= CRAWL_DEPTH && frontier.length && found.size < limit; depth++) {
    const next: string[] = [];
    for (const p of frontier) {
      if (found.size >= limit) break;
      const page = await capturePage(context, prefix, p);
      for (const link of page.links) {
        if (found.has(link)) continue;
        found.add(link);
        next.push(link);
      }
    }
    frontier = depth < CRAWL_DEPTH ? next : [];
  }
  return [...found];
}

/**
 * Pages of an app, from four sources: the framework's file-system routes, a link crawl from `/`,
 * `sitemap.xml`, and caller seeds. Dynamic routes are visited only through a concrete URL from
 * one of the other sources; the rest are returned as skipped.
 */
export async function discoverRoutes(options: DiscoverOptions): Promise<DiscoverResult> {
  const maxRoutes = options.maxRoutes ?? DEFAULT_MAX_ROUTES;
  const patterns = fileRoutes(options.root, options.framework);
  const found = new Map<string, Set<RouteOrigin>>();
  const add = (p: string, from: RouteOrigin) => {
    const key = normalize(p);
    (found.get(key) ?? found.set(key, new Set()).get(key)!).add(from);
  };
  for (const s of options.seeds ?? []) add(s, 'seed');
  for (const p of patterns) if (!isDynamicRoute(p)) add(p, 'file');

  if (options.baseUrl) {
    for (const p of await fetchSitemap(options.baseUrl)) add(p, 'sitemap');
    let context = options.context;
    const browser = context ? null : await launchBrowser(options.root, options.browser);
    try {
      context ??= await stableContext(browser!);
      for (const p of await crawl(context, options.baseUrl, maxRoutes * 2)) add(p, 'link');
    } finally {
      await browser?.close();
    }
  }

  const all = [...found.entries()].map(([p, from]) => ({ path: p, pattern: patternFor(p, patterns), from: [...from].sort() as RouteOrigin[] }));
  return { ...capRoutes(all, maxRoutes, patterns), patterns };
}

/**
 * Order routes (seeds, then `/`, then shorter paths) and keep `maxRoutes`. Dynamic patterns that no
 * route covers come back as skipped, and so does everything over the cap.
 */
export function capRoutes(routes: DiscoveredRoute[], maxRoutes: number, patterns: string[] = []): { routes: DiscoveredRoute[]; skipped: SkippedRoute[] } {
  const rank = (r: DiscoveredRoute) => (r.from.includes('seed') ? 0 : r.path === '/' ? 1 : 2);
  const ordered = [...routes].sort((a, b) => rank(a) - rank(b) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  const kept = ordered.slice(0, maxRoutes);
  const skipped: SkippedRoute[] = ordered.slice(maxRoutes).map((r) => ({ route: r.path, reason: `over the ${maxRoutes}-route limit` }));
  for (const p of patterns) {
    if (isDynamicRoute(p) && !routes.some((r) => r.pattern === p)) skipped.push({ route: p, reason: 'needs an example URL' });
  }
  return { routes: kept, skipped };
}
