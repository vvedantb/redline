import { NAV_LINKS } from '../content';
import { GITHUB_URL } from '../links';
import { Wordmark } from './Wordmark';

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <div>
          <Wordmark />
          <p className="footer-tagline">Built for local dev. No backend, no auth.</p>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
