/**
 * Env hardening for History builds. History is read-only: a snapshot must not reach a live
 * backend or hold server secrets. Env files are copied through an allowlist of public keys, and
 * the process env passed to builds and snapshot servers loses secret and Convex keys.
 */

/** Keys and prefixes that may be copied from live env files into a History worktree. */
export const HISTORY_ENV_ALLOWLIST: { readonly keys: readonly string[]; readonly prefixes: readonly string[] } = {
  keys: ['CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'VITE_CLERK_PUBLISHABLE_KEY'],
  prefixes: ['VITE_', 'NEXT_PUBLIC_', 'PUBLIC_'],
};

/** Keys that are always stripped, allowlisted or not. */
export const HISTORY_ENV_STRIP_KEYS: readonly RegExp[] = [
  /CONVEX/i,
  /SECRET|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|DEPLOY_KEY|DATABASE_URL|CREDENTIAL/i,
];

/** Values that are always stripped: Convex cloud URLs. */
export const HISTORY_ENV_STRIP_VALUE = /convex\.cloud|\.convex\.site/i;

/** A secret or backend key (or a Convex URL value) that History must never see. */
export function isHistoryEnvStripped(key: string, value = ''): boolean {
  return HISTORY_ENV_STRIP_KEYS.some((re) => re.test(key)) || HISTORY_ENV_STRIP_VALUE.test(value);
}

/** Whether an env file key may be copied into a History worktree. */
export function isHistoryEnvKeyAllowed(key: string, value?: string): boolean {
  if (isHistoryEnvStripped(key, value)) return false;
  return HISTORY_ENV_ALLOWLIST.keys.includes(key) || HISTORY_ENV_ALLOWLIST.prefixes.some((p) => key.startsWith(p));
}

const ASSIGNMENT = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/;

/**
 * Keep only allowlisted assignments from a dotenv file. Comments, blank lines and anything that
 * is not `KEY=value` are dropped. Quoted values that span lines stay whole.
 */
export function filterEnvText(contents: string): { text: string; kept: number; stripped: number } {
  const lines = contents.split(/\r?\n/);
  const out: string[] = [];
  let kept = 0;
  let stripped = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ASSIGNMENT.exec(lines[i]);
    if (!m) continue;
    const [, key, value] = m;
    const block = [lines[i]];
    const quote = /^["'`]/.exec(value)?.[0];
    if (quote && !value.slice(1).includes(quote)) {
      while (i + 1 < lines.length) {
        block.push(lines[++i]);
        if (lines[i].includes(quote)) break;
      }
    }
    const raw = block.join('\n');
    if (isHistoryEnvKeyAllowed(key, raw)) {
      out.push(raw);
      kept++;
    } else {
      stripped++;
    }
  }
  const header = '# Filtered by Redline for a History build. Only public keys are kept.\n';
  return { text: header + out.map((l) => l + '\n').join(''), kept, stripped };
}

/**
 * Process env without secret or Convex keys. Other variables (PATH, HOME, ...) stay, because
 * the build tools need them.
 */
export function filterEnvRecord(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isHistoryEnvStripped(key, value)) out[key] = value;
  }
  return out;
}
