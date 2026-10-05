# @vedantb/redline

See what a code change did to every page of your Vite or Next.js app. Redline builds two commits, screenshots each page at both, and writes a static report: which pages changed, which are new or gone, which look broken, and which files most likely caused each change.

```sh
npm install -D @vedantb/redline playwright
npx playwright install chromium
npx redline compare              # HEAD~1 -> HEAD
npx redline compare main HEAD --seed /blog/hello
```

The report lists pages as **Looks broken**, **Changed**, **New**, **Removed**, **Couldn't check** or **Unchanged**, ranked, with thumbnails and suspect files. Each page has before and after side by side with numbered boxes on the changed areas, and a slider. `report.json` has the same data.

```ts
import { compare, discoverRoutes, affectedRoutes } from '@vedantb/redline';

const { report, reportFile } = await compare({ root: 'apps/web', base: 'main' });
const { routes } = await discoverRoutes({ root: 'apps/web', baseUrl: 'http://localhost:3000' });
const { routes: hit, removed } = affectedRoutes({ root: 'apps/web', changedFiles: ['components/Button.tsx'] });
```

Pages are found from file-system routes, a link crawl from `/`, `sitemap.xml`, and seeds in `redline.config.json` or `--seed`. Both commits are built in git worktrees and cached under `.redline/`; your working tree is never touched.

## In-app overlay (optional)

A separate, dev-only overlay outlines the rendered elements whose source changed since a pinned commit, in your running dev server:

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { redline } from '@vedantb/redline/vite';

export default { plugins: [redline(), react()] };
```

```tsx
import { RedlineOverlay } from '@vedantb/redline/overlay';

<RedlineOverlay />;
```

Full documentation, including the report, the API, Next.js set-up and the overlay's History builds: https://github.com/vvedantb/redline#readme

Route detection is ported from [pre-post](https://github.com/juangadm/pre-post) (MIT). See `THIRD_PARTY_NOTICES.md`.
