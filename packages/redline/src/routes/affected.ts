// Framework adapters ported from pre-post (https://github.com/juangadm/pre-post) src/routes.ts,
// MIT License, Copyright (c) 2026 Juan Gabriel Delgado. See THIRD_PARTY_NOTICES.md.
// `affectedRoutes` is Redline's own entry point over them.

import fs from 'fs';
import path from 'path';
import { detectAppRouterRoutes, detectPagesRouterRoutes } from './nextjs';
import { detectGenericRoutes } from './generic';
import { addContainment, buildImportGraph, findAffectedEntries, readAliases, walkSourceFiles, toPosix, SKIP_DIRS, type Alias, type ImportGraph } from './imports';
import { viteRouteEntries, isViteApp } from './vite';
import { hasDependency } from './pkg';
import type { Confidence, DetectedRoute } from './types';

export type Framework = 'nextjs-app' | 'nextjs-pages' | 'vite' | 'generic';

interface FrameworkAdapter {
  name: Framework;
  matches(root: string): boolean;
  normalize(rel: string): string;
  directRoutes(files: string[]): DetectedRoute[];
  routeEntries(appRoot: string, files: string[], aliases: Alias[]): Map<string, string>;
  containers(appRoot: string, files: string[], entries: Map<string, string>): Map<string, string[]>;
}

/**
 * Build tooling every stylesheet passes through. A change here restyles the
 * whole app, which no import edge records, so it wraps every entry.
 */
const STYLE_TOOLING = /^(tailwind|postcss)\.config\.(ts|js|mjs|cjs|mts|cts)$/;

function styleTooling(appRoot: string, files: string[], entries: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const all = [...entries.keys()];
  for (const file of files) {
    if (path.dirname(file) === appRoot && STYLE_TOOLING.test(path.basename(file))) out.set(file, all);
  }
  return out;
}

/**
 * Next.js nesting: an App Router `layout`/`template` wraps every page in its
 * folder and below; a Pages Router `_app`/`_document` wraps every page.
 */
function nextContainers(appRoot: string, files: string[], entries: Map<string, string>, dirName: 'app' | 'pages'): Map<string, string[]> {
  const out = styleTooling(appRoot, files, entries);
  const routerDir = path.join(routerBase(appRoot, dirName), dirName);
  const wrapper = dirName === 'app' ? /^(layout|template)\.(tsx|ts|jsx|js|mdx)$/ : /^_(app|document)\.(tsx|ts|jsx|js)$/;
  const pages = [...entries.keys()];
  for (const file of files) {
    if (!file.startsWith(routerDir + path.sep) || !wrapper.test(path.basename(file))) continue;
    const scope = dirName === 'app' ? path.dirname(file) + path.sep : routerDir + path.sep;
    out.set(file, pages.filter(p => p.startsWith(scope)));
  }
  return out;
}

const NEXT_APP_PAGE = /^app\/(.+\/)?page\.(tsx|ts|jsx|js|mdx|md)$/;
const NEXT_PAGES_HIGH = /^pages\/(?!api\/|_)(.+)\.(tsx|ts|jsx|js|mdx|md)$/;
const NEXT_PAGE_FILE = /^(page|layout)\.(tsx|ts|jsx|js|mdx)$/;
const PAGES_INDEX_FILE = /^(index|_app|_document)\.(tsx|ts|jsx|js|mdx)$/;

function stripSrc(rel: string): string {
  return rel.replace(/^src\//, '');
}

function hasNextConfig(root: string): boolean {
  return ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next-env.d.ts'].some(f => fs.existsSync(path.join(root, f)));
}

function containsFile(dir: string, pattern: RegExp, depth: number): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  if (entries.some(e => e.isFile() && pattern.test(e.name))) return true;
  if (depth === 0) return false;
  return entries.some(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && containsFile(path.join(dir, e.name), pattern, depth - 1));
}

function appDir(root: string): string | null {
  for (const d of [path.join(root, 'app'), path.join(root, 'src', 'app')]) if (fs.existsSync(d)) return d;
  return null;
}

function pagesDir(root: string): string | null {
  for (const d of [path.join(root, 'pages'), path.join(root, 'src', 'pages')]) if (fs.existsSync(d)) return d;
  return null;
}

function routerBase(appRoot: string, dirName: 'app' | 'pages'): string {
  return fs.existsSync(path.join(appRoot, 'src', dirName)) ? path.join(appRoot, 'src') : appRoot;
}

function nextEntries(appRoot: string, files: string[], dirName: 'app' | 'pages', pattern: RegExp, rule: (files: string[]) => DetectedRoute[]): Map<string, string> {
  const entries = new Map<string, string>();
  const base = routerBase(appRoot, dirName);
  const prefix = path.join(base, dirName) + path.sep;
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const rel = toPosix(path.relative(base, file));
    if (!pattern.test(rel)) continue;
    const route = rule([rel])[0];
    if (route) entries.set(file, route.path);
  }
  return entries;
}

