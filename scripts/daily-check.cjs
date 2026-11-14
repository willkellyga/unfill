// The Daily Puzzle check: plays the built game in headless Chromium through real taps.
//   1. a run level part way, then today's Daily: the run must come back exactly as it was;
//   2. the Daily's first try, closed part way (reload), resumed, and cleared in the proven best: a Perfect;
//   3. practice: plays it again and runs out of moves, and the first try's record must not change;
//   4. tomorrow (the clock moved a day): a new tray, and the streak still counts yesterday.
// Fails on any page error or broken invariant.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/daily-check.cjs
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // a movable clock: the Daily turns over at local midnight
  await ctx.addInitScript(() => {
    const R = Date;
    const off = Number(localStorage.getItem('test-clock-offset') || 0);
    class F extends R {
      constructor(...a) {
        if (a.length === 0) super(R.now() + off);
        else super(...a);
      }
      static now() {
        return R.now() + off;
      }
    }
    window.Date = F;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const fail = (msg) => {
    throw new Error(msg);
  };
  const u = (fn, arg) => page.evaluate(fn, arg);
  const settle = async () => {
    await u(() => window.unfill.fastForward());
    await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  };
  const tap = async (cell) => {
    await settle();
    const p = await u((c) => window.unfill.cellScreen(c), cell);
    await page.mouse.click(p.x, p.y);
  };
  const load = async () => {
    await page.waitForFunction(() => window.unfill, null, { timeout: 30000 });
  };

  await page.goto(URL);
  await load();
  await u(() => localStorage.setItem('unfill-home-asked', '1'));
  await page.reload();
  await load();
  await u(() => window.unfill.dismissIntro());

  // 1. two lifts into the run, then the Daily
  for (const c of (await u(() => window.unfill.solution())).slice(0, 2)) await tap(c);
  await settle();
  const runBefore = await u(() => ({ level: window.unfill.level(), moves: window.unfill.moves(), taps: window.unfill.taps() }));
  await u(() => window.unfill.daily.open());
  await page.click('[data-act=play]');
  await settle();
  const d0 = await u(() => window.unfill.daily.state());
  if (!d0.on || d0.practice || d0.lifts !== 0 || d0.allowed < d0.best) fail(`daily did not start: ${JSON.stringify(d0)}`);
  const today = await u(() => window.unfill.daily.today());
  if (d0.n !== today) fail(`daily #${d0.n} is not today's #${today}`);

  // 2. part way, close the app, come back: the first try is as she left it
  const line = await u(() => window.unfill.solution());
  if (line.length !== d0.best) fail(`proven line has ${line.length} taps, best is ${d0.best}`);
  for (const c of line.slice(0, 3)) await tap(c);
  await settle();
  await page.reload();
  await load();
  const d1 = await u(() => window.unfill.daily.state());
  if (!d1.on || d1.lifts !== 3 || d1.practice) fail(`daily not resumed after reload: ${JSON.stringify(d1)}`);
  await u(() => window.unfill.dismissIntro());
  for (const c of (await u(() => window.unfill.solution()))) await tap(c);
  await page.waitForFunction(() => window.unfill.daily.doneShown(), null, { timeout: 20000 });
  const title = await page.textContent('#doneTitle');
  const reveal = await page.textContent('#doneReveal');
  if (title !== 'Perfect!' || !reveal.includes(String(d0.best))) fail(`done card says "${title}" / "${reveal}"`);
  const rec = await u((n) => window.unfill.daily.records()[n], today);
  if (!rec || !rec.cleared || rec.lifts !== d0.best) fail(`first try not recorded: ${JSON.stringify(rec)}`);

  // back to the run, exactly as it was
  await page.click('#doneBack');
  await settle();
  const runAfter = await u(() => ({ level: window.unfill.level(), moves: window.unfill.moves(), taps: window.unfill.taps() }));
  if (JSON.stringify(runAfter) !== JSON.stringify(runBefore)) fail(`run changed: ${JSON.stringify(runBefore)} -> ${JSON.stringify(runAfter)}`);
  if ((await u(() => window.unfill.daily.state())).on) fail('still in the daily');

  // 3. practice: run out of moves; the record stays
  await u(() => window.unfill.daily.open());
  await page.click('[data-act=practice]');
  await settle();
  const p0 = await u(() => window.unfill.daily.state());
  if (!p0.practice) fail('practice did not start');
  for (let i = 0; i < 80; i++) {
    const st = await u(() => window.unfill.daily.state());
    if (st.over || st.cleared) break;
    const b = await u(() => window.unfill.board());
    await tap(b.cells.findIndex((v) => v >= 0));
  }
  await page.waitForFunction(() => window.unfill.daily.doneShown(), null, { timeout: 20000 });
  const rec2 = await u((n) => window.unfill.daily.records()[n], today);
  if (JSON.stringify(rec2) !== JSON.stringify(rec)) fail('practice changed the first try');
  await page.click('#doneBack');
  await settle();

  // 4. tomorrow: a new tray, and yesterday's streak still stands
  await u(() => localStorage.setItem('test-clock-offset', String(86400000)));
  await page.reload();
  await load();
  await u(() => window.unfill.dismissIntro());
  if ((await u(() => window.unfill.daily.today())) !== today + 1) fail('the day did not turn over');
  await u(() => window.unfill.daily.open());
  const streak = await page.textContent('#dailyStats b');
  if (streak !== '1') fail(`streak shows ${streak}, expected 1`);
  if ((await page.$('[data-act=play]')) === null) fail("tomorrow's daily is not offered");

  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  console.log(`Daily check passed: Daily #${today} perfect in ${d0.best} (allowed ${d0.allowed}), resume, practice, run kept, next day.`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
