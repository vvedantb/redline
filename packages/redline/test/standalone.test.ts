import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildManager, buildPaths, type ExecFn } from '../src/build';
import { handleRedlineNextRequest } from '../src/next';
import { historyBasePath } from '../src/paths';
import {
  ServerPool,
  USER_CONFIG_BASENAME,
  assembleStandalone,
  copyEnvFiles,
  findNextConfig,
  historyTarget,
  isNextApp,
  nextBuildFlags,
  proxyRequest,
  snapshotEnv,
  standaloneServerDir,
  writeSnapshotConfig,
  type ServerProcess,
  type SpawnServerFn,
  type SpawnServerInput,
} from '../src/standalone';

function tmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-next-build-')));
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();
}

const SHA = 'c'.repeat(40);

/** Load an ESM config in a real Node process (the test runner cannot import files outside the project). */
function loadEsmConfig(file: string): Record<string, any> {
  const script = `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(JSON.stringify(await m.default('phase-production-build', {})));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
}
const overrides = { basePath: `/__redline/h/${SHA}`, tracingRoot: '/repo' };

describe('Next.js detection', () => {
  it('finds a config, a next dependency, or an app or pages directory', () => {
    const dir = tmp();
    expect(isNextApp(dir)).toBe(false);
    write(path.join(dir, 'next.config.ts'), 'export default {}');
    expect(findNextConfig(dir)).toBe(path.join(dir, 'next.config.ts'));
    expect(isNextApp(dir)).toBe(true);

    const dep = tmp();
    write(path.join(dep, 'package.json'), JSON.stringify({ dependencies: { next: '16.0.0' } }));
    expect(isNextApp(dep)).toBe(true);

    const pages = tmp();
    fs.mkdirSync(path.join(pages, 'src', 'app'), { recursive: true });
    expect(isNextApp(pages)).toBe(true);
  });

  it('passes --webpack through when the build script uses it', () => {
    const dir = tmp();
    expect(nextBuildFlags(dir)).toEqual([]);
    write(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'next build --webpack' } }));
    expect(nextBuildFlags(dir)).toEqual(['--webpack']);
  });
});

describe('snapshot config', () => {
  it('wraps an ESM config function and forces standalone output', () => {
    const dir = tmp();
    write(
      path.join(dir, 'next.config.mjs'),
      `export default async (phase) => ({
        phase,
        reactStrictMode: true,
        output: 'export',
        assetPrefix: 'https://cdn.example',
        env: { A: '1', NEXT_PUBLIC_REDLINE: '1' },
        turbopack: { rules: { '*.svg': ['svgr'] } },
      });`,
    );
    const wrapper = writeSnapshotConfig(dir, overrides);
    expect(wrapper).toBe(path.join(dir, 'next.config.mjs'));
    expect(fs.existsSync(path.join(dir, `${USER_CONFIG_BASENAME}.mjs`))).toBe(true);
    const config = loadEsmConfig(wrapper);
    expect(config).toMatchObject({
      phase: 'phase-production-build',
      reactStrictMode: true,
      output: 'standalone',
      basePath: overrides.basePath,
      distDir: '.next',
      outputFileTracingRoot: '/repo',
      env: { A: '1' },
      turbopack: { root: '/repo', rules: { '*.svg': ['svgr'] } },
    });
    expect(config.env.NEXT_PUBLIC_REDLINE).toBeUndefined();
    expect('assetPrefix' in config).toBe(false);
  });

  it('wraps a CommonJS next.config.js', async () => {
    const dir = tmp();
    write(path.join(dir, 'next.config.js'), 'module.exports = { poweredByHeader: false };');
    const wrapper = writeSnapshotConfig(dir, overrides);
    expect(fs.readFileSync(wrapper, 'utf8')).toContain(`require("./${USER_CONFIG_BASENAME}.js")`);
    const config = await createRequire(import.meta.url)(wrapper)();
    expect(config).toMatchObject({ poweredByHeader: false, output: 'standalone' });
  });

  it('imports a TypeScript config without an extension and skips type checks', () => {
    const dir = tmp();
    write(path.join(dir, 'next.config.ts'), 'const c: object = {}; export default c;');
    const source = fs.readFileSync(writeSnapshotConfig(dir, overrides), 'utf8');
    expect(source.startsWith('// @ts-nocheck')).toBe(true);
    expect(source).toContain(`import user from "./${USER_CONFIG_BASENAME}";`);
    expect(fs.existsSync(path.join(dir, `${USER_CONFIG_BASENAME}.ts`))).toBe(true);
  });

  it('writes a config when the app has none', () => {
    const dir = tmp();
    const wrapper = writeSnapshotConfig(dir, overrides);
    const config = loadEsmConfig(wrapper);
    expect(config).toMatchObject({ output: 'standalone', basePath: overrides.basePath });
  });
});

describe('copyEnvFiles', () => {
  it('copies env files, keeps existing ones and ignores the rest', () => {
    const from = tmp();
    const to = tmp();
    for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.staging.local', '.env.example', '.envrc']) {
      write(path.join(from, name), `${name}=live`);
    }
    fs.mkdirSync(path.join(from, '.env.d.local'));
    write(path.join(to, '.env'), 'committed');
    expect(copyEnvFiles(from, to)).toEqual(['.env.development', '.env.local', '.env.production', '.env.staging.local']);
    expect(fs.readFileSync(path.join(to, '.env'), 'utf8')).toBe('committed');
    expect(fs.existsSync(path.join(to, '.env.example'))).toBe(false);
    expect(copyEnvFiles(path.join(from, 'missing'), to)).toEqual([]);
  });
});

describe('snapshotEnv', () => {
  it('drops dev-server variables and turns Redline off', () => {
    const env = snapshotEnv({
      DATABASE_URL: 'postgres://x',
      __NEXT_PRIVATE_ORIGIN: 'http://localhost:3000',
      NEXT_PRIVATE_WORKER: '1',
      TURBOPACK: '1',
      NEXT_PUBLIC_REDLINE: '1',
      PORT: '3000',
      NODE_ENV: 'development',
    });
    expect(env).toEqual({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', REDLINE: '0', NEXT_TELEMETRY_DISABLED: '1' });
  });
});

describe('historyTarget', () => {
  it('keeps the base path and rejects traversal', () => {
    expect(historyTarget(`h/${SHA}/`)).toEqual({ sha: SHA, path: `/__redline/h/${SHA}/` });
    expect(historyTarget(`h/${SHA}`)).toEqual({ sha: SHA, path: `/__redline/h/${SHA}` });
    expect(historyTarget(`h/${SHA}/_next/static/a%20b.js`)?.path).toBe(`/__redline/h/${SHA}/_next/static/a%20b.js`);
    for (const bad of ['..', '%2e%2e', '.', '..%2Fmeta.json', 'a%2F..', 'a%5C..', '%00', '%E0%A4%A']) {
      expect(historyTarget(`h/${SHA}/x/${bad}/y`), bad).toBeNull();
    }
    expect(historyTarget('h/HEAD/')).toBeNull();
    expect(historyTarget(`build/${SHA}`)).toBeNull();
  });
});

describe('assembleStandalone', () => {
  it('moves the server, static assets and public into the build, mirroring the app path', () => {
    const top = tmp();
    const app = path.join(top, 'apps', 'web');
    write(path.join(app, '.next', 'standalone', 'apps', 'web', 'server.js'), 'server');
    write(path.join(app, '.next', 'standalone', 'node_modules', 'next', 'index.js'), 'next');
    write(path.join(app, '.next', 'static', 'chunks', 'a.js'), 'chunk');
    write(path.join(app, 'public', 'logo.svg'), '<svg/>');
    const out = path.join(tmp(), 'standalone');
    const serverDir = assembleStandalone(app, out, top);
    expect(serverDir).toBe(standaloneServerDir(out, top, app));
    expect(serverDir).toBe(path.join(out, 'apps', 'web'));
    expect(fs.readFileSync(path.join(serverDir, '.next', 'static', 'chunks', 'a.js'), 'utf8')).toBe('chunk');
    expect(fs.existsSync(path.join(serverDir, 'public', 'logo.svg'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'node_modules', 'next', 'index.js'))).toBe(true);
  });

  it('fails without server.js', () => {
    const app = tmp();
    fs.mkdirSync(path.join(app, '.next', 'standalone'), { recursive: true });
    expect(() => assembleStandalone(app, path.join(tmp(), 'standalone'), app)).toThrow(/server\.js/);
  });
});

/** Fake `node server.js`: an in-process HTTP server on the given port. */
function fakeServers(opts: { listen?: boolean; exitAt?: number } = {}) {
  const started: SpawnServerInput[] = [];
  const killed: number[] = [];
  const spawn: SpawnServerFn = (input) => {
    started.push(input);
    const listeners: ((code: number | null) => void)[] = [];
    const exit = (code: number | null) => listeners.splice(0).forEach((l) => l(code));
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.end(`served ${req.url} cwd=${input.cwd} redline=${input.env.REDLINE}`);
    });
    if (opts.listen !== false) server.listen(input.port, '127.0.0.1');
    if (opts.exitAt !== undefined) setTimeout(() => exit(opts.exitAt ?? null), 10);
    const proc: ServerProcess = {
      kill: () => {
        killed.push(input.port);
        server.close();
        exit(null);
      },
      onExit: (l) => listeners.push(l),
    };
    return proc;
  };
  return { spawn, started, killed };
}

const serverInput = { script: '/x/server.js', cwd: '/x', env: { REDLINE: '0' }, log: () => {} };

describe('ServerPool', () => {
  it('starts one server per key on a free port and reuses it', async () => {
    const fake = fakeServers();
    const pool = new ServerPool({ spawn: fake.spawn });
    const [a, b] = await Promise.all([pool.start('k', serverInput), pool.start('k', serverInput)]);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(fake.started).toHaveLength(1);
    expect(await (await fetch(`http://127.0.0.1:${a}/p`)).text()).toContain('served /p');
    pool.stop('k');
    expect(fake.killed).toEqual([a]);
    expect(pool.has('k')).toBe(false);
    await pool.start('k', serverInput);
    expect(fake.started).toHaveLength(2);
    pool.stopAll();
  });

  it('rejects when the server exits before it is ready, then can start again', async () => {
    const pool = new ServerPool({ spawn: fakeServers({ listen: false, exitAt: 1 }).spawn });
    await expect(pool.start('k', serverInput)).rejects.toThrow(/exited with code 1/);
    expect(pool.has('k')).toBe(false);
  });

  it('kills a server that never accepts connections', async () => {
    const fake = fakeServers({ listen: false });
    const pool = new ServerPool({ spawn: fake.spawn, startTimeoutMs: 200 });
    await expect(pool.start('k', serverInput)).rejects.toThrow(/did not accept connections/);
    expect(fake.killed).toHaveLength(1);
  });
});

