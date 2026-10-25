import { useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

const STORAGE_KEY = 'redline-theme';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  function toggle() {
    const next = !dark;
    const root = document.documentElement;
    root.classList.toggle('dark', next);
    root.classList.toggle('light', !next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#1c1c1c' : '#f5f5f5');
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // Storage can be blocked. The toggle still works for this visit.
    }
    setDark(next);
  }

  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
