import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon, GitHubIcon } from './icons';
import { Reveal, RevealItem } from './Reveal';

export function Cta() {
  return (
    <div className="atmosphere grain cta-block">
      <section className="shell" aria-labelledby="cta-title">
        <Reveal className="cta-inner">
          <RevealItem as="h2" index={0} className="section-title">
            <span id="cta-title">Run it on your next commit</span>
          </RevealItem>
          <RevealItem as="p" index={1} className="lede">
            Install the package and run <code>redline compare</code>.
          </RevealItem>
          <RevealItem index={2} className="cta-row">
            <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon size={16} />
              View on GitHub
            </a>
            <a className="btn btn-outline" href={DOCS_URL} target="_blank" rel="noreferrer">
              Read the docs
              <ArrowIcon />
            </a>
          </RevealItem>
        </Reveal>
      </section>
    </div>
  );
}
