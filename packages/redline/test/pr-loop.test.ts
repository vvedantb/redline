import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli';
import type { PageCapture } from '../src/compare/capture';
import { loginKey, readCachedCapture, type LoginHook, scopeToAffected, writeCachedCapture } from '../src/compare/compare';
import { isOnlyShared } from '../src/compare/groups';
import type { Report, ReportPage } from '../src/compare/report';
import { PNG } from 'pngjs';
import { diffImages, dropLoadNoise, dropShifted } from '../src/compare/pixels';
import { code, renderSummary, SUMMARY_MARKER } from '../src/compare/summary';
import { postPrComment, type GhRunner } from '../src/github';

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

  it('puts paths, files and SHAs in code spans without escaping', () => {
    const p = page(0, '/app/_components/price_card', 'changed', { suspects: [{ file: 'app/_components/price_card.tsx', depth: 0 }] });
    const md = renderSummary(report([p]));
    expect(md).toContain('- `/app/_components/price_card` — Changed, 1 area changed — likely from `app/_components/price_card.tsx`');
    expect(md).toContain('`aaaaaaa` Base → `bbbbbbb` Fix \\*bold\\* \\| pipes');
    expect(md).not.toContain('\\_');
  });

  it('fences code spans longer than any backtick run in them', () => {
    expect(code('a_b\\c')).toBe('`a_b\\c`');
    expect(code('a`b')).toBe('``a`b``');
    expect(code('a``b`c')).toBe('```a``b`c```');
    expect(code('`a')).toBe('`` `a ``');
    expect(code(' a ')).toBe('`  a  `');
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
  it('drops a region whose pixels only moved by a pixel, keeps a real change', () => {
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

/** A white 200x120 image; `paint` gets a setter for one pixel's gray level. */
function image(paint: (set: (x: number, y: number, v: number) => void) => void): Buffer {
  const img = new PNG({ width: 200, height: 120 });
  img.data.fill(255);
  paint((x, y, v) => img.data.fill(v, (y * 200 + x) * 4, (y * 200 + x) * 4 + 3));
  return PNG.sync.write(img);
}

/** A card with a 1px border at (20, 20), 24px padding, a dark bar as content and `top` px padding on top. */
const card = (top: number) => image((set) => {
  const w = 2 * 24 + 60;
  const h = top + 24 + 12;
  for (let x = 20; x < 20 + w; x++) [20, 20 + h - 1].forEach((y) => set(x, y, 180));
  for (let y = 20; y < 20 + h; y++) [20, 20 + w - 1].forEach((x) => set(x, y, 180));
  for (let y = 0; y < 12; y++) for (let x = 0; x < 60; x++) set(21 + 24 + x, 21 + top + y, 30);
});

/** Anti-aliased "text": glyph strokes placed `offset` px to the right, edges blended for fractions. */
const text = (offset: number) => image((set) => {
  for (let g = 0; g < 8; g++) {
    const x0 = 40 + g * 9 + offset;
    for (let y = 50; y < 62; y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x0 + 3); x++) {
        const cover = Math.max(0, Math.min(x + 1, x0 + 3) - Math.max(x, x0));
        set(x, y, Math.round(255 - cover * 225));
      }
    }
  }
});

describe('dropLoadNoise', () => {
  it('keeps a deterministic 2px padding change on a bordered card', () => {
    const [before, after] = [card(24), card(26)];
    const { regions } = diffImages(before, after);
    expect(regions.length).toBeGreaterThan(0);
    // The content and bottom border only moved down, so a shift check alone would hide it.
    expect(dropShifted(before, after, regions)).toEqual([]);
    // The second load of head renders the same as the first.
    expect(dropLoadNoise(before, after, card(26), regions)).toEqual(regions);
  });

  it('keeps a deterministic 1px padding change too', () => {
    const [before, after] = [card(24), card(25)];
    const { regions } = diffImages(before, after);
    expect(regions.length).toBeGreaterThan(0);
    expect(dropShifted(before, after, regions)).toEqual([]);
    expect(dropLoadNoise(before, after, card(25), regions)).toEqual(regions);
  });

  it('drops sub-pixel text jitter between loads', () => {
    const [before, after] = [text(0), text(1)];
    const { regions } = diffImages(before, after);
    expect(regions.length).toBeGreaterThan(0);
    expect(dropShifted(before, after, regions)).toEqual([]);
    // The second load of head lands where base did, or somewhere else again.
    expect(dropLoadNoise(before, after, text(0), regions)).toEqual([]);
    expect(dropLoadNoise(before, after, text(2), regions)).toEqual([]);
  });

  it('keeps every region without a settled second load, and drops areas the second load changes', () => {
    const [before, after] = [card(24), card(26)];
    const { regions } = diffImages(before, after);
    expect(dropLoadNoise(before, after, null, regions)).toEqual(regions);
    expect(dropLoadNoise(before, after, card(30), regions)).toEqual([]);
  });
});

describe('postPrComment', () => {
  const comments = [
    { id: 1, user: { login: 'someone-else' }, body: `${SUMMARY_MARKER}\nold` },
    { id: 2, user: { login: 'redline-bot' }, body: `${SUMMARY_MARKER}\nmine` },
    { id: 3, user: { login: 'redline-bot' }, body: 'unrelated' },
  ];
  /** A fake `gh` that applies the comment filter's author and marker checks to `list`. */
  const fakeGh = (login: string | null, list = comments) => {
    const calls: string[][] = [];
    const run: GhRunner = (args) => {
      calls.push(args);
      if (args[1] === 'user') {
        if (login === null) throw new Error('gh api user failed: Resource not accessible by integration');
        return login;
      }
      if (args.includes('--paginate')) {
        const jq = args[args.length - 1];
        const author = /\.user\.login == "([^"]+)"/.exec(jq)?.[1];
        return list.filter((c) => c.user.login === author && c.body.startsWith(SUMMARY_MARKER)).map((c) => c.id).join('\n');
      }
      return `https://github.com/o/r/pull/7#${args[2]}`;
    };
    return { run, calls };
  };

  it('updates only a marked comment written by the current gh user', () => {
    const { run, calls } = fakeGh('redline-bot');
    postPrComment('7', 'body', '/tmp', run);
    expect(calls.at(-1)?.slice(0, 4)).toEqual(['api', '-X', 'PATCH', 'repos/{owner}/{repo}/issues/comments/2']);
  });

  it('posts a new comment when the only marked comment is someone else\'s', () => {
    const { run, calls } = fakeGh('another-user');
    postPrComment('7', 'body', '/tmp', run);
    expect(calls.at(-1)?.slice(0, 4)).toEqual(['api', '-X', 'POST', 'repos/{owner}/{repo}/issues/7/comments']);
  });

  it('posts a new comment when the gh user cannot be read', () => {
    const { run, calls } = fakeGh(null);
    postPrComment('7', 'body', '/tmp', run);
    expect(calls.some((c) => c.includes('--paginate'))).toBe(false);
    expect(calls.at(-1)?.[2]).toBe('POST');
  });
});

describe('loginKey', () => {
  it('changes with the login hook or module, and does not hold the source', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-login-'));
    try {
      fs.writeFileSync(path.join(root, 'auth.mjs'), "export default async () => { /* user: admin */ };");
      const admin = loginKey(root, undefined, 'auth.mjs');
      expect(loginKey(root, undefined, 'auth.mjs')).toBe(admin);
      fs.writeFileSync(path.join(root, 'auth.mjs'), "export default async () => { /* user: viewer */ };");
      expect(loginKey(root, undefined, 'auth.mjs')).not.toBe(admin);

      const asAdmin: LoginHook = async ({ page }) => { await page.fill('#email', 'admin@example.com'); };
      const asViewer: LoginHook = async ({ page }) => { await page.fill('#email', 'viewer@example.com'); };
      expect(loginKey(root, { login: asAdmin }, undefined)).not.toBe(loginKey(root, { login: asViewer }, undefined));
      expect(loginKey(root, undefined, asAdmin)).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
