import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Relative base so the built site works from any folder or static host (GitHub Pages, Netlify, a zip).
// Two pages: the 3D game (index.html) and the 2D rules lab from milestone 1 (lab.html).
// `ARTIFACT=1` builds only the game as one bundle, for scripts/single-file.mjs to inline into one HTML file.
const artifact = !!process.env.ARTIFACT;
// `PORTAL=crazygames` builds the game alone for a web portal (npm run build:crazygames): no playtest upload, no
// service worker or manifest, no lab page, into dist-crazygames/ for scripts/portal-zip.mjs to zip. See PORTAL.md.
const portal = process.env.PORTAL === 'crazygames';

/** The portal page has no home-screen app: drop the manifest, the app icons and Apple's home-screen tags. */
function portalHtml(): Plugin {
  return {
    name: 'unfill-portal-html',
    transformIndexHtml(html) {
      return html
        .replace(/^\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, '')
        .replace(/^\s*<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable|claude:viewport-fit-sides)"[^>]*>\n/gm, '');
    },
  };
}

/** Every file in public/, as site-relative paths (they're copied to the site root as they are). */
function publicFiles(dir = resolve(import.meta.dirname, 'public')): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

/**
 * Writes sw.js, the service worker that makes the home-screen app play offline (src/app/game/pwa.ts registers it).
 * It caches every file of this build on install, then answers from that cache first, so the game opens with no
 * connection. Its version is a hash of the build's files: when anything changes, the browser sees a new sw.js, fetches
 * the new files in the background, and the next launch runs them.
 */
function pwa(): Plugin {
  return {
    name: 'unfill-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      const files = ['./', ...Object.keys(bundle).sort(), ...publicFiles().sort()];
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      for (const f of publicFiles()) hash.update(f).update(readFileSync(resolve(import.meta.dirname, 'public', f)));
      const version = hash.digest('hex').slice(0, 12);
      const list = files.map((f) => (f === './' ? f : `./${f}`));
      const code = readFileSync(resolve(import.meta.dirname, 'src/sw-template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(list, null, 2));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({
  base: './',
  // the single-file artifact runs inside claude.ai's frame, where a service worker can't run
  // __BUILD__: the commit that built it (GitHub Actions sets GITHUB_SHA), sent with playtest rows
  define: {
    __PWA__: JSON.stringify(!artifact && !portal),
    __PORTAL__: JSON.stringify(portal),
    __BUILD__: JSON.stringify((process.env.GITHUB_SHA || 'local').slice(0, 7)),
  },
  plugins: artifact ? [] : portal ? [portalHtml()] : [pwa()],
  publicDir: artifact || portal ? false : 'public',
  build: portal
    ? {
        outDir: 'dist-crazygames',
        rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
      }
    : artifact
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
