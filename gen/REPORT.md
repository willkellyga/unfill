# Board library report

Written by `npm run gen`. 2400 boards, sand rule `column`, beam 500. Difficulty is the average extra moves over par that the simulated players need (casual ×32, medium ×32, sharp ×16).

## Tiers against their targets

| Tier | Size | Boards | Par avg [range] | Target par | Plan (repose) par | Careful gap avg (min) | Naive gap avg | Singles share avg (max) | Opening avg (min) | All in range |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 5×6, 3 colors | 150 | 5.9 [5–8] | 5–8 | 5.0 | 0.70 (0; target ≥ 0) | 2.37 | 4% (20%; target ≤ 25%) | 10.8 (8; target ≥ 8) | yes |
| 2 | 6×7, 3 colors | 250 | 7.1 [6–9] | 6–9 | 5.6 | 1.44 (1; target ≥ 1) | 3.69 | 5% (25%; target ≤ 25%) | 15.3 (11; target ≥ 8) | yes |
| 3 | 7×8, 3 colors | 350 | 8.3 [7–11] | 7–11 | 6.6 | 1.75 (1; target ≥ 1) | 5.09 | 5% (25%; target ≤ 25%) | 19.9 (15; target ≥ 8) | yes |
| 4 | 8×9, 4 colors | 500 | 12.4 [10–15] | 10–15 | 9.3 | 2.76 (1; target ≥ 1) | 7.29 | 5% (25%; target ≤ 25%) | 26.4 (21; target ≥ 8) | yes |
| 5 | 8×10, 4 colors | 750 | 13.1 [11–16] | 11–17 | 9.9 | 3.07 (1; target ≥ 1) | 8.38 | 5% (23%; target ≤ 25%) | 29.3 (25; target ≥ 8) | yes |
| 6 | 8×10, 5 colors | 400 | 15.1 [13–19] | 13–19 | 11.4 | 3.23 (1; target ≥ 1) | 8.13 | 5% (25%; target ≤ 25%) | 28.8 (24; target ≥ 8) | yes |

## Difficulty by tier

Average extra moves over par, per simulated player and overall (the rating). Spread is the easiest and hardest board.

| Tier | casual | medium | sharp | Rating avg | Easiest – hardest |
| --- | --- | --- | --- | --- | --- |
| 1 | 2.07 | 1.36 | 0.71 | 1.38 | 0.51 – 2.78 |
| 2 | 3.16 | 2.17 | 1.27 | 2.20 | 1.14 – 3.74 |
| 3 | 4.16 | 2.80 | 1.61 | 2.86 | 1.49 – 5.10 |
| 4 | 6.73 | 4.79 | 2.90 | 4.81 | 2.61 – 8.59 |
| 5 | 7.46 | 5.35 | 3.23 | 5.35 | 2.88 – 8.35 |
| 6 | 7.99 | 5.89 | 3.75 | 5.88 | 2.69 – 9.59 |

## Solver checks

| Tier | Candidates tried | Kept | Rejected for | Exact search | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | 157 | 150 | singles 6, par 1 | 150/150 proven minimal; beam beaten on 0 | 2 s |
| 2 | 392 | 250 | carefulGap 117, singles 14, par 6, naiveGap 5 | 250/250 proven minimal; beam beaten on 0 | 15 s |
| 3 | 425 | 350 | carefulGap 68, par 3, naiveGap 3, singles 1 | 326/350 proven minimal; beam beaten on 2 | 267 s |
| 4 | 521 | 500 | carefulGap 19, par 2 | not run (board too big) | 64 s |
| 5 | 769 | 750 | carefulGap 10, par 8, singles 1 | not run (board too big) | 123 s |
| 6 | 420 | 400 | carefulGap 10, par 9, singles 1 | not run (board too big) | 79 s |

## Progression preview (one run, boards 1–100)

One line per wave: each board as its role (T tutorial, B build, P peak, R breather, C small-tray cleanser), tier and rating in extra moves over par. Waves restart at each new tier, and from board 21 one wave is about one 12-minute session for a typical player (gen/economy/REPORT.md).

- Boards 1–3: T1 0.7 · T1 0.8 · T1 0.9
- Boards 4–10: B2 1.6 · B2 1.8 · B2 2.0 · B2 2.1 · B2 2.2 · P2 2.6 · R2 2.0
- Boards 11–15: B3 2.1 · B3 2.4 · B3 2.6 · P3 3.0 · R3 2.2
- Boards 16–20: B3 2.5 · B3 2.8 · B3 3.0 · P3 3.4 · R3 2.6
- Boards 21–28: B4 3.7 · B4 3.9 · B4 4.1 · B4 4.2 · B4 4.4 · B4 4.5 · P4 5.0 · R4 3.6
- Boards 29–36: B4 4.1 · B4 4.3 · B4 4.5 · B4 4.6 · B4 4.7 · B4 4.9 · P4 5.3 · R4 4.1
- Boards 37–44: B4 4.5 · B4 4.7 · B4 4.8 · B4 5.0 · B4 5.0 · B4 5.2 · P4 5.6 · R4 4.5
- Boards 45–51: B5 4.5 · B5 4.7 · B5 4.8 · B5 4.9 · B5 5.0 · P5 5.4 · R5 3.9
- Boards 52–58: B5 4.6 · B5 4.7 · B5 4.8 · B5 5.0 · B5 5.1 · P5 5.4 · C3 2.8
- Boards 59–65: B5 4.7 · B5 4.8 · B5 4.9 · B5 5.1 · B5 5.2 · P5 5.5 · R5 4.2
- Boards 66–72: B5 4.8 · B5 4.9 · B5 5.0 · B5 5.2 · B5 5.3 · P6 6.2 · C3 2.8
- Boards 73–79: B5 4.8 · B5 4.9 · B5 5.1 · B5 5.2 · B5 5.3 · P5 5.6 · R5 4.5
- Boards 80–86: B5 4.9 · B5 5.0 · B5 5.2 · B5 5.3 · B5 5.4 · P6 6.3 · C3 2.8
- Boards 87–93: B5 5.0 · B5 5.1 · B5 5.2 · B5 5.3 · B5 5.4 · P5 5.8 · R5 4.7
- Boards 94–100: B5 5.0 · B5 5.2 · B5 5.3 · B5 5.4 · B5 5.5 · P6 6.6 · C3 2.8

Boards 21–100 by role: build 4.87, peak 5.69, breather 4.20, cleanser 2.79 extra moves on average.

Slot rules: board 1 → tier 1 tutorial @60; board 4 → tier 2 build @100; board 9 → tier 2 peak @783; board 10 → tier 2 breather @350; board 21 → tier 4 build @100; board 27 → tier 4 peak @554; board 28 → tier 4 breather @72; board 45 → tier 5 build @150; board 57 → tier 5 peak @554; board 58 → tier 3 cleanser @500; board 71 → tier 6 peak @617; board 72 → tier 3 cleanser @500.
