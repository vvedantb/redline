import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRedlineRequest, type RedlineServerOptions } from './server';

export const ENDPOINT = '/__redline';

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

/** Connect-style middleware that serves `/__redline/*`. */
export function createMiddleware(getOptions: () => RedlineServerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(ENDPOINT + '/')) return next();
    const action = url.pathname.slice(ENDPOINT.length + 1).replace(/\/$/, '');
    let status = 200;
    let body: unknown;
    try {
      const input = req.method === 'POST' ? await readBody(req) : {};
      ({ status, body } = handleRedlineRequest(getOptions(), action, req.method ?? 'GET', url.searchParams, input));
    } catch (err) {
      status = 400;
      body = { error: err instanceof Error ? err.message : String(err) };
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
}
