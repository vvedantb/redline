import { spawnSync } from 'node:child_process';
import { SUMMARY_MARKER } from './compare/summary';

/** Runs `gh` with `args` in `cwd`, `input` on stdin, and returns its trimmed stdout; throws on failure. */
export type GhRunner = (args: string[], cwd: string, input?: string) => string;

function gh(args: string[], cwd: string, input?: string): string {
  const res = spawnSync('gh', args, { cwd, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.error || res.status !== 0) {
    throw new Error(`\`gh ${args.slice(0, 3).join(' ')}\` failed: ${(res.error?.message ?? res.stderr ?? '').trim() || `exit code ${res.status}`}`);
  }
  return res.stdout.trim();
}

/**
 * Post `body` on a pull request, or update Redline's earlier comment there (found by its marker
 * and written by the same GitHub user), so a PR keeps one Redline comment. `pr` is a number, or
 * `auto` for the current branch's PR. Uses the GitHub CLI and its login. Returns the comment URL.
 * When the login cannot be read (an app token has no `/user`), a new comment is posted rather
 * than risk editing someone else's.
 */
export function postPrComment(pr: string, body: string, cwd: string, run: GhRunner = gh): string {
  const number = pr === 'auto' ? run(['pr', 'view', '--json', 'number', '--jq', '.number'], cwd) : pr;
  if (!/^\d+$/.test(number)) throw new Error(`Not a pull request number: ${number}`);
  let login = '';
  try {
    login = run(['api', 'user', '--jq', '.login'], cwd);
  } catch {
    // Posted as new below.
  }
  const ids = /^[\w.[\]-]+$/.test(login)
    ? run(['api', '--paginate', `repos/{owner}/{repo}/issues/${number}/comments`, '--jq', `.[] | select(.user.login == "${login}" and (.body | startswith("${SUMMARY_MARKER}"))) | .id`], cwd)
    : '';
  const existing = ids.split('\n').filter(Boolean).pop();
  const payload = JSON.stringify({ body });
  const out = existing
    ? run(['api', '-X', 'PATCH', `repos/{owner}/{repo}/issues/comments/${existing}`, '--input', '-', '--jq', '.html_url'], cwd, payload)
    : run(['api', '-X', 'POST', `repos/{owner}/{repo}/issues/${number}/comments`, '--input', '-', '--jq', '.html_url'], cwd, payload);
  return out;
}
