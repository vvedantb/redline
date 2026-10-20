import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseEnvText } from './env';

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
  /** Import into a production deployment, or one Redline cannot identify. */
  allowProd?: boolean;
  /** Where the target line goes. Default `console.log`. */
  log?: (message: string) => void;
}

export interface ConvexTarget {
  kind: 'prod' | 'dev' | 'preview' | 'local' | 'anonymous' | 'unknown';
  name?: string;
  /** Where the target was read from, e.g. `CONVEX_DEPLOYMENT in .env.local`. */
  source: string;
}

/** Env files the Convex CLI reads, in the order it prefers them. */
export const CONVEX_ENV_FILES = ['.env.local', '.env'];
const CONVEX_URL_KEYS = ['CONVEX_SELF_HOSTED_URL', 'CONVEX_URL', 'VITE_CONVEX_URL', 'NEXT_PUBLIC_CONVEX_URL'];

/** `kind:name` when the kind is one of `kinds`. */
function parseDeployment(value: string, kinds: readonly ConvexTarget['kind'][]): { kind: ConvexTarget['kind']; name: string } | null {
  const cut = value.indexOf(':');
  const kind = kinds.find((k) => k === value.slice(0, cut));
  return kind && cut + 1 < value.length ? { kind, name: value.slice(cut + 1) } : null;
}

function urlTarget(value: string, source: string): ConvexTarget | null {
  if (!URL.canParse(value)) return null;
  const host = new URL(value).hostname;
  if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(host)) return { kind: 'local', name: host, source };
  return { kind: 'unknown', name: host, source };
}

/**
 * The deployment `npx convex import` will write to, as far as Redline can tell. Each key is read
 * from `env` first, then from the env files in order: `CONVEX_DEPLOY_KEY`, then
 * `CONVEX_DEPLOYMENT`, then a Convex URL. Only the part of a deploy key before `|` is read; the
 * secret after it is never kept. A cloud URL alone cannot tell prod from dev, so it is `unknown`.
 */
export function resolveConvexTarget({ env, envFiles }: { env: Record<string, string | undefined>; envFiles: { name: string; vars: Record<string, string> }[] }): ConvexTarget {
  const lookup = (key: string): { value: string; source: string } | null => {
    if (env[key]) return { value: env[key], source: `${key} in the environment` };
    const file = envFiles.find((f) => f.vars[key]);
    return file ? { value: file.vars[key], source: `${key} in ${file.name}` } : null;
  };
  const key = lookup('CONVEX_DEPLOY_KEY');
  if (key) {
    const cut = key.value.indexOf('|');
    const parsed = cut < 0 ? null : parseDeployment(key.value.slice(0, cut), ['prod', 'dev', 'preview']);
    return { kind: 'unknown', ...parsed, source: key.source };
  }
  const deployment = lookup('CONVEX_DEPLOYMENT');
  if (deployment) {
    const value = deployment.value.trim();
    return { kind: 'unknown', name: value, ...parseDeployment(value, ['prod', 'dev', 'preview', 'local', 'anonymous']), source: deployment.source };
  }
  for (const k of CONVEX_URL_KEYS) {
    const url = lookup(k);
    const target = url && urlTarget(url.value.trim(), url.source);
    if (target) return target;
  }
  return { kind: 'unknown', source: 'no CONVEX_DEPLOY_KEY, CONVEX_DEPLOYMENT or Convex URL found' };
}

/** Resolve the target for `dir` from `process.env` and the env files there. */
export function readConvexTarget(dir: string): ConvexTarget {
  const envFiles = CONVEX_ENV_FILES.flatMap((name) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? [{ name, vars: parseEnvText(fs.readFileSync(file, 'utf8')) }] : [];
  });
  return resolveConvexTarget({ env: process.env, envFiles });
}

/**
 * Check that an import into `target` may run, and return the line to log before it. Throws for
 * prod, and for a deployment Redline cannot identify, unless `allowProd` is set.
 */
export function checkConvexTarget(target: ConvexTarget, { allowProd, replace }: { allowProd?: boolean; replace?: boolean }): string {
  const label = target.kind === 'unknown' ? (target.name ? `${target.name} (unknown kind)` : 'unknown') : `${target.kind}:${target.name ?? '?'}`;
  const what = `Convex deployment ${label} (from ${target.source})`;
  const verb = replace ? 'replacing data in' : 'importing data into';
  if (!allowProd && (target.kind === 'prod' || target.kind === 'unknown')) {
    const why = target.kind === 'prod'
      ? 'it is a production deployment'
      : 'Redline cannot tell whether it is production. A Convex URL alone, or a deploy key without a deployment name, does not say. Set CONVEX_DEPLOYMENT (for example dev:<name> or local:<name>) in .env.local, with no deploy key that overrides it';
    throw new Error(`Refusing to import a Convex snapshot into ${what}: ${why}. Pass --allow-prod (or set dataSnapshot.allowProd: true in redline.config.json) if you mean it. See ${CONVEX_DOC}.`);
  }
  return `redline: ${verb} ${what}`;
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
  const line = checkConvexTarget(readConvexTarget(root), { allowProd: options.allowProd, replace: options.replace });
  const tty = Boolean(process.stdin.isTTY);
  let yes = options.yes;
  if (tty && !yes && !options.replace) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Perform import? [y/N] ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Import cancelled.');
    yes = true;
  }
  (options.log ?? console.log)(line);
  convex(root, convexImportArgs(file, { replace: options.replace, yes, tty }));
}
