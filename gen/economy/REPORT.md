# Move economy report

Written by `npx tsx gen/economy/tune.ts`. 40 simulated sessions of 100 boards per player, on the shipped board library. Schedule: build 2, peak -1, breather 4, cleanser 4, tutorial 4, +50% of rating, range 0–8; welcome gift 5.

## Players against the targets

Plan targets: the careful player clears at least 90% of boards without a restart; the naive player needs restarts but always recovers. "Hinted" boards are ones finished by following the hints after three failed attempts.

| Player | First-try clears (worst session) | Restarts per 100 boards | Hinted per 100 | Pool after board 100: avg (max) | Lowest margin over par at a board start |
| --- | --- | --- | --- | --- | --- |
| careful | 100% (100%) | 0.0 | 0.0 | 16.2 (19) | 9 |
| medium | 93% (89%) | 9.3 | 0.8 | 5.1 (17) | 2 |
| casual | 58% (50%) | 62.7 | 4.6 | 3.0 (7) | 1 |
| sharp | 100% (100%) | 0.0 | 0.0 | 15.9 (20) | 9 |
| naive | 48% (39%) | 102.2 | 15.6 | 2.6 (6) | 0 |

- Careful player first try: 100%, target ≥ 90%: **met**.
- Naive player needs restarts (102.2 per 100 boards) and always recovers: every board was finished, and the pool never fell below par at a board start (lowest margin 0).
- Average slack: 4.0 moves per board.

## The sawtooth in the move counter

Share of boards that needed a restart, by role in the wave.

| Player | Tutorial | Build | Peak | Breather | Cleanser |
| --- | --- | --- | --- | --- | --- |
| careful | 0% | 0% | 0% | 0% | 0% |
| medium | 0% | 5% | 23% | 0% | 0% |
| casual | 0% | 43% | 74% | 15% | 6% |
| sharp | 0% | 0% | 0% | 0% | 0% |
| naive | 0% | 56% | 83% | 18% | 17% |

## Session length

Target: Block Blast's average session, about 12 minutes (AppMagic via Udonis, 2026). Times are estimates at 5 s per tap plus board and restart overheads (src/core/pacing.ts), to be calibrated with real taps in milestone 4. Restarted attempts count their taps.

| Player | First session: board at 12 min | Minutes to finish board 15 (first breather) | Wave minutes, boards 21–44 (8-board waves): median (middle half) | Wave minutes, boards 45+ (7-board waves): median (middle half) |
| --- | --- | --- | --- | --- |
| careful | 15 | 12.7 | 11.2 (11.0–11.5) | 10.1 (9.9–10.3) |
| medium | 14 | 13.4 | 12.5 (12.2–12.8) | 12.4 (11.2–13.9) |
| casual | 13 | 14.9 | 20.7 (18.4–22.8) | 19.8 (18.0–21.5) |
| sharp | 15 | 12.4 | 11.3 (11.1–11.7) | 10.3 (9.9–10.5) |
| naive | 12 | 17.6 | 25.5 (23.1–27.6) | 25.1 (22.8–26.9) |

Average minutes per board by tier:

| Player | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 | Tier 6 |
| --- | --- | --- | --- | --- | --- | --- |
| careful | 0.7 | 0.8 | 1.0 | 1.4 | 1.5 | 1.7 |
| medium | 0.7 | 0.9 | 1.0 | 1.6 | 1.8 | 2.9 |
| casual | 0.8 | 1.0 | 1.3 | 2.6 | 2.8 | 5.1 |
| sharp | 0.7 | 0.8 | 1.0 | 1.4 | 1.5 | 1.8 |
| naive | 0.8 | 1.0 | 1.7 | 3.2 | 3.6 | 5.6 |

## Pool size through a session

Average moves left after clearing each tenth board.

| Player | 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| careful | 17.0 | 17.7 | 16.0 | 15.8 | 13.9 | 16.4 | 16.9 | 16.1 | 17.4 | 16.2 |
| medium | 15.4 | 14.8 | 10.3 | 6.1 | 3.1 | 3.9 | 4.0 | 4.4 | 4.8 | 5.1 |
| casual | 11.2 | 4.2 | 1.4 | 1.6 | 1.2 | 1.6 | 1.6 | 1.6 | 2.0 | 3.0 |
| sharp | 17.3 | 17.8 | 16.4 | 15.6 | 14.2 | 15.9 | 16.9 | 15.9 | 17.3 | 15.9 |
| naive | 6.8 | 2.6 | 1.1 | 1.4 | 2.5 | 1.8 | 1.9 | 1.8 | 1.9 | 2.6 |

