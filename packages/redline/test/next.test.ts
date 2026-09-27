import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TURBOPACK_GLOB,
  createRedlineHandler,
  loaderPath,
  mergeTurbopackRules,
  redlineAction,
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
    expect(arr[0]).toEqual({ source: '/__redline/:path*', destination: '/api/redline/:path*' });
    expect(arr).toHaveLength(2);
    const obj = await withRedline({ rewrites: async () => ({ afterFiles: [] }) }, { apiRoute: '/api/rl/' }).rewrites!();
    expect(obj.beforeFiles[0].destination).toBe('/api/rl/:path*');
  });

  it('is off under REDLINE=0 even with enabled: true', () => {
    const input = { reactStrictMode: true };
    process.env.REDLINE = '0';
    try {
      expect(withRedline(input, { enabled: true })).toBe(input);
    } finally {
      delete process.env.REDLINE;
    }
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

describe('redlineAction', () => {
  it('reads the action after the API route or /__redline', () => {
    expect(redlineAction('/api/redline/diff')).toBe('diff');
    expect(redlineAction('/api/redline/build/log/')).toBe('build/log');
    expect(redlineAction('/__redline/build/thumb')).toBe('build/thumb');
    expect(redlineAction('/api/rl/pin', '/api/rl/')).toBe('pin');
    expect(redlineAction(`/api/redline/h/${'a'.repeat(40)}/`)).toBe(`h/${'a'.repeat(40)}/`);
    expect(redlineAction('/elsewhere/baseline')).toBe('baseline');
  });
});

describe('createRedlineHandler history', () => {
  function repo(): { root: string; sha: string } {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-next-history-')));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    // Not a Next.js app, so the job fails fast without installing anything.
    fs.writeFileSync(path.join(root, 'README.md'), 'hi\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    return { root, sha: git('rev-parse', 'HEAD') };
  }

  it('attaches a Next.js BuildManager, so build requests queue a job instead of answering 501', async () => {
    const { root, sha } = repo();
    const handler = createRedlineHandler({ root, enabled: true, history: { thumbnails: false } });
    expect(Object.keys(handler).sort()).toEqual(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
    const post = await handler.POST(new Request('http://x/api/redline/build', { method: 'POST', body: JSON.stringify({ sha: 'HEAD' }) }));
    expect(post.status).toBe(202);
    expect((await post.json()).build).toMatchObject({ sha, framework: 'next', basePath: `/__redline/h/${sha}/` });

    let build: { status: string; error?: string } = { status: 'queued' };
    for (let i = 0; i < 100 && (build.status === 'queued' || build.status === 'building'); i++) {
      await new Promise((r) => setTimeout(r, 20));
      build = (await (await handler.GET(new Request(`http://x/api/redline/build?sha=${sha}`))).json()).build;
    }
    expect(build).toMatchObject({ status: 'failed', error: expect.stringMatching(/No Next.js app/) });

    // A second handler for the same app (a route module reload) shares the job.
    const again = createRedlineHandler({ root, enabled: true });
    expect((await (await again.GET(new Request('http://x/api/redline/build'))).json()).builds).toHaveLength(1);

    const log = await handler.GET(new Request(`http://x/api/redline/build/log?sha=${sha}`));
    expect(log.headers.get('content-type')).toContain('text/plain');
    const del = await handler.DELETE(new Request(`http://x/api/redline/build?sha=${sha}`, { method: 'DELETE' }));
    expect((await del.json()).removed).toBe(true);
    expect((await handler.GET(new Request(`http://x/__redline/h/${sha}/`))).status).toBe(404);
  });

  it('answers 501 with history: false', async () => {
    const { root } = repo();
    const { GET } = createRedlineHandler({ root, enabled: true, history: false });
    expect((await GET(new Request('http://x/api/redline/build'))).status).toBe(501);
  });
});
