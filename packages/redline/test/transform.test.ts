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

  const runLoader = (options: { root: string; tagComponents?: boolean }) => {
    let out = '';
    redlineLoader.call(
      { resourcePath: file, getOptions: () => options, callback: (_err: Error | null, result?: string) => void (out = result ?? '') },
      code,
    );
    return out;
  };

  // The plugin's hooks are plain functions; this is the slice of the Vite API the test calls.
  type ViteHooks = {
    configResolved(config: { root: string; command: string }): void;
    transform(code: string, id: string): { code: string } | null;
  };
  const runVite = (options: RedlineViteOptions) => {
    const plugin = redline({ ...options, history: false }) as unknown as ViteHooks;
    plugin.configResolved({ root, command: 'serve' });
    return plugin.transform(code, file)?.code ?? '';
  };

  it('tags components by default and only host elements with tagComponents: false', () => {
    expect(runLoader({ root })).toContain('<Card data-redline-source="src/A.tsx:1-1">');
    expect(runVite({})).toContain('<Card data-redline-source="src/A.tsx:1-1">');
    expect(runLoader({ root, tagComponents: false })).toBe('export const A = () => <Card><p data-redline-source="src/A.tsx:1-1" /></Card>;');
    expect(runVite({ tagComponents: false })).toBe('export const A = () => <Card><p data-redline-source="src/A.tsx:1-1" /></Card>;');
  });
});
