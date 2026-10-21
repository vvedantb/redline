import path from 'node:path';
import { parse } from '@babel/parser';
import type { ImportSpecifier, JSXIdentifier, JSXMemberExpression, JSXOpeningElement, Node, Program } from '@babel/types';
import MagicString from 'magic-string';
import { SOURCE_ATTR, formatSource, normalizePath } from './source';

export interface TransformOptions {
  /** Project root; tagged paths are relative to it. */
  root: string;
  /**
   * Also tag component elements (`<Button>`, `<Tabs.Tab>`). Most UI libraries forward
   * `data-*` props to the DOM. Default `true`. Set `false` if your components reject unknown props.
   */
  tagComponents?: boolean;
  /**
   * Extra packages whose components are never tagged, added to `SKIP_PACKAGES`.
   * Matches the package name and its subpaths (`pkg/sub`).
   */
  skipComponentsFrom?: string[];
}

/** The tagging options the Vite plugin, the loader and `withRedline` pass through. */
export type TagOptions = Pick<TransformOptions, 'tagComponents' | 'skipComponentsFrom'>;

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

const SKIP_TAGS = new Set(['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title', 'template']);

/**
 * React built-ins that render no DOM element of their own. Matched on the last name part, so `React.Fragment`
 * too, and on the imported name, so `import { Fragment as F } from 'react'` skips `<F>`.
 */
const SKIP_COMPONENTS = new Set(['Fragment', 'Suspense', 'StrictMode', 'Profiler', 'Activity', 'ViewTransition']);

/**
 * Packages whose components break on an extra prop: Headless UI renders a Fragment by default and throws on
 * props it cannot forward; React Three Fiber and drei pass props to `applyProps`, which reads `a-b` as a path.
 */
export const SKIP_PACKAGES = ['@headlessui/react', '@react-three/fiber', '@react-three/drei'];

function fromPackage(source: string, packages: string[]): boolean {
  return packages.some((p) => source === p || source.startsWith(`${p}/`));
}

function importedName(spec: ImportSpecifier): string {
  return spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
}

/** Local names bound to a skipped package (any import form) or to a React built-in from `SKIP_COMPONENTS`. */
function skippedBindings(program: Program, packages: string[]): Set<string> {
  const skipped = new Set<string>();
  for (const stmt of program.body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const source = stmt.source.value;
    const all = fromPackage(source, packages);
    for (const spec of stmt.specifiers) {
      const builtin = source === 'react' && spec.type === 'ImportSpecifier' && SKIP_COMPONENTS.has(importedName(spec));
      if (all || builtin) skipped.add(spec.local.name);
    }
  }
  return skipped;
}

/** The first name part: `Menu` for `<Menu.Button>`, `Drei` for `<Drei.A.B>`. */
function rootName(name: JSXIdentifier | JSXMemberExpression): string {
  let node = name;
  while (node.type === 'JSXMemberExpression') node = node.object;
  return node.name;
}

/** Whether to tag a JSX element. Host tags are lowercase identifiers; components are capitalised or `a.B`. */
function shouldTag(name: JSXOpeningElement['name'], tagComponents: boolean, skipped: Set<string>): boolean {
  if (name.type === 'JSXNamespacedName') return false;
  if (name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)) return !SKIP_TAGS.has(name.name);
  if (!tagComponents || skipped.has(rootName(name))) return false;
  const last = name.type === 'JSXIdentifier' ? name.name : name.property.name;
  return !SKIP_COMPONENTS.has(last) && !/(Provider|Consumer)$/.test(last);
}

export const TRANSFORM_FILE = /\.[jt]sx$/;

export function shouldTransform(id: string): boolean {
  const file = id.split('?')[0];
  return TRANSFORM_FILE.test(file) && !file.includes('/node_modules/') && !file.includes('\\node_modules\\');
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const c of child) if (isNode(c)) walk(c, visit);
    } else if (isNode(child)) {
      walk(child, visit);
    }
  }
}

/**
 * Add `data-redline-source="file:start-end"` to every JSX host element and, unless
 * `tagComponents` is false, every component element not imported from a skipped package. The attribute goes last, so it
 * overrides one passed in through a spread: the innermost JSX that renders a DOM node wins.
 * Returns null when the file has nothing to tag.
 */
export function transformSource(code: string, id: string, options: TransformOptions): TransformResult | null {
  const filename = id.split('?')[0];
  if (!TRANSFORM_FILE.test(filename)) return null;
  const rel = normalizePath(path.relative(options.root, filename));
  const tagComponents = options.tagComponents ?? true;

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: filename.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'],
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  const skipped = skippedBindings(ast.program, [...SKIP_PACKAGES, ...(options.skipComponentsFrom ?? [])]);
  const s = new MagicString(code);
  let changed = false;

  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement' || !node.loc) return;
    const opening = node.openingElement;
    if (!shouldTag(opening.name, tagComponents, skipped)) return;
    const already = opening.attributes.some(
      (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === SOURCE_ATTR,
    );
    // After the last attribute, else after the tag name and any type arguments (`<Select<T>>`).
    const at = (opening.attributes.at(-1) ?? opening.typeArguments ?? opening.typeParameters ?? opening.name).end;
    if (already || at == null) return;
    const value = formatSource(rel, node.loc.start.line, node.loc.end.line);
    s.appendLeft(at, ` ${SOURCE_ATTR}="${value.replace(/"/g, '&quot;')}"`);
    changed = true;
  });

  if (!changed) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: filename, includeContent: true }) };
}
