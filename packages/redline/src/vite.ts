import type { Plugin } from 'vite';
import { createMiddleware } from './http';
import { DEFAULT_EXTENSIONS, type RedlineServerOptions } from './server';
import { shouldTransform, transformSource } from './transform';

export interface RedlineViteOptions {
  /**
   * Force Redline on or off. Default: on for `vite dev`, off for `vite build`.
   * `false` also makes `/__redline/*` report `enabled: false`.
   */
  enabled?: boolean;
  /** Where to store the pinned baseline. Default `<root>/.redline/baseline.json`. */
  baselineFile?: string;
  /** File extensions included in git diffs. Default tsx, jsx, ts, js, css. */
  extensions?: string[];
}

/** Vite plugin: tags JSX with source locations and serves `/__redline/*` in dev. */
export function redline(options: RedlineViteOptions = {}): Plugin {
  let root = process.cwd();
  let active = false;

  const serverOptions = (): RedlineServerOptions => ({
    root,
    baselineFile: options.baselineFile,
    extensions: options.extensions ?? DEFAULT_EXTENSIONS,
    enabled: active,
  });

  return {
    name: 'redline',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
      active = options.enabled ?? config.command === 'serve';
    },
    configureServer(server) {
      server.middlewares.use(createMiddleware(serverOptions));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createMiddleware(serverOptions));
    },
    transform(code, id) {
      if (!active || !shouldTransform(id)) return null;
      return transformSource(code, id, { root });
    },
  };
}

export default redline;
