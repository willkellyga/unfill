import { countBlocks, type Board } from './grid';
import { LIBRARY_RULE, permutations, transformEntry, type BoardTransform, type LibraryEntry } from './library';
import { Random, mixSeed } from './random';
import { replay } from './rules';
import { isCleared } from './grid';

/**
 * The Daily Puzzle: one tray a day, the same for everyone, picked from the date alone (no server).
 *
 * The pool (src/library/daily.json, built by `npm run daily`) holds, for each weekday, boards whose true minimum
 * number of lifts has been PROVEN by exact search, so "Best possible" can never be beaten. The week ramps like a
 * crossword's: a small breather on Monday, building to a big five-color tray on Sunday.
 *
 * Rules of the daily (Will, Nov 14): its own sand colors, a fixed move allowance, and after the tray is done it
 * shows "Best possible was X". Clearing it in exactly X earns the Perfect achievement. Only the first attempt
 * counts; replays are practice.
 */

export interface DailySpec {
  name: string;
  /** Library tier the day's boards come from. */
  tier: number;
  /** Fewest extra lifts the one-move-lookahead (greedy) player must need over the best: the trap. */
  minTrap: number;
  /** The move allowance is the best plus the extra lifts a typical player stays within this % of the time. */
  allowQuantile: number;
  /** ...and never fewer than this many spare moves. */
  minSpare: number;
}

/** Monday first. Daily #1 is the epoch's date. */
export const DAILY_WEEK: { epoch: string; days: DailySpec[] } = {
  epoch: '2026-11-14',
  days: [
    { name: 'Monday', tier: 2, minTrap: 1, allowQuantile: 80, minSpare: 3 },
    { name: 'Tuesday', tier: 3, minTrap: 1, allowQuantile: 75, minSpare: 3 },
    { name: 'Wednesday', tier: 4, minTrap: 1, allowQuantile: 70, minSpare: 3 },
    { name: 'Thursday', tier: 4, minTrap: 1, allowQuantile: 70, minSpare: 3 },
    { name: 'Friday', tier: 5, minTrap: 1, allowQuantile: 65, minSpare: 3 },
    { name: 'Saturday', tier: 5, minTrap: 1, allowQuantile: 65, minSpare: 3 },
    { name: 'Sunday', tier: 6, minTrap: 1, allowQuantile: 60, minSpare: 3 },
  ],
};

/** One pool board: its library id, the proven minimum and a line that achieves it, and the move allowance. */
export interface DailyBoard {
  id: string;
  best: number;
  solution: number[];
  allowed: number;
  /** Extra lifts the greedy player needs over the best. */
  trap: number;
}

export interface DailyPool {
  version: 1;
  epoch: string;
  /** Monday first: days[0] is every Monday's list. */
  days: DailyBoard[][];
}

// ---------------------------------------------------------------- dates (local calendar days, no time zones)

