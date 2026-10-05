// Scenarios adapted from pre-post's routes-coverage and routes-repo tests
// (https://github.com/juangadm/pre-post), MIT License, Copyright (c) 2026 Juan Gabriel Delgado.
// See THIRD_PARTY_NOTICES.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { affectedRoutes, frameworkForRoot, isDynamicRoute } from '../../src/routes/affected';

const STATIC = ['/', '/about', '/colophon', '/faq', '/projects', '/work', '/writing'];
let head: string;
let base: string;

function put(root: string, rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function site(root: string): void {
  put(root, 'package.json', JSON.stringify({ dependencies: { next: '16' } }));
  put(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } }));
  put(root, 'tailwind.config.ts', 'export default {};');
  put(root, 'app/globals.css', 'body { font-size: 14px; }');
  put(root, 'app/layout.tsx', "import './globals.css';\nimport { Nav } from '@/components/Nav';\nexport default ({ children }) => <><Nav/>{children}</>;");
  put(root, 'components/Nav.tsx', 'export const Nav = () => <nav/>;');
  put(root, 'components/Card.module.css', '.card { padding: 4px; }');
  put(root, 'components/Card.tsx', "import styles from './Card.module.css';\nexport const Card = () => <div className={styles.card}/>;");
  put(root, 'components/Button.tsx', 'export const Button = () => null;');
  put(root, 'app/page.tsx', "import { Card } from '@/components/Card';\nexport default () => <Card/>;");
  for (const r of STATIC.slice(1)) put(root, `app${r}/page.tsx`, 'export default () => null;');
  put(root, 'app/writing/layout.tsx', 'export default ({ children }) => children;');
  put(root, 'app/writing/[slug]/page.tsx', 'export default () => null;');
}

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-affected-base-')));
  head = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-affected-head-')));
  site(base);
  site(head);
  put(base, 'app/old/page.tsx', "import { Button } from '@/components/Button';\nexport default () => <Button/>;");
  put(base, 'components/Legacy.tsx', 'export const Legacy = () => null;');
  put(base, 'app/faq/page.tsx', "import { Legacy } from '@/components/Legacy';\nexport default () => <Legacy/>;");
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(head, { recursive: true, force: true });
});

const routesOf = (changedFiles: string[], extra: object = {}) => affectedRoutes({ root: head, changedFiles, ...extra });
const paths = (r: { route: string }[]) => r.map((x) => x.route).sort();

describe('affectedRoutes', () => {
  it('detects the framework', () => {
    expect(frameworkForRoot(head)).toBe('nextjs-app');
    expect(routesOf([]).known).toEqual(expect.arrayContaining(['/', '/about', '/writing/[slug]']));
  });

  it('carries a global stylesheet through the root layout to every page', () => {
    const result = routesOf(['app/globals.css']);
    expect(paths(result.routes)).toEqual([...STATIC, '/writing/[slug]'].sort());
    expect(result.routes.find((r) => r.route === '/about')?.sources).toEqual([{ file: 'app/globals.css', depth: 2 }]);
  });

  it('reaches every page from a component only the layout imports', () => {
    expect(paths(routesOf(['components/Nav.tsx']).routes)).toEqual([...STATIC, '/writing/[slug]'].sort());
  });

  it('limits a nested layout to its own folder', () => {
    expect(paths(routesOf(['app/writing/layout.tsx']).routes)).toEqual(['/writing', '/writing/[slug]']);
  });

  it('treats a CSS module as part of the component that imports it', () => {
    const result = routesOf(['components/Card.module.css']);
    expect(paths(result.routes)).toEqual(['/']);
    expect(result.routes[0].confidence).toBe('medium');
  });

  it('treats style tooling config as affecting every page', () => {
    expect(routesOf(['tailwind.config.ts']).routes).toHaveLength(STATIC.length + 1);
  });

  it('collects every changed file that reaches a route, closest first', () => {
    const result = routesOf(['components/Card.tsx', 'app/page.tsx']);
    expect(result.routes.find((r) => r.route === '/')).toMatchObject({
      confidence: 'high',
      sources: [{ file: 'app/page.tsx', depth: 0 }, { file: 'components/Card.tsx', depth: 1 }],
    });
  });

  it('reports files nothing reaches as unplaced', () => {
    const result = routesOf(['README.md', 'components/Button.tsx']);
    expect(result.routes).toEqual([]);
    expect(result.unplaced).toEqual(['README.md', 'components/Button.tsx']);
  });

  it('maps a deleted page to removed, with or without the base tree', () => {
    for (const extra of [{ baseRoot: base }, {}]) {
      const result = routesOf([], { deletedFiles: ['app/old/page.tsx'], ...extra });
      expect(result.removed).toMatchObject([{ route: '/old', reason: 'Page file deleted' }]);
      expect(result.routes).toEqual([]);
    }
  });

  it('traces a deleted component through the base import graph', () => {
    const result = routesOf(['app/faq/page.tsx'], { deletedFiles: ['components/Legacy.tsx'], baseRoot: base });
    expect(result.routes.find((r) => r.route === '/faq')?.sources.map((s) => s.file)).toEqual(['app/faq/page.tsx', 'components/Legacy.tsx']);
    expect(result.removed).toEqual([]);
  });

  it('surfaces the file and depth caps', () => {
    expect(routesOf(['app/globals.css']).limits).toMatchObject({ filesCapped: false, depthCapped: false });
    expect(routesOf(['app/globals.css'], { maxDepth: 1 }).limits.depthCapped).toBe(true);
    expect(routesOf(['app/globals.css'], { maxFiles: 3 }).limits.filesCapped).toBe(true);
  });
});

describe('isDynamicRoute', () => {
  it('recognizes bracket, colon, and splat segments', () => {
    expect(isDynamicRoute('/blog/[slug]')).toBe(true);
    expect(isDynamicRoute('/users/:id')).toBe(true);
    expect(isDynamicRoute('/files/*')).toBe(true);
    expect(isDynamicRoute('/about')).toBe(false);
  });
});
