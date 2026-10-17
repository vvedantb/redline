// Ported from pre-post (https://github.com/juangadm/pre-post), MIT License,
// Copyright (c) 2026 Juan Gabriel Delgado. See THIRD_PARTY_NOTICES.md.

/**
 * Route entry discovery for Vite apps.
 *
 * Vite has no routing convention of its own, so we look for the common ones:
 *   1. File-based pages:  src/pages/**  (vite-plugin-pages, Nuxt-style)
 *   2. File-based routes: src/routes/** (TanStack Router file routes)
 *   3. React Router declarations: <Route path="/x" element={<X/>}>,
 *      { path: '/x', element: <X/> }, { path: '/x', Component: X },
 *      resolved to the component's source file.
 */

import fs from 'fs';
import path from 'path';
import { resolveSpecifier, walkSourceFiles, toPosix, readAliases, type Alias } from './imports';
import { hasDependency } from './pkg';

const PAGE_EXTS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte'];

/**
 * File path under a routes folder → route pattern. Follows TanStack Router and
 * Remix flat-route naming: dots nest, `$id` is a param, `_layout` and `(group)`
 * segments add no URL part, a trailing `_` un-nests, and `index`, `route` and
 * `.lazy` name the folder's own page.
 */
function fileToRoute(rel: string): string {
  const segments = toPosix(rel).replace(/\.[^.]+$/, '').replace(/\.lazy$/, '').split(/[/.]/);
  if (segments[segments.length - 1] === 'route') segments.pop();
  const kept = segments
    .filter(seg => seg && seg !== 'index' && !seg.startsWith('_') && !/^\(.*\)$/.test(seg))
    .map(seg => seg.replace(/_$/, '').replace(/\$(\w+)/g, '[$1]'));
  return '/' + kept.join('/');
}

/** A TanStack Router route module. */
const FILE_ROUTE = /\bcreate(?:Lazy)?FileRoute\s*\(/;

function readOr(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function collectFileRoutes(dir: string, files: Iterable<string>, entries: Map<string, string>): void {
  const prefix = dir + path.sep;
  const candidates: string[] = [];
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    if (!PAGE_EXTS.includes(path.extname(file))) continue;
    const base = path.basename(file);
    if (base.startsWith('_') && !/^_index\./.test(base)) continue; // layouts / private
    if (/\.(test|spec|stories)\./.test(base)) continue;
    const rel = toPosix(path.relative(dir, file));
    if (/(^|\/)-/.test(rel)) continue; // TanStack ignores `-` prefixed files and folders
    if (/(^|\/)[-_]?(components?|hooks|utils|lib)\//.test(rel)) continue;
    candidates.push(file);
  }
  // In a TanStack app, only modules that create a file route are pages; the
  // rest are helpers co-located with them (excluded by routeFileIgnorePattern).
  const routeModules = candidates.filter(file => FILE_ROUTE.test(readOr(file)));
  for (const file of routeModules.length ? routeModules : candidates) {
    if (!entries.has(file)) entries.set(file, fileToRoute(path.relative(dir, file)));
  }
}

const ROUTE_DECL = /path\s*[:=]\s*["'`]([^"'`\n]+)["'`]/g;

/** Map imported component names to specifiers in one file. */
function componentImports(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const named = /import\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"\n]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(source))) {
    const spec = m[3];
    if (m[1]) map.set(m[1], spec);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) map.set(name, spec);
      }
    }
  }
  const lazy = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:React\.)?lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = lazy.exec(source))) map.set(m[1], m[2]);
  return map;
}

function joinRoute(parent: string, child: string): string {
  if (child.startsWith('/')) return child.replace(/\/+$/, '') || '/';
  const base = parent.replace(/\/+$/, '');
  const joined = `${base}/${child}`.replace(/\/+/g, '/').replace(/\/+$/, '');
  return joined || '/';
}

/**
 * Scan source files that mention react-router for route declarations.
 */
function collectReactRouterRoutes(files: Set<string>, aliases: Alias[], entries: Map<string, string>): void {
  for (const file of files) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    if (!/react-router|createBrowserRouter|createRoutesFromElements|<Routes|<Route\b/.test(source)) continue;
    const imports = componentImports(source);
    let parent = '/';
    ROUTE_DECL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUTE_DECL.exec(source))) {
      const raw = m[1];
      if (raw === '*' || raw.includes('${')) continue;
      const routePath = joinRoute(parent, raw.replace(/:(\w+)/g, '[$1]'));
      if (raw.startsWith('/')) parent = routePath;
      const window = source.slice(m.index, m.index + 400);
      const comp =
        window.match(/element\s*[:=]\s*\{?\s*<\s*([\w$.]+)/)?.[1]
        || window.match(/Component\s*[:=]\s*\{?\s*([\w$.]+)/)?.[1]
        || window.match(/component\s*[:=]\s*\{?\s*([\w$.]+)/)?.[1]
        || window.match(/lazy\s*[:=]\s*\(\)\s*=>\s*import\s*\(\s*['"]([^'"\n]+)['"]/)?.[1];
      if (!comp) continue;
      const spec = comp.includes('/') || comp.startsWith('.') ? comp : imports.get(comp.split('.')[0]);
      if (!spec) continue;
      const target = resolveSpecifier(spec, file, files, aliases);
      if (target && !entries.has(target)) entries.set(target, routePath);
    }
  }
}

/** absolute entry file → route path */
export function viteRouteEntries(appRoot: string, files: string[] = walkSourceFiles(appRoot), aliases: Alias[] = readAliases(appRoot)): Map<string, string> {
  const entries = new Map<string, string>();
  // Explicit router declarations win over file-name guesses.
  collectReactRouterRoutes(new Set(files), aliases, entries);
  collectFileRoutes(path.join(appRoot, 'src', 'pages'), files, entries);
  collectFileRoutes(path.join(appRoot, 'src', 'routes'), files, entries);
  collectFileRoutes(path.join(appRoot, 'pages'), files, entries);
  return entries;
}

export function isViteApp(appRoot: string): boolean {
  return hasDependency(appRoot, 'vite')
    || fs.readdirSync(appRoot).some(f => /^vite\.config\.(ts|js|mjs|cjs|mts)$/.test(f));
}
