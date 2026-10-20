import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCli } from '../src/cli';
import { importSnapshot } from '../src/compare/compare';
import { checkConvexTarget, convexImportArgs, readConvexTarget, resolveConvexTarget, restore } from '../src/convex';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })) };
});

const SECRET = 'eyJ2MiI6InNlY3JldC1wYXJ0In0';
const CONVEX_KEYS = ['CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOYMENT', 'CONVEX_SELF_HOSTED_URL', 'CONVEX_URL', 'VITE_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_URL'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-convex-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('convexImportArgs', () => {
  it('adds --yes when stdin is not a TTY', () => {
    expect(convexImportArgs('s.zip', { tty: false })).toEqual(['import', '--yes', 's.zip']);
  });

  it('leaves --yes out on a TTY without flags; restore asks first and then passes yes', () => {
    expect(convexImportArgs('s.zip', { tty: true })).toEqual(['import', 's.zip']);
    expect(convexImportArgs('s.zip', { tty: true, yes: true })).toEqual(['import', '--yes', 's.zip']);
  });

  it('adds --yes with --replace, and keeps --replace', () => {
    expect(convexImportArgs('s.zip', { tty: true, replace: true })).toEqual(['import', '--replace', '--yes', 's.zip']);
  });
});

describe('resolveConvexTarget', () => {
  const file = (name: string, vars: Record<string, string>) => ({ name, vars });

  it('reads the kind and name of a deploy key, never the secret', () => {
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: `prod:happy-otter-123|${SECRET}` }, envFiles: [] })).toEqual({ kind: 'prod', name: 'happy-otter-123', source: 'CONVEX_DEPLOY_KEY in the environment' });
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: `preview:team:app|${SECRET}` }, envFiles: [] })).toMatchObject({ kind: 'preview', name: 'team:app' });
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: `dev:calm-cat-1|${SECRET}` }, envFiles: [] })).toMatchObject({ kind: 'dev', name: 'calm-cat-1' });
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: SECRET }, envFiles: [] })).toEqual({ kind: 'unknown', source: 'CONVEX_DEPLOY_KEY in the environment' });
  });

  it('reads CONVEX_DEPLOYMENT from the environment, then .env.local, then .env', () => {
    for (const kind of ['prod', 'dev', 'preview', 'local', 'anonymous']) {
      expect(resolveConvexTarget({ env: { CONVEX_DEPLOYMENT: `${kind}:x-1` }, envFiles: [] })).toEqual({ kind, name: 'x-1', source: 'CONVEX_DEPLOYMENT in the environment' });
    }
    const envFiles = [file('.env.local', { CONVEX_DEPLOYMENT: 'dev:a' }), file('.env', { CONVEX_DEPLOYMENT: 'prod:b' })];
    expect(resolveConvexTarget({ env: {}, envFiles })).toEqual({ kind: 'dev', name: 'a', source: 'CONVEX_DEPLOYMENT in .env.local' });
    expect(resolveConvexTarget({ env: {}, envFiles: envFiles.slice(1) })).toEqual({ kind: 'prod', name: 'b', source: 'CONVEX_DEPLOYMENT in .env' });
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOYMENT: 'local:c' }, envFiles })).toMatchObject({ kind: 'local', name: 'c' });
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOYMENT: 'bare-name' }, envFiles: [] })).toMatchObject({ kind: 'unknown', name: 'bare-name' });
  });

  it('puts a deploy key before CONVEX_DEPLOYMENT, and both before a URL', () => {
    const envFiles = [file('.env.local', { CONVEX_DEPLOYMENT: 'dev:a', VITE_CONVEX_URL: 'http://127.0.0.1:3210' })];
    expect(resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: `prod:p|${SECRET}` }, envFiles })).toMatchObject({ kind: 'prod', name: 'p' });
    expect(resolveConvexTarget({ env: { CONVEX_URL: 'https://x.convex.cloud' }, envFiles })).toMatchObject({ kind: 'dev', name: 'a' });
  });

  it('falls back to a URL: localhost is local, a cloud URL is unknown', () => {
    expect(resolveConvexTarget({ env: {}, envFiles: [file('.env.local', { VITE_CONVEX_URL: 'http://127.0.0.1:3210' })] })).toEqual({ kind: 'local', name: '127.0.0.1', source: 'VITE_CONVEX_URL in .env.local' });
    expect(resolveConvexTarget({ env: { NEXT_PUBLIC_CONVEX_URL: 'http://localhost:3210' }, envFiles: [] })).toMatchObject({ kind: 'local' });
    expect(resolveConvexTarget({ env: { CONVEX_URL: 'https://happy-otter-123.convex.cloud' }, envFiles: [] })).toEqual({ kind: 'unknown', name: 'happy-otter-123.convex.cloud', source: 'CONVEX_URL in the environment' });
    expect(resolveConvexTarget({ env: {}, envFiles: [] })).toEqual({ kind: 'unknown', source: 'no CONVEX_DEPLOY_KEY, CONVEX_DEPLOYMENT or Convex URL found' });
  });
});

