import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon, GitHubIcon } from './icons';
import { SectionHeading } from './SectionHeading';

export function Quickstart() {
  return (
    <section className="section" id="install" aria-labelledby="install-title">
      <div className="shell">
        <div className="invert">
          <div className="invert-text">
            <SectionHeading id="install-title" eyebrow="Quickstart">
              Add it to your dev server
            </SectionHeading>
            <p className="invert-lede">
              Install the package, add the Vite plugin before <code>react()</code>, and mount the overlay once near
              your app root. For Next.js, use <code>withRedline</code> and a catch-all API route.
            </p>
            <div className="hero-ctas left">
              <a className="btn btn-inverse" href={GITHUB_URL}>
                <GitHubIcon size={16} />
                View on GitHub
              </a>
              <a className="btn btn-inverse-outline" href={DOCS_URL}>
                Full setup
                <ArrowIcon />
              </a>
            </div>
          </div>
          <div className="snippets">
            <Snippet label="terminal">{`npm install -D @vedantb/redline`}</Snippet>
            <Snippet label="vite.config.ts">
              {`import react from '@vitejs/plugin-react';
import { redline } from '@vedantb/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [redline(), react()],
});`}
            </Snippet>
            <Snippet label="App.tsx">
              {`import { RedlineOverlay } from '@vedantb/redline';

export function App() {
  return (
    <>
      <YourApp />
      <RedlineOverlay />
    </>
  );
}`}
            </Snippet>
          </div>
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
