// The playtest upload, end to end: the built game in headless Chromium sends its rows to collector/Code.gs (run by
// scripts/collector-fake.cjs against an in-memory Sheet). Plays a few levels, closes the app mid-level, goes
// offline, has a send fail, and runs out of moves, then checks every level reached the Sheet exactly once with its
// timings. Writes the Plays tab to OUT (default playtest-sample.csv) for `npm run tuning:playtest`.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/playtest-check.cjs
const { writeFileSync } = require('node:fs');
const { chromium } = require('playwright');
const { load, serve, toCsv } = require('./collector-fake.cjs');

const BASE = process.env.URL || 'http://localhost:4173/';
const OUT = process.env.OUT || 'playtest-sample.csv';

(async () => {
  const gs = load();
  const srv = await serve(gs);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fail = (msg) => {
    throw new Error(msg);
  };
  const u = (fn, arg) => page.evaluate(fn, arg);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => {
    await u(() => window.unfill.fastForward());
    await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  };
  const rows = () => {
    const t = gs.sheet('Plays') || [];
    return t.slice(1).map((r) => Object.fromEntries(t[0].map((h, i) => [h, r[i]])));
  };
  const levels = () => rows().filter((r) => r.type === 'level');
  const waitFor = async (what, ok, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (ok()) return;
      await sleep(100);
    }
    fail(`timed out waiting for ${what}; the Sheet has ${rows().length} rows`);
  };
  const tap = async (cell) => {
    const p = await u((c) => window.unfill.cellScreen(c), cell);
    await page.mouse.click(p.x, p.y);
  };
  /** Play the stored solution, a little thinking time per lift; `stopAfter` leaves the level part way. */
  const playLevel = async (stopAfter = Infinity) => {
    const lv = await u(() => window.unfill.level());
    for (let k = 0; k < stopAfter; k++) {
      const sol = await u(() => window.unfill.solution());
      if (!sol.length) break;
      await sleep(250);
      await tap(sol[0]);
      await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
      if (await u(() => window.unfill.board().cells.every((v) => v < 0))) {
        await page.waitForFunction((n) => window.unfill.level() === n + 1, lv, { timeout: 20000 });
        await settle();
        return;
      }
    }
  };
  const open = async () => {
    await page.waitForFunction(() => window.unfill);
    await page.click('#startBtn');
    await settle();
  };

  const url = `${BASE}?collector=${encodeURIComponent(`http://localhost:${srv.port}/exec`)}&tester=${encodeURIComponent('Test Bot')}`;
  await page.goto(url);
  await u(() => localStorage.clear());
  await page.goto(url);
  await open();

  // 1. two levels, online
  await playLevel();
  await playLevel();
  await waitFor('two levels', () => levels().length === 2);
  const opens = rows().filter((r) => r.type === 'open');
  if (opens.length !== 1 || opens[0].n !== 1) fail('the app open was not logged');
  for (const r of levels()) {
    if (r.name !== 'Test Bot' || r.outcome !== 'clear' || !r.board) fail(`bad row ${JSON.stringify(r)}`);
    const think = JSON.parse(r.think);
    if (think.length !== r.lifts || JSON.parse(r.pour).length !== r.lifts - 1) fail('timings missing');
    if (think.some((t) => t < 200)) fail(`thinking times too short: ${think}`);
    if (JSON.parse(r.taps).length !== r.lifts) fail('taps missing');
  }
  console.log(`2 levels sent: ${levels().map((r) => `level ${r.n} ${r.board} ${r.lifts} lifts (par ${r.par})`).join(', ')}`);

  // 2. close the app mid-level, reopen, go offline, finish it: the row waits, then goes when back online
  await playLevel(2);
  await page.reload();
  await open();
  await context.setOffline(true);
  await playLevel();
  await sleep(500);
  const waiting = await u(() => JSON.parse(localStorage.getItem('unfill-outbox') || '[]').length);
  if (waiting < 1 || levels().length !== 2) fail(`offline: ${waiting} waiting, ${levels().length} in the Sheet`);
  console.log(`offline: ${waiting} rows waiting on the phone`);
  await context.setOffline(false);
  await waitFor('the offline level', () => levels().length === 3);
  const third = levels()[2];
  if (third.resumes !== 1 || JSON.parse(third.think).length !== third.lifts) fail(`resumed level lost timings: ${JSON.stringify(third)}`);
  console.log(`back online: level ${third.n} arrived (picked up again once, ${third.lifts} lifts, all timed)`);

  // 3. a send that fails on the network is kept and sent on the next try
  srv.state.failNext = 1;
  await playLevel();
  await sleep(800);
  if (levels().length !== 3) fail('a failed send reached the Sheet?');
  await u(() => window.dispatchEvent(new Event('online')));
  await waitFor('the retried level', () => levels().length === 4);
  console.log('a failed send was kept and went on the retry');

  // 4. run out of moves: tap the biggest mess until the run ends
  let guard = 0;
  while (!(await u(() => window.unfill.over())) && guard++ < 400) {
    const b = await u(() => window.unfill.board());
    if (b.cells.every((v) => v < 0)) {
      await settle();
      continue;
    }
    const filled = b.cells.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
    await tap(filled[(guard * 7) % filled.length]);
    await settle();
  }
  await waitFor('the last level', () => levels().some((r) => r.outcome === 'out'));
  const last = levels().at(-1);
  if (last.outcome !== 'out' || last.movesLeft !== 0) fail(`run end row: ${JSON.stringify(last)}`);
  console.log(`run over on level ${last.n}: logged as "out" with ${last.lifts} lifts`);

  // 5. every row once, ids unique, Settings shows it's all sent
  const ids = rows().map((r) => r.id);
  if (new Set(ids).size !== ids.length) fail('a row was written twice');
  const lv = levels().map((r) => r.n);
  if (lv.some((n, i) => n !== i + 1)) fail(`levels out of order: ${lv}`);
  await page.click('#againBtn');
  await settle();
  await page.click('#gear').catch(() => page.click('#more > summary'));
  await page.waitForFunction(() => document.querySelector('#more').open);
  await sleep(200); // the panel fills in on its toggle event
  const status = await page.$eval('#playtestStatus', (e) => e.textContent);
  const name = await page.$eval('#testerName', (e) => e.value);
  if (!/all up to date/.test(status) || name !== 'Test Bot') fail(`settings show "${status}" for "${name}"`);
  console.log(`Settings: "${status}" for ${name}`);
  if (errors.length) fail(`page errors: ${errors.join('; ')}`);

  writeFileSync(OUT, toCsv(gs.sheet('Plays')));
  console.log(`OK: ${rows().length} rows (${levels().length} levels) in ${srv.state.requests} requests; Plays tab written to ${OUT}`);
  await browser.close();
  srv.close();
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
