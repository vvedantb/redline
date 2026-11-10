# Claude notes

Follow [AGENTS.md](AGENTS.md). In particular:

## Testing rules

- The default is no new test.
- A test must call real code. Never read or regex source files (source, CSS, markdown) in a test.
- A regression test must fail on the old code and must run in CI.
- Run `npm run lint:tests` before you push. It bans tests that read live `apps/` or `packages/*/src` trees.
- Build `@vvedantb/redline` before typecheck: `npm run build -w @vvedantb/redline && npm run typecheck`.
