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
};

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const asked = Object.keys(JSON.parse(String(init.body)).questions);
    const subset = Object.fromEntries(Object.entries(answers).filter(([k]) => asked.includes(k)));
    return new Response(JSON.stringify({ model: JEV_MODEL, answers: subset }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('prepareImage', () => {
  it('shrinks tall screenshots to 768 px and pads small ones to 280 px', () => {
    const tall = prepareImage(png(1280, 4000));
    expect(tall.height).toBe(768);
    expect(tall.width).toBeGreaterThanOrEqual(280);
    expect(tall.width).toBeLessThanOrEqual(768);
    expect(prepareImage(png(1280, 4000), 512).height).toBe(512);
    const small = prepareImage(png(100, 50));
    expect([small.width, small.height, small.scale]).toEqual([280, 280, 1]);
  });
});

describe('analyzeRoutePair', () => {
  const candidates = [{ file: 'src/Button.tsx', description: 'Imported 1 step away' }];

  const sentSide = (asset: { data_base64: string }) => {
    const img = PNG.sync.read(Buffer.from(asset.data_base64, 'base64'));
    return [img.width, img.height];
  };

  it('splits into call A (both images) and call B (after only), and maps boxes to pixels', async () => {
    const { fn, calls } = fakeFetch();
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    const result = await analyzeRoutePair({ client, before: png(1280, 3136), after: png(1280, 3136, 200), route: '/', candidates });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    expect(headers['TypeSafe-Danger-Zone-Images']).toBe('true');
    expect(headers['TypeSafe-Danger-Zone-Long-Context']).toBeUndefined();
    const [a, b] = calls.map((c) => JSON.parse(String(c.init.body)));
    expect(a.model).toBe('jev-1.14.0');
    expect(Object.keys(a.questions)).toEqual(['changed', 'culprit']);
    expect(Object.keys(a.assets)).toHaveLength(2);
    expect(Object.keys(b.assets)).toHaveLength(1);
    expect(Object.keys(b.assets)[0]).toBe(a.state.after);
    expect(b.state.before).toBeUndefined();
    expect(Object.keys(b.questions).length).toBeLessThan(8);
    const keys = Object.keys(b.questions);
    expect(keys.indexOf('largest_present')).toBeLessThan(keys.indexOf('largest_box'));
    expect(b.questions.largest_box.type).toBe('box');
    expect(Object.keys(a.questions.culprit.criteria)).toEqual(['src/Button.tsx', 'layout-or-css', 'unknown']);
    for (const body of [a, b]) {
      expect(String(calls[0].init.body).length).toBeLessThan(2_000_000);
      const ids = Object.keys(body.assets);
      for (const id of ids) expect(JSON.stringify(body.questions)).not.toContain(id);
      for (const asset of Object.values(body.assets) as any[]) {
        expect(asset).toMatchObject({ type: 'image', format: 'png' });
        const [w, h] = sentSide(asset);
        expect(Math.max(w, h)).toBeLessThanOrEqual(768);
        expect(Math.min(w, h)).toBeGreaterThanOrEqual(280);
      }
    }
    expect(String(calls[1].init.body).length).toBeLessThan(String(calls[0].init.body).length);

    expect(result.changed).toBe(0.97);
    expect(result.choice).toEqual({ file: 'src/Button.tsx', confidence: 0.8 });
    // 1280x3136 shrinks by 768/3136 and the box maps back to the original.
    expect(result.boxes).toHaveLength(1);
    const box = result.boxes[0];
    expect(box.x).toBeCloseTo(0.1 * 1280, -1);
    expect(box.y).toBeCloseTo(0.25 * 3136, -1);
    expect(box.height).toBeCloseTo(0.25 * 3136, -1);
    expect(box.file).toBe('src/Button.tsx');
  });

  it('keeps small 1280x800 images within 768 px', async () => {
    const { fn, calls } = fakeFetch();
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    await analyzeRoutePair({ client, before: png(1280, 800), after: png(1280, 800, 9), route: '/', candidates });
    for (const c of calls) {
      for (const asset of Object.values(JSON.parse(String(c.init.body)).assets) as any[]) {
        const [w, h] = sentSide(asset);
        expect(Math.max(w, h)).toBeLessThanOrEqual(768);
        expect(Math.min(w, h)).toBeGreaterThanOrEqual(280);
      }
    }
  });

  it('skips call B when the page did not change', async () => {
    const calls: unknown[] = [];
    const fn = (async () => {
      calls.push(1);
      return new Response(JSON.stringify({ answers: { changed: { noul: 0.1 }, culprit: { choice: 'unknown', confidence: 1 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await analyzeRoutePair({ client: createJevClient({ apiKey: 'k', fetch: fn }), before: png(300, 300), after: png(300, 300), route: '/', candidates });
    expect(calls).toHaveLength(1);
    expect(result.boxes).toEqual([]);
  });

  it('retries once with smaller images on max_tokens_exceeded', async () => {
    const { fn: ok, calls } = fakeFetch();
    let n = 0;
    const fn = (async (url: string, init: RequestInit) => {
      if (n++ === 0) {
        calls.push({ url, init });
        return new Response(JSON.stringify({ detail: { error_type: 'max_tokens_exceeded' } }), { status: 400 });
      }
      return ok(url as any, init);
    }) as unknown as typeof fetch;
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    const result = await analyzeRoutePair({ client, before: png(1280, 3136), after: png(1280, 3136, 200), route: '/', candidates });
    expect(calls).toHaveLength(3);
    const longest = (i: number) => Math.max(...sentSide(Object.values(JSON.parse(String(calls[i].init.body)).assets)[0] as any));
    expect(longest(0)).toBe(768);
    expect(longest(1)).toBe(512);
    expect(result.boxes).toHaveLength(1);
    // Box maps back through the 512 px image: 0.25 of 3136.
    expect(result.boxes[0].y).toBeCloseTo(0.25 * 3136, -1);
  });

  it('serves a repeat call from the cache without calling fetch', async () => {
    const { fn, calls } = fakeFetch();
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    const args = { client, before: png(400, 400), after: png(400, 400, 100), route: '/a', candidates, cacheDir: path.join(tmp, 'jev-cache') };
    const first = await analyzeRoutePair(args);
    const second = await analyzeRoutePair(args);
    const firstCalls = calls.length;
    expect(firstCalls).toBeGreaterThan(1);
    expect(first.cached).toBe(false);
    expect(second).toEqual({ ...first, cached: true });
    expect(fs.readdirSync(path.join(tmp, 'jev-cache'))).toHaveLength(1);
    expect(calls).toHaveLength(firstCalls);
    await analyzeRoutePair({ ...args, after: png(400, 400, 50) });
    expect(calls.length).toBeGreaterThan(firstCalls);
  });

  it('throws on an HTTP error so the caller can add a notice', async () => {
    const fn = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    const client = createJevClient({ apiKey: 'k', fetch: fn });
    await expect(analyzeRoutePair({ client, before: png(300, 300), after: png(300, 300), route: '/', candidates })).rejects.toThrow('HTTP 401');
  });
});
