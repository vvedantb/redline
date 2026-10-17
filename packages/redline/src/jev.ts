// Jev is TypeSafe's System One model. Sources:
// https://docs.typesafe.ai/images.md     PNG or JPEG only, 280 to 1568 px per side. Images in `instructions` are copied per
//                                        question, so images go in `state` and instructions name the state field.
//                                        `max_tokens_exceeded` means context length, not body size.
// https://docs.typesafe.ai/models.md     default limits are 64k per request and 32k per question. The Long-Context header
//                                        raises them but is slower and less accurate, so Redline never sends it. Requests
//                                        stay small instead: 768 px images, and two calls rather than one.
// https://docs.typesafe.ai/primitives/box.md  box answers have no "not found", so each is gated by a noul
// https://docs.typesafe.ai/api.md        POST /v1/systemone request and response
// https://docs.typesafe.ai/primitives.md noul, choice and score questions

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

export const JEV_MODEL = 'jev-1.14.0';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_SKIPPED_NOTICE = 'Jev visual linking skipped (no TYPESAFE_API_KEY).';

const MIN_SIDE = 280;
const MAX_SIDE = 768;
const RETRY_MAX_SIDE = 512;
/** A noul or presence answer at or above this counts as yes. */
const YES = 0.5;
export const UNKNOWN = 'unknown';
export const LAYOUT_OR_CSS = 'layout-or-css';

type Fetch = typeof fetch;

export interface JevClientOptions {
  apiKey: string;
  fetch?: Fetch;
  url?: string;
  model?: string;
}

export class JevError extends Error {
  constructor(message: string, readonly status: number, readonly errorType?: string) {
    super(message);
  }
}

export interface JevClient {
  model: string;
  query(body: { state: unknown; assets: Record<string, JevAsset>; questions: Record<string, unknown> }): Promise<Record<string, any>>;
}

interface JevAsset {
  type: 'image';
  format: 'png';
  data_base64: string;
}

export function createJevClient(options: JevClientOptions): JevClient {
  const doFetch = options.fetch ?? fetch;
  const model = options.model ?? JEV_MODEL;
  return {
    model,
    async query(body) {
      const res = await doFetch(options.url ?? JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'TypeSafe-Danger-Zone-Images': 'true' },
        body: JSON.stringify({ model, ...body }),
      });
      if (!res.ok) {
        const text = await res.text();
        let errorType: string | undefined;
        try {
          errorType = JSON.parse(text)?.detail?.error_type;
        } catch {
          // Not JSON: keep the text only.
        }
        throw new JevError(`Jev request failed with HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, errorType);
      }
      return ((await res.json()) as { answers: Record<string, any> }).answers;
    },
  };
}

export interface PreparedImage {
  png: Buffer;
  /** Size sent to Jev, after resizing and padding. */
  width: number;
  height: number;
  /** Resized size over the original size. */
  scale: number;
}

/** Shrink so the longest side is at most `maxSide` px, then pad right and bottom with white up to 280 px. */
export function prepareImage(source: Buffer, maxSide = MAX_SIDE): PreparedImage {
  const src = PNG.sync.read(source);
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const out = new PNG({ width: Math.max(w, MIN_SIDE), height: Math.max(h, MIN_SIDE) });
  out.data.fill(255);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) for (let c = 0; c < 4; c++) sum[c] += src.data[(sy * src.width + sx) * 4 + c];
      }
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 4; c++) out.data[(y * out.width + x) * 4 + c] = Math.round(sum[c] / n);
    }
  }
  return { png: PNG.sync.write(out), width: out.width, height: out.height, scale };
}

export interface JevCandidate {
  file: string;
  description: string;
}

export interface JevBox {
  /** Pixels on the original after screenshot. */
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  /** What the box instruction asked for. */
  label: string;
  /** Changed file this area is linked to, when Jev picked one. */
  file: string | null;
}

export interface JevAnalysis {
  /** Probability that the page visibly changed, 0 to 1. */
  changed: number;
  /** The file Jev blames, or null when it chose `unknown` or `layout-or-css`. */
  choice: { file: string; confidence: number } | null;
  boxes: JevBox[];
  cached: boolean;
}

/** Crops asked about at most, largest first. */
const MAX_CROPS = 4;
const CROP_PAD = 12;
/** A region this share of the page or more means the diff is a page-wide shift, so pixel regions say little. */
const MAX_REGION_SHARE = 0.4;

export interface JevRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels?: number;
}

/** Pixel regions are usable when there is at least one and none covers 40% or more of the after image. */
function usableRegions(regions: JevRegion[], width: number, height: number): boolean {
  return regions.length > 0 && regions.every((r) => r.width * r.height < MAX_REGION_SHARE * width * height);
}

/** Cut a padded rectangle out of a PNG, clamped to the image. Null when nothing is left. */
function cropPng(source: PNG, r: JevRegion): Buffer | null {
  const x0 = Math.max(0, Math.floor(r.x - CROP_PAD));
  const y0 = Math.max(0, Math.floor(r.y - CROP_PAD));
  const x1 = Math.min(source.width, Math.ceil(r.x + r.width + CROP_PAD));
  const y1 = Math.min(source.height, Math.ceil(r.y + r.height + CROP_PAD));
  if (x1 <= x0 || y1 <= y0) return null;
  const out = new PNG({ width: x1 - x0, height: y1 - y0 });
  PNG.bitblt(source, out, x0, y0, x1 - x0, y1 - y0, 0, 0);
  return PNG.sync.write(out);
}

const BOXES = [
  ['largest', 'the largest area that looks different from before'],
  ['second', 'the second largest area that looks different from before, apart from the largest one'],
] as const;

/** Call A: needs both screenshots. Images are state fields, never ids in the text. */
function questionsA(candidates: JevCandidate[]) {
  const pair = 'Two screenshots of the same page: the `before` screenshot and the `after` screenshot.';
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.file] = c.description;
  criteria[LAYOUT_OR_CSS] = 'Shared layout, global styles or build configuration, not one of the listed files';
  criteria[UNKNOWN] = 'Cannot tell which file caused the change';
  return {
    changed: {
      type: 'noul',
      instructions: `${pair} Does the page visibly change between \`before\` and \`after\`? Look at layout, copy, colour and components. Ignore anti-aliasing noise and sub-pixel shifts.`,
    },
    culprit: {
      type: 'choice',
      instructions: `${pair} Which changed file most likely caused the visible difference between \`before\` and \`after\`?`,
      criteria,
    },
  };
}

