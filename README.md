# Redline

Redline is a dev-only npm package for Vite and Next.js React apps. You pin a baseline commit. After an agent or a pull request edits your code, Redline outlines the rendered elements whose source changed since that baseline. Click an outline to see the diff hunk.

Package: `@vedantb/redline`

## How it works

1. A transform adds `data-redline-source="src/Hero.tsx:4-9"` (file, start line, end line) to every JSX host element (`div`, `h1`, `button` and so on) in dev.
2. The dev server serves `/__redline/*`. `GET /__redline/diff` runs `git diff <baseline>` over `tsx`, `jsx`, `ts`, `js` and `css` files, adds untracked files, and returns parsed hunks.
3. `<RedlineOverlay />` fetches the diff, finds tagged elements, and maps each changed line to the innermost element whose source range contains it. It draws a fixed-position outline over each match.
4. Each outline has a small label button. Click it to open a side panel with the file path, line and hunk text.
5. A floating toolbar shows the status. Use it to hide outlines or open the commit history.

Redline does not change your production build. The transform and endpoints run only in dev unless you set `enabled: true`.

## Install

```sh
npm install -D @vedantb/redline
```

Peer dependencies: `react` and `react-dom` 18 or later, plus `vite` 5 or later or `next` 13 or later.

## Vite

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { redline } from '@vedantb/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Put redline() before react() so it sees the original JSX.
  plugins: [redline(), react()],
});
```

Mount the overlay once, near the root of your app:

```tsx
import { RedlineOverlay } from '@vedantb/redline';

export function App() {
  return (
    <>
      <YourApp />
      <RedlineOverlay />
    </>
  );
}
```

Plugin options:

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` in `vite dev`, `false` in `vite build` | `false` turns off tagging and makes `/__redline/*` report `enabled: false`. `true` also tags production builds and serves the endpoints from `vite preview`. |
| `baselineFile` | `<root>/.redline/baseline.json` | Where the pinned baseline is stored. |
| `extensions` | `['tsx', 'jsx', 'ts', 'js', 'css']` | File types included in git diffs. |

## Next.js

`withRedline` tags JSX under both Turbopack and webpack. Both bundlers use the same loader (`@vedantb/redline/loader`):

- **Turbopack** (the default for `next dev` on Next 16): a rule for `**/*.{tsx,jsx}` is added to `turbopack.rules`. On Next versions before 15.3, it goes in `experimental.turbo.rules` instead. Redline picks the key from the installed `next` version. If your config already sets `experimental.turbo` (and not `turbopack`), Redline uses that key.
- **webpack** (`next dev --webpack`, or Next versions before 16): a pre-loader is added in the `webpack()` hook. Your own `webpack` function still runs first.

Your existing `turbopack` or `experimental.turbo` settings and rules are kept. If you already have a rule for `**/*.{tsx,jsx}`, Redline adds its loader to the end of that rule's `loaders`, so it runs first on the original JSX.

Version notes:

- Tested by hand on Next 16.3.6 with Turbopack and with `--webpack`.
- The `experimental.turbo.rules` path for Next versions before 15.3 is covered by unit tests only. If tagging does not work on an older Next with Turbopack, run `next dev` without `--turbo` to use webpack.

```js
// next.config.mjs
import { withRedline } from '@vedantb/redline/next';

export default withRedline({
  reactStrictMode: true,
});
```

Add the API route that serves the endpoints. `withRedline` rewrites `/__redline/:action` to `/api/redline/:action`.

```ts
// app/api/redline/[action]/route.ts
import { createRedlineHandler } from '@vedantb/redline/next';

export const { GET, POST } = createRedlineHandler();
```

Render the overlay from a client component:

```tsx
'use client';
import { RedlineOverlay } from '@vedantb/redline';

export function DevTools() {
  return <RedlineOverlay />;
}
```

`withRedline(config, options)` accepts `enabled`, `apiRoute` (default `/api/redline`), `baselineFile` and `extensions`. When `NODE_ENV` is `production` and `enabled` is not `true`, it returns your config unchanged and the route handler reports `enabled: false`. In dev it also sets `NEXT_PUBLIC_REDLINE=1`.

