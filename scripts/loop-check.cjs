// Milestone 5 check (plan: "Done when: 30 boards in a row play without a bug"). Plays the built game in headless
// Chromium through real taps on the canvas, for N levels in a row: mostly following the hint button, sometimes
// a random group, with undos, restarts, the shelf, and a page reload mid-board to check save and resume. Fails on
// any page error or broken invariant.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/loop-check.cjs [levels] [seed]
const { chromium } = require('playwright');

const LEVELS = Number(process.argv[2] || 30);
let seed = Number(process.argv[3] || 1);
const rand = (n) => {
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return ((seed >>> 8) & 0xffff) % n;
};
const URL = process.env.URL || 'http://localhost:4173/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const fail = (msg) => {
    throw new Error(`level ${stats.level}: ${msg}`);
  };
  const stats = { level: 0, taps: 0, hints: 0, randoms: 0, undos: 0, restarts: 0, reloads: 0, shelf: 0, outOfMoves: 0 };

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
    u(() => ({ level: window.unfill.level(), moves: window.unfill.moves(), taps: window.unfill.taps(), board: window.unfill.board(), shelf: window.unfill.shelf() }));

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForFunction(() => window.unfill);
  await page.click('#startBtn');
  await settle();
  let start = await state();
  if (start.level !== 1 || start.shelf !== 0) fail('did not start at level 1 with an empty shelf');
  let reloadedThisLevel = false;

  while ((await u(() => window.unfill.level())) <= LEVELS) {
    const s = await state();
    stats.level = s.level;
    if (s.moves < 0) fail('negative moves');
    const roll = rand(100);
    if (roll < 4 && s.taps.length) {
      await page.click('#undo');
      await settle();
      const t = await state();
      if (t.taps.length !== s.taps.length - 1 || t.moves !== s.moves + 1) fail('undo did not refund a move');
      stats.undos++;
      continue;
    }
    if (roll < 6 && s.taps.length) {
      await page.click('#restart');
      await settle();
      const t = await state();
      if (t.taps.length !== 0) fail('restart left taps');
      stats.restarts++;
      continue;
    }
    if (roll < 9 && s.taps.length && !reloadedThisLevel) {
      await page.reload();
      await page.waitForFunction(() => window.unfill);
      const t = await state();
      if (t.level !== s.level || JSON.stringify(t.taps) !== JSON.stringify(s.taps) || t.moves !== s.moves) fail('resume lost the game');
      if (JSON.stringify(t.board.cells) !== JSON.stringify(s.board.cells)) fail('resume changed the board');
      if (t.shelf !== s.shelf) fail('resume changed the shelf');
      await page.click('#startBtn');
      await settle();
      reloadedThisLevel = true;
      stats.reloads++;
      continue;
    }
    if (roll < 11) {
      await page.click('#shelfBtn');
      const n = await page.$$eval('#shelfGrid .keep', (els) => els.length);
      if (n !== s.shelf) fail(`shelf shows ${n} bottles, expected ${s.shelf}`);
      if (n) await page.click('#shelfGrid .keep');
      await page.click('#shelfClose');
      stats.shelf++;
      continue;
    }
    if (s.moves === 0) {
      stats.outOfMoves++;
      await page.click('#restart');
      await settle();
      continue;
    }
    let cell;
    if (roll < 25) {
      // a random group
      const filled = s.board.cells.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
      cell = filled[rand(filled.length)];
      stats.randoms++;
    } else {
      await page.click('#hintBtn');
      await page.waitForFunction(() => window.unfill.hint() !== null || window.unfill.moves() === 0, null, { timeout: 15000 });
      const h = await u(() => window.unfill.hint());
      cell = h[0];
      stats.hints++;
    }
    await tapCell(cell);
    stats.taps++;
    const t = await state();
    if (t.taps.length !== s.taps.length + 1 && t.level === s.level) fail(`tap on cell ${cell} did not lift`);
    if (t.moves !== s.moves - 1) fail('a lift did not cost one move');
    await settle();
    if (t.board.cells.every((v) => v < 0)) {
      // cleared: the bottle is corked and the next level pours in by itself, no tap needed
      await page.waitForFunction((lv) => window.unfill.level() === lv + 1, s.level, { timeout: 20000 });
      await settle();
      const after = await state();
      if (after.shelf !== s.shelf + 1) fail('the bottle did not reach the shelf');
      if (after.moves < 1) fail('the next level brought no moves');
      reloadedThisLevel = false;
    }
  }
  const end = await state();
  if (end.shelf !== LEVELS) throw new Error(`shelf has ${end.shelf} bottles after ${LEVELS} levels`);
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log(`played ${LEVELS} levels in a row without a bug`);
  console.log(JSON.stringify(stats));
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
