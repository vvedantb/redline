import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildManager, buildPaths, readMeta, resolveStaticFile, writeMeta, type ExecFn } from '../src/build';
import { createMiddleware } from '../src/http';
import { historyBasePath, isFullSha } from '../src/paths';
import { handleRedlineRequest } from '../src/server';

function tmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-build-')));
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

function repo(commits = 3): { root: string; shas: string[] } {
  const root = tmp();
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  const shas: string[] = [];
  for (let i = 0; i < commits; i++) {
    fs.writeFileSync(path.join(root, 'index.html'), `<h1>v${i}</h1>\n`);
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', `v${i}`);
    shas.push(git(root, 'rev-parse', 'HEAD'));
  }
  return { root, shas };
}

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** Fake commands: `git worktree add` makes the directory, installs add a vite package, vite writes dist. */
function fakeExec(opts: { fail?: (sha: string) => boolean; gate?: Promise<void> } = {}) {
  const calls: { cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[] = [];
  let running = 0;
  let maxRunning = 0;
  const exec: ExecFn = async (cmd, args, { cwd, env, log }) => {
    calls.push({ cmd, args, cwd, env });
    log(`ran ${path.basename(cmd)} ${args[0]}\n`);
    if (cmd === 'git' && args[0] === 'worktree') {
      const wt = args[3];
      fs.mkdirSync(wt, { recursive: true });
      fs.writeFileSync(path.join(wt, 'package-lock.json'), '{}\n');
      return;
    }
    if (cmd === 'npm') {
      const pkg = path.join(cwd, 'node_modules', 'vite');
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'vite', bin: { vite: 'bin/vite.js' } }));
      return;
    }
    running++;
    maxRunning = Math.max(maxRunning, running);
    try {
      await opts.gate;
      const base = args[args.indexOf('--base') + 1];
      const sha = base.split('/')[3];
      if (opts.fail?.(sha)) {
        log('error during build\n');
        throw new Error('vite build exited with code 1');
      }
      const out = args[args.indexOf('--outDir') + 1];
      fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(out, 'index.html'), `<script src="${base}assets/app.js"></script>`);
      fs.writeFileSync(path.join(out, 'assets', 'app.js'), 'console.log(1)');
    } finally {
      running--;
    }
  };
  return { exec, calls, maxRunning: () => maxRunning };
}

describe('paths', () => {
  it('lays out one commit under .redline', () => {
    const sha = 'a'.repeat(40);
    const p = buildPaths('/p', sha);
    expect(p.dir).toBe(path.join('/p', '.redline', 'builds', sha));
    expect(p.dist).toBe(path.join(p.dir, 'dist'));
    expect(p.meta).toBe(path.join(p.dir, 'meta.json'));
    expect(p.log).toBe(path.join(p.dir, 'build.log'));
    expect(p.worktree).toBe(path.join('/p', '.redline', 'worktrees', sha));
    expect(p.thumbnail).toBe(path.join('/p', '.redline', 'snapshots', sha, 'thumb.png'));
    expect(historyBasePath(sha)).toBe(`/__redline/h/${sha}/`);
  });

  it('rejects anything but a full SHA', () => {
    expect(isFullSha('abc1234')).toBe(false);
    expect(isFullSha('../'.padEnd(40, 'a'))).toBe(false);
    expect(() => buildPaths('/p', 'HEAD')).toThrow(/full commit SHA/);
  });
});

