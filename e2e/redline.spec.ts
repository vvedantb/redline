import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const head = (await page.getByTestId('head-sha').textContent())!.trim();
  expect(head).toMatch(/^[0-9a-f]{12}$/);
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

test('history view-mode diffs against a commit without pinning it', async ({ page, request }) => {
  await page.goto('/?redline=1');
  await page.getByRole('toolbar', { name: 'Redline' }).getByRole('button', { name: 'History' }).click();
  const panel = page.getByRole('dialog', { name: 'Redline history' });
  const commits = panel.locator('[data-redline-commit]:not([data-redline-commit="latest"])');
  await expect(commits.first()).toBeVisible();
  const target = commits.last();
  const sha = (await target.getAttribute('data-redline-commit'))!;
  const short = (await target.locator('code').textContent())!;

  const diffRequest = page.waitForRequest((r) => r.url().includes(`/__redline/diff?baseline=${sha}`));
  await target.click();
  await diffRequest;
  await expect(page.locator('[data-redline-viewing]')).toHaveText(`Viewing ${short}`);
  await expect(target).toHaveAttribute('aria-current', 'true');

  // Viewing is not pinning.
  const state = await (await request.get('/__redline/baseline')).json();
  expect(state.baseline).toBeNull();

  await page.getByRole('toolbar', { name: 'Redline' }).getByRole('button', { name: 'Latest' }).click();
  await expect(page.locator('[data-redline-viewing]')).toHaveCount(0);
  await expect(page.locator('[data-redline-status]')).toContainText('no baseline pinned');
});
