import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { affectedRoutes } from '../../src/routes/affected';
import { buildRouteChanges } from '../../src/compare/routechanges';

let root: string;
function put(rel: string, content: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-tanstack-')));
  put('package.json', JSON.stringify({ devDependencies: { vite: '^6' } }));
  put('vite.config.ts', 'export default {}');
  put('src/components/Button.tsx', 'export const Button = () => null;');
  put('src/routes/__root.tsx', 'export const Route = {};');
  put('src/routes/index.tsx', "import { Button } from '../components/Button';\nexport const Route = {};");
  put('src/routes/about.tsx', "import { Button } from '../components/Button';\nexport const Route = {};");
  put('src/routes/posts.$postId.tsx', "import { Button } from '../components/Button';\nexport const Route = {};");
  put('src/routes/settings.profile.tsx', 'export const Route = {};');
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('TanStack file routes', () => {
  it('maps $param and dotted nesting to route patterns', () => {
    const { known } = affectedRoutes({ root, changedFiles: [] });
    expect(known).toEqual(expect.arrayContaining(['/', '/about', '/posts/[postId]', '/settings/profile']));
  });

  it('maps a changed shared component to every route that imports it', () => {
    const { routes } = affectedRoutes({ root, changedFiles: ['src/components/Button.tsx'] });
    expect(routes.map((r) => r.route).sort()).toEqual(['/', '/about', '/posts/[postId]']);
    expect(routes.every((r) => r.sources[0].file === 'src/components/Button.tsx' && r.sources[0].depth === 1)).toBe(true);
  });

  it('sorts routes into added, changed and removed with file links', () => {
    const affected = affectedRoutes({ root, changedFiles: ['src/components/Button.tsx', 'src/routes/settings.profile.tsx'], deletedFiles: ['src/routes/old.tsx'] });
    const pages = [{ id: 0, path: '/about', pattern: '/about' }, { id: 1, path: '/posts/1', pattern: '/posts/[postId]' }];
    const rc = buildRouteChanges({ before: ['/', '/about', '/old'], after: ['/', '/about', '/settings/profile'], affected, pages });
    expect(rc.added.map((r) => r.pattern)).toEqual(['/settings/profile']);
    expect(rc.added[0]).toMatchObject({ kind: 'page', files: ['src/routes/settings.profile.tsx'], pageId: null });
    expect(rc.removed.map((r) => r.pattern)).toEqual(['/old']);
    expect(rc.changed.map((r) => r.pattern)).toEqual(['/', '/about', '/posts/[postId]']);
    expect(rc.changed[1]).toMatchObject({ pageId: 0, kind: 'import', files: ['src/components/Button.tsx'] });
    expect(rc.changed[2]).toMatchObject({ path: '/posts/1', pageId: 1 });
  });
});