describe('resolveStaticFile', () => {
  let dist: string;
  beforeEach(() => {
    const dir = tmp();
    dist = path.join(dir, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), 'index');
    fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'js');
    fs.writeFileSync(path.join(dir, 'meta.json'), '{}');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
    fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(dist, 'link.txt'));
  });

  it('serves files and directory indexes', () => {
    expect(resolveStaticFile(dist, '')).toBe(path.join(dist, 'index.html'));
    expect(resolveStaticFile(dist, 'assets/app.js')).toBe(path.join(dist, 'assets', 'app.js'));
  });

  it('falls back to index.html for routes but not for missing assets', () => {
    expect(resolveStaticFile(dist, 'settings/profile')).toBe(path.join(dist, 'index.html'));
    expect(resolveStaticFile(dist, 'assets/missing.js')).toBeNull();
  });

  it('never leaves dist', () => {
    for (const p of ['../meta.json', '..%2Fmeta.json', '%2e%2e/secret.txt', 'assets/../../secret.txt', '..\\secret.txt', 'link.txt', '%00', '%E0%A4%A']) {
      expect(resolveStaticFile(dist, p) ?? '', p).not.toMatch(/meta\.json|secret\.txt|link\.txt/);
    }
    expect(resolveStaticFile(dist, 'link.txt')).toBeNull();
    expect(resolveStaticFile(dist, '%E0%A4%A')).toBeNull();
  });
});

describe('meta.json', () => {
  it('round-trips and rejects malformed files', () => {
    const dir = tmp();
    const file = path.join(dir, 'meta.json');
    const sha = 'b'.repeat(40);
    writeMeta(file, {
      sha,
      shortSha: 'bbbbbbb',
      status: 'failed',
      framework: 'vite',
      queuedAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:01.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
      basePath: historyBasePath(sha),
      error: 'boom',
    });
    expect(readMeta(file)).toMatchObject({ sha, status: 'failed', framework: 'vite', error: 'boom', basePath: `/__redline/h/${sha}/` });
    fs.writeFileSync(file, JSON.stringify({ sha: 'nope', status: 'ready' }));
    expect(readMeta(file)).toBeNull();
    fs.writeFileSync(file, '{');
    expect(readMeta(file)).toBeNull();
  });
});

