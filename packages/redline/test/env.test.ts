import { describe, expect, it } from 'vitest';
import { HISTORY_ENV_ALLOWLIST, filterEnvRecord, filterEnvText, isHistoryEnvKeyAllowed } from '../src/env';

describe('isHistoryEnvKeyAllowed', () => {
  it('allows publishable and public keys', () => {
    for (const key of HISTORY_ENV_ALLOWLIST.keys) expect(isHistoryEnvKeyAllowed(key, 'pk_test_x')).toBe(true);
    for (const key of ['VITE_APP_TITLE', 'NEXT_PUBLIC_APP_NAME', 'PUBLIC_SITE']) expect(isHistoryEnvKeyAllowed(key, 'x')).toBe(true);
  });

  it('strips non-public, secret and Convex keys', () => {
    for (const key of [
      'NODE_OPTIONS',
      'CONVEX_URL',
      'VITE_CONVEX_URL',
      'NEXT_PUBLIC_CONVEX_URL',
      'CONVEX_DEPLOY_KEY',
      'VITE_convex_site',
      'VITE_API_KEY',
      'NEXT_PUBLIC_CLIENT_SECRET',
      'VITE_DATABASE_URL',
      'PUBLIC_ACCESS_TOKEN',
      'VITE_ADMIN_PASSWORD',
      'NEXT_PUBLIC_AUTH_TOKEN',
      'VITE_PRIVATE_KEY',
      'VITE_GCP_CREDENTIALS',
    ]) {
      expect(isHistoryEnvKeyAllowed(key, 'x'), key).toBe(false);
    }
  });

  it('strips any value that is a Convex URL', () => {
    expect(isHistoryEnvKeyAllowed('VITE_BACKEND', 'https://happy-animal-123.convex.cloud')).toBe(false);
    expect(isHistoryEnvKeyAllowed('NEXT_PUBLIC_HTTP', 'https://happy-animal-123.convex.site')).toBe(false);
  });
});

describe('filterEnvText', () => {
  it('keeps allowlisted assignments and drops comments, secrets and junk', () => {
    const { text, kept, stripped } = filterEnvText(
      [
        '# CONVEX_DEPLOY_KEY=commented',
        'export VITE_APP_TITLE="Demo"',
        'VITE_CONVEX_URL=https://happy-animal-123.convex.cloud',
        'SESSION_SECRET=x',
        'not an assignment',
        '',
        "VITE_MULTI='line one",
        "line two'",
        'NEXT_PUBLIC_MULTI_SECRET="a',
        'b"',
        'PUBLIC_LAST=1',
      ].join('\r\n'),
    );
    expect(kept).toBe(3);
    expect(stripped).toBe(3);
    expect(text.split('\n').slice(1)).toEqual(['export VITE_APP_TITLE="Demo"', "VITE_MULTI='line one", "line two'", 'PUBLIC_LAST=1', '']);
  });
});

describe('filterEnvRecord', () => {
  it('drops secret and Convex keys and keeps the rest', () => {
    expect(
      filterEnvRecord({ PATH: '/bin', HOME: '/h', VITE_CONVEX_URL: 'x', CONVEX_DEPLOYMENT: 'dev:x', GITHUB_ACCESS_TOKEN: 'x', VITE_BACKEND: 'https://a.convex.site' }),
    ).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});
