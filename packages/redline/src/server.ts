import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { parseUnifiedDiff } from './diff';
import { normalizePath } from './source';
import type { CommitInfo, DiffFile, DiffResponse, StoredBaseline } from './types';

export interface RedlineServerOptions {
  /** Project root. Tagged paths and diff paths are relative to it. */
  root: string;
  /** Where the pinned baseline is stored. Default `<root>/.redline/baseline.json`. */
  baselineFile?: string;
  /** File extensions included in git diffs. */
  extensions?: string[];
  /** When false every endpoint reports `enabled: false`. */
  enabled?: boolean;
}

export const DEFAULT_EXTENSIONS = ['tsx', 'jsx', 'ts', 'js', 'css'];

export interface RedlineResponse {
  status: number;
  body: unknown;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function getHeadSha(root: string): string | null {
  try {
    return git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return null;
  }
}

/** Resolve a ref (SHA, branch, `HEAD~1`) to a full commit SHA, or throw. */
export function resolveCommit(root: string, ref: string): string {
  if (!/^[\w./~^@{}-]+$/.test(ref) || ref.startsWith('-')) throw new Error(`Invalid git ref: ${ref}`);
  try {
    return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`Unknown git commit: ${ref}`);
  }
}

function baselinePath(opts: RedlineServerOptions): string {
  return opts.baselineFile ?? path.join(opts.root, '.redline', 'baseline.json');
}

export function readBaseline(opts: RedlineServerOptions): StoredBaseline | null {
  try {
    const data = JSON.parse(fs.readFileSync(baselinePath(opts), 'utf8')) as StoredBaseline;
    if (data && (data.mode === 'git' || data.mode === 'content') && typeof data.sha === 'string') return data;
  } catch {
    // Missing or unreadable baseline: treat as unpinned.
  }
  return null;
}

export function writeBaseline(opts: RedlineServerOptions, baseline: StoredBaseline): void {
  const file = baselinePath(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
}

export function clearStoredBaseline(opts: RedlineServerOptions): void {
  fs.rmSync(baselinePath(opts), { force: true });
}

export interface PinInput {
  sha?: string;
  files?: Record<string, string>;
  notes?: string;
}

/** Pin a baseline: file contents (content mode), a git ref, or HEAD when neither is given. */
export function pinBaseline(opts: RedlineServerOptions, input: PinInput = {}): StoredBaseline {
  const pinnedAt = new Date().toISOString();
  let baseline: StoredBaseline;
  if (input.files && Object.keys(input.files).length > 0) {
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.files)) files[safeRelative(opts.root, k)] = String(v);
    const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12);
    baseline = { mode: 'content', sha: `content:${hash}`, files, notes: input.notes, pinnedAt };
  } else {
    const sha = resolveCommit(opts.root, input.sha || 'HEAD');
    baseline = { mode: 'git', sha, notes: input.notes, pinnedAt };
  }
  writeBaseline(opts, baseline);
  return baseline;
}

function safeRelative(root: string, p: string): string {
  const rel = normalizePath(path.relative(root, path.resolve(root, p)));
  if (rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) throw new Error(`Path outside project root: ${p}`);
  return rel;
}

function readCurrent(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Diff stored file contents against what is on disk now. */
export function diffContent(root: string, files: Record<string, string>): DiffFile[] {
  let text = '';
  for (const [rel, before] of Object.entries(files)) {
    const after = readCurrent(root, rel);
    if (after === null || after === before) continue;
    text += `diff --git a/${rel} b/${rel}\n`;
    text += createTwoFilesPatch(`a/${rel}`, `b/${rel}`, before, after, undefined, undefined, { context: 3 })
      .split('\n')
      .filter((l) => !l.startsWith('====') && !l.startsWith('Index:'))
      .join('\n');
    text += '\n';
  }
  return parseUnifiedDiff(text);
}

/** Diff the working tree (tracked and untracked files) against a commit. */
export function diffGit(root: string, sha: string, extensions = DEFAULT_EXTENSIONS): DiffFile[] {
  const specs = extensions.map((e) => `*.${e}`);
  const tracked = git(root, ['diff', '--relative', '--no-color', '--no-ext-diff', '-U3', sha, '--', ...specs]);
  const files = parseUnifiedDiff(tracked);

  // Untracked files are new relative to any commit.
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', ...specs])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (untracked.length > 0) {
    const map: Record<string, string> = {};
    for (const rel of untracked) map[normalizePath(rel)] = '';
    files.push(...diffContent(root, map).map((f) => ({ ...f, status: 'added' as const })));
  }
  return files;
}