describe('BuildManager', () => {
  let root: string;
  let shas: string[];
  beforeEach(() => {
    ({ root, shas } = repo());
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('builds one commit at a time and writes meta.json and build.log', async () => {
    const gate = deferred();
    const fake = fakeExec({ gate: gate.promise });
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    builds.enqueue(shas[0]);
    builds.enqueue(shas[1]);
    await new Promise((r) => setTimeout(r, 20));
    expect(builds.get(shas[0])?.status).toBe('building');
    expect(builds.get(shas[1])?.status).toBe('queued');
    gate.resolve();
    await builds.whenIdle();

    expect(fake.maxRunning()).toBe(1);
    for (const sha of shas.slice(0, 2)) {
      const p = buildPaths(root, sha);
      const meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
      expect(meta).toMatchObject({ sha, shortSha: sha.slice(0, 7), status: 'ready', framework: 'vite', basePath: historyBasePath(sha) });
      expect(meta.startedAt).toBeTruthy();
      expect(meta.finishedAt).toBeTruthy();
      expect(fs.readFileSync(p.log, 'utf8')).toContain(`$ git worktree add --detach ${p.worktree} ${sha}`);
      // The worktree is pruned after the build.
      expect(fs.existsSync(p.worktree)).toBe(false);
      expect(builds.distFor(sha)).toBe(p.dist);
    }
    const vite = fake.calls.find((c) => c.cmd === process.execPath);
    expect(vite?.args).toEqual(expect.arrayContaining(['build', '--base', historyBasePath(shas[0]), '--emptyOutDir']));
    expect(vite?.env?.REDLINE).toBe('0');
    // The main tree was not touched.
    expect(git(root, 'rev-parse', 'HEAD')).toBe(shas[2]);
    expect(git(root, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  it('returns the existing job instead of queueing twice', async () => {
    const fake = fakeExec();
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    const a = builds.enqueue(shas[0]);
    const b = builds.enqueue(shas[0]);
    expect(b.queuedAt).toBe(a.queuedAt);
    await builds.whenIdle();
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    expect(fake.calls.filter((c) => c.cmd === process.execPath)).toHaveLength(1);
  });

  it('marks failures, keeps the log tail and re-queues on retry', async () => {
    let fail = true;
    const fake = fakeExec({ fail: () => fail });
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    const failed = builds.get(shas[0]);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('vite build exited with code 1');
    expect(failed?.logTail?.join('\n')).toContain('error during build');
    expect(builds.distFor(shas[0])).toBeNull();
    expect(fs.existsSync(buildPaths(root, shas[0]).worktree)).toBe(false);

    fail = false;
    expect(builds.enqueue(shas[0]).status).toBe('queued');
    await builds.whenIdle();
    expect(builds.get(shas[0])?.status).toBe('ready');
  });

  it('cancels queued builds on remove', async () => {
    const gate = deferred();
    const fake = fakeExec({ gate: gate.promise });
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    builds.enqueue(shas[0]);
    builds.enqueue(shas[1]);
    expect(builds.remove(shas[1])).toBe(true);
    gate.resolve();
    await builds.whenIdle();
    expect(builds.get(shas[1])).toBeNull();
    expect(fs.existsSync(buildPaths(root, shas[1]).dir)).toBe(false);
    expect(fake.calls.filter((c) => c.cmd === process.execPath)).toHaveLength(1);
  });

  it('keeps at most maxReady builds, dropping the least recently viewed', async () => {
    const fake = fakeExec();
    const builds = new BuildManager({ root, exec: fake.exec, capture: false, maxReady: 2 });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    builds.enqueue(shas[1]);
    await builds.whenIdle();
    builds.distFor(shas[0]);
    builds.enqueue(shas[2]);
    await builds.whenIdle();
    expect(builds.list().map((b) => b.sha).sort()).toEqual([shas[0], shas[2]].sort());
    expect(fs.existsSync(buildPaths(root, shas[1]).dir)).toBe(false);
  });

  it('links node_modules when the lockfile is unchanged', async () => {
    fs.mkdirSync(path.join(root, 'node_modules', 'vite'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'vite', 'package.json'), JSON.stringify({ bin: { vite: 'bin/vite.js' } }));
    const fake = fakeExec();
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    expect(builds.get(shas[0])?.status).toBe('ready');
    expect(fake.calls.some((c) => c.cmd === 'npm')).toBe(false);
    const vite = fake.calls.find((c) => c.cmd === process.execPath);
    // Resolved through the link, so it points into the main tree's node_modules.
    expect(vite?.args[0]).toBe(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'));
    // The link was removed with the worktree; the main tree's node_modules is intact.
    expect(fs.existsSync(path.join(root, 'node_modules', 'vite', 'package.json'))).toBe(true);
  });

  it('installs when the lockfile changed', async () => {
    fs.mkdirSync(path.join(root, 'node_modules', 'vite'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{"changed":true}\n');
    const fake = fakeExec();
    const builds = new BuildManager({ root, exec: fake.exec, capture: false });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    expect(fake.calls.find((c) => c.cmd === 'npm')?.args).toEqual(['ci']);
  });

  it('marks builds interrupted by a restart as failed', () => {
    const p = buildPaths(root, shas[0]);
    writeMeta(p.meta, {
      sha: shas[0],
      shortSha: shas[0].slice(0, 7),
      status: 'building',
      framework: 'vite',
      queuedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      basePath: historyBasePath(shas[0]),
    });
    const builds = new BuildManager({ root, exec: fakeExec().exec, capture: false });
    expect(builds.get(shas[0])).toMatchObject({ status: 'failed', error: expect.stringMatching(/Interrupted/) });
  });

  it('fails Next.js builds with a clear message', async () => {
    const builds = new BuildManager({ root, exec: fakeExec().exec, capture: false, framework: 'next' });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    expect(builds.get(shas[0])).toMatchObject({ status: 'failed', framework: 'next', error: expect.stringMatching(/Vite only/) });
  });

  it('reports the thumbnail as pending while capturing, then ready', async () => {
    const gate = deferred();
    let during: string | undefined;
    const builds: BuildManager = new BuildManager({
      root,
      exec: fakeExec().exec,
      capture: async ({ out }) => {
        during = builds.get(shas[0])?.thumbnail;
        await gate.promise;
        fs.writeFileSync(out, 'png');
        return true;
      },
    });
    builds.enqueue(shas[0]);
    await new Promise((r) => setTimeout(r, 50));
    expect(builds.get(shas[0])).toMatchObject({ status: 'ready', thumbnail: 'pending' });
    gate.resolve();
    await builds.whenIdle();
    expect(during).toBe('pending');
    expect(builds.get(shas[0])?.thumbnail).toBe('ready');
    expect(builds.thumbnailFile(shas[0])).toBe(buildPaths(root, shas[0]).thumbnail);
  });

  it('keeps the build when thumbnail capture fails', async () => {
    const builds = new BuildManager({
      root,
      exec: fakeExec().exec,
      capture: async () => {
        throw new Error('no browser');
      },
    });
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    expect(builds.get(shas[0])).toMatchObject({ status: 'ready', thumbnail: 'none' });
  });
});

describe('build endpoints', () => {
  let root: string;
  let shas: string[];
  let builds: BuildManager;
  beforeEach(() => {
    ({ root, shas } = repo(2));
    builds = new BuildManager({ root, exec: fakeExec().exec, capture: false });
  });

  it('answers 501 without a build manager', () => {
    expect(handleRedlineRequest({ root }, 'build', 'GET', new URLSearchParams(), {}).status).toBe(501);
  });

  it('queues, lists, reads logs and deletes', async () => {
    const opts = { root, builds };
    const post = handleRedlineRequest(opts, 'build', 'POST', new URLSearchParams(), { sha: 'HEAD~1' });
    expect(post.status).toBe(202);
    expect(post.body).toMatchObject({ build: { sha: shas[0], status: 'queued' } });
    await builds.whenIdle();

    const one = handleRedlineRequest(opts, 'build', 'GET', new URLSearchParams({ sha: shas[0] }), {});
    expect(one.body).toMatchObject({ build: { sha: shas[0], status: 'ready' } });
    const list = handleRedlineRequest(opts, 'build', 'GET', new URLSearchParams(), {});
    expect(list.body).toMatchObject({ enabled: true, builds: [{ sha: shas[0] }] });
    const log = handleRedlineRequest(opts, 'build/log', 'GET', new URLSearchParams({ sha: shas[0] }), {});
    expect(log.text).toContain('Ready at');

    const del = handleRedlineRequest(opts, 'build', 'DELETE', new URLSearchParams({ sha: shas[0] }), {});
    expect(del.body).toMatchObject({ removed: true });
    expect(builds.list()).toEqual([]);
  });

  it('rejects bad refs', () => {
    const res = handleRedlineRequest({ root, builds }, 'build', 'POST', new URLSearchParams(), { sha: '--output=/tmp/x' });
    expect(res.status).toBe(400);
  });

  it('serves ready builds under /__redline/h/<sha>/ only', async () => {
    builds.enqueue(shas[0]);
    await builds.whenIdle();
    const mw = createMiddleware(() => ({ root, builds }));
    const server = http.createServer((req, res) => void mw(req, res, () => res.writeHead(418).end()));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });
    try {
      const base = historyBasePath(shas[0]);
      const index = await get(base);
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toContain('text/html');
      expect(await index.text()).toContain(`${base}assets/app.js`);
      expect((await get(`${base}assets/app.js`)).headers.get('content-type')).toContain('javascript');
      expect((await get(`${base}some/route`)).status).toBe(200);
      expect((await get(`${base}..%2Fmeta.json`)).status).toBe(404);
      expect((await get(`${base}%2e%2e/build.log`)).status).toBe(404);
      expect((await get(`/__redline/h/${shas[0]}`)).status).toBe(308);
      expect((await get(`/__redline/h/${shas[1]}/`)).status).toBe(404);
      expect((await get('/__redline/h/HEAD/')).status).toBe(404);
      const log = await get(`/__redline/build/log?sha=${shas[0]}`);
      expect(log.headers.get('content-type')).toContain('text/plain');
    } finally {
      server.close();
    }
  });
});
