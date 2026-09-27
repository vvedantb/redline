import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { historyBasePath, isFullSha } from './paths';
import type { BuildFramework, BuildJob, BuildMeta } from './types';

/**
 * Per-commit production builds for the History panel.
 *
 * A job adds a detached worktree under `.redline/worktrees/<sha>`, reuses or installs
 * dependencies, runs `vite build --base /__redline/h/<sha>/` into `.redline/builds/<sha>/dist`,
 * then removes the worktree. The main working tree is never checked out, reset or restored.
 * One build runs at a time.
 */

export interface ExecOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  log: (text: string) => void;
  signal: AbortSignal;
}

/** Runs a command to completion. Rejects on a non-zero exit. Injected in tests. */
export type ExecFn = (cmd: string, args: string[], opts: ExecOptions) => Promise<void>;

/** Writes a thumbnail of the built app to `out`. Resolves false when capture is skipped. */
export type CaptureFn = (input: { dist: string; basePath: string; out: string; log: (text: string) => void }) => Promise<boolean>;

export interface BuildManagerOptions {
  /** Project root. `.redline/` lives here. */
  root: string;
  /** Directory of the Vite config. Builds run from the same place inside the worktree. Default `root`. */
  configDir?: string;
  /** Vite config file, passed to `vite build --config`. */
  configFile?: string;
  framework?: BuildFramework;
  /** Ready builds kept on disk. The least recently viewed is removed first. Default 5. */
  maxReady?: number;
  exec?: ExecFn;
  /** Thumbnail capture after a build is ready. `false` turns it off. Default: Playwright, if installed. */
  capture?: CaptureFn | false;
}

export const DEFAULT_MAX_READY = 5;
const LOG_TAIL_LINES = 12;
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

export interface BuildPaths {
  dir: string;
  dist: string;
  meta: string;
  log: string;
  worktree: string;
  snapshot: string;
  thumbnail: string;
}

