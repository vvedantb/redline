import react from '@vitejs/plugin-react';
import { redline } from '@vvedantb/redline/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** A tiny live API for the notes feed. History pages replay `network-fixtures.json` instead. */
function demoApi(): Plugin {
  return {
    name: 'demo-api',
    configureServer(server) {
      server.middlewares.use('/api/demo/notes', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'POST') {
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.end(JSON.stringify({ notes: [{ id: 'live', text: 'Live note' }] }));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    // prNotes off: e2e must not depend on whether `gh` is installed and signed in.
    redline({ prNotes: false, history: { networkFixtures: fileURLToPath(new URL('./network-fixtures.json', import.meta.url)) } }),
    react(),
    demoApi(),
  ],
  server: { port: 5173 },
});
