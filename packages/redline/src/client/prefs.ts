import { useSyncExternalStore } from 'react';

/** localStorage key for toolbar position and outline visibility. */
export const TOOLBAR_PREFS_KEY = 'redline:toolbar';

export interface ToolbarPrefs {
  /** Toolbar top-left in viewport px. Null keeps the default bottom-left spot. */
  position: { x: number; y: number } | null;
  /** Draw outlines. The toolbar stays visible when this is false. */
  outlines: boolean;
}

const DEFAULTS: ToolbarPrefs = { position: null, outlines: true };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ToolbarPrefs = DEFAULTS;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(TOOLBAR_PREFS_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ToolbarPrefs {
  if (!raw) return DEFAULTS;
  try {
    const data = JSON.parse(raw) as Partial<ToolbarPrefs>;
    const p = data.position;
    const position = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    return { position, outlines: data.outlines !== false };
  } catch {
    return DEFAULTS;
  }
}

function getSnapshot(): ToolbarPrefs {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse(raw);
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function setToolbarPrefs(patch: Partial<ToolbarPrefs>): void {
  const next = { ...getSnapshot(), ...patch };
  try {
    window.localStorage.setItem(TOOLBAR_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: keep the change in memory for this page.
    cachedRaw = JSON.stringify(next);
    cached = next;
  }
  listeners.forEach((l) => l());
}

/** Toolbar prefs, shared across tabs through the `storage` event. */
export function useToolbarPrefs(): ToolbarPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);
}
