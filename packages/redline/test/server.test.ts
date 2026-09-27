import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeDiff, getLog, handleRedlineRequest, pinBaseline, readBaseline } from '../src/server';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'redline-'));
}

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

const before = `export function Hero() {
  return (
    <section>
      <h1>Welcome</h1>
    </section>
  );
}
`;
const after = before.replace('Welcome', 'Ship it');

describe('content baseline', () => {
  let root: string;
  beforeEach(() => {
    root = tmp();
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), after);
    fs.writeFileSync(path.join(root, 'src/Footer.tsx'), 'export const F = () => <footer />;\n');
  });

  it('reports no baseline before pinning', () => {
    expect(computeDiff({ root })).toMatchObject({ mode: 'none', files: [] });
  });

  it('diffs pinned contents against the working tree', () => {
    const b = pinBaseline({ root }, { files: { 'src/Hero.tsx': before, 'src/Footer.tsx': 'export const F = () => <footer />;\n' } });
    expect(b.sha).toMatch(/^content:[0-9a-f]{12}$/);
    const diff = computeDiff({ root });
    expect(diff.mode).toBe('content');
    expect(diff.files.map((f) => f.path)).toEqual(['src/Hero.tsx']);
    expect(diff.files[0].hunks[0].changedLines).toEqual([4]);
    expect(diff.files[0].hunks[0].patch).toContain('+      <h1>Ship it</h1>');
  });

  it('clears when re-pinned with current contents', () => {
    pinBaseline({ root }, { files: { 'src/Hero.tsx': before } });
    pinBaseline({ root }, { files: { 'src/Hero.tsx': after } });
    expect(computeDiff({ root }).files).toEqual([]);
  });

  it('rejects paths outside the root', () => {
    const res = handleRedlineRequest({ root }, 'pin', 'POST', new URLSearchParams(), { files: { '../x.tsx': '' } });
    expect(res.status).toBe(400);
  });

  it('reports disabled and refuses to pin when enabled is false', () => {
    const opts = { root, enabled: false };
    expect(handleRedlineRequest(opts, 'diff', 'GET', new URLSearchParams(), {}).body).toMatchObject({ enabled: false });
    expect(handleRedlineRequest(opts, 'pin', 'POST', new URLSearchParams(), {}).status).toBe(403);
    expect(readBaseline(opts)).toBeNull();
  });

  it('returns 404 for unknown actions and 405 for GET pin', () => {
    expect(handleRedlineRequest({ root }, 'nope', 'GET', new URLSearchParams(), {}).status).toBe(404);
    expect(handleRedlineRequest({ root }, 'pin', 'GET', new URLSearchParams(), {}).status).toBe(405);
  });
});

