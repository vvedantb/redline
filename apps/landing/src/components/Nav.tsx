import { NAV_LINKS } from '../content';
import { GITHUB_URL } from '../links';
import { ArrowIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

export function Nav() {
  return (
    <header className="nav">
      <div className="shell nav-inner">
        <a className="wordmark-link" href="#top" aria-label="Redline, back to top">
          <Wordmark />
        </a>
        <nav className="nav-links" aria-label="Sections">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <ThemeToggle />
          <a className="btn btn-primary btn-sm" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
            <ArrowIcon size={12} />
          </a>
        </div>
      </div>
    </header>
  );
}
