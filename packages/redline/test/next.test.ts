import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TURBOPACK_GLOB,
  createRedlineHandler,
  loaderPath,
  mergeTurbopackRules,
  usesLegacyTurboKey,
  withRedline,
} from '../src/next';

describe('withRedline', () => {
  it('returns a config object for an empty config', () => {
    const config = withRedline({}, { enabled: true });
    expect(typeof config).toBe('object');
    expect(config.env).toEqual({ NEXT_PUBLIC_REDLINE: '1' });
    expect(typeof config.webpack).toBe('function');
  });

  it('keeps existing config and env', () => {
    const config = withRedline({ reactStrictMode: true, env: { A: '1' } }, { enabled: true });
    expect(config.reactStrictMode).toBe(true);
    expect(config.env).toEqual({ A: '1', NEXT_PUBLIC_REDLINE: '1' });
  });

  it('returns the config unchanged when disabled', () => {
    const input = { reactStrictMode: true };
    expect(withRedline(input, { enabled: false })).toBe(input);
  });

  it('adds a pre-loader in dev and chains the user webpack function', () => {
    const calls: string[] = [];
    const config = withRedline({ webpack: (c: any) => (calls.push('user'), c) }, {});
    const out = config.webpack!({ module: { rules: [] } }, { dev: true, dir: '/app' });
    expect(calls).toEqual(['user']);
    expect(out.module.rules).toHaveLength(1);
    expect(out.module.rules[0].enforce).toBe('pre');
    expect(out.module.rules[0].use[0].options.root).toBe('/app');
    expect(out.module.rules[0].test.test('page.tsx')).toBe(true);
  });

  it('does not add the loader for production webpack builds', () => {
    const config = withRedline({}, {});
    const out = config.webpack!({ module: { rules: [] } }, { dev: false });
    expect(out.module.rules).toHaveLength(0);
  });

  it('adds a Turbopack rule that reuses the webpack loader', () => {
    const config = withRedline({}, { enabled: true });
    expect(config.turbopack!.rules[TURBOPACK_GLOB]).toEqual({
      loaders: [{ loader: loaderPath, options: { root: process.cwd() } }],
    });
    expect(config.experimental).toBeUndefined();
  });

  it('keeps user turbopack config and rules', () => {
    const svg = { loaders: ['@svgr/webpack'], as: '*.js' };
    const config = withRedline({ turbopack: { resolveAlias: { a: 'b' }, rules: { '*.svg': svg } } }, { enabled: true });
    expect(config.turbopack!.resolveAlias).toEqual({ a: 'b' });
    expect(config.turbopack!.rules['*.svg']).toBe(svg);
    expect(config.turbopack!.rules[TURBOPACK_GLOB].loaders).toHaveLength(1);
  });

  it('uses experimental.turbo when the user config already does', () => {
    const config = withRedline(
      { experimental: { ppr: true, turbo: { rules: { '*.svg': { loaders: ['svgr'] } } } } },
      { enabled: true },
    );
    expect(config.turbopack).toBeUndefined();
    expect(config.experimental!.ppr).toBe(true);
    expect(Object.keys(config.experimental!.turbo.rules)).toEqual(['*.svg', TURBOPACK_GLOB]);
  });

  it('appends to a user rule for the same glob so Redline runs first', () => {
    const rules = mergeTurbopackRules({ [TURBOPACK_GLOB]: { loaders: ['other'] } }, '/app');
    expect(rules[TURBOPACK_GLOB].loaders).toEqual(['other', { loader: loaderPath, options: { root: '/app' } }]);
  });

  it('picks the Turbopack config key by Next version', () => {
    expect(usesLegacyTurboKey(null)).toBe(false);
    expect(usesLegacyTurboKey([14, 2])).toBe(true);
    expect(usesLegacyTurboKey([15, 2])).toBe(true);
    expect(usesLegacyTurboKey([15, 3])).toBe(false);
    expect(usesLegacyTurboKey([16, 0])).toBe(false);
  });

  it('does not add Turbopack rules when disabled', () => {
    const input = { turbopack: { rules: {} } };
    expect(withRedline(input, { enabled: false }).turbopack).toBe(input.turbopack);
  });

  it('merges rewrites in array and object form', async () => {
    const arr = await withRedline({ rewrites: async () => [{ source: '/a', destination: '/b' }] }, {}).rewrites!();
    expect(arr[0]).toEqual({ source: '/__redline/:action', destination: '/api/redline/:action' });
    expect(arr).toHaveLength(2);
    const obj = await withRedline({ rewrites: async () => ({ afterFiles: [] }) }, { apiRoute: '/api/rl/' }).rewrites!();
    expect(obj.beforeFiles[0].destination).toBe('/api/rl/:action');
  });
});

describe('createRedlineHandler', () => {
  it('answers baseline and pin requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-next-'));
    fs.writeFileSync(path.join(root, 'a.tsx'), 'export const A = () => <p>new</p>;\n');
    const { GET, POST } = createRedlineHandler({ root, enabled: true });

    const empty = await (await GET(new Request('http://x/api/redline/baseline'))).json();
    expect(empty.baseline).toBeNull();

    const pinned = await POST(
      new Request('http://x/api/redline/pin', {
        method: 'POST',
        body: JSON.stringify({ files: { 'a.tsx': 'export const A = () => <p>old</p>;\n' } }),
      }),
    );
    expect(pinned.status).toBe(200);
    const diff = await (await GET(new Request('http://x/api/redline/diff'))).json();
    expect(diff.mode).toBe('content');
    expect(diff.files[0].path).toBe('a.tsx');
  });
});
