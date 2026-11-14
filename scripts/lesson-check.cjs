// The lesson check: a new player's first Begin runs the two-tray lesson, then level 1 of a fresh run. Guided steps
// ignore taps on the wrong sand; lesson 2 restarts when the moves run out; nothing from the lesson is scored,
// shelved or saved. Then it replays the lesson from Settings mid-run and checks the run comes back as it was, and
// that Skip works and the lesson doesn't come back on reload.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/lesson-check.cjs
// (`?lesson` turns the lesson on for this scripted browser; normal test links skip it.)
const { chromium, devices } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const fail = (msg) => {
  throw new Error(msg);
};
const ok = (msg) => console.log(`ok  ${msg}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const L = () => page.evaluate(() => window.unfill.lesson());
  const idle = () => page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 15000 });
  const tapCell = async (c) => {
    const p = await page.evaluate((c) => window.unfill.cellScreen(c), c);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    await idle();
  };
  /** The cell of the smallest group on the board (a clumsy player's lift). */
  const smallest = () =>
    page.evaluate(() => {
      const bd = window.unfill.board();
      const seen = new Set();
      let best = -1;
      let size = Infinity;
      for (let i = 0; i < bd.cells.length; i++) {
        if (bd.cells[i] < 0 || seen.has(i)) continue;
        const stack = [i];
        let n = 0;
        seen.add(i);
        while (stack.length) {
          const j = stack.pop();
          n++;
          const c = j % bd.cols;
          const r = (j / bd.cols) | 0;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const cc = c + dc;
            const rr = r + dr;
            if (cc < 0 || cc >= bd.cols || rr < 0 || rr >= bd.rows) continue;
            const q = rr * bd.cols + cc;
            if (!seen.has(q) && bd.cells[q] === bd.cells[i]) {
              seen.add(q);
              stack.push(q);
            }
          }
        }
        if (n < size) {
          size = n;
          best = i;
        }
      }
      return best;
    });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(new globalThis.URL('?lesson', URL).href);
  await page.waitForFunction(() => window.unfill);
  if ((await page.textContent('#startBtn')) !== 'Begin') fail('first play should say Begin');
  await page.click('#startBtn');
  await idle();
  let l = await L();
  if (!l || l.n !== 1) fail('Begin did not start the lesson');
  ok('Begin starts lesson 1');

  // a tap on sand that isn't the pointed-at group does nothing
  const board = await page.evaluate(() => window.unfill.board());
  const wrong = board.cells.findIndex((v, i) => v >= 0 && !l.target.includes(i));
  await tapCell(wrong);
  if ((await page.evaluate(() => window.unfill.taps())).length !== 0) fail('a wrong tap lifted sand in a guided step');
  if (!(await page.isVisible('#tapHand'))) fail('no finger on the sand to lift');
  ok('guided step ignores the wrong sand and shows the finger');

  for (let k = 0; k < 3; k++) {
    l = await L();
    await tapCell(l.target[l.target.length - 1]);
  }
  await page.waitForFunction(() => window.unfill.lesson() && window.unfill.lesson().n === 2, null, { timeout: 15000 });
  await idle();
  ok('lesson 1 guided to the end, lesson 2 poured in');

  // lesson 2, clumsily: over par and low on moves, the bubble says so; it still clears, and the run-over card never shows
  const said = new Set();
  for (let k = 0; k < 12; k++) {
    if (await page.evaluate(() => window.unfill.advancing())) break;
    await tapCell(await smallest());
    const c = (await L())?.coach ?? '';
    if (/over par/i.test(c)) said.add('over');
    if (/moves? left/.test(c)) said.add('low');
  }
  if (!(await page.evaluate(() => window.unfill.advancing()))) fail('a clumsy lesson 2 did not clear');
  if (!said.has('over') || !said.has('low')) fail(`the bubble didn't explain going over par and running low: ${[...said]}`);
  if (await page.isVisible('#over')) fail('the run-over card showed in the lesson');
  ok('a clumsy lesson 2 hears about par and running low, and still clears');

  // the lesson again from its start, from Settings, played well this time
  await page.waitForFunction(() => window.unfill.lesson() && window.unfill.lesson().done, null, { timeout: 15000 });
  await page.click('#lessonGo');
  await idle();
  await page.evaluate(() => localStorage.setItem('unfill-lesson-done', ''));
  await page.evaluate(() => window.unfill.startLesson());
  await idle();
  for (let k = 0; k < 3; k++) {
    l = await L();
    await tapCell(l.target[0]);
  }
  await page.waitForFunction(() => window.unfill.lesson() && window.unfill.lesson().n === 2, null, { timeout: 15000 });
  await idle();
  for (const c of await page.evaluate(() => window.unfill.solution())) await tapCell(c);
  await page.waitForFunction(() => window.unfill.lesson() && window.unfill.lesson().done, null, { timeout: 15000 });
  await page.click('#lessonGo');
  await idle();
  const s = await page.evaluate(() => ({
    lesson: window.unfill.lesson(),
    level: window.unfill.level(),
    shelf: window.unfill.shelf(),
    score: window.unfill.score(),
    best: window.unfill.best(),
    done: localStorage.getItem('unfill-lesson-done'),
    shelfSaved: localStorage.getItem('unfill-shelf'),
  }));
  if (s.lesson || s.level !== 1 || s.shelf !== 0 || s.score !== 0 || s.best !== 0) fail(`after the lesson: ${JSON.stringify(s)}`);
  if (s.done !== '1') fail('lesson not marked done');
  if (s.shelfSaved && JSON.parse(s.shelfSaved).length) fail('lesson bottles were saved to the shelf');
  ok('lesson done: level 1 of a fresh run, nothing scored or shelved');

  // a couple of real moves, then the lesson again from Settings
  const sol = await page.evaluate(() => window.unfill.solution());
  await tapCell(sol[0]);
  await tapCell(sol[1]);
  const before = await page.evaluate(() => ({ taps: window.unfill.taps(), moves: window.unfill.moves(), save: window.unfill.save() }));
  await page.click('#gear');
  await page.click('#replayLesson');
  await idle();
  if (!(await L())) fail('Play the lesson did not start it');
  if ((await page.evaluate(() => window.unfill.save())) !== before.save) fail('the lesson touched the run save');
  await page.click('#coachSkip');
  await idle();
  const after = await page.evaluate(() => ({ taps: window.unfill.taps(), moves: window.unfill.moves(), save: window.unfill.save() }));
  if (JSON.stringify(after) !== JSON.stringify(before)) fail('the run did not come back as it was');
  ok('replay from Settings, then Skip: the run is just as it was');

  // a plain address now (no ?lesson): the lesson doesn't come back
  await page.goto(URL);
  await page.waitForFunction(() => window.unfill);
  await page.click('#startBtn');
  await idle();
  if (await L()) fail('the lesson came back after it was done');
  ok('done stays done');

  if (errors.length) fail(`page errors: ${errors.join('; ')}`);
  ok('no page errors');
  await browser.close();
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
