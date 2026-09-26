# Baseline fixtures

"Commit A" versions of demo components. The E2E test pins these as a content
baseline, so the committed demo files act as "commit B":

- `Hero.tsx`: old title text, no paragraph.
- `Stats.tsx`: `stats` layout class (now `stats stats--wide`), no "Review time" card.

Header, Signup and Footer have no fixture, so they must never be outlined.
