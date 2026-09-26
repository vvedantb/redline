import react from '@vitejs/plugin-react';
import { redline } from '@vedantb/redline/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [redline(), react()],
  server: { port: 5173 },
});
