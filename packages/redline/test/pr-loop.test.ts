import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli';
import type { PageCapture } from '../src/compare/capture';
import { readCachedCapture, scopeToAffected, writeCachedCapture } from '../src/compare/compare';
import { isOnlyShared } from '../src/compare/groups';
import type { Report, ReportPage } from '../src/compare/report';
import { renderSummary, SUMMARY_MARKER } from '../src/compare/summary';

const box = (x: number, y: number) => ({ x, y, width: 10, height: 10, pixels: 50 });
const shot = { image: 'images/x.png', width: 1280, height: 800, status: 200 };
const page = (id: number, path: string, status: ReportPage['status'], extra: Partial<ReportPage> = {}): ReportPage => ({
  id, path, pattern: path, status, reason: status === 'broken' ? 'New error: boom' : '1 area changed', suspects: [], before: shot, after: shot, regions: [box(0, 0)], changedRatio: 0.1, errors: [], ...extra,
});
const report = (pages: ReportPage[], extra: Partial<Report> = {}): Report => ({
  version: 2, createdAt: '', framework: 'vite',
  base: { ref: 'main', sha: 'a'.repeat(40), subject: 'Base' }, head: { ref: 'HEAD', sha: 'b'.repeat(40), subject: 'Fix *bold* | pipes' },
  pages, summary: { broken: 1, changed: 3, added: 0, removed: 0, skipped: 0, unchanged: 0 },
  notices: ['A note'], changedFiles: [], deletedFiles: [], fileDiffs: [], routeChanges: { added: [], changed: [], removed: [] }, ...extra,
});

describe('renderSummary', () => {
  const pages = [
    page(0, '/broken', 'broken'),
    page(1, '/a', 'changed', { shared: [0] }),
    page(2, '/b', 'changed', { shared: [0], regions: [box(0, 0), box(50, 50)], suspects: [{ file: 'src/B.tsx', depth: 0 }] }),
    page(3, '/c', 'changed', { shared: [0] }),
  ];
  const shared = [{ id: 0, regions: [box(0, 0)], pages: [1, 2, 3], suspects: [{ file: 'src/Logo.tsx', depth: 2 }] }];

  it('starts with the marker and lists broken pages, shared changes and pages to review', () => {
    const md = renderSummary(report(pages, { shared }));
    expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(md).toContain('Fix \\*bold\\* \\| pipes');
    expect(md).toContain('| 1 | 3 | 0 | 0 | 0 | 0 |');
    expect(md).toContain('**Looks broken (1)**\n- `/broken`: New error: boom');
    expect(md).toContain('changed on 3 pages, e.g. `/a` — likely from `src/Logo.tsx`');
    // `/b` has a change of its own; `/a` and `/c` are covered by the shared change.
    expect(md).toContain('**Pages to review (1)**\n- `/b` — Changed, 1 area changed — likely from `src/B.tsx`');
    expect(md).toContain('- A note');
  });

  it('links pages into a published report and caps the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => page(i, `/p${i}`, 'changed'));
    const md = renderSummary(report(many), { reportUrl: 'https://ci.example/report/', maxPages: 3 });
    expect(md).toContain('- [`/p0`](https://ci.example/report/pages/0.html)');
    expect(md).toContain('…and 9 more in the report');
    expect(md).toContain('[Full report](https://ci.example/report/index.html)');
  });

  it('says so when nothing changed', () => {
    expect(renderSummary(report([]))).toContain('No page looks different.');
  });
});

describe('isOnlyShared', () => {
  it('is true only when every changed area belongs to the page\'s shared changes', () => {
    const shared = [{ id: 0, regions: [box(0, 0)], pages: [0], suspects: [] }];
    expect(isOnlyShared(shared, { status: 'changed', regions: [box(0, 0)], shared: [0] })).toBe(true);
    expect(isOnlyShared(shared, { status: 'changed', regions: [box(0, 0), box(9, 9)], shared: [0] })).toBe(false);
    expect(isOnlyShared(shared, { status: 'broken', regions: [box(0, 0)], shared: [0] })).toBe(false);
    expect(isOnlyShared(undefined, { status: 'changed', regions: [box(0, 0)] })).toBe(false);
  });
});

