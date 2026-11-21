// CI end-to-end step. Builds @vvedantb/redline once, then runs the four independent checks, two
// at a time to suit a 4 vCPU runner: the Playwright suite, the Next and Vite compare checks, and the demo and
// landing builds. Each check keeps its own output, printed in a group when it ends. Every
// check runs to the end, nothing is retried or skipped, and the exit code is 1 if any failed.
//
// The same commands used to run one after another as `npm run test:e2e`, `npm run test:compare`
// and `npm run build`, each of which also rebuilt the package.
//
//   node scripts/ci-e2e.mjs
import { spawn } from 'node:child_process';

function run(command) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (err) => resolve({ command, code: 1, output: `${output}${err.message}\n`, seconds: (Date.now() - started) / 1000 }));
    child.on('close', (code) => resolve({ command, code: code ?? 1, output, seconds: (Date.now() - started) / 1000 }));
  });
}

function report(result) {
  console.info(`::group::${result.command}`);
  process.stdout.write(result.output);
  console.info('::endgroup::');
  console.info(`[End-to-end] ${result.command} - ${result.seconds.toFixed(0)}s - ${result.code === 0 ? 'ok' : 'FAILED'}`);
  if (result.code !== 0) console.info(`::error::Failed: ${result.command}`);
}

const build = await run('npm run build -w @vvedantb/redline');
report(build);
if (build.code !== 0) process.exit(1);

const checks = ['npx playwright test', 'node scripts/compare-e2e.mjs next', 'node scripts/compare-e2e.mjs vite', 'npm run build -w redline-demo && npm run build -w redline-landing'];
// Small pool: at most MAX_CONCURRENT checks run at once.
const MAX_CONCURRENT = 2;
const results = new Array(checks.length);
let next = 0;
await Promise.all(
  Array.from({ length: MAX_CONCURRENT }, async () => {
    while (next < checks.length) {
      const i = next++;
      const result = await run(checks[i]);
      report(result);
      results[i] = result;
    }
  }),
);

const failed = results.filter((result) => result.code !== 0);
if (failed.length) {
  console.error(`\n${failed.length} of ${results.length} checks failed:`);
  for (const result of failed) console.error(`  ${result.command}`);
  process.exit(1);
}
