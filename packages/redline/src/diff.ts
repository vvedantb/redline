import type { DiffFile, DiffHunk } from './types';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function cleanPath(raw: string): string | null {
  const p = raw.split('\t')[0].trim().replace(/^"(.*)"$/, '$1');
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/**
 * Parse a unified diff (as produced by `git diff` or jsdiff) into files and hunks.
 * Hunk line numbers refer to the new (current) file.
 */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let body: string[] = [];
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;
  // Removed lines not yet paired with an added line.
  let pendingRemoval = false;

  const closeHunk = () => {
    if (file && hunk) {
      if (pendingRemoval) hunk.deletions.push(newLine - 1);
      hunk.patch = body.join('\n');
      hunk.changedLines = [...new Set(hunk.changedLines)].sort((a, b) => a - b);
      hunk.deletions = [...new Set(hunk.deletions)].sort((a, b) => a - b);
      file.hunks.push(hunk);
    }
    hunk = null;
    body = [];
    pendingRemoval = false;
  };

  const startFile = (): DiffFile => {
    closeHunk();
    const next: DiffFile = { path: '', oldPath: null, status: 'modified', hunks: [] };
    files.push(next);
    return next;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inside a hunk body: consume lines until both sides are exhausted.
    if (hunk && (oldLeft > 0 || newLeft > 0 || line.startsWith('\\'))) {
      const h: DiffHunk = hunk;
      const tag = line[0];
      if (tag === '+') {
        h.changedLines.push(newLine);
        newLine++;
        newLeft--;
        pendingRemoval = false;
      } else if (tag === '-') {
        oldLeft--;
        pendingRemoval = true;
      } else if (tag === ' ' || line === '') {
        if (pendingRemoval) h.deletions.push(newLine - 1);
        pendingRemoval = false;
        newLine++;
        oldLeft--;
        newLeft--;
      } else if (tag !== '\\') {
        closeHunk();
        i--;
        continue;
      }
      body.push(line);
      continue;
    }

    if (line.startsWith('diff --git ')) {
      file = startFile();
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m) {
        file.oldPath = m[1];
        file.path = m[2];
      }
      continue;
    }

    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      if (!file || file.hunks.length > 0 || hunk) file = startFile();
      const oldPath = cleanPath(line.slice(4));
      const newPath = cleanPath(lines[i + 1].slice(4));
      file.oldPath = oldPath;
      file.path = newPath ?? oldPath ?? file.path;
      if (oldPath === null) file.status = 'added';
      else if (newPath === null) file.status = 'deleted';
      else if (oldPath !== newPath) file.status = 'renamed';
      i++;
      continue;
    }

    if (!file) continue;

    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename to ')) {
      file.status = 'renamed';
      file.path = line.slice('rename to '.length);
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      closeHunk();
      const oldStart = Number(header[1]);
      const oldLines = header[2] === undefined ? 1 : Number(header[2]);
      const newStart = Number(header[3]);
      const newLines = header[4] === undefined ? 1 : Number(header[4]);
      // With zero new lines, git reports the line *before* the removal as newStart.
      newLine = newLines === 0 ? newStart + 1 : newStart;
      oldLeft = oldLines;
      newLeft = newLines;
      hunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        startLine: newLines === 0 ? Math.max(newStart, 1) : newStart,
        endLine: newLines === 0 ? Math.max(newStart, 1) : newStart + newLines - 1,
        changedLines: [],
        deletions: [],
        patch: '',
      };
      body = [line];
    }
  }
  closeHunk();

  return files.filter((f) => f.path && f.hunks.length > 0);
}
