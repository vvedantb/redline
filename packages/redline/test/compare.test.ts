import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli';
import { appPathOf, urlFor, type PageCapture } from '../src/compare/capture';
import { classify, rankPages } from '../src/compare/classify';
import { diffImages, regionsFromMask } from '../src/compare/pixels';
import { renderIndex, renderPage, writeReport, type Report, type ReportPage } from '../src/compare/report';
import { capRoutes, matchPattern, parseSitemap, patternFor, type DiscoveredRoute } from '../src/routes/discover';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-compare-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('matchPattern / patternFor', () => {
  it('matches Next and router-style dynamic segments', () => {
    expect(matchPattern('/blog/[slug]', '/blog/hello')).toBe(true);
    expect(matchPattern('/blog/[slug]', '/blog/a/b')).toBe(false);
    expect(matchPattern('/docs/[...slug]', '/docs/a/b')).toBe(true);
    expect(matchPattern('/docs/[...slug]', '/docs')).toBe(false);
    expect(matchPattern('/shop/[[...slug]]', '/shop')).toBe(true);
    expect(matchPattern('/users/:id', '/users/7')).toBe(true);
    expect(matchPattern('/', '/')).toBe(true);
  });

  it('prefers an exact static route, then the most specific dynamic one', () => {
    const patterns = ['/', '/blog/new', '/blog/[slug]', '/[...all]'];
    expect(patternFor('/blog/new', patterns)).toBe('/blog/new');
    expect(patternFor('/blog/hello', patterns)).toBe('/blog/[slug]');
    expect(patternFor('/x/y', patterns)).toBe('/[...all]');
    expect(patternFor('/x/y', ['/'])).toBeNull();
  });
});

describe('route discovery helpers', () => {
  it('reads sitemap locations under the base path', () => {
    const xml = '<urlset><url><loc>https://example.com/</loc></url><url><loc> https://example.com/about/ </loc></url></urlset>';
    expect(parseSitemap(xml, 'http://127.0.0.1:3000')).toEqual(['/', '/about']);
    const based = '<urlset><url><loc>http://127.0.0.1:1/__redline/h/abc/pricing</loc></url></urlset>';
    expect(parseSitemap(based, 'http://127.0.0.1:1/__redline/h/abc')).toEqual(['/pricing']);
  });

  it('maps hrefs to app paths and drops other origins and files', () => {
    const prefix = 'http://127.0.0.1:4000/__redline/h/abc';
    expect(appPathOf(prefix, '/__redline/h/abc/about?x=1')).toBe('/about');
    expect(appPathOf(prefix, 'http://127.0.0.1:4000/__redline/h/abc')).toBe('/');
    expect(appPathOf(prefix, '/elsewhere')).toBeNull();
    expect(appPathOf(prefix, 'https://example.com/__redline/h/abc/x')).toBeNull();
    expect(appPathOf(prefix, '/__redline/h/abc/report.pdf')).toBeNull();
    expect(urlFor(prefix, '/')).toBe(prefix + '/');
    expect(urlFor(prefix, '/about')).toBe(prefix + '/about');
  });

  it('caps routes with seeds and / first, and lists dynamic routes without an example', () => {
    const r = (p: string, from: DiscoveredRoute['from'] = ['file'], pattern: string | null = p): DiscoveredRoute => ({ path: p, pattern, from });
    const { routes, skipped } = capRoutes([r('/z'), r('/a/b'), r('/'), r('/seeded', ['seed'])], 3, ['/', '/z', '/a/b', '/blog/[slug]']);
    expect(routes.map((x) => x.path)).toEqual(['/seeded', '/', '/z']);
    expect(skipped).toEqual([
      { route: '/a/b', reason: 'over the 3-route limit' },
      { route: '/blog/[slug]', reason: 'needs an example URL' },
    ]);
  });
});

function png(width: number, height: number, paint?: (x: number, y: number) => boolean): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const on = paint?.(x, y) ?? false;
      img.data[i] = on ? 20 : 255;
      img.data[i + 1] = on ? 20 : 255;
      img.data[i + 2] = on ? 200 : 255;
      img.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(img);
}