export function computeDiff(opts: RedlineServerOptions, baselineOverride?: string | null): DiffResponse {
  const enabled = opts.enabled !== false;
  const headSha = getHeadSha(opts.root);
  if (!enabled) return { enabled, mode: 'none', baselineSha: null, headSha, files: [] };

  if (baselineOverride) {
    const sha = resolveCommit(opts.root, baselineOverride);
    return { enabled, mode: 'git', baselineSha: sha, headSha, files: diffGit(opts.root, sha, opts.extensions) };
  }

  const stored = readBaseline(opts);
  if (!stored) return { enabled, mode: 'none', baselineSha: null, headSha, files: [] };
  if (stored.mode === 'content') {
    return { enabled, mode: 'content', baselineSha: stored.sha, headSha, files: diffContent(opts.root, stored.files ?? {}) };
  }
  return { enabled, mode: 'git', baselineSha: stored.sha, headSha, files: diffGit(opts.root, stored.sha, opts.extensions) };
}

export const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_LIMIT = 200;

/** Commits reachable from HEAD, newest first. Read-only: runs `git log`. */
export function getLog(root: string, limit = DEFAULT_LOG_LIMIT): CommitInfo[] {
  if (!getHeadSha(root)) return [];
  const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LOG_LIMIT, 1), MAX_LOG_LIMIT);
  // Unit and record separators keep subjects with any punctuation intact.
  const out = git(root, ['log', `-n${n}`, '--no-color', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e', 'HEAD']);
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [sha, shortSha, subject, author, date] = r.split('\x1f');
      return { sha, shortSha, subject, author, date };
    });
}

/**
 * Contents of a root-relative file at a commit. Read-only: runs `git show <sha>:./<path>`.
 * Only files with a configured extension can be read.
 */
export function readFileAt(opts: RedlineServerOptions, file: string, ref = 'HEAD'): { path: string; ref: string; content: string } {
  const rel = safeRelative(opts.root, file);
  const ext = path.extname(rel).slice(1);
  if (!(opts.extensions ?? DEFAULT_EXTENSIONS).includes(ext)) throw new Error(`File type not allowed: ${file}`);
  const sha = resolveCommit(opts.root, ref);
  try {
    return { path: rel, ref: sha, content: git(opts.root, ['show', `${sha}:./${rel}`]) };
  } catch {
    throw new Error(`File not found at ${sha.slice(0, 7)}: ${rel}`);
  }
}

function publicBaseline(b: StoredBaseline | null) {
  if (!b) return null;
  return { mode: b.mode, sha: b.sha, notes: b.notes, pinnedAt: b.pinnedAt, files: b.files ? Object.keys(b.files) : undefined };
}

/**
 * Framework-agnostic request handler for `/__redline/<action>`.
 * Actions: `diff`, `baseline`, `log`, `file` (GET), `pin`, `clear` (POST).
 * `log` and `file` only read git history; nothing here checks out or resets the working tree.
 */
export function handleRedlineRequest(
  opts: RedlineServerOptions,
  action: string,
  method: string,
  query: URLSearchParams,
  body: unknown,
): RedlineResponse {
  const enabled = opts.enabled !== false;
  try {
    switch (action) {
      case 'diff':
        return { status: 200, body: computeDiff(opts, query.get('baseline')) };
      case 'baseline':
        return {
          status: 200,
          body: { enabled, headSha: getHeadSha(opts.root), baseline: enabled ? publicBaseline(readBaseline(opts)) : null },
        };
      case 'log':
        return {
          status: 200,
          body: {
            enabled,
            headSha: getHeadSha(opts.root),
            commits: enabled ? getLog(opts.root, Number(query.get('limit') ?? DEFAULT_LOG_LIMIT)) : [],
          },
        };
      case 'file': {
        if (!enabled) return { status: 403, body: { enabled, error: 'Redline is disabled' } };
        const file = query.get('path');
        if (!file) return { status: 400, body: { enabled, error: 'Missing path' } };
        return { status: 200, body: { enabled, ...readFileAt(opts, file, query.get('ref') || 'HEAD') } };
      }
      case 'pin': {
        if (method !== 'POST') return { status: 405, body: { error: 'Use POST' } };
        if (!enabled) return { status: 403, body: { enabled, error: 'Redline is disabled' } };
        const input = (body && typeof body === 'object' ? body : {}) as PinInput;
        const baseline = pinBaseline(opts, input);
        return { status: 200, body: { enabled, headSha: getHeadSha(opts.root), baseline: publicBaseline(baseline) } };
      }
      case 'clear':
        if (method !== 'POST' && method !== 'DELETE') return { status: 405, body: { error: 'Use POST' } };
        clearStoredBaseline(opts);
        return { status: 200, body: { enabled, headSha: getHeadSha(opts.root), baseline: null } };
      default:
        return { status: 404, body: { error: `Unknown Redline action: ${action}` } };
    }
  } catch (err) {
    return { status: 400, body: { enabled, error: err instanceof Error ? err.message : String(err) } };
  }
}
