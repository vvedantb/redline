import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/diff';
import { findHunk, matchChangedRegions, type TaggedNode } from '../src/match';
import { parseSource, formatSource } from '../src/source';
import type { DiffFile } from '../src/types';

function file(path: string, hunks: Array<{ start: number; end: number; changed?: number[]; deletions?: number[] }>): DiffFile {
  return {
    path,
    oldPath: path,
    status: 'modified',
    hunks: hunks.map((h) => ({
      oldStart: h.start,
      oldLines: h.end - h.start + 1,
      newStart: h.start,
      newLines: h.end - h.start + 1,
      startLine: h.start,
      endLine: h.end,
      changedLines: h.changed ?? [],
      deletions: h.deletions ?? [],
      patch: `@@ -${h.start} +${h.start} @@`,
    })),
  };
}

const node = (id: string, source: string): TaggedNode<string> => ({ ...parseSource(source)!, ref: id });

// Hero.tsx:  section 3-8 > h1 4-4, p 5-7.   Footer.tsx: footer 2-4 > p 3-3
const nodes = [
  node('section', 'src/Hero.tsx:3-8'),
  node('h1', 'src/Hero.tsx:4-4'),
  node('p', 'src/Hero.tsx:5-7'),
  node('footer', 'src/Footer.tsx:2-4'),
  node('footer-p', 'src/Footer.tsx:3-3'),
];

const refs = (regions: { node: TaggedNode<string> }[]) => regions.map((r) => r.node.ref).sort();

describe('source attribute', () => {
  it('round-trips file and line range', () => {
    expect(parseSource(formatSource('src/a b.tsx', 3, 9))).toEqual({ file: 'src/a b.tsx', startLine: 3, endLine: 9 });
    expect(parseSource('src/x.tsx:7')).toEqual({ file: 'src/x.tsx', startLine: 7, endLine: 7 });
    expect(parseSource('nonsense')).toBeNull();
    expect(parseSource(null)).toBeNull();
  });
});

describe('matchChangedRegions', () => {
  it('maps a changed line to the innermost element containing it', () => {
    expect(refs(matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 1, end: 7, changed: [4] }])]))).toEqual(['h1']);
  });

  it('maps a line inside a multi-line element to that element', () => {
    expect(refs(matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 3, end: 8, changed: [6] }])]))).toEqual(['p']);
  });

  it('falls back to the nearest enclosing parent', () => {
    // Line 8 is the closing </section>; only the section contains it.
    expect(refs(matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 5, end: 8, changed: [8] }])]))).toEqual([
      'section',
    ]);
  });

  it('maps a pure deletion to the element that contains both neighbouring lines', () => {
    // Deleted between line 4 (h1) and 5 (p): the section contains both.
    expect(refs(matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 2, end: 7, deletions: [4] }])]))).toEqual([
      'section',
    ]);
  });

  it('ignores lines outside any tagged element', () => {
    expect(matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 1, end: 3, changed: [1] }])])).toEqual([]);
  });

  it('ignores unchanged files', () => {
    const regions = matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 1, end: 7, changed: [4, 6] }])]);
    expect(refs(regions)).toEqual(['h1', 'p']);
    expect(regions.some((r) => r.node.file === 'src/Footer.tsx')).toBe(false);
  });

  it('returns nothing when the diff is empty', () => {
    expect(matchChangedRegions(nodes, [])).toEqual([]);
  });

  it('returns each node once even when several lines hit it', () => {
    const regions = matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 5, end: 7, changed: [5, 6, 7] }])]);
    expect(refs(regions)).toEqual(['p']);
    expect(regions[0].line).toBe(5);
  });

  it('returns every rendered copy of the same source location', () => {
    const list = [node('li-1', 'src/List.tsx:4-4'), node('li-2', 'src/List.tsx:4-4'), node('ul', 'src/List.tsx:3-5')];
    expect(refs(matchChangedRegions(list, [file('src/List.tsx', [{ start: 4, end: 4, changed: [4] }])]))).toEqual([
      'li-1',
      'li-2',
    ]);
  });

  it('folds children of an entirely new element into that element', () => {
    // Stats.tsx: section 1-9 (unchanged); new card 4-7 with children 5-5 and 6-6.
    const stats = [
      node('section', 'src/Stats.tsx:1-9'),
      node('card', 'src/Stats.tsx:4-7'),
      node('value', 'src/Stats.tsx:5-5'),
      node('label', 'src/Stats.tsx:6-6'),
    ];
    const regions = matchChangedRegions(stats, [file('src/Stats.tsx', [{ start: 1, end: 9, changed: [4, 5, 6, 7] }])]);
    expect(refs(regions)).toEqual(['card']);
  });

  it('keeps a modified child inside a partly changed parent', () => {
    const regions = matchChangedRegions(nodes, [file('src/Hero.tsx', [{ start: 1, end: 8, changed: [3, 4] }])]);
    expect(refs(regions)).toEqual(['h1', 'section']);
  });

  it('attaches the hunk that produced the match', () => {
    const diff = [file('src/Hero.tsx', [{ start: 1, end: 4, changed: [4] }, { start: 6, end: 7, changed: [6] }])];
    const regions = matchChangedRegions(nodes, diff);
    const p = regions.find((r) => r.node.ref === 'p')!;
    expect(p.hunk.startLine).toBe(6);
  });

  it('skips deleted files', () => {
    const deleted = { ...file('src/Hero.tsx', [{ start: 1, end: 7, changed: [4] }]), status: 'deleted' as const };
    expect(matchChangedRegions(nodes, [deleted])).toEqual([]);
  });

  it('works end to end from a parsed git diff', () => {
    const text = `diff --git a/src/Hero.tsx b/src/Hero.tsx
--- a/src/Hero.tsx
+++ b/src/Hero.tsx
@@ -2,5 +2,5 @@ export function Hero() {
   return (
     <section>
-      <h1>Welcome</h1>
+      <h1>Ship it</h1>
       <p>
         text
`;
    expect(refs(matchChangedRegions(nodes, parseUnifiedDiff(text)))).toEqual(['h1']);
  });
});

describe('findHunk', () => {
  const diff = [file('src/Hero.tsx', [{ start: 1, end: 4 }, { start: 10, end: 12 }])];
  it('finds the hunk covering a line', () => {
    expect(findHunk(diff, 'src/Hero.tsx', 11)?.startLine).toBe(10);
  });
  it('returns null outside hunks or for unknown files', () => {
    expect(findHunk(diff, 'src/Hero.tsx', 7)).toBeNull();
    expect(findHunk(diff, 'src/Nope.tsx', 1)).toBeNull();
  });
});
