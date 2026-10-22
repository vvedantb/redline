import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachNotes, parsePrNotes, PrBodySource, readNotesFile, type Note } from '../src/notes';
import { computeDiff, pinBaseline } from '../src/server';
import type { DiffFile, DiffHunk } from '../src/types';

const BODY = `Makes the save button stand out.

## Redline notes

- src/components/SaveButton.tsx: The save button is now green and larger.
- \`components/Table.tsx:12-20\`: Rows are taller, so more of the name shows.
* components/Table.tsx: Small clean-ups.
  The table looks the same otherwise.

## Testing

- not/a/note.tsx: this line is in another section.
`;

describe('parsePrNotes', () => {
  it('reads the bullets under "## Redline notes" until the next heading', () => {
    expect(parsePrNotes(BODY)).toEqual([
      { path: 'src/components/SaveButton.tsx', text: 'The save button is now green and larger.', source: 'pr' },
      { path: 'components/Table.tsx', startLine: 12, endLine: 20, text: 'Rows are taller, so more of the name shows.', source: 'pr' },
      { path: 'components/Table.tsx', text: 'Small clean-ups. The table looks the same otherwise.', source: 'pr' },
    ]);
  });

  it('returns nothing without the section, and takes a single line number as a range of one', () => {
    expect(parsePrNotes('## Summary\n- a.tsx: no\n')).toEqual([]);
    expect(parsePrNotes('### redline notes\r\n- a.tsx:7: One line.\r\n')).toEqual([
      { path: 'a.tsx', startLine: 7, endLine: 7, text: 'One line.', source: 'pr' },
    ]);
  });

  it('reads a backtick path with the range outside the backticks', () => {
    expect(parsePrNotes('## Redline notes\n- `src/a.tsx`:12-20: Outside.\n- `src/b.tsx`:4: One line.\n- src/c.tsx:1-2: Bare.\n')).toEqual([
      { path: 'src/a.tsx', startLine: 12, endLine: 20, text: 'Outside.', source: 'pr' },
      { path: 'src/b.tsx', startLine: 4, endLine: 4, text: 'One line.', source: 'pr' },
      { path: 'src/c.tsx', startLine: 1, endLine: 2, text: 'Bare.', source: 'pr' },
    ]);
  });

  it('ignores a "## Redline notes" heading and bullets inside fenced code blocks', () => {
    const quoted = ['Docs example:', '', '```md', '## Redline notes', '', '- src/example.tsx: Example only.', '```', '', '~~~', '## Redline notes', '- src/tilde.tsx: Also an example.', '~~~', ''].join('\n');
    expect(parsePrNotes(quoted)).toEqual([]);
    const real = `${quoted}## Redline notes\n\n\`\`\`\n## Not a heading\n- src/fenced.tsx: Skipped.\n\`\`\`\n- src/real.tsx: Kept.\n`;
    expect(parsePrNotes(real)).toEqual([{ path: 'src/real.tsx', text: 'Kept.', source: 'pr' }]);
  });
});

describe('readNotesFile', () => {
  let dir: string;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-notes-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads "<path>[:start-end]": "note" pairs and skips values that are not text', () => {
    fs.writeFileSync(path.join(dir, 'redline.notes.json'), JSON.stringify({ 'src/Hero.tsx:3-5': 'New headline.', 'src/Stats.tsx': 'Four cards now.', bad: 1 }));
    expect(readNotesFile(dir)).toEqual({
      notes: [
        { path: 'src/Hero.tsx', startLine: 3, endLine: 5, text: 'New headline.', source: 'file' },
        { path: 'src/Stats.tsx', text: 'Four cards now.', source: 'file' },
      ],
    });
  });

  it('treats a missing file as no notes and reports invalid JSON', () => {
    expect(readNotesFile(dir)).toEqual({ notes: [] });
    fs.writeFileSync(path.join(dir, 'redline.notes.json'), '{ nope');
    expect(readNotesFile(dir).error).toMatch(/redline\.notes\.json is not valid JSON/);
  });
});

const hunk = (startLine: number, endLine: number): DiffHunk => ({
  oldStart: startLine,
  oldLines: endLine - startLine + 1,
  newStart: startLine,
  newLines: endLine - startLine + 1,
  startLine,
  endLine,
  changedLines: [startLine],
  deletions: [],
  patch: '@@',
});
const file = (p: string, ...hunks: DiffHunk[]): DiffFile => ({ path: p, oldPath: null, status: 'modified', hunks });
const notesOf = (files: DiffFile[]) => files.map((f) => f.hunks.map((h) => (h.note ? `${h.noteSource}: ${h.note}` : null)));