/** Primary call B: one meaningful and one culprit question per crop. Crops are state fields `r0`, `r1`, and so on. */
function questionsCrops(candidates: JevCandidate[], count: number) {
  const q: Record<string, unknown> = {};
  const { criteria } = questionsA(candidates).culprit;
  for (let i = 0; i < count; i++) {
    q[`r${i}_meaningful`] = {
      type: 'noul',
      instructions: `The \`r${i}\` image is a crop of the \`after\` screenshot where pixels changed. Is it a real visible UI change, such as layout, copy, colour or a component, and not rendering noise?`,
    };
    q[`r${i}_culprit`] = {
      type: 'choice',
      instructions: `The \`r${i}\` image is a crop of the \`after\` screenshot where pixels changed. Which changed file most likely caused this change?`,
      criteria,
    };
  }
  return q;
}

/** Fallback call B: only the `after` screenshot is sent, to keep the request small. */
function questionsB() {
  const q: Record<string, unknown> = {};
  for (const [key, what] of BOXES) {
    q[`${key}_present`] = { type: 'noul', instructions: `In the \`after\` screenshot, is there ${what.replace('from before', 'from the rest of the page')}? Answer no when nothing stands out.` };
    q[`${key}_box`] = { type: 'box', instructions: `In the \`after\` screenshot, find ${what.replace('from before', 'from the rest of the page')}.` };
  }
  return q;
}

export interface AnalyzeOptions {
  client: JevClient;
  before: Buffer;
  after: Buffer;
  route: string;
  candidates: JevCandidate[];
  /** Pixelmatch regions on the after screenshot. Tight regions replace Jev box questions. */
  regions: JevRegion[];
  /** `.redline/jev-cache` directory. No caching when unset. */
  cacheDir?: string;
}

