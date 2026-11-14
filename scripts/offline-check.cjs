// The home-screen app check (milestone 6): loads the built game the way an iPhone would, waits for the service
// worker to cache it, plays a move, then cuts the network and reloads. The game, its fonts and her saved move must all
// come back with no connection, test links (?tray=N) included. Also checks the manifest and icons the install uses.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/offline-check.cjs
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => process.env.DEBUG && console.log('failed', r.url(), r.failure()?.errorText));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const check = (ok, msg) => {
    if (!ok) throw new Error(msg);
    console.log(`ok  ${msg}`);
  };

  // the install pieces
  const manifest = await (await ctx.request.get(new globalThis.URL('manifest.webmanifest', URL).href)).json();
  check(manifest.display === 'standalone' && manifest.start_url === './', 'manifest: standalone, starts at the game');
  for (const icon of manifest.icons) {
    const r = await ctx.request.get(new globalThis.URL(icon.src, URL).href);
    check(r.ok(), `icon ${icon.src} (${icon.sizes}${icon.purpose ? ', ' + icon.purpose : ''})`);
  }

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.unfill);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller || false, null, { timeout: 10000 }).catch(() => page.reload());
  await page.waitForFunction(() => window.unfill && navigator.serviceWorker.controller);
  check(true, 'service worker installed and controlling the page');
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('unfill-')));
    return (await c.keys()).length;
  });
  check(cached >= 10, `${cached} files cached for offline play`);
  // one move, then go offline and come back
  await page.click('#startBtn');
  await page.click('#gear');
  const note = await page.textContent('#installNote');
  check(/Add to Home Screen/.test(note), `iPhone install steps shown: "${note.slice(0, 60)}…"`);
  await page.click('#gear');

  const sol = await page.evaluate(() => window.unfill.solution());
  const p = await page.evaluate((c) => window.unfill.cellScreen(c), sol[0]);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  const taps = await page.evaluate(() => window.unfill.taps());
  check(taps.length === 1, 'played a move');

  await ctx.setOffline(true);
  check(!(await page.evaluate(() => fetch('https://example.com/').then(() => true, () => false))), 'network is off');
  await page.reload();
  await page.waitForFunction(() => window.unfill, null, { timeout: 15000 }).catch(async (e) => {
    console.log('DEBUG', errors, (await page.content()).slice(0, 400));
    throw e;
  });
  check(true, 'game reloads with no connection');
  const back = await page.evaluate(() => window.unfill.taps());
  check(JSON.stringify(back) === JSON.stringify(taps), 'her move is still there');
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return ['600 20px Fredoka', '800 20px Nunito'].map((f) => document.fonts.check(f));
  });
  check(fonts.every(Boolean), 'Fredoka and Nunito load offline');
  await page.click('#startBtn');
  const sol2 = await page.evaluate(() => window.unfill.solution());
  const p2 = await page.evaluate((c) => window.unfill.cellScreen(c), sol2[0]);
  await page.mouse.click(p2.x, p2.y);
  await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  check((await page.evaluate(() => window.unfill.taps())).length === 2, 'plays offline');

  await page.goto(new globalThis.URL('?tray=12', URL).href);
  await page.waitForFunction(() => window.unfill, null, { timeout: 15000 });
  check((await page.evaluate(() => window.unfill.level())) === 12, 'test links work offline too');

  const real = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e));
  check(real.length === 0, `no page errors${real.length ? ': ' + real.join(' | ') : ''}`);
  await browser.close();
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
