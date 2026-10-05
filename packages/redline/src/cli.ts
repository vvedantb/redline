import path from 'node:path';
import { parseArgs } from 'node:util';
import { compare, type CompareOptions } from './compare/compare';

const USAGE = `Usage: redline compare [base] [head] [options]

Build both commits, screenshot every page, and write a report of what changed.
base defaults to HEAD~1, head to HEAD.

Options:
  --root <dir>         App directory (default: current directory)
  --out <dir>          Report directory (default: <root>/.redline/report)
  --max-routes <n>     Pages captured at most (default: 50)
  --seed <path>        Extra page to capture, e.g. /blog/hello. Repeatable.
  --viewport <WxH>     Viewport size (default: 1280x800)
  --chrome <path>      Chrome or Chromium binary to use
  -h, --help           Show this help`;

export function parseCli(argv: string[]): { command: 'help' } | { command: 'compare'; options: CompareOptions } {
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
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, base, head, ...extra] = positionals;
  if (values.help || !command) return { command: 'help' };
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
  let parsed: ReturnType<typeof parseCli>;
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
