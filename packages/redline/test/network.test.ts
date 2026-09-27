import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { fixtureKey, matchFixture, mutationResponse, type NetworkFixtures, type RedlineNetworkState } from '../src/network/runtime';
import { bootstrapScript, injectBootstrap, readFixtures } from '../src/network/serve';

const SHA = 'a'.repeat(40);
const BASE = `http://localhost:5173/__redline/h/${SHA}/`;

const fixtures: NetworkFixtures = {
  version: 1,
  entries: [
    { request: { url: '/api/notes' }, response: { body: { notes: ['all'] } } },
    { request: { url: '/api/notes?tag=a' }, response: { body: { notes: ['a'] } } },
    { request: { method: 'POST', url: '/api/notes' }, response: { body: 'never' } },
  ],
};

describe('matchFixture', () => {
  it('ignores the host, the History prefix and trailing slashes', () => {
    expect(fixtureKey('https://other.example/api/x/?q=1', BASE)).toEqual({ path: '/api/x', search: '?q=1' });
    expect(fixtureKey('api/x', BASE)).toEqual({ path: '/api/x', search: '' });
    expect(fixtureKey('/', BASE)).toEqual({ path: '/', search: '' });
  });

  it('prefers path and query, then falls back to the path', () => {
    const body = (url: string, method = 'GET') => matchFixture(fixtures, method, url, BASE)?.response.body;
    expect(body('/api/notes')).toEqual({ notes: ['all'] });
    expect(body('http://localhost:5173/api/notes/?tag=a')).toEqual({ notes: ['a'] });
    expect(body('/api/notes?tag=b')).toEqual({ notes: ['all'] });
    expect(body('/api/notes', 'head')).toEqual({ notes: ['all'] });
    expect(body('/api/other')).toBeUndefined();
  });

  it('answers writes with a read-only success', () => {
    const res = mutationResponse();
    expect(res.status).toBe(200);
    expect(res.headers['x-redline-read-only']).toBe('1');
    expect(JSON.parse(res.text)).toEqual({ ok: true, readOnly: true });
  });
});

describe('readFixtures', () => {
  it('reads entries and skips malformed ones', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'redline-net-')), 'f.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [fixtures.entries[0], { request: {} }, null, { request: { url: '/x' }, response: { status: 404, headers: { a: 1 } } }] }));
    expect(readFixtures(file).entries).toEqual([
      { request: { url: '/api/notes' }, response: { headers: {}, body: { notes: ['all'] } } },
      { request: { url: '/x' }, response: { status: 404, headers: {} } },
    ]);
    expect(readFixtures(file + '.missing')).toEqual({ version: 1, entries: [] });
    fs.writeFileSync(file, '{nope');
    expect(readFixtures(file)).toEqual({ version: 1, entries: [] });
  });
});

describe('injectBootstrap', () => {
  it('adds the script at the start of <head>, once', () => {
    const html = injectBootstrap('<html><head lang="en"><script type="module" src="/a.js"></script></head></html>');
    expect(html).toBe('<html><head lang="en"><script src="/__redline/network/bootstrap.js"></script><script type="module" src="/a.js"></script></head></html>');
    expect(injectBootstrap(html)).toBe(html);
    expect(injectBootstrap('<p>x</p>')).toBe('<script src="/__redline/network/bootstrap.js"></script><p>x</p>');
  });
});

/** Run the served bootstrap in a fresh context with a fake window at `href`. */
function runBootstrap(href: string) {
  const calls: string[] = [];
  const fetch = async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/__redline/network/fixtures') return Response.json(fixtures);
    return Response.json({ live: true });
  };
  /** Records what reaches the "network"; the bootstrap patches its prototype. */
  class FakeXHR extends EventTarget {
    responseType = '';
    private target = '';
    open(method: string, url: string, _async = true) {
      this.target = `${method} ${url}${_async ? '' : ' (sync)'}`;
    }
    send() {
      calls.push(`xhr ${this.target}`);
    }
  }
  const location = new URL(href);
  const window: { location: URL; fetch: typeof fetch; XMLHttpRequest: typeof FakeXHR; __redlineNetwork?: RedlineNetworkState } = {
    location,
    fetch,
    XMLHttpRequest: FakeXHR,
  };
  vm.runInNewContext(bootstrapScript(), { window, URL, URLSearchParams, Request, Response, Headers, Blob, Map, WeakMap, Promise, JSON, Event, setTimeout });
  return { window, calls };
}

describe('bootstrap script', () => {
  it('replays fixtures and blocks writes in History pages', async () => {
    const { window, calls } = runBootstrap(BASE);
    expect(window.__redlineNetwork).toMatchObject({ mode: 'replay', readOnly: true });
    const notes = await window.fetch('/api/notes');
    expect(notes.headers.get('x-redline-fixture')).toBe('1');
    expect(await notes.json()).toEqual({ notes: ['all'] });
    expect(window.__redlineNetwork?.fixturesLoaded).toBe(true);

    // No fixture: GET passes through.
    expect(await (await window.fetch('/assets/data.json')).json()).toEqual({ live: true });

    const write = await window.fetch('/api/notes', { method: 'POST', body: '{}' });
    expect(write.headers.get('x-redline-read-only')).toBe('1');
    expect(await write.json()).toEqual({ ok: true, readOnly: true });
    expect(window.__redlineNetwork?.lastMutation).toEqual({ method: 'POST', url: '/api/notes', blocked: true });
    expect(calls).toEqual(['GET /__redline/network/fixtures', 'GET /assets/data.json']);
  });

  it('replays XHR reads and blocks XHR writes, sync ones included', async () => {
    const { window, calls } = runBootstrap(BASE);
    const read = new window.XMLHttpRequest();
    read.open('GET', '/api/notes');
    const loaded = new Promise((r) => read.addEventListener('load', r));
    read.send();
    await loaded;
    expect(Reflect.get(read, 'status')).toBe(200);
    expect(JSON.parse(Reflect.get(read, 'responseText'))).toEqual({ notes: ['all'] });

    const write = new window.XMLHttpRequest();
    write.open('POST', '/api/notes', false);
    write.send();
    expect(Reflect.get(write, 'readyState')).toBe(4);
    expect(JSON.parse(Reflect.get(write, 'responseText'))).toEqual({ ok: true, readOnly: true });
    expect(window.__redlineNetwork?.lastMutation).toEqual({ method: 'POST', url: '/api/notes', blocked: true });

    const syncRead = new window.XMLHttpRequest();
    syncRead.open('GET', '/api/notes', false);
    syncRead.send();
    expect(calls).toEqual(['GET /__redline/network/fixtures', 'xhr GET /api/notes (sync)']);
  });

  it('leaves live pages alone', async () => {
    const { window, calls } = runBootstrap('http://localhost:5173/');
    expect(window.__redlineNetwork?.mode).toBe('passthrough');
    expect(await (await window.fetch('/api/notes', { method: 'POST' })).json()).toEqual({ live: true });
    expect(calls).toEqual(['POST /api/notes']);
  });

  it('records same-origin JSON GETs in capture mode', async () => {
    const { window } = runBootstrap('http://localhost:5173/?redlineNetwork=capture');
    expect(window.__redlineNetwork?.mode).toBe('capture');
    await window.fetch('/api/notes?tag=a');
    await new Promise((r) => setTimeout(r, 0));
    expect(window.__redlineNetwork?.dumpFixtures()).toEqual({
      version: 1,
      entries: [{ request: { method: 'GET', url: '/api/notes?tag=a' }, response: { status: 200, headers: { 'content-type': 'application/json' }, body: { live: true } } }],
    });
  });
});
