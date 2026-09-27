import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { handleRedlineRequest, DEFAULT_EXTENSIONS, type RedlineServerOptions } from './server';
import { TRANSFORM_FILE } from './transform';

export interface RedlineNextOptions {
  /** Force on/off. Default: on when NODE_ENV !== 'production'. */
  enabled?: boolean;
  /** Route that serves the handler from `createRedlineHandler`. Default `/api/redline`. */
  apiRoute?: string;
  baselineFile?: string;
  extensions?: string[];
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

function isEnabled(options: RedlineNextOptions): boolean {
  return options.enabled ?? process.env.NODE_ENV !== 'production';
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
 * and rewrites `/__redline/:action` to your API route.
 */
export function withRedline<T extends AnyConfig>(
  nextConfig: T = {} as T,
  options: RedlineNextOptions = {},
): RedlineNextConfig<T> {
  if (!isEnabled(options)) return nextConfig as RedlineNextConfig<T>;
  const apiRoute = (options.apiRoute ?? '/api/redline').replace(/\/$/, '');
  const userWebpack = nextConfig.webpack as ((config: AnyConfig, ctx: AnyConfig) => AnyConfig) | undefined;
  const userRewrites = nextConfig.rewrites as (() => Promise<Rewrites> | Rewrites) | undefined;
  const ours: Rewrite[] = [{ source: '/__redline/:action', destination: `${apiRoute}/:action` }];
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

/**
 * Route handlers for the App Router. Put this in `app/api/redline/[action]/route.ts`:
 *
 * ```ts
 * import { createRedlineHandler } from '@vedantb/redline/next';
 * export const { GET, POST } = createRedlineHandler();
 * ```
 */
export function createRedlineHandler(options: RedlineNextOptions & { root?: string } = {}) {
  const serverOptions = (): RedlineServerOptions => ({
    root: options.root ?? process.cwd(),
    baselineFile: options.baselineFile,
    extensions: options.extensions ?? DEFAULT_EXTENSIONS,
    enabled: isEnabled(options),
  });

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const action = url.pathname.split('/').filter(Boolean).pop() ?? '';
    let body: unknown = {};
    if (request.method === 'POST') {
      const text = await request.text();
      try {
        body = text.trim() ? JSON.parse(text) : {};
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
      }
    }
    const res = handleRedlineRequest(serverOptions(), action, request.method, url.searchParams, body);
    if (res.text !== undefined) {
      return new Response(res.text, {
        status: res.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  };

  return { GET: handle, POST: handle };
}

export default withRedline;
