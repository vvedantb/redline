import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BuildManager, DEFAULT_MAX_READY } from './build';
import { defaultFixturesFile, injectBootstrap, networkAsset } from './network/serve';
import { ENDPOINT } from './paths';
import { handleRedlineRequest, DEFAULT_EXTENSIONS, type RedlineServerOptions } from './server';
import { historyTarget, proxyRequest } from './standalone';
import { TRANSFORM_FILE } from './transform';
import type { RedlineHistoryOptions } from './types';

export { HISTORY_ENV_ALLOWLIST, HISTORY_ENV_STRIP_KEYS, HISTORY_ENV_STRIP_VALUE, isHistoryEnvKeyAllowed } from './env';

export interface RedlineNextOptions {
  /** Force on/off. Default: on when NODE_ENV !== 'production'. */
  enabled?: boolean;
  /** Route that serves the handler from `createRedlineHandler`. Default `/api/redline`. */
  apiRoute?: string;
  baselineFile?: string;
  extensions?: string[];
}

export interface RedlineNextHistoryOptions extends RedlineHistoryOptions {
  /**
   * The Next.js app, relative to `root`. Only needed when `root` is not the app directory,
   * for example `apps/web` when `root` is the top of a monorepo.
   */
  appDir?: string;
}

export interface RedlineHandlerOptions extends RedlineNextOptions {
  /** Project root. `.redline/` lives here. Default `process.cwd()`, which is the app directory under `next dev`. */
  root?: string;
  /** Per-commit History builds (`output: 'standalone'`). `false` turns them off. */
  history?: RedlineNextHistoryOptions | false;
}

type AnyConfig = Record<string, any>;
type Rewrite = { source: string; destination: string };
type Rewrites = Rewrite[] | { beforeFiles?: Rewrite[]; afterFiles?: Rewrite[]; fallback?: Rewrite[] };

/** The wrapped config. Fields are optional because a disabled wrapper returns the input unchanged. */
export type RedlineNextConfig<T> = Omit<T, 'env' | 'webpack' | 'rewrites' | 'turbopack' | 'experimental'> & {
  env?: Record<string, string>;
  webpack?: (config: AnyConfig, ctx: AnyConfig) => AnyConfig;
  rewrites?: () => Promise<any>;
  turbopack?: AnyConfig;
  experimental?: AnyConfig;
};

/** `REDLINE=0` turns Redline off whatever `enabled` says. History snapshot builds use it. */
function isEnabled(options: RedlineNextOptions): boolean {
  return process.env.REDLINE !== '0' && (options.enabled ?? process.env.NODE_ENV !== 'production');
}

/** Absolute path to the webpack loader that adds `data-redline-source`. */
export const loaderPath = path.join(__dirname, 'loader.cjs');

/** Turbopack glob for the files the loader tags. */
export const TURBOPACK_GLOB = '**/*.{tsx,jsx}';

/** Installed Next.js version as `[major, minor]`, or null when `next` cannot be resolved. */
export function detectNextVersion(cwd = process.cwd()): [number, number] | null {
  try {
    const pkg = createRequire(path.join(cwd, 'package.json')).resolve('next/package.json');
    const m = /^(\d+)\.(\d+)/.exec(JSON.parse(fs.readFileSync(pkg, 'utf8')).version);
    return m ? [Number(m[1]), Number(m[2])] : null;
  } catch {
    return null;
  }
}

/** Next 15.3 moved Turbopack config from `experimental.turbo` to top-level `turbopack`. */
export function usesLegacyTurboKey(version: [number, number] | null): boolean {
  if (!version) return false;
  const [major, minor] = version;
  return major < 15 || (major === 15 && minor < 3);
}

/**
 * Add the Redline loader to a Turbopack `rules` object without dropping user rules.
 * If the user already has a rule for the same glob, the loader is appended to its
 * `loaders` so it runs first, on the original JSX.
 */
