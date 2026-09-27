/**
 * Read-only network layer for History pages. Served to the browser as a script built from the
 * functions below with `Function.prototype.toString`, so each one must be self-contained: no
 * imports and no references to module-level values. Types are erased and are fine.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface NetworkFixtureEntry {
  /** `method` defaults to GET. `url` is a path (with or without a query) or an absolute URL; the host is ignored. */
  request: { method?: string; url: string };
  /** `status` defaults to 200. A string `body` is sent as is, anything else as JSON. */
  response: { status?: number; headers?: Record<string, string>; body?: JsonValue };
}

export interface NetworkFixtures {
  version: 1;
  entries: NetworkFixtureEntry[];
}

export type NetworkMode = 'replay' | 'passthrough' | 'capture';

export interface NetworkMutation {
  method: string;
  url: string;
  blocked: true;
}

/** `window.__redlineNetwork`. */
export interface RedlineNetworkState {
  mode: NetworkMode;
  /** True in replay: writes never reach the network. */
  readOnly: boolean;
  fixturesLoaded: boolean;
  lastMutation?: NetworkMutation;
  /** The fixture a request would replay, or null. */
  match(url: string, method?: string): NetworkFixtureEntry | null;
  /** Capture mode: GET responses recorded so far, as a fixtures file. */
  dumpFixtures(): NetworkFixtures;
  /** Capture mode: download `dumpFixtures()` as `network-fixtures.json`. */
  downloadFixtures(): void;
}

/** The key a URL is matched on: path and query, host ignored, History prefix and trailing slash dropped. */
export function fixtureKey(url: string, base: string): { path: string; search: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  let pathname = parsed.pathname.replace(/^\/__redline\/h\/[0-9a-f]{40}(?=\/)/, '');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  return { path: pathname, search: parsed.search };
}

/** The first entry for this request: path and query match first, then path only. HEAD matches GET entries. */
export function matchFixture(fixtures: NetworkFixtures, method: string, url: string, base: string): NetworkFixtureEntry | null {
  const key = fixtureKey(url, base);
  if (!key) return null;
  const want = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const candidates = fixtures.entries.filter((e) => (e.request.method ?? 'GET').toUpperCase() === want);
  const keyOf = (e: NetworkFixtureEntry) => fixtureKey(e.request.url, base);
  return (
    candidates.find((e) => {
      const k = keyOf(e);
      return !!k && k.path === key.path && k.search === key.search;
    }) ??
    candidates.find((e) => {
      const k = keyOf(e);
      return !!k && k.path === key.path && k.search === '';
    }) ??
    null
  );
}

export function isMutation(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/** What a blocked write returns: a read-only success. */
export function mutationResponse(): { status: number; headers: Record<string, string>; text: string } {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-redline-read-only': '1' },
    text: JSON.stringify({ ok: true, readOnly: true }),
  };
}