## Tuning

Grid search over 300 schedules (rating share 0–100%, build 0–4, peak 1–3 below build, breather 1–4 above; bank cap 15). Kept: careful player ≥ 90% first try overall and ≥ 85% in every session (plan); medium player 88–94% first try (cozy for a typical player); restarts on peaks > builds > breathers for the medium player, with breathers at most 5% (the sawtooth is felt); no restarts on the tutorial boards. 18 schedules qualify, sorted by least slack. The shipped one is marked; see gen/economy/README.md for why.

| Schedule | Avg slack | Careful first try (worst) | Medium first try | Casual first try | Medium restarts: peak / build / breather |
| --- | --- | --- | --- | --- | --- |
| build 0, peak -1, breather 4, cleanser 4, tutorial 4, +75% of rating, range 0–8 | 3.8 | 100% (100%) | 89% | 54% | 29% / 10% / 0% |
| build 2, peak -1, breather 3, cleanser 3, tutorial 4, +50% of rating, range 0–8 | 3.9 | 100% (100%) | 90% | 55% | 27% / 9% / 3% |
| build 3, peak 0, breather 6, cleanser 6, tutorial 4, +25% of rating, range 0–8 | 4.0 | 100% (100%) | 88% | 58% | 41% / 9% / 0% |
| build 3, peak 1, breather 5, cleanser 5, tutorial 4, +25% of rating, range 0–8 | 4.0 | 100% (100%) | 88% | 57% | 32% / 10% / 1% |
| build 3, peak 2, breather 4, cleanser 4, tutorial 4, +25% of rating, range 0–8 | 4.0 | 100% (100%) | 88% | 56% | 25% / 12% / 4% |
| build 4, peak 1, breather 7, cleanser 7, tutorial 4, +0% of rating, range 0–8 | 4.0 | 100% (100%) | 88% | 57% | 42% / 9% / 0% |
| build 2, peak -1, breather 4, cleanser 4, tutorial 4, +50% of rating, range 0–8 **(shipped)** | 4.0 | 100% (100%) | 93% | 58% | 23% / 5% / 0% |
| build 2, peak 0, breather 3, cleanser 3, tutorial 4, +50% of rating, range 0–8 | 4.0 | 100% (100%) | 92% | 56% | 19% / 6% / 3% |
| build 3, peak 0, breather 7, cleanser 7, tutorial 4, +25% of rating, range 0–8 | 4.1 | 100% (100%) | 91% | 60% | 36% / 6% / 0% |
| build 3, peak 1, breather 6, cleanser 6, tutorial 4, +25% of rating, range 0–8 | 4.1 | 100% (100%) | 91% | 59% | 29% / 7% / 0% |
| build 3, peak 2, breather 5, cleanser 5, tutorial 4, +25% of rating, range 0–8 | 4.1 | 100% (100%) | 90% | 57% | 25% / 9% / 1% |
| build 4, peak 1, breather 8, cleanser 8, tutorial 4, +0% of rating, range 0–8 | 4.1 | 100% (100%) | 91% | 60% | 37% / 6% / 0% |
| build 4, peak 2, breather 7, cleanser 7, tutorial 4, +0% of rating, range 0–8 | 4.1 | 100% (100%) | 90% | 59% | 34% / 7% / 0% |
| build 4, peak 3, breather 6, cleanser 6, tutorial 4, +0% of rating, range 0–8 | 4.1 | 100% (100%) | 90% | 57% | 26% / 9% / 0% |
| build 3, peak 1, breather 7, cleanser 7, tutorial 4, +25% of rating, range 0–8 | 4.3 | 100% (100%) | 93% | 62% | 26% / 5% / 0% |
| build 3, peak 2, breather 6, cleanser 6, tutorial 4, +25% of rating, range 0–8 | 4.3 | 100% (100%) | 93% | 60% | 23% / 6% / 0% |
| build 4, peak 2, breather 8, cleanser 8, tutorial 4, +0% of rating, range 0–8 | 4.3 | 100% (100%) | 93% | 62% | 29% / 5% / 0% |
| build 4, peak 3, breather 7, cleanser 7, tutorial 4, +0% of rating, range 0–8 | 4.3 | 100% (100%) | 92% | 60% | 26% / 6% / 0% |

Without the bank cap, the shipped schedule leaves the sharp player 153.4 moves and the careful player 164.2 moves after board 100 (up to 179), so the move counter stops mattering for a good player. With the cap, the bank stays near one board's worth, and overflow becomes stars or bottle decorations (plan: "If it gets too big, a cap can turn overflow into stars").
