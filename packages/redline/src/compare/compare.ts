import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright-core';
import { BuildManager } from '../build';
import { parseUnifiedDiff } from '../diff';
import { parseEnvText } from '../env';
import { analyzeRoutePair, createJevClient, JEV_SKIPPED_NOTICE, mockJevFetch, type JevAnalysis, type JevCandidate, type JevClient } from '../jev';
import { resolveCommit } from '../server';
import { affectedRoutes, type AffectedRoute, type AffectedRoutesResult, type Framework } from '../routes/affected';
import { capRoutes, DEFAULT_CONCURRENCY, DEFAULT_MAX_ROUTES, discoverRoutes, patternFor, type DiscoveredRoute, type RouteOrigin, type RoutePath } from '../routes/discover';
import type { BuildFramework } from '../types';
import { capturePage, CONVEX_WRITE_GUARD, DEFAULT_VIEWPORT, launchBrowser, stableContext, type BrowserOptions, type PageCapture, type Viewport } from './capture';
import { startDevServer } from './devserver';
import { groupSharedChanges } from './groups';
import { mapPool } from './pool';
import { BLANK_BOTH, classify, rankPages, type PageStatus } from './classify';
import { diffImages, overlaps, regionHashes, type Region } from './pixels';
import { buildRouteChanges } from './routechanges';
import { writeReport, type CommitRef, type PageShot, type Report, type ReportFileDiff, type ReportPage } from './report';

export interface CompareOptions {
  /** App directory (where `package.json` and the Next or Vite config live). Default `process.cwd()`. */
  root?: string;
  /** Commit to compare against. Default `HEAD~1`. */
  base?: string;
  /** Commit to check. Default `HEAD`. */
  head?: string;
  /** Report directory. Default `<root>/.redline/report`. */
  out?: string;
  /** Extra paths to capture, e.g. example URLs for dynamic routes. Added to `redline.config.json` seeds. */
  seeds?: string[];
  /** Pages captured at most. Default 50. */
  maxRoutes?: number;
  viewport?: Viewport;
  browser?: BrowserOptions;
  /** Changed areas smaller than this many square pixels are ignored. Default 100. */
  minArea?: number;
  /** Jev client for visual linking. Default: built from `TYPESAFE_API_KEY`, or the offline mock when `REDLINE_JEV_MOCK=1`. */
  jev?: JevClient;
  /** Progress messages. */
  log?: (message: string) => void;
  /** Dotenv file passed to both builds unfiltered, e.g. a local backend URL. Overrides `redline.config.json`. */
  envFile?: string;
  /** `live` lets pages reach the network, writes included. Use only with a disposable backend. Default `read-only`. */
  network?: NetworkPolicy;
  /** Signs in before pages are found. A function, or a module path whose default export is one. */
  auth?: LoginHook | string;
  /** Hooks, or a module path that exports them: `login` and `routePath`. */
  hooks?: CompareHooks | string;
  /** `build` serves production builds. `dev` runs each commit's dev server in turn. Default `build`. */
  serve?: ServeMode;
  /** Pages loaded at once. Default 4. */
  concurrency?: number;
  /** CSS selectors painted over in every screenshot, such as clocks and live counters. */
  mask?: string[];
  /** CSS selectors hidden in every screenshot, such as dev-only toolbars. */
  hide?: string[];
  /** Drop Convex mutations and actions sent by captured pages. */
  blockConvexWrites?: boolean;
}

export type NetworkPolicy = 'read-only' | 'live';
export type ServeMode = 'build' | 'dev';

export interface CompareHooks {
  login?: LoginHook;
  /**
   * The path the router matches for a URL path, for apps that rewrite URLs. Used only to match
   * pages to route files; pages are still loaded at their own URL.
   */
  routePath?: RoutePath;
}

export interface LoginContext {
  /** A page in the capture browser. Cookies and storage it sets are kept for every capture. */
  page: Page;
  /** Where this commit's build is served, without a trailing slash. Paths go after it. */
  baseUrl: string;
  side: 'base' | 'head';
}

export type LoginHook = (context: LoginContext) => Promise<void>;

