# Unfill

A cozy, phone-first web puzzle. This repository has milestone 1 (the rules lab: a flat 2D test board on the shared
rules core), milestone 2 (the board library: generator, solver, difficulty rating and progression) and milestone 3
(the move economy).

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
npm run build      # type-check and build a static site into dist/
```

To play on a phone, keep `npm run dev` running and open the "Network" address it prints
(for example `http://192.168.1.20:5173`) on a phone on the same Wi-Fi.

## Playing the lab

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
- `src/library/boards.json`: the board library.
- `gen/`: the Node command that writes the library, and the difficulty study.
- `src/app/`: the 2D lab (canvas, input, sound).
- `tests/rules.test.ts`: property tests with fast-check, plus worked examples of the repose rule.
- `tests/solver.test.ts`: solver checks, including exact search against brute force on tiny boards.
- `tests/library.test.ts`: the library replay and target checks.
- `tests/progression.test.ts`: the progression schedule and sawtooth.
- `tests/economy.test.ts`: the move economy and the simulated-session targets.

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
