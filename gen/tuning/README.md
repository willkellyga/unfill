# gen/tuning/: tuning Unfill with bot runs (milestone 7)

```sh
npm run tuning:sample      # record bot games on all 2,400 boards (about 10 min on 4 cores, deterministic)
npm run tuning             # search the knobs with bot runs, then check the winner on fresh runs; writes REPORT.md
npm run tuning -- --report # only check the shipped TUNING in src/core/tuning.ts
npm run tuning -- --minutes 20-25    # search for a different typical run length
npm run tuning:calibrate -- UNFILL1:...   # after a playtest: which bot plays like her, and her real seconds per lift
```

Re-run `tuning:sample` after regenerating the board library. Results: [REPORT.md](REPORT.md).

## What we're tuning for

The game plays as a run (Will, Nov 14): levels follow each other with no clicking in between, there's no undo,
restart or hints, every level is scored against par, and the run ends the moment the moves run out. Play again
starts a fresh run at level 1. Will's goals:

1. **Par is beatable and almost never out of reach.**
2. **The moves a level gives back are enough to beat par on it, but par gets harder the longer you play.**
3. **A typical player hits the ideal play time**, through a mix of beating, making and missing par.

## What the research says

- **Bots can stand in for players if they're calibrated.** King predicts how hard a Candy Crush level is from bot
  play: 100 to 1,000 bot attempts per level, mapped to the real pass rates with a regression, got within about 4–5
  points ([Gudmundsson et al. 2018](https://www.Gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf)).
  Bots and people react differently to difficulty, so the mapping is fitted, not assumed. In Lily's Garden, the
  best 5% of a bot's games were the best predictor of real completion rates, because the bot was weaker than people
  ([Kristensen et al. 2021](https://arxiv.org/pdf/2107.03305v1)).
- **A player's skill shows after 10 to 20 levels.** A per-player model beat the population average after about 10
  observed levels and settled by 20 to 30 ([Kristensen et al. 2022](https://ar5iv.labs.arxiv.org/html/2209.13495)).
  The same study saw about 1.4 attempts per level early and 2.5–3 later. So her first 20 or so levels are enough
  to place her among the bots.
- **Tune for near misses, with breathers.** Royal Match levels mostly end as almost-wins, not easy wins or flat losses
  ([Playliner, via This Week in LiveOps](https://thisweekinliveops.substack.com/p/how-royal-match-uses-almost-wins)).
  Hard levels that leave you one or two moves short alternate with comfortable "procrastinating" levels
  ([Room 8](https://room8studio.com/news/smart-casual-the-state-of-tile-puzzle-games-level-design-part-1/)).
- **Spikes cost players over time.** "Crazy hard levels never pay off, at least in the long term," and long levels
  are less fun, so a very hard level should be short ([King, via mobilegamer.biz](https://mobilegamer.biz/how-king-defines-a-good-candy-crush-saga-level-and-why-it-constantly-prunes-the-bad-ones/)).
  Watch fail rate, attempts and level time, and form hypotheses from the spikes
  ([SayGames](https://blog.say.games/posts/how-to-work-with-difficulty-in-hybrid-puzzles-so-players-dont-leave--but-stay-and-pay)).
- **Session length.** Block Blast, an endless game-over puzzle like this one, averages about 12 minutes a session
  (AppMagic, via [Udonis](https://www.blog.udonis.co/statistics/block-blast)). Will chose 12–15 minute runs (one
  sitting).

## The design that came out of it

**Par from the bots.** Before, par on levels 21 and up was the solver's best route (beam search, 500 wide), which
people almost never match, and levels 1–20 added a typical player's average extra moves. Now each board carries a
spread of how a typical bot plays it (`src/library/par-curves.json`, 128 games per board), and par on level n is:

> solver par + the extra moves a typical player stays within **q%** of the time on this board

q is "how often a typical player makes par or better here". It starts high, falls along `TUNING.makePar` as the run
goes on, is lower on peak levels and higher on breathers (`roleShift`, the sawtooth), and par is never less than
solver par + 1 (`minCushion`), so par can always be beaten. Because q is measured per board, a hard board gets a
generous par and an easy board a tight one: what she feels is the curve, not the luck of the draw.

**Moves back.** Each level pours in its par plus a bonus by role (`TUNING.bonus`, never below −1). So every level
hands back at least enough moves to beat its par (par − 1 lifts), which is Will's rule, and the stored solution
always fits. The tuned bonus is −1 on builds and peaks and +3 on breathers: on a build, beating par keeps the bank
level, making par exactly spends one banked move, and going over spends more; breathers refill it. Leftovers carry
over up to 15 (`bankCap`). Par itself stays in reach as long as anything is banked: in the bot runs a typical player
starts only about 2% of levels with fewer moves than par. A run ends only after she's gone over par by more than
what's banked.

**Why runs end.** Early in a run a typical player makes par most of the time, so the bank fills. As q falls, she goes
over par more often than she beats it and the bank drains, fastest on peaks. The run ends when it's empty, usually
on a peak and usually a move or two short.

## The bots

Four players, all from the board library's difficulty study (gen/tiers.ts). About 730,000 recorded games in all:

| Bot | Plays like |
| --- | --- |
| casual | quick taps, often not the best group |
| medium ("typical") | usually picks a good group, sometimes not |
| sharp | thinks two taps ahead |
| careful | the same greedy line every time (fewest groups left) |

A bot's moves on a board don't depend on its move pool, so each level of a run draws a recorded game for that
board (`samples.json`: casual 64, typical 64, sharp 48 per board, recorded separately from the par curves so par is
never judged on the games that set it). A run of 20 levels then takes microseconds. Each search candidate gets
1,000 runs per bot; the winner gets 5,000 fresh runs per bot. Play time is estimated at 5 s per lift plus 8 s per
level (`src/core/pacing.ts`) until her playtest gives real times.

## Targets

In `targets.ts`. The search minimizes how far each result is outside its range.

| Goal | Target (typical player unless noted) |
| --- | --- |
| Par beatable; every level gives back enough moves to beat par | guaranteed in code; must be 0 violations |
| Par almost never out of reach | at most 5% of levels start with fewer moves than par |
| Run length | median 12–15 min; under 10% of runs over before 5 min |
| Par gets harder | make par or better on 70–95% of levels 1–10, 35–50% of levels 11–20 |
| Mix over a run | about 30% beat / 25% exactly par / 45% over |
| Casual still gets a game | median at least 6 min |
| Sharp can always beat par, and still loses | beats par on 20%+ of levels in every band; median under 40 min |
| Near misses | most runs end on a peak; at least half end 3 or fewer moves short |

## Results

See [REPORT.md](REPORT.md). Two searches tried 5,376 settings (1,000 runs per bot each, about 21 million runs), and
the winner was checked on 5,000 fresh runs per bot. Typical: median run 14.6 minutes, makes par on 73% of levels
1–10 and 31% of levels 11–20, and over a run beats par 30% / makes it exactly 31% / goes over 39%. Sharp: median
36 minutes, beats par on at least 25% of levels in every band. Casual: 8 minutes. 89% of typical runs end 3 or
fewer moves short.

Two targets are just missed, and are worth checking in the playtest rather than forcing:

- Make par on levels 11–20: 31% against 35–50%. The search traded it for run length; a kinder par there makes runs
  longer than 15 minutes unless the bank shrinks.
- Runs ending on a peak: 40% against 50%. Peaks are 1 level in 5 here, so that's already twice their share; more
  would need harsher peaks.

## The playtest plan

1. Ship the tuned build. She plays as normal for a few days; nothing to fill in.
2. Will copies her code from Settings › Move your progress (and, if handy, Settings › Copy tap timings).
3. `npm run tuning:calibrate -- <code>` says which bot she plays like, where she sits against the typical bot,
   her real seconds per lift, and how far her runs went.
4. Ask her three quick questions: did par feel fair, did runs end too soon or drag, did the bigger trays come too
   late or too early.
5. Retune: set `SECONDS_PER_TAP` in `src/core/pacing.ts` to her number; if she isn't typical, either move the
   targets or make her bot the reference (`REFERENCE` in sample.ts); then `npm run tuning`, paste the winner into
   `TUNING`, and ship.

## The knobs

All in `TUNING` (`src/core/tuning.ts`):

| Knob | What it does |
| --- | --- |
| `makePar` | the make-par chance for a typical player by level: lower is stricter par, shorter runs |
| `roleShift` | the sawtooth: points off on peaks, points back on breathers |
| `minCushion` | par is at least solver par + this (keep at 1 or more) |
| `bonus` | moves on top of par per level, by role: more makes runs longer without touching par |
| `welcomeGift` | extra moves on level 1 |
| `bankCap` | most moves carried over |
