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

describe('TanStack route modules next to helpers', () => {
  let app: string;
  const route = (id: string) => `import { createFileRoute } from '@tanstack/react-router';\nexport const Route = createFileRoute('${id}')({});`;
  const write = (rel: string, content: string) => {
    const file = path.join(app, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeAll(() => {
    app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-tanstack-helpers-')));
    write('package.json', JSON.stringify({ devDependencies: { vite: '^6' } }));
    write('src/routes/__root.tsx', 'export const Route = createRootRoute({});');
    write('src/routes/index.tsx', route('/'));
    write('src/routes/_app.tsx', route('/_app'));
    write('src/routes/_app/settings.tsx', route('/_app/settings'));
    write('src/routes/_app/projects/$id/route.tsx', route('/_app/projects/$id'));
    write('src/routes/_app/projects/$id/index.lazy.tsx', "export const Route = createLazyFileRoute('/_app/projects/$id/')({});");
    write('src/routes/_app/projects/ProjectPanel.tsx', 'export const ProjectPanel = () => null;');
    write('src/routes/(marketing)/pricing.tsx', route('/pricing'));
    write('src/routes/posts_.$id.edit.tsx', route('/posts_/$id/edit'));
    write('src/routes/_components/Hero.tsx', 'export const Hero = () => null;');
    write('src/routes/-helpers/format.ts', 'export const format = () => "";');
  });

  afterAll(() => fs.rmSync(app, { recursive: true, force: true }));

  it('lists only route modules, with layout and group segments removed', () => {
    const { known } = affectedRoutes({ root: app, changedFiles: [] });
    expect(known.sort()).toEqual(['/', '/posts/[id]/edit', '/pricing', '/projects/[id]', '/settings']);
  });
});

describe('TanStack layouts', () => {
  let app: string;
  const write = (rel: string, content: string) => {
    const file = path.join(app, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeAll(() => {
    app = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-tanstack-layouts-')));
    write('package.json', JSON.stringify({ devDependencies: { vite: '^6' } }));
    write('src/Shell.tsx', 'export const Shell = () => null;');
    write('src/Sidebar.tsx', 'export const Sidebar = () => null;');
    write('src/routes/__root.tsx', "import { Shell } from '../Shell';\nexport const Route = createRootRoute({});");
    write('src/routes/index.tsx', "export const Route = createFileRoute('/')({});");
    write('src/routes/_app.tsx', "import { Sidebar } from '../Sidebar';\nexport const Route = createFileRoute('/_app')({});");
    write('src/routes/_app/settings.tsx', "export const Route = createFileRoute('/_app/settings')({});");
  });

  afterAll(() => fs.rmSync(app, { recursive: true, force: true }));

  it('traces a component in __root to every page', () => {
    const { routes } = affectedRoutes({ root: app, changedFiles: ['src/Shell.tsx'] });
    expect(routes.map((r) => r.route).sort()).toEqual(['/', '/settings']);
  });

  it('traces a component in a layout route to the pages under it', () => {
    const { routes } = affectedRoutes({ root: app, changedFiles: ['src/Sidebar.tsx'] });
    expect(routes.map((r) => r.route)).toEqual(['/settings']);
  });
});
