import { describe, expect, it } from 'vitest';
import { shouldTransform, transformSource } from '../src/transform';

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
    expect(out.code).toContain('<section data-redline-source="src/Hero.tsx:3-5" className="hero">');
    expect(out.code).toContain('<h1 data-redline-source="src/Hero.tsx:4-4">');
    expect(out.map.mappings.length).toBeGreaterThan(0);
  });

  it('leaves components, fragments and document tags alone', () => {
    const code = 'const A = () => <><Card title="x" /><html><body /></html><Foo.Bar /></>;';
    expect(transformSource(code, '/project/src/A.tsx', { root })).toBeNull();
  });

  it('handles TypeScript syntax and self-closing elements', () => {
    const code = 'const f = <T,>(x: T): T => x;\nexport const I = () => <input type="text" />;';
    const out = transformSource(code, '/project/src/I.tsx', { root })!;
    expect(out.code).toContain('<input data-redline-source="src/I.tsx:2-2" type="text" />');
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
