import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { loadChromium } from '../build';

export interface Viewport {
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 };
/** Full-page screenshots stop here. Very long pages are cut, not scaled. */
export const MAX_CAPTURE_HEIGHT = 4000;
const FIXED_TIME = new Date('2025-01-01T12:00:00Z');

/** Turns off motion and the dev overlays Next and Vite add, so two captures of the same UI match. */
const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  caret-color: transparent !important; scroll-behavior: auto !important;
}
nextjs-portal, vite-error-overlay { display: none !important; }
`;

const SEEDED_RANDOM = `(() => {
  let seed = 42;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
})();`;

const APP_ERROR = /Application error: a (client|server)-side exception has occurred|Unexpected Application Error|Internal Server Error/i;
const NOT_FOUND = /\b404\b[\s\S]{0,80}(not found|could not be found)|page (could not be|not) found/i;

export interface PageCapture {
  /** App path that was requested, e.g. `/about`. */
  path: string;
  /** App path after redirects. */
  finalPath: string;
  /** HTTP status of the document. 0 when the page never loaded. */
  status: number;
  /** Set when the page could not be loaded at all. */
  failed?: string;
  /** Uncaught exceptions. */
  errors: string[];
  consoleErrors: string[];
  /** Framework error screen text was on the page. */
  appError: boolean;
  notFound: boolean;
  /** Visible text characters plus media elements. 0 = blank page. */
  content: number;
  /** Same-origin links, as app paths. */
  links: string[];
  image?: string;
  width?: number;
  height?: number;
}

export interface BrowserOptions {
  /** Chrome or Chromium binary. Default: Playwright's own Chromium. */
  executablePath?: string;
}

/** Launch Chromium through the app's or Redline's Playwright install. */
export async function launchBrowser(root: string, options: BrowserOptions = {}): Promise<Browser> {
  const chromium = ((await loadChromium(root)) ?? (await loadChromium(process.cwd()))) as unknown as { launch(o: object): Promise<Browser> } | null;
  if (!chromium) {
    throw new Error('Redline needs Playwright to capture pages. Run: npm i -D playwright && npx playwright install chromium');
  }
  try {
    return await chromium.launch({ executablePath: options.executablePath });
  } catch (err) {
    const first = err instanceof Error ? err.message.split('\n')[0] : String(err);
    throw new Error(`Could not start Chromium (${first}). Run: npx playwright install chromium, or pass --chrome <path>.`);
  }
}

/** A browser context set up for repeatable captures: fixed clock, seeded random, no motion. */
export async function stableContext(browser: Browser, viewport: Viewport = DEFAULT_VIEWPORT): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  await context.clock?.setFixedTime(FIXED_TIME);
  await context.addInitScript(SEEDED_RANDOM);
  return context;
}

/** `http://host/base` + `/about`. `prefix` has no trailing slash. */
export function urlFor(prefix: string, appPath: string): string {
  return prefix + (appPath === '/' ? '/' : appPath);
}

/** App path of `href` under `prefix`, or null when it points elsewhere or at a file. */
export function appPathOf(prefix: string, href: string): string | null {
  let url: URL;
  let base: URL;
  try {
    base = new URL(prefix + '/');
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/$/, '');
  if (url.pathname !== basePath && !url.pathname.startsWith(basePath + '/')) return null;
  const rest = url.pathname.slice(basePath.length).replace(/\/+$/, '') || '/';
  if (/\.[a-z0-9]{2,5}$/i.test(rest)) return null;
  return rest;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => undefined);
  await page
    .evaluate(async () => {
      await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
      const step = window.innerHeight;
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 4000); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
}

/**
 * Load one app path and record what it showed. Writes a screenshot to `screenshot` when given.
 * Never throws for a page that fails: the failure is in the result.
 */
export async function capturePage(context: BrowserContext, prefix: string, appPath: string, screenshot?: string): Promise<PageCapture> {
  const page = await context.newPage();
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message.split('\n')[0]));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().split('\n')[0]);
  });
  const result: PageCapture = { path: appPath, finalPath: appPath, status: 0, errors, consoleErrors, appError: false, notFound: false, content: 0, links: [] };
  try {
    const response = await page.goto(urlFor(prefix, appPath), { waitUntil: 'load', timeout: 30_000 });
    result.status = response?.status() ?? 0;
    await settle(page);
    result.finalPath = appPathOf(prefix, page.url()) ?? new URL(page.url()).pathname;
    const info = await page.evaluate(() => ({
      text: document.body?.innerText ?? '',
      media: document.querySelectorAll('img, video, canvas, svg, iframe').length,
      links: Array.from(document.querySelectorAll('a[href]'), (a) => (a as HTMLAnchorElement).href),
      height: document.documentElement.scrollHeight,
    }));
    result.appError = APP_ERROR.test(info.text);
    result.notFound = result.status === 404 || NOT_FOUND.test(info.text);
    result.content = info.text.trim().length + info.media;
    result.links = [...new Set(info.links.map((href) => appPathOf(prefix, href)).filter((p): p is string => p !== null))].sort();
    if (screenshot) {
      const viewport = page.viewportSize() ?? DEFAULT_VIEWPORT;
      const height = Math.min(Math.max(info.height, viewport.height), MAX_CAPTURE_HEIGHT);
      fs.mkdirSync(path.dirname(screenshot), { recursive: true });
      await page.screenshot({
        path: screenshot,
        fullPage: true,
        clip: { x: 0, y: 0, width: viewport.width, height },
        animations: 'disabled',
        caret: 'hide',
      });
      result.image = screenshot;
      result.width = viewport.width;
      result.height = height;
    }
  } catch (err) {
    result.failed = err instanceof Error ? err.message.split('\n')[0] : String(err);
  } finally {
    await page.close().catch(() => undefined);
  }
  return result;
}
