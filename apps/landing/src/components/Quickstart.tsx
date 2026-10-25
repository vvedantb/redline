import { Reveal, RevealItem } from './Reveal';
import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon } from './icons';

export function Quickstart() {
  return (
    <section className="section" id="install" aria-labelledby="install-title">
      <div className="shell">
        <Reveal>
          <RevealItem className="section-head">
            <h2 id="install-title" className="section-title">
              Add it to your project
            </h2>
            <p className="section-sub">The Vite plugin and overlay are optional. For Next.js, use withRedline.</p>
          </RevealItem>
        </Reveal>
        <Reveal as="div" className="snippets">
          <RevealItem index={0}>
            <Snippet label="terminal">{`npm install -D @vvedantb/redline playwright
npx playwright install chromium
npx redline compare`}</Snippet>
          </RevealItem>
          <RevealItem index={1}>
            <Snippet label="vite.config.ts">
              {`import react from '@vitejs/plugin-react';
import { redline } from '@vvedantb/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [redline(), react()],
});`}
            </Snippet>
          </RevealItem>
          <RevealItem index={2}>
            <Snippet label="App.tsx">
              {`import { RedlineOverlay } from '@vvedantb/redline/overlay';

export function App() {
  return (
    <>
      <YourApp />
      <RedlineOverlay />
    </>
  );
}`}
            </Snippet>
          </RevealItem>
        </Reveal>
        <div className="cta-row">
          <a className="btn btn-primary" href={DOCS_URL} target="_blank" rel="noreferrer">
            Read the docs
            <ArrowIcon />
          </a>
          <a className="text-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function Snippet({ label, children }: { label: string; children: string }) {
  return (
    <figure className="snippet">
      <figcaption className="snippet-label">{label}</figcaption>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </figure>
  );
}
