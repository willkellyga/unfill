import { boardsEqual, countBlocks, isCleared, EMPTY, type Board } from './grid';
import { lift, replay, type LiftResult } from './rules';
import { LIBRARY_RULE, transformEntry, type BoardTransform, type LibraryEntry } from './library';
import { pickBoard, slotFor, type Pick } from './progression';
import { SLACK, grantFor, nextBoardPool, refundMove, restartBoard, spendMove, startPool, type MovePool } from './economy';

/**
 * A play session: the whole game loop's state, with no rendering and no clock (milestone 5).
 *
 * It holds the current board and its history, the move pool, the run's seed and recently played boards, and the
 * shelf of keepsake bottles. The 3D app drives it and animates what it reports; the tests drive it directly to
 * play hundreds of boards in a row. Everything it needs to resume is in `toSave()`: the board is stored as its
 * library id and transform plus the taps made so far, and is rebuilt by replaying them through the rules.
 */

/** A board and, parallel to its cells, the id of the block in each cell (-1 for empty), for animating moves. */
export interface Snap {
  board: Board;
  ids: Int32Array;
}

/** A cleared board's sand bottle, kept on the shelf. */
export interface Keepsake {
  /** Level number. */
  n: number;
  /** The lifts in order: [color, blocks] each. Colors are as shown (after the board's color swap). */
  layers: [number, number][];
  lifts: number;
  par: number;
  stars: 1 | 2 | 3;
  /** Leftover moves above the bank cap, turned into a ribbon on the bottle instead of being carried over. */
  spare: number;
  /** Points scored for the board. */
  points: number;
  /** When it was corked (ms since 1970), passed in by the app. */
  at: number;
}

export interface SaveData {
  v: 1;
  seed: number;
  n: number;
  entry: string;
  transform: BoardTransform;
  pool: MovePool;
  /** Taps made on the current board so far. */
  taps: number[];
  /** Recently played board ids, oldest first, so boards don't repeat soon. */
  recent: string[];
  /** Points scored this run. */
  score: number;
}

/**
 * Points for clearing a board (Will, Nov 14): par is the baseline, worth 20 points per par move, so bigger trays
 * are worth more. Every lift under par adds half the baseline again; every lift over par keeps three quarters of
 * what was left, so points shrink more and more the further over par she goes, but a clear always scores
 * something. Rounded to 5.
 */
export const POINTS_PER_PAR_MOVE = 20;
export const UNDER_PAR_BONUS = 0.5;
export const OVER_PAR_KEEP = 0.75;

export function pointsFor(lifts: number, par: number): number {
  const base = POINTS_PER_PAR_MOVE * par;
  const d = lifts - par;
  const f = d <= 0 ? 1 + UNDER_PAR_BONUS * -d : Math.pow(OVER_PAR_KEEP, d);
  return Math.max(5, Math.round((base * f) / 5) * 5);
}

/** Boards remembered so none repeat soon (plan: "the last 200 board ids"). */
export const RECENT_LIMIT = 200;

/** Plan: 3 stars for par or better, 2 for up to par + 2, 1 for any clear. */
export function starsFor(lifts: number, par: number): 1 | 2 | 3 {
  return lifts <= par ? 3 : lifts <= par + 2 ? 2 : 1;
}

export function idsFor(b: Board): Int32Array {
  return Int32Array.from(b.cells, (v, i) => (v === EMPTY ? -1 : i));
}

export interface LiftOutcome {
  /** The board before the lift and the result, with its settle trace (for the pour animation). */
  before: Snap;
  res: LiftResult;
  /** The color lifted. */
  color: number;
  /** Set when this lift emptied the tray: the bottle that went on the shelf. */
  keepsake: Keepsake | null;
}

export class Session {
  seed: number;
  n = 0;
  pick!: Pick;
  start!: Snap;
  cur!: Snap;
  history: Snap[] = [];
  taps: number[] = [];
  pool!: MovePool;
  recent: string[] = [];
  /** Points scored this run (cleared boards only). */
  score = 0;
  /** Bottles, oldest first. The app stores these separately from the save, since they only change on a clear. */
  shelf: Keepsake[];
  /** Blocks in the tray at the start of this board. */
  total = 0;
  /** The stored solution, as shown, and the board after each of its taps: path[k] is the board after k taps. */
  solution: number[] = [];
  private path: Board[] = [];
  private byId: Map<string, LibraryEntry>;

