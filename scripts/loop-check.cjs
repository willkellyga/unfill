// The game-loop check (plan milestone 5: "30 boards in a row play without a bug"). Plays the built game in
// headless Chromium through real taps on the canvas until N trays have been cleared: mostly the stored
// solution's next move, sometimes a random group, with the shelf and page reloads mid-board to check save and
// resume. When a run ends (out of moves), it checks the final score and the high score, then plays again.
// Fails on any page error or broken invariant.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/loop-check.cjs [trays] [seed]
const { chromium } = require('playwright');

const TRAYS = Number(process.argv[2] || 30);
let seed = Number(process.argv[3] || 1);
const rand = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return ((seed >>> 8) & 0xffff) % n;
};
const URL = process.env.URL || 'http://localhost:4173/';
const pointsFor = (lifts, par) => {
  const d = lifts - par;
  const f = d <= 0 ? 1 - 0.5 * d : Math.pow(0.75, d);
  return Math.max(5, Math.round((20 * par * f) / 5) * 5);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const stats = { cleared: 0, taps: 0, solutionTaps: 0, randomTaps: 0, reloads: 0, shelf: 0, runs: 1, best: 0 };
  const fail = (msg) => {
    throw new Error(`after ${stats.cleared} trays: ${msg}`);
  };
  const u = (fn, arg) => page.evaluate(fn, arg);
  const settle = async () => {
    // a tap during a pour fast-forwards it, as in the game
    await u(() => window.unfill.fastForward());
    await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  };
  const tapCell = async (cell) => {
    const p = await u((c) => window.unfill.cellScreen(c), cell);
    await page.mouse.click(p.x, p.y);
  };
  const state = () =>
    u(() => ({
      level: window.unfill.level(),
      moves: window.unfill.moves(),
      taps: window.unfill.taps(),
      par: window.unfill.par(),
      board: window.unfill.board(),
      shelf: window.unfill.shelf(),
      score: window.unfill.score(),
      best: window.unfill.best(),
      over: window.unfill.over(),
    }));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.unfill);
  await page.click('#startBtn');
  await settle();
  const start = await state();
  if (start.level !== 1 || start.shelf !== 0 || start.score !== 0) fail('did not start at level 1 with nothing scored');
  if (await page.$('#undo, #restart, #hintBtn')) fail('undo, restart or hint is still on screen');
  let reloadedThisLevel = false;
  let runScore = 0;

  while (stats.cleared < TRAYS) {
    const s = await state();
    if (s.moves < 0) fail('negative moves');
    if (s.score !== runScore) fail(`score ${s.score}, expected ${runScore}`);
    const shown = await page.$eval('#used', (e) => Number(e.textContent));
    if (shown !== s.taps.length) fail(`moves made shows ${shown}, expected ${s.taps.length}`);
    if (s.over) {
      await page.waitForFunction(() => window.unfill.overShown(), null, { timeout: 15000 });
      const text = await page.$eval('#overText', (e) => e.textContent);
      if (!text.includes(s.score.toLocaleString('en-US'))) fail(`game-over card says "${text}"`);
      if (s.best < s.score) fail('best is below the run score');
      stats.best = s.best;
      await page.click('#againBtn');
      await settle();
      const t = await state();
      if (t.level !== 1 || t.score !== 0 || t.best !== s.best || t.shelf !== s.shelf) fail('play again did not start a fresh run');
      runScore = 0;
      stats.runs++;
      reloadedThisLevel = false;
      continue;
    }
    const roll = rand(100);
    if (roll < 4 && s.taps.length && !reloadedThisLevel) {
      await page.reload();
      await page.waitForFunction(() => window.unfill);
      const t = await state();
      if (t.level !== s.level || JSON.stringify(t.taps) !== JSON.stringify(s.taps) || t.moves !== s.moves) fail('resume lost the game');
      if (JSON.stringify(t.board.cells) !== JSON.stringify(s.board.cells)) fail('resume changed the board');
      if (t.shelf !== s.shelf || t.score !== s.score || t.best !== s.best) fail('resume changed the shelf or the score');
      await page.click('#startBtn');
      await settle();
      reloadedThisLevel = true;
      stats.reloads++;
      continue;
    }
    if (roll < 6) {
      await page.click('#shelfBtn');
      const n = await page.$$eval('#shelfGrid .keep', (els) => els.length);
      if (n !== s.shelf) fail(`shelf shows ${n} bottles, expected ${s.shelf}`);
      if (n) await page.click('#shelfGrid .keep');
      await page.click('#shelfClose');
      stats.shelf++;
      continue;
    }
    let cell;
    const sol = await u(() => window.unfill.solution());
    if (sol.length && roll >= 30) {
      cell = sol[0];
      stats.solutionTaps++;
    } else {
      const filled = s.board.cells.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
      cell = filled[rand(filled.length)];
      stats.randomTaps++;
    }
    await tapCell(cell);
    stats.taps++;
    const t = await state();
    if (t.taps.length !== s.taps.length + 1) fail(`tap on cell ${cell} did not lift`);
    if (t.moves !== s.moves - 1) fail('a lift did not cost one move');
    await settle();
    if (t.board.cells.every((v) => v < 0)) {
      // cleared: the bottle is corked and the next level pours in by itself, no tap needed
      runScore += pointsFor(t.taps.length, s.par);
      await page.waitForFunction((lv) => window.unfill.level() === lv + 1, s.level, { timeout: 20000 });
      await settle();
      const after = await state();
      if (after.shelf !== s.shelf + 1) fail('the bottle did not reach the shelf');
      if (after.score !== runScore) fail(`score ${after.score} after the clear, expected ${runScore}`);
      if (after.best < after.score) fail('best fell behind the score');
      stats.cleared++;
      reloadedThisLevel = false;
    }
  }
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`cleared ${TRAYS} trays in a row without a bug`);
  console.log(JSON.stringify(stats));
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