describe('diffImages', () => {
  it('finds nothing in identical images', () => {
    const a = png(64, 64, (x, y) => x < 10 && y < 10);
    expect(diffImages(a, a)).toMatchObject({ changedPixels: 0, regions: [] });
  });

  it('boxes separate changed areas, top to bottom', () => {
    const a = png(200, 200);
    const b = png(200, 200, (x, y) => (x >= 10 && x < 40 && y >= 120 && y < 140) || (x >= 150 && x < 180 && y >= 20 && y < 50));
    const d = diffImages(a, b);
    expect(d.regions).toHaveLength(2);
    expect(d.regions[0]).toMatchObject({ x: 144, y: 16 });
    expect(d.regions[1]).toMatchObject({ x: 8, y: 120 });
    expect(d.changedPixels).toBe(30 * 20 + 30 * 30);
  });

  it('compares images of different heights on a white canvas', () => {
    const d = diffImages(png(50, 50), png(50, 80, (_x, y) => y >= 60));
    expect(d.height).toBe(80);
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0].y).toBe(56);
  });

  it('drops specks smaller than the minimum area and merges overlapping boxes', () => {
    const w = 100;
    const mask = new Uint8Array(w * w);
    mask[5 * w + 5] = 1;
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) mask[y * w + x] = 1;
    expect(regionsFromMask(mask, w, w)).toEqual([{ x: 40, y: 40, width: 24, height: 24, pixels: 400 }]);
  });
});

const page = (over: Partial<PageCapture> = {}): PageCapture => ({
  path: '/x',
  finalPath: '/x',
  status: 200,
  errors: [],
  consoleErrors: [],
  appError: false,
  notFound: false,
  content: 100,
  links: [],
  ...over,
});
const box = { x: 0, y: 0, width: 10, height: 10, pixels: 50 };

describe('classify', () => {
  const both = { inBase: true, inHead: true, regions: [] };
  it('reports changed and unchanged pages', () => {
    expect(classify({ ...both, before: page(), after: page() }).status).toBe('unchanged');
    expect(classify({ ...both, before: page(), after: page(), regions: [box] })).toEqual({ status: 'changed', reason: '1 area changed' });
  });

  it('flags broken pages: server errors, error screens, new exceptions, blank pages', () => {
    expect(classify({ ...both, before: page(), after: page({ status: 500 }) }).status).toBe('broken');
    expect(classify({ ...both, before: page(), after: page({ appError: true }) }).status).toBe('broken');
    expect(classify({ ...both, before: page(), after: page({ errors: ['boom'] }) })).toEqual({ status: 'broken', reason: 'New error: boom' });
    expect(classify({ ...both, before: page({ errors: ['old'] }), after: page({ errors: ['old'] }) }).status).toBe('unchanged');
    expect(classify({ ...both, before: page(), after: page({ content: 0 }) }).status).toBe('broken');
    expect(classify({ ...both, before: page(), after: page({ notFound: true }) }).status).toBe('broken');
  });

  it('reports new and removed pages', () => {
    expect(classify({ regions: [], inBase: false, inHead: true, before: page({ notFound: true, status: 404 }), after: page() }).status).toBe('added');
    expect(classify({ regions: [], inBase: true, inHead: false, before: page(), after: page({ notFound: true, status: 404 }) }).status).toBe('removed');
    expect(classify({ regions: [], inBase: false, inHead: false, before: page(), after: page({ notFound: true }) }).status).toBe('removed');
  });

  it("can't check pages that fail to load or need sign-in", () => {
    expect(classify({ ...both, before: page(), after: page({ failed: 'timeout' }) }).status).toBe('skipped');
    expect(classify({ ...both, before: page(), after: page({ finalPath: '/login' }) })).toEqual({ status: 'skipped', reason: 'Needs sign-in (redirects to /login)' });
    expect(classify({ ...both, before: page({ notFound: true }), after: page({ notFound: true }) }).status).toBe('skipped');
  });

  it('ranks broken first, then changed pages with a direct cause', () => {
    const p = (path: string, status: ReportPage['status'], depth?: number, changedRatio = 0) => ({ path, status, suspects: depth === undefined ? [] : [{ file: 'f', depth }], changedRatio });
    const ranked = rankPages([p('/u', 'unchanged'), p('/c2', 'changed', 3, 0.5), p('/c1', 'changed', 0, 0.01), p('/b', 'broken'), p('/n', 'added'), p('/c3', 'changed', 3, 0.9)]);
    expect(ranked.map((r) => r.path)).toEqual(['/b', '/c1', '/c3', '/c2', '/n', '/u']);
  });
});