describe('git baseline', () => {
  let root: string;
  let first: string;
  beforeEach(() => {
    root = tmp();
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), before);
    fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'A');
    first = git(root, 'rev-parse', 'HEAD');
  });

  it('pins HEAD by default and shows no diff for a clean tree', () => {
    const b = pinBaseline({ root });
    expect(b).toMatchObject({ mode: 'git', sha: first });
    expect(computeDiff({ root })).toMatchObject({ mode: 'git', baselineSha: first, headSha: first, files: [] });
  });

  it('diffs committed and uncommitted changes against the pinned SHA', () => {
    pinBaseline({ root }, { sha: first });
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), after);
    git(root, 'commit', '-qam', 'B');
    fs.writeFileSync(path.join(root, 'src/New.tsx'), 'export const N = () => <p />;\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'changed\n');
    const diff = computeDiff({ root });
    expect(diff.headSha).not.toBe(first);
    expect(diff.files.map((f) => [f.path, f.status])).toEqual([
      ['src/Hero.tsx', 'modified'],
      ['src/New.tsx', 'added'],
    ]);
  });

  it('accepts a baseline override from the query string', () => {
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), after);
    const res = handleRedlineRequest({ root }, 'diff', 'GET', new URLSearchParams({ baseline: first.slice(0, 7) }), {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'git', baselineSha: first });
  });

  it('rejects unknown or unsafe refs', () => {
    expect(handleRedlineRequest({ root }, 'pin', 'POST', new URLSearchParams(), { sha: 'deadbeef' }).status).toBe(400);
    expect(handleRedlineRequest({ root }, 'diff', 'GET', new URLSearchParams({ baseline: '--output=x' }), {}).status).toBe(400);
  });

  it('uses paths relative to a sub-directory root', () => {
    const sub = path.join(root, 'app');
    fs.mkdirSync(path.join(sub, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'src/A.tsx'), 'export const A = () => <p>a</p>;\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'app');
    pinBaseline({ root: sub });
    fs.writeFileSync(path.join(sub, 'src/A.tsx'), 'export const A = () => <p>b</p>;\n');
    expect(computeDiff({ root: sub }).files.map((f) => f.path)).toEqual(['src/A.tsx']);
  });

  it('lists commits newest first with a limit', () => {
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), after);
    git(root, 'commit', '-qam', 'B: subject | with ; punctuation');
    const res = handleRedlineRequest({ root }, 'log', 'GET', new URLSearchParams(), {});
    expect(res.status).toBe(200);
    const body = res.body as { headSha: string; commits: { sha: string; shortSha: string; subject: string; author: string; date: string }[] };
    expect(body.commits.map((c) => c.subject)).toEqual(['B: subject | with ; punctuation', 'A']);
    expect(body.commits[0].sha).toBe(body.headSha);
    expect(body.commits[1]).toMatchObject({ sha: first, author: 'Test' });
    expect(first.startsWith(body.commits[1].shortSha)).toBe(true);
    expect(Number.isNaN(Date.parse(body.commits[1].date))).toBe(false);
    expect(getLog(root, 1)).toHaveLength(1);
    const limited = handleRedlineRequest({ root }, 'log', 'GET', new URLSearchParams({ limit: 'abc' }), {});
    expect((limited.body as { commits: unknown[] }).commits).toHaveLength(2);
  });

  it('returns no commits for a repo without commits or when disabled', () => {
    const empty = tmp();
    git(empty, 'init', '-q');
    expect(getLog(empty)).toEqual([]);
    expect(handleRedlineRequest({ root, enabled: false }, 'log', 'GET', new URLSearchParams(), {}).body).toMatchObject({
      enabled: false,
      commits: [],
    });
  });

  it('reads a file at a ref without touching the working tree', () => {
    fs.writeFileSync(path.join(root, 'src/Hero.tsx'), after);
    const res = handleRedlineRequest({ root }, 'file', 'GET', new URLSearchParams({ path: 'src/Hero.tsx', ref: first }), {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ path: 'src/Hero.tsx', ref: first, content: before });
    expect(fs.readFileSync(path.join(root, 'src/Hero.tsx'), 'utf8')).toBe(after);
    expect(git(root, 'status', '--porcelain')).toBe('M src/Hero.tsx');
  });

  it('reads files relative to a sub-directory root', () => {
    const sub = path.join(root, 'app');
    fs.mkdirSync(path.join(sub, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'src/A.tsx'), 'a\n');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'app');
    const res = handleRedlineRequest({ root: sub }, 'file', 'GET', new URLSearchParams({ path: 'src/A.tsx' }), {});
    expect(res.body).toMatchObject({ path: 'src/A.tsx', content: 'a\n' });
  });

  it('rejects unsafe or missing file requests', () => {
    const q = (params: Record<string, string>) => handleRedlineRequest({ root }, 'file', 'GET', new URLSearchParams(params), {});
    expect(q({}).status).toBe(400);
    expect(q({ path: '../outside.tsx' }).status).toBe(400);
    expect(q({ path: '/etc/passwd' }).status).toBe(400);
    expect(q({ path: 'README.md' }).status).toBe(400);
    expect(q({ path: 'src/Missing.tsx' }).status).toBe(400);
    expect(q({ path: 'src/Hero.tsx', ref: '--output=x' }).status).toBe(400);
    expect(handleRedlineRequest({ root, enabled: false }, 'file', 'GET', new URLSearchParams({ path: 'src/Hero.tsx' }), {}).status).toBe(403);
  });
});
