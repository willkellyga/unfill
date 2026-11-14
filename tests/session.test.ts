import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  Random,
  SLACK,
  Session,
  boardsEqual,
  countBlocks,
  finishes,
  findGroups,
  searchFinish,
  starsFor,
  type Keepsake,
  type Library,
} from '../src/core';

const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));
const boards = library.boards;

/** Round-trip a session through JSON, as the app does with localStorage. */
function reload(s: Session): Session {
  const shelf: Keepsake[] = JSON.parse(JSON.stringify(s.shelf));
  const r = Session.restore(boards, JSON.parse(JSON.stringify(s.toSave())), shelf);
  expect(r).not.toBeNull();
  return r!;
}

function sameState(a: Session, b: Session): void {
  expect(b.n).toBe(a.n);
  expect(b.pick.entry.id).toBe(a.pick.entry.id);
  expect(b.pool).toEqual(a.pool);
  expect(b.taps).toEqual(a.taps);
  expect(boardsEqual(b.cur.board, a.cur.board)).toBe(true);
  expect(Array.from(b.cur.ids)).toEqual(Array.from(a.cur.ids));
  expect(b.history.length).toBe(a.history.length);
  expect(b.shelf.length).toBe(a.shelf.length);
  expect(b.recent).toEqual(a.recent);
}

/** A first-group-it-sees player with some undos and restarts mixed in, reloading the save after every action. */
function messyRun(seed: number, levels: number): Session {
  const R = new Random(seed);
  let s = new Session(boards, seed);
  s.begin(1, true);
  let t = 0;
  while (s.n <= levels) {
    expect(s.pool.moves).toBeGreaterThanOrEqual(0);
    expect(s.pool.moves).toBeLessThanOrEqual(s.pool.atBoardStart);
    expect(s.pool.atBoardStart - s.pool.moves).toBe(s.taps.length);
    // pool at the start of every board holds at least par: the fairness guarantee
    if (!s.taps.length) expect(s.pool.moves).toBeGreaterThanOrEqual(s.par);
    const roll = R.int(20);
    if (roll === 0 && s.restart()) {
      expect(boardsEqual(s.cur.board, s.start.board)).toBe(true);
    } else if (roll <= 2 && s.undo()) {
      /* undone */
    } else {
      const known = s.knownFinish();
      let cell: number;
      if (known && known.length <= s.pool.moves && R.int(3) > 0) cell = known[0];
      else {
        const groups = findGroups(s.cur.board).groups;
        cell = groups[R.int(groups.length)][0];
      }
      const out = s.lift(cell, ++t);
      if (out === 'out') {
        // out of moves: restart puts the pool back
        expect(s.pool.moves).toBe(0);
        expect(s.restart()).toBe(true);
      } else {
        expect(out).not.toBeNull();
        if (out!.keepsake) {
          const k = out!.keepsake;
          expect(k.n).toBe(s.n);
          expect(k.layers.reduce((a, [, size]) => a + size, 0)).toBe(s.total);
          expect(k.layers.length).toBe(k.lifts);
          expect(k.stars).toBe(starsFor(k.lifts, k.par));
          // the bottle is shelved once, even across a reload mid-clear
          const r = reload(s);
          sameState(s, r);
          s = r;
          s.next();
        }
      }
    }
    const r = reload(s);
    sameState(s, r);
    s = r;
  }
  return s;
}

describe('session', () => {
  it('plays 60 levels in a row with undos, restarts and a reload after every action', () => {
    const s = messyRun(7, 60);
    expect(s.shelf.length).toBe(60);
    expect(s.shelf.map((k) => k.n)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  }, 120_000);

  it('a different run seed plays different boards', () => {
    const a = new Session(boards, 1);
    const b = new Session(boards, 2);
    const ids = (s: Session) => Array.from({ length: 10 }, (_, i) => (s.begin(i + 1, i === 0), s.pick.entry.id)).join();
    expect(ids(a)).not.toBe(ids(b));
  });

  it('following the stored solution always clears in par with three stars, and carries moves over', () => {
    const s = new Session(boards, 99);
    s.begin(1, true);
    for (let level = 1; level <= 30; level++) {
      const sol = s.solution.slice();
      sol.forEach((cell, k) => {
        expect(s.pathIndex()).toBe(k);
        const out = s.lift(cell);
        expect(out && out !== 'out').toBeTruthy();
      });
      expect(s.cleared).toBe(true);
      const k = s.shelf[s.shelf.length - 1];
      expect(k.stars).toBe(3);
      const left = s.pool.moves;
      const { before, grant } = s.next();
      expect(before).toBe(left);
      expect(s.pool.moves).toBe(Math.min(left, SLACK.bankCap!) + grant);
      expect(k.spare).toBe(Math.max(0, left - SLACK.bankCap!));
    }
  });

  it('undo refunds a move and restores the board; nothing undoes a clear', () => {
    const s = new Session(boards, 5);
    s.begin(1, true);
    const start = s.pool.moves;
    const first = s.solution[0];
    s.lift(first);
    expect(s.pool.moves).toBe(start - 1);
    expect(s.undo()).not.toBeNull();
    expect(s.pool.moves).toBe(start);
    expect(boardsEqual(s.cur.board, s.start.board)).toBe(true);
    for (const c of s.solution) s.lift(c);
    expect(s.cleared).toBe(true);
    expect(s.undo()).toBeNull();
    expect(s.restart()).toBe(false);
    expect(s.lift(0)).toBeNull();
  });

  it('refuses saves that do not fit', () => {
    const s = new Session(boards, 3);
    s.begin(4, true);
    s.lift(s.solution[0]);
    const good = s.toSave();
    expect(Session.restore(boards, good)).not.toBeNull();
    expect(Session.restore(boards, { ...good, entry: 'nope' })).toBeNull();
    expect(Session.restore(boards, { ...good, v: 2 })).toBeNull();
    expect(Session.restore(boards, { ...good, taps: [...good.taps, good.taps[0]] })).toBeNull();
    expect(Session.restore(boards, { ...good, transform: { mirror: false, perm: [0, 0, 1] } })).toBeNull();
    expect(Session.restore(boards, null)).toBeNull();
    expect(Session.restore(boards, 'junk')).toBeNull();
  });
});

describe('hint search', () => {
  it('finds a finish that really empties the board, and says whether it fits', () => {
    const s = new Session(boards, 11);
    for (const n of [1, 12, 30, 50]) {
      s.begin(n, true);
      // wander off the path with two lifts of the last group
      for (let k = 0; k < 2; k++) {
        const g = findGroups(s.cur.board).groups;
        s.lift(g[g.length - 1][0]);
      }
      const a = searchFinish(s.cur.board, s.pool.moves, 1000, () => performance.now());
      expect(finishes(s.cur.board, a.taps)).toBe(true);
      expect(a.fits).toBe(a.taps.length <= s.pool.moves);
      expect(s.cur.board.cells[a.taps[0]]).not.toBe(EMPTY);
      expect(countBlocks(s.cur.board)).toBeGreaterThan(0);
    }
  });
});
