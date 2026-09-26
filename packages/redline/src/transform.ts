import path from 'node:path';
import { parse } from '@babel/parser';
import type { Node } from '@babel/types';
import MagicString from 'magic-string';
import { SOURCE_ATTR, formatSource, normalizePath } from './source';

export interface TransformOptions {
  /** Project root; tagged paths are relative to it. */
  root: string;
}

export interface TransformResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
}

const SKIP_TAGS = new Set(['html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title', 'template']);

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
 * Add `data-redline-source="file:start-end"` to every JSX host element (lowercase tag).
 * Returns null when the file has nothing to tag.
 */
export function transformSource(code: string, id: string, options: TransformOptions): TransformResult | null {
  const filename = id.split('?')[0];
  if (!TRANSFORM_FILE.test(filename)) return null;
  const rel = normalizePath(path.relative(options.root, filename));

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

  const s = new MagicString(code);
  let changed = false;

  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement' || !node.loc) return;
    const opening = node.openingElement;
    if (opening.name.type !== 'JSXIdentifier') return;
    const tag = opening.name.name;
    if (!/^[a-z]/.test(tag) || SKIP_TAGS.has(tag)) return;
    const already = opening.attributes.some(
      (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === SOURCE_ATTR,
    );
    if (already || opening.name.end == null) return;
    const value = formatSource(rel, node.loc.start.line, node.loc.end.line);
    s.appendLeft(opening.name.end, ` ${SOURCE_ATTR}="${value.replace(/"/g, '&quot;')}"`);
    changed = true;
  });

  if (!changed) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: filename, includeContent: true }) };
}
