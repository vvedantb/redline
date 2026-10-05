import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BuildManager } from '../build';
import { resolveCommit } from '../server';
import { affectedRoutes, type AffectedRoute, type AffectedRoutesResult, type Framework } from '../routes/affected';
import { capRoutes, DEFAULT_MAX_ROUTES, discoverRoutes, patternFor, type DiscoveredRoute, type RouteOrigin } from '../routes/discover';
import type { BuildFramework } from '../types';
import { capturePage, DEFAULT_VIEWPORT, launchBrowser, stableContext, type BrowserOptions, type PageCapture, type Viewport } from './capture';
import { classify, rankPages, type PageStatus } from './classify';
import { diffImages, type Region } from './pixels';
import { writeReport, type CommitRef, type PageShot, type Report, type ReportPage } from './report';

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
  /** Progress messages. */
  log?: (message: string) => void;
}

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

function buildFramework(framework: Framework): BuildFramework {
  if (framework === 'nextjs-app' || framework === 'nextjs-pages') return 'next';
  if (framework === 'vite') return 'vite';
  throw new Error('redline compare supports Next.js and Vite apps. Run it from the app directory, or pass --root.');
}

function suspectsFor(pattern: string | null, affected: AffectedRoutesResult): AffectedRoute['sources'] {
  if (!pattern) return [];
  return (affected.routes.find((r) => r.route === pattern) ?? affected.removed.find((r) => r.route === pattern))?.sources ?? [];
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

/**
 * Build `base` and `head`, find the app's pages, screenshot each page at both commits, and write a
 * static report of what changed. Builds reuse the History build engine and are cached by commit
 * under `<root>/.redline`.
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
  log(`${changed.length + deleted.length} changed file(s); framework ${framework}`);

  const builds = new BuildManager({ root, framework: buildFramework(framework), capture: false, maxReady: 10 });
  const closers: (() => Promise<void>)[] = [];
  try {
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
    const basePreview = await builds.preview(baseSha);
    closers.push(basePreview.close);
    const headPreview = await builds.preview(headSha);
    closers.push(headPreview.close);
    const basePrefix = basePreview.url.replace(/\/$/, '');
    const headPrefix = headPreview.url.replace(/\/$/, '');

    const browser = await launchBrowser(root, options.browser);
    closers.push(() => browser.close());
    const context = await stableContext(browser, viewport);

    log('Finding pages...');
    const [before, after] = await Promise.all([
      discoverRoutes({ root: baseTree, baseUrl: basePrefix, seeds, maxRoutes: Infinity, framework, context }),
      discoverRoutes({ root: headTree, baseUrl: headPrefix, seeds, maxRoutes: Infinity, framework, context }),
    ]);
    const merged = new Map<string, Set<RouteOrigin>>();
    for (const r of [...before.routes, ...after.routes]) {
      const from = merged.get(r.path) ?? merged.set(r.path, new Set()).get(r.path)!;
      r.from.forEach((f) => from.add(f));
    }
    const patterns = [...new Set([...after.patterns, ...before.patterns])];
    const all: DiscoveredRoute[] = [...merged].map(([p, from]) => ({
      path: p,
      pattern: patternFor(p, after.patterns) ?? patternFor(p, before.patterns),
      from: [...from].sort(),
    }));
    const { routes, skipped } = capRoutes(all, maxRoutes, patterns);
    log(`Capturing ${routes.length} page(s) at both commits...`);

    clearOut(outDir);
    const images = path.join(outDir, 'images');
    const pages: Omit<ReportPage, 'id'>[] = [];
    for (const [i, route] of routes.entries()) {
      const name = String(i).padStart(3, '0');
      const b = await capturePage(context, basePrefix, route.path, path.join(images, `${name}-before.png`));
      const a = await capturePage(context, headPrefix, route.path, path.join(images, `${name}-after.png`));
      const inBase = patternFor(route.path, before.patterns) !== null;
      const inHead = patternFor(route.path, after.patterns) !== null;
      let regions: Region[] = [];
      let changedRatio = 0;
      if (b.image && a.image && !b.failed && !a.failed) {
        const d = diffImages(fs.readFileSync(b.image), fs.readFileSync(a.image), { minArea: options.minArea });
        regions = d.regions;
        changedRatio = d.changedRatio;
      }
      const { status, reason } = classify({ before: b, after: a, regions, inBase, inHead });
      const keepRegions = status === 'changed' || status === 'broken';
      pages.push({
        path: route.path,
        pattern: route.pattern,
        status,
        reason,
        suspects: suspectsFor(route.pattern, affected),
        before: status === 'added' ? null : shot(b, outDir),
        after: status === 'removed' ? null : shot(a, outDir),
        regions: keepRegions ? regions : [],
        changedRatio: keepRegions ? changedRatio : 0,
        errors: [...new Set([...a.errors, ...a.consoleErrors].filter((e) => !b.errors.includes(e) && !b.consoleErrors.includes(e)))],
      });
      log(`  ${status.padEnd(9)} ${route.path}`);
    }
    for (const s of skipped) {
      pages.push({ path: s.route, pattern: s.route, status: 'skipped', reason: `Not captured: ${s.reason}`, suspects: suspectsFor(s.route, affected), before: null, after: null, regions: [], changedRatio: 0, errors: [] });
    }

    const ranked = rankPages(pages).map((p, id) => ({ id, ...p }));
    const summary = Object.fromEntries((['broken', 'changed', 'added', 'removed', 'skipped', 'unchanged'] as PageStatus[]).map((s) => [s, ranked.filter((p) => p.status === s).length])) as Report['summary'];
    const notices: string[] = [];
    const overCap = skipped.filter((s) => s.reason.startsWith('over')).length;
    if (overCap) notices.push(`${overCap} page(s) were not captured because of the ${maxRoutes}-page limit. Raise it with --max-routes.`);
    if (affected.limits.filesCapped) notices.push(`Only the first ${affected.limits.fileCap} source files were scanned, so "Likely from" may miss some files.`);
    if (affected.limits.depthCapped) notices.push(`Imports more than ${affected.limits.depthCap} files deep were not followed, so "Likely from" may miss some pages.`);

    const report: Report = {
      version: 1,
      createdAt: new Date().toISOString(),
      framework,
      base,
      head,
      pages: ranked,
      summary,
      notices,
      changedFiles: changed,
      deletedFiles: deleted,
    };
    const reportFile = writeReport(report, outDir);
    return { report, outDir, reportFile };
  } finally {
    for (const close of closers.reverse()) await close().catch(() => undefined);
    builds.close();
  }
}
