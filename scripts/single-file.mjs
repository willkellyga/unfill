// Turns the ARTIFACT=1 build (dist-single/) into one self-contained page, dist-single/unfill.html, with the script
// and styles inlined. That file can be opened straight from disk, emailed, or published as a Claude artifact.
// Usage: npm run build:single
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-single';
let html = readFileSync(join(dir, 'index.html'), 'utf8');
const read = (href) => readFileSync(join(dir, href.replace(/^\.\//, '')), 'utf8');

const css = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="(\.\/assets\/[^"]+\.css)"[^>]*>/g, (_, href) => {
  css.push(read(href));
  return '';
});
const js = [];
html = html.replace(/<script type="module"[^>]*src="(\.\/assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, href) => {
  js.push(read(href));
  return '';
});
if (!js.length) throw new Error('single-file: no module script found in dist-single/index.html');
const style = `<style>\n${css.join('\n')}\n</style>`;
// `</script` inside the bundle would end the inline script early
const script = `<script type="module">\n${js.join('\n').replace(/<\/script/gi, '<\\/script')}\n</script>`;

// The home-screen app's manifest and icons aren't part of a one-file page (it can't be installed as an app).
const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1]
  .split('\n')
  .filter((l) => !/rel="(manifest|icon|apple-touch-icon)"|mobile-web-app/.test(l))
  .join('\n');
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1];
const full = `<!doctype html>\n<html lang="en">\n<head>${head}${style}\n</head>\n<body>${body}${script}\n</body>\n</html>\n`;
writeFileSync(join(dir, 'unfill.html'), full);
console.log(`dist-single/unfill.html: ${(full.length / 1024).toFixed(0)} KB`);

// The same page without the document wrapper, for a Claude artifact (it adds its own <html>, <head>, charset and
// viewport). The title and the fonts stay at the top.
const keep = head
  .split('\n')
  .filter((l) => !/<meta charset|<meta name="viewport"/.test(l))
  .join('\n');
writeFileSync(join(dir, 'artifact.html'), `${keep.trim()}\n${style}\n${body.trim()}\n${script}\n`);
