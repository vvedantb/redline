# Redline

Redline shows what a code change did to every page of your Vite or Next.js app. It builds two commits, screenshots each page at both, and writes a static report: which pages changed, which are new or gone, which look broken, and which files most likely caused each change.

```sh
npm install -D @vvv/redline playwright
npx playwright install chromium
npx redline compare            # HEAD~1 -> HEAD
```

Open the `index.html` path it prints. Redline is a CLI, a Node API and a static report you can open from disk or host anywhere, so any project or tool can use it.

## The report

The first page lists every page that needs a look, most important first, each with a thumbnail, a status and the files it most likely came from:

| Status | Meaning |
| --- | --- |
| **Looks broken** | The page now returns a 5xx, shows the framework's error screen, throws a new uncaught error, turns blank, or shows "not found" while its route still exists. |
| **Changed** | Pixels differ. Changed areas are boxed and numbered. |
| **New** | The page exists only after the change. |
| **Removed** | Its page file was deleted, or it is gone after the change. |
| **Couldn't check** | Redline could not capture it: it redirects to sign-in, fails to load, is a dynamic route with no example URL, or is over the page limit. The reason is shown. |
| **Unchanged** | Folded away at the bottom. |

Click a page for before and after side by side with numbered boxes on the changed areas, a slider view, the suspect files with how many imports away each is, and any new errors. `report.json` holds the same data for tools.

## How `compare` works

