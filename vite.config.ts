import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Relative base so the built site works from any folder or static host (GitHub Pages, Netlify, a zip).
// Two pages: the 3D game (index.html) and the 2D rules lab from milestone 1 (lab.html).
// `ARTIFACT=1` builds only the game as one bundle, for scripts/single-file.mjs to inline into one HTML file.
const artifact = !!process.env.ARTIFACT;

export default defineConfig({
  base: './',
  build: artifact
    ? {
        outDir: 'dist-single',
        modulePreload: false,
        assetsInlineLimit: 100_000_000,
        rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
      }
    : {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            lab: resolve(import.meta.dirname, 'lab.html'),
          },
        },
      },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
