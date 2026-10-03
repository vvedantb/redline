import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon, GitHubIcon } from './icons';

const CHIPS = ['Vite', 'Next.js', 'Dev-only', 'No backend'];

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-grid" />
        <div className="hero-wash" />
        <div className="hero-grain" />
      </div>
      <div className="shell hero-inner">
        <div className="hero-scrim" aria-hidden="true" />
        <p className="badge">
          <span className="pulse-dot" aria-hidden="true" />
          Dev-only · Vite &amp; Next.js
        </p>
        <h1 id="hero-title" className="hero-title">
          See what your agent changed, <em>outlined in your running app</em>
        </h1>
        <p className="hero-sub">
          Pin a baseline commit. Redline outlines the rendered elements whose source changed since then. Click an
          outline to see the diff.
        </p>
        <div className="hero-ctas">
          <a className="btn btn-primary" href={GITHUB_URL}>
            <GitHubIcon size={16} />
            View on GitHub
          </a>
          <a className="btn btn-secondary" href={DOCS_URL}>
            Read the docs
            <ArrowIcon />
          </a>
        </div>
        <ul className="chips" aria-label="Works with">
          {CHIPS.map((chip) => (
            <li key={chip} className="chip">
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
