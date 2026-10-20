import path from 'node:path';
import { parseArgs } from 'node:util';
import { compare, type CompareOptions } from './compare/compare';
import { renderSummary } from './compare/summary';
import { postPrComment } from './github';
import { restore, snapshot, type RestoreOptions, type SnapshotOptions } from './convex';

const USAGE = `Usage:
  redline compare [base] [head] [options]
  redline snapshot [--root <dir>] [--out <file>]
  redline restore [--root <dir>] [--replace] [--yes] [--allow-prod] <file>

compare builds both commits, screenshots every page, and writes a report of what changed:
route changes, the PR diff (unified and split), and before/after pages. base defaults to
HEAD~1, head to HEAD. Set TYPESAFE_API_KEY to link changed areas to files with Jev.

snapshot exports the selected Convex deployment (with file storage) to a zip with
\`npx convex export\`. restore imports a zip with \`npx convex import\`. The backend must be
running. See docs/convex-local-snapshots.md.

Before an import (restore, or compare with dataSnapshot) Redline prints the target deployment,
read from CONVEX_DEPLOY_KEY, then CONVEX_DEPLOYMENT, then a Convex URL (environment first,
then .env.local and .env). It refuses a prod deployment, or one it cannot identify (a
*.convex.cloud URL alone), unless --allow-prod or dataSnapshot.allowProd is set.

Options:
  --root <dir>         App directory (default: current directory)
  --out <path>         compare: report directory (default: <root>/.redline/report)
                       snapshot: zip file (default: <root>/.redline/convex-snapshot.zip)
  --max-routes <n>     Pages captured at most (default: 50)
  --seed <path>        Extra page to capture, e.g. /blog/hello. Repeatable.
  --viewport <WxH>     Viewport size (default: 1280x800)
  --chrome <path>      Chrome or Chromium binary to use
  --dev                compare: run each commit's dev server instead of a production build
  --concurrency <n>    compare: pages loaded at once (default: 4)
  --affected           compare: capture only pages the changed files reach, plus a sample
  --sample <n>         compare: other pages captured with --affected (default: 5)
  --comment <pr|auto>  compare: post the summary on a pull request (GitHub CLI), updating
                       Redline's earlier comment there. auto: the current branch's PR
  --report-url <url>   compare: where the report is published, for links in the comment
  --replace            restore: replace existing data in the imported tables
  --yes                restore: skip the confirmation (implied by --replace or a non-interactive terminal)
  --allow-prod         compare, restore: import into a prod deployment, or one Redline cannot identify
  -h, --help           Show this help`;

export type Parsed =
  | { command: 'help' }
  | { command: 'compare'; options: CompareOptions; comment?: { pr: string; reportUrl?: string } }
  | { command: 'snapshot'; options: SnapshotOptions }
  | { command: 'restore'; options: RestoreOptions };

export function parseCli(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      out: { type: 'string' },
      'max-routes': { type: 'string' },
      seed: { type: 'string', multiple: true },
      viewport: { type: 'string' },
      chrome: { type: 'string' },
      dev: { type: 'boolean' },
      concurrency: { type: 'string' },
      affected: { type: 'boolean' },
      sample: { type: 'string' },
      comment: { type: 'string' },
      'report-url': { type: 'string' },
      replace: { type: 'boolean' },
      yes: { type: 'boolean' },
      'allow-prod': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, base, head, ...extra] = positionals;
  if (values.help || !command) return { command: 'help' };
  if (command === 'snapshot' || command === 'restore') {
    const root = values.root ? path.resolve(values.root) : undefined;
    if (command === 'snapshot') {
      if (base) throw new Error(`Unexpected argument: ${base}`);
      return { command, options: { root, out: values.out ? path.resolve(values.out) : undefined } };
    }
    if (!base) throw new Error('restore needs a snapshot file: redline restore <file>');
    if (head) throw new Error(`Unexpected argument: ${head}`);
    return { command, options: { root, file: path.resolve(base), replace: values.replace, yes: values.yes, allowProd: values['allow-prod'] } };
  }
  if (command !== 'compare') throw new Error(`Unknown command: ${command}`);
  if (extra.length) throw new Error(`Unexpected argument: ${extra[0]}`);

  const options: CompareOptions = { base, head, seeds: values.seed };
  if (values.root) options.root = path.resolve(values.root);
  if (values.out) options.out = path.resolve(values.out);
  if (values['max-routes'] !== undefined) {
    const n = Number(values['max-routes']);
    if (!Number.isInteger(n) || n < 1) throw new Error('--max-routes must be a positive whole number');
    options.maxRoutes = n;
  }
  if (values.viewport) {
    const m = values.viewport.match(/^(\d+)x(\d+)$/);
    if (!m) throw new Error('--viewport must look like 1280x800');
    options.viewport = { width: Number(m[1]), height: Number(m[2]) };
  }
  if (values.chrome) options.browser = { executablePath: values.chrome };
  if (values.dev) options.serve = 'dev';
  if (values['allow-prod']) options.allowProd = true;
  if (values.affected) options.scope = 'affected';
  if (values.sample !== undefined) {
    const n = Number(values.sample);
    if (!Number.isInteger(n) || n < 0) throw new Error('--sample must be a whole number');
    options.sample = n;
  }
  if (values.comment !== undefined && !/^(\d+|auto)$/.test(values.comment)) throw new Error('--comment takes a pull request number or auto');
  if (values.concurrency !== undefined) {
    const n = Number(values.concurrency);
    if (!Number.isInteger(n) || n < 1) throw new Error('--concurrency must be a positive whole number');
    options.concurrency = n;
  }
  const comment = values.comment ? { pr: values.comment, ...(values['report-url'] ? { reportUrl: values['report-url'] } : {}) } : undefined;
  return comment ? { command: 'compare', options, comment } : { command: 'compare', options };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parseCli(argv);
  } catch (err) {
    console.error(`redline: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 1;
  }
  if (parsed.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  try {
    if (parsed.command === 'snapshot') {
      const { file } = snapshot(parsed.options);
      console.log(`Snapshot: ${file}`);
      return 0;
    }
    if (parsed.command === 'restore') {
      await restore(parsed.options);
      console.log(`Restored: ${parsed.options.file}`);
      return 0;
    }
    const { report, reportFile } = await compare({ ...parsed.options, log: (m) => console.log(m) });
    const s = report.summary;
    console.log(`\n${s.broken} looks broken, ${s.changed} changed, ${s.added} new, ${s.removed} removed, ${s.skipped} couldn't check, ${s.unchanged} unchanged`);
    for (const g of report.shared ?? []) {
      const from = g.suspects[0] ? `, likely from ${g.suspects[0].file}` : '';
      console.log(`Shared change: ${g.regions.length} area${g.regions.length === 1 ? '' : 's'} changed the same way on ${g.pages.length} pages${from}.`);
    }
    for (const n of report.notices) console.log(`Note: ${n}`);
    console.log(`Report: ${reportFile}`);
    if (parsed.comment) {
      const url = postPrComment(parsed.comment.pr, renderSummary(report, { reportUrl: parsed.comment.reportUrl }), parsed.options.root ?? process.cwd());
      console.log(`Comment: ${url}`);
    }
    return 0;
  } catch (err) {
    console.error(`redline: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
