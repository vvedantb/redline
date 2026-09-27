import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { filterEnvRecord, filterEnvText } from './env';
import { HISTORY_PREFIX, isFullSha } from './paths';

/**
 * Next.js History builds: a `next build` with `output: 'standalone'` per commit, served by
 * the standalone `server.js` on a localhost port and reverse-proxied under `/__redline/h/<sha>/`.
 */

/** Config files Next.js loads, in its lookup order. */
export const NEXT_CONFIG_FILES = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.mts'];

/** The user's config, renamed inside the worktree so the snapshot wrapper can import it. */
export const USER_CONFIG_BASENAME = 'next.config.redline-user';

function readJson(file: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function findNextConfig(dir: string): string | null {
  const name = NEXT_CONFIG_FILES.find((n) => fs.existsSync(path.join(dir, n)));
  return name ? path.join(dir, name) : null;
}

function dependsOnNext(dir: string): boolean {
  const pkg = readJson(path.join(dir, 'package.json'));
  return ['dependencies', 'devDependencies'].some((key) => {
    const deps = pkg?.[key];
    return !!deps && typeof deps === 'object' && 'next' in deps;
  });
}

/** A Next.js app: a `next.config.*`, a `next` dependency, or an `app/` or `pages/` directory. */
export function isNextApp(dir: string): boolean {
  if (findNextConfig(dir) || dependsOnNext(dir)) return true;
  return ['app', 'pages', 'src/app', 'src/pages'].some((d) => isDir(path.join(dir, d)));
}

export interface SnapshotOverrides {
  /** `/__redline/h/<sha>`, no trailing slash. */
  basePath: string;
  /** Git top level of the live project. Linked `node_modules` resolve inside it. */
  tracingRoot: string;
}

/**
 * Source of the wrapper config. It loads the user's config (object, promise or function),
 * then forces what the snapshot needs: standalone output, the History base path, the default
 * `.next` dist dir, and a tracing root that contains linked `node_modules`.
 */
export function snapshotConfigSource(userImport: string | null, overrides: SnapshotOverrides, format: 'esm' | 'cjs'): string {
  const load =
    userImport === null
      ? 'const user = {};'
      : format === 'esm'
        ? `import user from ${JSON.stringify(userImport)};`
        : `const loaded = require(${JSON.stringify(userImport)});\nconst user = loaded && loaded.__esModule ? loaded.default : loaded;`;
  const exported = format === 'esm' ? 'export default' : 'module.exports =';
  return `// @ts-nocheck
// Written by Redline for a History snapshot. Not your config: see ${USER_CONFIG_BASENAME}.*
${load}
const basePath = ${JSON.stringify(overrides.basePath)};
const tracingRoot = ${JSON.stringify(overrides.tracingRoot)};
${exported} async function redlineSnapshotConfig(phase, ctx) {
  const config = (typeof user === 'function' ? await user(phase, ctx) : await user) || {};
  const env = { ...config.env };
  delete env.NEXT_PUBLIC_REDLINE;
  const result = {
    ...config,
    env,
    output: 'standalone',
    basePath,
    distDir: '.next',
    outputFileTracingRoot: tracingRoot,
    turbopack: { ...config.turbopack, root: tracingRoot },
  };
  delete result.assetPrefix;
  return result;
}
`;
}

function isEsmPackage(dir: string): boolean {
  return readJson(path.join(dir, 'package.json'))?.type === 'module';
}

/**
 * Replace the Next config in a worktree app directory with the snapshot wrapper.
 * The user's file is renamed to `next.config.redline-user.<ext>` and imported by the wrapper.
 * Returns the wrapper path. Only call this on a worktree.
 */
export function writeSnapshotConfig(appDir: string, overrides: SnapshotOverrides): string {
  const user = findNextConfig(appDir);
  if (!user) {
    const file = path.join(appDir, 'next.config.mjs');
    fs.writeFileSync(file, snapshotConfigSource(null, overrides, 'esm'));
    return file;
  }
  const ext = path.extname(user);
  const renamed = path.join(appDir, USER_CONFIG_BASENAME + ext);
  fs.renameSync(user, renamed);
  // Next transpiles `.ts` to CommonJS with a require hook, so the import has no extension.
  const specifier = `./${USER_CONFIG_BASENAME}${ext === '.ts' ? '' : ext}`;
  const format = ext === '.js' && !isEsmPackage(appDir) ? 'cjs' : 'esm';
  fs.writeFileSync(user, snapshotConfigSource(specifier, overrides, format));
  return user;
}

/** `.env`, `.env.local`, `.env.development`, `.env.production` and `.env.<name>.local`. */
export const ENV_FILE = /^\.env(\.local|\.development|\.production|\.[\w-]+\.local)?$/;

export interface CopiedEnvFile {
  name: string;
  /** Allowlisted keys written to the copy. */
  kept: number;
  /** Keys left out. */
  stripped: number;
}

/**
 * Copy env files from `from` to `to`, filtered to allowlisted public keys (see `env.ts`).
 * Files that exist in `to` (for example committed at that commit) are kept. Returns what was
 * copied. Missing env files are fine.
 */
export function copyEnvFiles(from: string, to: string): CopiedEnvFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(from);
  } catch {
    return [];
  }
  const copied: CopiedEnvFile[] = [];
  for (const name of names.filter((n) => ENV_FILE.test(n)).sort()) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    try {
      if (!fs.statSync(src).isFile() || fs.existsSync(dest)) continue;
      const { text, kept, stripped } = filterEnvText(fs.readFileSync(src, 'utf8'));
      fs.writeFileSync(dest, text);
      copied.push({ name, kept, stripped });
    } catch {
      // Unreadable or vanished: skip it.
    }
  }
  return copied;
}

