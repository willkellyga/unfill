# Unfill

A cozy, phone-first web puzzle. This repository has milestone 1 (the rules lab: a flat 2D test board on the shared
rules core), milestone 2 (the board library: generator, solver, difficulty rating and progression), milestone 3
(the move economy), milestone 4 (the 3D terrarium slice) and milestone 5 (the full game loop).

## Milestone 5: the full game loop (Nov 14, 2026)

The game now plays as one endless, saved run, still with no card or click between levels.

- **Level and clear moments, without stopping.** As a tray pours in, a banner floats over it for under 2 s:
  "Level 12 · par 11 · +13 moves", noting a bigger tray, a new color or a small palette-cleanser. When the tray
  empties, the bottle corks and the stars pop in over the empty glass (3 at par or better, 2 up to par + 2, 1 for
  any clear; "Beat par!" when she finds a shorter route than the solver), then the bottle slides off toward the
  shelf and the next level pours in by itself. A tap still skips ahead.
- **Move pool, undo, restart** as in the plan and milestone 3: unlimited undo that refunds its move, restart that
  puts the pool back (and now pours the tray's sand back in), out of moves is a gentle note, never a game over.
  Leftover moves above the 15-move bank cap aren't lost: they tie a ribbon on that level's bottle.
- **Hints** (the bulb, free and unlimited): the next lift of a way to finish glows and rises toward her. On the stored
  solution's path it's the next move of that solution; off it, a background search (a Web Worker running widening
  beams, `src/core/hint.ts`) finds one from her board. If workers are blocked, a narrower search runs on the page.
- **The on-track glow.** After every move the moves chip keeps a soft green glow while there's a known way to finish
  with the moves left. If the search can't find one in about half a second, the glow fades and the help line says
  "Undo might help" (never "impossible", since the search can miss).
- **Save and resume.** Every action saves to localStorage: the run's seed, the level, the board's library id and
  transform, the pool, the taps so far and recently played boards. Reopening rebuilds the tray by replaying the taps
  through the rules, so she lands exactly where she was, mid-board included ("Welcome back · Keep playing"). A save
  that doesn't fit the library is ignored rather than shown broken. Settings › Start over begins a fresh run from
  level 1 and keeps the shelf. `?tray=N` and `?nosave` play without touching the save.
- **The bottle shelf** (the bottle button, with a count badge that bumps as each bottle arrives): every corked bottle,
  newest first, drawn from her actual lifts (layers in order, color and size, wavy hand-poured edges, cork, ribbon).
  Tap one for its level, lifts against par, stars and date.
- **Checks.** `tests/session.test.ts` plays 60 levels in a row with undos, restarts and a save-and-reload after every
  action, and checks the fairness guarantee at every board start. `scripts/loop-check.cjs` plays the built game in
  headless Chromium through real taps: N levels in a row following hints and random groups, with undos, restarts,
  the shelf, and page reloads mid-board, failing on any page error or broken invariant (35 levels pass).

The game-loop state lives in `src/core/session.ts` (pure, no DOM), so the tests and the app share it.

## Milestone 4: 3D terrarium slice (Nov 14, 2026)

`index.html` is now the game in Three.js: a glass sand frame on a sunny wooden table, with the keepsake bottle on its
top rail. The 2D rules lab moved to `lab.html`.

Continuous play (Will's feedback, Nov 13): the page uses the lab's layout (title, level and move count on top; help line,
Undo/Restart and a fold-out settings panel at the bottom), and levels flow like Tetris with no card or click between
them. On a clear the bottle corks and slides off, a new bottle drops in, and the next tray's sand pours in through the
top of the glass while leftover moves count up. Tapping skips ahead. Undo and Restart only act on the current level.

Layout (Will's pick, Nov 14): "Bottle top". The camera faces the tray nearly head-on so it fills the screen's width,
the table is cropped away, and the bottle stands centered on the top rail between the level and moves chips. Round
icon buttons sit along the bottom, and the gear opens the settings panel.

- **The lift.** The tapped group squishes, floats out of the glass, arcs over to the bottle, and melts into it as a
  ribbon of grains. The bottle gains a layer of that color, sized by the blocks lifted, so it is exactly full when
  the tray is empty. Layer tops wander a little, like hand-poured sand art.
- **The pour.** Column gravity, shown as an hourglass: in each column the sand that has to fall crumbles from the
  bottom up, streams down as grains, and the landing cell fills from the bottom and firms with a small squash.
  0.5 to 1.2 s, like the plan. Grains run on the GPU (one launch per pour, nothing per frame). A tap during a pour
  fast-forwards it.
- **The clear.** The last layer settles, a cork drops in and twists down with a squeak and a pop, the bottle bobs,
  and a chime plays. The card shows stars (3 at par or better, 2 up to par + 2) and Next tray.
- **Hold to preview** shows the tray after the lift: moved blocks glow, the lifted group floats in front as a ghost.
  Release to lift, slide off to cancel. **Undo** gives the move back and takes the bottle's last layer out.
  **Restart** empties the bottle and puts the pool back.
- **Moves** come from the real economy: each tray is picked by the progression with its grant, and leftovers carry
  over. Out of moves shows a gentle note pointing to Undo and Restart. Settings has a tray-size picker (fresh pool)
  for trying the pour on bigger trays.
- **Sound**, all made in code with Web Audio: a grain hiss per color, as loud as the sand moving; a muffled thup on
  lift; the bottle ribbon with a hollow resonance that rises as it fills and a faint glass tinkle; cork squeak and
  pop; a chime; optional room tone with a distant bird. On iPhone the audio session is set to "playback" so the
  ringer switch doesn't mute it (iPhone Safari can't vibrate from the web, so sound carries the feel).
- **Quality tiers** (`src/app/game/quality.ts`): Medium is the default (baked contact shadows, 8,000 grains, 2×
  resolution cap). The game times its first 2 s of play and drops to Low if frames average over 20 ms. High adds
  real-time soft shadows and 20,000 grains. Depth of field is left out: it needs a post-processing pass, and the
  table already fades into the room. Settings can pin a tier and show a frame-rate readout.
- **Tap timings for the economy tuner.** Every lift logs how long the tray sat ready before the tap and how long
  the pour took (on the device, last 1,000 taps). Settings › Copy tap timings copies them as CSV, to replace the
  5 s per tap estimate in `src/core/pacing.ts`.
- **Performance check:** `npm run build && npx vite preview --port 4173` then `npm run perf` plays a full 8×10
  board in headless Chromium with the CPU slowed 4× and reports per-frame CPU time. On Medium: median 2.9 ms,
  p95 15 ms, 30–34 draw calls, about 4,000 triangles. Headless Chromium draws in software, so the GPU side of
  "60 fps on Medium" is checked on her phone with the frame-rate readout.
- `npm run build:single` writes `dist-single/unfill.html`, one self-contained file (about 1.4 MB) that runs from
  disk or as a published page.

What's still for later milestones (after M5): color-blind patterns, reduced motion, home-screen install (M6).

## Milestone 3: move economy (Nov 14, 2026)

- `src/core/economy.ts`: grants (par + slack), starting moves, carry-over with a 15-move bank cap, spend, undo and
  restart. Slack rides the sawtooth: +4 on the tutorial, about 4–5 on building boards, 1–2 on peaks, 6 on
  breathers on the full-size trays, plus more for harder-rated boards. Never below 0, so every board starts with
  at least par.
- Tuned with simulated 100-board sessions (`gen/economy/`, results in [gen/economy/REPORT.md](gen/economy/REPORT.md)):
  the careful player clears 100% of boards first try (plan target: 90%), a typical player 93%, mostly restarting on
  peaks; the naive player restarts often but always recovers.
- Tuned to Block Blast's average session (about 12 minutes): from board 21 on, one wave (warm-up, climb, peak,
  breather) takes a typical player about 12.5 minutes, and the first session ends on a breather at board 15, about
  13 minutes in. Time per tap is an estimate (`src/core/pacing.ts`) until milestone 4 measures real taps.
- `tests/economy.test.ts` checks the fairness guarantee, the sawtooth in the grants, and the session targets.

## Milestone 2: board library (Nov 14, 2026)

- `src/library/boards.json`: 2,400 pre-solved boards in six tiers, every one with its par solution, metrics and a
  difficulty rating. Written by `npm run gen` (see [gen/README.md](gen/README.md) and [gen/REPORT.md](gen/REPORT.md)).
- `npm test` replays every board, plain, mirrored and in every color order (about 165,000 games), and fails if any
  doesn't empty in exactly par moves. It also checks every board against its tier's targets, re-measures the
  metrics, rebuilds sample boards to prove the generator is deterministic, and checks the difficulty sawtooth.
- Difficulty is rated by simulated human-like players (average extra moves over par), chosen because it predicted
  struggle far better than any cheap measure in a 640-board study. See gen/README.md.
- `src/core/progression.ts` picks the board for each board number: harder as the number rises, in waves (building
  boards, a peak, a breather), with palette-cleanser boards and five-color peaks later on.
- `.github/workflows/ci.yml` runs typecheck, tests and build on every push once this is a GitHub repository.

## Decision (Nov 14, 2026)

After playing both rules in the lab, Will chose **plain column gravity** ("Columns"). The lab now opens on Columns.
The repose rule stays in the core for comparison. Column gravity treats left and right identically, so mirrored
boards are always safe (48 looks per library board), and boards take about 20% more lifts than with slopes
(plan data: 12.3 vs 9.9 par on 8×10, 4 colors), so the tier sizes and slack need re-measuring with this rule.

## Run it

You need Node.js 20 or newer (https://nodejs.org).

```sh
npm install
npm run dev        # opens on http://localhost:5173
npm test           # rules property tests, solver tests, and the full library replay (about 30 s)
npm run gen        # regenerate the board library and gen/REPORT.md (about 10 min on 4 cores)
npm run economy:sample && npm run economy:tune   # re-tune the move economy after a library change
npm run build      # type-check and build a static site into dist/ (the game and the lab)
npm run build:single   # the game as one self-contained HTML file, dist-single/unfill.html
npm run perf       # after a build and `npx vite preview --port 4173`: per-frame CPU time on a slowed CPU
npm run loop-check # after a build and `npx vite preview --port 4173`: plays 30 levels in a row through real taps
```

To play on a phone, keep `npm run dev` running and open the "Network" address it prints
(for example `http://192.168.1.20:5173`) on a phone on the same Wi-Fi.

## Playing the lab

The 2D lab is at `lab.html` (for example http://localhost:5173/lab.html).

- **Tap** a block: its whole same-color group lifts out (single blocks too). One lift = one move.
- **Press and hold** (0.3 s): the tray shows where everything will land. Moved blocks get a dashed outline, and the
  group being lifted glows. Release on the group to lift it; slide off to cancel, and no move is spent.
- **Undo** is unlimited and gives the move back. **Restart** returns to the start of the board. Ctrl/Cmd+Z also undoes.
- A tap during a pour fast-forwards it.
- **Slopes / Columns** switches the sand rule. It restarts the *same* board, so you can compare the two rules directly.
- **Board size, sound and rule comparison** (below the buttons) has the six tray sizes from the plan's tiers, the
  sound toggle, and a table of the fewest lifts you needed on each board under each rule. "Copy results" copies it as
  a table.
- The address bar holds the board, like `#8x10c4-s99-repose`, so a board can be shared or replayed.

## Code layout

- `src/core/`: the shared rules module. Pure TypeScript, no DOM, integers only (the simulated players and solver
  too; no clock, no `Math.random`).
  - `grid.ts`: the board (an `Int8Array`, row 0 at the top), mirror, recolor, text form for tests.
  - `groups.ts`: edge-connected same-color groups.
  - `rules.ts`: `settle` with the `repose` and `column` rules, `lift`, `replay`, and an optional move trace for animation.
  - `random.ts`: seeded integer random (mulberry32 with rejection sampling).
  - `generate.ts`: the plan's generator, ported from `solver-experiment/sim.js`, with a completely full tray.
  - `solver.ts`: beam search, exact search (IDA*), the careful, naive and noisy simulated players, metrics.
  - `library.ts`: library entry types, mirror and recolor transforms, duplicate detection.
  - `progression.ts`: which board comes next (tiers by board number, the sawtooth, seeded picking).
  - `economy.ts`: the move pool: grants, slack schedule, carry-over and bank cap, undo and restart.
  - `pacing.ts`: play-time estimates and the 12-minute session target.
  - `session.ts`: the game loop's state: the board and its history, the pool, level changes, keepsake bottles,
    the save format and resume. `hint.ts`: the hint and on-track search.
- `src/library/boards.json`: the board library.
- `gen/`: the Node command that writes the library, and the difficulty study.
- `src/app/game/`: the 3D game (Three.js).
  - `main.ts`: game state, input (tap, hold to preview), the lift's flight to the bottle, HUD, settings, timing log.
  - `scene.ts`: renderer, camera fit, lights, table, the glass tray. `blocks.ts`: instanced sand blocks, the seam
    bridges that join a group, the preview ghost. `pour.ts`: the hourglass pour timeline. `grains.ts`: GPU grains.
  - `bottle.ts`: the keepsake bottle, its sand layers and the cork. `glass.ts`: the glass material.
  - `audio.ts`: procedural sound. `textures.ts`: procedural textures. `palette.ts`, `quality.ts`.
  - `shelf.ts`: the bottle shelf. `solver-client.ts`: talks to the hint worker (`src/worker/solve.worker.ts`).
- `src/app/lab/`: the 2D lab (canvas, input, sound).
- `scripts/perf.cjs`: the performance check. `scripts/loop-check.cjs`: the 30-levels-in-a-row browser check. `scripts/single-file.mjs`: the one-file build.
- `tests/rules.test.ts`: property tests with fast-check, plus worked examples of the repose rule.
- `tests/solver.test.ts`: solver checks, including exact search against brute force on tiny boards.
- `tests/library.test.ts`: the library replay and target checks.
- `tests/progression.test.ts`: the progression schedule and sawtooth.
- `tests/economy.test.ts`: the move economy and the simulated-session targets.
- `tests/session.test.ts`: the game loop, save and resume, and the hint search.

## The repose rule, exactly

1. Every block falls straight down.
2. A column 2 or more blocks taller than a neighbor slides its top block onto that neighbor. Tray walls count as
   infinitely tall. Repeat until no step is taller than one block.
3. If both neighbors are 2+ lower, the block goes to the lower one. If they're equal, it goes toward the middle.

Order: the tallest column goes first; among equally tall columns, the one nearer the middle. A column and its mirror
image (same height, same distance from the middle) slide in the same round.

Two cases only exist on trays with an odd number of columns (5 and 7 wide):

- The center column has to shed and both neighbors are equally low. The block slides toward the side of the tray
  holding less sand.
- Both columns beside the center pour into it. The one on the fuller side goes first, which decides which color ends
  up underneath.

"Which side holds more sand" compares the two halves' block counts, then column heights from the walls inward, then the
color pattern. Only a tray that is perfectly mirror-symmetric (up to a color swap) falls back to the left; `settle`
reports that as `fallbackTies`.

## What the tests check

- Block count of every color is preserved.
- A settled board has no floating block, and under repose no step taller than one block.
- The same input always gives the same output, and settling a settled board changes nothing.
- Color swaps are always safe: recolor then settle equals settle then recolor.
- Mirroring is always safe on even widths, and on odd widths whenever `fallbackTies` is 0. Also checked move by move
  through whole random games.
- Every board can be emptied, and `replay` reproduces a game.
- The generator fills the tray completely and is deterministic per seed.
