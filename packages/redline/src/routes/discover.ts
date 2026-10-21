import type { BrowserContext } from 'playwright-core';
import { capturePage, launchBrowser, stableContext, type BrowserOptions } from '../compare/capture';
import { mapPool } from '../compare/pool';
import { isDynamicRoute, routeEntries, type Framework } from './affected';

export type RouteOrigin = 'file' | 'link' | 'sitemap' | 'seed' | 'derived';

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
  /** Maps a URL path to the path the router matches, for apps that rewrite URLs. Default: unchanged. */
  routePath?: RoutePath;
  /** Pages the link crawl loads at most. Default 150. */
  crawlBudget?: number;
  /** Pages the crawl loads at once. Default 4. */
  concurrency?: number;
  /** Stop the crawl once each of these route patterns has an example URL. */
  targets?: string[];
  /** Sign-out paths never loaded, on top of the built-in ones (see `isSignOutPath`). Seeds are still loaded. */
  signOutPaths?: string[];
}

export type RoutePath = (appPath: string) => string;
const same: RoutePath = (p) => p;

export interface DiscoverResult {
  routes: DiscoveredRoute[];
  skipped: SkippedRoute[];
  /** Pattern of every file-system route, static and dynamic. */
  patterns: string[];
}

export const DEFAULT_MAX_ROUTES = 50;
/** Link hops from `/`. Hops past the second follow only one page per dynamic route. */
const CRAWL_DEPTH = 4;
export const DEFAULT_CRAWL_BUDGET = 150;
export const DEFAULT_CONCURRENCY = 4;

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
export function patternFor(appPath: string, patterns: string[], routePath: RoutePath = same): string | null {
  appPath = normalize(routePath(appPath));
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

/** A `logout`, `log-out`, `log_out`, `signout`, `sign-out` or `sign_out` path segment, as in `/auth/signout/`. */
const SIGN_OUT = /(^|\/)(log[-_]?out|sign[-_]?out)(\/|$)/i;

/**
 * Whether loading `appPath` would end the session. The crawl never follows these links and
 * discovery never returns them: one load signs the capture browser out for every page after it,
 * and a server that ends the session server-side signs out every context. `extra` paths match
 * exactly or as a parent path.
 */
export function isSignOutPath(appPath: string, extra: string[] = []): boolean {
  const p = normalize(appPath);
  return SIGN_OUT.test(p) || extra.map(normalize).some((e) => p === e || p.startsWith(`${e}/`));
}

interface CrawlOptions {
  targets?: string[];
  signOutPaths: string[];
  patterns: string[];
  routePath: RoutePath;
  budget: number;
  concurrency: number;
}

/**
 * Same-origin links reachable from `/`. The first two hops load every page found. Later hops load
 * only the first page of each dynamic route, so lists lead to one example of each detail page
 * without loading every row. Stops after `budget` page loads.
 */
async function crawl(context: BrowserContext, baseUrl: string, { targets, signOutPaths, patterns, routePath, budget, concurrency }: CrawlOptions): Promise<string[]> {
  const prefix = baseUrl.replace(/\/$/, '');
  const found = new Set<string>(['/']);
  const followed = new Set<string>();
  let loads = 0;
  let frontier = ['/'];
  for (let depth = 0; depth < CRAWL_DEPTH && frontier.length && loads < budget; depth++) {
    const batch = frontier.slice(0, budget - loads);
    loads += batch.length;
    const pages = await mapPool(batch, concurrency, (p) => capturePage(context, prefix, p));
    const next: string[] = [];
    for (const link of pages.flatMap((page) => page.links)) {
      if (found.has(link) || isSignOutPath(link, signOutPaths)) continue;
      found.add(link);
      const pattern = patternFor(link, patterns, routePath);
      if (depth >= 1 && pattern && isDynamicRoute(pattern)) {
        if (followed.has(pattern)) continue;
        followed.add(pattern);
      }
      next.push(link);
    }
    frontier = next;
    if (targets?.length) {
      const covered = new Set([...found].map((p) => patternFor(p, patterns, routePath)));
      for (const pattern of deriveExamples(found, patterns, routePath).keys()) covered.add(pattern);
      if (targets.every((t) => covered.has(t))) break;
    }
  }
  return [...found];
}

/**
 * Example URLs for dynamic routes that nothing linked to, built from ones that were found: when
 * `/[owner]/[repo]/sessions/[id]` has `/acme/app/sessions/7`, then
 * `/[owner]/[repo]/sessions/[id]/review` gets `/acme/app/sessions/7/review`. Only static segments
 * are appended, and each result must match its pattern. Tabs and sub-pages reached by buttons
 * rather than links are covered this way.
 */
export function deriveExamples(found: Iterable<string>, patterns: string[], routePath: RoutePath = same): Map<string, string> {
  const example = new Map<string, string>();
  for (const p of found) {
    const pattern = patternFor(p, patterns, routePath);
    if (pattern && !example.has(pattern)) example.set(pattern, p);
  }
  const derived = new Map<string, string>();
  const segs = (p: string) => p.split('/').filter(Boolean);
  for (const target of patterns) {
    if (!isDynamicRoute(target) || example.has(target)) continue;
    const t = segs(target);
    let best: { url: string; depth: number } | null = null;
    for (const [pattern, url] of example) {
      const s = segs(pattern);
      if (s.length >= t.length || s.some((seg, i) => seg !== t[i])) continue;
      const rest = t.slice(s.length);
      if (rest.some((seg) => isDynamicRoute('/' + seg))) continue;
      if (!best || s.length > best.depth) best = { url: `${url.replace(/\/$/, '')}/${rest.join('/')}`, depth: s.length };
    }
    if (best && patternFor(best.url, patterns, routePath) === target) derived.set(target, best.url);
  }
  return derived;
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
  const routePath = options.routePath ?? same;
  const signOutPaths = options.signOutPaths ?? [];
  for (const s of options.seeds ?? []) add(s, 'seed');
  for (const p of patterns) if (!isDynamicRoute(p) && !isSignOutPath(p, signOutPaths)) add(p, 'file');

  if (options.baseUrl) {
    for (const p of await fetchSitemap(options.baseUrl)) if (!isSignOutPath(p, signOutPaths)) add(p, 'sitemap');
    let context = options.context;
    const browser = context ? null : await launchBrowser(options.root, options.browser);
    try {
      context ??= await stableContext(browser!);
      const crawlOptions = { targets: options.targets, signOutPaths, patterns, routePath, budget: options.crawlBudget ?? DEFAULT_CRAWL_BUDGET, concurrency: options.concurrency ?? DEFAULT_CONCURRENCY };
      for (const p of await crawl(context, options.baseUrl, crawlOptions)) add(p, 'link');
    } finally {
      await browser?.close();
    }
  }

  for (const url of deriveExamples(found.keys(), patterns, routePath).values()) if (!isSignOutPath(url, signOutPaths)) add(url, 'derived');
  const all = [...found.entries()].map(([p, from]) => ({ path: p, pattern: patternFor(p, patterns, routePath), from: [...from].sort() as RouteOrigin[] }));
  return { ...capRoutes(all, maxRoutes, patterns), patterns };
}

/**
 * Order routes (seeds, then `/`, then shorter paths) and keep `maxRoutes`. A dynamic route keeps one
 * example besides seeds: a second blog post rarely shows anything the first did not. Dynamic
 * patterns that no route covers come back as skipped, and so does everything over the cap.
 */
export function capRoutes(routes: DiscoveredRoute[], maxRoutes: number, patterns: string[] = []): { routes: DiscoveredRoute[]; skipped: SkippedRoute[] } {
  const rank = (r: DiscoveredRoute) => (r.from.includes('seed') ? 0 : r.path === '/' ? 1 : 2);
  const sorted = [...routes].sort((a, b) => rank(a) - rank(b) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  const examples = new Set<string>();
  const ordered = sorted.filter((r) => {
    if (r.from.includes('seed') || !r.pattern || !isDynamicRoute(r.pattern)) return true;
    if (examples.has(r.pattern)) return false;
    examples.add(r.pattern);
    return true;
  });
  const kept = ordered.slice(0, maxRoutes);
  const skipped: SkippedRoute[] = ordered.slice(maxRoutes).map((r) => ({ route: r.path, reason: `over the ${maxRoutes}-route limit` }));
  for (const p of patterns) {
    if (isDynamicRoute(p) && !routes.some((r) => r.pattern === p)) skipped.push({ route: p, reason: 'needs an example URL' });
  }
  return { routes: kept, skipped };
}
