/**
 * The baselines the tuning search aims for (Will, Nov 14: a typical run lasts 12–15 minutes, one sitting) (milestone 7 gameplan, gen/tuning/README.md). Change a number here
 * and re-run `npm run tuning` to search again; `npm run tuning -- --report` only checks the shipped TUNING.
 *
 * "Typical" is the medium bot. Minutes come from src/core/pacing.ts (5 s per lift, 8 s per level), an estimate
 * until her playtest gives real times.
 */
export const TARGETS = {
  typical: {
    /** Median run length, minutes. */
    medianMinutes: [12, 15] as [number, number],
    /** Fewer than this share (%) of runs end before 5 minutes. */
    under5Max: 10,
    /** Make par or better on levels 1–10, percent. */
    earlyMakePar: [70, 95] as [number, number],
    /** Make par or better on levels 11–20, percent (late in a typical 12–15 minute run). */
    lateMakePar: [35, 50] as [number, number],
    /** Share of cleared levels, percent: beat par / make par exactly / over par. */
    mix: { beat: 30, par: 25, over: 45 },
    /** "Almost never out of reach": at most this share (%) of levels start with fewer moves than par. */
    outOfReachMax: 5,
  },
  casual: {
    /** Even a loose player gets a real game: median minutes at least. */
    medianMinutesMin: 6,
  },
  sharp: {
    /** A sharp player beats par on at least this share (%) of levels in every band. */
    beatEveryBandMin: 20,
    /** And their runs still end: median minutes at most, and runs still going at level 200 at most (%). */
    medianMinutesMax: 40,
    cappedMax: 5,
  },
  endings: {
    /** Share (%) of finished typical runs that end on a peak level. */
    onPeakMin: 50,
    /** Share (%) of finished typical runs that end 3 or fewer moves short: "so close". */
    shortBy3Min: 50,
  },
};