export function mergeTurbopackRules(rules: AnyConfig | undefined, root: string): AnyConfig {
  const loader = { loader: loaderPath, options: { root } };
  const existing = rules?.[TURBOPACK_GLOB];
  if (existing === undefined) return { ...(rules ?? {}), [TURBOPACK_GLOB]: { loaders: [loader] } };
  if (existing && Array.isArray(existing.loaders)) {
    return { ...rules, [TURBOPACK_GLOB]: { ...existing, loaders: [...existing.loaders, loader] } };
  }
  console.warn(`[redline] turbopack.rules['${TURBOPACK_GLOB}'] has an unexpected shape; Redline did not add its loader.`);
  return { ...rules };
}

/**
 * Wrap a Next.js config.
 *
 * In dev it tags JSX host elements under both bundlers: a Turbopack rule (`turbopack.rules`
 * on Next 15.3+, `experimental.turbo.rules` before that) and a webpack pre-loader for
 * `next dev --webpack`. Both use the same loader. It also sets `NEXT_PUBLIC_REDLINE=1`
 * and rewrites `/__redline/:path*` to your API route, History previews included.
 */
export function withRedline<T extends AnyConfig>(
  nextConfig: T = {} as T,
  options: RedlineNextOptions = {},
): RedlineNextConfig<T> {
  if (!isEnabled(options)) return nextConfig as RedlineNextConfig<T>;
  const apiRoute = (options.apiRoute ?? '/api/redline').replace(/\/$/, '');
  const userWebpack = nextConfig.webpack as ((config: AnyConfig, ctx: AnyConfig) => AnyConfig) | undefined;
  const userRewrites = nextConfig.rewrites as (() => Promise<Rewrites> | Rewrites) | undefined;
  const ours: Rewrite[] = [{ source: `${ENDPOINT}/:path*`, destination: `${apiRoute}/:path*` }];
  const root = process.cwd();
  // Follow the user's key if they already set one, otherwise pick by Next version.
  const legacy =
    nextConfig.turbopack === undefined &&
    (nextConfig.experimental?.turbo !== undefined || usesLegacyTurboKey(detectNextVersion(root)));
  const turbo = legacy
    ? {
        experimental: {
          ...nextConfig.experimental,
          turbo: { ...nextConfig.experimental?.turbo, rules: mergeTurbopackRules(nextConfig.experimental?.turbo?.rules, root) },
        },
      }
    : { turbopack: { ...nextConfig.turbopack, rules: mergeTurbopackRules(nextConfig.turbopack?.rules, root) } };

  return {
    ...nextConfig,
    ...turbo,
    env: { ...(nextConfig.env ?? {}), NEXT_PUBLIC_REDLINE: '1' },
    webpack(config: AnyConfig, ctx: AnyConfig) {
      const result = userWebpack ? userWebpack(config, ctx) : config;
      if (ctx?.dev || options.enabled === true) {
        result.module = result.module ?? {};
        result.module.rules = result.module.rules ?? [];
        result.module.rules.push({
          test: TRANSFORM_FILE,
          exclude: /node_modules/,
          enforce: 'pre',
          use: [{ loader: loaderPath, options: { root: ctx?.dir ?? process.cwd() } }],
        });
      }
      return result;
    },
    async rewrites() {
      const existing = userRewrites ? await userRewrites() : [];
      if (Array.isArray(existing)) return [...ours, ...existing];
      return { ...existing, beforeFiles: [...ours, ...(existing.beforeFiles ?? [])] };
    },
  };
}

declare global {
  // One BuildManager per app, shared across route module reloads in `next dev`.
  var __redlineBuilds: Map<string, BuildManager> | undefined;
}

function sharedBuilds(root: string, history: RedlineNextHistoryOptions): BuildManager {
  const configDir = path.resolve(root, history.appDir ?? '.');
  const key = `${path.resolve(root)}\0${configDir}`;
  const registry = (globalThis.__redlineBuilds ??= new Map());
  let builds = registry.get(key);
  if (!builds) {
    builds = new BuildManager({
      root,
      configDir,
      framework: 'next',
      maxReady: history.maxBuilds ?? DEFAULT_MAX_READY,
      capture: history.thumbnails === false ? false : undefined,
      networkFixtures: history.networkFixtures,
    });
    registry.set(key, builds);
  }
  return builds;
}