/**
 * Environment for `next build` and the standalone server, without secret or Convex keys and
 * without the variables the running Next dev server sets for itself. Those would leak
 * dev-server state into the snapshot.
 */
export function snapshotEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(filterEnvRecord(env))) {
    if (/^(__NEXT|NEXT_PRIVATE_|TURBOPACK)/.test(key)) continue;
    if (key === 'NEXT_RUNTIME' || key === 'NEXT_PUBLIC_REDLINE' || key === 'PORT' || key === 'HOSTNAME') continue;
    out[key] = value;
  }
  return { ...out, NODE_ENV: 'production', REDLINE: '0', NEXT_TELEMETRY_DISABLED: '1' };
}

/** Move a directory, copying when a rename is not possible. */
export function moveDir(from: string, to: string): void {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
}

/**
 * Where the standalone `server.js` lives: Next mirrors the app's path from the tracing root.
 * In a monorepo this is `standalone/<path from git top to the app>/server.js`.
 */
export function standaloneServerDir(standalone: string, tracingRoot: string, appDir: string): string {
  return path.join(standalone, path.relative(tracingRoot, appDir));
}

/**
 * Move `.next/standalone` from a worktree app into `standalone`, then add the static assets and
 * `public/` that Next leaves out of it. Returns the server directory.
 */
export function assembleStandalone(appDir: string, standalone: string, tracingRoot: string): string {
  const built = path.join(appDir, '.next', 'standalone');
  if (!isDir(built)) throw new Error('next build did not write .next/standalone');
  moveDir(built, standalone);
  const serverDir = standaloneServerDir(standalone, tracingRoot, appDir);
  if (!fs.existsSync(path.join(serverDir, 'server.js'))) {
    throw new Error(`next build did not write ${path.relative(standalone, path.join(serverDir, 'server.js'))}`);
  }
  const staticDir = path.join(appDir, '.next', 'static');
  if (isDir(staticDir)) moveDir(staticDir, path.join(serverDir, '.next', 'static'));
  const publicDir = path.join(appDir, 'public');
  if (isDir(publicDir)) fs.cpSync(publicDir, path.join(serverDir, 'public'), { recursive: true });
  return serverDir;
}

/** Path to the `next` CLI resolved from `cwd`. */
export function nextBin(cwd: string): string {
  const pkgFile = createRequire(path.join(cwd, 'package.json')).resolve('next/package.json');
  const bin = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).bin;
  const rel = typeof bin === 'string' ? bin : typeof bin?.next === 'string' ? bin.next : 'dist/bin/next';
  return path.join(path.dirname(pkgFile), rel);
}

/** `--webpack` when the app's `build` script uses it. Next 16 builds with Turbopack otherwise. */
export function nextBuildFlags(appDir: string): string[] {
  const scripts = readJson(path.join(appDir, 'package.json'))?.scripts;
  const build = scripts && typeof scripts === 'object' && 'build' in scripts ? scripts.build : null;
  return typeof build === 'string' && /\bnext build\b.*--webpack\b/.test(build) ? ['--webpack'] : [];
}

/**
 * Split `h/<sha>/<rest>` (the part after `/__redline/`) into the SHA and the upstream path.
 * The snapshot is built with `basePath: /__redline/h/<sha>`, so the path is forwarded as is.
 * Returns null for a bad SHA or any `.`, `..`, encoded slash, backslash or NUL segment.
 */
export function historyTarget(action: string): { sha: string; path: string } | null {
  const [head, sha, ...rest] = action.split('/');
  if (head !== 'h' || !isFullSha(sha ?? '')) return null;
  for (const segment of rest) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || /[\\/\0]/.test(decoded)) return null;
  }
  return { sha, path: `${HISTORY_PREFIX}${sha}${rest.length > 0 ? '/' + rest.join('/') : ''}` };
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer'];

/**
 * Forward a request to `origin + target` and stream the response back. `target` is a path
 * with its query. Host-relative redirects stay same-origin.
 */
