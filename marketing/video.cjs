// Renders a CrazyGames preview video (no sound, 15-20 s) from the real game, frame by frame on the frozen scene clock
// so nothing is sped up: the cover holds for a beat, cross-fades into play, the tray is cleared lift by lift, the
// bottle corks and slides away, and the next tray pours in. Taps show as a soft ring (no mouse cursor).
// Usage: node marketing/video.cjs landscape|portrait [base url] [out dir] (needs the cover from covers.cjs in out dir)
const { launch, openGame, at } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const kind = process.argv[2] || 'landscape';
const base = process.argv[3] || 'http://localhost:4174';
const out = process.argv[4] || path.join(__dirname, 'out');
const FPS = 30;
const SIZES = { landscape: { w: 1920, h: 1080, layout: 'wide' }, portrait: { w: 1080, h: 1620, layout: 'tall' } };
const S = SIZES[kind];
// the same tray as the covers, from full: the first lifts on camera, a cut past the middle of the level (a tray
// half empty is the dullest part to watch), then the last lifts, the cork, and the next tray pouring in
const TRAY = { tray: 45, seed: 7 };
const FIRST = 5;
const LAST = 2;
const THINK = 0.55; // seconds between a lift settling and the next tap
const COVER_HOLD = 1.0;
const FADE = 0.5;
const LENGTH = 18.5;

(async () => {
  const dir = path.join(out, `frames-${kind}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const page = await openGame(browser, { base, w: S.w, h: S.h, ...TRAY, hud: true, layout: S.layout });
  // the HUD's own pop-ups run on the real clock, which a frame-by-frame render can't follow
  await page.addStyleTag({
    content: `.banner,.toast{display:none!important}
      #mkRing{position:fixed;z-index:40;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;
        border:5px solid rgba(255,248,240,.95);box-shadow:0 0 0 2px rgba(90,63,51,.25),0 6px 18px rgba(90,63,51,.3);
        pointer-events:none;opacity:0}`,
  });
  await page.evaluate(() => {
    const r = document.createElement('div');
    r.id = 'mkRing';
    document.body.appendChild(r);
  });
  const busy = () => page.evaluate(() => window.unfill.busy() || window.unfill.advancing());

  let t = 32;
  await at(page, t);
  await page.evaluate(() => window.unfill.stage().layout());

  // on camera: one frame every 1/30 s of scene time
  const playFrames = Math.round((LENGTH - COVER_HOLD) * FPS);
  let frame = 0;
  let nextTap = t + 0.6;
  let tap = null;
  let lifts = 0;
  let cut = false;
  let t0 = t;
  for (; frame < playFrames; frame++) {
    t = t0 + frame / FPS;
    // the cut: once the opening lifts have settled, lift off camera until LAST lifts are left
    if (!cut && lifts >= FIRST && nextTap !== Infinity && !(await busy())) {
      cut = true;
      for (;;) {
        const rest = await page.evaluate(() => window.unfill.solution());
        if (rest.length <= LAST) break;
        await page.evaluate((c) => window.unfill.tap(c), rest[0]);
        t += 3;
        await at(page, t);
      }
      t += 0.5;
      t0 = t - frame / FPS;
      nextTap = t + 0.3;
      tap = null;
    }
    if (t >= nextTap && nextTap !== Infinity) {
      const cells = await page.evaluate(() => window.unfill.solution());
      if (cells.length && !(await busy())) {
        const pos = await page.evaluate((c) => window.unfill.cellScreen(c), cells[0]);
        await page.evaluate((c) => window.unfill.tap(c), cells[0]);
        tap = { t, ...pos };
        lifts++;
        nextTap = Infinity;
      }
    }
    await at(page, t);
    if (nextTap === Infinity && !(await busy())) nextTap = t + THINK;
    // the tap ring: grows and fades over 0.45 s
    await page.evaluate(
      ({ tap, t }) => {
        const r = document.getElementById('mkRing');
        const k = tap ? (t - tap.t) / 0.45 : 1;
        if (!tap || k >= 1) {
          r.style.opacity = '0';
          return;
        }
        r.style.left = `${tap.x}px`;
        r.style.top = `${tap.y}px`;
        r.style.opacity = String(0.95 * (1 - k));
        r.style.transform = `scale(${0.55 + 0.75 * k})`;
      },
      { tap, t },
    );
    await page.screenshot({ path: path.join(dir, `f${String(frame).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 95, timeout: 180000 });
    if (frame % 30 === 0) console.log(`${kind}: ${frame}/${playFrames} frames, level ${await page.evaluate(() => window.unfill.level())}`);
  }
  await browser.close();

  // the cover holds, then cross-fades into play
  const cover = path.join(out, kind === 'portrait' ? 'unfill-cover-portrait-1080.png' : `unfill-cover-${kind}.png`);
  const file = path.join(out, `unfill-preview-${kind}-${S.w}x${S.h}.mp4`);
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-loop', '1', '-framerate', String(FPS), '-t', String(COVER_HOLD + FADE), '-i', cover,
    '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.jpg'),
    '-filter_complex',
    `[0:v]scale=${S.w}:${S.h},format=yuv420p,setsar=1[a];[1:v]format=yuv420p,setsar=1[b];[a][b]xfade=transition=fade:duration=${FADE}:offset=${COVER_HOLD}[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    file,
  ]);
  console.log(file);
})();
