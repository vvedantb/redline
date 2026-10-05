// End-to-end check of `redline compare` on the example apps in examples/compare.
// Each example becomes a throwaway git repo under .e2e/ with two commits: base/, then base/
// overlaid with head/ and the files in deleted.txt removed. The CLI runs on HEAD~1..HEAD and the
// statuses in report.json are checked.
//
//   node scripts/compare-e2e.mjs [next|vite]...
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'packages/redline/dist/cli.js');

const EXPECTED = {
  next: {
    '/': ['changed', 'app/page.jsx'],
    '/about': ['unchanged'],
    '/blog/hello': ['unchanged'],
    '/faq': ['unchanged'],
    '/contact': ['changed', 'components/ContactForm.jsx'],
    '/status': ['broken', 'components/StatusWidget.jsx'],
    '/old': ['removed', 'app/old/page.jsx'],
    '/pricing': ['added', 'app/pricing/page.jsx'],
    '/account': ['skipped'],
    '/docs/[...slug]': ['skipped'],
  },
  vite: {
    '/': ['changed', 'src/components/Button.jsx'],
    '/contact': ['changed', 'src/components/Button.jsx'],
    '/about': ['unchanged'],
    '/settings': ['removed', 'src/pages/Settings.jsx'],
    '/pricing': ['added', 'src/pages/Pricing.jsx'],
  },
};

const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Redline', '-c', 'user.email=redline@example.com', ...args], { cwd, stdio: 'pipe' });

function makeRepo(name) {
  const src = path.join(repo, 'examples/compare', name);
  const dir = path.join(repo, '.e2e', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(src, 'base'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.redline\n.next\ndist\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Base');
  fs.cpSync(path.join(src, 'head'), dir, { recursive: true });
  for (const file of fs.readFileSync(path.join(src, 'deleted.txt'), 'utf8').split('\n').filter(Boolean)) fs.rmSync(path.join(dir, file));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Head');
  // Next's bundler refuses modules resolved outside the repo, so link the dependencies in rather
  // than symlinking the directory.
  try {
    execFileSync('cp', ['-al', path.join(repo, 'node_modules'), path.join(dir, 'node_modules')]);
  } catch {
    fs.cpSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  }
  return dir;
}

let failed = 0;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EXPECTED)) {
  console.log(`\n=== ${name} ===`);
  const dir = makeRepo(name);
  const started = Date.now();
  execFileSync(process.execPath, [cli, 'compare', '--root', dir], { stdio: 'inherit', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  const report = JSON.parse(fs.readFileSync(path.join(dir, '.redline/report/report.json'), 'utf8'));
  const byPath = new Map(report.pages.map((p) => [p.path, p]));
  for (const [route, [status, suspect]] of Object.entries(EXPECTED[name])) {
    const page = byPath.get(route);
    const problems = [];
    if (!page) problems.push('missing from the report');
    else {
      if (page.status !== status) problems.push(`status ${page.status} (${page.reason}), expected ${status}`);
      if (suspect && !page.suspects.some((s) => s.file === suspect)) problems.push(`suspects ${JSON.stringify(page.suspects.map((s) => s.file))}, expected ${suspect}`);
      if (['changed', 'broken'].includes(status) && !page.regions.length) problems.push('no changed regions');
    }
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name} ${route}${problems.length ? ': ' + problems.join('; ') : ''}`);
    failed += problems.length ? 1 : 0;
  }
  console.log(`${name}: ${((Date.now() - started) / 1000).toFixed(1)}s, report at ${path.join(dir, '.redline/report/index.html')}`);
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
