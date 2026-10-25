import type { CSSProperties } from 'react';
import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon, GitHubIcon } from './icons';

const CHIPS = ['Vite', 'Next.js', 'Local', 'No backend', 'Dev-only overlay'];

function step(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

export function Hero() {
  return (
    <div className="atmosphere grain hero-block">
      <div className="ambient" aria-hidden="true">
        <span className="ambient-box a" />
        <span className="ambient-box b" />
        <span className="ambient-box c" />
        <span className="ambient-box d" />
      </div>
      <div className="hero-scrim" aria-hidden="true" />
      <section className="shell hero" aria-labelledby="hero-title">
        <div className="hero-inner">
          <p className="badge hero-enter" style={step(0)}>
            <span className="pulse-dot" aria-hidden="true" />
            Visual diff for Vite &amp; Next.js
          </p>
          <h1 id="hero-title" className="hero-title hero-enter" style={step(1)}>
            See what a change did to <em>every page</em>
          </h1>
          <p className="hero-sub hero-enter" style={step(2)}>
            Redline builds two commits, screenshots each page at both, and writes a static before and after report.
          </p>
          <div className="cta-row hero-enter" style={step(3)}>
            <a className="btn btn-primary" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon size={16} />
              View on GitHub
            </a>
            <a className="btn btn-outline" href={DOCS_URL} target="_blank" rel="noreferrer">
              Read the docs
              <ArrowIcon />
            </a>
          </div>
          <ul className="chips hero-enter" style={step(4)} aria-label="Capabilities">
            {CHIPS.map((chip) => (
              <li key={chip} className="chip">
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
