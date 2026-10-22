// Route pattern matching with no Node imports, so the overlay can use it in the browser.

function segmentRegex(seg: string): string {
  let m: RegExpMatchArray | null;
  if ((m = seg.match(/^\[\[\.\.\.[^\]]+\]\]$/))) return '(?:/.+)?';
  if ((m = seg.match(/^\[\.\.\.[^\]]+\]$/))) return '/.+';
  if (/^\[[^\]]+\]$/.test(seg) || /^:\w+\??$/.test(seg)) return '/[^/]+';
  if (seg === '*') return '(?:/.*)?';
  return '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `appPath` match a route pattern such as `/blog/[slug]`, `/docs/[...slug]` or `/users/:id`? */
export function matchPattern(pattern: string, appPath: string): boolean {
  const segs = pattern.split('/').filter(Boolean);
  const re = segs.length ? segs.map(segmentRegex).join('') : '/';
  return new RegExp(`^${re}/?$`).test(appPath === '' ? '/' : appPath);
}
