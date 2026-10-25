import { useEffect, useRef, useState } from 'react';
import { NAV_LINKS } from '../content';
import { GITHUB_URL } from '../links';
import { CloseIcon, GitHubIcon, MenuIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { Wordmark } from './Wordmark';

export function Nav() {
  const [open, setOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
        <div className="nav-actions" ref={actionsRef}>
          <a className="icon-btn nav-github" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="Redline on GitHub">
            <GitHubIcon />
          </a>
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="nav-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          {open ? (
            <div className="menu" id="nav-menu">
              {NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              ))}
              <hr />
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                <GitHubIcon size={16} />
                GitHub
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
