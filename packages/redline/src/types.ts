export interface DiffHunk {
  /** First line of the hunk in the old (baseline) file. */
  oldStart: number;
  oldLines: number;
  /** First line of the hunk in the new (current) file. */
  newStart: number;
  newLines: number;
  /** Inclusive new-file line range covered by the hunk. */
  startLine: number;
  endLine: number;
  /** New-file line numbers that were added or modified. */
  changedLines: number[];
  /**
   * Positions where lines were removed with nothing added in their place.
   * A value of `n` means "between new-file line n and n + 1".
   */
  deletions: number[];
  /** Hunk text, starting with the `@@` header. */
  patch: string;
}

export interface DiffFile {
  /** Path relative to the project root, using forward slashes. */
  path: string;
  oldPath: string | null;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
}

export type BaselineMode = 'git' | 'content' | 'none';

export interface DiffResponse {
  enabled: boolean;
  mode: BaselineMode;
  baselineSha: string | null;
  headSha: string | null;
  files: DiffFile[];
  error?: string;
}

export interface StoredBaseline {
  mode: 'git' | 'content';
  /** Git SHA for git mode, `content:<hash>` for content mode. */
  sha: string;
  /** Baseline file contents keyed by root-relative path (content mode only). */
  files?: Record<string, string>;
  notes?: string;
  pinnedAt: string;
}

export interface SourceLocation {
  file: string;
  startLine: number;
  endLine: number;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** ISO 8601 author date. */
  date: string;
}

export interface LogResponse {
  enabled: boolean;
  headSha: string | null;
  commits: CommitInfo[];
}

export type BuildFramework = 'vite' | 'next';

/** Build job lifecycle: `queued` → `building` → `ready` or `failed`. */
export type BuildStatus = 'queued' | 'building' | 'ready' | 'failed';

/** Written to `.redline/builds/<sha>/meta.json`. */
export interface BuildMeta {
  sha: string;
  shortSha: string;
  status: BuildStatus;
  framework: BuildFramework;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Where the build is served, e.g. `/__redline/h/<sha>/`. */
  basePath: string;
  error?: string;
}

export interface BuildJob extends BuildMeta {
  /** Last lines of `build.log` while building or after a failure. */
  logTail?: string[];
  /** `pending` while Playwright captures `.redline/snapshots/<sha>/thumb.png`, `ready` once it exists. */
  thumbnail: 'none' | 'pending' | 'ready';
}

export interface BuildListResponse {
  enabled: boolean;
  builds: BuildJob[];
}

export interface BuildResponse {
  enabled: boolean;
  build: BuildJob | null;
}
