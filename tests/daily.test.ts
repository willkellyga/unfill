import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DAILY_WEEK,
  DailySession,
  LIBRARY_RULE,
  checkDailyBoard,
  dailyDate,
  dailyNumber,
  dailyPuzzle,
  entryBoard,
  exactSolve,
  findGroups,
  isCleared,
  replay,
  shareText,
  streaks,
  weekdayOf,
  type DailyPool,
  type DailyRecord,
  type Library,
} from '../src/core';
import { fromBoard, proveMinimum, runsBound } from '../gen/daily/prove';

const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));
const pool: DailyPool = JSON.parse(readFileSync(new URL('../src/library/daily.json', import.meta.url), 'utf8'));
const byId = new Map(library.boards.map((b) => [b.id, b]));

describe('daily dates', () => {
  it('numbers days from the epoch and knows the weekday', () => {
    expect(dailyNumber(DAILY_WEEK.epoch)).toBe(1);
    expect(dailyDate(1)).toBe(DAILY_WEEK.epoch);
    expect(weekdayOf('2026-11-14')).toBe(5); // a Saturday
    expect(weekdayOf('2026-11-16')).toBe(0); // a Monday
    expect(dailyNumber('2027-01-01')).toBe(49);
    // across a daylight-saving change and a leap day, one calendar day is always one number
    expect(dailyNumber('2027-03-15') - dailyNumber('2027-03-14')).toBe(1);
    expect(dailyNumber('2028-03-01') - dailyNumber('2028-02-28')).toBe(2);
    for (let n = 1; n < 800; n += 37) expect(dailyNumber(dailyDate(n))).toBe(n);
  });
});

