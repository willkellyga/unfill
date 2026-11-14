import type { LibraryEntry, NoisyPlayer } from '../src/core';

/**
 * The plan's difficulty tiers, measured with plain column gravity (Will's choice). Each tier has a board size, a
 * number of boards to keep, and the target ranges every kept board must sit in. The ranges come from the
 * column-gravity study in gen/README.md; `npm run gen` reports each tier's averages against them.
 */
export interface TierSpec {
  tier: number;
  cols: number;
  rows: number;
  colors: number;
  /** Boards to keep. */
  count: number;
  /** Accepted par range (inclusive). Trims the rare too-short and too-long boards of each size. */
  par: [number, number];
  /** Smallest careful-player gap: how much thinking must pay. 0 for the tutorial tier. */
  minCarefulGap: number;
  /** Smallest naive-player gap: the obvious play (biggest group first) must not already be perfect. */
  minNaiveGap: number;
  /** Most single-block lifts allowed in the par solution, as a share of par (plan: about a quarter). */
  maxSinglesShare: number;
  /** Fewest groups on the first move (plan: fewer than 8 feels cramped). */
  minOpening: number;
  /** Node budget for the exact search that checks par; 0 skips it. */
  exactBudget: number;
}

export const TIERS: TierSpec[] = [
  { tier: 1, cols: 5, rows: 6, colors: 3, count: 150, par: [5, 8], minCarefulGap: 0, minNaiveGap: 0, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 200_000 },
  { tier: 2, cols: 6, rows: 7, colors: 3, count: 250, par: [6, 9], minCarefulGap: 1, minNaiveGap: 1, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 400_000 },
  { tier: 3, cols: 7, rows: 8, colors: 3, count: 350, par: [7, 11], minCarefulGap: 1, minNaiveGap: 1, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 400_000 },
  { tier: 4, cols: 8, rows: 9, colors: 4, count: 500, par: [10, 15], minCarefulGap: 1, minNaiveGap: 1, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 0 },
  { tier: 5, cols: 8, rows: 10, colors: 4, count: 750, par: [11, 17], minCarefulGap: 1, minNaiveGap: 1, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 0 },
  { tier: 6, cols: 8, rows: 10, colors: 5, count: 400, par: [13, 19], minCarefulGap: 1, minNaiveGap: 1, maxSinglesShare: 0.25, minOpening: 8, exactBudget: 0 },
];

export const BEAM_WIDTH = 500;

/**
 * The simulated players behind the difficulty rating. Each scores every lift by the groups it leaves and picks at
 * random, weighted toward the better lifts; `sharp` also thinks two taps ahead. The rating is the average number
 * of extra moves over par across all their runs.
 */
export const POPULATION: { name: string; player: NoisyPlayer; runs: number }[] = [
  { name: 'casual', player: { weights: [8, 4, 2, 1], lookahead: 1 }, runs: 32 },
  { name: 'medium', player: { weights: [16, 4, 1], lookahead: 1 }, runs: 32 },
  { name: 'sharp', player: { weights: [16, 2], lookahead: 2 }, runs: 16 },
];

/** Checks every board against its tier's targets. Returns the list of failures (empty if all pass). */
export function tierFailures(spec: TierSpec, e: LibraryEntry): string[] {
  const out: string[] = [];
  const m = e.metrics;
  if (e.par < spec.par[0] || e.par > spec.par[1]) out.push(`par ${e.par}`);
  if (m.carefulGap < spec.minCarefulGap) out.push(`carefulGap ${m.carefulGap}`);
  if (m.naiveGap < spec.minNaiveGap) out.push(`naiveGap ${m.naiveGap}`);
  if (m.singles > Math.floor(e.par * spec.maxSinglesShare)) out.push(`singles ${m.singles}`);
  if (m.opening < spec.minOpening) out.push(`opening ${m.opening}`);
  return out;
}