  constructor(
    readonly boards: readonly LibraryEntry[],
    seed: number,
    shelf: Keepsake[] = [],
  ) {
    this.seed = seed;
    this.shelf = shelf;
    this.byId = new Map(boards.map((b) => [b.id, b]));
  }

  get par(): number {
    return this.pick.entry.par;
  }

  /** Moves poured in for this board. */
  get grant(): number {
    return grantFor(this.pick.slot, this.pick.entry);
  }

  get cleared(): boolean {
    return isCleared(this.cur.board);
  }

  get lifts(): number {
    return this.history.length;
  }

  /** The run is over: no moves left and sand still in the tray. */
  get over(): boolean {
    return this.pool.moves === 0 && !this.cleared;
  }

  /**
   * Start level `n`. With `fresh`, the move pool starts over (the first level, or a jump); otherwise the leftover
   * moves carry over (up to the bank cap) and the level's grant pours in. Returns the moves before and after.
   */
  begin(n: number, fresh: boolean): { before: number; grant: number } {
    const before = this.pool ? this.pool.moves : 0;
    const pick = pickBoard(this.boards, n, this.seed, new Set(this.recent));
    this.recent = this.recent.filter((id) => id !== pick.entry.id);
    this.recent.push(pick.entry.id);
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);
    this.setBoard(n, pick);
    const grant = this.grant;
    if (fresh || !this.pool) this.pool = startPool(grant);
    else {
      const next = nextBoardPool(this.pool, grant);
      this.pool = { moves: next.moves, atBoardStart: next.atBoardStart };
    }
    return { before, grant };
  }

  /** After a clear: on to the next level. */
  next(): { before: number; grant: number } {
    return this.begin(this.n + 1, false);
  }

  private setBoard(n: number, pick: Pick): void {
    this.n = n;
    this.pick = pick;
    const { board, solution } = transformEntry(pick.entry, pick.transform);
    this.start = { board, ids: idsFor(board) };
    this.cur = this.start;
    this.history = [];
    this.taps = [];
    this.total = countBlocks(board);
    this.solution = solution;
    this.path = [board];
    let b = board;
    for (const tap of solution) {
      b = lift(b, tap, LIBRARY_RULE)!.board;
      this.path.push(b);
    }
  }

  /**
   * Tap a cell. Returns null if nothing happens (an empty cell, or the board is already cleared), 'out' if the
   * pool is empty, or what was lifted.
   */
  lift(cell: number, at = 0): LiftOutcome | 'out' | null {
    if (this.cleared) return null;
    if (cell < 0 || cell >= this.cur.board.cells.length || this.cur.board.cells[cell] === EMPTY) return null;
    const spent = spendMove(this.pool);
    if (!spent) return 'out';
    const res = lift(this.cur.board, cell, LIBRARY_RULE, this.cur.ids)!;
    const before = this.cur;
    const color = before.board.cells[cell];
    this.pool = spent;
    this.history.push(before);
    this.taps.push(cell);
    this.cur = { board: res.board, ids: res.trace!.ids };
    let keepsake: Keepsake | null = null;
    if (this.cleared) {
      keepsake = this.keepsake(at);
      this.score += keepsake.points;
      this.shelf.push(keepsake);
    }
    return { before, res, color, keepsake };
  }

  /** The bottle for the board just cleared, built from the lifts. */
  private keepsake(at: number): Keepsake {
    const layers: [number, number][] = [];
    const snaps = [...this.history, this.cur];
    for (let k = 0; k < this.taps.length; k++) {
      const b = snaps[k].board;
      layers.push([b.cells[this.taps[k]], countBlocks(b) - countBlocks(snaps[k + 1].board)]);
    }
    const cap = SLACK.bankCap;
    return {
      n: this.n,
      layers,
      lifts: this.taps.length,
      par: this.par,
      stars: starsFor(this.taps.length, this.par),
      spare: cap === null ? 0 : Math.max(0, this.pool.moves - cap),
      points: pointsFor(this.taps.length, this.par),
      at,
    };
  }

  /** Undo the last lift and refund its move. Not after a clear: the next level is already on its way. */
  undo(): Snap | null {
    if (!this.history.length || this.cleared) return null;
    const was = this.cur;
    this.cur = this.history.pop()!;
    this.taps.pop();
    this.pool = refundMove(this.pool);
    return was;
  }

  /** Put the board and the pool back to how they were at the board's start. */
  restart(): boolean {
    if (!this.history.length || this.cleared) return false;
    this.cur = this.start;
    this.history = [];
    this.taps = [];
    this.pool = restartBoard(this.pool);
    return true;
  }

  /**
   * If the current board is on the stored solution's path (after k of its taps, whatever order she took to get
   * there), k; otherwise -1. On the path, the rest of the solution is a known way to finish in par − k moves.
   */
  pathIndex(): number {
    for (let k = this.path.length - 1; k >= 0; k--) if (boardsEqual(this.cur.board, this.path[k])) return k;
    return -1;
  }

  /** A known way to finish from here, from the stored solution, or null if she has left its path. */
  knownFinish(): number[] | null {
    const k = this.pathIndex();
    return k < 0 ? null : this.solution.slice(k);
  }

  toSave(): SaveData {
    return {
      v: 1,
      seed: this.seed,
      n: this.n,
      entry: this.pick.entry.id,
      transform: { mirror: this.pick.transform.mirror, perm: this.pick.transform.perm.slice() },
      pool: { ...this.pool },
      taps: this.taps.slice(),
      recent: this.recent.slice(),
      score: this.score,
    };
  }

  /**
   * Rebuild a session from a save. Returns null if the save doesn't fit this library or these rules (an old or
   * damaged save), so the app can start fresh instead of showing a broken board.
   */
  static restore(boards: readonly LibraryEntry[], data: unknown, shelf: Keepsake[] = []): Session | null {
    try {
      const d = data as SaveData;
      if (!d || d.v !== 1 || !Number.isInteger(d.n) || d.n < 1 || !Number.isInteger(d.seed)) return null;
      const s = new Session(boards, d.seed, shelf);
      const entry = s.byId.get(d.entry);
      if (!entry) return null;
      const t = d.transform;
      if (!t || typeof t.mirror !== 'boolean' || !Array.isArray(t.perm) || t.perm.length !== entry.colors) return null;
      if ([...t.perm].sort((a, z) => a - z).some((v, i) => v !== i)) return null;
      const p = d.pool;
      if (!p || !Number.isInteger(p.moves) || !Number.isInteger(p.atBoardStart) || p.moves < 0 || p.moves > p.atBoardStart) return null;
      if (!Array.isArray(d.taps) || d.taps.length > p.atBoardStart || p.atBoardStart - p.moves !== d.taps.length) return null;
      s.recent = Array.isArray(d.recent) ? d.recent.filter((x) => typeof x === 'string').slice(-RECENT_LIMIT) : [];
      s.setBoard(d.n, { slot: slotFor(d.n), entry, transform: { mirror: t.mirror, perm: t.perm.slice() } });
      s.pool = { moves: p.atBoardStart, atBoardStart: p.atBoardStart };
      const score = Number.isInteger(d.score) && d.score >= 0 ? d.score : 0;
      for (const tap of d.taps) {
        // a replayed tap that lands on an empty cell means the save and the rules disagree
        if (s.cleared || s.cur.board.cells[tap] === EMPTY) return null;
        const out = s.lift(tap);
        if (!out || out === 'out') return null;
        // the clear that finished this board was already shelved and scored when it happened
        if (out.keepsake) shelf.pop();
      }
      s.score = score;
      return s;
    } catch {
      return null;
    }
  }
}

/** Check that a list of taps empties a board (used by tests and the hint search's answers). */
export function finishes(b: Board, taps: readonly number[]): boolean {
  try {
    return isCleared(replay(b, taps, LIBRARY_RULE));
  } catch {
    return false;
  }
}
