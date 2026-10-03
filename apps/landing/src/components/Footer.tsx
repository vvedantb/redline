import { GITHUB_URL } from '../links';
import { GitHubIcon, Mark } from './icons';

export function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <span className="wordmark small">
          <Mark size={12} />
          <span>Redline</span>
        </span>
        <p className="footer-note">Built for local dev. No backend, no auth.</p>
        <a className="footer-link" href={GITHUB_URL}>
          <GitHubIcon size={14} />
          vvedantb/redline
        </a>
      </div>
    </footer>
  );
}
