// Performance check for the 3D slice (plan: "a scripted pour on a mid-range phone profile stays at 60 fps on the
// Medium tier"). Runs the built game in headless Chromium with the CPU slowed 4× (a mid-range phone profile),
// plays real lifts on a full 8×10 tray, and reports the CPU time each frame takes.
//
// Headless Chromium draws with a software GPU, so this measures the game's own per-frame work (animation, instance
// updates, grain launches, draw submission), not the phone's GPU. The real 60 fps check is the frame-rate readout
// in Settings on her phone.
//
// Usage: npm run build && npx vite preview --port 4173 &  then  node scripts/perf.cjs [tier] [throttle]
const { chromium } = require('playwright');

(async () => {
  const tier = process.argv[2] || 'medium';
  const throttle = Number(process.argv[3] || 4);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 664 } });
  await page.goto('http://localhost:4173/?tray=45');
  await page.waitForFunction(() => window.unfill);
  await page.evaluate((t) => {
    window.unfill.dismissIntro();
    window.unfill.setTier(t);
  }, tier);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.waitForTimeout(500);
  const before = (await page.evaluate(() => window.unfill.costs())).length;
  const sol = await page.evaluate(() => window.unfill.solution());
  // play the par solution, waiting for each pour and bottle flight to finish
  const tapMs = [];
  for (const cell of sol) {
    tapMs.push(await page.evaluate((c) => {
      const a = performance.now();
      window.unfill.tap(c);
      return performance.now() - a;
    }, cell));
    await page.waitForFunction(() => !window.unfill.busy(), null, { timeout: 30000 });
  }
  const raw = (await page.evaluate(() => window.unfill.costs())).slice(before);
  const spikes = raw.map((c, i) => [i, c]).filter(([, c]) => c > 25);
  if (spikes.length) console.log(`frames over 25 ms (frame index, ms): ${spikes.map(([i, c]) => `${i}:${c.toFixed(0)}`).join(" ")}`);
  const costs = raw.slice().sort((a, z) => a - z);
  const q = (p) => costs[Math.min(costs.length - 1, Math.floor(p * costs.length))];
  const info = await page.evaluate(() => window.unfill.renderInfo());
  console.log(`tier ${tier}, CPU ×${throttle}, ${sol.length} lifts on 8×10, ${costs.length} frames`);
  console.log(`frame CPU ms: median ${q(0.5).toFixed(2)}, p95 ${q(0.95).toFixed(2)}, max ${costs[costs.length - 1].toFixed(2)} (budget 16.7)`);
  console.log(`tap handling ms (lift, pour plan, grain launch, sound): max ${Math.max(...tapMs).toFixed(1)}, mean ${(tapMs.reduce((a, b) => a + b, 0) / tapMs.length).toFixed(1)}`);
  console.log(`draw calls ${info.calls}, triangles ${info.triangles}`);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
