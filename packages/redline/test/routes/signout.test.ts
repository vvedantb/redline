import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverRoutes, isSignOutPath } from '../../src/routes/discover';

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
});

describe('discoverRoutes', () => {
  it('never returns sign-out routes from the file system, but keeps seeds', async () => {
    const root = path.join(tmp, 'next-app');
    for (const page of ['page.tsx', 'about/page.tsx', 'logout/page.tsx', 'auth/signout/route.ts', 'bye/page.tsx']) {
      fs.mkdirSync(path.dirname(path.join(root, 'app', page)), { recursive: true });
      fs.writeFileSync(path.join(root, 'app', page), 'export default function P() { return null; }\n');
    }
    const { routes } = await discoverRoutes({ root, framework: 'nextjs-app', seeds: ['/sign-out'], signOutPaths: ['/bye'] });
    expect(routes.map((r) => r.path).sort()).toEqual(['/', '/about', '/sign-out']);
  });
});
