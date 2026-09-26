import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRedlineHandler, withRedline } from '../src/next';

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
