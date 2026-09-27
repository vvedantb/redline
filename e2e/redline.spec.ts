import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_CONVEX_URL } from './env';

declare global {
  interface Window {
    __redlineNetwork?: { mode: string; readOnly: boolean; fixturesLoaded: boolean; lastMutation?: { method: string; url: string; blocked: boolean } };
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const demoRoot = path.join(here, '..', 'apps', 'demo');
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', 'baseline', name), 'utf8');
const current = (rel: string) => fs.readFileSync(path.join(demoRoot, rel), 'utf8');

const HERO = 'src/components/Hero.tsx';
const STATS = 'src/components/Stats.tsx';

/** "Commit A": previous versions of Hero and Stats. The files on disk are "commit B". */
async function pinCommitA(request: APIRequestContext) {
  const res = await request.post('/__redline/pin', {
    data: { files: { [HERO]: fixture('Hero.tsx'), [STATS]: fixture('Stats.tsx') } },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.baseline.mode).toBe('content');
  return body;
}

const outlines = (page: Page) => page.locator('[data-redline-outline]');

async function outlinedSources(page: Page): Promise<string[]> {
  return outlines(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-redline-target') ?? ''));
}

test.beforeEach(async ({ request }) => {
  await request.post('/__redline/clear');
});

test.afterAll(async ({ request }) => {
  await request.post('/__redline/clear');
});

test('tags rendered host elements with their source location', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hero')).toHaveAttribute('data-redline-source', /^src\/components\/Hero\.tsx:\d+-\d+$/);
  await expect(page.getByTestId('footer')).toHaveAttribute('data-redline-source', /^src\/components\/Footer\.tsx:/);
});

test('outlines only changed regions and opens the hunk on click', async ({ page, request }) => {
  await pinCommitA(request);
  await page.goto('/?redline=1');

  await expect(page.locator('[data-redline-status]')).toContainText('changed region');
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);

  const sources = await outlinedSources(page);
  // Changed: Hero title text + new paragraph, Stats layout class + new card.
  expect(sources.some((s) => s.startsWith(`${HERO}:`))).toBe(true);
  expect(sources.some((s) => s.startsWith(`${STATS}:`))).toBe(true);
  // Unchanged components are never outlined.
  for (const file of ['Header', 'Footer', 'Signup', 'RedlineControls']) {
    expect(sources.some((s) => s.includes(`/${file}.tsx:`))).toBe(false);
  }

  // The hero title (text change) is outlined itself, not just its section.
  const titleSource = await page.locator('.hero-title').getAttribute('data-redline-source');
  expect(sources).toContain(titleSource);
  // The new review card is outlined.
  const cardSource = await page.getByTestId('review-card').getAttribute('data-redline-source');
  expect(sources).toContain(cardSource);

  // Outlines do not block clicks on the page.
  await page.getByRole('button', { name: 'Notify me' }).click({ trial: true });

  // Click the hit target for the hero title → side panel with the hunk.
  const titleLine = titleSource!.split(':')[1].split('-')[0];
  await page.getByRole('button', { name: `Show diff for ${HERO}:${titleLine}` }).click();
  const panel = page.getByRole('dialog', { name: 'Redline diff' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-redline-panel-file]')).toHaveText(HERO);
  await expect(panel.locator('[data-redline-patch]')).toContainText('+      <h1 className="hero-title">Ship UI changes you can see</h1>');
  await expect(panel.locator('[data-redline-patch]')).toContainText('-      <h1 className="hero-title">Welcome to the demo</h1>');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('re-pinning to the current content clears outlines', async ({ page, request }) => {
  await pinCommitA(request);
  await page.goto('/?redline=1');
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);

  const res = await request.post('/__redline/pin', { data: { files: { [HERO]: current(HERO), [STATS]: current(STATS) } } });
  expect(res.ok()).toBe(true);
  await expect(outlines(page)).toHaveCount(0);
  await expect(page.locator('[data-redline-status]')).toContainText('0 changed regions');
});

test('pinning HEAD through the UI stores the git SHA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('head-sha')).toHaveText(/^[0-9a-f]{12}$/);
  const head = (await page.getByTestId('head-sha').textContent())!.trim();
  await page.getByRole('button', { name: 'Pin baseline (HEAD)' }).click();
  await expect(page.getByTestId('pinned-sha')).toHaveText(head);
});

test('?redline=0 turns the overlay off', async ({ page, request }) => {
  await pinCommitA(request);
  await page.goto('/?redline=0');
  await expect(page.getByTestId('hero')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(outlines(page)).toHaveCount(0);
  await expect(page.locator('[data-redline-root]')).toHaveCount(0);
});

test('prefers-reduced-motion turns the overlay off', async ({ page, request }) => {
  await pinCommitA(request);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?redline=1');
  await expect(page.getByTestId('hero')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(outlines(page)).toHaveCount(0);
});

test('the overlay toggle and localStorage flag turn the overlay off', async ({ page, request }) => {
  await pinCommitA(request);
  await page.goto('/');
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);
  await page.getByLabel('Overlay').uncheck();
  await expect(outlines(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('redlineDisabled'))).toBe('1');

  await page.reload();
  await page.waitForTimeout(500);
  await expect(outlines(page)).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('redlineDisabled'));
});

test('the toolbar hides outlines and remembers its position', async ({ page, request }) => {
  await pinCommitA(request);
  await page.goto('/?redline=1');
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);
  const toolbar = page.getByRole('toolbar', { name: 'Redline' });

  await toolbar.getByRole('button', { name: 'Hide outlines' }).click();
  await expect(outlines(page)).toHaveCount(0);
  await expect(page.locator('[data-redline-status]')).toContainText('(hidden)');

  const handle = page.locator('[data-redline-drag]');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(300, 200, { steps: 5 });
  await page.mouse.up();
  const moved = (await toolbar.boundingBox())!;

  await page.reload();
  await expect(toolbar.getByRole('button', { name: 'Show outlines' })).toBeVisible();
  await expect(outlines(page)).toHaveCount(0);
  const restored = (await toolbar.boundingBox())!;
  expect(Math.round(restored.x)).toBe(Math.round(moved.x));
  expect(Math.round(restored.y)).toBe(Math.round(moved.y));

  await toolbar.getByRole('button', { name: 'Show outlines' }).click();
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);
  await page.evaluate(() => localStorage.removeItem('redline:toolbar'));
});

test('the live demo uses its live API and dev env', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-note')).toHaveText(['Live note']);
  await expect(page.getByTestId('demo-backend-url')).toHaveText(`Backend URL: ${FAKE_CONVEX_URL}`);
  await page.getByTestId('demo-notes-write').click();
  await expect(page.getByTestId('demo-notes-write-result')).toHaveText('saved');
  expect(await page.evaluate(() => window.__redlineNetwork?.mode)).toBe('passthrough');
});