describe('scopeToAffected', () => {
  it('keeps pages the changed files reach plus a sample of the rest', () => {
    const r = (p: string, pattern = p) => ({ path: p, pattern, from: ['link' as const] });
    const all = [r('/'), r('/about'), r('/blog/a', '/blog/[slug]'), r('/blog/b', '/blog/[slug]'), r('/pricing'), r('/team')];
    const out = scopeToAffected(all, ['/', '/about', '/blog/[slug]', '/pricing', '/team', '/docs/[id]'], new Set(['/blog/[slug]', '/docs/[id]']), 2);
    expect(out.routes.map((x) => x.path)).toEqual(['/blog/a', '/blog/b', '/', '/about']);
    expect(out.patterns).toEqual(['/blog/[slug]', '/docs/[id]']);
    expect(out).toMatchObject({ sampled: 2, left: 2 });
  });
});

describe('capture cache', () => {
  it('stores a capture by commit, settings key and path, and copies its image back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-cache-'));
    try {
      const png = path.join(root, 'shot.png');
      fs.writeFileSync(png, 'png-bytes');
      const capture: PageCapture = { path: '/a', finalPath: '/a', status: 200, errors: [], consoleErrors: [], appError: false, notFound: false, content: 10, links: ['/b'], blockedWrites: 0, image: png, width: 1280, height: 800 };
      writeCachedCapture(root, 'sha1', 'key1', '/a', capture);
      const out = path.join(root, 'out.png');
      expect(readCachedCapture(root, 'sha1', 'key1', '/a', out)).toEqual({ ...capture, image: out });
      expect(fs.readFileSync(out, 'utf8')).toBe('png-bytes');
      expect(readCachedCapture(root, 'sha1', 'key2', '/a', out)).toBeNull();
      expect(readCachedCapture(root, 'sha2', 'key1', '/a', out)).toBeNull();
      writeCachedCapture(root, 'sha1', 'key1', '/failed', { ...capture, path: '/failed', failed: 'timeout' });
      expect(readCachedCapture(root, 'sha1', 'key1', '/failed', out)).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('parseCli', () => {
  it('parses --affected, --sample, --comment and --report-url', () => {
    expect(parseCli(['compare', '--affected', '--sample', '0', '--comment', 'auto', '--report-url', 'https://x/r'])).toMatchObject({
      options: { scope: 'affected', sample: 0 },
      comment: { pr: 'auto', reportUrl: 'https://x/r' },
    });
    expect(parseCli(['compare', '--comment', '42'])).toMatchObject({ comment: { pr: '42' } });
    expect(() => parseCli(['compare', '--comment', 'main'])).toThrow('--comment');
  });
});

describe('dropShifted', () => {
  it('drops a region whose pixels only moved by a pixel, keeps a real change', async () => {
    const { PNG } = await import('pngjs');
    const { dropShifted } = await import('../src/compare/pixels');
    const draw = (rects: [number, number, number, number][]) => {
      const img = new PNG({ width: 40, height: 20 });
      img.data.fill(255);
      for (const [x0, y0, w, h] of rects) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.fill(0, (y * 40 + x) * 4, (y * 40 + x) * 4 + 3);
      return PNG.sync.write(img);
    };
    const region = { x: 0, y: 0, width: 20, height: 20, pixels: 40 };
    expect(dropShifted(draw([[5, 5, 6, 6]]), draw([[6, 5, 6, 6]]), [region])).toEqual([]);
    expect(dropShifted(draw([[5, 5, 6, 6]]), draw([[5, 5, 10, 10]]), [region])).toEqual([region]);
  });
});
