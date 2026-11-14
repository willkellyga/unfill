/**
 * An exact minimum-lifts prover for column-gravity boards, fast enough for the big trays (8x10, 5 colors).
 *
 * The game's own exactSolve (src/core/solver.ts) is IDA* with the "distinct colors left" lower bound, which is too
 * weak to finish on boards with par 13-19. This prover uses a stronger lower bound that is still never too high:
 *
 *   Column runs. Under column gravity sand only falls straight down, so a column that has no sand of color c will
 *   never get any. A group is connected, so the columns it covers form an unbroken range, and every column in the
 *   range holds some of its color. So for each color, the columns holding that color split into runs of
 *   neighboring columns, and no single lift can touch two runs. Runs only ever split, never join. Every run needs
 *   at least one lift of its own: the bound is the total number of runs over all colors.
 *
 * The search is depth-first branch and bound under a fixed limit, with a transposition table that remembers, for
 * each board, the largest number of moves it has been shown not to be enough for. Every result is checked by
 * replaying the taps through the game's real rules (src/core) before it is trusted.
 */
import { EMPTY, createBoard, type Board } from '../../src/core';

/** Column stacks: s.cells[x * rows + h] is the color at height h (0 = bottom) of column x. */
export interface Stacks {
  cols: number;
  rows: number;
  heights: Uint8Array;
  cells: Uint8Array;
}

export function fromBoard(b: Board): Stacks {
  const s: Stacks = { cols: b.cols, rows: b.rows, heights: new Uint8Array(b.cols), cells: new Uint8Array(b.cols * b.rows) };
  for (let x = 0; x < b.cols; x++) {
    let h = 0;
    for (let r = b.rows - 1; r >= 0; r--) {
      const v = b.cells[r * b.cols + x];
      if (v === EMPTY) continue;
      s.cells[x * b.rows + h++] = v;
    }
    s.heights[x] = h;
  }
  return s;
}

export function toBoard(s: Stacks): Board {
  const b = createBoard(s.rows, s.cols);
  for (let x = 0; x < s.cols; x++) for (let h = 0; h < s.heights[x]; h++) b.cells[(s.rows - 1 - h) * s.cols + x] = s.cells[x * s.rows + h];
  return b;
}

/** Each column packed as base-6 digits (color + 1, bottom first; at most 10 cells, so under 2^26) in two chars. */
function key(s: Stacks): string {
  const { cols, rows, heights, cells } = s;
  let out = '';
  for (let x = 0; x < cols; x++) {
    const base = x * rows;
    let code = 0;
    for (let h = heights[x] - 1; h >= 0; h--) code = code * 6 + cells[base + h] + 1;
    out += String.fromCharCode(code & 0xffff, code >>> 16);
  }
  return out;
}

/** The column-runs lower bound (see the file comment). */
export function runsBound(s: Stacks): number {
  let prev = 0;
  let n = 0;
  for (let x = 0; x < s.cols; x++) {
    let m = 0;
    const base = x * s.rows;
    for (let h = 0; h < s.heights[x]; h++) m |= 1 << s.cells[base + h];
    let fresh = m & ~prev;
    while (fresh) {
      n += fresh & 1;
      fresh >>>= 1;
    }
    prev = m;
  }
  return n;
}

interface Group {
  /** Cells as x * rows + h. */
  cells: number[];
  /** Row-major index (row 0 at the top) of the top-left-most cell: the tap the library stores. */
  tap: number;
}

let seenBuf = new Uint8Array(0);
const stackBuf: number[] = [];

function groupsOf(s: Stacks): Group[] {
  const { cols, rows, heights, cells } = s;
  if (seenBuf.length < cols * rows) seenBuf = new Uint8Array(cols * rows);
  const seen = seenBuf;
  seen.fill(0, 0, cols * rows);
  const out: Group[] = [];
  const stack = stackBuf;
  stack.length = 0;
  for (let x = 0; x < cols; x++) {
    for (let h = 0; h < heights[x]; h++) {
      const start = x * rows + h;
      if (seen[start]) continue;
      const k = cells[start];
      seen[start] = 1;
      stack.push(start);
      const g: number[] = [];
      let tap = Infinity;
      while (stack.length) {
        const i = stack.pop()!;
        g.push(i);
        const cx = (i / rows) | 0;
        const ch = i - cx * rows;
        const t = (rows - 1 - ch) * cols + cx;
        if (t < tap) tap = t;
        if (ch > 0 && !seen[i - 1] && cells[i - 1] === k) (seen[i - 1] = 1), stack.push(i - 1);
        if (ch + 1 < heights[cx] && !seen[i + 1] && cells[i + 1] === k) (seen[i + 1] = 1), stack.push(i + 1);
        if (cx > 0 && ch < heights[cx - 1] && !seen[i - rows] && cells[i - rows] === k) (seen[i - rows] = 1), stack.push(i - rows);
        if (cx + 1 < cols && ch < heights[cx + 1] && !seen[i + rows] && cells[i + rows] === k) (seen[i + rows] = 1), stack.push(i + rows);
      }
      out.push({ cells: g, tap });
    }
  }
  return out;
}

