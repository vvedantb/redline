# Agent notes

Add a changeset (`npm run changeset`) for every user-facing change to `@vvedantb/redline`. See [RELEASING.md](RELEASING.md).

## Tests

- The default is no new test.
- A test must call real code (import it, or render the component). Never read or regex source, CSS or markdown files in a test. `npm run lint:tests` fails CI if a test reads live `apps/` or `packages/*/src` files. Temp-dir fixtures from `mkdtemp` are fine. E2E tests that need file content use `e2e/fixtures`. The one exception is a behavioural test that needs live file contents as input data: mark the read with `allow-source-read: <reason>` (see CLAUDE.md).
- A regression test must fail on the old code and must run in CI. CI runs `lint:tests`, typecheck, `npm test`, e2e and build on every PR and on main.
