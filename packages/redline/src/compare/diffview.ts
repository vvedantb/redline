import type { DiffHunk } from '../types';
import { highlightLine, languageOf } from './syntax';
import type { ReportFileDiff } from './report';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function diffAnchor(file: string): string {
  return 'diff-' + file.replace(/[^A-Za-z0-9]+/g, '-');
}

interface Row {
  kind: 'ctx' | 'add' | 'del' | 'hunk';
  oldNo?: number;
  newNo?: number;
  text: string;
}

function rowsOf(hunk: DiffHunk): Row[] {
  const [header, ...lines] = hunk.patch.split('\n');
  const rows: Row[] = [{ kind: 'hunk', text: header }];
  let o = hunk.oldStart;
  let n = hunk.newStart;
  for (const line of lines) {
    const tag = line[0];
    if (tag === '+') rows.push({ kind: 'add', newNo: n++, text: line.slice(1) });
    else if (tag === '-') rows.push({ kind: 'del', oldNo: o++, text: line.slice(1) });
    else if (tag === '\\') continue;
    else rows.push({ kind: 'ctx', oldNo: o++, newNo: n++, text: line.slice(1) });
  }
  return rows;
}

const cell = (cls: string, no: number | undefined) => `<td class="ln ${cls}">${no ?? ''}</td>`;
const code = (cls: string, sign: string, text: string, lang: string | null) => `<td class="cd ${cls}"><span class="sg">${sign}</span>${highlightLine(text, lang)}</td>`;

function unified(rows: Row[], lang: string | null): string {
  return rows
    .map((r) => {
      if (r.kind === 'hunk') return `<tr class="hunk"><td colspan="3">${esc(r.text)}</td></tr>`;
      const sign = r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' ';
      return `<tr>${cell(r.kind, r.oldNo)}${cell(r.kind, r.newNo)}${code(r.kind, sign, r.text, lang)}</tr>`;
    })
    .join('');
}

/** Pair each run of removed lines with the run of added lines that follows it. */
function split(rows: Row[], lang: string | null): string {
  const out: string[] = [];
  const empty = '<td class="ln empty"></td><td class="cd empty"></td>';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.kind === 'hunk') out.push(`<tr class="hunk"><td colspan="4">${esc(r.text)}</td></tr>`);
    else if (r.kind === 'ctx') out.push(`<tr>${cell('ctx', r.oldNo)}${code('ctx', ' ', r.text, lang)}${cell('ctx', r.newNo)}${code('ctx', ' ', r.text, lang)}</tr>`);
    else {
      const dels: Row[] = [];
      const adds: Row[] = [];
      while (rows[i]?.kind === 'del') dels.push(rows[i++]);
      while (rows[i]?.kind === 'add') adds.push(rows[i++]);
      i--;
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        const d = dels[k];
        const a = adds[k];
        out.push(`<tr>${d ? cell('del', d.oldNo) + code('del', '-', d.text, lang) : empty}${a ? cell('add', a.newNo) + code('add', '+', a.text, lang) : empty}</tr>`);
      }
    }
  }
  return out.join('');
}

export function renderFileDiff(f: ReportFileDiff): string {
  const lang = languageOf(f.path);
  const rows = f.hunks.flatMap(rowsOf);
  const adds = rows.filter((r) => r.kind === 'add').length;
  const dels = rows.filter((r) => r.kind === 'del').length;
  const name = f.status === 'renamed' && f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
  return `<section class="file" id="${diffAnchor(f.path)}"><h3>${esc(name)} <span class="muted">${f.status}</span> <span class="add">+${adds}</span> <span class="del">-${dels}</span></h3>`
    + `<div class="scroll"><table class="diff diff-unified"><tbody>${unified(rows, lang)}</tbody></table>`
    + `<table class="diff diff-split"><tbody>${split(rows, lang)}</tbody></table></div></section>`;
}

export const DIFF_CSS = `
#pr-diff .file { margin: 0 0 16px; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
#pr-diff .file:target { border-color: var(--red); box-shadow: 0 0 0 2px rgba(225,29,72,.2); }
#pr-diff h3 { margin: 0; padding: 8px 12px; font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f4f6; border-bottom: 1px solid var(--line); }
.add { color: #15803d; } .del { color: #b91c1c; }
.scroll { overflow-x: auto; }
table.diff { width: 100%; border-collapse: collapse; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff td { padding: 0 8px; white-space: pre; vertical-align: top; }
.diff .ln { width: 1%; min-width: 44px; text-align: right; color: var(--muted); user-select: none; background: #fafafa; }
.diff .cd.add, .diff .ln.add { background: #e6ffec; } .diff .cd.del, .diff .ln.del { background: #ffebe9; }
.diff .empty { background: #f6f8fa; }
.diff .sg { display: inline-block; width: 1.5ch; color: var(--muted); }
.diff tr.hunk td { background: #eff6ff; color: #1d4ed8; padding: 2px 8px; }
.diff-split .cd { width: 50%; }
.diff-split td.cd:nth-child(2) { border-right: 1px solid var(--line); }
.diff-split { display: none; }
#pr-diff.split .diff-split { display: table; } #pr-diff.split .diff-unified { display: none; }
.tk-c { color: #6b7280; font-style: italic; } .tk-s { color: #0a7d4b; } .tk-k { color: #a626a4; } .tk-t { color: #1d4ed8; } .tk-n { color: #b45309; }
`;

export const DIFF_JS = `
const diffBox = document.getElementById('pr-diff');
for (const b of document.querySelectorAll('[data-diffview]')) b.addEventListener('click', () => {
  for (const o of document.querySelectorAll('[data-diffview]')) o.setAttribute('aria-pressed', String(o === b));
  diffBox.classList.toggle('split', b.dataset.diffview === 'split');
});
`;
