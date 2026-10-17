import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeRoutePair, createJevClient, prepareImage, JEV_MODEL } from '../src/jev';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redline-jev-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function png(width: number, height: number, shade = 255): Buffer {
  const img = new PNG({ width, height });
  img.data.fill(shade);
  return PNG.sync.write(img);
}

const answers = {
  changed: { type: 'noul', noul: 0.97 },
  culprit: { type: 'choice', choice: 'src/Button.tsx', probabilities: {}, confidence: 0.8 },
  largest_present: { type: 'noul', noul: 0.9 },
  largest_box: { type: 'box', box: { top: 0.25, bottom: 0.5, left: 0.1, right: 0.6 }, confidence: 0.7 },
  second_present: { type: 'noul', noul: 0.2 },
  second_box: { type: 'box', box: { top: 0, bottom: 1, left: 0, right: 1 }, confidence: 0.9 },
  third_present: { type: 'noul', noul: 0.4 },
  third_box: { type: 'box', box: { top: 0, bottom: 1, left: 0, right: 1 }, confidence: 0.9 },
};

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ model: JEV_MODEL, answers }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('prepareImage', () => {
  it('shrinks tall screenshots to 1568 px and pads small ones to 280 px', () => {
    const tall = prepareImage(png(1280, 4000));
    expect(tall.height).toBe(1568);
    expect(tall.width).toBeGreaterThanOrEqual(280);
    expect(tall.width).toBeLessThanOrEqual(1568);
    const small = prepareImage(png(100, 50));
    expect([small.width, small.height, small.scale]).toEqual([280, 280, 1]);
  });
});

describe('analyzeRoutePair', () => {
  const candidates = [{ file: 'src/Button.tsx', description: 'Imported 1 step away' }];

  it('sends one request in the documented shape, asks noul before box, and maps boxes to pixels', async () => {
    const { fn, calls } = fakeFetch();
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    const before = png(1280, 3136);
    const after = png(1280, 3136, 200);
    const result = await analyzeRoutePair({ client, before, after, route: '/', candidates });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['TypeSafe-Danger-Zone-Images']).toBe('true');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe('jev-1.14.0');
    const ids = Object.keys(body.assets);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(body.assets[id]).toMatchObject({ type: 'image', format: 'png' });
      expect(typeof body.assets[id].data_base64).toBe('string');
      expect(JSON.stringify(body.state)).toContain(id);
    }
    const keys = Object.keys(body.questions);
    expect(keys.indexOf('largest_present')).toBeLessThan(keys.indexOf('largest_box'));
    expect(body.questions.largest_present.type).toBe('noul');
    expect(body.questions.largest_box.type).toBe('box');
    expect(Object.keys(body.questions.culprit.criteria)).toEqual(['src/Button.tsx', 'layout-or-css', 'unknown']);

    expect(result.changed).toBe(0.97);
    expect(result.choice).toEqual({ file: 'src/Button.tsx', confidence: 0.8 });
    // Only the box whose presence question passed is kept; 1280x3136 shrinks by 0.5 and the box maps back.
    expect(result.boxes).toEqual([{ x: 128, y: 784, width: 640, height: 784, confidence: 0.7, label: expect.any(String), file: 'src/Button.tsx' }]);
  });

  it('serves a repeat call from the cache without calling fetch', async () => {
    const { fn, calls } = fakeFetch();
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    const args = { client, before: png(400, 400), after: png(400, 400, 100), route: '/a', candidates, cacheDir: path.join(tmp, 'jev-cache') };
    const first = await analyzeRoutePair(args);
    const second = await analyzeRoutePair(args);
    expect(calls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });
    expect(fs.readdirSync(path.join(tmp, 'jev-cache'))).toHaveLength(1);
    await analyzeRoutePair({ ...args, after: png(400, 400, 50) });
    expect(calls).toHaveLength(2);
  });

  it('throws on an HTTP error so the caller can add a notice', async () => {
    const fn = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    await expect(analyzeRoutePair({ client, before: png(300, 300), after: png(300, 300), route: '/', candidates })).rejects.toThrow('HTTP 401');
  });
});
