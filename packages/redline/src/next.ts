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
export type RedlineNextConfig<T> = Omit<T, 'env' | 'webpack' | 'rewrites'> & {
  env?: Record<string, string>;
  webpack?: (config: AnyConfig, ctx: AnyConfig) => AnyConfig;
  rewrites?: () => Promise<any>;
};

function isEnabled(options: RedlineNextOptions): boolean {
  return options.enabled ?? process.env.NODE_ENV !== 'production';
}

/** Absolute path to the webpack loader that adds `data-redline-source`. */
export const loaderPath = path.join(__dirname, 'loader.cjs');

/**
 * Wrap a Next.js config.
 *
 * In dev it adds a webpack pre-loader that tags JSX host elements, sets
 * `NEXT_PUBLIC_REDLINE=1`, and rewrites `/__redline/:action` to your API route.
 * Turbopack is not supported yet: run `next dev --webpack` on Next 16+.
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

  return {
    ...nextConfig,
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
    return Response.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
  };

  return { GET: handle, POST: handle };
}

export default withRedline;
