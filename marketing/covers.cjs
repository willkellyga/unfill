// Renders the three CrazyGames covers (1920x1080, 800x1200, 800x800) from the real game: a turned camera on a full
// tray with one group lifting out toward a bottle already layered with sand, and the sand-stripe title.
// Keeps the title clear of CrazyGames' label corner (top-left: 40%x20% landscape, 40%x10% portrait, 35%x30% square,
// where "New" / "Hot" badges go). Usage: node marketing/covers.cjs [base url] [out dir]
const { launch, openGame, at, settle, frame, placeTitle } = require('./lib.cjs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const base = process.argv[2] || 'http://localhost:4174';
const out = process.argv[3] || path.join(__dirname, 'out');
const only = process.argv[4];
fs.mkdirSync(out, { recursive: true });

// one tray for every cover, so they match
const TRAY = { tray: 45, seed: 7 };

const COVERS = {
  landscape: {
    w: 1920, h: 1080, dsf: 1, layout: 'wide',
    insets: { top: 90, bottom: -30, left: 40, right: 560, side: 0 },
    view: { yawDeg: -16, pitchDeg: 12 },
    bottle: { scale: 2.1, dx: 2.6, dz: 0.9 },
    liftAt: [0.15, 0.3, 0.45, 0.52],
    title: { x: 1080, y: 70, width: 760 },
  },
  portrait: {
    w: 800, h: 1200, dsf: 2, layout: 'wide',
    insets: { top: 390, bottom: 30, left: 10, right: 50, side: 0 },
    view: { yawDeg: -16, pitchDeg: 12 },
    bottle: { scale: 1.8, dx: -1.4, dz: 1.7 },
    liftAt: [0.15, 0.3, 0.45, 0.52],
    title: { x: 90, y: 140, width: 620 },
  },
  // the portrait video's first frame: the portrait cover's layout at the video's 1080x1620
  'portrait-1080': {
    w: 1080, h: 1620, dsf: 1, layout: 'wide',
    insets: { top: 527, bottom: 40, left: 14, right: 68, side: 0 },
    view: { yawDeg: -16, pitchDeg: 12 },
    bottle: { scale: 1.8, dx: -1.4, dz: 1.7 },
    liftAt: [0.15, 0.3, 0.45, 0.52],
    title: { x: 122, y: 189, width: 837 },
  },
  square: {
    w: 800, h: 800, dsf: 2, layout: 'wide',
    insets: { top: 196, bottom: -10, left: -30, right: 60, side: 0 },
    view: { yawDeg: -16, pitchDeg: 12 },
    bottle: { scale: 2.1, dx: 0.5, dz: 0.9 },
    liftAt: [0.15, 0.3, 0.45, 0.52],
    title: { x: 300, y: 36, width: 470 },
  },
};

(async () => {
  const browser = await launch();
  for (const [name, c] of Object.entries(COVERS)) {
    if (only && only !== name) continue;
    const page = await openGame(browser, { base, w: c.w, h: c.h, dsf: c.dsf, ...TRAY, layout: c.layout });
    // the bottle, shown bigger and nearer the camera than in play, already holds hand-poured layers
    await page.evaluate((b) => {
      const { bottle, T } = window.unfill.stage();
      if (b) {
        bottle.setScale(b.scale);
        bottle.home.set(bottle.home.x + b.dx, bottle.home.y, bottle.home.z + b.dz);
        bottle.group.position.copy(bottle.home);
      }
      const sand = ['#8cc486', '#e98aa6', '#a894e0', '#f1c65a', '#8cc486', '#e98aa6', '#f1c65a', '#a894e0'];
      const C = bottle.group.children[0].material.color.constructor;
      sand.forEach((h, i) => bottle.addLayer(new C(h), [0.1, 0.08, 0.09, 0.07, 0.08, 0.06, 0.09, 0.07][i], 1, 2));
      bottle.settleAll();
    }, c.bottle);
    let t = await settle(page, 32);
    await frame(page, c.insets, c.view);
    // lift a big group with plenty of sand above it, and catch it in the air while the sand above pours down
    const cell = await page.evaluate(() => {
      const { cols, rows, cells } = window.unfill.board();
      const seen = new Array(cells.length).fill(false);
      let best = { size: 0, cell: 0 };
      for (let i = 0; i < cells.length; i++) {
        if (seen[i] || cells[i] < 0) continue;
        const stack = [i];
        seen[i] = true;
        let size = 0;
        let above = 0;
        while (stack.length) {
          const j = stack.pop();
          size++;
          // sand stacked over this block pours down when the group lifts: more streams of grains on the cover
          for (let rr = ((j / cols) | 0) - 1; rr >= 0; rr--) if (cells[rr * cols + (j % cols)] >= 0) above++;
          const r = (j / cols) | 0;
          const c = j % cols;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r + dr;
            const cc = c + dc;
            const k = rr * cols + cc;
            if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || seen[k] || cells[k] !== cells[i]) continue;
            seen[k] = true;
            stack.push(k);
          }
        }
        const score = size * 3 + above;
        if (score > best.size) best = { size: score, cell: i };
      }
      return best.cell;
    });
    await page.evaluate((cell) => window.unfill.tap(cell), cell);
    for (const dt of c.liftAt) await at(page, t + dt);
    await placeTitle(page, { style: 'sand', ...c.title });
    const file = path.join(out, `unfill-cover-${name}.png`);
    await page.screenshot({ path: file, timeout: 180000 });
    // the 800 px covers are drawn at 2x, then scaled down for smooth edges
    if (c.dsf !== 1)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `scale=${c.w}:${c.h}:flags=lanczos`, file + '.tmp.png']);
    if (c.dsf !== 1) fs.renameSync(file + '.tmp.png', file);
    console.log(file);
    await page.close();
  }
  await browser.close();
})();
