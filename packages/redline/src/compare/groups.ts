import type { RouteSource } from '../routes/affected';
import type { Region } from './pixels';

/** One change that looks the same on several pages, such as an edited header or launcher. */
export interface SharedChange {
  id: number;
  /** The changed boxes, in the coordinates of every page in the group. */
  regions: Region[];
  /** Ids of the pages that show it. */
  pages: number[];
  /** Files that lead to the most pages in the group, closest first. */
  suspects: RouteSource[];
}

export interface GroupablePage {
  id: number;
  regions: Region[];
  suspects: RouteSource[];
  /** One key per region: its box plus the pixels before and after. Same key, same change. */
  regionKeys: string[];
}

/** A region on this many pages or more is a shared change. */
export const SHARED_MIN_PAGES = 3;

/**
 * Group regions with the same box and the same pixels across pages. Regions that show on exactly
 * the same pages are one change: an edited sidebar moves several boxes at once.
 */
export function groupSharedChanges(pages: GroupablePage[], minPages = SHARED_MIN_PAGES): SharedChange[] {
  const byKey = new Map<string, { region: Region; pages: GroupablePage[] }>();
  for (const page of pages) {
    page.regions.forEach((region, i) => {
      const key = page.regionKeys[i];
      const group = byKey.get(key) ?? byKey.set(key, { region, pages: [] }).get(key)!;
      if (!group.pages.includes(page)) group.pages.push(page);
    });
  }
  const bySet = new Map<string, { regions: Region[]; pages: GroupablePage[] }>();
  for (const g of byKey.values()) {
    if (g.pages.length < minPages) continue;
    const set = g.pages.map((p) => p.id).sort((a, b) => a - b).join(',');
    const merged = bySet.get(set) ?? bySet.set(set, { regions: [], pages: g.pages }).get(set)!;
    merged.regions.push(g.region);
  }
  return [...bySet.values()]
    .map((g) => ({ ...g, regions: g.regions.sort((a, b) => a.y - b.y || a.x - b.x) }))
    .sort((a, b) => b.pages.length - a.pages.length || a.regions[0].y - b.regions[0].y)
    .map((g, id) => ({ id, regions: g.regions, pages: g.pages.map((p) => p.id).sort((a, b) => a - b), suspects: commonSuspects(g.pages) }));
}

/** Files ranked by how many pages they reach, then by how close they are. */
function commonSuspects(pages: GroupablePage[]): RouteSource[] {
  const best = new Map<string, { count: number; depth: number }>();
  for (const page of pages) {
    for (const s of page.suspects) {
      const seen = best.get(s.file);
      best.set(s.file, { count: (seen?.count ?? 0) + 1, depth: Math.min(seen?.depth ?? Infinity, s.depth) });
    }
  }
  return [...best]
    .sort(([fa, a], [fb, b]) => b.count - a.count || a.depth - b.depth || fa.localeCompare(fb))
    .slice(0, 5)
    .map(([file, { depth }]) => ({ file, depth }));
}
