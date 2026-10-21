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

/** A page the changed files reach, from `GET /__redline/pages`. */
export interface ChangedPage {
  /** Route pattern, e.g. `/about` or `/blog/[slug]`. */
  route: string;
  /** `removed`: the page file was deleted and the route is gone. */
  status: 'changed' | 'removed';
  /** A URL to open: the route itself when static, else a matching `seeds` entry. Null for removed pages and dynamic routes without a seed. */
  url: string | null;
  /** A dynamic route with no `seeds` entry to link to. */
  needsExample: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  /** Changed or deleted files that lead here, closest first. `depth` is import hops; 0 is the page file. */
  sources: { file: string; depth: number }[];
}

export interface PagesResponse {
  enabled: boolean;
  mode: BaselineMode;
  baselineSha: string | null;
  headSha: string | null;
  /** Changed pages first, the most direct cause first, then removed pages. */
  pages: ChangedPage[];
  /** Changed files no page could be traced to. */
  unplaced: string[];
  /** The result came from the cache for this baseline, head and set of changed files. */
  cached: boolean;
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

export interface RedlineHistoryOptions {
  /** Ready builds kept in `.redline/builds`. Default 5. */
  maxBuilds?: number;
  /** Screenshot each ready build with Playwright, when installed. Default true. */
  thumbnails?: boolean;
  /**
   * Fixtures replayed to History pages by the read-only network layer, served at
   * `/__redline/network/fixtures`. Default `<root>/.redline/network-fixtures.json`.
   */
  networkFixtures?: string;
}

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
  /** Hash of the extra env the build ran with. Absent when there was none. */
  envKey?: string;
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
