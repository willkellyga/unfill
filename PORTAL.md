# Unfill on CrazyGames (Basic Launch)

`npm run build:crazygames` builds the portal version into `dist-crazygames/` and zips it as `unfill-crazygames.zip`
(about 0.4 MB zipped, 8 files, `index.html` at the root). Upload that zip as an HTML5 game in the CrazyGames developer
portal. The GitHub Pages version (`npm run build`) is not affected.

## What the portal build changes

- **No playtest upload.** The Google Sheet collector is compiled out, and the Playtest settings row is hidden.
- **No home-screen app.** No service worker, manifest, app icons or Apple home-screen tags; no "Add to Home Screen"
  card; the Home screen, Move your progress and Tap timings settings rows are hidden.
- **Straight into play.** No start card: a new player lands in the two-tray lesson (skippable, as CrazyGames' quality
  guidelines suggest), which runs straight on into level 1 with no card in between. A returning player lands back in
  their tray.
- **Wide layout on landscape screens** (desktop, sideways phones and tablets): level, moves and score in a column at
  the left, the buttons with their names at the right, and the bottle on the table beside the tray, so the tray gets
  the full height. Portrait screens keep the phone layout.
- **No portrait lock** and no "turn your phone upright" card: the portal asks players to rotate by itself.
- **Daily share text** has no link (the page's own address on a portal is the bare game file).
- **Sound** resumes on the next tap or click if iOS suspended it in the background.

`?portal` on any build previews the portal behaviour, and `?wide` the wide layout alone.

## CrazyGames requirements checked

From docs.crazygames.com/requirements (Nov 2026):

| Requirement | Unfill |
| --- | --- |
| Initial download 50 MB max, 20 MB for the mobile homepage | 1.7 MB |
| 1,500 files max, relative paths only | 8 files, all `./` |
| Works in Chrome and Edge; Safari | Three.js WebGL; plays in Safari today |
| Mouse, and touch on mobile | Tap or click to lift |
| Desktop playable in landscape | Wide layout |
| `user-select: none` on body | Already set |
| No custom fullscreen button, no external links, no ads | None |
| English | English only |
| iOS audio resumes in a user gesture | `touchend` / `click` |

`scripts/portal-zip.mjs` re-checks the size, file count, root `index.html`, absolute paths, and that no collector or
service worker slipped back in, and refuses to zip if any fail.

## Not in this build

- The CrazyGames SDK (Basic Launch doesn't need it; ads are disabled in Basic Launch anyway).
- Account saves: progress lives in the browser's storage on the portal's domain.
- Translations.
