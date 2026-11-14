import type { LibraryEntry } from './library';
import type { Slot, SlotRole } from './progression';

/**
 * The move economy (plan: "Fairness and the move pool").
 *
 * Board n has a par pₙ and a grant gₙ = pₙ + sₙ with slack sₙ ≥ 0. Clearing a board pours the next board's grant
 * into the pool, and leftover moves carry over. Restarting a board puts the pool back to what it was when the
 * board began. So at the start of every board the pool holds at least par, whatever happened before, and the
 * stored solution always fits:
 *
 *     Pₙ = (Pₙ₋₁ − uₙ₋₁) + gₙ ≥ 0 + gₙ ≥ pₙ
 *
 * The slack rides the difficulty sawtooth: less on peaks, more on breathers, and more on boards that the simulated
 * players find harder (the board's rating, in extra moves over par). The numbers below were tuned with simulated
 * 100-board sessions (gen/economy/); see gen/economy/README.md.
 */
export interface SlackSchedule {
  /** Slack added for the slot's role in the wave. */
  role: Record<SlotRole, number>;
  /** Extra slack per move of rated difficulty, in percent: slack += round(rating × perMovePct / 100). */
  perMovePct: number;
  /** Slack never goes outside this range. The minimum must be 0 or more (that is the fairness guarantee). */
  min: number;
  max: number;
  /** Moves added to board 1's grant as a welcome gift (plan: 5). */
  welcomeGift: number;
  /**
   * Most moves carried over from one board to the next (plan: "if the bank gets too big, a cap can turn overflow
   * into stars or bottle decorations"). Overflow is returned by `nextBoardPool` so the app can turn it into
   * something nice. null means no cap. The cap never touches the next board's grant, so the guarantee holds.
   */
  bankCap: number | null;
}

export const SLACK: SlackSchedule = {
  role: { tutorial: 4, build: 2, peak: -1, breather: 4, cleanser: 4 },
  perMovePct: 50,
  min: 0,
  max: 8,
  welcomeGift: 5,
  bankCap: 15,
};

/** Slack for a board in a slot. Integers only, so every device gives the same grant. */
export function slackFor(slot: Pick<Slot, 'role'>, entry: Pick<LibraryEntry, 'metrics'>, s: SlackSchedule = SLACK): number {
  if (s.min < 0) throw new RangeError('slack minimum must be 0 or more');
  // rating × pct / 100, with the rating in hundredths of a move: round(excess100 × pct / 10000).
  const fromRating = Math.floor((entry.metrics.excess100 * s.perMovePct + 5000) / 10000);
  return Math.max(s.min, Math.min(s.max, s.role[slot.role] + fromRating));
}

/** Moves poured in for a board: par plus slack. */
export function grantFor(slot: Pick<Slot, 'role'>, entry: Pick<LibraryEntry, 'par' | 'metrics'>, s: SlackSchedule = SLACK): number {
  return entry.par + slackFor(slot, entry, s);
}

/**
 * The move pool during play. `atBoardStart` is the snapshot that Restart goes back to. Undo refunds its move
 * (plan: "Undo is unlimited within a board and refunds its move"), which the app does by calling `refund`.
 */
export interface MovePool {
  moves: number;
  atBoardStart: number;
}

/** First board: its grant plus the welcome gift. */
export function startPool(firstGrant: number, s: SlackSchedule = SLACK): MovePool {
  const moves = firstGrant + s.welcomeGift;
  return { moves, atBoardStart: moves };
}

/**
 * After clearing a board: leftover moves carry over (up to the bank cap), and the next board's grant pours in.
 * `overflow` is the leftover above the cap, for the app to turn into stars or bottle decorations.
 */
export function nextBoardPool(pool: MovePool, nextGrant: number, s: SlackSchedule = SLACK): MovePool & { overflow: number } {
  const kept = s.bankCap === null ? pool.moves : Math.min(pool.moves, s.bankCap);
  const moves = kept + nextGrant;
  return { moves, atBoardStart: moves, overflow: pool.moves - kept };
}

/** Spend one move for a lift. Returns null if the pool is empty (the app shows "Out of moves": Undo or Restart). */
export function spendMove(pool: MovePool): MovePool | null {
  return pool.moves > 0 ? { ...pool, moves: pool.moves - 1 } : null;
}

export function refundMove(pool: MovePool): MovePool {
  return { ...pool, moves: Math.min(pool.atBoardStart, pool.moves + 1) };
}

export function restartBoard(pool: MovePool): MovePool {
  return { ...pool, moves: pool.atBoardStart };
}
