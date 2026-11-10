// Fails when a test file reads repo source, CSS or docs as text.
// Tests must call real code. Temp-dir fixtures (mkdtemp) are fine, so a path
// such as src/Hero.tsx inside a temp root is not flagged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git', '.e2e', '.redline', '.next', 'playwright-report', 'test-results']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// A file read, or a directory listing, in a test file.
const FS_CALL = /\b(?:readFileSync|readFile|readdirSync|readdir|createReadStream|globSync|glob)\s*\(/;
// Paths that point at live repo trees (not a temp root).
const LIVE_PATH = /(?:['"`/])(?:apps|packages)(?:\/|['"`])|['"`]apps['"`]|['"`]packages['"`]|['"`]\.\.?\/(?:\.\.\/)*(?:src|apps|packages)\b|(?:^|[\s,(])(?:src|apps|packages)['"`]/;
// Reading the live repo via the module location or the working directory.
const LOCATION = /\b(?:import\.meta\.(?:url|dirname|filename)|__dirname|__filename|process\.cwd\s*\(\))/;
const SOURCE_EXT = /\.(?:css|scss|md|mdx|tsx?|jsx?|mjs|cjs)\b/;

export function isTestFile(file) {
  return TEST_FILE.test(file);
}

/** Returns a list of { line, text, reason } for one test file's source. */
export function findViolations(source) {
  const lines = source.split('\n');
  const out = [];
  const usesLocation = LOCATION.test(source);
  const hasTemp = /\bmkdtemp(?:Sync)?\b/.test(source);
  lines.forEach((text, i) => {
    const code = text.replace(/^\s*(?:\/\/|\*|\/\*).*$/, '');
    if (!code.trim()) return;
    const line = i + 1;
    if (FS_CALL.test(code) && LIVE_PATH.test(code)) {
      out.push({ line, text: text.trim(), reason: 'reads a live apps/ or packages/ path' });
    } else if (FS_CALL.test(code) && LOCATION.test(code)) {
      out.push({ line, text: text.trim(), reason: 'reads a path built from the module location or cwd' });
    } else if (FS_CALL.test(code) && usesLocation && !hasTemp && SOURCE_EXT.test(code)) {
      out.push({ line, text: text.trim(), reason: 'reads a source-like file in a test that has no temp root' });
    }
  });
  return out;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (isTestFile(entry.name)) yield full;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  let files = 0;
  for (const file of walk(repo)) {
    files += 1;
    for (const v of findViolations(fs.readFileSync(file, 'utf8'))) {
      bad += 1;
      console.error(`${path.relative(repo, file)}:${v.line}: ${v.reason}\n    ${v.text}`);
    }
  }
  if (bad) {
    console.error(`\n${bad} source-text read(s) in tests. Tests must call real code. See CLAUDE.md.`);
    process.exit(1);
  }
  console.log(`lint:tests ok (${files} test files checked)`);
}
