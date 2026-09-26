import { defineConfig } from 'tsup';

const shared = {
  format: ['esm', 'cjs'] as const,
  dts: true,
  target: 'es2020' as const,
  external: ['react', 'react-dom', 'vite', 'next'],
};

export default defineConfig([
  // Browser-safe entries: no Node shims.
  { ...shared, entry: { index: 'src/index.ts', core: 'src/core.ts' }, clean: false, format: ['esm', 'cjs'] },
  // Node entries. `shims` provides `__dirname` in the ESM build of next.ts.
  { ...shared, entry: { vite: 'src/vite.ts', next: 'src/next.ts' }, clean: false, shims: true, target: 'node18', format: ['esm', 'cjs'] },
  // Webpack loaders must export the function itself.
  {
    entry: { loader: 'src/loader.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    target: 'node18',
    footer: { js: 'module.exports = module.exports.default;' },
  },
]);