export interface CompareResult {
  report: Report;
  /** Directory holding `index.html`, `report.json`, `pages/` and `images/`. */
  outDir: string;
  /** `index.html` of the report. */
  reportFile: string;
}

/** `redline.config.json` in the app directory. Every field is optional. */
export interface RedlineConfig {
  seeds?: string[];
  maxRoutes?: number;
  viewport?: Viewport;
  /** Dotenv file, relative to the app directory, passed to both builds unfiltered. */
  envFile?: string;
  network?: NetworkPolicy;
  /** Module, relative to the app directory, whose default export is a `LoginHook`. */
  auth?: string;
  /** Module, relative to the app directory, exporting `login` and `routePath`. */
  hooks?: string;
  serve?: ServeMode;
  concurrency?: number;
  mask?: string[];
  hide?: string[];
  blockConvexWrites?: boolean;
}

export const CONFIG_FILE = 'redline.config.json';

export function readConfig(root: string): RedlineConfig {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RedlineConfig;
  } catch (err) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitRef(top: string, ref: string, sha: string): CommitRef {
  return { ref, sha, subject: git(top, ['log', '-1', '--format=%s', sha]).trim() };
}

/** The app directory at `sha`, extracted with `git archive` into `<root>/.redline/trees/<sha>`. */
function extractTree(top: string, root: string, rel: string, sha: string): string {
  const dir = path.join(root, '.redline', 'trees', sha);
  const done = path.join(dir, '.complete');
  if (!fs.existsSync(done)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const tar = path.join(dir, 'tree.tar');
    git(top, ['archive', '--format=tar', '-o', tar, sha, ...(rel ? ['--', rel] : [])]);
    execFileSync('tar', ['-xf', tar, '-C', dir], { stdio: 'ignore' });
    fs.rmSync(tar);
    fs.writeFileSync(done, '');
  }
  return path.join(dir, rel);
}

/** Files that differ between two commits under `rel`, relative to `rel`. */
export function changedBetween(top: string, rel: string, base: string, head: string): { changed: string[]; deleted: string[] } {
  const out = git(top, ['diff', '--name-status', '--no-renames', base, head, '--', rel || '.']);
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const line of out.split('\n')) {
    const [status, file] = line.split('\t');
    if (!file) continue;
    const local = rel ? path.posix.relative(rel.split(path.sep).join('/'), file) : file;
    (status.startsWith('D') ? deleted : changed).push(local);
  }
  return { changed, deleted };
}

/** Parsed `git diff` between two commits for files under `rel`, with paths relative to `rel`. */
export function diffBetween(top: string, rel: string, base: string, head: string): ReportFileDiff[] {
  const text = git(top, ['diff', '--no-renames', '--no-color', '--no-ext-diff', base, head, '--', rel || '.']);
  const prefix = rel ? rel.split(path.sep).join('/') + '/' : '';
  const local = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
  return parseUnifiedDiff(text).map((f) => {
    const oldPath = f.oldPath ? local(f.oldPath) : null;
    const newPath = local(f.path);
    const header = `--- ${f.status === 'added' ? '/dev/null' : `a/${oldPath ?? newPath}`}\n+++ ${f.status === 'deleted' ? '/dev/null' : `b/${newPath}`}`;
    return { path: newPath, oldPath, status: f.status, patch: [header, ...f.hunks.map((h) => h.patch)].join('\n') + '\n', hunks: f.hunks };
  });
}

function jevClient(options: CompareOptions): JevClient | null {
  if (options.jev) return options.jev;
  if (process.env.REDLINE_JEV_MOCK === '1') return createJevClient({ apiKey: 'mock', fetch: mockJevFetch });
  const apiKey = process.env.TYPESAFE_API_KEY;
  return apiKey ? createJevClient({ apiKey }) : null;
}

function jevCandidates(suspects: AffectedRoute['sources'], diffs: ReportFileDiff[]): JevCandidate[] {
  return suspects
    .filter((s) => diffs.some((d) => d.path === s.file))
    .slice(0, 8)
    .map((s) => ({ file: s.file, description: s.depth === 0 ? 'The page file itself' : `Imported ${s.depth} step${s.depth === 1 ? '' : 's'} away from the page` }));
}

