import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Relative base so the built site works from any folder or static host (GitHub Pages, Netlify, a zip).
// Pages: the 3D game (index.html), the 2D rules lab from milestone 1 (lab.html), and the concept playground
// (concepts.html: the same rules drawn as marbles, yarn, flowers and fireflies).
// `ARTIFACT=1` builds only the game as one bundle, for scripts/single-file.mjs to inline into one HTML file.
const artifact = !!process.env.ARTIFACT;
// ARTIFACT=concepts builds the concept playground instead of the game
const artifactPage = process.env.ARTIFACT === 'concepts' ? 'concepts.html' : 'index.html';

export default defineConfig({
  base: './',
  build: artifact
    ? {
        outDir: 'dist-single',
        modulePreload: false,
        assetsInlineLimit: 100_000_000,
        rollupOptions: { input: resolve(import.meta.dirname, artifactPage) },
      }
    : {
        rollupOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            lab: resolve(import.meta.dirname, 'lab.html'),
            concepts: resolve(import.meta.dirname, 'concepts.html'),
          },
        },
      },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
