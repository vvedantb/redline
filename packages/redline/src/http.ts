import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveStaticFile, sendFile, sendHistoryFile } from './build';
import { defaultFixturesFile, sendNetworkAsset } from './network/serve';
import { ENDPOINT, HISTORY_PREFIX, isFullSha } from './paths';
import { handleRedlineRequest, type RedlineServerOptions } from './server';

export { ENDPOINT };

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
      if (raw.length > 20 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function notFound(res: ServerResponse, message = 'Not found'): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(message);
}

/**
 * Static files for `GET /__redline/h/<sha>/*`, read from `.redline/builds/<sha>/dist` only.
 * Only ready builds of a full SHA are served.
 */
function serveHistory(opts: RedlineServerOptions, url: URL, req: IncomingMessage, res: ServerResponse): void {
  const [sha, ...rest] = url.pathname.slice(HISTORY_PREFIX.length).split('/');
  const dist = opts.enabled !== false && isFullSha(sha) ? opts.builds?.distFor(sha) : null;
  if (!dist) return notFound(res, 'No ready build for this commit');
  if (rest.length === 0) {
    res.statusCode = 308;
    res.setHeader('Location', `${HISTORY_PREFIX}${sha}/${url.search}`);
    res.end();
    return;
  }
  const file = resolveStaticFile(dist, rest.join('/'));
  if (!file) return notFound(res);
  sendHistoryFile(res, file, req.method);
}

function serveThumbnail(opts: RedlineServerOptions, url: URL, req: IncomingMessage, res: ServerResponse): void {
  const sha = url.searchParams.get('sha') ?? '';
  const file = opts.enabled !== false && isFullSha(sha) ? opts.builds?.thumbnailFile(sha) : null;
  if (!file) return notFound(res);
  sendFile(res, file, req.method);
}

/** Connect-style middleware that serves `/__redline/*`. */
export function createMiddleware(getOptions: () => RedlineServerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(ENDPOINT + '/')) return next();
    const method = req.method ?? 'GET';
    const action = url.pathname.slice(ENDPOINT.length + 1).replace(/\/$/, '');
    if (url.pathname.startsWith(HISTORY_PREFIX) && (method === 'GET' || method === 'HEAD')) {
      return serveHistory(getOptions(), url, req, res);
    }
    if (action === 'build/thumb') return serveThumbnail(getOptions(), url, req, res);
    const opts = getOptions();
    if (opts.enabled !== false && (method === 'GET' || method === 'HEAD')) {
      if (sendNetworkAsset(res, url.pathname, opts.builds?.fixturesFile ?? defaultFixturesFile(opts.root), method)) return;
    }

    let status = 200;
    let body: unknown;
    let text: string | undefined;
    try {
      const input = method === 'POST' ? await readBody(req) : {};
      ({ status, body, text } = handleRedlineRequest(getOptions(), action, method, url.searchParams, input));
    } catch (err) {
      status = 400;
      body = { error: err instanceof Error ? err.message : String(err) };
    }
    res.statusCode = status;
    res.setHeader('Content-Type', text === undefined ? 'application/json' : 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text ?? JSON.stringify(body));
  };
}
