import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      core: 'src/core.ts',
      vite: 'src/vite.ts',
      next: 'src/next.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    shims: true,
    target: 'node18',
    external: ['react', 'react-dom', 'vite', 'next'],
  },
  {
    entry: { loader: 'src/loader.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    target: 'node18',
  },
]);
