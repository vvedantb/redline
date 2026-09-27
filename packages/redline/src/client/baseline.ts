import type { BaselineMode, LogResponse } from '../types';

export const DEFAULT_ENDPOINT = '/__redline';
export const LOCAL_BASELINE_KEY = 'redline:baseline';
export const REFRESH_EVENT = 'redline:refresh';

export interface BaselineInfo {
  mode: Exclude<BaselineMode, 'none'>;
  sha: string;
  pinnedAt: string;
  notes?: string;
  /** Files in a content baseline. */
  files?: string[];
}

export interface BaselineState {
  enabled: boolean;
  headSha: string | null;
  baseline: BaselineInfo | null;
  /** `server` when the dev server answered, `local` when read from localStorage only. */
  source: 'server' | 'local';
}

export interface PinInput {
  /** Git ref or SHA. Defaults to HEAD when neither `sha` nor `files` is set. */
  sha?: string;
  /** Content baseline: root-relative path → file contents. */
  files?: Record<string, string>;
  notes?: string;
}

export interface EndpointOptions {
  endpoint?: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function saveLocal(info: BaselineInfo | null): void {
  const s = storage();
  if (!s) return;
  if (info) s.setItem(LOCAL_BASELINE_KEY, JSON.stringify(info));
  else s.removeItem(LOCAL_BASELINE_KEY);
}

function readLocal(): BaselineInfo | null {
  try {
    const raw = storage()?.getItem(LOCAL_BASELINE_KEY);
    return raw ? (JSON.parse(raw) as BaselineInfo) : null;
  } catch {
    return null;
  }
}

/** Ask a mounted `RedlineOverlay` to refetch the diff. */
export function refreshRedline(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

async function call(endpoint: string, action: string, init?: RequestInit): Promise<BaselineState> {
  const res = await fetch(`${endpoint}/${action}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as Omit<BaselineState, 'source'> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Redline ${action} failed (${res.status})`);
  return { ...json, source: 'server' };
}

/**
 * Pin the current baseline. Writes `.redline/baseline.json` through the dev server
 * and mirrors it to localStorage. Falls back to localStorage alone when the server
 * is unreachable and a SHA was given.
 */
export async function pinBaseline(input: PinInput = {}, options: EndpointOptions = {}): Promise<BaselineState> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    const state = await call(endpoint, 'pin', { method: 'POST', body: JSON.stringify(input) });
    saveLocal(state.baseline);
    refreshRedline();
    return state;
  } catch (err) {
    if (err instanceof TypeError && input.sha) {
      const info: BaselineInfo = { mode: 'git', sha: input.sha, notes: input.notes, pinnedAt: new Date().toISOString() };
      saveLocal(info);
      refreshRedline();
      return { enabled: true, headSha: null, baseline: info, source: 'local' };
    }
    throw err;
  }
}

/** Read the pinned baseline from the dev server, or localStorage if the server is unreachable. */
export async function getBaseline(options: EndpointOptions = {}): Promise<BaselineState> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    return await call(endpoint, 'baseline');
  } catch {
    return { enabled: true, headSha: null, baseline: readLocal(), source: 'local' };
  }
}

/** Remove the pinned baseline from the dev server and localStorage. */
export async function clearBaseline(options: EndpointOptions = {}): Promise<BaselineState> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  saveLocal(null);
  try {
    const state = await call(endpoint, 'clear', { method: 'POST', body: '{}' });
    refreshRedline();
    return state;
  } catch {
    refreshRedline();
    return { enabled: true, headSha: null, baseline: null, source: 'local' };
  }
}

/** Recent commits, newest first. Read-only: the server runs `git log`. */
export async function getLog(options: EndpointOptions & { limit?: number } = {}): Promise<LogResponse> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const qs = options.limit ? `?limit=${options.limit}` : '';
  const res = await fetch(`${endpoint}/log${qs}`, { cache: 'no-store' });
  const json = (await res.json()) as LogResponse & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Redline log failed (${res.status})`);
  return json;
}
