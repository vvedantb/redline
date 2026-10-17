# @vvedantb/redline

See what a code change did to every page of your Vite or Next.js app. Redline builds two commits, screenshots each page at both, and writes a static report: which pages changed, which are new or gone, which look broken, and which files most likely caused each change.

```sh
npm install -D @vvedantb/redline playwright
npx playwright install chromium
npx redline compare              # HEAD~1 -> HEAD
npx redline compare main HEAD --seed /blog/hello
```

The report lists pages as **Looks broken**, **Changed**, **New**, **Removed**, **Couldn't check** or **Unchanged**, ranked, with thumbnails and suspect files. Each page has before and after side by side with numbered boxes on the changed areas, and a slider. `report.json` has the same data.

The report also has a **Route changes** section (routes added, removed or touched by the diff) and the full PR diff, in unified or split view, with syntax highlighting.

**Jev visual linking (optional).** Set `TYPESAFE_API_KEY` to link each changed area to the files that likely caused it. If the key is unset, the report shows a skip notice and the rest is unchanged. Results are cached in `.redline/jev-cache`.

```ts
import { compare, discoverRoutes, affectedRoutes } from '@vvedantb/redline';

const { report, reportFile } = await compare({ root: 'apps/web', base: 'main' });
const { routes } = await discoverRoutes({ root: 'apps/web', baseUrl: 'http://localhost:3000' });
const { routes: hit, removed } = affectedRoutes({ root: 'apps/web', changedFiles: ['components/Button.tsx'] });
```

Pages are found from file-system routes, a link crawl from `/`, `sitemap.xml`, and seeds in `redline.config.json` or `--seed`. Both commits are built in git worktrees and cached under `.redline/`; your working tree is never touched.

## Convex snapshots

`redline snapshot` and `redline restore <file>` wrap `convex export` and `convex import`, so you can save and reload local Convex data (with file storage). The backend must be running. Use `--out <file>` to choose the zip and `--replace` to replace existing data on restore. See the GitHub repo docs/convex-local-snapshots.md (not included in the npm package).

## In-app overlay (optional)

A separate, dev-only overlay outlines the rendered elements whose source changed since a pinned commit, in your running dev server:

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { redline } from '@vvedantb/redline/vite';

export default { plugins: [redline(), react()] };
```

```tsx
import { RedlineOverlay } from '@vvedantb/redline/overlay';

<RedlineOverlay />;
```

Full documentation, including the report, the API, Next.js set-up and the overlay's History builds: https://github.com/vvedantb/redline#readme

Route detection is ported from [pre-post](https://github.com/juangadm/pre-post) (MIT). See `THIRD_PARTY_NOTICES.md`.
