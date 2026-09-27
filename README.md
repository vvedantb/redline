# Redline

Redline is a dev-only npm package for Vite and Next.js React apps. You pin a baseline commit. After an agent or a pull request edits your code, Redline outlines the rendered elements whose source changed since that baseline. Click an outline to see the diff hunk.

Package: `@vedantb/redline`

## How it works

1. A transform adds `data-redline-source="src/Hero.tsx:4-9"` (file, start line, end line) to every JSX host element (`div`, `h1`, `button` and so on) in dev.
2. The dev server serves `/__redline/*`. `GET /__redline/diff` runs `git diff <baseline>` over `tsx`, `jsx`, `ts`, `js` and `css` files, adds untracked files, and returns parsed hunks.
3. `<RedlineOverlay />` fetches the diff, finds tagged elements, and maps each changed line to the innermost element whose source range contains it. It draws a fixed-position outline over each match.
4. Each outline has a small label button. Click it to open a side panel with the file path, line and hunk text.
5. A floating toolbar shows the status. Use it to hide outlines or open the commit history.
6. In the history panel, click a commit to see the app as it was. Redline builds that commit in a separate git worktree and shows the build in an iframe.

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
| `history` | `{ maxBuilds: 5, thumbnails: true }` | History builds. `maxBuilds` is how many ready builds stay on disk. `thumbnails: false` skips Playwright screenshots. `false` turns History builds off. |

Set `REDLINE=0` in the environment to turn Redline off whatever `enabled` says. History builds use this.

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

`GET /__redline/diff?baseline=<sha>` diffs against a given commit without changing the pinned file. `<RedlineOverlay baseline={sha} />` uses this.

## Endpoints

`pin` and `clear` only write or delete `.redline/baseline.json`. `build` only writes under `.redline/` and adds git worktrees there. None of the endpoints run `git checkout`, `git restore`, `git reset` or anything else that changes your working tree.

| Endpoint | Returns |
| --- | --- |
| `GET /__redline/diff[?baseline=<ref>]` | Parsed hunks: working tree vs the pinned baseline, or vs `<ref>` when given. |
| `GET /__redline/baseline` | `HEAD` SHA and the pinned baseline. |
| `GET /__redline/log[?limit=<n>]` | Commits reachable from `HEAD`, newest first: `sha`, `shortSha`, `subject`, `author`, `date` (ISO 8601). Default limit 50, maximum 200. Uses `git log`. |
| `GET /__redline/file?path=<path>[&ref=<ref>]` | `{ path, ref, content }` for a file at a commit (default `HEAD`). Uses `git show`. `path` is relative to the project root and must stay inside it. Only files with a configured extension can be read. |
| `POST /__redline/pin` | Pins a baseline (see above). |
| `POST /__redline/clear` | Removes the pin. |
| `POST /__redline/build` `{ "sha": "<ref>" }` | Queues a production build of a commit. Returns the existing job if it is queued, building or ready. A failed job is queued again. Answers `202` with `{ build }`. |
| `GET /__redline/build[?sha=<ref>]` | One job as `{ build }`, or all jobs as `{ builds }`, newest first. Jobs that are building or failed include `logTail`, the last lines of the log. |
| `GET /__redline/build/log?sha=<ref>` | The full `build.log`, as `text/plain`. |
| `GET /__redline/build/thumb?sha=<sha>` | The thumbnail PNG, if one was captured. |
| `DELETE /__redline/build?sha=<ref>` | Cancels a queued or running build and deletes its files. |
| `GET /__redline/h/<sha>/*` | Static files of a ready build. Paths without an extension fall back to `index.html`. |

Build endpoints are Vite only for now. On Next.js they answer `501`.

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

### History builds

The history panel lists recent commits, newest first, from `GET /__redline/log`. Click a commit to see the app as it was at that commit:

