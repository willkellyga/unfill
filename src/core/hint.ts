import { type Board } from './grid';
import { LIBRARY_RULE } from './library';
import { beamSolve } from './solver';

/**
 * The hint and on-track search (plan: "Hints" and "A gentle 'still on track' glow"). From a board she has
 * reached off the stored solution's path, look for a way to finish within the moves she has left: a narrow beam
 * first, widening while there's time. The beam can miss a solution, so a miss only ever means "Undo might help",
 * never "impossible".
 */
export const HINT_WIDTHS = [16, 64, 240] as const;

export interface HintAnswer {
  /** The shortest way to finish found (taps), or [] if the board is already empty. */
  taps: number[];
  /** Whether it fits in the moves left. */
  fits: boolean;
  /** The widest beam that ran. */
  width: number;
}

/**
 * Search widening beams until one finds a finish within `budget` moves, or `deadlineMs` has passed after a beam
 * (the beam that's running always finishes). `clock` is injected so the search itself stays pure.
 */
export function searchFinish(b: Board, budget: number, deadlineMs: number, clock: () => number, widths: readonly number[] = HINT_WIDTHS): HintAnswer {
  const t0 = clock();
  let best: number[] | null = null;
  let width = 0;
  for (const w of widths) {
    const taps = beamSolve(b, LIBRARY_RULE, w);
    width = w;
    if (!best || taps.length < best.length) best = taps;
    if (best.length <= budget || clock() - t0 > deadlineMs) break;
  }
  return { taps: best!, fits: best!.length <= budget, width };
}
