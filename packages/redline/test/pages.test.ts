import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isCurrentPage } from '../src/client/toolbar';
import { matchPattern } from '../src/routes/pattern';
import { handleRedlineRequest, pinBaseline, type RedlineServerOptions } from '../src/server';
import type { ChangedPage, PagesResponse } from '../src/types';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function write(root: string, rel: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

const page = (name: string, imports = '') => `${imports}\nexport default function ${name}() { return <main>${name}</main>; }\n`;
const usesButton = "import Button from '../../components/Button';";

/** A Next.js App Router app: `/`, `/about`, `/blog/[slug]`, `/users/[id]`, `/old`, `/admin`. */
function nextApp(root: string) {
  write(root, 'package.json', JSON.stringify({ dependencies: { next: '16.0.0' } }));
  write(root, 'components/Button.tsx', 'export default function Button() { return <button>Go</button>; }\n');
  write(root, 'app/page.tsx', page('Home'));
  write(root, 'app/about/page.tsx', page('About', "import Button from '../../components/Button';"));
  write(root, 'app/blog/[slug]/page.tsx', page('Post', "import Button from '../../../components/Button';"));
  write(root, 'app/users/[id]/page.tsx', page('User', "import Button from '../../../components/Button';"));
  write(root, 'app/admin/page.tsx', page('Admin', usesButton));
  write(root, 'app/old/page.tsx', page('Old'));
}

const pages = (opts: RedlineServerOptions, query = '') => {
  const res = handleRedlineRequest(opts, 'pages', 'GET', new URLSearchParams(query), {});
  expect(res.status).toBe(200);
  return res.body as PagesResponse;
};

describe('GET /__redline/pages', () => {
  let root: string;
  let base: string;
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-pages-')));
    git(root, 'init', '-q');
    nextApp(root);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'base');
    base = git(root, 'rev-parse', 'HEAD');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('reports no pages before a baseline is pinned', () => {
    expect(pages({ root })).toMatchObject({ enabled: true, mode: 'none', pages: [] });
  });

  it('lists the pages the changed files reach, with links, direct causes first', () => {
    pinBaseline({ root });
    write(root, 'components/Button.tsx', 'export default function Button() { return <button>Go now</button>; }\n');
    write(root, 'app/page.tsx', page('Home2'));
    fs.rmSync(path.join(root, 'app/old'), { recursive: true });
    write(root, 'redline.config.json', JSON.stringify({ seeds: ['/blog/hello?ref=x'], exclude: ['/admin'] }));

    const res = pages({ root });
    expect(res).toMatchObject({ enabled: true, mode: 'git', baselineSha: base, cached: false });
    expect(res.pages.map((p) => [p.route, p.status, p.url, p.needsExample])).toEqual([
      // The page file itself changed: depth 0.
      ['/', 'changed', '/', false],
      // Reached through components/Button.tsx: depth 1, by route.
      ['/about', 'changed', '/about', false],
      ['/blog/[slug]', 'changed', '/blog/hello?ref=x', false],
      ['/users/[id]', 'changed', null, true],
      // Removed pages come last and never link.
      ['/old', 'removed', null, false],
    ]);
    const about = res.pages.find((p) => p.route === '/about')!;
    expect(about.confidence).toBe('medium');
    expect(about.sources).toEqual([{ file: 'components/Button.tsx', depth: 1 }]);
  });

  it('uses the baseline query instead of the pinned baseline', () => {
    write(root, 'app/about/page.tsx', page('About2', usesButton));
    git(root, 'commit', '-qam', 'head');
    pinBaseline({ root });
    expect(pages({ root }).pages).toEqual([]);
    expect(pages({ root }, `baseline=${base}`).pages.map((p) => p.route)).toEqual(['/about']);
  });

  it('caches per baseline, head and changed files, and recomputes when they change', () => {
    pinBaseline({ root });
    write(root, 'app/about/page.tsx', page('About2', usesButton));
    expect(pages({ root }).cached).toBe(false);
    expect(pages({ root })).toMatchObject({ cached: true, pages: [{ route: '/about' }] });
    // Refresh in the panel skips the cache.
    expect(pages({ root }, 'fresh=1').cached).toBe(false);
    write(root, 'app/page.tsx', page('Home2'));
    expect(pages({ root })).toMatchObject({ cached: false, pages: [{ route: '/' }, { route: '/about' }] });
  });

  it('reads routes and config from appDir when the root is the repository top', () => {
    const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-pages-mono-')));
    try {
      git(top, 'init', '-q');
      nextApp(path.join(top, 'apps/web'));
      write(top, 'apps/web/redline.config.json', JSON.stringify({ exclude: ['/about'] }));
      git(top, 'add', '.');
      git(top, 'commit', '-q', '-m', 'base');
      const opts = { root: top, appDir: path.join(top, 'apps/web') };
      pinBaseline(opts);
      write(top, 'apps/web/components/Button.tsx', 'export default function Button() { return <button>Go now</button>; }\n');
      expect(pages(opts).pages.map((p) => p.route)).toEqual(['/admin', '/blog/[slug]', '/users/[id]']);
    } finally {
      fs.rmSync(top, { recursive: true, force: true });
    }
  });

  it('reports disabled', () => {
    expect(pages({ root, enabled: false })).toMatchObject({ enabled: false, pages: [] });
  });
});

describe('isCurrentPage', () => {
  const at = (pathname: string, search = '') => ({ pathname, search });
  const p = (route: string, url: string | null, status: ChangedPage['status'] = 'changed'): ChangedPage => ({
    route,
    url,
    status,
    needsExample: false,
    confidence: 'high',
    reason: '',
    sources: [],
  });

  it('matches the link, ignoring a trailing slash, and its query when it has one', () => {
    expect(isCurrentPage(p('/about', '/about'), at('/about/'))).toBe(true);
    expect(isCurrentPage(p('/blog/[slug]', '/blog/hello?ref=x'), at('/blog/hello', '?ref=x'))).toBe(true);
    expect(isCurrentPage(p('/blog/[slug]', '/blog/hello?ref=x'), at('/blog/hello'))).toBe(false);
    expect(isCurrentPage(p('/about', '/about'), at('/'))).toBe(false);
  });

  it('matches a dynamic route without a link by its pattern, and never a removed page', () => {
    expect(isCurrentPage(p('/users/[id]', null), at('/users/7'))).toBe(true);
    expect(isCurrentPage(p('/old', null, 'removed'), at('/old'))).toBe(false);
  });
});

describe('matchPattern', () => {
  it('lives in a browser-safe module for the overlay', () => {
    expect(matchPattern('/users/[id]', '/users/7')).toBe(true);
    expect(matchPattern('/users/[id]', '/users/7/edit')).toBe(false);
  });
});
