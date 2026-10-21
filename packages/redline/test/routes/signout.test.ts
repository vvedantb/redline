import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverRoutes, isSignOutPath, parseSignOutPaths, SIGN_OUT_SKIPPED, signOutLast } from '../../src/routes/discover';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-signout-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('isSignOutPath', () => {
  it('matches common sign-out routes, with or without a trailing slash', () => {
    for (const p of ['/logout', '/log-out/', '/log_out', '/signout/', '/sign-out', '/sign_out', '/auth/signout', '/api/auth/signout/', '/Logout', '/account/logout/confirm']) {
      expect(isSignOutPath(p), p).toBe(true);
    }
  });

  it('leaves other pages alone', () => {
    for (const p of ['/', '/login', '/signin', '/logouts', '/blog/how-to-sign-out-safely', '/signout-help']) {
      expect(isSignOutPath(p), p).toBe(false);
    }
  });

  it('adds signOutPaths, matched exactly or as a parent path', () => {
    expect(isSignOutPath('/end-session', ['/end-session/'])).toBe(true);
    expect(isSignOutPath('/end-session/now', ['/end-session'])).toBe(true);
    expect(isSignOutPath('/end-sessions', ['/end-session'])).toBe(false);
  });

  it('matches signOutPaths ignoring case, and never treats / as one', () => {
    expect(isSignOutPath('/End-Session', ['/end-session'])).toBe(true);
    expect(isSignOutPath('/end-session/now', ['/END-SESSION'])).toBe(true);
    expect(isSignOutPath('/about', ['/'])).toBe(false);
    expect(isSignOutPath('/', ['/'])).toBe(false);
  });
});

describe('parseSignOutPaths', () => {
  it('keeps paths that start with /, and ignores / and invalid entries', () => {
    // The config is unchecked JSON: build bad entries through JSON.parse, as readConfig does.
    const raw: string[] = JSON.parse('["/bye", "/", "bye", 3, null, "//"]');
    expect(parseSignOutPaths(raw)).toEqual({ paths: ['/bye'], ignored: ['"/"', '"bye"', '3', 'null', '"//"'] });
    expect(parseSignOutPaths(undefined)).toEqual({ paths: [], ignored: [] });
  });

  it('rejects a value that is not an array', () => {
    const raw: string[] = JSON.parse('"/bye"');
    expect(() => parseSignOutPaths(raw)).toThrow(/signOutPaths must be an array/);
  });
});

describe('signOutLast', () => {
  it('moves sign-out seeds after every other route, keeping the rest in order', () => {
    const routes = [{ path: '/logout' }, { path: '/' }, { path: '/bye' }, { path: '/about' }];
    const { routes: ordered, last } = signOutLast(routes, ['/bye']);
    expect(ordered.map((r) => r.path)).toEqual(['/', '/about', '/logout', '/bye']);
    expect(last.map((r) => r.path)).toEqual(['/logout', '/bye']);
  });
});

describe('discoverRoutes', () => {
  it('never returns sign-out routes from the file system, but keeps seeds', async () => {
    const root = path.join(tmp, 'next-app');
    for (const page of ['page.tsx', 'about/page.tsx', 'logout/page.tsx', 'auth/signout/route.ts', 'bye/page.tsx']) {
      fs.mkdirSync(path.dirname(path.join(root, 'app', page)), { recursive: true });
      fs.writeFileSync(path.join(root, 'app', page), 'export default function P() { return null; }\n');
    }
    const { routes, skipped } = await discoverRoutes({ root, framework: 'nextjs-app', seeds: ['/sign-out', '/auth/signout/'], signOutPaths: ['/Bye'] });
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/about', '/auth/signout', '/sign-out']);
    // Dropped routes are reported, except the one a seed loads anyway.
    expect(skipped).toEqual([
      { route: '/bye', reason: SIGN_OUT_SKIPPED },
      { route: '/logout', reason: SIGN_OUT_SKIPPED },
    ]);
  });
});