/** "YYYY-MM-DD" for a Date in the player's own time zone: the daily turns over at her local midnight. */
export function localYmd(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days since 1970-01-01 for a "YYYY-MM-DD" (calendar arithmetic only, so no daylight-saving surprises). */
export function dayOrdinal(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new RangeError(`dayOrdinal: bad date ${ymd}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

export function ymdOfOrdinal(ord: number): string {
  const d = new Date(ord * 86_400_000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Daily number for a date: #1 on the epoch. */
export function dailyNumber(ymd: string, epoch = DAILY_WEEK.epoch): number {
  return dayOrdinal(ymd) - dayOrdinal(epoch) + 1;
}

export function dailyDate(n: number, epoch = DAILY_WEEK.epoch): string {
  return ymdOfOrdinal(dayOrdinal(epoch) + n - 1);
}

/** 0 = Monday ... 6 = Sunday. 1970-01-01 was a Thursday. */
export function weekdayOf(ymd: string): number {
  return (((dayOrdinal(ymd) + 3) % 7) + 7) % 7;
}

// ---------------------------------------------------------------- the day's tray

export interface DailyPuzzle {
  n: number;
  ymd: string;
  weekday: number;
  dayName: string;
  entry: LibraryEntry;
  transform: BoardTransform;
  board: Board;
  /** The proven minimum. */
  best: number;
  /** A line that clears it in `best` lifts, as shown (after the mirror). */
  solution: number[];
  /** Moves she gets. */
  allowed: number;
}

/**
 * Daily #n. Each weekday walks through its own list in a fixed shuffled order; when a list runs out it starts again
 * mirrored and recolored differently, so a repeat doesn't look like one. Everyone gets the same tray on the same day.
 */
export function dailyPuzzle(pool: DailyPool, boards: readonly LibraryEntry[], n: number): DailyPuzzle {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`dailyPuzzle: bad number ${n}`);
  const ymd = dailyDate(n, pool.epoch);
  const weekday = weekdayOf(ymd);
  const list = pool.days[weekday];
  if (!list || !list.length) throw new Error(`dailyPuzzle: no boards for weekday ${weekday}`);
  // the k-th time this weekday comes around since the epoch
  const k = Math.floor((n - 1) / 7);
  const order = new Random(mixSeed(0xda11, weekday)).shuffle(list.map((_, i) => i));
  const pick = list[order[k % list.length]];
  const entry = boards.find((b) => b.id === pick.id);
  if (!entry) throw new Error(`dailyPuzzle: board ${pick.id} is not in the library`);
  const R = new Random(mixSeed(0xda11, n));
  const perms = permutations(entry.colors);
  const transform: BoardTransform = { mirror: R.int(2) === 1, perm: perms[R.int(perms.length)] };
  // the proven line, mirrored and recolored like the board (taps are cells, so recoloring leaves them alone)
  const { board, solution } = transformEntry({ ...entry, solution: pick.solution }, transform);
  return {
    n,
    ymd,
    weekday,
    dayName: DAILY_WEEK.days[weekday].name,
    entry,
    transform,
    board,
    best: pick.best,
    solution,
    allowed: pick.allowed,
  };
}

/** Check a pool board's proven line really clears it in `best` lifts (the tests run this over the whole pool). */
export function checkDailyBoard(d: DailyBoard, entry: LibraryEntry): boolean {
  if (d.solution.length !== d.best || d.allowed < d.best) return false;
  try {
    const t = transformEntry({ ...entry, solution: d.solution }, { mirror: false, perm: [...Array(entry.colors).keys()] });
    return isCleared(replay(t.board, t.solution, LIBRARY_RULE)) && countBlocks(t.board) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- results, streaks, sharing

/** How her FIRST attempt at a daily went. Later replays are practice and never change it. */
export interface DailyRecord {
  n: number;
  ymd: string;
  /** Cleared the tray within the allowance. */
  cleared: boolean;
  lifts: number;
  best: number;
  allowed: number;
  /** The lifts in order: [color, blocks] each, colors as shown. */
  layers: [number, number][];
  /** When it finished (ms since 1970). */
  at: number;
}

export const isPerfect = (r: Pick<DailyRecord, 'cleared' | 'lifts' | 'best'>): boolean => r.cleared && r.lifts === r.best;

/**
 * The streak: days in a row whose daily she cleared on the first try, ending today, or yesterday if today's isn't
 * done yet (so the streak doesn't look broken in the morning). `max` is the longest ever.
 */
export function streaks(records: Readonly<Record<number, DailyRecord>>, today: number): { current: number; max: number; perfects: number; played: number } {
  let current = 0;
  let n = records[today] ? today : today - 1;
  while (records[n]?.cleared) {
    current++;
    n--;
  }
  let max = 0;
  let run = 0;
  let prev = -Infinity;
  let perfects = 0;
  let played = 0;
  for (const k of Object.keys(records).map(Number).sort((a, z) => a - z)) {
    const r = records[k];
    played++;
    if (isPerfect(r)) perfects++;
    run = r.cleared ? (k === prev + 1 ? run + 1 : 1) : 0;
    prev = r.cleared ? k : -Infinity;
    if (run > max) max = run;
  }
  return { current, max: Math.max(max, current), perfects, played };
}

/** Emoji squares for the share text, one per lift, in the daily palette's order (see palette.ts DAILY_HEX). */
export const DAILY_SQUARES = ['🟧', '🟩', '🟪', '🟨', '🟦'] as const;

/**
 * The Wordle-style result to paste in a group chat:
 *
 *   Unfill Daily #42 · Sunday
 *   🟧🟩🟪🟨🟦🟧🟩🟪
 *   8 lifts · best possible 8 🏆
 */
export function shareText(r: DailyRecord, dayName: string, url = ''): string {
  const squares = r.layers.map(([c]) => DAILY_SQUARES[((c % 5) + 5) % 5]);
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 8) rows.push(squares.slice(i, i + 8).join(''));
  const verdict = !r.cleared
    ? `Out of moves · best possible ${r.best}`
    : isPerfect(r)
      ? `${r.lifts} lifts · best possible ${r.best} 🏆`
      : `${r.lifts} lifts · best possible ${r.best}`;
  return [`Unfill Daily #${r.n} · ${dayName}`, ...(rows.length ? rows : ['⬜']), verdict, ...(url ? [url] : [])].join('\n');
}
