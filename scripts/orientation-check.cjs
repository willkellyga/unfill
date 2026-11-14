// The orientation check: on a phone, turning it sideways shows the "turn your phone upright" card and taps don't reach
// the tray; turning it back frames the tray exactly as a fresh portrait load does, so taps land on the right blocks.
// It runs twice: once normally, and once with every resize event swallowed, the way iPhone sometimes fires them before
// a rotation has settled (the camera must still follow the screen). Also checks the zoom guards and that a tablet or
// computer can still play sideways.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/orientation-check.cjs
// SHOTS=dir saves screenshots of portrait, sideways and back to portrait.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.URL || 'http://localhost:4173/';
const SHOTS = process.env.SHOTS;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

const fail = (msg) => {
  throw new Error(msg);
};
const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

async function phone(browser, { swallowResize }) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: PORTRAIT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  if (swallowResize) {
    await page.addInitScript(() => {
      window.addEventListener('resize', (e) => e.stopImmediatePropagation(), true);
      // visualViewport resize and orientation events too: only the per-frame check is left
      const vv = window.visualViewport;
      if (vv) vv.addEventListener = () => {};
      window.addEventListener('orientationchange', (e) => e.stopImmediatePropagation(), true);
      if (screen.orientation) screen.orientation.addEventListener = () => {};
    });
  }
  await page.goto(URL);
  await page.waitForFunction(() => window.unfill);
  await page.click('#startBtn');
  await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  await page.evaluate(() => window.unfill.freeze(window.unfill.now()));
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

const cells = (page) =>
  page.evaluate(() => {
    const b = window.unfill.board();
    return b.cells.map((v, i) => window.unfill.cellScreen(i));
  });

async function run(browser, swallowResize) {
  const label = swallowResize ? 'resize events swallowed' : 'normal events';
  const { ctx, page, errors } = await phone(browser, { swallowResize });
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${swallowResize ? 'stale-' : ''}${name}.png`) });

  // the reference: where every cell is on a fresh portrait load
  const ref = await cells(page);
  await shot('1-portrait');
  const tapsBefore = (await page.evaluate(() => window.unfill.taps())).length;

  await page.setViewportSize(LANDSCAPE);
  const t0 = Date.now();
  await page.waitForFunction(() => !document.getElementById('upright').hidden, null, { timeout: 5000 }).catch(() => {});
  const tSide = Date.now() - t0;
  if (await page.$eval('#upright', (e) => e.hidden))
    fail(`${label}: no upright card in landscape ${JSON.stringify(await page.evaluate(() => [screen.orientation?.type, screen.width, screen.height, innerWidth]))}`);
  await shot('2-sideways');
  // a tap anywhere sideways (including where a block would be) doesn't lift anything
  await page.touchscreen.tap(LANDSCAPE.width / 2, LANDSCAPE.height / 2);
  await page.touchscreen.tap(200, 250);
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.unfill.taps())).length !== tapsBefore) fail(`${label}: a sideways tap lifted a block`);

  await page.setViewportSize(PORTRAIT);
  const t1 = Date.now();
  await page.waitForFunction(() => document.getElementById('upright').hidden, null, { timeout: 5000 }).catch(() => {});
  const tBack = Date.now() - t1;
  await page.waitForTimeout(300);
  if (!(await page.$eval('#upright', (e) => e.hidden))) fail(`${label}: upright card still up in portrait`);
  const back = await cells(page);
  const off = back.findIndex((p, i) => !near(p, ref[i]));
  if (off >= 0) fail(`${label}: cell ${off} moved from ${JSON.stringify(ref[off])} to ${JSON.stringify(back[off])} after turning back`);
  await shot('3-upright-again');
  const size = await page.evaluate(() => {
    const c = document.getElementById('scene');
    return { css: [c.clientWidth, c.clientHeight], buf: [c.width, c.height] };
  });
  if (size.css[0] !== PORTRAIT.width || size.css[1] !== PORTRAIT.height) fail(`${label}: canvas is ${size.css}`);
  if (Math.abs(size.buf[0] / size.css[0] - size.buf[1] / size.css[1]) > 0.01) fail(`${label}: canvas drawn at ${size.buf} for ${size.css} (stretched)`);

  // a real tap on a block, at its fresh-load spot, lifts that block's group
  const board = await page.evaluate(() => window.unfill.board());
  const pick = board.cells.findIndex((v) => v >= 0);
  await page.touchscreen.tap(ref[pick].x, ref[pick].y);
  await page.waitForTimeout(150);
  const taps = await page.evaluate(() => window.unfill.taps());
  if (taps.length !== tapsBefore + 1 || taps[taps.length - 1] !== pick) fail(`${label}: tap on cell ${pick} lifted ${taps.slice(-1)}`);

  // a few quick turns in a row end in the same place
  await page.evaluate(() => window.unfill.fastForward());
  await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  const ref2 = await cells(page);
  for (let i = 0; i < 4; i++) {
    await page.setViewportSize(i % 2 ? PORTRAIT : LANDSCAPE);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(400);
  const back2 = await cells(page);
  if (back2.some((p, i) => !near(p, ref2[i]))) fail(`${label}: quick turns left the tray framed wrong`);

  if (errors.length) fail(`${label}: page errors: ${errors.join('; ')}`);
  await ctx.close();
  console.log(`ok: phone, ${label} (card up after ${tSide} ms, down after ${tBack} ms)`);
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await run(browser, false);
    await run(browser, true);

    // zoom guards
    const { ctx, page } = await phone(browser, { swallowResize: false });
    const z = await page.evaluate(() => ({
      meta: document.querySelector('meta[name="viewport"]').content,
      touch: getComputedStyle(document.body).touchAction,
      adjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
    }));
    if (!/maximum-scale=1\b/.test(z.meta) || !/user-scalable=no/.test(z.meta)) fail(`viewport tag allows zoom: ${z.meta}`);
    if (!/pan-x pan-y|manipulation/.test(z.touch)) fail(`body touch-action is ${z.touch}`);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture', { x: 195, y: 420, scaleFactor: 2.5, gestureSourceType: 'touch' });
    await page.waitForTimeout(300);
    const scale = await page.evaluate(() => window.visualViewport.scale);
    if (Math.abs(scale - 1) > 0.01) fail(`a pinch zoomed the page to ${scale}`);
    console.log('ok: no pinch zoom, viewport tag and touch-action set');
    await ctx.close();

    // tablets and computers keep landscape
    for (const [name, opts] of [
      ['iPad', { ...devices['iPad (gen 7) landscape'] }],
      ['desktop', { viewport: { width: 1280, height: 800 } }],
    ]) {
      const c = await browser.newContext(opts);
      const p = await c.newPage();
      await p.goto(URL);
      await p.waitForFunction(() => window.unfill);
      if (!(await p.$eval('#upright', (e) => e.hidden))) fail(`${name}: upright card shown in landscape`);
      console.log(`ok: ${name} plays sideways`);
      await c.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
