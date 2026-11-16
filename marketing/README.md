# Marketing renders (CrazyGames covers and preview videos)

Rendered from the real game in headless Chromium, so the art always matches the build.

```sh
npm run build:crazygames
npx vite preview --outDir dist-crazygames --port 4174 &
node marketing/covers.cjs http://localhost:4174 marketing/out          # 4 PNGs, about 1 min each
node marketing/video.cjs landscape http://localhost:4174 marketing/out  # needs the landscape cover; about 15 min
node marketing/video.cjs portrait http://localhost:4174 marketing/out   # needs portrait-1080; about 15 min
```

`marketing/out/` is git-ignored. Needs `ffmpeg`.

## CrazyGames rules these follow

From docs.crazygames.com/requirements/game-covers (Nov 2026):

- **Covers:** 1920x1080 (16:9), 800x1200 (2:3), 800x800 (1:1), matching each other. Title only: no other words
  ("New", "Play now"), no borders, no icons or store logos. Not just a screenshot; simple; stylized title.
- **Label corner:** CrazyGames puts "New" / "Hot" badges in the **top-left** of every cover. The developer portal's
  "Show label zone" checkbox (Details step) shows it as 40% x 20% of the landscape cover, 40% x 10% of the portrait,
  35% x 30% of the square. The title stays out of it: landscape title starts at x 1080 (zone ends 768), portrait
  at y 140 (zone ends 120), square at x 300 (zone ends 280). The scene may run under it. (Zone sizes are from a
  developer who measured them in the portal; check them with that checkbox when uploading.)
- **Videos:** 15-20 s (longer is cut at 20), under 50 MB, 1080p 16:9 and 1080p 2:3, no sound, no fast-forward,
  the static cover as the first frame, no black bars or logo transitions, no mouse cursor, no promo text or icons.

## How it works

`lib.cjs` opens the game with a test tray (`?nosave&tray=45&seed=7`), takes over `requestAnimationFrame` so a frame
is drawn only when asked, and freezes the scene clock (`unfill.freeze`). Each video frame sets the clock 1/30 s
later, draws once and saves a JPEG, so the motion is real speed however slow the software renderer is. Taps show as a
soft ring. The covers move the camera (`T.frame` with a yaw and pitch), show the bottle bigger and nearer, pre-fill
it with sand layers, and catch a lift mid-pour.

Renders use the **Medium** tier. On High (shadows on), the bottle's sand doesn't draw in headless Chromium:
`GL_INVALID_OPERATION: Mismatch between texture format and sampler type (shadow)`. Players who pick High may hit the
same thing on some GPUs.