/**
 * The Redline action in a request path: what follows `apiRoute` (after a rewrite) or
 * `/__redline` (before one). History paths (`h/<sha>/...`) keep their trailing slash.
 */
export function redlineAction(pathname: string, apiRoute = '/api/redline'): string {
  const route = apiRoute.replace(/\/$/, '');
  for (const prefix of [`${route}/`, `${ENDPOINT}/`]) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    return rest.startsWith('h/') ? rest : rest.replace(/\/$/, '');
  }
  return pathname.split('/').filter(Boolean).pop() ?? '';
}

const plain = (status: number, text: string) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Reverse-proxy `/__redline/h/<sha>/*` to the standalone server of a ready build. The snapshot
 * was built with `basePath: /__redline/h/<sha>`, so the path is forwarded unchanged.
 */
async function serveHistory(opts: RedlineServerOptions, request: Request, action: string): Promise<Response> {
  const target = opts.enabled !== false ? historyTarget(action) : null;
  if (!target || !opts.builds) return plain(404, 'No ready build for this commit');
  let origin: string | null;
  try {
    origin = await opts.builds.serverFor(target.sha);
  } catch (err) {
    return plain(502, `The History server did not start: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!origin) return plain(404, 'No ready build for this commit');
  const res = await proxyRequest(request, origin, target.path + new URL(request.url).search);
  if (request.method !== 'GET' || !(res.headers.get('content-type') ?? '').includes('text/html')) return res;
  // Buffer HTML pages to add the read-only network bootstrap. Other responses stream.
  return new Response(injectBootstrap(await res.text()), { status: res.status, statusText: res.statusText, headers: res.headers });
}

function serveThumbnail(opts: RedlineServerOptions, url: URL): Response {
  const sha = url.searchParams.get('sha') ?? '';
  const file = opts.enabled !== false ? opts.builds?.thumbnailFile(sha) : null;
  if (!file) return plain(404, 'Not found');
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
}

/** Handle one App Router request for `/__redline/*`. `createRedlineHandler` wraps this. */
export async function handleRedlineNextRequest(request: Request, opts: RedlineServerOptions, apiRoute?: string): Promise<Response> {
  const url = new URL(request.url);
  const action = redlineAction(url.pathname, apiRoute);
  if (action.startsWith('h/')) return serveHistory(opts, request, action);
  if (action === 'build/thumb') return serveThumbnail(opts, url);
  const asset = opts.enabled !== false && request.method === 'GET' ? networkAsset(action, opts.builds?.fixturesFile ?? defaultFixturesFile(opts.root)) : null;
  if (asset) return new Response(asset.body, { headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'no-store' } });
  let body: unknown = {};
  if (request.method === 'POST') {
    const text = await request.text();
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  const res = handleRedlineRequest(opts, action, request.method, url.searchParams, body);
  if (res.text !== undefined) return plain(res.status, res.text);
  return Response.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Route handlers for the App Router. Put this in `app/api/redline/[...action]/route.ts`.
 * The catch-all segment carries `build/log` and the History proxy under `h/<sha>/...`:
 *
 * ```ts
 * import { createRedlineHandler } from '@vvv/redline/next';
 * export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createRedlineHandler();
 * ```
 */
export function createRedlineHandler(options: RedlineHandlerOptions = {}) {
  const serverOptions = (): RedlineServerOptions => {
    const root = options.root ?? process.cwd();
    const enabled = isEnabled(options);
    return {
      root,
      baselineFile: options.baselineFile,
      extensions: options.extensions ?? DEFAULT_EXTENSIONS,
      enabled,
      builds: enabled && options.history !== false ? sharedBuilds(root, options.history ?? {}) : undefined,
    };
  };

  const handle = (request: Request): Promise<Response> => handleRedlineNextRequest(request, serverOptions(), options.apiRoute);

  return { GET: handle, HEAD: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle, OPTIONS: handle };
}

export default withRedline;