const FRAMEWORKS: FrameworkAdapter[] = [
  {
    name: 'nextjs-app',
    matches: root => {
      const dir = appDir(root);
      if (!dir) return false;
      return hasDependency(root, 'next') || hasNextConfig(root) || containsFile(dir, NEXT_PAGE_FILE, 4);
    },
    normalize: stripSrc,
    directRoutes: detectAppRouterRoutes,
    routeEntries: (appRoot, files) => nextEntries(appRoot, files, 'app', NEXT_APP_PAGE, detectAppRouterRoutes),
    containers: (appRoot, files, entries) => nextContainers(appRoot, files, entries, 'app'),
  },
  {
    name: 'nextjs-pages',
    matches: root => {
      const dir = pagesDir(root);
      if (!dir || hasDependency(root, 'vite')) return false;
      return hasDependency(root, 'next') || hasNextConfig(root) || containsFile(dir, PAGES_INDEX_FILE, 1);
    },
    normalize: stripSrc,
    directRoutes: detectPagesRouterRoutes,
    routeEntries: (appRoot, files) => nextEntries(appRoot, files, 'pages', NEXT_PAGES_HIGH, detectPagesRouterRoutes),
    containers: (appRoot, files, entries) => nextContainers(appRoot, files, entries, 'pages'),
  },
  {
    name: 'vite',
    matches: isViteApp,
    normalize: rel => rel,
    directRoutes: detectGenericRoutes,
    routeEntries: viteRouteEntries,
    containers: styleTooling,
  },
  {
    name: 'generic',
    matches: () => true,
    normalize: rel => rel,
    directRoutes: detectGenericRoutes,
    routeEntries: () => new Map(),
    containers: () => new Map(),
  },
];

function adapterFor(name: Framework): FrameworkAdapter {
  return FRAMEWORKS.find(f => f.name === name) ?? FRAMEWORKS[FRAMEWORKS.length - 1];
}

export function frameworkForRoot(root: string): Framework {
  return FRAMEWORKS.find(f => f.matches(root))!.name;
}

export function isDynamicRoute(route: string): boolean {
  return /[[\]:*]/.test(route);
}

/** For a layout-only route (no page of its own), the closest static page beneath it. */
function nearestPageRoute(route: string, knownRoutes: string[]): string | null {
  if (knownRoutes.includes(route)) return route;
  const prefix = route === '/' ? '/' : route + '/';
  return knownRoutes.find(r => r.startsWith(prefix) && !isDynamicRoute(r)) ?? null;
}

// ============================================================
// Route entries of one tree
// ============================================================

export interface RouteEntries {
  framework: Framework;
  /** Absolute entry file → route pattern, e.g. `/blog/[slug]`. */
  entries: Map<string, string>;
  files: string[];
  aliases: Alias[];
  filesCapped: boolean;
}

export const DEFAULT_MAX_FILES = 8000;
export const DEFAULT_MAX_DEPTH = 8;

/** Route entry files of the app at `root`. */
export function routeEntries(root: string, options: { framework?: Framework; maxFiles?: number } = {}): RouteEntries {
  const framework = options.framework ?? frameworkForRoot(root);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const files = walkSourceFiles(root, maxFiles);
  const aliases = readAliases(root);
  return { framework, entries: adapterFor(framework).routeEntries(root, files, aliases), files, aliases, filesCapped: files.length >= maxFiles };
}

function graphFor(root: string, tree: RouteEntries): ImportGraph {
  const graph = buildImportGraph(root, { files: tree.files, aliases: tree.aliases });
  addContainment(graph, adapterFor(tree.framework).containers(root, tree.files, tree.entries));
  return graph;
}

// ============================================================
// affectedRoutes
// ============================================================

export interface AffectedRoutesOptions {
  /** App directory at the head commit. */
  root: string;
  /** Files added or modified, relative to `root`. */
  changedFiles: string[];
  /** Files deleted, relative to `root`. */
  deletedFiles?: string[];
  /** App directory at the base commit. Lets deleted files be traced through the old import graph. */
  baseRoot?: string;
  framework?: Framework;
  /** Source files scanned per tree. Default 8000. */
  maxFiles?: number;
  /** Import hops followed from a changed file. Default 8. */
  maxDepth?: number;
}

export interface RouteSource {
  /** Changed or deleted file, relative to `root`. */
  file: string;
  /** Import hops from the file to the page. 0 = the page file itself. */
  depth: number;
}

export interface AffectedRoute {
  /** Route pattern, e.g. `/about` or `/blog/[slug]`. */
  route: string;
  confidence: Confidence;
  reason: string;
  /** Files that lead here, closest first. */
  sources: RouteSource[];
}

export interface AffectedRoutesResult {
  framework: Framework;
  routes: AffectedRoute[];
  /** Routes whose page file was deleted and that no longer exist at head. */
  removed: AffectedRoute[];
  /** Changed files no page could be traced to. */
  unplaced: string[];
  /** Pattern of every route at head. */
  known: string[];
  limits: { filesCapped: boolean; depthCapped: boolean; fileCap: number; depthCap: number };
}

