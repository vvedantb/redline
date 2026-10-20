import { STATUS_LABELS, type PageStatus } from './classify';
import { isOnlyShared } from './groups';
import type { Report, ReportPage } from './report';

/** First line of every summary; `--comment` finds and updates its own comment by it. */
export const SUMMARY_MARKER = '<!-- redline-summary -->';

export interface SummaryOptions {
  /** Where the HTML report is published. Page names link into it when set. */
  reportUrl?: string;
  /** Pages listed under "Pages to review". Default 10. */
  maxPages?: number;
}

const ORDER: PageStatus[] = ['broken', 'changed', 'added', 'removed', 'skipped', 'unchanged'];

const md = (s: string) => s.replace(/([\\`*_[\]<>|])/g, '\\$1');

/**
 * `s` as a code span, for paths, files and SHAs. Backslashes show literally inside one, so nothing
 * is escaped: the fence is one backtick longer than the longest backtick run in `s`, padded with
 * spaces when `s` starts or ends with a backtick or space (Markdown strips one space each side).
 */
export function code(s: string): string {
  const fence = '`'.repeat(Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const pad = /^[` ]|[` ]$/.test(s) ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

/** A short Markdown summary of a report, for a pull request comment. */
export function renderSummary(r: Report, options: SummaryOptions = {}): string {
  const base = options.reportUrl?.replace(/\/+$/, '');
  const link = (p: ReportPage) => (base ? `[${code(p.path)}](${base}/pages/${p.id}.html)` : code(p.path));
  const from = (files: { file: string }[]) => (files.length ? ` — likely from ${files.slice(0, 2).map((s) => code(s.file)).join(', ')}` : '');
  const out: string[] = [SUMMARY_MARKER, '### Redline: what changed on screen', ''];
  out.push(`${code(r.base.sha.slice(0, 7))} ${md(r.base.subject)} → ${code(r.head.sha.slice(0, 7))} ${md(r.head.subject)}`, '');
  out.push(`| ${ORDER.map((s) => STATUS_LABELS[s]).join(' | ')} |`, `| ${ORDER.map(() => '---:').join(' | ')} |`, `| ${ORDER.map((s) => r.summary[s]).join(' | ')} |`, '');

  const broken = r.pages.filter((p) => p.status === 'broken');
  if (broken.length) {
    out.push(`**Looks broken (${broken.length})**`, ...broken.map((p) => `- ${link(p)}: ${md(p.reason)}`), '');
  }
  if (r.shared?.length) {
    out.push(`**Shared changes (${r.shared.length})**`);
    for (const g of r.shared) {
      const first = r.pages[g.pages[0]];
      out.push(`- The same ${g.regions.length === 1 ? 'area' : `${g.regions.length} areas`} changed on ${g.pages.length} pages, e.g. ${first ? link(first) : 'one page'}${from(g.suspects)}`);
    }
    out.push('');
  }
  const max = options.maxPages ?? 10;
  const review = r.pages.filter((p) => ['changed', 'added', 'removed'].includes(p.status) && !isOnlyShared(r.shared, p));
  if (review.length) {
    out.push(`**Pages to review (${review.length})**`);
    for (const p of review.slice(0, max)) out.push(`- ${link(p)} — ${STATUS_LABELS[p.status]}, ${md(p.reason)}${from(p.suspects)}`);
    if (review.length > max) out.push(`- …and ${review.length - max} more in the report`);
    out.push('');
  }
  if (!broken.length && !r.shared?.length && !review.length) out.push('No page looks different.', '');
  if (r.notices.length) out.push('<details><summary>Notes</summary>', '', ...r.notices.map((n) => `- ${md(n)}`), '', '</details>', '');
  out.push(base ? `[Full report](${base}/index.html)` : '_The full report is in `index.html` next to this summary._');
  return out.join('\n') + '\n';
}
