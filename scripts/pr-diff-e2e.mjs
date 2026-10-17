// End-to-end check of the PR diff view on e2e/fixtures/pr-diff: a throwaway two-commit repo under
// .e2e/pr-diff, `redline compare` on it, assertions on report.json and index.html, and Playwright
// screenshots of the report. Jev runs twice: without a key (notice only), then with the offline
// mock (REDLINE_JEV_MOCK=1) so boxes show up. No network or API key is needed.
//
//   node scripts/pr-diff-e2e.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'packages/redline/dist/cli.js');
const fixture = path.join(repo, 'e2e/fixtures/pr-diff');
const dir = path.join(repo, '.e2e', 'pr-diff');
const artifactDirs = ['/opt/cursor/artifacts/pr-diff', path.join(repo, 'e2e/artifacts')];
const chrome = process.env.CHROME_PATH ?? ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.fsmonitor=false', '-c', 'user.name=Redline', '-c', 'user.email=redline@example.com', ...args], { cwd: dir, stdio: 'pipe' });

fs.rmSync(dir, { recursive: true, force: true });
fs.cpSync(path.join(fixture, 'base'), dir, { recursive: true });
fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.redline\ndist\n');
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-qm', 'Base');
fs.cpSync(path.join(fixture, 'head'), dir, { recursive: true });
for (const file of fs.readFileSync(path.join(fixture, 'deleted.txt'), 'utf8').split('\n').filter(Boolean)) fs.rmSync(path.join(dir, file));
git('add', '-A');
git('commit', '-qm', 'Restyle Button, add Pricing, drop Legacy');
try {
  execFileSync('cp', ['-al', path.join(repo, 'node_modules'), path.join(dir, 'node_modules')]);
} catch {
  fs.cpSync(path.join(repo, 'node_modules'), path.join(dir, 'node_modules'), { recursive: true, verbatimSymlinks: true });
}

function run(out, env) {
  const base = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' };
  delete base.TYPESAFE_API_KEY;
  delete base.REDLINE_JEV_MOCK;
  execFileSync(process.execPath, [cli, 'compare', '--root', dir, '--out', out, ...(chrome ? ['--chrome', chrome] : [])], { stdio: 'inherit', env: { ...base, ...env } });
  return JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures.push(name);
};

const noKeyOut = path.join(dir, '.redline/report-nokey');
const noKey = run(noKeyOut, {});
check('no key: Jev skipped notice', noKey.notices.includes('Jev visual linking skipped (no TYPESAFE_API_KEY).'));
check('no key: pages have no jev data', noKey.pages.every((p) => !p.jev));

const out = path.join(dir, '.redline/report');
const report = run(out, { REDLINE_JEV_MOCK: '1' });
const names = (list) => list.map((r) => r.pattern);
check('report version 2', report.version === 2);
check('fileDiffs has Button, Home, Pricing, Legacy', ['src/components/Button.jsx', 'src/pages/Home.jsx', 'src/pages/Pricing.jsx', 'src/pages/Legacy.jsx'].every((f) => report.fileDiffs.some((d) => d.path === f && d.patch && d.hunks.length)), JSON.stringify(report.fileDiffs.map((d) => d.path)));
const status = (f) => report.fileDiffs.find((d) => d.path === f)?.status;
check('Pricing added, Legacy deleted in fileDiffs', status('src/pages/Pricing.jsx') === 'added' && status('src/pages/Legacy.jsx') === 'deleted');
check('routeChanges.added = /pricing', names(report.routeChanges.added).join() === '/pricing', JSON.stringify(report.routeChanges.added));
check('routeChanges.removed = /legacy', names(report.routeChanges.removed).join() === '/legacy', JSON.stringify(report.routeChanges.removed));
check('routeChanges.changed = / and /about', names(report.routeChanges.changed).join() === '/,/about', JSON.stringify(report.routeChanges.changed));
const home = report.routeChanges.changed.find((r) => r.pattern === '/');
check('/ lists Button and Home files and a page link', home?.files.includes('src/components/Button.jsx') && home.files.includes('src/pages/Home.jsx') && home.pageId !== null, JSON.stringify(home));
check('added route links a page', report.routeChanges.added[0]?.pageId !== null);
const homePage = report.pages.find((p) => p.path === '/');
check('mock Jev boxes on /', homePage?.jev?.boxes.length >= 1 && homePage.jev.boxes.every((b) => b.file), JSON.stringify(homePage?.jev));
check('mock run has no skipped notice', !report.notices.some((n) => n.includes('Jev visual linking skipped')));

const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
check('index.html has Route changes', html.includes('Route changes'));
check('index.html has file diff', html.includes('id="diff-src-components-Button-jsx"') && html.includes('diff-unified') && html.includes('diff-split'));
check('Route changes comes first', html.indexOf('Route changes') < html.indexOf('class="grid"'));

if (!failures.length) {
  const { chromium } = createRequire(path.join(repo, 'package.json'))('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const d of artifactDirs) fs.mkdirSync(d, { recursive: true });
  const shot = async (name, target) => {
    const buf = await target.screenshot();
    for (const d of artifactDirs) fs.writeFileSync(path.join(d, name), buf);
    console.log(`screenshot ${name}`);
  };
  await page.goto(pathToFileURL(path.join(out, 'index.html')).href);
  await shot('route-changes.png', page.locator('#route-changes'));
  await shot('index-top.png', page.locator('header'));
  await page.locator('#pr-diff-section').scrollIntoViewIfNeeded();
  await shot('diff-unified.png', page.locator('#pr-diff-section'));
  await page.click('[data-diffview="split"]');
  await shot('diff-split.png', page.locator('#pr-diff-section'));
  await page.goto(pathToFileURL(path.join(out, 'pages', `${homePage.id}.html`)).href);
  await shot('page-jev-overlay.png', page.locator('main'));
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nReport: ${path.join(out, 'index.html')}`);