describe('checkConvexTarget', () => {
  it('logs the target for dev, local and anonymous deployments', () => {
    expect(checkConvexTarget({ kind: 'dev', name: 'happy-otter-123', source: 'CONVEX_DEPLOYMENT in .env.local' }, { replace: true })).toBe('redline: replacing data in Convex deployment dev:happy-otter-123 (from CONVEX_DEPLOYMENT in .env.local)');
    expect(checkConvexTarget({ kind: 'local', name: 'l', source: 's' }, {})).toBe('redline: importing data into Convex deployment local:l (from s)');
    expect(checkConvexTarget({ kind: 'anonymous', name: 'a', source: 's' }, {})).toContain('anonymous:a');
  });

  it('refuses prod and unknown deployments without allowProd', () => {
    expect(() => checkConvexTarget({ kind: 'prod', name: 'p', source: 's' }, {})).toThrow(/prod:p .*production deployment.*--allow-prod/);
    expect(() => checkConvexTarget({ kind: 'unknown', name: 'x.convex.cloud', source: 's' }, {})).toThrow(/cannot tell whether it is production.*--allow-prod/);
    expect(checkConvexTarget({ kind: 'prod', name: 'p', source: 's' }, { allowProd: true, replace: true })).toBe('redline: replacing data in Convex deployment prod:p (from s)');
  });

  it('never prints the secret part of a deploy key', () => {
    const target = resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: `prod:p|${SECRET}` }, envFiles: [] });
    expect(() => checkConvexTarget(target, {})).toThrow();
    try {
      checkConvexTarget(target, {});
    } catch (err) {
      expect(String(err)).not.toContain(SECRET);
    }
    expect(checkConvexTarget(target, { allowProd: true })).not.toContain(SECRET);
    const bare = resolveConvexTarget({ env: { CONVEX_DEPLOY_KEY: SECRET }, envFiles: [] });
    expect(() => checkConvexTarget(bare, {})).toThrow(/^(?!.*eyJ2)/s);
    expect(checkConvexTarget(bare, { allowProd: true })).not.toContain(SECRET);
  });
});

describe('import guard', () => {
  const zip = path.join(tmp, 'snapshot.zip');
  fs.writeFileSync(zip, '');
  const dir = (name: string, envLocal: string) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, '.env.local'), envLocal);
    return d;
  };
  beforeEach(() => {
    for (const k of CONVEX_KEYS) vi.stubEnv(k, '');
    vi.mocked(spawnSync).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reads the env files in the Convex directory', () => {
    expect(readConvexTarget(dir('read', 'CONVEX_DEPLOYMENT=dev:happy-otter-123 # team: t\n'))).toEqual({ kind: 'dev', name: 'happy-otter-123', source: 'CONVEX_DEPLOYMENT in .env.local' });
  });

  it('importSnapshot refuses prod without spawning, and runs with allowProd', () => {
    const prod = dir('prod', 'CONVEX_DEPLOYMENT=prod:p\n');
    const log = vi.fn();
    expect(() => importSnapshot(prod, zip, { log })).toThrow('production');
    expect(spawnSync).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    importSnapshot(prod, zip, { allowProd: true, log });
    expect(log).toHaveBeenCalledWith('redline: replacing data in Convex deployment prod:p (from CONVEX_DEPLOYMENT in .env.local)');
    expect(spawnSync).toHaveBeenCalledWith('npx', ['convex', 'import', '--replace', '--yes', zip], expect.objectContaining({ cwd: prod }));
  });

  it('importSnapshot refuses a deploy key from the environment, without printing its secret', () => {
    vi.stubEnv('CONVEX_DEPLOY_KEY', `prod:p|${SECRET}`);
    const log = vi.fn();
    expect(() => importSnapshot(dir('key', 'CONVEX_DEPLOYMENT=dev:d\n'), zip, { log })).toThrow(/^(?!.*eyJ2).*CONVEX_DEPLOY_KEY in the environment/s);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('importSnapshot refuses a cloud URL alone, and runs for a local deployment', () => {
    const log = vi.fn();
    expect(() => importSnapshot(dir('cloud', 'VITE_CONVEX_URL=https://x.convex.cloud\n'), zip, { log })).toThrow('cannot tell');
    expect(spawnSync).not.toHaveBeenCalled();
    importSnapshot(dir('local', 'CONVEX_DEPLOYMENT=local:l\n'), zip, { log });
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it('restore refuses prod without spawning, and runs with allowProd', async () => {
    const prod = dir('restore', 'CONVEX_DEPLOYMENT=prod:p\n');
    const log = vi.fn();
    await expect(restore({ root: prod, file: zip, replace: true, log })).rejects.toThrow('production');
    expect(spawnSync).not.toHaveBeenCalled();
    await restore({ root: prod, file: zip, replace: true, allowProd: true, log });
    expect(log).toHaveBeenCalledWith('redline: replacing data in Convex deployment prod:p (from CONVEX_DEPLOYMENT in .env.local)');
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it('--allow-prod reaches compare and restore', () => {
    expect(parseCli(['compare', '--allow-prod'])).toMatchObject({ options: { allowProd: true } });
    expect(parseCli(['restore', '--allow-prod', 's.zip'])).toMatchObject({ options: { allowProd: true } });
    expect(parseCli(['restore', 's.zip'])).toMatchObject({ options: { allowProd: undefined } });
  });
});