1. **Build both commits.** Each commit is built in its own git worktree with the same engine as the overlay's History builds: `vite build --base /__redline/h/<sha>/`, or `next build` with `output: 'standalone'` and a matching `basePath`. Your working tree is never touched. `node_modules` is linked from the main tree when the lockfile is unchanged; otherwise the worktree installs. Builds are cached by commit under `.redline/`. The built pages run with History's read-only network layer, so they cannot write to your APIs.
2. **Find the pages.** File-system routes (Next.js `app/` and `pages/`; Vite `src/pages`, `src/routes` and React Router declarations), a crawl of same-origin links two clicks deep from `/`, `sitemap.xml`, and seeds from you. A dynamic route such as `/blog/[slug]` is captured only through a concrete URL from one of those sources.
3. **Capture.** Every page at both commits in headless Chromium, set up to repeat: fixed clock, seeded `Math.random`, reduced motion, animations and transitions off, caret hidden, dev overlays hidden, UTC and `en-US`, service workers off, wait for network idle and fonts, scroll to trigger lazy content. Full-page screenshots, cut at 4000px.
4. **Diff.** Pixel diff with [pixelmatch](https://github.com/mapbox/pixelmatch). Changed pixels are grouped into boxes; specks under 100 square pixels are dropped.
5. **Explain.** The changed files from `git diff` are traced through an import graph to the pages that use them (layouts wrap the pages under them; global CSS and Tailwind config reach every page). That gives each page its "Likely from" list and ranks direct causes first. If a scan limit is hit, the report says so.

## CLI

```
redline compare [base] [head] [options]

  base                 Commit to compare against (default HEAD~1)
  head                 Commit to check (default HEAD)
  --root <dir>         App directory (default: current directory)
  --out <dir>          Report directory (default: <root>/.redline/report)
  --max-routes <n>     Pages captured at most (default: 50)
  --seed <path>        Extra page to capture, e.g. /blog/hello. Repeatable.
  --viewport <WxH>     Viewport (default: 1280x800)
  --chrome <path>      Chrome or Chromium binary to use
```

Run it from the app directory (in a monorepo, the package with the Next or Vite config). It exits with 1 on errors such as a failed build, and 0 otherwise, whatever the report says.

Optional `redline.config.json` in the app directory:

```json
{
  "seeds": ["/blog/hello", "/docs/getting-started"],
  "maxRoutes": 50,
  "viewport": { "width": 1280, "height": 800 }
}
```

## Node API

```ts
import { compare, discoverRoutes, affectedRoutes } from '@vvv/redline';

// Everything the CLI does. Resolves with the report and its path.
const { report, reportFile } = await compare({ root: 'apps/web', base: 'main', head: 'HEAD', seeds: ['/blog/hello'] });

// Pages of an app: file-system routes, plus link crawl and sitemap when baseUrl is given.
const { routes, skipped } = await discoverRoutes({ root: 'apps/web', baseUrl: 'http://localhost:3000' });

// Which routes do these files touch? Paths are relative to root. No git or browser needed.
const { routes: hit, removed, unplaced, limits } = affectedRoutes({
  root: 'apps/web',
  changedFiles: ['components/Button.tsx'],
  deletedFiles: ['app/old/page.tsx'],
});
```

`affectedRoutes` returns each route with its confidence and the files that reach it, closest first. Deleted page files come back in `removed`. `limits.filesCapped` and `limits.depthCapped` say when the 8000-file scan or the 8-import walk was cut short. `writeReport`, `diffImages` and `classify` are exported too, for tools that capture pages their own way.

## Compare limits

- Needs Playwright and Chromium (`npx playwright install chromium`), or `--chrome` pointing at an installed Chrome.
- Pages behind sign-in are listed as "Couldn't check". There is no login step yet.
- Pages that load data at runtime see History's read-only network layer: reads are replayed from `.redline/network-fixtures.json` when a fixture matches, writes never leave the browser. Pages that depend on live data may differ between runs.
- Both commits must build. A failed build stops the run and prints the end of its log.
- Client-side routers must respect Vite's `base` (`import.meta.env.BASE_URL`).
- No AI labels yet: the report says where pixels changed and which files likely caused it, not what the change means.

## In-app overlay (optional)

Redline also ships a dev-only overlay. You pin a baseline commit; after an agent or a pull request edits your code, the overlay outlines the rendered elements whose source changed since that baseline, in your running dev server. Click an outline to see the diff hunk. It is independent of `compare`.

### How it works

1. A transform adds `data-redline-source="src/Hero.tsx:4-9"` (file, start line, end line) to every JSX host element (`div`, `h1`, `button` and so on) in dev.
2. The dev server serves `/__redline/*`. `GET /__redline/diff` runs `git diff <baseline>` over `tsx`, `jsx`, `ts`, `js` and `css` files, adds untracked files, and returns parsed hunks.
3. `<RedlineOverlay />` fetches the diff, finds tagged elements, and maps each changed line to the innermost element whose source range contains it. It draws a fixed-position outline over each match.
4. Each outline has a small label button. Click it to open a side panel with the file path, line and hunk text.
5. A floating toolbar shows the status. Use it to hide outlines or open the commit history.
6. In the history panel, click a commit to see the app as it was. Redline builds that commit in a separate git worktree and shows the build in an iframe.

Redline does not change your production build. The transform and endpoints run only in dev unless you set `enabled: true`.

### Install

Peer dependencies: `react` and `react-dom` 18 or later, plus `vite` 5 or later or `next` 13 or later. The overlay is imported from `@vvv/redline/overlay`.

### Vite

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { redline } from '@vvv/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Put redline() before react() so it sees the original JSX.
  plugins: [redline(), react()],
});
```

Mount the overlay once, near the root of your app:

```tsx
import { RedlineOverlay } from '@vvv/redline/overlay';

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
| `history` | `{ maxBuilds: 5, thumbnails: true }` | History builds. `maxBuilds` is how many ready builds stay on disk. `thumbnails: false` skips Playwright screenshots. `networkFixtures` is the fixtures file for the [read-only network layer](#history-network-read-only) (default `.redline/network-fixtures.json`). `false` turns History builds off. |

Set `REDLINE=0` in the environment to turn Redline off whatever `enabled` says. History builds use this.

### Next.js

`withRedline` tags JSX under both Turbopack and webpack. Both bundlers use the same loader (`@vvv/redline/loader`):

- **Turbopack** (the default for `next dev` on Next 16): a rule for `**/*.{tsx,jsx}` is added to `turbopack.rules`. On Next versions before 15.3, it goes in `experimental.turbo.rules` instead. Redline picks the key from the installed `next` version. If your config already sets `experimental.turbo` (and not `turbopack`), Redline uses that key.
- **webpack** (`next dev --webpack`, or Next versions before 16): a pre-loader is added in the `webpack()` hook. Your own `webpack` function still runs first.

Your existing `turbopack` or `experimental.turbo` settings and rules are kept. If you already have a rule for `**/*.{tsx,jsx}`, Redline adds its loader to the end of that rule's `loaders`, so it runs first on the original JSX.

Version notes:

- Tested by hand on Next 16.3.6 with Turbopack and with `--webpack`.
- The `experimental.turbo.rules` path for Next versions before 15.3 is covered by unit tests only. If tagging does not work on an older Next with Turbopack, run `next dev` without `--turbo` to use webpack.

```js
// next.config.mjs
import { withRedline } from '@vvv/redline/next';

export default withRedline({
  reactStrictMode: true,
});
```

Add the API route that serves the endpoints. `withRedline` rewrites `/__redline/:path*` to `/api/redline/:path*`. The route must be a catch-all (`[...action]`), because `build/log`, `build/thumb` and the History proxy under `h/<sha>/` have more than one segment. Export every method, so that History previews can handle form posts and Server Actions.

```ts
// app/api/redline/[...action]/route.ts
import { createRedlineHandler } from '@vvv/redline/next';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createRedlineHandler();
```

If you are upgrading, rename `app/api/redline/[action]` to `app/api/redline/[...action]`. The old single-segment route still serves `diff`, `baseline`, `pin` and the other one-segment endpoints, but not History builds.

`createRedlineHandler(options)` accepts the `withRedline` options plus:

| Option | Default | What it does |
| --- | --- | --- |
| `root` | `process.cwd()` | Project root. `.redline/` lives here. Under `next dev` this is the app directory. |
| `history` | `{ maxBuilds: 5, thumbnails: true }` | History builds. `appDir` is the Next.js app relative to `root`, for a monorepo where `root` is the repository top level. `maxBuilds`, `thumbnails` and `networkFixtures` work as for Vite. `false` turns History builds off, and the build endpoints answer `501`. |

Render the overlay from a client component:

```tsx
'use client';
import { RedlineOverlay } from '@vvv/redline/overlay';

export function DevTools() {
  return <RedlineOverlay />;
}
```

`withRedline(config, options)` accepts `enabled`, `apiRoute` (default `/api/redline`), `baselineFile` and `extensions`. When `NODE_ENV` is `production` and `enabled` is not `true`, it returns your config unchanged and the route handler reports `enabled: false`. `REDLINE=0` in the environment does the same, even with `enabled: true`. In dev it also sets `NEXT_PUBLIC_REDLINE=1`.

The Next.js integration is covered by unit tests. The E2E suite runs against the Vite demo.

### Pinning a baseline

A baseline is the "last good" state that Redline diffs against. Redline stores it locally. There is no auth or backend. There are two ways to set it.

#### Local file (default)

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
import { pinBaseline, getBaseline, clearBaseline } from '@vvv/redline/overlay';

await pinBaseline();                  // pin HEAD
await pinBaseline({ sha: 'abc1234' }); // pin a commit
await pinBaseline({ files: { 'src/Hero.tsx': oldSource } }); // content baseline
const { headSha, baseline } = await getBaseline();
await clearBaseline();
```

These helpers also mirror the baseline to `localStorage` (`redline:baseline`). If the dev server cannot be reached, `getBaseline()` falls back to that copy.

#### Per-request override

`GET /__redline/diff?baseline=<sha>` diffs against a given commit without changing the pinned file. `<RedlineOverlay baseline={sha} />` uses this.

### Endpoints

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
| `GET /__redline/h/<sha>/*` | A ready build. Vite: static files, and paths without an extension fall back to `index.html`. Next.js: every method is reverse-proxied to the build's standalone server. |

Build endpoints work with Vite and Next.js. On Next.js they need the catch-all API route above. With `history: false` they answer `501`.

From the browser, `getLog({ limit })` wraps `/__redline/log`.

### Overlay

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

#### Toolbar

A floating toolbar sits bottom-left by default. It shows how many regions changed and which baseline they are compared with. It has:

- a drag handle (⠿). Drag to move the toolbar. Double-click to put it back bottom-left.
- **Hide outlines** / **Show outlines**. This hides the outlines but keeps the toolbar, so you can turn them back on.
- **History**, which opens the commit history panel.

The position and outline visibility are saved in `localStorage` under `redline:toolbar`. This is separate from `redlineDisabled`: that flag, and the other flags below, remove the whole overlay, toolbar included.

#### History builds

The history panel lists recent commits, newest first, from `GET /__redline/log`. Click a commit to see the app as it was at that commit:

1. Redline queues a build of the commit (`POST /__redline/build`). The row and the main view show **Queued**, then **Building** with the last lines of the log.
2. When the build is **Ready**, an iframe loads `/__redline/h/<sha>/` over the page. The toolbar and history panel stay on top, outside the iframe.
3. If the build **Failed**, the row shows the error and log tail, with a **Retry** button.
4. Click **Latest**, in the toolbar or at the top of the panel, to hide the iframe and go back to the live app.

Outlines are drawn on the live app only. They are hidden while you view a commit. Viewing a commit does not pin it and does not change `.redline/baseline.json`. The choice is held in memory, so a page reload returns to Latest.

How a Vite build runs (one at a time):

1. `git worktree add --detach .redline/worktrees/<sha> <sha>`. Your working tree and branch are never checked out, restored or reset.
2. Dependencies: if the lockfile at that commit matches the one on disk, Redline links your `node_modules` into the worktree. Otherwise it runs `npm ci` (or `pnpm install --frozen-lockfile`, `yarn install`, `bun install`) in the worktree.
3. Env files are copied from your working tree into the worktree, [filtered to public keys](#history-env-allowlist): from the git top level and, in a monorepo, from the Vite config directory. Redline reads `.env`, `.env.local`, `.env.development`, `.env.production` and `.env.<name>.local`, when present. A file committed at that commit is kept and not overwritten. Having no env files is fine. The log shows what was kept, for example `Copied filtered env files: .env.local (kept 2 keys, stripped 3)`. Vite inlines `import.meta.env.VITE_*` at build time, so an app that checks its client env when it loads (for example with t3-env) needs its public keys in these files, or in the dev server's environment. Without them, the preview is blank.
4. `vite build --base /__redline/h/<sha>/ --outDir .redline/builds/<sha>/dist`, with `REDLINE=0` and `NODE_ENV=production`. The dev server's environment is passed on without secret and Convex keys, so a `VITE_CONVEX_URL` in your shell is not inlined. Tagging and the overlay are off in the build. The overlay also stays off on any page under `/__redline/h/`, even with `enabled={true}`.
5. The worktree is removed, whether the build worked or not. The filtered env files go with it, but their `VITE_*` values stay inlined in `dist/`.
6. If Playwright and a Chromium browser are installed, Redline serves the build on a throwaway localhost port and saves a 1280×800 screenshot as the thumbnail. If not, it skips this step; the build still works.

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

##### Next.js History builds

The badges, log tail, **Retry** and **Latest** work as for Vite. The iframe loads the same same-origin URL, `/__redline/h/<sha>/`. Redline does not iframe a localhost port.

How a Next.js build runs (one at a time, in the same queue as Vite):

1. `git worktree add --detach .redline/worktrees/<sha> <sha>`. Your working tree is never checked out, restored or reset.
2. Redline checks that the app directory in the worktree is a Next.js app. It looks for a `next.config.*` file, a `next` dependency, or an `app/` or `pages/` directory. If it finds none, the job fails straight away with a hint to set `history.appDir`.
3. Dependencies are linked or installed, as for Vite.
4. Env files are copied from your working tree into the worktree, [filtered to public keys](#history-env-allowlist): from the git top level and, in a monorepo, from the app directory. Redline reads `.env`, `.env.local`, `.env.development`, `.env.production` and `.env.<name>.local`, when present. A file committed at that commit is kept and not overwritten. Having no env files is fine.
5. The app's `next.config.*` in the worktree is renamed to `next.config.redline-user.*`. A wrapper with the original name imports it and forces `output: 'standalone'`, `basePath: '/__redline/h/<sha>'` and `distDir: '.next'`. It also sets `outputFileTracingRoot` and `turbopack.root` to the git top level, so that linked `node_modules` stay inside the tracing root. It removes `assetPrefix` and `env.NEXT_PUBLIC_REDLINE`. Your committed config does not need `output: 'standalone'`, and the config file in your working tree is not changed.
6. `next build` runs in the worktree app directory with `NODE_ENV=production` and `REDLINE=0`. Redline adds `--webpack` if the app's `build` script uses it. Redline strips the dev server's own variables (`__NEXT_*`, `NEXT_PRIVATE_*`, `TURBOPACK*`, `PORT`, `HOSTNAME`) and every secret or Convex key (see the [allowlist](#history-env-allowlist)) from the environment. `withRedline` and `createRedlineHandler` are off under `REDLINE=0`, so the snapshot has no tags, no overlay and no Redline endpoints.
7. `.next/standalone` moves to `.redline/builds/<sha>/standalone/`. Then `.next/static` and `public/` go next to `server.js`. Next mirrors the app's path from the tracing root, so `server.js` sits at `standalone/<path from git top to the worktree app>/server.js`. A build is ready only when that `server.js` exists.
8. The worktree is removed, whether the build worked or not.

The first request for `/__redline/h/<sha>/` starts `node server.js` in that directory. It runs on a free port, with `PORT=<port>`, `HOSTNAME=127.0.0.1`, `NODE_ENV=production` and `REDLINE=0`. The API route then proxies the request to it. The path is forwarded unchanged, because the snapshot was built with the History base path. So `_next/static`, `next/link` and `next/image` all resolve under `/__redline/h/<sha>/`. The proxy sets `x-forwarded-host` and `x-forwarded-proto`, so that Server Actions pass their origin check. It turns redirects to the local port into same-origin paths and keeps every `Set-Cookie` header. Paths with `.`, `..`, encoded slashes, backslashes or NUL are rejected with `404`. Server output goes to `.redline/builds/<sha>/server.log`.

Each ready build that has been viewed keeps one server running. Redline stops the server when the build is removed (`DELETE`, Retry or LRU eviction) and when the dev server exits. Thumbnails start the server, take the screenshot and stop it again.

The snapshot server inherits the dev server's environment, less the variables listed in step 6. The filtered env files are also used at build time, so public `NEXT_PUBLIC_*` values are inlined. The copies are deleted with the worktree. Server secrets, database URLs and Convex keys do not reach the snapshot, so server code that needs them fails in the preview rather than calling a live backend. Treat `.redline/` as sensitive, and keep it in `.gitignore`.

HTML pages from the snapshot server get the [read-only network bootstrap](#history-network-read-only) added to `<head>` by the proxy. HTML responses are buffered for this; other responses stream as before.

Monorepo (Turborepo, pnpm or npm workspaces). If `next dev` runs in `apps/web`, the default `root` is `apps/web`. Redline finds the git top level itself, so you need no extra options. If you set `root` to the repository top level instead, add `appDir`:

```ts
// apps/web/app/api/redline/[...action]/route.ts
import path from 'node:path';
import { createRedlineHandler } from '@vvv/redline/next';

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = createRedlineHandler({
  root: path.resolve(process.cwd(), '../..'),
  history: { appDir: 'apps/web', maxBuilds: 3 },
});
```

Next.js disk layout (`root` is the app directory in this example):

```
.redline/
  builds/<sha>/meta.json      framework: "next", status, timestamps, basePath, error
  builds/<sha>/build.log      worktree, install, env copy, next build
  builds/<sha>/server.log     output of node server.js
  builds/<sha>/standalone/    .next/standalone, with .next/static and public/ added
    node_modules/             traced dependencies
    <app path>/server.js      <app path> is the worktree app relative to the git top level,
    <app path>/.next/static     for example apps/web/.redline/worktrees/<sha>/apps/web
    <app path>/public
  worktrees/<sha>/            only while a build runs
```

To try it on a Next.js app:

```sh
npm run build -w @vvv/redline     # then install the package in your app
# add withRedline to next.config.*, the [...action] route above and <RedlineOverlay />
next dev
curl -X POST localhost:3000/__redline/build -H 'content-type: application/json' -d '{"sha":"HEAD~1"}'
curl localhost:3000/__redline/build     # watch the job move to ready
open http://localhost:3000/__redline/h/$(git rev-parse HEAD~1)/
```

Or open the app, click **History** in the toolbar, then click a commit. The unit tests cover the Next.js path (`packages/redline/test/standalone.test.ts`). It was also tested by hand on Next 16.3.6 with Turbopack and linked `node_modules`. The E2E suite runs against the Vite demo.

##### History env allowlist

History is read-only. It must not reach a live backend or hold server secrets. So Redline filters env files as it copies them into the worktree:

- Kept: `CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, and other `VITE_*`, `NEXT_PUBLIC_*` and `PUBLIC_*` keys.
- Always stripped, even with a public prefix: any key that contains `CONVEX` (for example `VITE_CONVEX_URL`, `CONVEX_DEPLOY_KEY`); any key that matches `SECRET`, `PASSWORD`, `PRIVATE_KEY`, `API_KEY`, `ACCESS_TOKEN`, `AUTH_TOKEN`, `DEPLOY_KEY`, `DATABASE_URL` or `CREDENTIAL`; and any value that contains `convex.cloud` or `.convex.site`.
- Dropped: every other key, comments and lines that are not `KEY=value`.

The process environment for `vite build`, `next build` and the standalone server loses the always-stripped keys too. Other variables (`PATH`, `HOME` and so on) stay, because the build tools need them. `@vvv/redline/vite` and `@vvv/redline/next` export the rules as `HISTORY_ENV_ALLOWLIST`, `HISTORY_ENV_STRIP_KEYS` and `HISTORY_ENV_STRIP_VALUE`, and the check as `isHistoryEnvKeyAllowed(key, value)`. A custom Vite `envPrefix` is not on the allowlist.

##### History network (read-only)

History pages also get a small, generic network layer. It is not tied to Convex or any other backend:

1. Redline adds `<script src="/__redline/network/bootstrap.js"></script>` at the start of `<head>` in every History HTML page. It is a blocking script, so it runs before the app's module scripts. The dev server serves it (not the build), so every build gets the current version.
2. On a page under `/__redline/h/`, the script sets `window.__redlineNetwork.mode` to `'replay'` and patches `fetch` and `XMLHttpRequest`:
   - `GET` and `HEAD` requests that match a fixture get the canned response, with the header `X-Redline-Fixture: 1`. Requests with no fixture go to the network as usual, so static assets still load.
   - `POST`, `PUT`, `PATCH` and `DELETE` never reach the network. They get `200 {"ok":true,"readOnly":true}` with `X-Redline-Read-Only: 1`, and `window.__redlineNetwork.lastMutation` is set to `{ method, url, blocked: true }`.
3. Fixtures come from `GET /__redline/network/fixtures`, which reads `history.networkFixtures` (default `.redline/network-fixtures.json`). A missing file means no fixtures.

Fixture file format (synthetic data only; do not put secrets in it):

```json
{
  "version": 1,
  "entries": [
    {
      "request": { "method": "GET", "url": "/api/demo/notes" },
      "response": { "status": 200, "headers": { "content-type": "application/json" }, "body": { "notes": [{ "id": "1", "text": "Fixture note" }] } }
    }
  ]
}
```

`method` defaults to `GET` and `status` to `200`. A string `body` is sent as is; anything else is sent as JSON. URLs match on path and query, then on path alone. The host is ignored, and so are the `/__redline/h/<sha>` prefix and a trailing slash. So `/api/x`, `api/x` and `https://any.host/api/x/` all match `/api/x`.

`window.__redlineNetwork` is `{ mode, readOnly, fixturesLoaded, lastMutation?, match(url, method?), dumpFixtures(), downloadFixtures() }`. The `NetworkFixtures` and `RedlineNetworkState` types are exported from `@vvv/redline`.

Capture: on a live Vite dev page, the plugin adds the same script, which does nothing unless the URL has `?redlineNetwork=capture`. Then it records same-origin JSON `GET` responses made with `fetch`. Call `__redlineNetwork.dumpFixtures()` in the console to see them, or `downloadFixtures()` to save `network-fixtures.json`. Review the file before you commit it: it holds whatever your live API returned. On Next.js, add the script tag to your root layout in dev to use capture.

WebSockets are not patched. A protocol adapter for WebSocket backends (for example Convex sync) is future work. Until then, stripping `*CONVEX*` keys stops a History build from connecting to a live Convex deployment.

The overlay is off when any of these is true:

- `enabled={false}` on the component, or `enabled: false` in the plugin
- the URL has `?redline=0`
- the page is a History build under `/__redline/h/`
- the user has `prefers-reduced-motion: reduce` (pass `respectReducedMotion={false}` to ignore this)
- `localStorage.redlineDisabled === '1'` (`?redline=1` overrides this flag)
- it is a production build and `enabled` is not `true`

Call `refreshRedline()` to make the overlay refetch straight away. It otherwise polls every 2 seconds.

#### Mapping rules

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
npm run test:compare  # builds the package, runs `redline compare` on the example apps
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
- the live demo reads its notes from the live dev API (`/api/demo/notes`) and shows the dev server's synthetic `VITE_CONVEX_URL`
- choosing a commit in the history panel builds it, shows it in an iframe without outlines or pinning, and **Latest** returns to the live app with outlines
- in that iframe the network layer is in `replay` mode: the notes come from `apps/demo/network-fixtures.json`, **Add note** is answered read-only and never reaches the live API (by `fetch` or XHR), and `VITE_CONVEX_URL` was not inlined into the build

`npm run test:compare` turns each app in `examples/compare/` (Next.js and Vite) into a throwaway two-commit repo under `.e2e/`: `base/`, then `base/` with `head/` copied over and the files in `deleted.txt` removed. It runs the CLI on `HEAD~1..HEAD` and checks every page's status and suspect file in `report.json`: a copy change and a component change show as Changed, a client component that throws as Looks broken, a deleted page as Removed, a new page as New, a sign-in redirect and an unlinked catch-all route as Couldn't check, and the rest as Unchanged. Open `.e2e/<app>/.redline/report/index.html` to see the report.

The suites are local only. It needs no auth, backend or credentials. The `VITE_CONVEX_URL` it sets on the dev server is a made-up URL (`e2e/env.ts`); nothing connects to it. CI runs the same commands on Node 22 (`.github/workflows/ci.yml`).

## Repo layout

```
packages/redline   the npm package
apps/demo          Vite + React demo that uses the overlay on itself
e2e/               Playwright tests and baseline fixtures for the overlay
examples/compare   Next.js and Vite apps (base and head) for the compare end-to-end check
scripts/           compare-e2e.mjs
```

## Overlay limits

- Only JSX host elements are tagged. Elements created with `React.createElement` or rendered by third-party components in `node_modules` are not.
- History builds need your dependencies to build that commit. In a monorepo where the app imports a workspace package that is built from source (like this repo's demo), linking `node_modules` uses the current build of that package, and a fresh install may fail if the package's build output is not committed.
- History builds of client-side routers need the router to respect Vite's `base` (`import.meta.env.BASE_URL`).
- Vite History builds inline your current public `VITE_*` values, not the ones at that commit. Env files are copied (filtered) from your working tree, not read from history. An env file committed at that commit is used as committed, without filtering.
- The read-only network layer covers `fetch` and `XMLHttpRequest` only. WebSockets, `EventSource` and `navigator.sendBeacon` are not intercepted.
- Next.js History builds override `basePath`, `assetPrefix`, `distDir` and the tracing root for the snapshot. Code that hard-codes root-relative URLs (for example `fetch('/api/x')`, not through `next/link` or the base path) calls the live dev server, not the snapshot, unless a fixture matches it. Writes are always blocked. `next build` must succeed at that commit, type checks and lint included.
- Each Next.js preview is a separate Node process. It uses the memory that `next start` would. Lower `history.maxBuilds` if that is a problem.
- The toolbar can be moved with a pointer only. There is no keyboard control for its position.
- The endpoints run `git` commands and builds in the project root. They are meant for local dev servers and must not be exposed publicly.

## Credits

Route detection (the import graph, and the Next.js and Vite route rules) is ported from [pre-post](https://github.com/juangadm/pre-post) under the MIT License. See [`packages/redline/THIRD_PARTY_NOTICES.md`](packages/redline/THIRD_PARTY_NOTICES.md).
