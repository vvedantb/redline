import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/diff';

const GIT_DIFF = `diff --git a/src/Hero.tsx b/src/Hero.tsx
index 1111111..2222222 100644
--- a/src/Hero.tsx
+++ b/src/Hero.tsx
@@ -1,6 +1,7 @@
 export function Hero() {
   return (
     <section>
-      <h1>Welcome</h1>
+      <h1>Ship it</h1>
+      <p>New line</p>
     </section>
   );
 }
@@ -20,4 +21,3 @@ export function Other() {
   return (
     <div>
-      <span>gone</span>
     </div>
diff --git a/src/New.tsx b/src/New.tsx
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/New.tsx
@@ -0,0 +1,2 @@
+export const A = () => <b>a</b>;
+export const B = () => <i>b</i>;
diff --git a/src/Old.tsx b/src/Old.tsx
deleted file mode 100644
index 4444444..0000000
--- a/src/Old.tsx
+++ /dev/null
@@ -1 +0,0 @@
-export const Old = () => null;
`;

describe('parseUnifiedDiff', () => {
  const files = parseUnifiedDiff(GIT_DIFF);

  it('splits files and reads paths and status', () => {
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/Hero.tsx', 'modified'],
      ['src/New.tsx', 'added'],
      ['src/Old.tsx', 'deleted'],
    ]);
  });

  it('reads hunk headers and new-file line ranges', () => {
    const [first, second] = files[0].hunks;
    expect(first).toMatchObject({ oldStart: 1, oldLines: 6, newStart: 1, newLines: 7, startLine: 1, endLine: 7 });
    expect(second).toMatchObject({ oldStart: 20, oldLines: 4, newStart: 21, newLines: 3, startLine: 21, endLine: 23 });
  });

  it('records added lines using new-file numbers', () => {
    expect(files[0].hunks[0].changedLines).toEqual([4, 5]);
    expect(files[0].hunks[0].deletions).toEqual([]);
    expect(files[1].hunks[0].changedLines).toEqual([1, 2]);
  });

  it('records pure deletions as a position between two new-file lines', () => {
    // "<span>gone</span>" was between new lines 22 (<div>) and 23 (</div>).
    expect(files[0].hunks[1].changedLines).toEqual([]);
    expect(files[0].hunks[1].deletions).toEqual([22]);
  });

  it('keeps the patch text starting with the hunk header', () => {
    const patch = files[0].hunks[0].patch;
    expect(patch.split('\n')[0]).toBe('@@ -1,6 +1,7 @@');
    expect(patch).toContain('+      <h1>Ship it</h1>');
    expect(patch).toContain('-      <h1>Welcome</h1>');
  });

  it('does not mistake a removed line starting with "--" for a file header', () => {
    const text = `--- a/x.css\n+++ b/x.css\n@@ -1,2 +1,2 @@\n--- old comment\n+++ new comment\n a {}\n`;
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('x.css');
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0].changedLines).toEqual([1]);
  });

  it('parses jsdiff output without a "diff --git" line', () => {
    const text = `===================================================================\n--- a/a.tsx\n+++ b/a.tsx\n@@ -1,1 +1,1 @@\n-<p>a</p>\n\\ No newline at end of file\n+<p>b</p>\n\\ No newline at end of file\n`;
    const [file] = parseUnifiedDiff(text);
    expect(file.path).toBe('a.tsx');
    expect(file.hunks[0].changedLines).toEqual([1]);
  });

  it('returns nothing for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
