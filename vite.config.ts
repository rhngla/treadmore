import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// vite.config.ts
export default defineConfig({
  base: './', // or `./` if you’ll host from /docs directly
  plugins: [react()],
  build: { outDir: 'docs', emptyOutDir: true },
});
