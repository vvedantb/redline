import { describe, expect, it } from 'vitest';
import { parseCli } from '../src/cli';
import { renderIndex, renderPage, type Report } from '../src/compare/report';
import { highlightLine } from '../src/compare/syntax';
import { parseUnifiedDiff } from '../src/diff';

const text = `diff --git a/src/Button.tsx b/src/Button.tsx
index 1..2 100644
--- a/src/Button.tsx
+++ b/src/Button.tsx
@@ -1,3 +1,3 @@
 import x from './x';
-const a = 'blue'; // old
+const a = 'red'; // new
 export default a;
`;

const files = parseUnifiedDiff(text);
const report: Report = {
  version: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  framework: 'vite',
  base: { ref: 'HEAD~1', sha: 'a'.repeat(40), subject: 'Before' },
  head: { ref: 'HEAD', sha: 'b'.repeat(40), subject: 'After' },
  pages: [{ id: 0, path: '/', pattern: '/', status: 'changed', reason: '1 area changed', suspects: [], before: { image: 'images/0-before.png', width: 1000, height: 1000, status: 200 }, after: { image: 'images/0-after.png', width: 1000, height: 1000, status: 200 }, regions: [], changedRatio: 0.1, errors: [],
    jev: { changed: 0.9, choice: { file: 'src/Button.tsx', confidence: 0.8 }, boxes: [{ x: 100, y: 200, width: 300, height: 100, confidence: 0.7, label: 'largest', file: 'src/Button.tsx' }], cached: false } }],
  summary: { broken: 0, changed: 1, added: 0, removed: 0, skipped: 0, unchanged: 0 },
  notices: [],
  changedFiles: ['src/Button.tsx'],
  deletedFiles: [],
  fileDiffs: files.map((f) => ({ path: f.path, oldPath: f.oldPath, status: f.status, patch: '', hunks: f.hunks })),
  routeChanges: {
    added: [{ path: '/new', pattern: '/new', pageId: null, files: ['src/Button.tsx'], kind: 'page' }],
    changed: [{ path: '/', pattern: '/', pageId: 0, files: ['src/Button.tsx'], kind: 'import' }],
    removed: [{ path: '/old', pattern: '/old', pageId: null, files: [], kind: 'page' }],
  },
};

describe('report diff view', () => {
  const html = renderIndex(report);

  it('lists route changes before the page cards', () => {
    expect(html).toContain('Route changes');
    expect(html.indexOf('Route changes')).toBeLessThan(html.indexOf('class="grid"'));
    expect(html).toContain('Added');
    expect(html).toContain('Removed');
    expect(html).toContain('href="pages/0.html"');
    expect(html).toContain('href="#diff-src-Button-tsx"');
  });

  it('renders unified and split tables with highlighted tokens and a toggle', () => {
    expect(html).toContain('id="diff-src-Button-tsx"');
    expect(html).toContain('class="diff diff-unified"');
    expect(html).toContain('class="diff diff-split"');
    expect(html).toContain('data-diffview="split"');
    expect(html).toContain('<span class="tk-k">import</span>');
    expect(html).toContain('<span class="tk-s">&#39;red&#39;</span>');
    expect(html).toContain('class="cd add"');
    expect(html).toContain('class="cd del"');
  });

  it('draws Jev boxes on the after screenshot, linked to the file diff', () => {
    const page = renderPage(report, report.pages[0]);
    expect(page).toContain('class="box jev"');
    expect(page).toContain('href="../index.html#diff-src-Button-tsx"');
    expect(page).toContain('left:10%;top:20%;width:30%;height:10%');
  });
});

describe('highlightLine', () => {
  it('escapes HTML and tokenises comments, strings and numbers', () => {
    expect(highlightLine('a < 1 // <b>', 'js')).toBe('a &#60; <span class="tk-n">1</span> <span class="tk-c">// &#60;b&#62;</span>');
    expect(highlightLine('<x>', null)).toBe('&#60;x&#62;');
  });
});

describe('parseCli snapshot and restore', () => {
  it('parses snapshot options', () => {
    expect(parseCli(['snapshot'])).toEqual({ command: 'snapshot', options: { root: undefined, out: undefined } });
    const p = parseCli(['snapshot', '--root', '/app', '--out', '/tmp/s.zip']);
    expect(p).toEqual({ command: 'snapshot', options: { root: '/app', out: '/tmp/s.zip' } });
  });

  it('parses restore and requires a file', () => {
    expect(parseCli(['restore', '--root', '/app', '/tmp/s.zip', '--replace'])).toEqual({ command: 'restore', options: { root: '/app', file: '/tmp/s.zip', replace: true } });
    expect(() => parseCli(['restore'])).toThrow('snapshot file');
  });

  it('still parses compare', () => {
    expect(parseCli(['compare', 'a', 'b']).command).toBe('compare');
    expect(() => parseCli(['nope'])).toThrow('Unknown command');
  });
});
