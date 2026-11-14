import { fromRows, toRows } from './grid';
import { groupAt } from './groups';
import { LIBRARY_RULE, type LibraryEntry } from './library';
import { Session } from './session';
import { exactSolve } from './solver';

/**
 * The first-play lesson (Nov 14, Will): two little scripted trays before level 1.
 *
 * Lesson 1 is guided: tap the pink bar, watch the green above it fall and join the green below, lift that, then the
 * lilac. Lesson 2 is free play against par: the obvious lift isn't the best one. It gives enough moves for any
 * order of lifts; the app still restarts it if the moves ever ran out. Neither tray scores, fills the shelf or goes to the playtest sheet; the app swaps this session
 * in for the run's and back out again.
 */
export interface Lesson {
  /** Top row first, as grid.fromRows: '.' empty, digits are sand colors (0 pink, 1 green, 2 lilac). */
  rows: string[];
  par: number;
  /** Moves poured in for the lesson. */
  grant: number;
  /** Guided lessons: the cell to lift at each step (any cell of its group counts); empty for free play. */
  steps: number[];
}

export const LESSONS: readonly Lesson[] = [
  {
    rows: ['.111.', '20002', '21112', '22222'],
    par: 3,
    grant: 4,
    // the pink bar, then the joined green, then the lilac cup
    steps: [6, 11, 15],
  },
  {
    // shortest is 4 lifts; par is one more, as in the game, so it can be beaten. Always lifting the biggest group
    // takes 6. No order of lifts takes more than 7, the moves given, so a first lesson can't be lost.
    rows: ['01102', '01102', '12100', '10111', '10011'],
    par: 5,
    grant: 7,
    steps: [],
  },
];

function lessonEntry(k: number): LibraryEntry {
  const l = LESSONS[k];
  const b = fromRows(l.rows);
  const colors = new Set(Array.from(b.cells).filter((v) => v >= 0)).size;
  const best = exactSolve(b, LIBRARY_RULE, 10, 2e5).taps ?? [];
  return {
    id: `lesson-${k + 1}`,
    tier: 0,
    index: k,
    cols: b.cols,
    rows: b.rows,
    colors,
    cells: toRows(b).join(''),
    solution: best,
    par: best.length,
    proven: true,
    metrics: {} as LibraryEntry['metrics'],
    rank: 0,
  };
}

export class TutorialSession extends Session {
  constructor() {
    super(LESSONS.map((_, k) => lessonEntry(k)), 1, []);
  }

  get lesson(): Lesson {
    return LESSONS[this.n - 1];
  }

  get par(): number {
    return this.lesson.par;
  }

  get grant(): number {
    return this.lesson.grant;
  }

  get isLast(): boolean {
    return this.n >= LESSONS.length;
  }

  /** Each lesson starts with its own moves, so lesson 2 plays the same however lesson 1 went. */
  begin(n: number): { before: number; grant: number } {
    const before = this.pool ? this.pool.moves : 0;
    const k = Math.max(1, Math.min(LESSONS.length, n));
    const entry = this.boards[k - 1];
    this.setBoard(k, {
      slot: { n: k, tier: 0, role: 'tutorial', target: 0 },
      entry,
      transform: { mirror: false, perm: Array.from({ length: entry.colors }, (_, i) => i) },
    });
    this.pool = { moves: this.grant, atBoardStart: this.grant };
    return { before, grant: this.grant };
  }

  /** The cells of the group the lesson wants lifted next, or null when any lift will do. */
  target(): number[] | null {
    const cell = this.lesson.steps[this.lifts];
    return cell === undefined ? null : groupAt(this.cur.board, cell);
  }
}
