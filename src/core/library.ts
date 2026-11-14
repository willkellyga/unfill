import { EMPTY, createBoard, mirrorCell, mirrorBoard, recolorBoard, toRows, type Board } from './grid';
import type { RuleName } from './rules';

/**
 * The board library: boards generated, solved and measured offline by `gen/`, shipped with the game as JSON.
 * Every entry stores its solution, and the test suite replays each one (plain, mirrored and in every color order)
 * to an empty tray in exactly `par` moves.
 */
export const LIBRARY_RULE: RuleName = 'column';

export interface BoardMetrics {
  /** Moves the plan's careful player (one-move lookahead) takes, minus par. */
  carefulGap: number;
  /** Moves the plan's naive player (biggest group first) takes, minus par. */
  naiveGap: number;
  /** Single-block lifts in the par solution. */
  singles: number;
  /** Groups available on the first move. */
  opening: number;
  /**
   * The difficulty rating: average extra moves over par (×100) that the simulated human-like players need,
   * averaged over the three players (see gen/README.md for why this rating was chosen).
   */
  excess100: number;
  /** Each simulated player's average extra moves over par (×100), by player name. */
  players: Record<string, number>;
}

export interface LibraryEntry {
  /** Stable id, like "t5-0412". */
  id: string;
  tier: number;
  /** The generator's candidate number in its tier: `npm run gen` rebuilds this exact board from (tier, index). */
  index: number;
  cols: number;
  rows: number;
  colors: number;
  /** Cells row by row from the top, one symbol per cell ('0'..'9'), as in grid.toRows. */
  cells: string;
  /** Taps (cell indices) of the par solution. */
  solution: number[];
  par: number;
  /** True if exact search proved par is the minimum, false if it ran out of budget, null if not run. */
  proven: boolean | null;
  metrics: BoardMetrics;
  /** Difficulty rank within its tier, 0 (easiest) to 999 (hardest). */
  rank: number;
}

export interface Library {
  version: number;
  rule: RuleName;
  generator: string;
  boards: LibraryEntry[];
}

export function entryBoard(e: Pick<LibraryEntry, 'cols' | 'rows' | 'cells'>): Board {
  const b = createBoard(e.rows, e.cols);
  for (let i = 0; i < e.cells.length; i++) b.cells[i] = e.cells[i] === '.' ? EMPTY : e.cells.charCodeAt(i) - 48;
  return b;
}

export function cellsString(b: Board): string {
  return toRows(b).join('');
}

/** How a library board is shown: optionally mirrored left to right, and with its colors relabeled. */
export interface BoardTransform {
  mirror: boolean;
  /** Color k is shown as perm[k]. */
  perm: number[];
}

/** The board and its par solution under a transform. Mirroring maps each tap to its mirror cell. */
export function transformEntry(e: LibraryEntry, t: BoardTransform): { board: Board; solution: number[] } {
  let board = recolorBoard(entryBoard(e), t.perm);
  let solution = e.solution.slice();
  if (t.mirror) {
    board = mirrorBoard(board);
    solution = solution.map((tap) => mirrorCell(e.cols, tap));
  }
  return { board, solution };
}

/** All permutations of 0..n-1, in lexicographic order. */
export function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let pos = 0; pos <= rest.length; pos++) out.push([...rest.slice(0, pos), n - 1, ...rest.slice(pos)]);
  }
  return out.sort((a, z) => {
    for (let i = 0; i < n; i++) if (a[i] !== z[i]) return a[i] - z[i];
    return 0;
  });
}

/**
 * A key that is the same for a board, its mirror image and any recoloring of either: colors are renamed in order
 * of first appearance, and the smaller of the plain and mirrored readings is kept. Used to keep duplicates out
 * of the library.
 */
export function canonicalKey(b: Board): string {
  const read = (m: Board) => {
    const names = new Map<number, number>();
    let s = '';
    for (let i = 0; i < m.cells.length; i++) {
      const v = m.cells[i];
      if (!names.has(v)) names.set(v, names.size);
      s += String.fromCharCode(48 + names.get(v)!);
    }
    return s;
  };
  const a = read(b);
  const z = read(mirrorBoard(b));
  return `${b.cols}x${b.rows}:${a < z ? a : z}`;
}