The Next.js integration is covered by unit tests. The E2E suite runs against the Vite demo.

## Pinning a baseline

A baseline is the "last good" state that Redline diffs against. Redline stores it locally. There is no auth or backend. There are two ways to set it.

### Local file (default)

`POST /__redline/pin` writes `.redline/baseline.json` in the project root. Add `.redline/` to `.gitignore`. The request body picks the mode:

| Body | Mode | Result |
| --- | --- | --- |
| `{}` | git | Pins the current `HEAD` SHA. |
| `{ "sha": "HEAD~1" }` | git | Pins any commit, branch or ref. It is resolved to a full SHA. |
| `{ "files": { "src/Hero.tsx": "..." } }` | content | Pins file contents. Only these files are diffed, against what is on disk now. |

Git mode diffs the working tree against the pinned commit. This includes committed changes, uncommitted edits and untracked files. Content mode suits tests and cases with no useful commit to point at.

`GET /__redline/baseline` returns the current `HEAD` SHA and the pinned baseline. `POST /__redline/clear` removes the pin.

From the browser:

```ts
import { pinBaseline, getBaseline, clearBaseline } from '@vedantb/redline';

await pinBaseline();                  // pin HEAD
await pinBaseline({ sha: 'abc1234' }); // pin a commit
await pinBaseline({ files: { 'src/Hero.tsx': oldSource } }); // content baseline
const { headSha, baseline } = await getBaseline();
await clearBaseline();
```

These helpers also mirror the baseline to `localStorage` (`redline:baseline`). If the dev server cannot be reached, `getBaseline()` falls back to that copy.

### Per-request override

`GET /__redline/diff?baseline=<sha>` diffs against a given commit without changing the pinned file. `<RedlineOverlay baseline={sha} />` and history view-mode use this.

## Endpoints

All endpoints are read-only except `pin` and `clear`, which only write or delete `.redline/baseline.json`. None of them run `git checkout`, `git restore`, `git reset` or anything else that changes your working tree.

| Endpoint | Returns |
| --- | --- |
| `GET /__redline/diff[?baseline=<ref>]` | Parsed hunks: working tree vs the pinned baseline, or vs `<ref>` when given. |
| `GET /__redline/baseline` | `HEAD` SHA and the pinned baseline. |
| `GET /__redline/log[?limit=<n>]` | Commits reachable from `HEAD`, newest first: `sha`, `shortSha`, `subject`, `author`, `date` (ISO 8601). Default limit 50, maximum 200. Uses `git log`. |
| `GET /__redline/file?path=<path>[&ref=<ref>]` | `{ path, ref, content }` for a file at a commit (default `HEAD`). Uses `git show`. `path` is relative to the project root and must stay inside it. Only files with a configured extension can be read. |
| `POST /__redline/pin` | Pins a baseline (see above). |
| `POST /__redline/clear` | Removes the pin. |

From the browser, `getLog({ limit })` wraps `/__redline/log`.

## Overlay

```tsx
<RedlineOverlay
  endpoint="/__redline"   // base URL of the endpoints
  enabled={true}          // force on or off
  baseline={null}         // git SHA override for this request only
  pollInterval={2000}     // ms; 0 turns polling off
  respectReducedMotion    // default true
  color="#e11d48"
/>
```

Outlines do not intercept clicks on your page. Only the small label button on each outline, the toolbar and open panels are clickable. Press Escape to close the diff panel, then the history panel.

### Toolbar

A floating toolbar sits bottom-left by default. It shows how many regions changed and which baseline they are compared with. It has:

- a drag handle (⠿). Drag to move the toolbar. Double-click to put it back bottom-left.
- **Hide outlines** / **Show outlines**. This hides the outlines but keeps the toolbar, so you can turn them back on.
- **History**, which opens the commit history panel.

The position and outline visibility are saved in `localStorage` under `redline:toolbar`. This is separate from `redlineDisabled`: that flag, and the other flags below, remove the whole overlay, toolbar included.

### History and view-mode