/** A fixture as status, lower-case headers and body text. */
export function fixtureResponse(entry: NetworkFixtureEntry): { status: number; headers: Record<string, string>; text: string } {
  const headers: Record<string, string> = { 'x-redline-fixture': '1' };
  for (const [k, v] of Object.entries(entry.response.headers ?? {})) headers[k.toLowerCase()] = v;
  const body = entry.response.body;
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  if (typeof body !== 'string' && body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
  return { status: entry.response.status ?? 200, headers, text };
}

/** Patch `fetch` and `XMLHttpRequest` in `win`. Replay in History pages, capture with `?redlineNetwork=capture`. */
export function installRedlineNetwork(win: Window & typeof globalThis): void {
  if (win.__redlineNetwork) return;
  const inHistory = win.location.pathname.includes('/__redline/h/');
  const param = new URLSearchParams(win.location.search).get('redlineNetwork');
  const mode: NetworkMode = inHistory ? 'replay' : param === 'capture' ? 'capture' : 'passthrough';
  const base = win.location.href;
  const originalFetch = win.fetch.bind(win);
  let fixtures: NetworkFixtures = { version: 1, entries: [] };
  const captured = new Map<string, NetworkFixtureEntry>();

  const state: RedlineNetworkState = {
    mode,
    readOnly: mode === 'replay',
    fixturesLoaded: false,
    match: (url, method = 'GET') => matchFixture(fixtures, method, url, base),
    dumpFixtures: () => ({ version: 1, entries: [...captured.values()] }),
    downloadFixtures: () => {
      const blob = new Blob([JSON.stringify(state.dumpFixtures(), null, 2) + '\n'], { type: 'application/json' });
      const a = win.document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'network-fixtures.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
  };
  win.__redlineNetwork = state;
  if (mode === 'passthrough') return;

  if (mode === 'capture') {
    win.fetch = async (input, init) => {
      const res = await originalFetch(input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(input instanceof Request ? input.url : String(input), base);
      const json = (res.headers.get('content-type') ?? '').includes('json');
      if (method === 'GET' && json && url.origin === win.location.origin && !url.pathname.startsWith('/__redline/')) {
        res
          .clone()
          .json()
          .then((body: JsonValue) => {
            const path = url.pathname + url.search;
            captured.set(path, { request: { method, url: path }, response: { status: res.status, headers: { 'content-type': 'application/json' }, body } });
          })
          .catch(() => {});
      }
      return res;
    };
    return;
  }

  const ready = originalFetch('/__redline/network/fixtures', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: NetworkFixtures | null) => {
      if (data && Array.isArray(data.entries)) fixtures = data;
    })
    .catch(() => {})
    .then(() => {
      state.fixturesLoaded = true;
    });

  type Canned = { status: number; headers: Record<string, string>; text: string };

  /** Writes never reach the network: record them and answer read-only. */
  const block = (method: string, url: string): Canned => {
    state.lastMutation = { method: method.toUpperCase(), url, blocked: true };
    return mutationResponse();
  };

  /** The fixture for a read, or null to pass it through. */
  const lookup = async (method: string, url: string): Promise<Canned | null> => {
    await ready;
    const entry = matchFixture(fixtures, method, url, base);
    return entry ? fixtureResponse(entry) : null;
  };

  win.fetch = async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const url = input instanceof Request ? input.url : String(input);
    const canned = isMutation(method) ? block(method, url) : await lookup(method, url);
    if (!canned) return originalFetch(input, init);
    const empty = method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(canned.status);
    return new Response(empty ? null : canned.text, { status: canned.status, headers: canned.headers });
  };

  const XHR = win.XMLHttpRequest;
  if (!XHR) return;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; async: boolean }>();

  /** Complete `xhr` with a canned response. Async requests fire their events after `send` returns. */
  const respond = (xhr: XMLHttpRequest, url: string, canned: Canned, async: boolean) => {
    const value = (v: string | number | object | null) => ({ configurable: true, get: () => v });
    let response: string | object | null = canned.text;
    if (xhr.responseType === 'json') {
      try {
        response = JSON.parse(canned.text);
      } catch {
        response = null;
      }
    }
    Object.defineProperties(xhr, {
      readyState: value(4),
      status: value(canned.status),
      statusText: value(canned.status === 200 ? 'OK' : ''),
      responseText: value(canned.text),
      response: value(response),
      responseURL: value(new URL(url, base).href),
    });
    xhr.getResponseHeader = (name: string) => canned.headers[name.toLowerCase()] ?? null;
    xhr.getAllResponseHeaders = () =>
      Object.entries(canned.headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join('');
    const fire = () => ['readystatechange', 'load', 'loadend'].forEach((type) => xhr.dispatchEvent(new Event(type)));
    if (async) setTimeout(fire, 0);
    else fire();
  };

  XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null) {
    requests.set(this, { method, url: String(url), async: async !== false });
    return open.call(this, method, url, async ?? true, user, password);
  };
  XHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const req = requests.get(this);
    if (!req) return send.call(this, body);
    if (isMutation(req.method)) return respond(this, req.url, block(req.method, req.url), req.async);
    // Sync reads cannot wait for fixtures.
    if (!req.async) return send.call(this, body);
    void lookup(req.method, req.url).then((canned) => (canned ? respond(this, req.url, canned, true) : send.call(this, body)));
  };
}

declare global {
  interface Window {
    __redlineNetwork?: RedlineNetworkState;
  }
}