const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

function confidenceFor(depth: number): Confidence {
  return depth === 0 ? 'high' : depth <= 2 ? 'medium' : 'low';
}

class RouteSet {
  readonly byRoute = new Map<string, AffectedRoute>();

  add(route: string, file: string, depth: number, confidence: Confidence, reason: string): void {
    const existing = this.byRoute.get(route);
    if (!existing) {
      this.byRoute.set(route, { route, confidence, reason, sources: [{ file, depth }] });
      return;
    }
    if (!existing.sources.some(s => s.file === file)) existing.sources.push({ file, depth });
    existing.sources.sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file));
    if (CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[existing.confidence]) {
      existing.confidence = confidence;
      existing.reason = reason;
    }
  }

  list(): AffectedRoute[] {
    return [...this.byRoute.values()].sort((a, b) => CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] || a.route.localeCompare(b.route));
  }
}

function tracePage(entryRel: string, viaRel: string, depth: number): string {
  if (depth === 0) return 'Page file changed';
  return `${entryRel} uses ${viaRel}${depth > 1 ? ' indirectly' : ''}`;
}

/**
 * Which routes do these file changes touch? Walks the import graph from each changed file to the
 * page entries that use it, adds framework nesting (layouts wrap pages), and falls back to the
 * framework's file rules for anything the graph cannot place. Deleted page files become `removed`
 * when their route is gone at head.
 */
export function affectedRoutes(options: AffectedRoutesOptions): AffectedRoutesResult {
  const root = path.resolve(options.root);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const framework = options.framework ?? frameworkForRoot(root);
  const adapter = adapterFor(framework);
  const changed = [...new Set(options.changedFiles.map(toPosix))];
  const deleted = [...new Set((options.deletedFiles ?? []).map(toPosix))];
  const limits = { filesCapped: false, depthCapped: false, fileCap: maxFiles, depthCap: maxDepth };

  const head = routeEntries(root, { framework, maxFiles });
  limits.filesCapped = head.filesCapped;
  const known = [...new Set(head.entries.values())].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const routes = new RouteSet();
  const removed = new RouteSet();
  const reached = new Set<string>();

  const walk = (treeRoot: string, tree: RouteEntries, graph: ImportGraph, files: string[], keep: (route: string) => boolean) => {
    for (const rel of files) {
      const abs = path.join(treeRoot, rel);
      if (!graph.files.has(abs)) continue;
      const hit = new Set<string>();
      const found = findAffectedEntries(graph, [abs], f => tree.entries.has(f), maxDepth, hit, limits);
      for (const [entry, { depth }] of found) {
        const route = tree.entries.get(entry)!;
        if (!keep(route)) continue;
        reached.add(rel);
        routes.add(route, rel, depth, confidenceFor(depth), tracePage(toPosix(path.relative(treeRoot, entry)), rel, depth));
      }
    }
  };

  if (changed.length && head.entries.size) walk(root, head, graphFor(root, head), changed, () => true);

  if (deleted.length) {
    const baseRoot = options.baseRoot ? path.resolve(options.baseRoot) : null;
    const base = baseRoot ? routeEntries(baseRoot, { framework, maxFiles }) : null;
    if (base) limits.filesCapped ||= base.filesCapped;
    const deletedPages: { rel: string; route: string }[] = [];
    for (const rel of deleted) {
      const route = base
        ? base.entries.get(path.join(baseRoot!, rel))
        : adapter.directRoutes([adapter.normalize(rel)]).find(r => r.confidence === 'high')?.path;
      if (route) deletedPages.push({ rel, route });
    }
    for (const { rel, route } of deletedPages) {
      reached.add(rel);
      if (known.includes(route)) routes.add(route, rel, 0, 'high', 'Page file replaced');
      else removed.add(route, rel, 0, 'high', 'Page file deleted');
    }
    if (base && baseRoot && base.entries.size) {
      const others = deleted.filter(rel => !deletedPages.some(p => p.rel === rel));
      walk(baseRoot, base, graphFor(baseRoot, base), others, route => known.includes(route));
    }
  }

  // The framework's file rules only see what the graph could not place.
  const ungraphed = [...changed, ...deleted].filter(f => !reached.has(f));
  for (const r of adapter.directRoutes(ungraphed.map(adapter.normalize))) {
    const route = known.includes(r.path) ? r.path : nearestPageRoute(r.path, known) ?? r.path;
    const file = ungraphed.find(f => adapter.normalize(f) === r.sourceFile) ?? r.sourceFile;
    reached.add(file);
    routes.add(route, file, 1, r.confidence, r.reason);
  }

  return {
    framework,
    routes: routes.list().filter(r => !removed.byRoute.has(r.route)),
    removed: removed.list(),
    unplaced: ungraphed.filter(f => !reached.has(f)),
    known,
    limits,
  };
}
