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
}

const SIGN_IN = /(^|\/)(log-?in|sign-?in|auth|sso)(\/|$)/i;

function usable(page?: PageCapture): page is PageCapture {
  return !!page && !page.failed && !page.notFound;
}

/** Decide what happened to one page between base and head. */
export function classify({ before, after, regions, inBase, inHead }: ClassifyInput): { status: PageStatus; reason: string } {
  if (inBase && !inHead && !usable(after)) return { status: 'removed', reason: 'The page file was deleted' };
  if (!after) return { status: 'skipped', reason: 'Not captured after the change' };
  if (after.failed) return { status: 'skipped', reason: `Couldn't load the page: ${after.failed}` };
  if (after.finalPath !== after.path && SIGN_IN.test(after.finalPath)) {
    return { status: 'skipped', reason: `Needs sign-in (redirects to ${after.finalPath})` };
  }

  const newErrors = after.errors.filter((e) => !before?.errors.includes(e));
  if (after.status >= 500) return { status: 'broken', reason: `The page returns HTTP ${after.status}` };
  if (after.appError && !before?.appError) return { status: 'broken', reason: 'The page shows an error screen' };
  if (newErrors.length) return { status: 'broken', reason: `New error: ${newErrors[0]}` };
  if (usable(before) && before.content > 0 && after.content === 0 && !after.notFound) return { status: 'broken', reason: 'The page is now blank' };

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
