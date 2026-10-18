import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli';
import { groupSharedChanges, type GroupablePage } from '../src/compare/groups';
import { regionHashes } from '../src/compare/pixels';
import { mapPool } from '../src/compare/pool';
import { renderIndex, type Report, type ReportPage } from '../src/compare/report';
import { capRoutes, deriveExamples, patternFor } from '../src/routes/discover';

describe('mapPool', () => {
  it('runs at most `limit` at once and keeps the order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 5, 15], 2, async (ms, i) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
});

describe('routePath, examples and derived URLs', () => {
  const patterns = ['/', '/[owner]/[repo]', '/[owner]/[repo]/sessions', '/[owner]/[repo]/sessions/[id]', '/[owner]/[repo]/sessions/[id]/review', '/[owner]/[repo]/sessions/[id]/[tab]', '/[owner]/[repo]/settings'];
  // Like eva: `/owner/repo/app/...` matches the route tree as `/owner/repo--app/...`.
  const routePath = (p: string) => p.replace(/^\/([^/]+)\/([^/]+)\/(web)(\/|$)/, '/$1/$2--$3$4');

  it('matches rewritten URLs through routePath', () => {
    expect(patternFor('/acme/app/web/sessions/7', patterns)).toBeNull();
    expect(patternFor('/acme/app/web/sessions/7', patterns, routePath)).toBe('/[owner]/[repo]/sessions/[id]');
  });

  it('derives static sub-pages from a found example, never dynamic ones', () => {
    const derived = deriveExamples(['/', '/acme/app/web/sessions/7'], patterns, routePath);
    expect(Object.fromEntries(derived)).toEqual({ '/[owner]/[repo]/sessions/[id]/review': '/acme/app/web/sessions/7/review' });
    // `/[owner]/[repo]` itself has no example, so `/settings` under it stays uncovered.
    expect(derived.has('/[owner]/[repo]/settings')).toBe(false);
  });

  it('keeps one example per dynamic route besides seeds', () => {
    const r = (path: string, pattern: string | null, from: ('seed' | 'link')[] = ['link']) => ({ path, pattern, from });
    const { routes, skipped } = capRoutes([r('/teams/a', '/teams/[id]'), r('/teams/b', '/teams/[id]'), r('/teams/c', '/teams/[id]', ['seed']), r('/about', '/about')], 10, ['/about', '/teams/[id]', '/blog/[slug]']);
    expect(routes.map((x) => x.path)).toEqual(['/teams/c', '/about', '/teams/a']);
    expect(skipped).toEqual([{ route: '/blog/[slug]', reason: 'needs an example URL' }]);
  });
});

describe('shared changes', () => {
  const box = (x: number, y: number) => ({ x, y, width: 10, height: 10, pixels: 50 });
  const page = (id: number, keys: string[], suspects = [{ file: 'src/Shell.tsx', depth: 2 }]): GroupablePage => ({ id, regions: keys.map((_, i) => box(i * 20, 0)), regionKeys: keys, suspects });

  it('groups the same box and pixels on 3 or more pages, merging boxes with the same pages', () => {
    const pages = [page(0, ['logo', 'nav', 'own0']), page(1, ['logo', 'nav']), page(2, ['logo', 'nav']), page(3, ['nav', 'own3'])];
    const groups = groupSharedChanges(pages);
    expect(groups.map((g) => [g.pages, g.regions.length])).toEqual([[[0, 1, 2, 3], 1], [[0, 1, 2], 1]]);
    expect(groups[0].suspects).toEqual([{ file: 'src/Shell.tsx', depth: 2 }]);
    expect(groupSharedChanges([page(0, ['a', 'b']), page(1, ['a', 'b']), page(2, ['a', 'b'])])).toHaveLength(1);
    expect(groupSharedChanges(pages.slice(0, 2))).toEqual([]);
  });

  it('hashes region pixels, so a different change in the same box is not grouped', () => {
    const png = (shade: number) => {
      const img = new PNG({ width: 20, height: 20 });
      img.data.fill(shade);
      return PNG.sync.write(img);
    };
    const [a] = regionHashes(png(10), [box(0, 0)]);
    expect(regionHashes(png(10), [box(0, 0)])).toEqual([a]);
    expect(regionHashes(png(200), [box(0, 0)])[0]).not.toBe(a);
  });

  it('lists a page whose every change is shared under the group, not in the page grid', () => {
    const shot = { image: 'images/x.png', width: 1280, height: 800, status: 200 };
    const p = (id: number, path: string, regions: ReportPage['regions'], shared?: number[]): ReportPage => ({ id, path, pattern: path, status: 'changed', reason: 'x', suspects: [], before: shot, after: shot, regions, changedRatio: 0.1, errors: [], shared });
    const report: Report = {
      version: 2, createdAt: '', framework: 'vite', base: { ref: 'a', sha: 'a'.repeat(40), subject: 'a' }, head: { ref: 'b', sha: 'b'.repeat(40), subject: 'b' },
      pages: [p(0, '/only-shared', [box(0, 0)], [0]), p(1, '/also-own', [box(0, 0), box(50, 50)], [0]), p(2, '/third', [box(0, 0)], [0])],
      summary: { broken: 0, changed: 3, added: 0, removed: 0, skipped: 0, unchanged: 0 },
      shared: [{ id: 0, regions: [box(0, 0)], pages: [0, 1, 2], suspects: [{ file: 'src/Logo.tsx', depth: 1 }] }],
      notices: [], changedFiles: [], deletedFiles: [], fileDiffs: [], routeChanges: { added: [], changed: [], removed: [] },
    };
    const html = renderIndex(report);
    expect(html).toContain('Same change on 3 pages');
    expect(html).toContain('Likely from src/Logo.tsx');
    const grid = html.slice(html.indexOf('<h2>Pages</h2>'));
    expect(grid).toContain('/also-own');
    expect(grid).not.toContain('pages/0.html');
  });
});

describe('parseCli', () => {
  it('parses --dev and --concurrency', () => {
    expect(parseCli(['compare', '--dev', '--concurrency', '2'])).toMatchObject({ command: 'compare', options: { serve: 'dev', concurrency: 2 } });
    expect(() => parseCli(['compare', '--concurrency', '0'])).toThrow('--concurrency');
  });
});

describe('Convex write guard', () => {
  it('drops mutations and actions, and passes everything else', async () => {
    const vm = await import('node:vm');
    const { CONVEX_WRITE_GUARD } = await import('../src/compare/capture');
    const sent: string[] = [];
    class WebSocket {
      send(data: string) {
        sent.push(data);
      }
    }
    const window: { __redlineBlockedWrites?: number } = {};
    vm.runInNewContext(CONVEX_WRITE_GUARD, { WebSocket, window, JSON });
    const ws = new WebSocket();
    for (const type of ['Connect', 'ModifyQuerySet', 'Mutation', 'Action', 'Authenticate']) ws.send(JSON.stringify({ type }));
    ws.send('not json');
    expect(sent.map((s) => (s.startsWith('{') ? JSON.parse(s).type : s))).toEqual(['Connect', 'ModifyQuerySet', 'Authenticate', 'not json']);
    expect(window.__redlineBlockedWrites).toBe(2);
  });
});
