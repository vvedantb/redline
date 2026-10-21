import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import redlineLoader from '../src/loader';
import { shouldTransform, transformSource } from '../src/transform';
import { redline, type RedlineViteOptions } from '../src/vite';

const root = '/project';

describe('transformSource', () => {
  it('tags host elements with file and line range', () => {
    const code = [
      'export function Hero() {',
      '  return (',
      '    <section className="hero">',
      '      <h1>Hello</h1>',
      '    </section>',
      '  );',
      '}',
    ].join('\n');
    const out = transformSource(code, '/project/src/Hero.tsx', { root })!;
    expect(out.code).toContain('<section className="hero" data-redline-source="src/Hero.tsx:3-5">');
    expect(out.code).toContain('<h1 data-redline-source="src/Hero.tsx:4-4">');
    expect(out.map.mappings.length).toBeGreaterThan(0);
  });

  it('tags component elements, member expressions included', () => {
    const code = 'const A = () => <Tabs><Tabs.Tab value="a" /><ActionIcon onClick={go}><Icon /></ActionIcon></Tabs>;';
    const out = transformSource(code, '/project/src/A.tsx', { root })!;
    expect(out.code).toContain('<Tabs data-redline-source="src/A.tsx:1-1">');
    expect(out.code).toContain('<Tabs.Tab value="a" data-redline-source="src/A.tsx:1-1" />');
    expect(out.code).toContain('<ActionIcon onClick={go} data-redline-source="src/A.tsx:1-1">');
    expect(out.code).toContain('<Icon data-redline-source="src/A.tsx:1-1" />');
  });

  it('leaves fragments, Suspense, StrictMode, providers and document tags alone', () => {
    const code = [
      'const A = () => (',
      '  <StrictMode><React.Fragment><Suspense fallback={null}><Fragment>',
      '    <ThemeProvider><Ctx.Provider value={1}><MantineProvider><Ctx.Consumer>{() => null}</Ctx.Consumer>',
      '    <html><body /></html></MantineProvider></Ctx.Provider></ThemeProvider>',
      '  </Fragment></Suspense></React.Fragment></StrictMode>',
      ');',
    ].join('\n');
    expect(transformSource(code, '/project/src/A.tsx', { root })).toBeNull();
  });

  it('leaves Activity, ViewTransition and aliased React built-ins alone', () => {
    const code = [
      "import { Fragment as F, Suspense as S, Activity as Act } from 'react';",
      'const A = () => <F><S fallback={null}><Act mode="visible"><Activity><ViewTransition><p /></ViewTransition></Activity></Act></S></F>;',
    ].join('\n');
    const out = transformSource(code, '/project/src/A.tsx', { root })!;
    expect(out.code).toContain(
      '<F><S fallback={null}><Act mode="visible"><Activity><ViewTransition><p data-redline-source="src/A.tsx:2-2" />',
    );
  });

  it('skips components imported from Headless UI and React Three Fiber/drei, member and namespace forms included', () => {
    const code = [
      "import { Menu, Dialog as D } from '@headlessui/react';",
      "import * as Drei from '@react-three/drei';",
      "import { Canvas } from '@react-three/fiber';",
      "import { Button } from '@mantine/core';",
      'const A = () => (',
      '  <Menu><Menu.Button>Open</Menu.Button><Menu.Items><D.Panel /></Menu.Items>',
      '    <Canvas><Drei.OrbitControls /><Drei.Html.Inner /></Canvas><Button>Go</Button></Menu>',
      ');',
    ].join('\n');
    const out = transformSource(code, '/project/src/A.tsx', { root })!;
    expect(out.code).toContain('<Menu><Menu.Button>Open</Menu.Button><Menu.Items><D.Panel /></Menu.Items>');
    expect(out.code).toContain('<Canvas><Drei.OrbitControls /><Drei.Html.Inner /></Canvas><Button data-redline-source="src/A.tsx:7-7">');
  });

  it('skips extra packages from skipComponentsFrom, subpaths included', () => {
    const code = "import { Scene } from 'scene-kit/react';\nimport { Card } from 'ui-kit';\nconst A = () => <Scene><Card /></Scene>;";
    const out = transformSource(code, '/project/src/A.tsx', { root, skipComponentsFrom: ['scene-kit'] })!;
    expect(out.code).toContain('<Scene><Card data-redline-source="src/A.tsx:3-3" /></Scene>');
  });

  it('puts the attribute after type arguments and spreads, so the innermost JSX wins', () => {
    const code = 'export const A = (p: P) => <Select<Option> {...p} value="x" />;\nexport const B = (p: P) => <div {...p} />;';
    const out = transformSource(code, '/project/src/A.tsx', { root })!;
    expect(out.code).toContain('<Select<Option> {...p} value="x" data-redline-source="src/A.tsx:1-1" />');
    expect(out.code).toContain('<div {...p} data-redline-source="src/A.tsx:2-2" />');
  });

  it('tags only host elements when tagComponents is false', () => {
    const code = 'const A = () => <><Card title="x" /><Tabs.Tab /><p /></>;';
    const out = transformSource(code, '/project/src/A.tsx', { root, tagComponents: false })!;
    expect(out.code).toBe('const A = () => <><Card title="x" /><Tabs.Tab /><p data-redline-source="src/A.tsx:1-1" /></>;');
  });

  it('handles TypeScript syntax and self-closing elements', () => {
    const code = 'const f = <T,>(x: T): T => x;\nexport const I = () => <input type="text" />;';
    const out = transformSource(code, '/project/src/I.tsx', { root })!;
    expect(out.code).toContain('<input type="text" data-redline-source="src/I.tsx:2-2" />');
  });

  it('does not tag an element twice', () => {
    const code = 'export const A = () => <div data-redline-source="x:1-1" />;';
    expect(transformSource(code, '/project/src/A.jsx', { root })).toBeNull();
  });

  it('strips query strings from ids', () => {
    const out = transformSource('export const A = () => <p />;', '/project/src/A.jsx?v=123', { root })!;
    expect(out.code).toContain('src/A.jsx:1-1');
  });
});

