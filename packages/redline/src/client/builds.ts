import { useSyncExternalStore } from 'react';
import type { BuildJob, BuildListResponse, BuildResponse } from '../types';

export interface BuildsState {
  /** Jobs keyed by full SHA. */
  builds: Record<string, BuildJob>;
  error: string | null;
}

/** Poll interval while any build or thumbnail is in progress. Polling stops when all are settled. */
const ACTIVE_POLL_MS = 1000;
const EMPTY: BuildsState = { builds: {}, error: null };

interface BuildStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => BuildsState;
  /** Queue a build, or re-queue a failed one. */
  request: (sha: string) => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function createStore(endpoint: string): BuildStore {
  let state = EMPTY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (next: BuildsState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const busy = () =>
    Object.values(state.builds).some((b) => b.status === 'queued' || b.status === 'building' || b.thumbnail === 'pending');
  const schedule = () => {
    clearTimeout(timer);
    timer = listeners.size > 0 && busy() ? setTimeout(() => void refresh(), ACTIVE_POLL_MS) : undefined;
  };

  const refresh = async () => {
    try {
      const res = await fetch(`${endpoint}/build`, { cache: 'no-store' });
      const json: BuildListResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Redline build list failed (${res.status})`);
      set({ builds: Object.fromEntries(json.builds.map((b) => [b.sha, b])), error: null });
    } catch (err) {
      set({ ...state, error: errorText(err) });
    }
    schedule();
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) void refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) schedule();
      };
    },
    async request(sha) {
      try {
        const res = await fetch(`${endpoint}/build`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha }),
        });
        const json: BuildResponse & { error?: string } = await res.json();
        if (!res.ok || !json.build) throw new Error(json.error ?? `Redline build failed (${res.status})`);
        set({ builds: { ...state.builds, [sha]: json.build }, error: null });
      } catch (err) {
        set({ ...state, error: errorText(err) });
      }
      schedule();
    },
  };
}

const stores = new Map<string, BuildStore>();

/** One store per endpoint, shared by every component that reads builds. */
export function buildStore(endpoint: string): BuildStore {
  let store = stores.get(endpoint);
  if (!store) {
    store = createStore(endpoint);
    stores.set(endpoint, store);
  }
  return store;
}

const idleSubscribe = () => () => {};

/** History build jobs. Fetches and polls only while `active`. */
export function useBuilds(endpoint: string, active: boolean): BuildsState {
  const store = buildStore(endpoint);
  return useSyncExternalStore(active ? store.subscribe : idleSubscribe, store.getSnapshot, () => EMPTY);
}
