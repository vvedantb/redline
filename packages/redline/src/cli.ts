import path from 'node:path';
import { parseArgs } from 'node:util';
import { compare, type CompareOptions } from './compare/compare';
import { restore, snapshot, type RestoreOptions, type SnapshotOptions } from './convex';

const USAGE = `Usage:
  redline compare [base] [head] [options]
  redline snapshot [--root <dir>] [--out <file>]
  redline restore [--root <dir>] [--replace] [--yes] <file>

compare builds both commits, screenshots every page, and writes a report of what changed:
route changes, the PR diff (unified and split), and before/after pages. base defaults to
HEAD~1, head to HEAD. Set TYPESAFE_API_KEY to link changed areas to files with Jev.

snapshot exports the selected Convex deployment (with file storage) to a zip with
\`npx convex export\`. restore imports a zip with \`npx convex import\`. The backend must be
running. See docs/convex-local-snapshots.md.

Options:
  --root <dir>         App directory (default: current directory)
  --out <path>         compare: report directory (default: <root>/.redline/report)
                       snapshot: zip file (default: <root>/.redline/convex-snapshot.zip)
  --max-routes <n>     Pages captured at most (default: 50)
  --seed <path>        Extra page to capture, e.g. /blog/hello. Repeatable.
  --viewport <WxH>     Viewport size (default: 1280x800)
  --chrome <path>      Chrome or Chromium binary to use
  --replace            restore: replace existing data in the imported tables
  --yes                restore: skip the confirmation (implied by --replace or a non-interactive terminal)
  -h, --help           Show this help`;

export type Parsed =
  | { command: 'help' }
  | { command: 'compare'; options: CompareOptions }
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
      replace: { type: 'boolean' },
      yes: { type: 'boolean' },
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
    return { command, options: { root, file: path.resolve(base), replace: values.replace, yes: values.yes } };
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
  return { command: 'compare', options };
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
    for (const n of report.notices) console.log(`Note: ${n}`);
    console.log(`Report: ${reportFile}`);
    return 0;
  } catch (err) {
    console.error(`redline: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
