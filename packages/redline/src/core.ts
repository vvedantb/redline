export { parseUnifiedDiff } from './diff';
export { matchChangedRegions, findHunk } from './match';
export type { TaggedNode, ChangedRegion } from './match';
export { isOverlayEnabled, STORAGE_DISABLED_KEY } from './flags';
export type { OverlayFlagInput } from './flags';
export { SOURCE_ATTR, formatSource, parseSource, normalizePath } from './source';
export * from './types';