export async function proxyRequest(request: Request, origin: string, target: string): Promise<Response> {
  const incoming = new URL(request.url);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (key === 'host' || key === 'content-length' || key === 'accept-encoding' || HOP_BY_HOP.includes(key)) return;
    headers.set(key, value);
  });
  // Next checks Server Action origins against the forwarded host.
  headers.set('x-forwarded-host', request.headers.get('host') ?? incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(/:$/, ''));
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(origin + target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    });
  } catch (err) {
    return new Response(`Redline could not reach the History server: ${err instanceof Error ? err.message : String(err)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    // fetch has already decoded the body.
    if (key === 'content-encoding' || key === 'content-length' || key === 'set-cookie' || HOP_BY_HOP.includes(key)) return;
    out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  const location = out.get('location');
  if (location?.startsWith(origin)) out.set('location', location.slice(origin.length) || '/');
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

/** A running standalone server. */
export interface ServerProcess {
  kill(): void;
  /** Called once when the process exits or fails to start. */
  onExit(listener: (code: number | null) => void): void;
}

export interface SpawnServerInput {
  script: string;
  cwd: string;
  port: number;
  env: NodeJS.ProcessEnv;
  log: (text: string) => void;
}

/** Starts `server.js`. Injected in tests. */
export type SpawnServerFn = (input: SpawnServerInput) => ServerProcess;

/** Default `SpawnServerFn`: `node server.js` with `PORT` and `HOSTNAME=127.0.0.1`. */
export const spawnNodeServer: SpawnServerFn = ({ script, cwd, port, env, log }) => {
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { ...env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.setEncoding('utf8').on('data', log);
  child.stderr?.setEncoding('utf8').on('data', log);
  const listeners: ((code: number | null) => void)[] = [];
  let exitCode: number | null | undefined;
  const done = (code: number | null) => {
    if (exitCode !== undefined) return;
    exitCode = code;
    listeners.splice(0).forEach((l) => l(code));
  };
  child.on('error', (err) => {
    log(`\n[redline] server error: ${err.message}\n`);
    done(null);
  });
  child.on('exit', (code) => done(code));
  return {
    kill: () => {
      if (exitCode === undefined) child.kill();
    },
    onExit: (listener) => {
      if (exitCode !== undefined) listener(exitCode);
      else listeners.push(listener);
    },
  };
};

/** A free localhost port. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

interface Entry {
  ready: Promise<number>;
  proc: ServerProcess | null;
  exited: boolean;
  stopped: boolean;
}

export interface ServerPoolOptions {
  spawn?: SpawnServerFn;
  /** How long a server may take to accept connections. Default 30 s. */
  startTimeoutMs?: number;
}

/** Standalone servers, started on first use and keyed by SHA. All are killed when the process exits. */
export class ServerPool {
  private readonly servers = new Map<string, Entry>();
  private readonly spawnServer: SpawnServerFn;
  private readonly startTimeoutMs: number;
  private exitHooked = false;

  constructor(options: ServerPoolOptions = {}) {
    this.spawnServer = options.spawn ?? spawnNodeServer;
    this.startTimeoutMs = options.startTimeoutMs ?? 30_000;
  }

  /** Port of the running server for `key`, starting it if needed. Concurrent calls share one start. */
  start(key: string, input: Omit<SpawnServerInput, 'port'>): Promise<number> {
    const found = this.servers.get(key);
    if (found) return found.ready;
    const entry: Entry = { ready: Promise.resolve(0), proc: null, exited: false, stopped: false };
    entry.ready = this.launch(key, entry, input);
    entry.ready.catch(() => this.forget(key, entry));
    this.servers.set(key, entry);
    this.hookExit();
    return entry.ready;
  }

  has(key: string): boolean {
    return this.servers.has(key);
  }

  stop(key: string): void {
    const entry = this.servers.get(key);
    if (!entry) return;
    this.servers.delete(key);
    entry.stopped = true;
    entry.proc?.kill();
  }

  stopAll(): void {
    for (const key of [...this.servers.keys()]) this.stop(key);
  }

  private forget(key: string, entry: Entry): void {
    if (this.servers.get(key) === entry) this.servers.delete(key);
  }

  private async launch(key: string, entry: Entry, input: Omit<SpawnServerInput, 'port'>): Promise<number> {
    const port = await freePort();
    if (entry.stopped) throw new Error('Server stopped before it started');
    const proc = this.spawnServer({ ...input, port });
    entry.proc = proc;
    let exitCode: number | null = null;
    proc.onExit((code) => {
      entry.exited = true;
      exitCode = code;
      this.forget(key, entry);
    });
    const deadline = Date.now() + this.startTimeoutMs;
    for (;;) {
      if (entry.stopped) throw new Error('Server stopped before it started');
      if (entry.exited) throw new Error(`server.js exited with code ${exitCode} before it was ready`);
      if (await canConnect(port)) return port;
      if (Date.now() > deadline) {
        this.stop(key);
        throw new Error(`server.js did not accept connections within ${Math.round(this.startTimeoutMs / 1000)} s`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private hookExit(): void {
    if (this.exitHooked) return;
    this.exitHooked = true;
    process.once('exit', () => this.stopAll());
  }
}
