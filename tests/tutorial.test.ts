import { describe, expect, it } from 'vitest';
import { LESSONS, TutorialSession, boardKey, exactSolve, findGroups, fromRows, isCleared, lift, LIBRARY_RULE, naivePlay, type Board } from '../src/core';

/** The most lifts any order of play can take to empty a board. */
function longest(b: Board, memo = new Map<string, number>()): number {
  if (isCleared(b)) return 0;
  const k = boardKey(b);
  if (!memo.has(k)) {
    let m = 0;
    for (const g of findGroups(b).groups) m = Math.max(m, 1 + longest(lift(b, g[0], LIBRARY_RULE)!.board, memo));
    memo.set(k, m);
  }
  return memo.get(k)!;
}

describe('first-play lesson', () => {
  it('guided steps of lesson 1 lift exactly the target groups and empty the tray in par', () => {
    const s = new TutorialSession();
    s.begin(1);
    expect(s.par).toBe(3);
    for (const cell of LESSONS[0].steps) {
      const group = s.target()!;
      expect(group).toContain(cell);
      const out = s.lift(cell);
      expect(out && out !== 'out').toBeTruthy();
    }
    expect(s.cleared).toBe(true);
    expect(s.lifts).toBe(s.par);
    expect(s.target()).toBeNull();
  });

  it('lesson 1 joins the green: after the pink, one green group of 6', () => {
    const s = new TutorialSession();
    s.begin(1);
    s.lift(LESSONS[0].steps[0]);
    expect(s.target()!.length).toBe(6);
  });

  it('lesson 2: par is one above the shortest, beatable, and the grant covers a clumsy clear', () => {
    const l = LESSONS[1];
    const b = fromRows(l.rows);
    const best = exactSolve(b, LIBRARY_RULE, 10, 1e6);
    expect(best.complete).toBe(true);
    expect(best.taps!.length).toBe(l.par - 1);
    // the obvious play (always the biggest group) goes over par, but no order of lifts runs out of moves
    expect(naivePlay(b, LIBRARY_RULE).length).toBeGreaterThan(l.par);
    expect(longest(b)).toBeLessThanOrEqual(l.grant);
    const s = new TutorialSession();
    s.begin(1);
    s.begin(2);
    expect(s.isLast).toBe(true);
    expect(s.pool.moves).toBe(l.grant);
    expect(s.target()).toBeNull();
    for (const t of s.solution) s.lift(t);
    expect(s.cleared).toBe(true);
  });

  it('every lesson starts with its own moves', () => {
    const s = new TutorialSession();
    s.begin(2);
    s.lift(0);
    s.begin(2);
    expect(s.pool.moves).toBe(LESSONS[1].grant);
    expect(s.lifts).toBe(0);
  });
});
