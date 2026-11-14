import { EMPTY, cloneBoard, type Board } from './grid';
import { groupAt } from './groups';

/**
 * Sand rules. Integers only, a fixed processing order, no randomness, and no dependence on which color a
 * block is (only whether a cell is full). That gives three guarantees the property tests check:
 *   - deterministic: the same board and tap give the same result everywhere;
 *   - color-swap safe: recoloring a board and then settling equals settling and then recoloring;
 *   - mirror safe: mirroring then settling equals settling then mirroring (see the repose notes below).
 */
export type RuleName = 'repose' | 'column';
export const RULE_NAMES: readonly RuleName[] = ['repose', 'column'];

/** One block moving from one cell to another. `id` is the caller's tracking id for that block. */
export interface Move {
  readonly id: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Optional record of how the sand moved, for animation and previews.
 * Pass `ids` parallel to the board's cells (any per-block id, -1 for empty); settle moves them along with the
 * blocks. `steps[0]` is the straight-down fall (all at once); each later step is one slide round.
 */
export interface SettleTrace {
  ids: Int32Array;
  steps: Move[][];
}

export interface SettleStats {
  /** Blocks that slid sideways (repose only). */
  slides: number;
  /**
   * Times a left/right tie could only be broken by the fixed fallback (always left), because the board was
   * perfectly mirror-symmetric at that moment, up to a color swap. Only boards with an odd number of columns can
   * reach this. While it stays 0, the result is exactly the mirror of the mirrored board's result.
   */
  fallbackTies: number;
}

/** Rule 1 (both rules): every block falls straight down until it rests on something. Bottom-up per column. */
export function settleColumn(b: Board, trace?: SettleTrace): SettleStats {
  const { rows, cols, cells } = b;
  const fall: Move[] | null = trace ? [] : null;
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const from = r * cols + c;
      const v = cells[from];
      if (v === EMPTY) continue;
      if (write !== r) {
        const to = write * cols + c;
        cells[to] = v;
        cells[from] = EMPTY;
        if (trace) {
          const id = trace.ids[from];
          trace.ids[to] = id;
          trace.ids[from] = -1;
          fall!.push({ id, from, to });
        }
      }
      write--;
    }
  }
  if (trace) trace.steps.push(fall!);
  return { slides: 0, fallbackTies: 0 };
}

/**
 * The repose rule, as in the plan:
 *   1. Every block falls straight down.
 *   2. No column may stand 2+ blocks taller than a neighbor; if it does, its top block slides onto the lower
 *      neighbor. Repeat, tallest column first, until every step between columns is at most one block.
 *      The tray walls count as infinitely tall.
 *   3. If both neighbors are 2+ lower, the block goes to the lower one; if they're equal, toward the middle.
 *
 * Processing order (all of it mirror-symmetric):
 *   - Among columns that must shed, the tallest goes first; among equally tall, the one nearest the middle.
 *   - The only remaining tie is a column and its mirror image (same height, same distance from the middle).
 *     Their two slides then happen in the same round. On even widths, and on odd widths unless both pour into the
 *     center column, the two slides touch different columns and can't affect each other, so order doesn't matter.
 *
 * Two cases exist only on odd widths, and need a side picked:
 *   - The center column must shed and both neighbors are equally low. "Toward the middle" can't decide, so the
 *     block slides toward the side of the tray holding less sand.
 *   - The two columns beside the center both pour into it. The one on the side holding more sand goes first,
 *     which decides which color ends up underneath.
 * "Which side holds more sand" is mirror-symmetric (see sideBias); only a perfectly symmetric board falls back to
 * the left, and that is counted in `fallbackTies`.
 */
export function settleRepose(b: Board, trace?: SettleTrace): SettleStats {
  settleColumn(b, trace);
  const { rows, cols, cells } = b;
  const stats: SettleStats = { slides: 0, fallbackTies: 0 };
  const h = new Int16Array(cols);
  for (let c = 0; c < cols; c++) {
    let n = 0;
    for (let r = rows - 1; r >= 0 && cells[r * cols + c] !== EMPTY; r--) n++;
    h[c] = n;
  }
  const WALL = 0x7fff;
  const left = (c: number) => (c > 0 ? h[c - 1] : WALL);
  const right = (c: number) => (c < cols - 1 ? h[c + 1] : WALL);
  const mustShed = (c: number) => h[c] - left(c) >= 2 || h[c] - right(c) >= 2;
  /** Twice the distance from the middle of the tray, kept as an integer. */
  const offCenter = (c: number) => Math.abs(2 * c - (cols - 1));

  const direction = (c: number): number => {
    const l = left(c);
    const r = right(c);
    const okL = h[c] - l >= 2;
    const okR = h[c] - r >= 2;
    if (okL && !okR) return -1;
    if (okR && !okL) return 1;
    if (l !== r) return l < r ? -1 : 1;
    const twice = 2 * c;
    if (twice < cols - 1) return 1;
    if (twice > cols - 1) return -1;
    // Center column of an odd-width tray: slide toward the side holding less sand.
    const bias = sideBias(b, h);
    if (bias === 0) {
      stats.fallbackTies++;
      return -1;
    }
    return -bias;
  };

  let step: Move[] | null = null;
  const slide = (c: number, d: number) => {
    const from = (rows - h[c]) * cols + c;
    const nc = c + d;
    const to = (rows - 1 - h[nc]) * cols + nc;
    cells[to] = cells[from];
    cells[from] = EMPTY;
    h[c]--;
    h[nc]++;
    stats.slides++;
    if (trace) {
      const id = trace.ids[from];
      trace.ids[to] = id;
      trace.ids[from] = -1;
      step!.push({ id, from, to });
    }
  };

  // Each slide strictly lowers the sum of squared heights, so this always ends; the guard is belt and braces.
  const guard = rows * cols * rows * cols + 16;
  for (let round = 0; round < guard; round++) {
    let bestH = -1;
    let bestOff = WALL;
    for (let c = 0; c < cols; c++) {
      if (h[c] === 0 || !mustShed(c)) continue;
      const off = offCenter(c);
      if (h[c] > bestH || (h[c] === bestH && off < bestOff)) {
        bestH = h[c];
        bestOff = off;
      }
    }
    if (bestH < 0) break;
    const chosen: number[] = [];
    for (let c = 0; c < cols; c++) {
      if (h[c] === bestH && offCenter(c) === bestOff && mustShed(c)) chosen.push(c);
    }
    if (trace) {
      step = [];
      trace.steps.push(step);
    }
    if (chosen.length === 1) {
      slide(chosen[0], direction(chosen[0]));
      continue;
    }
    // A column and its mirror image, tied.
    const [cl, cr] = chosen;
    const dl = direction(cl);
    const dr = direction(cr);
    if (cl + dl === cr + dr) {
      // Both pour into the center column (odd widths only): the fuller side goes first.
      const bias = sideBias(b, h);
      if (bias === 0) stats.fallbackTies++;
      slide(bias === 1 ? cr : cl, bias === 1 ? dr : dl);
      continue;
    }
    slide(cl, dl);
    if (mustShed(cr)) slide(cr, direction(cr));
  }
  return stats;
}

