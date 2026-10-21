import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        mini: resolve(import.meta.dirname, 'mini.html'),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{js,jsx}'],
    environment: 'node',
  },
});
