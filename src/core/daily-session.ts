import { EMPTY, countBlocks } from './grid';
import { lift } from './rules';
import { LIBRARY_RULE, type LibraryEntry } from './library';
import { Session } from './session';
import type { DailyPuzzle, DailyRecord } from './daily';

/**
 * A Daily Puzzle in play: the game loop's Session, with one fixed tray instead of a run of levels. The move
 * allowance is the whole pool (nothing carries in or out), "par" is the proven best, and there's no next level.
 * The app shows "Best possible was X" only once the tray is done.
 */
export class DailySession extends Session {
  constructor(
    boards: readonly LibraryEntry[],
    readonly puzzle: DailyPuzzle,
    /** A replay after the first attempt: practice, never recorded. */
    readonly practice: boolean,
  ) {
    super(boards, 0, []);
  }

  override get par(): number {
    return this.puzzle.best;
  }

  override get grant(): number {
    return this.puzzle.allowed;
  }

  override begin(): { before: number; grant: number } {
    const p = this.puzzle;
    this.setBoard(p.n, { slot: { n: p.n, tier: p.entry.tier, role: 'peak', target: 0 }, entry: p.entry, transform: p.transform });
    // the proven line, so the test hooks (and knownFinish) follow the true best, not the library's par line
    this.solution = p.solution.slice();
    this.path = [this.start.board];
    let b = this.start.board;
    for (const tap of p.solution) {
      b = lift(b, tap, LIBRARY_RULE)!.board;
      this.path.push(b);
    }
    this.pool = { moves: p.allowed, atBoardStart: p.allowed };
    return { before: 0, grant: p.allowed };
  }

  override next(): { before: number; grant: number } {
    throw new Error('DailySession: a daily has no next level');
  }

  /** How it went, for the calendar: call once the tray is cleared or the moves ran out. */
  record(at: number): DailyRecord {
    const layers: [number, number][] = [];
    const snaps = [...this.history, this.cur];
    for (let k = 0; k < this.taps.length; k++) {
      const before = snaps[k].board;
      layers.push([before.cells[this.taps[k]], countBlocks(before) - countBlocks(snaps[k + 1].board)]);
    }
    return {
      n: this.puzzle.n,
      ymd: this.puzzle.ymd,
      cleared: this.cleared,
      lifts: this.lifts,
      best: this.puzzle.best,
      allowed: this.puzzle.allowed,
      layers,
      at,
    };
  }

  /** What to keep so a first attempt survives the app closing: which daily, and the taps so far. */
  toDailySave(): DailySave {
    return { v: 1, n: this.puzzle.n, practice: this.practice, taps: this.taps.slice() };
  }

  /** Rebuild from a save, or null if it doesn't fit (a different pool, or a damaged save). */
  static restoreDaily(boards: readonly LibraryEntry[], puzzle: DailyPuzzle, data: unknown): DailySession | null {
    const d = data as DailySave;
    if (!d || d.v !== 1 || d.n !== puzzle.n || !Array.isArray(d.taps) || d.taps.length > puzzle.allowed) return null;
    const s = new DailySession(boards, puzzle, !!d.practice);
    s.begin();
    for (const tap of d.taps) {
      if (!Number.isInteger(tap) || s.cleared || s.cur.board.cells[tap] === undefined || s.cur.board.cells[tap] === EMPTY) return null;
      const out = s.lift(tap);
      if (!out || out === 'out') return null;
    }
    return s;
  }
}

export interface DailySave {
  v: 1;
  n: number;
  practice: boolean;
  taps: number[];
}
