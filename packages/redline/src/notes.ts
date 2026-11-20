import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DiffFile } from './types';

/**
 * Plain-English notes for changed code, written by whoever made the change (usually the agent).
 * Two sources: the `## Redline notes` section of the PR description, and a
 * `redline.notes.json` in the app root. The PR wins, because a committed file can outlive the
 * change it describes. Redline never writes notes itself.
 */

export const NOTES_FILE = 'redline.notes.json';

export interface Note {
  /** File the note is about, relative to the app or to the repository top. */
  path: string;
  /** Inclusive new-file line range. Without one, the note covers every hunk in the file. */
  startLine?: number;
  endLine?: number;
  text: string;
  source: 'file' | 'pr';
}

/** `path`, `path:12` or `path:12-20`, as written in a note key. Backticks are dropped, so `` `path`:12 `` works too. */
function parseKey(key: string): Pick<Note, 'path' | 'startLine' | 'endLine'> | null {
  const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(key.trim().replace(/`/g, ''));
  if (!m || !m[1]) return null;
  if (!m[2]) return { path: m[1] };
  const startLine = Number(m[2]);
  return { path: m[1], startLine, endLine: Math.max(startLine, m[3] ? Number(m[3]) : startLine) };
}

const HEADING = /^#{1,6}\s/;
const SECTION = /^#{2,3}\s+redline notes\s*#*\s*$/i;
const BULLET = /^\s*[-*]\s+(.*)$/;
/** Opening or closing code fence. Headings and bullets inside a fence are not read. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
/** Key, then `: ` and the note. The key ends at the first colon that a space follows. A backtick path may have its range outside. */
const ENTRY = /^(`[^`]+`(?::\d+(?:-\d+)?)?|[^\s`][^`]*?):\s+(.+)$/;

/**
 * Notes from a PR description: each bullet under a `## Redline notes` heading, until the next
 * heading. `- path[:start-end]: note`. Indented lines under a bullet continue its note.
 * Fenced code blocks are skipped, so a quoted example is not read as notes.
 */
export function parsePrNotes(body: string): Note[] {
  const notes: Note[] = [];
  let fence: string | null = null;
  let inSection = false;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    if (!inSection) {
      inSection = SECTION.test(line.trim());
      continue;
    }
    if (HEADING.test(line)) break;
    const bullet = BULLET.exec(line);
    if (bullet) {
      const entry = ENTRY.exec(bullet[1].trim());
      const key = entry ? parseKey(entry[1]) : null;
      if (entry && key) notes.push({ ...key, text: entry[2].trim(), source: 'pr' });
      continue;
    }
    const last = notes[notes.length - 1];
    if (last && /^\s+\S/.test(line)) last.text = `${last.text} ${line.trim()}`;
  }
  return notes;
}

/** Notes from `redline.notes.json` in `dir`: `{ "<path>[:start-end]": "note" }`. A missing file has none. */
export function readNotesFile(dir: string): { notes: Note[]; error?: string } {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, NOTES_FILE), 'utf8');
  } catch {
    return { notes: [] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { notes: [], error: `${NOTES_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { notes: [], error: `${NOTES_FILE} must be an object of "path": "note"` };
  const notes: Note[] = [];
  for (const [k, v] of Object.entries(data)) {
    const key = parseKey(k);
    if (key && typeof v === 'string' && v.trim()) notes.push({ ...key, text: v.trim(), source: 'file' });
  }
  return { notes };
}

const overlaps = (note: Note, start: number, end: number) => note.startLine !== undefined && note.endLine !== undefined && note.startLine <= end && note.endLine >= start;

/**
 * Copy `files` with `note` and `noteSource` on each hunk that has one. `prefix` is the app's path
 * from the repository top (`apps/web/`), so notes may use either form. Per hunk, the PR wins
 * over the file source. Within a source, every ranged note the hunk overlaps is used, else the
 * whole-file note.
 */
export function attachNotes(files: DiffFile[], notes: Note[], prefix: string): DiffFile[] {
  if (!notes.length) return files;
  return files.map((f) => {
    const mine = notes.filter((n) => n.path === f.path || n.path === prefix + f.path);
    if (!mine.length) return f;
    return {
      ...f,
      hunks: f.hunks.map((h) => {
        for (const source of ['pr', 'file'] as const) {
          const own = mine.filter((n) => n.source === source);
          const ranged = own.filter((n) => overlaps(n, h.startLine, h.endLine));
          const picked = ranged.length ? ranged : own.filter((n) => n.startLine === undefined).slice(0, 1);
          if (picked.length) return { ...h, note: [...new Set(picked.map((n) => n.text))].join('\n'), noteSource: source };
        }
        return h;
      }),
    };
  });
}

/** Runs `gh pr view` for the current branch. Rejects when gh is missing, signed out or finds no PR. */
export type RunGh = (cwd: string) => Promise<string>;

const runGh: RunGh = (cwd) =>
  new Promise((resolve, reject) => {
    execFile('gh', ['pr', 'view', '--json', 'body', '--jq', '.body'], { cwd, timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });

export const PR_BODY_TTL_MS = 60_000;

/**
 * The current branch's PR description, cached. `get()` never waits: it answers what it has
 * (null at first) and starts one background lookup when the cache is older than the TTL.
 * Failures (no gh, not signed in, no PR) are cached as null for the TTL, without an error.
 */
export class PrBodySource {
  private body: string | null = null;
  private fetchedAt = -Infinity;
  private pending: Promise<void> | null = null;
  private readonly run: RunGh;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly cwd: string,
    options: { run?: RunGh; ttlMs?: number; now?: () => number } = {},
  ) {
    this.run = options.run ?? runGh;
    this.ttlMs = options.ttlMs ?? PR_BODY_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get(): string | null {
    if (this.now() - this.fetchedAt >= this.ttlMs) void this.refresh();
    return this.body;
  }

  /** Look the body up again, or wait for the lookup already running. */
  refresh(): Promise<void> {
    this.pending ??= this.run(this.cwd)
      .then(
        (out) => (this.body = out.trim() || null),
        () => (this.body = null),
      )
      .then(() => {
        this.fetchedAt = this.now();
        this.pending = null;
      });
    return this.pending;
  }
}

const sources = new Map<string, PrBodySource>();

/** One PR body source per project root, shared across requests. */
export function sharedPrBody(root: string): PrBodySource {
  let source = sources.get(root);
  if (!source) sources.set(root, (source = new PrBodySource(root)));
  return source;
}