describe('daily pool', () => {
  it('has boards for every weekday, from the right tier, growing through the week', () => {
    expect(pool.epoch).toBe(DAILY_WEEK.epoch);
    expect(pool.days).toHaveLength(7);
    const sizes: number[] = [];
    pool.days.forEach((list, wd) => {
      expect(list.length).toBeGreaterThan(0);
      for (const d of list) expect(byId.get(d.id)!.tier).toBe(DAILY_WEEK.days[wd].tier);
      const e = byId.get(list[0].id)!;
      sizes.push(e.cols * e.rows * 10 + e.colors);
    });
    for (let i = 1; i < 7; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    // Sunday is the big five-color tray
    expect(byId.get(pool.days[6][0].id)!.colors).toBe(5);
  });

  it('every board clears in its proven best, never above the library par, with spare moves to allow for', () => {
    for (const [wd, list] of pool.days.entries()) {
      const ids = new Set<string>();
      for (const d of list) {
        const e = byId.get(d.id)!;
        expect(ids.has(d.id)).toBe(false);
        ids.add(d.id);
        expect(checkDailyBoard(d, e)).toBe(true);
        expect(d.best).toBeLessThanOrEqual(e.par);
        expect(d.allowed - d.best).toBeGreaterThanOrEqual(DAILY_WEEK.days[wd].minSpare);
        // the trap: a one-move-lookahead player needs more than the best
        expect(d.trap).toBeGreaterThanOrEqual(DAILY_WEEK.days[wd].minTrap);
      }
    }
  });

  it('no line shorter than the best exists on the small trays (re-proved here with the game\'s own exact search)', () => {
    // the big trays take minutes each, so the build proves them (gen/daily); here the small ones are re-checked
    // independently with src/core's IDA*, a different search from gen/daily/prove.ts
    for (const list of pool.days.slice(0, 2)) {
      for (const d of list.slice(0, 12)) {
        const r = exactSolve(entryBoard(byId.get(d.id)!), LIBRARY_RULE, d.best - 1, 2_000_000);
        expect(r.complete).toBe(true);
        expect(r.taps).toBeNull();
      }
    }
  }, 120_000);
});

describe('the exact prover', () => {
  it('agrees with the game\'s exact search on boards that search proved', () => {
    const proven = library.boards.filter((b) => b.proven === true && b.tier <= 3);
    for (let i = 0; i < proven.length; i += Math.floor(proven.length / 25)) {
      const e = proven[i];
      const r = proveMinimum(entryBoard(e), e.solution, 2_000_000);
      expect(r.complete).toBe(true);
      expect(r.best.length).toBe(e.par);
      expect(isCleared(replay(entryBoard(e), r.best, LIBRARY_RULE))).toBe(true);
    }
  }, 60_000);

  it('its lower bound never exceeds the true best', () => {
    for (const list of pool.days) for (const d of list.slice(0, 5)) expect(runsBound(fromBoard(entryBoard(byId.get(d.id)!)))).toBeLessThanOrEqual(d.best);
  });

  it('finds a shorter line when one exists', () => {
    // hand it a padded line (the par line with a wasted single lift first) and it must find the par again
    const e = library.boards.find((b) => b.tier === 2 && b.proven)!;
    const b = entryBoard(e);
    const first = findGroups(b).groups[0][0];
    const padded = [first, ...greedyLine(replay(b, [first], LIBRARY_RULE))];
    expect(padded.length).toBeGreaterThan(e.par);
    const r = proveMinimum(b, padded, 2_000_000);
    expect(r.complete).toBe(true);
    expect(r.best.length).toBe(e.par);
  }, 60_000);
});

/** Lift the top-left group until the tray is empty: always a valid (long) line. */
function greedyLine(b: ReturnType<typeof entryBoard>): number[] {
  const taps: number[] = [];
  let cur = b;
  while (!isCleared(cur)) {
    const g = findGroups(cur).groups[0];
    taps.push(g[0]);
    cur = replay(cur, [g[0]], LIBRARY_RULE);
  }
  return taps;
}

describe('the day\'s puzzle', () => {
  it('is the same for everyone on a day, and follows the weekday', () => {
    for (let n = 1; n <= 60; n++) {
      const a = dailyPuzzle(pool, library.boards, n);
      const b = dailyPuzzle(pool, library.boards, n);
      expect(a.entry.id).toBe(b.entry.id);
      expect(a.transform).toEqual(b.transform);
      expect(a.entry.tier).toBe(DAILY_WEEK.days[a.weekday].tier);
      expect(isCleared(replay(a.board, a.solution, LIBRARY_RULE))).toBe(true);
      expect(a.solution.length).toBe(a.best);
    }
  });

  it('does not repeat a board on its weekday until the list runs out', () => {
    for (let wd = 0; wd < 7; wd++) {
      const len = pool.days[wd].length;
      const seen = new Set<string>();
      let n = 1;
      while (weekdayOf(dailyDate(n)) !== wd) n++;
      for (let k = 0; k < Math.min(len, 40); k++, n += 7) {
        const id = dailyPuzzle(pool, library.boards, n).entry.id;
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });
});

describe('DailySession', () => {
  const puzzle = dailyPuzzle(pool, library.boards, 3);

  it('plays the proven line to a Perfect', () => {
    const s = new DailySession(library.boards, puzzle, false);
    s.begin();
    expect(s.pool.moves).toBe(puzzle.allowed);
    expect(s.par).toBe(puzzle.best);
    for (const tap of puzzle.solution) expect(s.lift(tap)).not.toBe('out');
    expect(s.cleared).toBe(true);
    const r = s.record(123);
    expect(r).toMatchObject({ n: 3, cleared: true, lifts: puzzle.best, best: puzzle.best });
    expect(r.layers.reduce((a, [, k]) => a + k, 0)).toBe(puzzle.board.cells.length);
    expect(() => s.next()).toThrow();
  });

  it('runs out of moves when they are spent with sand left', () => {
    const s = new DailySession(library.boards, puzzle, false);
    s.begin();
    // lift single blocks from the top-left until the moves are gone
    while (!s.over && !s.cleared) {
      const g = findGroups(s.cur.board).groups.sort((a, z) => a.length - z.length)[0];
      s.lift(g[0]);
    }
    expect(s.over).toBe(true);
    expect(s.record(0).cleared).toBe(false);
  });

  it('a first try survives the app closing', () => {
    const s = new DailySession(library.boards, puzzle, false);
    s.begin();
    for (const tap of puzzle.solution.slice(0, 3)) s.lift(tap);
    const back = DailySession.restoreDaily(library.boards, puzzle, JSON.parse(JSON.stringify(s.toDailySave())))!;
    expect(back.taps).toEqual(s.taps);
    expect(back.pool).toEqual(s.pool);
    expect(Array.from(back.cur.board.cells)).toEqual(Array.from(s.cur.board.cells));
    expect(DailySession.restoreDaily(library.boards, dailyPuzzle(pool, library.boards, 4), s.toDailySave())).toBeNull();
    expect(DailySession.restoreDaily(library.boards, puzzle, { v: 1, n: 3, practice: false, taps: [-5] })).toBeNull();
  });
});

describe('streaks and sharing', () => {
  const rec = (n: number, cleared: boolean, lifts = 8, best = 8): DailyRecord => ({
    n,
    ymd: dailyDate(n),
    cleared,
    lifts,
    best,
    allowed: 12,
    layers: [
      [0, 5],
      [4, 3],
    ],
    at: 0,
  });

  it('counts days in a row cleared on the first try', () => {
    const r = { 1: rec(1, true), 2: rec(2, true, 9), 3: rec(3, false), 4: rec(4, true), 5: rec(5, true) };
    expect(streaks(r, 5)).toEqual({ current: 2, max: 2, perfects: 3, played: 5 });
    // in the morning, before today's is played, yesterday's streak still stands
    expect(streaks(r, 6).current).toBe(2);
    // a skipped day breaks it
    expect(streaks(r, 7).current).toBe(0);
    expect(streaks({ 1: rec(1, true), 2: rec(2, true), 3: rec(3, true) }, 3).max).toBe(3);
  });

  it('shares like Wordle', () => {
    expect(shareText(rec(42, true), 'Sunday')).toBe('Unfill Daily #42 · Sunday\n🟧🟦\n8 lifts · best possible 8 🏆');
    expect(shareText(rec(42, true, 10), 'Sunday', 'https://x.y/')).toBe('Unfill Daily #42 · Sunday\n🟧🟦\n10 lifts · best possible 8\nhttps://x.y/');
    expect(shareText(rec(42, false), 'Sunday').split('\n')[2]).toBe('Out of moves · best possible 8');
  });
});
