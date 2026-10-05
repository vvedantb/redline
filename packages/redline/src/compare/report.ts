import fs from 'node:fs';
import path from 'node:path';
import type { Framework, RouteSource } from '../routes/affected';
import { STATUS_LABELS, type PageStatus } from './classify';
import type { Region } from './pixels';

export interface CommitRef {
  ref: string;
  sha: string;
  subject: string;
}

export interface PageShot {
  /** Path relative to the report directory. */
  image: string;
  width: number;
  height: number;
  /** HTTP status of the document. */
  status: number;
}

export interface ReportPage {
  /** Stable index; the page view is `pages/<id>.html`. */
  id: number;
  path: string;
  /** File-system route pattern, when known. */
  pattern: string | null;
  status: PageStatus;
  reason: string;
  /** Changed files that lead to this page, closest first. */
  suspects: RouteSource[];
  before: PageShot | null;
  after: PageShot | null;
  regions: Region[];
  changedRatio: number;
  /** New uncaught errors and console errors at head. */
  errors: string[];
}

export interface Report {
  version: 1;
  createdAt: string;
  framework: Framework;
  base: CommitRef;
  head: CommitRef;
  pages: ReportPage[];
  summary: Record<PageStatus, number>;
  /** Limits that were hit; each one means the report may be incomplete. */
  notices: string[];
  changedFiles: string[];
  deletedFiles: string[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const COLORS: Record<PageStatus, string> = {
  broken: '#d92d20',
  changed: '#e8590c',
  added: '#1f9d55',
  removed: '#6b7280',
  skipped: '#a16207',
  unchanged: '#9ca3af',
};

const CSS = `
:root { color-scheme: light; --line: #e5e7eb; --muted: #6b7280; --ink: #111827; --red: #e11d48; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: #f9fafb; }
header { padding: 24px 32px 16px; background: #fff; border-bottom: 1px solid var(--line); }
h1 { margin: 0 0 4px; font-size: 20px; }
h1 a { color: inherit; text-decoration: none; }
main { padding: 24px 32px 48px; max-width: 1400px; }
.muted { color: var(--muted); }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.chip { display: inline-flex; gap: 6px; align-items: center; padding: 2px 10px; border-radius: 999px; background: #f3f4f6; font-size: 13px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap; }
.notice { margin: 0 0 16px; padding: 10px 14px; border: 1px solid #fcd34d; background: #fffbeb; border-radius: 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.card { display: block; background: #fff; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; color: inherit; text-decoration: none; }
a.card:hover { border-color: #9ca3af; box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.thumb { height: 170px; background: #f3f4f6 center top / cover no-repeat; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--muted); }
.card .body { padding: 10px 12px 12px; }
.card .path { font-weight: 600; word-break: break-all; margin: 6px 0 2px; }
.card .why { font-size: 12px; color: var(--muted); }
details { margin-top: 28px; }
summary { cursor: pointer; font-weight: 600; margin-bottom: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; margin: 0 0 16px; }
.toolbar button { font: inherit; padding: 4px 12px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; }
.toolbar button[aria-pressed="true"] { background: var(--ink); color: #fff; border-color: var(--ink); }
.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.side h3 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.shot { position: relative; border: 1px solid var(--line); background: #fff; line-height: 0; }
.shot img { width: 100%; display: block; }
.box { position: absolute; border: 2px solid var(--red); background: rgba(225,29,72,.06); border-radius: 2px; }
.box span { position: absolute; top: -11px; left: -11px; width: 20px; height: 20px; border-radius: 50%; background: var(--red); color: #fff; font: 600 11px/20px system-ui; text-align: center; }
.empty { padding: 48px; text-align: center; color: var(--muted); line-height: 1.5; }
.slider { position: relative; max-width: 960px; border: 1px solid var(--line); background: #fff; line-height: 0; }
.slider img { width: 100%; display: block; }
.slider .top { position: absolute; inset: 0; }
.slider .handle { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--red); pointer-events: none; }
.slider input { width: 100%; max-width: 960px; margin: 8px 0 0; }
.panel { margin-top: 24px; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; }
.panel h2 { margin: 0 0 8px; font-size: 15px; }
.panel ul { margin: 0; padding-left: 18px; }
[hidden] { display: none !important; }
`;

function badge(status: PageStatus): string {
  return `<span class="badge" style="background:${COLORS[status]}">${STATUS_LABELS[status]}</span>`;
}

function doc(title: string, body: string, script = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>\n`;
}

function commitLine(r: Report): string {
  const c = (x: CommitRef) => `<code>${esc(x.sha.slice(0, 7))}</code> ${esc(x.subject)}`;
  return `<div class="muted">Before ${c(r.base)} &rarr; After ${c(r.head)}</div>`;
}

function suspectText(p: ReportPage, max = 3): string {
  if (!p.suspects.length) return '';
  const files = p.suspects.slice(0, max).map((s) => s.file.split('/').pop()!);
  const more = p.suspects.length > max ? ` +${p.suspects.length - max}` : '';
  return `Likely from ${esc(files.join(', '))}${more}`;
}

function card(p: ReportPage, prefix: string): string {
  const shot = p.status === 'removed' ? p.before : p.after ?? p.before;
  const thumb = shot ? `<div class="thumb" style="background-image:url('${esc(prefix + shot.image)}')"></div>` : `<div class="thumb">No screenshot</div>`;
  const why = suspectText(p) || esc(p.reason);
  return `<a class="card" href="${prefix}pages/${p.id}.html">${thumb}<div class="body">${badge(p.status)}<div class="path">${esc(p.path)}</div><div class="why">${why}</div></div></a>`;
}

export function renderIndex(r: Report): string {
  const attention = r.pages.filter((p) => p.status !== 'unchanged');
  const unchanged = r.pages.filter((p) => p.status === 'unchanged');
  const chips = (Object.keys(STATUS_LABELS) as PageStatus[])
    .filter((s) => r.summary[s])
    .map((s) => `<span class="chip"><span class="badge" style="background:${COLORS[s]}">${r.summary[s]}</span>${STATUS_LABELS[s]}</span>`)
    .join('');
  const notices = r.notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('');
  const lead = attention.length
    ? `<div class="grid">${attention.map((p) => card(p, '')).join('')}</div>`
    : `<p class="muted">No page looks different.</p>`;
  const rest = unchanged.length
    ? `<details><summary>${unchanged.length} unchanged page${unchanged.length === 1 ? '' : 's'}</summary><div class="grid">${unchanged.map((p) => card(p, '')).join('')}</div></details>`
    : '';
  return doc('Redline report', `<header><h1>What changed</h1>${commitLine(r)}<div class="chips">${chips}</div></header><main>${notices}${lead}${rest}</main>`);
}

function sideView(label: string, shot: PageShot | null, regions: Region[], emptyText: string): string {
  if (!shot) return `<div class="side"><h3>${label}</h3><div class="shot"><div class="empty">${esc(emptyText)}</div></div></div>`;
  const boxes = regions
    .map((g, i) => {
      const style = `left:${(g.x / shot.width) * 100}%;top:${(g.y / shot.height) * 100}%;width:${(g.width / shot.width) * 100}%;height:${(g.height / shot.height) * 100}%`;
      return g.y < shot.height ? `<div class="box" style="${style}"><span>${i + 1}</span></div>` : '';
    })
    .join('');
  return `<div class="side"><h3>${label}</h3><div class="shot"><img src="../${esc(shot.image)}" alt="${label}">${boxes}</div></div>`;
}

const SLIDER_JS = `
const buttons = document.querySelectorAll('[data-view]');
for (const b of buttons) b.addEventListener('click', () => {
  for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== b.dataset.view;
});
const range = document.querySelector('#slider input');
if (range) range.addEventListener('input', () => {
  document.querySelector('#slider .top').style.clipPath = 'inset(0 0 0 ' + range.value + '%)';
  document.querySelector('#slider .handle').style.left = range.value + '%';
});
`;

export function renderPage(r: Report, p: ReportPage): string {
  const both = p.before && p.after;
  const toolbar = both
    ? `<div class="toolbar"><button data-view="sides" aria-pressed="true">Side by side</button><button data-view="slider" aria-pressed="false">Slider</button></div>`
    : '';
  const sides = `<div class="view sides" id="sides">${sideView('Before', p.before, p.regions, 'This page did not exist before.')}${sideView('After', p.after, p.regions, p.status === 'removed' ? 'This page is gone.' : "Couldn't capture this page.")}</div>`;
  const slider = both
    ? `<div class="view" id="slider" hidden><div class="slider"><img src="../${esc(p.before!.image)}" alt="Before"><img class="top" src="../${esc(p.after!.image)}" alt="After" style="clip-path:inset(0 0 0 50%)"><div class="handle" style="left:50%"></div></div><input type="range" min="0" max="100" value="50" aria-label="Before and after"><div class="muted" style="line-height:1.5">Left of the line: before. Right: after.</div></div>`
    : '';
  const suspects = p.suspects.length
    ? `<div class="panel"><h2>Likely from</h2><ul>${p.suspects.map((s) => `<li><code>${esc(s.file)}</code> <span class="muted">${s.depth === 0 ? 'this page' : `${s.depth} import${s.depth === 1 ? '' : 's'} away`}</span></li>`).join('')}</ul></div>`
    : '';
  const errors = p.errors.length ? `<div class="panel"><h2>Errors after the change</h2><ul>${p.errors.map((e) => `<li><code>${esc(e)}</code></li>`).join('')}</ul></div>` : '';
  const header = `<header><h1><a href="../index.html">&larr;</a> ${esc(p.path)}</h1>${commitLine(r)}<div class="chips">${badge(p.status)}<span class="muted">${esc(p.reason)}</span></div></header>`;
  return doc(`${p.path} - Redline`, `${header}<main>${toolbar}${sides}${slider}${suspects}${errors}</main>`, both ? SLIDER_JS : '');
}

/** Write `report.json`, `index.html` and one `pages/<id>.html` per page. Images must already be under `outDir`. */
export function writeReport(report: Report, outDir: string): string {
  fs.mkdirSync(path.join(outDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const p of report.pages) fs.writeFileSync(path.join(outDir, 'pages', `${p.id}.html`), renderPage(report, p));
  const index = path.join(outDir, 'index.html');
  fs.writeFileSync(index, renderIndex(report));
  return index;
}