The history panel lists recent commits, newest first, from `GET /__redline/log`. Click a commit to enter view-mode. The overlay then diffs the working tree against that commit (`/__redline/diff?baseline=<sha>`) and outlines what changed since it. The toolbar shows "Viewing <sha>". Click **Latest**, in the toolbar or at the top of the panel, to go back to the pinned baseline (or no baseline, if none is pinned).

View-mode is read-only:

- It does not check out, restore, reset or revert anything. Your files and branch stay as they are.
- It does not change `.redline/baseline.json`. Viewing a commit is not pinning it. Use `pinBaseline({ sha })` to pin.
- It is held in memory, so a page reload returns to Latest.

Source-map drift: view-mode does not show the page as it was at that commit. The DOM still comes from your running code, and the `data-redline-source` tags point at current source lines. Outlines mark current elements whose source differs from the commit. So:

- elements that existed at the commit but have since been deleted have nothing to outline. Their hunks appear only as pure deletions on a surrounding element.
- for older commits, hunks are larger and outlines fold into bigger parent elements.
- if the running page is stale (for example, hot reload has not caught up with files on disk), tags and diff lines can disagree and outlines may land on the wrong element.

The overlay is off when any of these is true:

- `enabled={false}` on the component, or `enabled: false` in the plugin
- the URL has `?redline=0`
- the user has `prefers-reduced-motion: reduce` (pass `respectReducedMotion={false}` to ignore this)
- `localStorage.redlineDisabled === '1'` (`?redline=1` overrides this flag)
- it is a production build and `enabled` is not `true`

Call `refreshRedline()` to make the overlay refetch straight away. It otherwise polls every 2 seconds.

### Mapping rules

- A changed or added line maps to the innermost tagged element whose source range contains it.
- A pure deletion maps to the innermost element that contains the lines on both sides of it.
- If an element is entirely new, its tagged children are folded into it, so it gets one outline.
- Lines outside any JSX host element (imports, helpers, types) are ignored. CSS changes are returned by the diff endpoint but are not outlined, because CSS lines do not map to elements.
- Only host elements are tagged. A change to a component's props at the call site maps to the nearest host element around the call.

## Run the demo

```sh
npm install
npm run dev     # builds the package, then starts the demo at http://localhost:5173
```

Use the bar at the top to pin `HEAD`, see the current and pinned SHAs, clear the baseline and toggle the overlay. Then edit a component in `apps/demo/src/components` and watch the outline appear.

## Tests

```sh
npm test            # Vitest unit tests for the package
npm run test:e2e    # builds the package, starts the demo dev server, runs Playwright
npm run build       # builds the package and the demo
```

Install the browser once before running E2E locally:

```sh
npx playwright install chromium
```

The E2E suite tests the package on its own demo. It needs the Vite dev server, because the transform and endpoints run only in dev. The demo files on disk act as "commit B". The test pins "commit A" as a content baseline from `e2e/fixtures/baseline/` (older `Hero.tsx` and `Stats.tsx`). It then checks that:

- outlines appear on the changed Hero and Stats elements and not on Header, Signup or Footer
- clicking an outline label opens the panel with the right file and hunk text
- re-pinning to the current file contents clears the outlines
- pinning `HEAD` from the UI stores the git SHA
- `?redline=0`, reduced motion, and the overlay toggle each turn the overlay off
- the toolbar hides and shows outlines and restores its saved position after a reload
- choosing a commit in the history panel enters view-mode without pinning, and **Latest** leaves it

The suite is local only. It needs no auth, backend or credentials. CI runs the same commands on Node 22 (`.github/workflows/ci.yml`).

## Repo layout

```
packages/redline   the npm package
apps/demo          Vite + React demo that uses Redline on itself
e2e/               Playwright tests and baseline fixtures
```

## Limits

- Only JSX host elements are tagged. Elements created with `React.createElement` or rendered by third-party components in `node_modules` are not.
- History view-mode outlines can drift for old commits (see "History and view-mode").
- The toolbar can be moved with a pointer only. There is no keyboard control for its position.
- The endpoints run read-only `git` commands in the project root. They are meant for local dev servers and must not be exposed publicly.
