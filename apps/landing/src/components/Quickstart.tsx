import { IconArrowRight } from '@tabler/icons-react';
import { Button, LandingSection, LandingSectionHeading, landingPanelClass } from '@vvedantb/ui';
import { DOCS_URL, GITHUB_URL } from '../links';
import { LandingReveal as Reveal, LandingRevealItem as RevealItem } from './kit';

export function Quickstart() {
  return (
    <LandingSection id="install">
      <Reveal>
        <RevealItem>
          <LandingSectionHeading
            eyebrow="Install"
            heading="Add it to your project"
            intro="The Vite plugin and overlay are optional. For Next.js, use withRedline."
          />
        </RevealItem>
      </Reveal>
      <Reveal className="snippets">
          <RevealItem>
            <Snippet label="terminal">{`npm install -D @vvedantb/redline playwright
npx playwright install chromium
npx redline compare`}</Snippet>
          </RevealItem>
          <RevealItem>
            <Snippet label="vite.config.ts">
              {`import react from '@vitejs/plugin-react';
import { redline } from '@vvedantb/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [redline(), react()],
});`}
            </Snippet>
          </RevealItem>
          <RevealItem>
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
      <div className="mt-10 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center sm:gap-3">
        <Button asChild size="lg" className="sm:min-w-40">
          <a href={DOCS_URL} target="_blank" rel="noreferrer">
            Read the docs
            <IconArrowRight size={16} aria-hidden />
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </Button>
      </div>
    </LandingSection>
  );
}

function Snippet({ label, children }: { label: string; children: string }) {
  return (
    <figure className={`snippet ${landingPanelClass}`}>
      <figcaption className="snippet-label">{label}</figcaption>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
    </figure>
  );
}