async function listen(handler: http.RequestListener): Promise<{ origin: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

describe('proxyRequest', () => {
  it('forwards method, body and headers, and keeps redirects and cookies same-origin', async () => {
    const upstream = await listen((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/go') {
          res.writeHead(307, { Location: `http://${req.headers.host}/there` });
          return res.end();
        }
        res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ method: req.method, url: req.url, body, forwardedHost: req.headers['x-forwarded-host'], rsc: req.headers.rsc }));
      });
    });
    try {
      const request = new Request('http://localhost:3000/__redline/h/x/api?q=1', {
        method: 'POST',
        headers: { rsc: '1', 'content-type': 'text/plain' },
        body: 'hello',
      });
      const res = await proxyRequest(request, upstream.origin, '/__redline/h/x/api?q=1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ method: 'POST', url: '/__redline/h/x/api?q=1', body: 'hello', forwardedHost: 'localhost:3000', rsc: '1' });
      expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/']);

      const redirect = await proxyRequest(new Request('http://localhost:3000/go'), upstream.origin, '/go');
      expect(redirect.status).toBe(307);
      expect(redirect.headers.get('location')).toBe('/there');
    } finally {
      upstream.close();
    }
  });

  it('answers 502 when the server is gone', async () => {
    const res = await proxyRequest(new Request('http://localhost/x'), 'http://127.0.0.1:1', '/x');
    expect(res.status).toBe(502);
  });
});

