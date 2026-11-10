# Baseline fixtures

"Commit A" versions of demo components. The E2E test pins these as a content
baseline, so the committed demo files act as "commit B":

- `Hero.tsx`: old title text, no paragraph.
- `Stats.tsx`: `stats` layout class (now `stats stats--wide`), no "Review time" card.

Header, Signup and Footer have no fixture, so they must never be outlined.

## Current fixtures

`current/` holds copies of `Hero.tsx` and `Stats.tsx` as they are in `apps/demo`
today ("commit B"). The E2E test pins them to check that re-pinning clears
outlines. Tests must not read live `apps/` or `packages/*/src` files, so update
these copies when the demo components change.