function buildFramework(framework: Framework): BuildFramework {
  if (framework === 'nextjs-app' || framework === 'nextjs-pages') return 'next';
  if (framework === 'vite') return 'vite';
  throw new Error('redline compare supports Next.js and Vite apps. Run it from the app directory, or pass --root.');
}

function suspectsFor(pattern: string | null, affected: AffectedRoutesResult): AffectedRoute['sources'] {
  if (!pattern) return [];
  return (affected.routes.find((r) => r.route === pattern) ?? affected.removed.find((r) => r.route === pattern))?.sources ?? [];
}

function readEnvFile(root: string, file: string | undefined): Record<string, string> | undefined {
  if (!file) return undefined;
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) throw new Error(`envFile ${file} does not exist.`);
  return parseEnvText(fs.readFileSync(abs, 'utf8'));
}

async function importModule(root: string, file: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(path.resolve(root, file)).href);
}

/** `hooks` (a module or object) plus the older `auth` default export. `auth` wins for `login`. */
async function loadHooks(root: string, hooks: CompareHooks | string | undefined, auth: LoginHook | string | undefined): Promise<CompareHooks> {
  const out: CompareHooks = {};
  if (typeof hooks === 'string') {
    const mod = await importModule(root, hooks);
    if (typeof mod.login === 'function') out.login = mod.login as LoginHook;
    if (typeof mod.routePath === 'function') out.routePath = mod.routePath as RoutePath;
    if (!out.login && !out.routePath) throw new Error(`hooks module ${hooks} exports neither login nor routePath.`);
  } else if (hooks) {
    Object.assign(out, hooks);
  }
  if (typeof auth === 'function') out.login = auth;
  else if (auth) {
    const mod = await importModule(root, auth);
    if (typeof mod.default !== 'function') throw new Error(`auth module ${auth} has no default export function.`);
    out.login = mod.default as LoginHook;
  }
  return out;
}