1. Redline queues a build of the commit (`POST /__redline/build`). The row and the main view show **Queued**, then **Building** with the last lines of the log.
2. When the build is **Ready**, an iframe loads `/__redline/h/<sha>/` over the page. The toolbar and history panel stay on top, outside the iframe.
3. If the build **Failed**, the row shows the error and log tail, with a **Retry** button.
4. Click **Latest**, in the toolbar or at the top of the panel, to hide the iframe and go back to the live app.

Outlines are drawn on the live app only. They are hidden while you view a commit. Viewing a commit does not pin it and does not change `.redline/baseline.json`. The choice is held in memory, so a page reload returns to Latest.

How a build runs (one at a time):

1. `git worktree add --detach .redline/worktrees/<sha> <sha>`. Your working tree and branch are never checked out, restored or reset.
2. Dependencies: if the lockfile at that commit matches the one on disk, Redline links your `node_modules` into the worktree. Otherwise it runs `npm ci` (or `pnpm install --frozen-lockfile`, `yarn install`, `bun install`) in the worktree.
3. `vite build --base /__redline/h/<sha>/ --outDir .redline/builds/<sha>/dist`, with `REDLINE=0` and `NODE_ENV=production`. Tagging and the overlay are off in the build. The overlay also stays off on any page under `/__redline/h/`, even with `enabled={true}`.
4. The worktree is removed, whether the build worked or not.
5. If Playwright and a Chromium browser are installed, Redline serves the build on a throwaway localhost port and saves a 1280×800 screenshot as the thumbnail. If not, it skips this step; the build still works.

Job states: `queued` → `building` → `ready` or `failed`. Redline keeps the 5 most recently viewed ready builds (`history.maxBuilds`) and deletes older ones. Builds cut short by a dev server restart show as failed; click Retry.

Disk layout (`.redline/` should be in `.gitignore`):

```
.redline/
  baseline.json
  builds/<sha>/meta.json     sha, shortSha, status, framework, queuedAt, startedAt, finishedAt, basePath, error
  builds/<sha>/build.log     output of every step
  builds/<sha>/dist/         the static build, served at /__redline/h/<sha>/
  snapshots/<sha>/thumb.png  thumbnail, when Playwright is available
  worktrees/<sha>/           only while a build runs
```

To try it:

```sh
npm install
npm run dev                          # demo at http://localhost:5173
# open the page, click History in the toolbar, then click a commit
curl -X POST localhost:5173/__redline/build -H 'content-type: application/json' -d '{"sha":"HEAD~1"}'
curl localhost:5173/__redline/build  # watch the job move to ready
```

Next.js: History builds are not supported yet. A follow-up will run `next build` with `basePath` and serve the static export, or run `next start` for apps that need a server. Until then, the build endpoints answer `501` and a Next job fails with a clear message.

The overlay is off when any of these is true:

- `enabled={false}` on the component, or `enabled: false` in the plugin
- the URL has `?redline=0`
- the page is a History build under `/__redline/h/`
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
- choosing a commit in the history panel builds it, shows it in an iframe without outlines or pinning, and **Latest** returns to the live app with outlines

The suite is local only. It needs no auth, backend or credentials. CI runs the same commands on Node 22 (`.github/workflows/ci.yml`).

## Repo layout

```
packages/redline   the npm package
apps/demo          Vite + React demo that uses Redline on itself
e2e/               Playwright tests and baseline fixtures
```

## Limits

- Only JSX host elements are tagged. Elements created with `React.createElement` or rendered by third-party components in `node_modules` are not.
- History builds are Vite only. They need your dependencies to build that commit. In a monorepo where the app imports a workspace package that is built from source (like this repo's demo), linking `node_modules` uses the current build of that package, and a fresh install may fail if the package's build output is not committed.
- History builds of client-side routers need the router to respect Vite's `base` (`import.meta.env.BASE_URL`).
- The toolbar can be moved with a pointer only. There is no keyboard control for its position.
- The endpoints run `git` commands and builds in the project root. They are meant for local dev servers and must not be exposed publicly.
