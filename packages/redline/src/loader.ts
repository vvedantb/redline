import { transformSource } from './transform';

interface LoaderContext {
  resourcePath: string;
  getOptions?: () => { root?: string };
  query?: { root?: string } | string;
  rootContext?: string;
  callback: (err: Error | null, code?: string, map?: unknown) => void;
}

/** Webpack loader used by `withRedline`. Adds `data-redline-source` to JSX host elements. */
function redlineLoader(this: LoaderContext, source: string, map?: unknown): void {
  const opts = this.getOptions?.() ?? (typeof this.query === 'object' ? this.query : {}) ?? {};
  const root = opts.root ?? this.rootContext ?? process.cwd();
  const result = transformSource(source, this.resourcePath, { root });
  if (!result) return this.callback(null, source, map);
  this.callback(null, result.code, result.map);
}

export default redlineLoader;
