// Jev is TypeSafe's System One model. Sources:
// https://docs.typesafe.ai/images.md     image limits and base64 assets
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
const MAX_SIDE = 1568;
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
      if (!res.ok) throw new Error(`Jev request failed with HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
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

/** Shrink so the longest side is at most 1568 px, then pad right and bottom with white up to 280 px. */
export function prepareImage(source: Buffer): PreparedImage {
  const src = PNG.sync.read(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
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

const BOXES = [
  ['largest', 'the largest area that looks different from before'],
  ['second', 'the second largest area that looks different from before, apart from the largest one'],
  ['third', 'the third largest area that looks different from before, apart from the two largest ones'],
] as const;

function questions(ids: { before: string; after: string }, candidates: JevCandidate[]) {
  const pair = `Two screenshots of the same page: \`before\` (${ids.before}) and \`after\` (${ids.after}).`;
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.file] = c.description;
  criteria[LAYOUT_OR_CSS] = 'Shared layout, global styles or build configuration, not one of the listed files';
  criteria[UNKNOWN] = 'Cannot tell which file caused the change';
  const q: Record<string, unknown> = {
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
  for (const [key, what] of BOXES) {
    q[`${key}_present`] = { type: 'noul', instructions: `${pair} Is there ${what}? Answer no when nothing more is different.` };
    q[`${key}_box`] = { type: 'box', instructions: `In \`after\` (${ids.after}), find ${what}, compared with \`before\` (${ids.before}).` };
  }
  return q;
}

export interface AnalyzeOptions {
  client: JevClient;
  before: Buffer;
  after: Buffer;
  route: string;
  candidates: JevCandidate[];
  /** `.redline/jev-cache` directory. No caching when unset. */
  cacheDir?: string;
}

const sha = (...parts: (Buffer | string)[]) => parts.reduce((h, p) => h.update(p), createHash('sha256')).digest('hex');
const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Ask Jev what changed on one route and where. Both images are resized to fit Jev's limits. */
export async function analyzeRoutePair(options: AnalyzeOptions): Promise<JevAnalysis> {
  const { client, candidates } = options;
  const before = prepareImage(options.before);
  const after = prepareImage(options.after);
  const original = PNG.sync.read(options.after);
  const fingerprint = JSON.stringify([client.model, options.route, questions({ before: 'BEFORE', after: 'AFTER' }, candidates)]);
  const key = sha(before.png, after.png, fingerprint);
  const cacheFile = options.cacheDir ? path.join(options.cacheDir, `${key}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      return { ...(JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as JevAnalysis), cached: true };
    } catch {
      // Unreadable cache entry: ask again.
    }
  }

  const ids = { before: randomUUID(), after: randomUUID() };
  const asset = (p: PreparedImage): JevAsset => ({ type: 'image', format: 'png', data_base64: p.png.toString('base64') });
  const answers = await client.query({
    state: { route: options.route, before: ids.before, after: ids.after },
    assets: { [ids.before]: asset(before), [ids.after]: asset(after) },
    questions: questions(ids, candidates),
  });

  const pick = answers.culprit?.choice as string | undefined;
  const files = new Set(candidates.map((c) => c.file));
  const choice = pick && files.has(pick) ? { file: pick, confidence: Number(answers.culprit.confidence ?? 0) } : null;
  const boxes: JevBox[] = [];
  for (const [name, what] of BOXES) {
    if (!(Number(answers[`${name}_present`]?.noul) >= YES)) continue;
    const b = answers[`${name}_box`];
    if (!b?.box) continue;
    const [top, bottom, left, right] = [clamp(b.box.top), clamp(b.box.bottom), clamp(b.box.left), clamp(b.box.right)];
    if (bottom <= top || right <= left) continue;
    // Fractions are of the padded image; undo the padding and the resize.
    const x = (left * after.width) / after.scale;
    const y = (top * after.height) / after.scale;
    const w = Math.min(((right - left) * after.width) / after.scale, original.width - x);
    const h = Math.min(((bottom - top) * after.height) / after.scale, original.height - y);
    if (x >= original.width || y >= original.height) continue;
    boxes.push({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), confidence: Number(b.confidence ?? 0), label: what, file: choice?.file ?? null });
  }
  const result: JevAnalysis = { changed: Number(answers.changed?.noul ?? 0), choice, boxes, cached: false };
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ ...result, cached: false }, null, 2) + '\n');
  }
  return result;
}

/** A fetch that answers like Jev without the network, for `REDLINE_JEV_MOCK=1`. Boxes are fixed. */
export const mockJevFetch: Fetch = async (_url, init) => {
  const { questions: qs } = JSON.parse(String(init?.body)) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> };
  const answers: Record<string, unknown> = {};
  let boxes = 0;
  for (const [name, q] of Object.entries(qs)) {
    if (q.type === 'noul') answers[name] = { type: 'noul', noul: name === 'third_present' ? 0.1 : 0.9 };
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
