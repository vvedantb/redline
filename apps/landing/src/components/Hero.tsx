import type { CSSProperties } from 'react';
import { DOCS_URL, GITHUB_URL } from '../links';
import { ArrowIcon, CompareIcon, HistoryIcon, OverlayIcon, ReportIcon } from './icons';
import { OverlayMock } from './Mocks';

const CAPS = [
  { label: 'Compare', icon: <CompareIcon /> },
  { label: 'Overlay', icon: <OverlayIcon /> },
  { label: 'History', icon: <HistoryIcon /> },
  { label: 'Report', icon: <ReportIcon /> },
];

function step(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

export function Hero() {
  return (
    <section className="shell hero" aria-labelledby="hero-title">
      <p className="eyebrow hero-enter" style={step(0)}>
        Visual diff for Vite &amp; Next.js
      </p>
      <h1 id="hero-title" className="hero-title hero-enter" style={step(1)}>
        See what changed.
        <br />
        On every page.
      </h1>
      <p className="hero-sub hero-enter" style={step(2)}>
        Redline builds two commits, screenshots each page, and outlines changed elements in your running app.
      </p>
      <div className="cta-row hero-enter" style={step(3)}>
        <a className="btn btn-primary" href={DOCS_URL} target="_blank" rel="noreferrer">
          Install
          <ArrowIcon />
        </a>
        <a className="text-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </div>
      <p className="status hero-enter" style={step(4)}>
        <span className="dot" aria-hidden="true" />
        Dev-only · local · no backend
      </p>
      <ul className="caps hero-enter" style={step(5)} aria-label="Capabilities">
        {CAPS.map((cap) => (
          <li key={cap.label}>
            {cap.icon}
            {cap.label}
          </li>
        ))}
      </ul>
      <div className="stage hero-enter" style={step(6)}>
        <OverlayMock />
      </div>
    </section>
  );
}