/** Disk layout for one commit. `sha` must be a full SHA. */
export function buildPaths(root: string, sha: string): BuildPaths {
  if (!isFullSha(sha)) throw new Error(`Expected a full commit SHA: ${sha}`);
  const base = path.join(root, '.redline');
  const dir = path.join(base, 'builds', sha);
  const snapshot = path.join(base, 'snapshots', sha);
  return {
    dir,
    dist: path.join(dir, 'dist'),
    meta: path.join(dir, 'meta.json'),
    log: path.join(dir, 'build.log'),
    worktree: path.join(base, 'worktrees', sha),
    snapshot,
    thumbnail: path.join(snapshot, 'thumb.png'),
  };
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Map a URL path inside a build to a file under `dist`, or null.
 * Rejects traversal and symlinks that leave `dist`. Paths without an extension fall back
 * to `index.html` so client-side routes work.
 */
export function resolveStaticFile(dist: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const target = path.resolve(dist, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  if (!isInside(dist, target)) return null;
  const candidates = [target, path.join(target, 'index.html')];
  if (!path.extname(target)) candidates.push(path.join(dist, 'index.html'));
  for (const file of candidates) {
    if (!isFile(file)) continue;
    try {
      if (isInside(fs.realpathSync(dist), fs.realpathSync(file))) return file;
    } catch {
      // Vanished between checks.
    }
    return null;
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentType(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Stream a file with its content type. HTML is never cached; hashed assets are immutable per SHA. */
export function sendFile(res: http.ServerResponse, file: string, method = 'GET'): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType(file));
  res.setHeader('Cache-Control', file.endsWith('.html') || file.endsWith('.png') ? 'no-store' : 'public, max-age=31536000, immutable');
  if (method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

/** Read `meta.json`. Returns null when missing or malformed. */
export function readMeta(file: string): BuildMeta | null {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const status = data?.status;
  if (typeof data?.sha !== 'string' || !isFullSha(data.sha)) return null;
  if (status !== 'queued' && status !== 'building' && status !== 'ready' && status !== 'failed') return null;
  const framework: BuildFramework = data.framework === 'next' ? 'next' : 'vite';
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    sha: data.sha,
    shortSha: data.sha.slice(0, 7),
    status,
    framework,
    queuedAt: str(data.queuedAt) ?? str(data.startedAt) ?? new Date(0).toISOString(),
    startedAt: str(data.startedAt),
    finishedAt: str(data.finishedAt),
    basePath: historyBasePath(data.sha),
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
  };
}

export function writeMeta(file: string, meta: BuildMeta): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Last non-empty lines of a log file, without colour codes. */
export function readLogTail(file: string, lines = LOG_TAIL_LINES): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 16 * 1024);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    return buf
      .toString('utf8')
      .replace(ANSI, '')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(-lines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Default `ExecFn`: spawns the command and appends stdout and stderr to the log. */
export const spawnExec: ExecFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      // npm, pnpm and yarn are `.cmd` shims on Windows.
      shell: process.platform === 'win32' && cmd !== process.execPath,
    });
    child.stdout?.setEncoding('utf8').on('data', opts.log);
    child.stderr?.setEncoding('utf8').on('data', opts.log);
    child.on('error', (err) => reject(opts.signal.aborted ? new Error('Cancelled') : err));
    child.on('close', (code) => {
      if (opts.signal.aborted) reject(new Error('Cancelled'));
      else if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} ${args[0] ?? ''} exited with code ${code}`.trim()));
    });
  });

function gitSync(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function hashFile(file: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** Directories from `top` down to `dir`, as paths relative to `top` (`''` is `top`). */
function chain(top: string, dir: string): string[] {
  const parts = path.relative(top, dir).split(path.sep).filter(Boolean);
  return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join(path.sep))];
}

function findLockfile(top: string, dir: string): { rel: string; name: string } | null {
  for (const rel of chain(top, dir).reverse()) {
    const name = LOCKFILES.find((n) => fs.existsSync(path.join(top, rel, n)));
    if (name) return { rel, name };
  }
  return null;
}

function installCommand(lockfile: string): [string, string[]] {
  if (lockfile === 'pnpm-lock.yaml') return ['pnpm', ['install', '--frozen-lockfile']];
  if (lockfile === 'yarn.lock') return ['yarn', ['install']];
  if (lockfile.startsWith('bun.')) return ['bun', ['install']];
  return ['npm', ['ci']];
}

/** `node_modules` holding real packages, not just caches like `.vite`. */
function hasPackages(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((n) => !n.startsWith('.'));
  } catch {
    return false;
  }
}

function viteBin(cwd: string): string {
  const require = createRequire(path.join(cwd, 'package.json'));
  const pkgFile = require.resolve('vite/package.json');
  const bin = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).bin;
  const rel = typeof bin === 'string' ? bin : typeof bin?.vite === 'string' ? bin.vite : 'bin/vite.js';
  return path.join(path.dirname(pkgFile), rel);
}

interface Running {
  sha: string;
  controller: AbortController;
}

export class BuildManager {
  readonly root: string;
  private readonly options: BuildManagerOptions;
  private readonly exec: ExecFn;
  private readonly jobs = new Map<string, BuildMeta>();
  private readonly lastAccess = new Map<string, number>();
  private capturing: string | null = null;
  private queue: string[] = [];
  private running: Running | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(options: BuildManagerOptions) {
    this.options = options;
    this.root = options.root;
    this.exec = options.exec ?? spawnExec;
    this.load();
  }

  /** Read existing builds from disk. Jobs cut short by a restart are marked failed. */
  private load(): void {
    const dir = path.join(this.root, '.redline', 'builds');
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!isFullSha(name)) continue;
      const meta = readMeta(path.join(dir, name, 'meta.json'));
      if (!meta || meta.sha !== name) continue;
      if (meta.status === 'queued' || meta.status === 'building') {
        meta.status = 'failed';
        meta.error = 'Interrupted: the dev server stopped before the build finished.';
        meta.finishedAt = meta.finishedAt ?? new Date().toISOString();
        writeMeta(buildPaths(this.root, name).meta, meta);
      }
      this.jobs.set(name, meta);
    }
  }

  private paths(sha: string): BuildPaths {
    return buildPaths(this.root, sha);
  }

  private save(meta: BuildMeta): void {
    this.jobs.set(meta.sha, meta);
    writeMeta(this.paths(meta.sha).meta, meta);
  }

  private toJob(meta: BuildMeta): BuildJob {
    const p = this.paths(meta.sha);
    const showLog = meta.status === 'building' || meta.status === 'failed';
    const thumbnail = this.capturing === meta.sha ? 'pending' : isFile(p.thumbnail) ? 'ready' : 'none';
    return { ...meta, thumbnail, ...(showLog ? { logTail: readLogTail(p.log) } : {}) };
  }

  get(sha: string): BuildJob | null {
    const meta = this.jobs.get(sha);
    return meta ? this.toJob(meta) : null;
  }

  /** All jobs, newest first. */
  list(): BuildJob[] {
    return [...this.jobs.values()].sort((a, b) => b.queuedAt.localeCompare(a.queuedAt)).map((m) => this.toJob(m));
  }

  /** Queue a build. Returns the existing job unless it failed, in which case it is queued again. */
  enqueue(sha: string): BuildJob {
    const p = this.paths(sha);
    const existing = this.jobs.get(sha);
    if (existing && existing.status !== 'failed') {
      if (existing.status !== 'ready' || isFile(path.join(p.dist, 'index.html'))) return this.toJob(existing);
    }
    fs.rmSync(p.dir, { recursive: true, force: true });
    fs.mkdirSync(p.dir, { recursive: true });
    fs.writeFileSync(p.log, '');
    const meta: BuildMeta = {
      sha,
      shortSha: sha.slice(0, 7),
      status: 'queued',
      framework: this.options.framework ?? 'vite',
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      basePath: historyBasePath(sha),
    };
    this.save(meta);
    this.queue.push(sha);
    this.pump();
    return this.toJob(meta);
  }

  /** Cancel a queued or running build and delete its files. */
  remove(sha: string): boolean {
    const had = this.jobs.delete(sha);
    this.queue = this.queue.filter((s) => s !== sha);
    this.lastAccess.delete(sha);
    if (this.running?.sha === sha) this.running.controller.abort();
    const p = this.paths(sha);
    fs.rmSync(p.dir, { recursive: true, force: true });
    fs.rmSync(p.snapshot, { recursive: true, force: true });
    return had;
  }

  /** `dist` of a ready build, or null. Counts as a view for LRU. */
  distFor(sha: string): string | null {
    if (this.jobs.get(sha)?.status !== 'ready') return null;
    this.lastAccess.set(sha, Date.now());
    return this.paths(sha).dist;
  }

  logFile(sha: string): string | null {
    const file = this.paths(sha).log;
    return this.jobs.has(sha) && isFile(file) ? file : null;
  }

  thumbnailFile(sha: string): string | null {
    const file = this.paths(sha).thumbnail;
    return this.jobs.has(sha) && isFile(file) ? file : null;
  }

  /** Resolves when the queue is empty and nothing is building. */
  whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    if (this.running) return;
    const sha = this.queue.shift();
    if (!sha) {
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    const running = { sha, controller: new AbortController() };
    this.running = running;
    void this.run(running).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  private async run({ sha, controller }: Running): Promise<void> {
    const p = this.paths(sha);
    const queued = this.jobs.get(sha);
    if (!queued) return;
    // `remove()` aborts the controller; after that the job's files are gone.
    const alive = () => !controller.signal.aborted;
    const log = (text: string) => {
      if (!alive()) return;
      try {
        fs.appendFileSync(p.log, text);
      } catch {
        // Build directory removed mid-write.
      }
    };
    const building: BuildMeta = { ...queued, status: 'building', startedAt: new Date().toISOString() };
    this.save(building);
    try {
      if (building.framework !== 'vite') {
        throw new Error('History builds support Vite only for now. Next.js support is planned.');
      }
      await this.buildVite(sha, p, log, controller.signal);
      if (!isFile(path.join(p.dist, 'index.html'))) throw new Error('vite build did not write index.html');
      if (alive()) {
        this.save({ ...building, status: 'ready', finishedAt: new Date().toISOString() });
        log(`\n[redline] Ready at ${historyBasePath(sha)}\n`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`\n[redline] Failed: ${error}\n`);
      if (alive()) this.save({ ...building, status: 'failed', finishedAt: new Date().toISOString(), error });
    } finally {
      this.removeWorktree(p.worktree, log);
    }
    if (alive() && this.jobs.get(sha)?.status === 'ready') {
      await this.captureThumbnail(sha, p, log);
      this.evict(sha);
    }
  }

  private async buildVite(sha: string, p: BuildPaths, log: (t: string) => void, signal: AbortSignal): Promise<void> {
    const { top, configDir, rel } = this.layout();
    const run = (cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => {
      log(`\n$ ${[cmd === process.execPath ? 'node' : cmd, ...args].join(' ')}\n`);
      return this.exec(cmd, args, { cwd, env, log, signal });
    };

    this.removeWorktree(p.worktree, log);
    fs.mkdirSync(path.dirname(p.worktree), { recursive: true });
    await run('git', ['worktree', 'add', '--detach', p.worktree, sha], top);

    const wtConfigDir = path.join(p.worktree, rel);
    const lock = findLockfile(top, configDir);
    const sameLock = !lock || hashFile(path.join(top, lock.rel, lock.name)) === hashFile(path.join(p.worktree, lock.rel, lock.name));
    const linkable = chain(top, configDir).filter((d) => hasPackages(path.join(top, d, 'node_modules')));
    if (sameLock && linkable.length > 0) {
      log(`\n[redline] Lockfile unchanged. Linking node_modules from the main tree.\n`);
      for (const d of linkable) {
        const link = path.join(p.worktree, d, 'node_modules');
        if (!fs.existsSync(link)) fs.symlinkSync(path.join(top, d, 'node_modules'), link, 'junction');
      }
    } else {
      const [cmd, args] = installCommand(lock?.name ?? 'package-lock.json');
      const installArgs = lock ? args : ['install'];
      log(`\n[redline] ${lock ? 'Lockfile changed' : 'No lockfile'}. Installing dependencies.\n`);
      await run(cmd, installArgs, path.join(p.worktree, lock?.rel ?? rel));
    }

    const args = [viteBin(wtConfigDir), 'build', '--base', historyBasePath(sha), '--outDir', p.dist, '--emptyOutDir'];
    if (this.options.configFile) args.push('--config', path.join(p.worktree, path.relative(top, fs.realpathSync(this.options.configFile))));
    // REDLINE=0 turns off tagging and endpoints in the built app.
    await run(process.execPath, args, wtConfigDir, { ...process.env, NODE_ENV: 'production', REDLINE: '0' });
  }

  /** Git top level, the config directory, and the config directory relative to the top level. */
  private layout(): { top: string; configDir: string; rel: string } {
    const configDir = fs.realpathSync(this.options.configDir ?? this.root);
    const top = fs.realpathSync(gitSync(configDir, ['rev-parse', '--show-toplevel']));
    return { top, configDir, rel: path.relative(top, configDir) };
  }

  /** Remove a build worktree. Never touches the main working tree. */
  private removeWorktree(worktree: string, log: (t: string) => void): void {
    if (!fs.existsSync(worktree)) return;
    const { top, configDir } = this.layout();
    // Drop node_modules links first so nothing follows them into the main tree.
    for (const d of chain(top, configDir)) {
      const link = path.join(worktree, d, 'node_modules');
      try {
        if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      } catch {
        // No link here.
      }
    }
    try {
      gitSync(top, ['worktree', 'remove', '--force', worktree]);
    } catch (err) {
      log(`\n[redline] git worktree remove failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    fs.rmSync(worktree, { recursive: true, force: true });
    try {
      gitSync(top, ['worktree', 'prune']);
    } catch {
      // Nothing to prune.
    }
  }

  private async captureThumbnail(sha: string, p: BuildPaths, log: (t: string) => void): Promise<void> {
    const capture = this.options.capture ?? captureWithPlaywright(this.root);
    if (!capture) return;
    fs.mkdirSync(p.snapshot, { recursive: true });
    this.capturing = sha;
    try {
      const ok = await capture({ dist: p.dist, basePath: historyBasePath(sha), out: p.thumbnail, log });
      if (!ok) fs.rmSync(p.snapshot, { recursive: true, force: true });
    } catch (err) {
      log(`\n[redline] Thumbnail skipped: ${err instanceof Error ? err.message : String(err)}\n`);
      fs.rmSync(p.snapshot, { recursive: true, force: true });
    } finally {
      this.capturing = null;
    }
  }

  /** Keep at most `maxReady` ready builds. `keep` is never removed. */
  private evict(keep: string): void {
    const max = this.options.maxReady ?? DEFAULT_MAX_READY;
    const score = (m: BuildMeta) => this.lastAccess.get(m.sha) ?? Date.parse(m.finishedAt ?? m.queuedAt);
    const ready = [...this.jobs.values()]
      .filter((m) => m.status === 'ready' && m.sha !== keep)
      .sort((a, b) => score(b) - score(a));
    for (const m of ready.slice(Math.max(max - 1, 0))) this.remove(m.sha);
  }
}

interface PageLike {
  goto(url: string, opts: { waitUntil: 'networkidle'; timeout: number }): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
}
interface BrowserLike {
  newPage(opts: { viewport: { width: number; height: number } }): Promise<PageLike>;
  close(): Promise<void>;
}
interface ChromiumLike {
  launch(): Promise<BrowserLike>;
}

async function loadChromium(root: string): Promise<ChromiumLike | null> {
  const require = createRequire(path.join(root, 'package.json'));
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    let file: string;
    try {
      file = require.resolve(name);
    } catch {
      continue;
    }
    const mod = await import(pathToFileURL(file).href);
    const chromium: ChromiumLike | undefined = mod.chromium ?? mod.default?.chromium;
    if (chromium) return chromium;
  }
  return null;
}

/**
 * Screenshot the build with Playwright, if it is installed. Serves `dist` on a throwaway
 * localhost port so capture does not depend on the dev server. Skips when Playwright or its
 * browser is missing.
 */
export function captureWithPlaywright(root: string): CaptureFn {
  return async ({ dist, basePath, out, log }) => {
    const chromium = await loadChromium(root);
    if (!chromium) {
      log('\n[redline] Thumbnail skipped: Playwright is not installed.\n');
      return false;
    }
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const file = pathname.startsWith(basePath) ? resolveStaticFile(dist, pathname.slice(basePath.length)) : null;
      if (file) sendFile(res, file);
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    let browser: BrowserLike | null = null;
    try {
      try {
        browser = await chromium.launch();
      } catch (err) {
        log(`\n[redline] Thumbnail skipped: no Playwright browser (${err instanceof Error ? err.message.split('\n')[0] : err}).\n`);
        return false;
      }
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`http://127.0.0.1:${port}${basePath}`, { waitUntil: 'networkidle', timeout: 15_000 });
      await page.screenshot({ path: out });
      log(`\n[redline] Thumbnail saved.\n`);
      return true;
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