test('history builds a commit, shows it in an iframe, and Latest returns to the live app', async ({ page, request }) => {
  test.setTimeout(180_000);
  await pinCommitA(request);
  await page.goto('/?redline=1');
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);
  // Every request the History iframe makes to the live demo API.
  const liveApiCalls: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/demo/')) liveApiCalls.push(`${req.method()} ${req.url()}`);
  });

  const toolbar = page.getByRole('toolbar', { name: 'Redline' });
  await toolbar.getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Redline history' });
  const target = panel.locator('[data-redline-commit]:not([data-redline-commit="latest"])').first();
  await expect(target).toBeVisible();
  const sha = (await target.getAttribute('data-redline-commit'))!;
  const short = (await target.locator('code').textContent())!;
  // Start from a clean build so the queue runs.
  await request.delete(`/__redline/build?sha=${sha}`);

  await target.click();
  await expect(page.locator('[data-redline-viewing]')).toHaveText(`Viewing ${short}`);
  await expect(target).toHaveAttribute('aria-current', 'true');
  await expect(target.locator('[data-redline-build]')).toHaveAttribute('data-redline-build', /queued|building|ready/);
  // Outlines are for the live app only.
  await expect(outlines(page)).toHaveCount(0);

  const frame = page.locator(`[data-redline-frame="${sha}"]`);
  await expect(frame).toBeVisible({ timeout: 150_000 });
  await expect(frame).toHaveAttribute('src', `/__redline/h/${sha}/`);
  await expect(target.locator('[data-redline-build]')).toHaveAttribute('data-redline-build', 'ready');
  const inner = page.frameLocator(`[data-redline-frame="${sha}"]`);
  await expect(inner.getByTestId('hero')).toBeVisible();
  // The build has no tags and no nested overlay; the toolbar stays outside the iframe.
  await expect(inner.locator('[data-redline-source]')).toHaveCount(0);
  await expect(inner.locator('[data-redline-toolbar]')).toHaveCount(0);
  await expect(toolbar).toBeVisible();
  await expect(page.locator('[data-redline-status]')).toContainText(`build of ${short} ready`);

  // Read-only network: the bootstrap replays fixtures and blocks writes.
  const frameHandle = page.frame({ url: (u) => u.pathname.startsWith(`/__redline/h/${sha}/`) });
  expect(frameHandle).not.toBeNull();
  const historyFrame = frameHandle ?? page.mainFrame();
  expect(await historyFrame.evaluate(() => window.__redlineNetwork?.mode)).toBe('replay');
  expect(await historyFrame.evaluate(() => window.__redlineNetwork?.readOnly)).toBe(true);
  await expect(inner.getByTestId('demo-note')).toHaveText(['Fixture note from History']);
  // The history panel covers the page; closing it keeps the commit in view.
  await panel.getByRole('button', { name: 'Close history panel' }).click();
  await expect(frame).toBeVisible();
  await inner.getByTestId('demo-notes-write').click();
  await expect(inner.getByTestId('demo-notes-write-result')).toHaveText('read-only');
  expect(await historyFrame.evaluate(() => window.__redlineNetwork?.lastMutation)).toEqual({ method: 'POST', url: '/api/demo/notes', blocked: true });
  // XHR is patched too.
  const xhrText = await historyFrame.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/demo/notes');
        xhr.onload = () => resolve(xhr.responseText);
        xhr.send();
      }),
  );
  expect(JSON.parse(xhrText).notes[0].text).toBe('Fixture note from History');
  // Hardened env: the live server's VITE_CONVEX_URL was not inlined into the build.
  await expect(inner.getByTestId('demo-backend-url')).toHaveText('Backend URL: unset');
  expect(liveApiCalls).toEqual([]);

  const job = await (await request.get(`/__redline/build?sha=${sha}`)).json();
  expect(job.build).toMatchObject({ sha, status: 'ready', framework: 'vite' });
  // Viewing is not pinning.
  const state = await (await request.get('/__redline/baseline')).json();
  expect(state.baseline.mode).toBe('content');

  await toolbar.getByRole('button', { name: 'Latest' }).click();
  await expect(frame).toHaveCount(0);
  await expect(page.locator('[data-redline-viewing]')).toHaveCount(0);
  await expect.poll(async () => (await outlinedSources(page)).length).toBeGreaterThan(0);
  await expect(page.locator('[data-redline-status]')).toContainText('changed region');

  await request.delete(`/__redline/build?sha=${sha}`);
});