describe('attachNotes', () => {
  const pr: Note[] = [
    { path: 'src/Table.tsx', startLine: 10, endLine: 20, text: 'Taller rows.', source: 'pr' },
    { path: 'src/Table.tsx', startLine: 30, endLine: 30, text: 'New footer.', source: 'pr' },
    { path: 'src/Table.tsx', text: 'Table tidy-up.', source: 'pr' },
    { path: 'apps/web/src/Nav.tsx', text: 'Nav link renamed.', source: 'pr' },
  ];

  it('gives a hunk every ranged note it overlaps, else the whole-file note', () => {
    const files = [file('src/Table.tsx', hunk(1, 5), hunk(18, 32), hunk(40, 44))];
    expect(notesOf(attachNotes(files, pr, ''))).toEqual([['pr: Table tidy-up.', 'pr: Taller rows.\nNew footer.', 'pr: Table tidy-up.']]);
  });

  it('matches paths relative to the app or to the repository top', () => {
    expect(notesOf(attachNotes([file('src/Nav.tsx', hunk(1, 2))], pr, 'apps/web/'))).toEqual([['pr: Nav link renamed.']]);
    expect(notesOf(attachNotes([file('src/Other.tsx', hunk(1, 2))], pr, 'apps/web/'))).toEqual([[null]]);
  });

  it('prefers the PR description over redline.notes.json, hunk by hunk', () => {
    const fromFile: Note[] = [
      { path: 'src/Table.tsx', text: 'Stale whole-file note.', source: 'file' },
      { path: 'src/Other.tsx', startLine: 1, endLine: 9, text: 'Committed note.', source: 'file' },
    ];
    const files = [file('src/Table.tsx', hunk(18, 22), hunk(40, 44)), file('src/Other.tsx', hunk(2, 3))];
    // The PR covers every Table hunk (ranged or whole-file), so the file only fills in where the PR has nothing.
    expect(notesOf(attachNotes(files, [...fromFile, ...pr], ''))).toEqual([['pr: Taller rows.', 'pr: Table tidy-up.'], ['file: Committed note.']]);
  });
});

describe('PrBodySource', () => {
  it('serves the cached body, refreshes once in the background after the TTL, and never throws', async () => {
    let now = 0;
    const calls: string[] = [];
    let reply: string | Error = 'body one';
    const source = new PrBodySource('/repo', {
      ttlMs: 1000,
      now: () => now,
      run: async (cwd) => {
        calls.push(cwd);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    });
    // The first read starts a lookup and answers null; refresh() waits for that same lookup.
    expect(source.get()).toBeNull();
    await source.refresh();
    expect(source.get()).toBe('body one');
    expect(calls).toEqual(['/repo']);

    reply = new Error('gh: command not found');
    now = 2000;
    expect(source.get()).toBe('body one');
    await source.refresh();
    expect(source.get()).toBeNull();
    // A failure is cached for the TTL too, so a missing gh is not run on every poll.
    now = 2500;
    source.get();
    expect(calls).toHaveLength(2);
  });
});

describe('computeDiff with notes', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-notes-diff-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), 'export const A = () => <h1>Old</h1>;\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'A'], { cwd: root });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('adds notes to hunks and asks for the PR body only when something changed', () => {
    let asked = 0;
    const prBody = () => (asked++, '## Redline notes\n- src/Hero.tsx: The headline is new.\n');
    pinBaseline({ root });
    expect(computeDiff({ root, prBody }).files).toEqual([]);
    expect(asked).toBe(0);

    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), 'export const A = () => <h1>New</h1>;\n');
    const hunks = computeDiff({ root, prBody }).files[0].hunks;
    expect(hunks[0]).toMatchObject({ note: 'The headline is new.', noteSource: 'pr' });
    expect(asked).toBe(1);

    fs.writeFileSync(path.join(root, 'redline.notes.json'), JSON.stringify({ 'src/Hero.tsx:1': 'From the committed file.' }));
    expect(computeDiff({ root, prBody }).files[0].hunks[0]).toMatchObject({ note: 'The headline is new.', noteSource: 'pr' });
    expect(computeDiff({ root, prBody: false }).files[0].hunks[0]).toMatchObject({ note: 'From the committed file.', noteSource: 'file' });
  });
});