let goneBuf = new Uint8Array(0);

function lift(s: Stacks, g: Group): Stacks {
  const { cols, rows } = s;
  if (goneBuf.length < cols * rows) goneBuf = new Uint8Array(cols * rows);
  const gone = goneBuf;
  let touched = 0;
  for (const i of g.cells) {
    gone[i] = 1;
    touched |= 1 << ((i / rows) | 0);
  }
  const heights = s.heights.slice();
  const cells = s.cells.slice();
  for (let x = 0; x < cols; x++) {
    if (!(touched & (1 << x))) continue;
    const base = x * rows;
    let w = 0;
    for (let h = 0; h < s.heights[x]; h++) if (!gone[base + h]) cells[base + w++] = s.cells[base + h];
    for (let h = w; h < rows; h++) cells[base + h] = 0;
    heights[x] = w;
  }
  for (const i of g.cells) gone[i] = 0;
  return { cols, rows, heights, cells };
}

function isEmpty(s: Stacks): boolean {
  for (let x = 0; x < s.cols; x++) if (s.heights[x]) return false;
  return true;
}

export interface ProveResult {
  /** True if the search finished: `best` is then the proven minimum. */
  complete: boolean;
  /** The shortest solution found (taps in library format); the starting solution if nothing shorter turned up. */
  best: number[];
  /** Lower bound at the start (column runs). */
  startBound: number;
  nodes: number;
  ms: number;
}

/**
 * Find the minimum number of lifts. `known` is a solution already in hand (the library's par line); the search only
 * looks for anything shorter. Work is capped by `nodeBudget` so results never depend on the machine's speed.
 */
export function proveMinimum(board: Board, known: number[], nodeBudget: number, tableCap = 6_000_000): ProveResult {
  const t0 = Date.now();
  const start = fromBoard(board);
  let best = known.slice();
  let nodes = 0;
  let out = false;
  const startBound = runsBound(start);
  // table: board key -> the largest number of further moves shown NOT to be enough from that board.
  let table = new Map<string, number>();
  const path: number[] = [];

  // Returns true if a solution within `budget` moves was found (it is then in `path`).
  const dfs = (s: Stacks, budget: number): boolean => {
    if (++nodes > nodeBudget) {
      out = true;
      return false;
    }
    const groups = groupsOf(s);
    const kids: { s: Stacks; tap: number; h: number; size: number; k: string }[] = [];
    const local = new Set<string>();
    for (const g of groups) {
      const child = lift(s, g);
      if (isEmpty(child)) {
        path.push(g.tap);
        return true;
      }
      const h = runsBound(child);
      if (1 + h > budget) continue;
      const k = key(child);
      if (local.has(k)) continue;
      local.add(k);
      const failed = table.get(k);
      if (failed !== undefined && failed >= budget - 1) continue;
      kids.push({ s: child, tap: g.tap, h, size: g.cells.length, k });
    }
    kids.sort((a, z) => a.h - z.h || z.size - a.size || a.tap - z.tap);
    for (const kid of kids) {
      path.push(kid.tap);
      if (dfs(kid.s, budget - 1)) return true;
      path.pop();
      if (out) return false;
      if (table.size >= tableCap) table = new Map();
      const prev = table.get(kid.k);
      if (prev === undefined || prev < budget - 1) table.set(kid.k, budget - 1);
    }
    return false;
  };

  // Look for a solution one shorter than the best so far, until none exists (proven) or the budget runs out.
  while (best.length - 1 >= startBound) {
    path.length = 0;
    // The table stays valid across limits: "k moves are not enough" does not depend on the limit.
    if (dfs(start, best.length - 1)) best = path.slice();
    else break;
  }
  return { complete: !out, best, startBound, nodes, ms: Date.now() - t0 };
}
