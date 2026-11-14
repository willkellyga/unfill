# gen/economy/: tuning the move economy (milestone 3)

```sh
npm run economy:sample    # gen/economy/samples.json: moves each simulated player needs on every board (~1 min)
npm run economy:tune      # grid search + gen/economy/REPORT.md (a few seconds)
```

Re-run both after regenerating the board library.

## How the economy works

The rules live in `src/core/economy.ts`, shared with the game.

- **Grant per board** = par + slack. Slack is never below 0, so every board starts with at least par in the pool
  (the plan's fairness guarantee; a test plays random wasteful sessions with restarts and checks it).
- **Slack** = a role amount + half the board's difficulty rating (rounded), kept within 0–8:

  | Role | Role amount | Typical slack on 8×10 | What it does |
  | --- | --- | --- | --- |
  | Tutorial (boards 1–3) | +4 | 4 | Can't fail |
  | Build | +2 | 4–5 | Breaks about even for a typical player |
  | Peak | −1 | 1–2 | Spends the cushion; this is where restarts happen |
  | Breather / cleanser | +4 | 6 | Refills the cushion |

  The rating term means a harder board always gets at least as many moves as an easier one in the same role, so
  peaks are hard because of the board and the tighter grant, not because of luck in the pick.
- **Starting moves**: board 1's grant plus a 5-move welcome gift (plan).
- **Carry-over**: unused moves carry to the next board, **up to 15**. Overflow is returned by `nextBoardPool` for
  the game to turn into stars or bottle decorations (plan: "If it gets too big, a cap can turn overflow into stars
  or bottle decorations"). Without the cap, the simulated strong players banked about 150 moves by board 100 and
  the counter stopped mattering for them.
- **Restart** puts the pool back to its board-start value; **undo** refunds its move.

## How it was tuned

`samples.json` holds 16 to 32 sampled games per board for three simulated players (casual, medium, sharp; the same
players as the difficulty rating), plus the plan's deterministic careful and naive players from the library
metrics. A session plays boards 1–100 with the real progression. If an attempt needs more moves than the pool
holds, the player restarts and retries as the next sharper player (people learn a board); after three failed
attempts they follow the free hints, which always fit.

The grid search (300 schedules) kept the ones where:

- the careful player clears at least 90% of boards first try overall and 85% in every session (plan target);
- the medium player, our stand-in for a typical person, clears 88–94% first try (cozy, not a pushover);
- the medium player restarts more on peaks than builds, and more on builds than breathers, with breathers at most
  5% (Will asked for a sawtooth that's felt);
- nobody ever restarts a tutorial board.

18 schedules qualify. The shipped one is in the middle of the band (93% first try for the typical player, peaks
restart 23%, builds 5%, breathers almost never) and is one of the few where slack follows each board's rating. The plan's
own suggestion (+3, +2, +1, +4, +0 repeating) gives too little: the careful player still passes, but the medium
player would restart about half of all boards, because column gravity boards need more moves than the plan's
repose numbers assumed.

## Session length

Will asked to tune to Block Blast's session length. Block Blast averages about 12 minutes per session and 2.7
sessions a day (AppMagic, via [Udonis](https://www.blog.udonis.co/statistics/block-blast)); the mobile median is
5–6 minutes ([GameAnalytics 2025](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks)).

The simulator now keeps a clock: each board costs its taps across all attempts at 5 seconds per tap, plus 8 seconds
for the board itself and 3 per restart (`src/core/pacing.ts`; the 5 seconds is an estimate until milestone 4
measures real taps on her phone). With that clock, the waves were refitted so that **one wave is about one session**
for the typical (medium) player: a warm-up, a climb, one peak, and a breather to stop on.

| Boards | Tray | Wave length | Typical player per wave |
| --- | --- | --- | --- |
| 1–3 | 5×6 tutorial | none | |
| 4–10 | 6×7 | 7 (5 build, peak, breather) | first session |
| 11–20 | 7×8 | 5 (3 build, peak, breather) | first session ends on the breather at board 15, about 13 minutes in |
| 21–44 | 8×9, 4 colors | 8 (6 build, peak, breather) | about 12.5 minutes |
| 45+ | 8×10, 4 colors | 7 (5 build, peak, breather) | about 12.4 minutes |

Tier 4 now runs to board 44 (the plan said 40) so it holds three whole waves. From board 61, every other peak is a
five-color board and the breather after it is a small 7×8 tray, so the hardest moment of a session is followed by
the gentlest one. A sharper player gets through a wave in about 10 minutes, a casual one in about 20, so a session
is one wave or a bit more or less. When real tap times are in, change `SECONDS_PER_TAP` and re-run
`npm run economy:tune`; if waves drift from 12 minutes, change the wave lengths in `src/core/progression.ts`.

These are starting values for the playtest week (milestone 7). The move numbers are all in the `SLACK` constant.