/**
 * Fake commands for a Next.js build: real `git`, `npm` adds a `next` package, and `next build`
 * records what it saw and writes `.next/standalone` mirrored from the git top level.
 */
function fakeNextExec(top: string, opts: { fail?: boolean } = {}) {
  const builds: { cwd: string; args: string[]; env?: NodeJS.ProcessEnv; config: string; files: string[] }[] = [];
  const cmds: string[] = [];
  const exec: ExecFn = async (cmd, args, { cwd, env, log }) => {
    cmds.push(cmd === process.execPath ? `node ${args[1]}` : `${cmd} ${args[0]}`);
    if (cmd === 'git') {
      execFileSync('git', args, { cwd, stdio: 'ignore' });
      return;
    }
    if (cmd === 'npm') {
      write(path.join(cwd, 'node_modules', 'next', 'package.json'), JSON.stringify({ name: 'next', bin: { next: 'dist/bin/next' } }));
      return;
    }
    const config = findNextConfig(cwd);
    const worktreeTop = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
    builds.push({
      cwd,
      args,
      env,
      config: config ? fs.readFileSync(config, 'utf8') : '',
      files: [...fs.readdirSync(worktreeTop).map((n) => `/${n}`), ...fs.readdirSync(cwd)].sort(),
    });
    if (opts.fail) {
      log('Type error: nope\n');
      throw new Error('next build exited with code 1');
    }
    const out = path.join(cwd, '.next', 'standalone');
    write(path.join(out, path.relative(top, cwd), 'server.js'), 'server');
    write(path.join(out, 'node_modules', 'next', 'index.js'), 'next');
    write(path.join(cwd, '.next', 'static', 'chunks', 'a.js'), 'chunk');
  };
  return { exec, builds, cmds };
}

