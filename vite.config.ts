import { defineConfig } from 'vitest/config';

// Relative base so the built site works from any folder or static host (GitHub Pages, Netlify, a zip).
export default defineConfig({
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
