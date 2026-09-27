import path from 'node:path';
import type { Plugin } from 'vite';
import { BuildManager, DEFAULT_MAX_READY } from './build';
import { createMiddleware } from './http';
import { injectBootstrap } from './network/serve';
import { DEFAULT_EXTENSIONS, type RedlineServerOptions } from './server';
import { shouldTransform, transformSource } from './transform';
import type { RedlineHistoryOptions } from './types';

export type { RedlineHistoryOptions };
export { HISTORY_ENV_ALLOWLIST, HISTORY_ENV_STRIP_KEYS, HISTORY_ENV_STRIP_VALUE, isHistoryEnvKeyAllowed } from './env';

export interface RedlineViteOptions {
  /**
   * Force Redline on or off. Default: on for `vite dev`, off for `vite build`.
   * `false` also makes `/__redline/*` report `enabled: false`. The `REDLINE=0`
   * environment variable turns Redline off regardless; History builds use it.
   */
  enabled?: boolean;
  /** Where to store the pinned baseline. Default `<root>/.redline/baseline.json`. */
  baselineFile?: string;
  /** File extensions included in git diffs. Default tsx, jsx, ts, js, css. */
  extensions?: string[];
  /** Per-commit production builds for the History panel. `false` turns them off. */
  history?: RedlineHistoryOptions | false;
}

/** Vite plugin: tags JSX with source locations and serves `/__redline/*` in dev. */
export function redline(options: RedlineViteOptions = {}): Plugin {
  let root = process.cwd();
  let configFile: string | undefined;
  let active = false;
  let serving = false;
  let builds: BuildManager | undefined;

  const serverOptions = (): RedlineServerOptions => ({
    root,
    baselineFile: options.baselineFile,
    extensions: options.extensions ?? DEFAULT_EXTENSIONS,
    enabled: active,
    builds,
  });

  const setup = () => {
    if (!active || options.history === false || builds) return;
    const history = options.history ?? {};
    builds = new BuildManager({
      root,
      configDir: configFile ? path.dirname(configFile) : root,
      configFile,
      framework: 'vite',
      maxReady: history.maxBuilds ?? DEFAULT_MAX_READY,
      capture: history.thumbnails === false ? false : undefined,
      networkFixtures: history.networkFixtures,
    });
  };

  return {
    name: 'redline',
    enforce: 'pre',
    config() {
      // Worktrees and builds under .redline must not trigger reloads.
      return { server: { watch: { ignored: ['**/.redline/**'] } } };
    },
    configResolved(config) {
      root = config.root;
      configFile = config.configFile;
      serving = config.command === 'serve';
      active = process.env.REDLINE !== '0' && (options.enabled ?? config.command === 'serve');
    },
    configureServer(server) {
      setup();
      server.middlewares.use(createMiddleware(serverOptions));
    },
    configurePreviewServer(server) {
      setup();
      server.middlewares.use(createMiddleware(serverOptions));
    },
    // The network layer is a no-op on live pages unless `?redlineNetwork=capture` is set.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return active && serving && options.history !== false ? injectBootstrap(html) : html;
      },
    },
    transform(code, id) {
      if (!active || !shouldTransform(id)) return null;
      return transformSource(code, id, { root });
    },
  };
}

export default redline;
