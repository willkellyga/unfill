import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Random,
  SLACK,
  Session,
  boardsEqual,
  findGroups,
  pointsFor,
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
  expect(b.score).toBe(a.score);
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
    if (!s.taps.length) expect(s.pool.moves).toBeGreaterThanOrEqual(s.pick.entry.par); // the solver's par, not the easier one shown on levels 1-20
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

describe('points', () => {
  it('par is the baseline; under par earns more, over par less and less, never nothing', () => {
    expect(pointsFor(10, 10)).toBe(200);
    expect(pointsFor(9, 10)).toBe(300);
    expect(pointsFor(8, 10)).toBe(400);
    expect(pointsFor(11, 10)).toBe(150);
    expect(pointsFor(12, 10)).toBe(115);
    for (let par = 3; par <= 20; par++) {
      for (let lifts = 1; lifts < 60; lifts++) {
        expect(pointsFor(lifts, par)).toBeGreaterThanOrEqual(pointsFor(lifts + 1, par));
        expect(pointsFor(lifts, par)).toBeGreaterThanOrEqual(5);
        expect(pointsFor(lifts, par) % 5).toBe(0);
      }
    }
  });

  it('a run without undo or restart scores every clear, ends when moves run out, and survives reloads', () => {
    for (const seed of [1, 2, 3, 4]) {
      const R = new Random(seed);
      let s = new Session(boards, seed);
      s.begin(1, true);
      let cleared = 0;
      while (!s.over && cleared < 80) {
        // a so-so player: the stored solution's next move two times in three, otherwise a random group
        const known = s.knownFinish();
        const groups = findGroups(s.cur.board).groups;
        const cell = known && R.int(3) > 0 ? known[0] : groups[R.int(groups.length)][0];
        const out = s.lift(cell);
        expect(out && out !== 'out').toBeTruthy();
        if (s.cleared) {
          cleared++;
          s.next();
        }
        s = reload(s);
      }
      expect(s.score).toBe(s.shelf.reduce((a, k) => a + k.points, 0));
      expect(s.shelf.every((k) => k.points === pointsFor(k.lifts, k.par))).toBe(true);
      if (s.over) {
        expect(s.lift(findGroups(s.cur.board).groups[0][0])).toBe('out');
        expect(reload(s).over).toBe(true);
      }
    }
  });
});

describe('easier par on levels 1-20', () => {
  it('adds the typical extra moves (at least 1) up to level 20, and nothing after', async () => {
    const { shownPar, PAR_CUSHION_UNTIL } = await import('../src/core/session');
    const entry = { par: 8, metrics: { carefulGap: 0, naiveGap: 0, singles: 0, opening: 0, excess100: 250, players: { casual: 400, medium: 260, sharp: 120 } } };
    expect(shownPar(1, entry)).toBe(11); // 2.6 extra moves rounds to 3
    expect(shownPar(PAR_CUSHION_UNTIL, entry)).toBe(11);
    expect(shownPar(PAR_CUSHION_UNTIL + 1, entry)).toBe(8);
    expect(shownPar(5, { ...entry, metrics: { ...entry.metrics, players: { casual: 50, medium: 20, sharp: 0 } } })).toBe(9); // at least 1
  });
});