/** A repo with a Next.js app at `app` (`''` for the top level) and gitignored env files. */
function nextRepo(app: string): { top: string; appDir: string; shas: string[] } {
  const top = tmp();
  const appDir = path.join(top, app);
  git(top, 'init', '-q');
  write(path.join(top, '.gitignore'), '.redline/\nnode_modules/\n.env.local\n');
  write(path.join(top, 'package-lock.json'), '{}\n');
  write(path.join(appDir, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '16.0.0' } }));
  write(path.join(appDir, 'next.config.mjs'), 'export default { reactStrictMode: true };\n');
  write(path.join(appDir, 'public', 'logo.svg'), '<svg/>');
  const shas: string[] = [];
  for (let i = 0; i < 2; i++) {
    write(path.join(appDir, 'app', 'page.tsx'), `export default () => <h1>v${i}</h1>;\n`);
    git(top, 'add', '.');
    git(top, 'commit', '-q', '-m', `v${i}`);
    shas.push(git(top, 'rev-parse', 'HEAD'));
  }
  write(path.join(top, '.env.local'), 'DATABASE_URL=live\n');
  if (app) write(path.join(appDir, '.env.local'), 'AUTH_SECRET=live\n');
  return { top, appDir, shas };
}

describe('Next.js History builds', () => {
  let top: string;
  let appDir: string;
  let shas: string[];
  afterEach(() => {
    fs.rmSync(top, { recursive: true, force: true });
  });

  describe('single app', () => {
    beforeEach(() => {
      ({ top, appDir, shas } = nextRepo(''));
    });

    it('builds standalone in a worktree with Redline off and env files copied', async () => {
      const fake = fakeNextExec(top);
      const builds = new BuildManager({ root: top, framework: 'next', exec: fake.exec, capture: false });
      builds.enqueue(shas[0]);
      await builds.whenIdle();

      const p = buildPaths(top, shas[0]);
      expect(builds.get(shas[0])).toMatchObject({ status: 'ready', framework: 'next', basePath: historyBasePath(shas[0]) });
      expect(JSON.parse(fs.readFileSync(p.meta, 'utf8'))).toMatchObject({ framework: 'next', status: 'ready' });
      expect(fake.cmds).toEqual(['git worktree', 'npm ci', 'node build']);

      const [build] = fake.builds;
      expect(build.cwd).toBe(p.worktree);
      expect(build.env).toMatchObject({ REDLINE: '0', NODE_ENV: 'production' });
      expect(build.env?.NEXT_PUBLIC_REDLINE).toBeUndefined();
      expect(build.config).toContain(`import user from "./${USER_CONFIG_BASENAME}.mjs"`);
      expect(build.config).toContain(`const basePath = "/__redline/h/${shas[0]}"`);
      expect(build.config).toContain(`const tracingRoot = ${JSON.stringify(top)}`);
      expect(build.files).toContain('.env.local');

      const serverDir = path.join(p.standalone, '.redline', 'worktrees', shas[0]);
      expect(fs.existsSync(path.join(serverDir, 'server.js'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, '.next', 'static', 'chunks', 'a.js'))).toBe(true);
      expect(fs.existsSync(path.join(serverDir, 'public', 'logo.svg'))).toBe(true);
      expect(fs.existsSync(path.join(p.dist, 'index.html'))).toBe(false);
      expect(builds.distFor(shas[0])).toBeNull();

      // The worktree is pruned and the main tree is untouched.
      expect(fs.existsSync(p.worktree)).toBe(false);
      expect(git(top, 'worktree', 'list')).not.toContain('.redline');
      expect(git(top, 'rev-parse', 'HEAD')).toBe(shas[1]);
      expect(git(top, 'status', '--porcelain')).toBe('');
      expect(fs.readFileSync(path.join(top, 'next.config.mjs'), 'utf8')).toBe('export default { reactStrictMode: true };\n');
    });

    it('links node_modules and resolves next through the link when the lockfile is unchanged', async () => {
      write(path.join(top, 'node_modules', 'next', 'package.json'), JSON.stringify({ bin: { next: 'dist/bin/next' } }));
      const fake = fakeNextExec(top);
      const builds = new BuildManager({ root: top, framework: 'next', exec: fake.exec, capture: false });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      expect(builds.get(shas[0])?.status).toBe('ready');
      expect(fake.cmds).toEqual(['git worktree', 'node build']);
      expect(fake.builds[0].args[0]).toBe(path.join(top, 'node_modules', 'next', 'dist', 'bin', 'next'));
      expect(fs.existsSync(path.join(top, 'node_modules', 'next', 'package.json'))).toBe(true);
    });

    it('checks server.js, not index.html, to decide a build is ready', async () => {
      const fake = fakeNextExec(top);
      const builds = new BuildManager({ root: top, framework: 'next', exec: fake.exec, capture: false });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      expect(builds.enqueue(shas[0]).status).toBe('ready');
      // A restart reads the job from disk and still finds server.js.
      const again = new BuildManager({ root: top, framework: 'next', exec: fake.exec, capture: false });
      expect(again.enqueue(shas[0]).status).toBe('ready');
      fs.rmSync(path.join(buildPaths(top, shas[0]).standalone, '.redline', 'worktrees', shas[0], 'server.js'));
      expect(again.enqueue(shas[0]).status).toBe('queued');
      await again.whenIdle();
    });

    it('marks a failed next build with the log tail and prunes the worktree', async () => {
      const builds = new BuildManager({ root: top, framework: 'next', exec: fakeNextExec(top, { fail: true }).exec, capture: false });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      const job = builds.get(shas[0]);
      expect(job).toMatchObject({ status: 'failed', error: 'next build exited with code 1' });
      expect(job?.logTail?.join('\n')).toContain('Type error: nope');
      expect(fs.existsSync(buildPaths(top, shas[0]).worktree)).toBe(false);
    });

    it('starts server.js on first view, proxies /__redline/h/<sha>/ to it and stops it on remove', async () => {
      const servers = fakeServers();
      const builds = new BuildManager({ root: top, framework: 'next', exec: fakeNextExec(top).exec, capture: false, spawnServer: servers.spawn });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      expect(servers.started).toHaveLength(0);

      const opts = { root: top, builds };
      const get = (p: string) => handleRedlineNextRequest(new Request(`http://localhost:3000${p}`), opts);
      const base = historyBasePath(shas[0]);
      const page = await get(`/api/redline/h/${shas[0]}/about?tab=1`);
      expect(page.status).toBe(200);
      const serverDir = path.join(buildPaths(top, shas[0]).standalone, '.redline', 'worktrees', shas[0]);
      expect(await page.text()).toBe(`served ${base}about?tab=1 cwd=${serverDir} redline=0`);
      // The un-rewritten path works too, and the server is reused.
      expect(await (await get(`${base}_next/static/chunks/a.js`)).text()).toContain(`served ${base}_next/static/chunks/a.js`);
      expect(servers.started).toHaveLength(1);
      expect(servers.started[0].script).toBe(path.join(serverDir, 'server.js'));

      expect((await get(`/api/redline/h/${shas[0]}/..%2F..%2Fmeta.json`)).status).toBe(404);
      expect((await get(`/api/redline/h/${shas[1]}/`)).status).toBe(404);
      expect((await get('/api/redline/h/HEAD/')).status).toBe(404);
      expect((await handleRedlineNextRequest(new Request(`http://x${base}`), { ...opts, enabled: false })).status).toBe(404);

      const port = servers.started[0].port;
      builds.remove(shas[0]);
      expect(servers.killed).toEqual([port]);
    });

    it('reports a server that fails to start as 502', async () => {
      const servers = fakeServers({ listen: false, exitAt: 1 });
      const builds = new BuildManager({ root: top, framework: 'next', exec: fakeNextExec(top).exec, capture: false, spawnServer: servers.spawn });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      const res = await handleRedlineNextRequest(new Request(`http://x${historyBasePath(shas[0])}`), { root: top, builds });
      expect(res.status).toBe(502);
      expect(await res.text()).toMatch(/exited with code 1/);
    });

    it('captures the thumbnail from the standalone server, then stops it', async () => {
      const servers = fakeServers();
      let seen = '';
      const builds = new BuildManager({
        root: top,
        framework: 'next',
        exec: fakeNextExec(top).exec,
        spawnServer: servers.spawn,
        capture: async ({ open, out }) => {
          seen = await (await fetch(await open())).text();
          fs.writeFileSync(out, 'png');
          return true;
        },
      });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      expect(seen).toContain(`served ${historyBasePath(shas[0])}`);
      expect(builds.get(shas[0])?.thumbnail).toBe('ready');
      expect(servers.killed).toHaveLength(1);
    });
  });

  describe('monorepo', () => {
    beforeEach(() => {
      ({ top, appDir, shas } = nextRepo('apps/web'));
    });

    it('builds from the app directory and finds server.js under the mirrored app path', async () => {
      const fake = fakeNextExec(top);
      const servers = fakeServers();
      const builds = new BuildManager({ root: top, configDir: appDir, framework: 'next', exec: fake.exec, capture: false, spawnServer: servers.spawn });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      const p = buildPaths(top, shas[0]);
      expect(builds.get(shas[0])?.status).toBe('ready');
      expect(fake.builds[0].cwd).toBe(path.join(p.worktree, 'apps', 'web'));
      // Env files from the top level and from the app directory.
      expect(fake.builds[0].files).toEqual(expect.arrayContaining(['/.env.local', '.env.local']));
      expect(fs.readFileSync(path.join(appDir, 'next.config.mjs'), 'utf8')).toBe('export default { reactStrictMode: true };\n');

      const serverDir = path.join(p.standalone, '.redline', 'worktrees', shas[0], 'apps', 'web');
      expect(fs.existsSync(path.join(serverDir, 'server.js'))).toBe(true);
      expect(await builds.serverFor(shas[0])).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(servers.started[0].cwd).toBe(serverDir);
      builds.close();
    });

    it('fails with a hint when the app directory is wrong', async () => {
      const fake = fakeNextExec(top);
      const builds = new BuildManager({ root: top, framework: 'next', exec: fake.exec, capture: false });
      builds.enqueue(shas[0]);
      await builds.whenIdle();
      expect(builds.get(shas[0])).toMatchObject({ status: 'failed', error: expect.stringMatching(/history\.appDir/) });
    });
  });
});
