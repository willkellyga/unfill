// Shared helpers for the marketing renders: open the real game in headless Chromium, hide its HUD, drive the scene
// clock frame by frame, and lay the title over it. Used by covers.cjs and video.cjs (see README.md).
const { chromium } = require('playwright');

const SAND = ['#e98aa6', '#8cc486', '#a894e0', '#f1c65a', '#7db4e0'];
const INK = '#5a3f33';

async function launch() {
  return chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
}

/**
 * Open the game at a size, with a test tray (no save, no lesson), the Medium quality tier (High hides the bottle's sand: a shadow-sampler GL error, see README), the clock frozen, and
 * optionally the HUD hidden. `layout`: 'wide' or 'tall' forces the bottle's place whatever the window's shape.
 */
async function openGame(browser, { base, w, h, dsf = 1, tray, seed, hud = false, layout, tier = 'medium' }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  page.on('pageerror', (e) => console.error('page error:', String(e)));
  // frames are drawn only when asked (at()): a software-rendered frame takes about a second, and a game loop drawing
  // on its own would make every screenshot wait for several more
  await page.addInitScript(() => {
    let queue = [];
    window.requestAnimationFrame = (cb) => {
      queue.push(cb);
      return queue.length;
    };
    window.__step = () => {
      const q = queue;
      queue = [];
      const ts = performance.now();
      for (const cb of q) cb(ts);
    };
  });
  await page.goto(`${base}/?nosave&tray=${tray}&seed=${seed}`);
  await page.waitForFunction(() => window.unfill && document.fonts.status === 'loaded', null, { polling: 100 });
  await page.evaluate((tier) => {
    window.unfill.setTier(tier);
    document.getElementById('intro').hidden = true;
  }, tier);
  await page.addStyleTag({
    content: `.toast,.banner,.fps,.coach,.tapHand,.intro,.upright{display:none!important}
      ${hud ? '' : '.hud,.foot{visibility:hidden!important}'}`,
  });
  if (layout) {
    await page.evaluate((wide) => {
      const s = window.unfill.stage();
      s.T.setWide(wide);
      s.placeBottle();
    }, layout === 'wide');
  }
  // let the first tray finish pouring in, then hold the clock
  await at(page, 30);
  await at(page, 31);
  return page;
}

/** Set the scene clock to t seconds and wait for two frames, so the picture shows that moment. */
async function at(page, t) {
  await page.evaluate((t) => {
    window.unfill.freeze(t);
    window.__step();
  }, t);
}

/** Advance the clock in steps until nothing is moving (pour, flight, fill-in), starting at t. Returns the time. */
async function settle(page, t, step = 0.25) {
  for (let k = 0; k < 80; k++) {
    await at(page, t);
    if (!(await page.evaluate(() => window.unfill.busy()))) return t;
    t += step;
  }
  return t;
}

/** Frame the tray and bottle into a region (CSS px insets), from a turned camera. */
async function frame(page, insets, view) {
  await page.evaluate(
    ({ insets, view }) => {
      const s = window.unfill.stage();
      s.T.frame(insets, view);
    },
    { insets, view },
  );
}

/**
 * The title, as SVG laid over the page: Fredoka (the game's display face), a thick brown outline, and either
 * hand-poured sand stripes (wavy bands in the five sands) or plain cream letters.
 */
function titleSvg({ style, width }) {
  const h = Math.round(width * 0.36);
  const bands = [SAND[1], SAND[0], SAND[2], SAND[3], SAND[1], SAND[0], SAND[2], SAND[3]];
  const bandH = h / 5.2;
  let paths = '';
  bands.forEach((c, i) => {
    const y = -bandH + i * bandH;
    const amp = bandH * 0.18;
    let d = `M0 ${y + bandH * 2}`;
    for (let x = 0; x <= width; x += width / 40) {
      d += ` L${x.toFixed(1)} ${(y + Math.sin(x / (width / 7) + i * 1.7) * amp + Math.sin(x / (width / 17) + i) * amp * 0.4).toFixed(1)}`;
    }
    d += ` L${width} ${y + bandH * 2} Z`;
    paths += `<path d="${d}" fill="${c}"/>`;
  });
  const fill = style === 'sand' ? 'url(#sandFill)' : '#fff8f0';
  const fs = h * 0.98;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" style="overflow:visible">
    <defs>
      <pattern id="sandFill" patternUnits="userSpaceOnUse" x="0" y="${h * 0.06}" width="${width}" height="${h}">${paths}</pattern>
      <filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="${h * 0.045}" stdDeviation="${h * 0.035}" flood-color="#5a3f33" flood-opacity="0.35"/></filter>
    </defs>
    <g filter="url(#lift)" font-family="Fredoka" font-weight="600" font-size="${fs}" text-anchor="middle" letter-spacing="${-fs * 0.01}">
      <text x="${width / 2}" y="${h * 0.8}" fill="none" stroke="#fff8f0" stroke-width="${fs * 0.2}" stroke-linejoin="round">Unfill</text>
      <text x="${width / 2}" y="${h * 0.8}" fill="${fill}" stroke="${INK}" stroke-width="${fs * 0.1}" stroke-linejoin="round" paint-order="stroke">Unfill</text>
    </g>
  </svg>`;
}

/** Put the title on the page at x, y (CSS px, its top-left), `width` wide; opacity for fades. */
async function placeTitle(page, { style, x, y, width, opacity = 1 }) {
  const svg = titleSvg({ style, width });
  await page.evaluate(
    ({ svg, x, y, opacity }) => {
      let el = document.getElementById('mkTitle');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mkTitle';
        el.style.cssText = 'position:fixed;z-index:50;pointer-events:none';
        document.body.appendChild(el);
      }
      el.innerHTML = svg;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = String(opacity);
    },
    { svg, x, y, opacity },
  );
}

async function setTitleOpacity(page, opacity) {
  await page.evaluate((o) => {
    const el = document.getElementById('mkTitle');
    if (el) el.style.opacity = String(o);
  }, opacity);
}

module.exports = { launch, openGame, at, settle, frame, placeTitle, setTitleOpacity, titleSvg, SAND };
