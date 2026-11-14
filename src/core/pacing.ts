/**
 * Session pacing: rough play-time estimates, used to fit the difficulty waves to a typical session.
 *
 * Target: Block Blast's average session, about 12 minutes (AppMagic, via Udonis, 2026), with about 2.7 sessions a
 * day. The per-tap time is an estimate until milestone 4 measures real taps on her phone: about 3.5 s of looking and
 * thinking plus the plan's animation timings (lift 0.35 s, pour 0.5–1.2 s). Change these constants once measured
 * and re-run `npm run economy:tune`.
 */
export const SESSION_TARGET_SECONDS = 12 * 60;
/** Average seconds per lift, thinking plus animation. Estimate; calibrate in milestone 4. */
export const SECONDS_PER_TAP = 5;
/** Seconds per board outside the lifts: intro card, the board pouring in, the bottle corking. */
export const SECONDS_PER_BOARD = 8;
/** Seconds to restart a board (the tray pouring back). */
export const SECONDS_PER_RESTART = 3;

/** Estimated seconds for one board: taps across all attempts, plus restarts and the board's own overhead. */
export function estimateBoardSeconds(taps: number, restarts: number): number {
  return SECONDS_PER_BOARD + taps * SECONDS_PER_TAP + restarts * SECONDS_PER_RESTART;
}
