import type { LibraryEntry } from '../../src/core';

/**
 * How the daily pool is picked. A good daily has a clever line: the obvious, greedy play (one move of lookahead,
 * or biggest group first) loses to a smarter order. `careful` is the one-move-lookahead player's extra lifts over the
 * best, which counts most; the biggest-first player's gap and the two-move-lookahead bot's average add to it.
 */
export function cleverness(e: LibraryEntry, careful = e.metrics.carefulGap): number {
  return careful * 100 + e.metrics.naiveGap * 20 + (e.metrics.players.sharp ?? 0);
}

/** Boards to try proving, per tier: the most clever first. Tiers 4 and 5 feed two weekdays each. */
export const CANDIDATES: Record<number, number> = { 2: 90, 3: 90, 4: 170, 5: 130, 6: 160 };

/** Node budget per proof. A proof that runs out is left out of the pool. */
export const NODE_BUDGET: Record<number, number> = { 2: 300_000, 3: 400_000, 4: 1_500_000, 5: 1_500_000, 6: 2_000_000 };
