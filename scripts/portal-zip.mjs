// Zips the portal build (dist-crazygames/, from `PORTAL=crazygames vite build`) for upload to CrazyGames, after
// checking it against their technical requirements: index.html at the zip's root, relative paths only, at most 1,500
// files, initial download under 20 MB (their mobile homepage limit; 50 MB is the hard cap), and no requests to other
// sites (no playtest collector, no service worker) apart from the CrazyGames SDK, which must be loaded from their
// server. See PORTAL.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = join(root, 'dist-crazygames');
const out = join(root, 'unfill-crazygames.zip');
const SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dir);

const problems = [];
const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
if (!existsSync(join(dir, 'index.html'))) problems.push('no index.html at the root');
if (files.length > 1500) problems.push(`${files.length} files (limit 1,500)`);
if (bytes > 20 * 1024 * 1024) problems.push(`${(bytes / 1048576).toFixed(1)} MB (mobile homepage limit 20 MB)`);
for (const f of files) {
  const rel = relative(dir, f);
  if (rel === 'sw.js' || rel.endsWith('.webmanifest')) problems.push(`${rel}: home-screen app files don't belong in a portal build`);
  if (!/\.(html|js|css)$/.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  if (/script\.google\.com|docs\.google\.com/.test(text)) problems.push(`${rel}: still talks to the playtest collector`);
  if (/serviceWorker\.register/.test(text)) problems.push(`${rel}: still registers a service worker`);
  if (rel.endsWith('.html')) {
    for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(\/|https?:)/.test(m[1]) && m[1] !== SDK) problems.push(`${rel}: absolute path ${m[1]}`);
    }
    if (rel === 'index.html') {
      const sdkAt = text.indexOf(`<script src="${SDK}">`);
      if (sdkAt < 0 || sdkAt > text.indexOf('</head>')) problems.push(`${rel}: the CrazyGames SDK isn't loaded in the head`);
      else if (sdkAt > text.indexOf('<script type="module"')) problems.push(`${rel}: the CrazyGames SDK loads after the game`);
    }
  }
}
if (problems.length) {
  console.error('Portal build check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

rmSync(out, { force: true });
execFileSync('zip', ['-qr9X', out, '.'], { cwd: dir });
const zipped = statSync(out).size;
console.log(
  `unfill-crazygames.zip: ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB unpacked, ${(zipped / 1048576).toFixed(2)} MB zipped`,
);