const sha = (...parts: (Buffer | string)[]) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest('hex');
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Ask Jev what changed on one route and where. Images are shrunk to fit Jev's default limits, with one smaller retry. */
export async function analyzeRoutePair(options: AnalyzeOptions): Promise<JevAnalysis> {
  const { client, candidates } = options;
  const before = prepareImage(options.before);
  const after = prepareImage(options.after);
  const fingerprint = JSON.stringify([client.model, options.route, questionsA(candidates), questionsB(), questionsCrops(candidates, 1), MAX_CROPS, options.regions.map((r) => [r.x, r.y, r.width, r.height, r.pixels ?? 0])]);
  const key = sha(before.png, after.png, fingerprint);
  const cacheFile = options.cacheDir ? path.join(options.cacheDir, `${key}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      return { ...(JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as JevAnalysis), cached: true };
    } catch {
      // Unreadable cache entry: ask again.
    }
  }

  let result: JevAnalysis;
  try {
    result = await run(options, MAX_SIDE);
  } catch (err) {
    if (!(err instanceof JevError && err.errorType === 'max_tokens_exceeded')) throw err;
    result = await run(options, RETRY_MAX_SIDE);
  }
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ ...result, cached: false }, null, 2) + '\n');
  }
  return result;
}

const asset = (p: PreparedImage): JevAsset => ({ type: 'image', format: 'png', data_base64: p.png.toString('base64') });

async function run(options: AnalyzeOptions, maxSide: number): Promise<JevAnalysis> {
  const { client, candidates } = options;
  const before = prepareImage(options.before, maxSide);
  const after = prepareImage(options.after, maxSide);
  const original = PNG.sync.read(options.after);
  const ids = { before: randomUUID(), after: randomUUID() };

  const a = await client.query({
    state: { route: options.route, before: ids.before, after: ids.after },
    assets: { [ids.before]: asset(before), [ids.after]: asset(after) },
    questions: questionsA(candidates),
  });
  const changed = Number(a.changed?.noul ?? 0);
  const pick = a.culprit?.choice as string | undefined;
  const files = new Set(candidates.map((c) => c.file));
  const choice = pick && files.has(pick) ? { file: pick, confidence: Number(a.culprit.confidence ?? 0) } : null;

  const boxes: JevBox[] = [];
  if (changed >= YES && usableRegions(options.regions, original.width, original.height)) {
    const top = [...options.regions].sort((p, q) => (q.pixels ?? 0) - (p.pixels ?? 0)).slice(0, MAX_CROPS);
    const crops = top.map((region) => ({ region, png: cropPng(original, region) })).filter((c): c is { region: JevRegion; png: Buffer } => c.png !== null);
    if (crops.length) {
      const state: Record<string, unknown> = { route: options.route };
      const assets: Record<string, JevAsset> = {};
      crops.forEach((c, i) => {
        const id = randomUUID();
        state[`r${i}`] = id;
        assets[id] = asset(prepareImage(c.png, maxSide));
      });
      const c = await client.query({ state, assets, questions: questionsCrops(candidates, crops.length) });
      const ranked = crops
        .map(({ region }, i) => {
          const pickC = c[`r${i}_culprit`]?.choice as string | undefined;
          const file = pickC && files.has(pickC) ? pickC : (choice?.file ?? null);
          return { region, file, meaningful: Number(c[`r${i}_meaningful`]?.noul ?? 0) };
        })
        .filter((r) => r.meaningful >= YES)
        .sort((p, q) => q.meaningful - p.meaningful || (q.region.pixels ?? 0) - (p.region.pixels ?? 0));
      for (const { region, file, meaningful } of ranked) {
        const { x, y, width, height } = region;
        boxes.push({ x, y, width, height, confidence: meaningful, label: file ?? 'pixel region', file });
      }
    }
  } else if (changed >= YES) {
    const b = await client.query({
      state: { route: options.route, after: ids.after },
      assets: { [ids.after]: asset(after) },
      questions: questionsB(),
    });
    for (const [name, what] of BOXES) {
      if (!(Number(b[`${name}_present`]?.noul) >= YES)) continue;
      const box = b[`${name}_box`];
      if (!box?.box) continue;
      const [top, bottom, left, right] = [clamp(box.box.top), clamp(box.box.bottom), clamp(box.box.left), clamp(box.box.right)];
      if (bottom <= top || right <= left) continue;
      // Fractions are of the padded image that was sent; undo the padding and the resize.
      const x = (left * after.width) / after.scale;
      const y = (top * after.height) / after.scale;
      const w = Math.min(((right - left) * after.width) / after.scale, original.width - x);
      const h = Math.min(((bottom - top) * after.height) / after.scale, original.height - y);
      if (x >= original.width || y >= original.height) continue;
      boxes.push({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), confidence: Number(box.confidence ?? 0), label: what, file: choice?.file ?? null });
    }
  }
  return { changed, choice, boxes, cached: false };
}

/** A fetch that answers like Jev without the network, for `REDLINE_JEV_MOCK=1`. Boxes are fixed. */
export const mockJevFetch: Fetch = async (_url, init) => {
  const { questions: qs } = JSON.parse(String(init?.body)) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> };
  const answers: Record<string, unknown> = {};
  let boxes = 0;
  for (const [name, q] of Object.entries(qs)) {
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: 0.9 };
    else if (q.type === 'choice') {
      const choice = Object.keys(q.criteria!)[0];
      answers[name] = { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 };
    } else {
      const top = 0.12 + 0.2 * boxes++;
      answers[name] = { type: 'box', box: { top, bottom: top + 0.12, left: 0.05, right: 0.65 }, confidence: 0.9 };
    }
  }
  return new Response(JSON.stringify({ model: JEV_MODEL, answers }), { status: 200 });
};
