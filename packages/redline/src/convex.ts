import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

export const CONVEX_DOC = 'docs/convex-local-snapshots.md';

export interface SnapshotOptions {
  /** Project directory (where `convex.json` or `.convex/` lives). Default `process.cwd()`. */
  root?: string;
  /** Zip file to write. Default `<root>/.redline/convex-snapshot.zip`. */
  out?: string;
}

export interface RestoreOptions {
  root?: string;
  file: string;
  /** Pass `--replace`: replace existing data in the tables the snapshot contains. */
  replace?: boolean;
  /** Skip the confirmation and pass `--yes` to `convex import`. */
  yes?: boolean;
}

/** Arguments after `convex` for an import. `--yes` is added when asked, with `--replace`, or when stdin is not a TTY (convex cannot prompt there). */
export function convexImportArgs(file: string, { replace, yes, tty }: { replace?: boolean; yes?: boolean; tty: boolean }): string[] {
  return ['import', ...(replace ? ['--replace'] : []), ...(yes || replace || !tty ? ['--yes'] : []), file];
}

function convex(root: string, args: string[]): void {
  const cmd = ['npx', 'convex', ...args];
  const res = spawnSync(cmd[0], cmd.slice(1), { cwd: root, stdio: 'inherit' });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : `exit code ${res.status}`;
    throw new Error(`\`${cmd.join(' ')}\` failed (${why}). Check that the Convex CLI is installed and the deployment is running (for a local deployment, keep \`npx convex dev\` open). See ${CONVEX_DOC}.`);
  }
}

/** Export the selected Convex deployment, with file storage, to a zip. The backend must be running. */
export function snapshot(options: SnapshotOptions = {}): { file: string; sidecar: string } {
  const root = path.resolve(options.root ?? process.cwd());
  const file = path.resolve(options.out ?? path.join(root, '.redline', 'convex-snapshot.zip'));
  const args = ['export', '--include-file-storage', '--path', file];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  convex(root, args);
  const sidecar = file.replace(/\.zip$/, '') + '.json';
  const meta = { createdAt: new Date().toISOString(), file: path.basename(file), command: ['npx', 'convex', ...args].join(' '), docs: CONVEX_DOC };
  fs.writeFileSync(sidecar, JSON.stringify(meta, null, 2) + '\n');
  return { file, sidecar };
}

/** Import a snapshot zip into the selected Convex deployment. The backend must be running. */
export async function restore(options: RestoreOptions): Promise<void> {
  const root = path.resolve(options.root ?? process.cwd());
  const file = path.resolve(options.file);
  if (!fs.existsSync(file)) throw new Error(`Snapshot not found: ${file}`);
  const tty = Boolean(process.stdin.isTTY);
  let yes = options.yes;
  if (tty && !yes && !options.replace) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Perform import? [y/N] ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Import cancelled.');
    yes = true;
  }
  convex(root, convexImportArgs(file, { replace: options.replace, yes, tty }));
}
