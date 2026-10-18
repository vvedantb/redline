import { spawn } from 'node:child_process';
import net from 'node:net';
import { viteBin } from '../build';
import { nextBin } from '../standalone';
import type { BuildFramework } from '../types';

export interface DevServer {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  close(): Promise<void>;
}

export interface DevServerOptions {
  /** Config directory inside the worktree. */
  dir: string;
  framework: BuildFramework;
  env: NodeJS.ProcessEnv;
  log: (text: string) => void;
  /** Wait at most this long for the first response. Default 180 s. */
  timeoutMs?: number;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No free port'))));
    });
  });
}

/**
 * Start `vite` or `next dev` in a worktree on a free localhost port and wait until it answers.
 * Runs in its own process group so `close()` stops the server and everything it spawned.
 */
export async function startDevServer({ dir, framework, env, log, timeoutMs = 180_000 }: DevServerOptions): Promise<DevServer> {
  const port = await freePort();
  const args = framework === 'next'
    ? [nextBin(dir), 'dev', '--port', String(port), '--hostname', '127.0.0.1']
    : [viteBin(dir), '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  log(`\n$ node ${args.join(' ')}\n`);
  const child = spawn(process.execPath, args, { cwd: dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.setEncoding('utf8').on('data', log);
  child.stderr?.setEncoding('utf8').on('data', log);
  let exited: number | null | undefined;
  child.on('exit', (code) => (exited = code));
  const url = `http://127.0.0.1:${port}`;

  const close = async () => {
    if (exited !== undefined || child.pid === undefined) return;
    const done = new Promise((r) => child.once('exit', r));
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, 5000);
    await done;
    clearTimeout(timer);
  };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== undefined) throw new Error(`The ${framework} dev server exited with code ${exited} before it answered.`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { url, close };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await close();
  throw new Error(`The ${framework} dev server did not answer within ${Math.round(timeoutMs / 1000)} s.`);
}
