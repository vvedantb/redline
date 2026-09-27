export interface OverlayFlagInput {
  /** `enabled` prop on the overlay component. */
  enabled?: boolean;
  /** Whether the server/plugin reports Redline as enabled. */
  serverEnabled?: boolean;
  /** `window.location.search`. */
  search?: string;
  /** `localStorage.getItem('redlineDisabled')`. */
  storageDisabled?: string | null;
  /** Result of `matchMedia('(prefers-reduced-motion: reduce)').matches`. */
  reducedMotion?: boolean;
  /** Set to false to ignore prefers-reduced-motion. Default true. */
  respectReducedMotion?: boolean;
  /** Whether this is a production build. */
  production?: boolean;
  /** Whether the page is a History build served under `/__redline/h/<sha>/`. */
  historyFrame?: boolean;
}

export const STORAGE_DISABLED_KEY = 'redlineDisabled';

function queryFlag(search: string | undefined): '0' | '1' | null {
  if (!search) return null;
  const value = new URLSearchParams(search).get('redline');
  if (value === '0' || value === 'false' || value === 'off') return '0';
  if (value === '1' || value === 'true' || value === 'on') return '1';
  return null;
}

/**
 * Decide whether outlines should be drawn.
 *
 * Off when any of: `enabled: false`, the page is a History build, the server reports disabled, `?redline=0`,
 * prefers-reduced-motion (unless opted out), or `localStorage.redlineDisabled === '1'`
 * (which `?redline=1` overrides). Production builds are off unless `enabled: true`.
 */
export function isOverlayEnabled(input: OverlayFlagInput): boolean {
  if (input.enabled === false) return false;
  if (input.historyFrame) return false;
  if (input.serverEnabled === false) return false;
  if (input.production && input.enabled !== true) return false;
  const query = queryFlag(input.search);
  if (query === '0') return false;
  if (input.reducedMotion && input.respectReducedMotion !== false) return false;
  if (input.storageDisabled === '1' && query !== '1') return false;
  return true;
}
