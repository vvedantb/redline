import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Region extends Box {
  /** Changed pixels inside the box. */
  pixels: number;
}

export interface PixelDiff {
  width: number;
  height: number;
  changedPixels: number;
  /** Changed pixels over the larger image's area. */
  changedRatio: number;
  /** Changed areas, top to bottom. */
  regions: Region[];
}

export interface PixelDiffOptions {
  /** pixelmatch color threshold, 0 to 1. Default 0.1. */
  threshold?: number;
  /** Regions smaller than this many square pixels are dropped. Default 100. */
  minArea?: number;
  /** Regions with fewer changed pixels are dropped. Default 20. */
  minPixels?: number;
  /** Regions kept at most, largest first. Default 20. */
  maxRegions?: number;
}

const CELL = 8;
/** Changed cells this many cells apart still join one region. */
const JOIN = 2;

/** Copy `img` onto a white canvas of `width` x `height`. */
function pad(img: PNG, width: number, height: number): Buffer {
  if (img.width === width && img.height === height) return img.data;
  const out = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < img.height; y++) img.data.copy(out, y * width * 4, y * img.width * 4, (y + 1) * img.width * 4);
  return out;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function union(a: Region, b: Region): Region {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
    pixels: a.pixels + b.pixels,
  };
}

/** Group a changed-pixel mask into boxes: 8px cells, joined across small gaps, overlaps merged. */
export function regionsFromMask(mask: Uint8Array, width: number, height: number, options: PixelDiffOptions = {}): Region[] {
  const minArea = options.minArea ?? 100;
  const minPixels = options.minPixels ?? 20;
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const counts = new Uint32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (mask[y * width + x]) counts[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
  }

  const seen = new Uint8Array(cols * rows);
  let regions: Region[] = [];
  for (let start = 0; start < counts.length; start++) {
    if (!counts[start] || seen[start]) continue;
    seen[start] = 1;
    const stack = [start];
    let [minC, minR, maxC, maxR, pixels] = [cols, rows, 0, 0, 0];
    while (stack.length) {
      const cell = stack.pop()!;
      const c = cell % cols;
      const r = (cell - c) / cols;
      pixels += counts[cell];
      [minC, minR, maxC, maxR] = [Math.min(minC, c), Math.min(minR, r), Math.max(maxC, c), Math.max(maxR, r)];
      for (let dr = -JOIN; dr <= JOIN; dr++) {
        for (let dc = -JOIN; dc <= JOIN; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const n = nr * cols + nc;
          if (counts[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    const x = minC * CELL;
    const y = minR * CELL;
    regions.push({ x, y, width: Math.min((maxC + 1) * CELL, width) - x, height: Math.min((maxR + 1) * CELL, height) - y, pixels });
  }

  regions = regions.filter((r) => r.pixels >= minPixels && r.width * r.height >= minArea);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        if (!overlaps(regions[i], regions[j])) continue;
        regions[i] = union(regions[i], regions[j]);
        regions.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return regions
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, options.maxRegions ?? 20)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Pixel-diff two PNG screenshots. Images of different sizes are compared on a white canvas. */
export function diffImages(before: Buffer, after: Buffer, options: PixelDiffOptions = {}): PixelDiff {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = Buffer.alloc(width * height * 4);
  pixelmatch(pad(a, width, height), pad(b, width, height), out, width, height, {
    threshold: options.threshold ?? 0.1,
    diffMask: true,
    diffColor: [255, 0, 0],
    aaColor: [0, 0, 255],
  });
  const mask = new Uint8Array(width * height);
  let changedPixels = 0;
  for (let i = 0; i < mask.length; i++) {
    if (out[i * 4 + 3] && out[i * 4] === 255 && out[i * 4 + 2] === 0) {
      mask[i] = 1;
      changedPixels++;
    }
  }
  return { width, height, changedPixels, changedRatio: changedPixels / (width * height), regions: regionsFromMask(mask, width, height, options) };
}