describe('report', () => {
  const pages: ReportPage[] = [
    { id: 0, path: '/', pattern: '/', status: 'changed', reason: '1 area changed', suspects: [{ file: 'components/Button.jsx', depth: 1 }], before: { image: 'images/000-before.png', width: 1280, height: 800, status: 200 }, after: { image: 'images/000-after.png', width: 1280, height: 800, status: 200 }, regions: [{ x: 128, y: 80, width: 64, height: 40, pixels: 900 }], changedRatio: 0.01, errors: [] },
    { id: 1, path: '/pricing', pattern: '/pricing', status: 'added', reason: 'New page', suspects: [], before: null, after: { image: 'images/001-after.png', width: 1280, height: 800, status: 200 }, regions: [], changedRatio: 0, errors: [] },
    { id: 2, path: '/about', pattern: '/about', status: 'unchanged', reason: 'No visible change', suspects: [], before: null, after: null, regions: [], changedRatio: 0, errors: ['<b>bad</b>'] },
  ];
  const report: Report = {
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    framework: 'nextjs-app',
    base: { ref: 'HEAD~1', sha: 'a'.repeat(40), subject: 'Before' },
    head: { ref: 'HEAD', sha: 'b'.repeat(40), subject: 'After <script>' },
    pages,
    summary: { broken: 0, changed: 1, added: 1, removed: 0, skipped: 0, unchanged: 1 },
    notices: ['1 page(s) were not captured'],
    changedFiles: ['components/Button.jsx'],
    deletedFiles: [],
  };

  it('lists pages that need attention and folds unchanged ones away', () => {
    const html = renderIndex(report);
    expect(html).toContain('Changed</span><div class="path">/</div><div class="why">Likely from Button.jsx</div>');
    expect(html).toContain('New</span><div class="path">/pricing</div>');
    expect(html).toContain('<summary>1 unchanged page</summary>');
    expect(html).toContain('1 page(s) were not captured');
    expect(html).not.toContain('<script>');
  });

  it('draws numbered boxes over both sides and offers a slider', () => {
    const html = renderPage(report, pages[0]);
    expect(html).toContain('<div class="box" style="left:10%;top:10%;width:5%;height:5%"><span>1</span></div>');
    expect(html.match(/class="box"/g)).toHaveLength(2);
    expect(html).toContain('data-view="slider"');
    expect(renderPage(report, pages[1])).toContain('This page did not exist before.');
    expect(renderPage(report, pages[1])).not.toContain('data-view="slider"');
    expect(renderPage(report, pages[2])).toContain('&#60;b&#62;bad&#60;/b&#62;');
  });

  it('writes report.json, index.html and one page per entry', () => {
    const out = path.join(tmp, 'report');
    expect(writeReport(report, out)).toBe(path.join(out, 'index.html'));
    expect(JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')).pages).toHaveLength(3);
    expect(fs.readdirSync(path.join(out, 'pages')).sort()).toEqual(['0.html', '1.html', '2.html']);
  });
});

describe('parseCli', () => {
  it('parses compare with refs and options', () => {
    expect(parseCli(['compare', 'main', 'feature', '--max-routes', '5', '--seed', '/a', '--seed', '/b', '--viewport', '390x844', '--chrome', '/bin/chrome'])).toEqual({
      command: 'compare',
      options: { base: 'main', head: 'feature', seeds: ['/a', '/b'], maxRoutes: 5, viewport: { width: 390, height: 844 }, browser: { executablePath: '/bin/chrome' } },
    });
    expect(parseCli(['compare'])).toEqual({ command: 'compare', options: { base: undefined, head: undefined, seeds: undefined } });
  });

  it('shows help and rejects bad input', () => {
    expect(parseCli([])).toEqual({ command: 'help' });
    expect(parseCli(['compare', '--help'])).toEqual({ command: 'help' });
    expect(() => parseCli(['diff'])).toThrow('Unknown command: diff');
    expect(() => parseCli(['compare', '--max-routes', '0'])).toThrow('--max-routes');
    expect(() => parseCli(['compare', '--viewport', 'big'])).toThrow('--viewport');
  });
});
