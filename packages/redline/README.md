# @vedantb/redline

Pin a baseline commit, then see which rendered elements changed since it in your running Vite or Next.js app. Click an outline to see the diff hunk.

```sh
npm install -D @vedantb/redline
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import { redline } from '@vedantb/redline/vite';

export default { plugins: [redline(), react()] };
```

```tsx
import { RedlineOverlay } from '@vedantb/redline';

<RedlineOverlay />;
```

Full documentation, including Next.js set-up and baseline modes: https://github.com/vvedantb/redline#readme
