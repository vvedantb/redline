import type { RouteSource } from '../routes/affected';
import type { PageCapture } from './capture';
import type { Region } from './pixels';

export type PageStatus = 'broken' | 'changed' | 'added' | 'removed' | 'skipped' | 'unchanged';

export const STATUS_LABELS: Record<PageStatus, string> = {
  broken: 'Looks broken',
  changed: 'Changed',
  added: 'New',
  removed: 'Removed',
  skipped: "Couldn't check",
  unchanged: 'Unchanged',
};

export interface ClassifyInput {
  before?: PageCapture;
  after?: PageCapture;
  /** Regions that differ between the two screenshots. */
  regions: Region[];
  /** The route exists in the base commit's file system. */
  inBase: boolean;
  /** The route exists in the head commit's file system. */
  inHead: boolean;
  /** A login hook ran, so both commits should be signed in. Turns on the signed-out check for both sides. */
  login?: boolean;
  /** App paths of the sign-in screen. Default: paths that match `SIGN_IN`. */
  signInPaths?: string[];
}

/** Both sides blank: nothing to compare, so the page is not "unchanged". */
export const BLANK_BOTH = 'Blank before and after. The app may need env keys or data the build does not have';

const SIGN_IN = /(^|\/)(log[-_]?in|sign[-_]?in|auth|sso)(\/|$)/i;

/** Start of the reason for a page that ended signed out. The report counts these. */
export const SIGNED_OUT = 'Signed out';

function usable(page?: PageCapture): page is PageCapture {
  return !!page && !page.failed && !page.notFound;
}

const trimSlash = (p: string) => p.replace(/\/+$/, '') || '/';

/** The page was redirected to a sign-in path: one of `signInPaths` (or under one), else one that matches `SIGN_IN`. */
function redirectedToSignIn(page: PageCapture, signInPaths?: string[]): boolean {
  const final = trimSlash(page.finalPath).toLowerCase();
  if (final === trimSlash(page.path).toLowerCase()) return false;
  if (!signInPaths?.length) return SIGN_IN.test(final);
  return signInPaths.map((p) => trimSlash(p).toLowerCase()).some((p) => final === p || final.startsWith(`${p}/`));
}

/**
 * Why `page` looks signed out, or null. Without `signInPaths`, a sign-in form shown in place
 * counts too, but only when the other commit shows a working page with none: a change-password
 * page has one at both, and a fix for a blank or broken page may add one.
 */
function signedOut(page: PageCapture | undefined, other: PageCapture | undefined, signInPaths?: string[]): string | null {
  if (!page || page.failed) return null;
  if (redirectedToSignIn(page, signInPaths)) return `ended on ${page.finalPath}`;
  if (!signInPaths?.length && page.signInForm && usable(other) && other.content > 0 && !other.appError && !other.signInForm) {
    return 'showed a sign-in form';
  }
  return null;
}

/**
 * The capture may be signed out, judged on its own: it ended on a sign-in path or, without
 * `signInPaths`, showed a password field. With a login hook, such captures are not cached.
 */
export function maybeSignedOut(page: PageCapture, signInPaths?: string[]): boolean {
  return redirectedToSignIn(page, signInPaths) || (!signInPaths?.length && !!page.signInForm);
}

/** Decide what happened to one page between base and head. */
export function classify({ before, after, regions, inBase, inHead, login, signInPaths }: ClassifyInput): { status: PageStatus; reason: string } {
  if (inBase && !inHead && !usable(after)) return { status: 'removed', reason: 'The page file was deleted' };
  if (!after) return { status: 'skipped', reason: 'Not captured after the change' };
  if (after.failed) return { status: 'skipped', reason: `Couldn't load the page: ${after.failed}` };
  if (!login && redirectedToSignIn(after, signInPaths)) {
    return { status: 'skipped', reason: `Needs sign-in (redirects to ${after.finalPath})` };
  }

  const newErrors = after.errors.filter((e) => !before?.errors.includes(e));
  if (after.status >= 500) return { status: 'broken', reason: `The page returns HTTP ${after.status}` };
  if (after.appError && !before?.appError) return { status: 'broken', reason: 'The page shows an error screen' };
  if (newErrors.length) return { status: 'broken', reason: `New error: ${newErrors[0]}` };
  if (usable(before) && before.content > 0 && after.content === 0 && !after.notFound) return { status: 'broken', reason: 'The page is now blank' };
  if (login) {
    // After the broken checks, so a broken head is still reported. A signed-out capture shows the
    // sign-in screen, not the page: comparing it would report a change that is not there.
    const base = signedOut(before, after, signInPaths);
    const head = signedOut(after, before, signInPaths);
    const at = base && head ? 'both commits' : base ? 'the base commit' : 'the head commit';
    if (base || head) return { status: 'skipped', reason: `${SIGNED_OUT} at ${at} (${head ?? base})` };
  }
  if (usable(before) && before.content === 0 && after.content === 0 && !after.notFound) {
    return { status: 'skipped', reason: BLANK_BOTH };
  }

  if (!usable(before)) {
    if (!after.notFound) return { status: 'added', reason: inBase ? 'The page loads now and did not before' : 'New page' };
    return { status: 'skipped', reason: 'Not found before or after' };
  }
  if (after.notFound) {
    return inHead ? { status: 'broken', reason: 'The page now shows "not found"' } : { status: 'removed', reason: 'The page is gone' };
  }
  if (regions.length) return { status: 'changed', reason: `${regions.length} area${regions.length === 1 ? '' : 's'} changed` };
  return { status: 'unchanged', reason: 'No visible change' };
}

const ORDER: PageStatus[] = ['broken', 'changed', 'added', 'removed', 'skipped', 'unchanged'];

export interface Rankable {
  path: string;
  status: PageStatus;
  suspects: RouteSource[];
  changedRatio: number;
}

/** Most important first: broken, then changed pages with a direct cause and larger changes, then the rest. */
export function rankPages<T extends Rankable>(pages: T[]): T[] {
  const closest = (p: T) => p.suspects[0]?.depth ?? Infinity;
  return [...pages].sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      (a.status === 'changed' ? Math.min(closest(a), 3) - Math.min(closest(b), 3) || b.changedRatio - a.changedRatio : 0) ||
      a.path.localeCompare(b.path),
  );
}
