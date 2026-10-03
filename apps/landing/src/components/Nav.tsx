import { GITHUB_URL } from '../links';
import { GitHubIcon, Mark } from './icons';

const LINKS = [
  { href: '#overlay', label: 'Overlay' },
  { href: '#history', label: 'History' },
  { href: '#how', label: 'How it works' },
  { href: '#install', label: 'Install' },
];

export function Nav() {
  return (
    <header className="nav">
      <div className="shell nav-inner">
        <a className="wordmark" href="#top" aria-label="Redline, back to top">
          <Mark />
          <span>Redline</span>
        </a>
        <nav className="nav-links" aria-label="Sections">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className="icon-link" href={GITHUB_URL} aria-label="Redline on GitHub">
          <GitHubIcon />
        </a>
      </div>
    </header>
  );
}
