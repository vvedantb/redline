import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { ENDPOINT } from '../paths';
import {
  fixtureKey,
  fixtureResponse,
  installRedlineNetwork,
  isMutation,
  matchFixture,
  mutationResponse,
  type NetworkFixtureEntry,
  type NetworkFixtures,
} from './runtime';

/** Served by the live dev server, not under a History base path. */
export const NETWORK_BOOTSTRAP_PATH = `${ENDPOINT}/network/bootstrap.js`;
export const NETWORK_FIXTURES_PATH = `${ENDPOINT}/network/fixtures`;

/** A blocking script, so `fetch` is patched before the app's module scripts run. */
export const NETWORK_BOOTSTRAP_TAG = `<script src="${NETWORK_BOOTSTRAP_PATH}"></script>`;

export function defaultFixturesFile(root: string): string {
  return path.join(root, '.redline', 'network-fixtures.json');
}

/** The browser IIFE: the runtime functions, then `installRedlineNetwork(window)`. */
export function bootstrapScript(): string {
  const fns = [fixtureKey, matchFixture, isMutation, mutationResponse, fixtureResponse, installRedlineNetwork];
  return `/* Redline History network (read-only). */\n(function () {\n${fns.map(String).join('\n')}\ninstallRedlineNetwork(window);\n})();\n`;
}

/** Fixtures from `file`. Missing or malformed files, and malformed entries, give no entries. */
export function readFixtures(file: string): NetworkFixtures {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { version: 1, entries: [] };
  }
  const entries: NetworkFixtureEntry[] = [];
  for (const e of Array.isArray(data?.entries) ? data.entries : []) {
    const { request, response } = e ?? {};
    if (typeof request?.url !== 'string' || !response || typeof response !== 'object') continue;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(response.headers ?? {})) if (typeof v === 'string') headers[k] = v;
    entries.push({
      request: { url: request.url, ...(typeof request.method === 'string' ? { method: request.method } : {}) },
      response: {
        ...(typeof response.status === 'number' ? { status: response.status } : {}),
        headers,
        ...(response.body !== undefined ? { body: response.body } : {}),
      },
    });
  }
  return { version: 1, entries };
}

/** Add the bootstrap tag at the start of `<head>`, or at the start of the document. Idempotent. */
export function injectBootstrap(html: string): string {
  if (html.includes(NETWORK_BOOTSTRAP_TAG)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return NETWORK_BOOTSTRAP_TAG + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + NETWORK_BOOTSTRAP_TAG + html.slice(at);
}

/** `network/bootstrap.js` and `network/fixtures` (the part after `/__redline/`), or null for other actions. */
export function networkAsset(action: string, fixturesFile: string): { contentType: string; body: string } | null {
  if (action === 'network/bootstrap.js') return { contentType: 'text/javascript; charset=utf-8', body: bootstrapScript() };
  if (action === 'network/fixtures') return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(readFixtures(fixturesFile)) };
  return null;
}

/** Answer `GET /__redline/network/*` on a Node response. Returns false for other paths. */
export function sendNetworkAsset(res: ServerResponse, pathname: string, fixturesFile: string, method = 'GET'): boolean {
  const asset = pathname.startsWith(ENDPOINT + '/') ? networkAsset(pathname.slice(ENDPOINT.length + 1), fixturesFile) : null;
  if (!asset) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(method === 'HEAD' ? undefined : asset.body);
  return true;
}