describe('shouldTransform', () => {
  it('only transforms jsx/tsx outside node_modules', () => {
    expect(shouldTransform('/p/src/A.tsx')).toBe(true);
    expect(shouldTransform('/p/src/A.jsx?import')).toBe(true);
    expect(shouldTransform('/p/src/a.ts')).toBe(false);
    expect(shouldTransform('/p/node_modules/x/A.tsx')).toBe(false);
  });
});

describe('loader and Vite plugin', () => {
  const code = 'export const A = () => <Card><p /></Card>;';
  const file = '/project/src/A.tsx';

  const runLoader = (options: { root: string; tagComponents?: boolean; skipComponentsFrom?: string[] }, src = code) => {
    let out = '';
    redlineLoader.call(
      { resourcePath: file, getOptions: () => options, callback: (_err: Error | null, result?: string) => void (out = result ?? '') },
      src,
    );
    return out;
  };

  // Runs the plugin in a real in-memory Vite build (no server, nothing written) and captures the module after Redline.
  const viteRoot = mkdtempSync(path.join(os.tmpdir(), 'redline-vite-'));
  const viteFile = path.join(viteRoot, 'src/A.tsx');
  const runVite = async (options: RedlineViteOptions, src = code) => {
    let out = '';
    await build({
      root: viteRoot,
      configFile: false,
      logLevel: 'silent',
      build: { write: false, rollupOptions: { input: viteFile } },
      plugins: [
        redline({ enabled: true, ...options, history: false }),
        {
          name: 'capture',
          enforce: 'pre',
          resolveId: (id) => (id === viteFile ? id : null),
          load: (id) => (id === viteFile ? src : null),
          transform(result, id) {
            if (id !== viteFile) return null;
            out = result;
            return 'export {};';
          },
        },
      ],
    });
    return out;
  };

  it('tags components by default and only host elements with tagComponents: false', async () => {
    expect(runLoader({ root })).toContain('<Card data-redline-source="src/A.tsx:1-1">');
    expect(await runVite({})).toContain('<Card data-redline-source="src/A.tsx:1-1">');
    expect(runLoader({ root, tagComponents: false })).toBe('export const A = () => <Card><p data-redline-source="src/A.tsx:1-1" /></Card>;');
    expect(await runVite({ tagComponents: false })).toBe('export const A = () => <Card><p data-redline-source="src/A.tsx:1-1" /></Card>;');
  });

  it('passes skipComponentsFrom through the loader and the Vite plugin', async () => {
    const src = `import { Card } from 'ui-kit';\n${code}`;
    const expected = '<Card><p data-redline-source="src/A.tsx:2-2" /></Card>';
    expect(runLoader({ root, skipComponentsFrom: ['ui-kit'] }, src)).toContain(expected);
    expect(await runVite({ skipComponentsFrom: ['ui-kit'] }, src)).toContain(expected);
  });
});