/** Run the login hook once per commit, in the shared capture context. */
async function signIn(context: BrowserContext, login: LoginHook, sides: [LoginContext['side'], string][], log: (m: string) => void): Promise<void> {
  for (const [side, baseUrl] of sides) {
    const page = await context.newPage();
    try {
      await login({ page, baseUrl, side });
      log(`Signed in (${side}).`);
    } catch (err) {
      throw new Error(`Login hook failed for ${side}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

function shot(page: PageCapture | undefined, outDir: string): PageShot | null {
  if (!page?.image || page.failed) return null;
  return { image: path.relative(outDir, page.image).split(path.sep).join('/'), width: page.width!, height: page.height!, status: page.status };
}

/** Remove what an earlier run wrote, without touching anything else in `outDir`. */
function clearOut(outDir: string): void {
  for (const name of ['images', 'pages', 'index.html', 'report.json']) fs.rmSync(path.join(outDir, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
}

interface Served {
  /** Where the commit is served, no trailing slash. */
  url: string;
  close: () => Promise<void>;
}

/** Load `/` once with a long timeout, so a dev server compiles before timed captures start. */
async function warmUp(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(url + '/', { waitUntil: 'networkidle', timeout: 180_000 });
  } catch {
    // Captures report the failure page by page.
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Region keys for grouping: the box plus the pixels before and after. */
function regionKeys(before: string, after: string, regions: Region[]): string[] {
  const b = regionHashes(fs.readFileSync(before), regions);
  const a = regionHashes(fs.readFileSync(after), regions);
  return regions.map((r, i) => `${r.x},${r.y},${r.width},${r.height}:${b[i]}:${a[i]}`);
}

/**
 * Build `base` and `head` (or run their dev servers), find the app's pages, screenshot each page
 * at both commits, and write a static report of what changed. Builds reuse the History build
 * engine and are cached by commit under `<root>/.redline`.
 */
export async function compare(options: CompareOptions = {}): Promise<CompareResult> {
  const log = options.log ?? (() => undefined);
  const root = fs.realpathSync(path.resolve(options.root ?? process.cwd()));
  const top = fs.realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim());
  const rel = path.relative(top, root);
  const config = readConfig(root);
  const maxRoutes = options.maxRoutes ?? config.maxRoutes ?? DEFAULT_MAX_ROUTES;
  const viewport = options.viewport ?? config.viewport ?? DEFAULT_VIEWPORT;
  const seeds = [...(config.seeds ?? []), ...(options.seeds ?? [])];
  const outDir = path.resolve(options.out ?? path.join(root, '.redline', 'report'));
  const env = readEnvFile(root, options.envFile ?? config.envFile);
  const network = options.network ?? config.network ?? 'read-only';
  const { login, routePath } = await loadHooks(root, options.hooks ?? config.hooks, options.auth ?? config.auth);
  const serve = options.serve ?? config.serve ?? 'build';
  const concurrency = Math.max(1, options.concurrency ?? config.concurrency ?? DEFAULT_CONCURRENCY);
  const mask = [...(config.mask ?? []), ...(options.mask ?? [])];
  const hide = [...(config.hide ?? []), ...(options.hide ?? [])];
  const blockConvexWrites = options.blockConvexWrites ?? config.blockConvexWrites ?? false;

  const baseRefName = options.base ?? 'HEAD~1';
  const headRefName = options.head ?? 'HEAD';
  const baseSha = resolveCommit(top, baseRefName);
  const headSha = resolveCommit(top, headRefName);
  if (baseSha === headSha) throw new Error(`${baseRefName} and ${headRefName} are the same commit (${baseSha.slice(0, 7)}).`);
  const base = commitRef(top, baseRefName, baseSha);
  const head = commitRef(top, headRefName, headSha);
  log(`Comparing ${baseSha.slice(0, 7)} (${base.subject}) -> ${headSha.slice(0, 7)} (${head.subject})`);

  const baseTree = extractTree(top, root, rel, baseSha);
  const headTree = extractTree(top, root, rel, headSha);
  const framework = affectedRoutes({ root: headTree, changedFiles: [] }).framework;
  const { changed, deleted } = changedBetween(top, rel, baseSha, headSha);
  const affected = affectedRoutes({ root: headTree, baseRoot: baseTree, changedFiles: changed, deletedFiles: deleted, framework });
  const fileDiffs = diffBetween(top, rel, baseSha, headSha);
  log(`${changed.length + deleted.length} changed file(s); framework ${framework}`);

  const builds = new BuildManager({ root, framework: buildFramework(framework), capture: false, maxReady: 10, env });
  const closers: (() => Promise<void>)[] = [];
  try {
    if (serve === 'build') {
      for (const sha of [baseSha, headSha]) {
        const job = builds.enqueue(sha);
        if (job.status !== 'ready') log(`Building ${sha.slice(0, 7)}...`);
      }
      await builds.whenIdle();
      for (const sha of [baseSha, headSha]) {
        const job = builds.get(sha);
        if (job?.status !== 'ready') {
          throw new Error(`Build of ${sha.slice(0, 7)} failed: ${job?.error ?? 'unknown error'}\n${(job?.logTail ?? []).join('\n')}`);
        }
      }
    }

    const browser = await launchBrowser(root, options.browser);
    closers.push(() => browser.close());
    const context = await stableContext(browser, viewport, login ? new Date() : undefined);
    if (network === 'live') await context.addInitScript('window.__redlineNetworkLive = true;');
    if (blockConvexWrites) await context.addInitScript(CONVEX_WRITE_GUARD);

    /** Serve one commit and sign in. Dev servers log to `.redline/dev/<sha>.log`. */
    const open = async (sha: string, side: LoginContext['side']): Promise<Served> => {
      let served: Served;
      if (serve === 'dev') {
        const logFile = path.join(root, '.redline', 'dev', `${sha}.log`);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, '');
        const devLog = (text: string) => fs.appendFileSync(logFile, text);
        log(`Starting the dev server for ${sha.slice(0, 7)}...`);
        const worktree = await builds.devWorktree(sha, devLog);
        try {
          const server = await startDevServer({ dir: worktree.dir, framework: buildFramework(framework), env: { ...process.env, ...env, REDLINE: '0', BROWSER: 'none' }, log: devLog });
          served = { url: server.url, close: async () => { await server.close(); worktree.remove(); } };
        } catch (err) {
          worktree.remove();
          throw new Error(`${err instanceof Error ? err.message : String(err)} See ${logFile}.`);
        }
        await warmUp(context, served.url);
      } else {
        const preview = await builds.preview(sha);
        served = { url: preview.url.replace(/\/$/, ''), close: preview.close };
      }
      closers.push(served.close);
      if (login) await signIn(context, login, [[side, served.url]], log);
      return served;
    };

    // `build`: both commits stay up for the whole run. `dev`: one dev server at a time, base
    // first, so head's pages are found from its route files and seeds rather than a crawl.
    const baseServed = await open(baseSha, 'base');
    let headServed = serve === 'build' ? await open(headSha, 'head') : null;

    log('Finding pages...');
    const discover = { seeds, maxRoutes: Infinity, framework, context, routePath, concurrency };
    const [before, after] = await Promise.all([
      discoverRoutes({ ...discover, root: baseTree, baseUrl: baseServed.url }),
      discoverRoutes({ ...discover, root: headTree, baseUrl: headServed?.url }),
    ]);
    const merged = new Map<string, Set<RouteOrigin>>();
    for (const r of [...before.routes, ...after.routes]) {
      const from = merged.get(r.path) ?? merged.set(r.path, new Set()).get(r.path)!;
      r.from.forEach((f) => from.add(f));
    }
    const patterns = [...new Set([...after.patterns, ...before.patterns])];
    const all: DiscoveredRoute[] = [...merged].map(([p, from]) => ({
      path: p,
      pattern: patternFor(p, after.patterns, routePath) ?? patternFor(p, before.patterns, routePath),
      from: [...from].sort(),
    }));
    const { routes, skipped } = capRoutes(all, maxRoutes, patterns);

    clearOut(outDir);
    const images = path.join(outDir, 'images');
    const shotFile = (i: number, side: string) => path.join(images, `${String(i).padStart(3, '0')}-${side}.png`);
    log(`Capturing ${routes.length} page(s) at both commits, ${concurrency} at a time...`);
    const capture = (served: Served, side: string) =>
      mapPool(routes, concurrency, (route, i) => capturePage(context, served.url, route.path, shotFile(i, side), { mask, hide }));
    const befores = await capture(baseServed, 'before');
    if (!headServed) {
      await baseServed.close();
      headServed = await open(headSha, 'head');
    }
    const afters = await capture(headServed, 'after');

    // Diff, then load each changed page at head once more: areas that also differ between two
    // loads of the same commit are live data or timing, not the change.
    const servedHead = headServed;
    const diffs = await mapPool(routes, concurrency, async (route, i) => {
      const b = befores[i];
      const a = afters[i];
      if (!b.image || !a.image || b.failed || a.failed) return { regions: [] as Region[], changedRatio: 0, unstable: 0 };
      const d = diffImages(fs.readFileSync(b.image), fs.readFileSync(a.image), { minArea: options.minArea });
      if (!d.regions.length) return { regions: d.regions, changedRatio: d.changedRatio, unstable: 0 };
      const again = await capturePage(context, servedHead.url, route.path, shotFile(i, 'recheck'), { mask, hide });
      let noise: Region[] = [];
      if (again.image && !again.failed) {
        noise = diffImages(fs.readFileSync(a.image), fs.readFileSync(again.image), { minArea: options.minArea }).regions;
        fs.rmSync(again.image, { force: true });
      }
      const regions = d.regions.filter((r) => !noise.some((n) => overlaps(r, n)));
      return { regions, changedRatio: regions.length ? d.changedRatio : 0, unstable: d.regions.length - regions.length };
    });

    const jev = jevClient(options);
    const notices: string[] = [];
    if (!jev) notices.push(JEV_SKIPPED_NOTICE);
    const pages: Omit<ReportPage, 'id'>[] = [];
    const keysByPath = new Map<string, string[]>();
    for (const [i, route] of routes.entries()) {
      const b = befores[i];
      const a = afters[i];
      const { regions, changedRatio, unstable } = diffs[i];
      const inBase = patternFor(route.path, before.patterns, routePath) !== null;
      const inHead = patternFor(route.path, after.patterns, routePath) !== null;
      const classified = classify({ before: b, after: a, regions, inBase, inHead });
      const { status } = classified;
      const reason = status === 'unchanged' && unstable
        ? `Only areas that differ between two loads of the same commit changed (${unstable})`
        : classified.reason;
      const keepRegions = status === 'changed' || status === 'broken';
      const suspects = suspectsFor(route.pattern, affected);
      let analysis: JevAnalysis | undefined;
      if (jev && keepRegions && regions.length && b.image && a.image) {
        try {
          analysis = await analyzeRoutePair({ client: jev, before: fs.readFileSync(b.image), after: fs.readFileSync(a.image), route: route.path, candidates: jevCandidates(suspects, fileDiffs), regions, cacheDir: path.join(root, '.redline', 'jev-cache') });
        } catch (err) {
          notices.push(`Jev visual linking failed for ${route.path}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (status === 'changed' && b.image && a.image) keysByPath.set(route.path, regionKeys(b.image, a.image, regions));
      pages.push({
        path: route.path,
        pattern: route.pattern,
        status,
        reason,
        suspects,
        jev: analysis,
        before: status === 'added' ? null : shot(b, outDir),
        after: status === 'removed' ? null : shot(a, outDir),
        regions: keepRegions ? regions : [],
        changedRatio: keepRegions ? changedRatio : 0,
        errors: status === 'removed' ? [] : [...new Set([...a.errors, ...a.consoleErrors].filter((e) => !b.errors.includes(e) && !b.consoleErrors.includes(e)))],
        ...(unstable ? { unstable } : {}),
        ...(a.blockedWrites ? { blockedWrites: a.blockedWrites } : {}),
      });
      log(`  ${status.padEnd(9)} ${route.path}`);
    }
    for (const s of skipped) {
      pages.push({ path: s.route, pattern: s.route, status: 'skipped', reason: `Not captured: ${s.reason}`, suspects: suspectsFor(s.route, affected), before: null, after: null, regions: [], changedRatio: 0, errors: [] });
    }

    const ranked: ReportPage[] = rankPages(pages).map((p, id) => ({ id, ...p }));
    const shared = groupSharedChanges(
      ranked.filter((p) => keysByPath.has(p.path)).map((p) => ({ id: p.id, regions: p.regions, suspects: p.suspects, regionKeys: keysByPath.get(p.path)! })),
    );
    for (const g of shared) for (const id of g.pages) (ranked[id].shared ??= []).push(g.id);
    const summary = Object.fromEntries((['broken', 'changed', 'added', 'removed', 'skipped', 'unchanged'] as PageStatus[]).map((s) => [s, ranked.filter((p) => p.status === s).length])) as Report['summary'];
    const overCap = skipped.filter((s) => s.reason.startsWith('over')).length;
    if (overCap) notices.push(`${overCap} page(s) were not captured because of the ${maxRoutes}-page limit. Raise it with --max-routes.`);
    if (routes.length && pages.filter((p) => p.reason === BLANK_BOTH).length === routes.length) {
      notices.push('Every page was blank at both commits. Builds run without secret and Convex env keys, so an app that needs them to start renders nothing.');
    }
    const unstablePages = ranked.filter((p) => p.unstable);
    if (unstablePages.length) {
      notices.push(`${unstablePages.reduce((n, p) => n + (p.unstable ?? 0), 0)} area(s) on ${unstablePages.length} page(s) differed between two loads of the same commit and were ignored. List their selectors under "mask" to hide them.`);
    }
    if (affected.limits.filesCapped) notices.push(`Only the first ${affected.limits.fileCap} source files were scanned, so "Likely from" may miss some files.`);
    if (affected.limits.depthCapped) notices.push(`Imports more than ${affected.limits.depthCap} files deep were not followed, so "Likely from" may miss some pages.`);

    const report: Report = {
      version: 2,
      createdAt: new Date().toISOString(),
      framework,
      base,
      head,
      pages: ranked,
      summary,
      shared,
      notices,
      changedFiles: changed,
      deletedFiles: deleted,
      fileDiffs,
      routeChanges: buildRouteChanges({ before: before.patterns, after: after.patterns, affected, pages: ranked }),
    };
    const reportFile = writeReport(report, outDir);
    return { report, outDir, reportFile };
  } finally {
    for (const close of closers.reverse()) await close().catch(() => undefined);
    builds.close();
  }
}