/**
 * Which side of the tray holds more sand: -1 left, 1 right, 0 perfectly symmetric (up to a color swap).
 * Mirroring the board flips the answer, and recoloring it doesn't change it. Checked in order:
 *   1. total blocks in the left half vs the right half (center column excluded);
 *   2. column heights, compared from the walls inward;
 *   3. the color pattern: each side read row by row from the bottom, starting at its own wall, with colors
 *      renamed in order of first appearance so a color swap reads the same.
 */
export function sideBias(b: Board, h: Int16Array): number {
  const { rows, cols, cells } = b;
  const half = cols >> 1;
  let sumL = 0;
  let sumR = 0;
  for (let c = 0; c < half; c++) {
    sumL += h[c];
    sumR += h[cols - 1 - c];
  }
  if (sumL !== sumR) return sumL > sumR ? -1 : 1;
  for (let c = 0; c < half; c++) {
    if (h[c] !== h[cols - 1 - c]) return h[c] > h[cols - 1 - c] ? -1 : 1;
  }
  const nameL = new Int8Array(128).fill(-1);
  const nameR = new Int8Array(128).fill(-1);
  let nextL = 0;
  let nextR = 0;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const a = cells[r * cols + c];
      const z = cells[r * cols + (cols - 1 - c)];
      let la = -1;
      let lz = -1;
      if (a !== EMPTY) {
        if (nameL[a] < 0) nameL[a] = nextL++;
        la = nameL[a];
      }
      if (z !== EMPTY) {
        if (nameR[z] < 0) nameR[z] = nextR++;
        lz = nameR[z];
      }
      if (la !== lz) return la < lz ? -1 : 1;
    }
  }
  return 0;
}

const SETTLERS: Record<RuleName, (b: Board, trace?: SettleTrace) => SettleStats> = {
  repose: settleRepose,
  column: settleColumn,
};

/** Settle a board in place under a rule. */
export function settle(b: Board, rule: RuleName, trace?: SettleTrace): SettleStats {
  return SETTLERS[rule](b, trace);
}

/** True if the board is at rest under the rule: nothing floats, and (repose) no step is taller than one block. */
export function isSettled(b: Board, rule: RuleName): boolean {
  const { rows, cols, cells } = b;
  const h = new Int16Array(cols);
  for (let c = 0; c < cols; c++) {
    let seenHole = false;
    for (let r = rows - 1; r >= 0; r--) {
      if (cells[r * cols + c] === EMPTY) seenHole = true;
      else if (seenHole) return false; // a block above a hole is floating
      else h[c]++;
    }
  }
  if (rule === 'repose') {
    for (let c = 0; c + 1 < cols; c++) if (Math.abs(h[c] - h[c + 1]) > 1) return false;
  }
  return true;
}

export interface LiftResult {
  /** The new board, settled. The input board is not changed. */
  board: Board;
  /** Cells lifted out (ascending). */
  group: number[];
  stats: SettleStats;
  /** Present only if `ids` were passed. */
  trace?: SettleTrace;
}

/**
 * Tap cell `i`: lift its whole group (one move), then settle. Returns null if the cell is empty.
 * Pass `ids` (parallel to cells) to get a trace of where every block went.
 */
export function lift(b: Board, i: number, rule: RuleName, ids?: Int32Array): LiftResult | null {
  const group = groupAt(b, i);
  if (group.length === 0) return null;
  const next = cloneBoard(b);
  const trace: SettleTrace | undefined = ids ? { ids: ids.slice(), steps: [] } : undefined;
  for (const j of group) {
    next.cells[j] = EMPTY;
    if (trace) trace.ids[j] = -1;
  }
  const stats = settle(next, rule, trace);
  return { board: next, group, stats, trace };
}

/** Replay a list of taps (cell indices). Throws if a tap lands on an empty cell. */
export function replay(b: Board, taps: readonly number[], rule: RuleName): Board {
  let cur = b;
  taps.forEach((tap, n) => {
    const res = lift(cur, tap, rule);
    if (!res) throw new Error(`replay: move ${n + 1} taps empty cell ${tap}`);
    cur = res.board;
  });
  return cur;
}
