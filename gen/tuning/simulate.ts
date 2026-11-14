/**
 * Bot runs for milestone 7: whole runs played the way the game plays now (Will, Nov 14): continuous levels, no
 * undo or restart, the run ends the moment the moves run out.
 *
 * A bot's moves on a board don't depend on its move pool (it plays the board the same way either way), so a run
 * draws each level's moves from the recorded games in samples.json instead of replaying them. That makes a run of
 * 60 levels take microseconds, so a tuning search can afford millions of them.
 */
import { readFileSync } from 'node:fs';
import {
  Random,
  SECONDS_PER_BOARD,
  SECONDS_PER_TAP,
  mixSeed,
  pickBoard,
  pointsFor,
  type Library,
  type LibraryEntry,
  type SlotRole,
} from '../../src/core';
import { MIN_BONUS, PAR_QUANTILES, attachParCurves, decodeExtras, parChance, parChanceExtra, type ParCurves, type Tuning } from '../../src/core/tuning';

export const BOTS = ['casual', 'medium', 'sharp', 'careful'] as const;
export type Bot = (typeof BOTS)[number];
/** What each bot stands for, for reports. */
export const BOT_LABEL: Record<Bot, string> = {
  casual: 'casual (quick, loose taps)',
  medium: 'typical',
  sharp: 'sharp (thinks two taps ahead)',
  careful: 'careful (same greedy line every time)',
};

export const ROLES: SlotRole[] = ['tutorial', 'build', 'peak', 'breather', 'cleanser'];
/** Longest run simulated; a run still going here counts as "still going". */
export const MAX_LEVELS = 200;
/** Level bands for per-level rates. */
export const BANDS: [number, number][] = [
  [1, 10],
  [11, 20],
  [21, 30],
  [31, 45],
  [46, 60],
  [61, 80],
  [81, MAX_LEVELS],
];

export interface World {
  boards: (LibraryEntry & { curve?: number[] })[];
  /** Board index per seed per level (0-based level). */
  picks: Int32Array[];
  roles: SlotRole[];
  /** Recorded extra moves over solver par: per bot, per board. */
  games: Record<Bot, Int8Array[]>;
}

export function loadWorld(seeds: number, levels = MAX_LEVELS): World {
  const lib: Library = JSON.parse(readFileSync(new URL('../../src/library/boards.json', import.meta.url), 'utf8'));
  const curves: ParCurves = JSON.parse(readFileSync(new URL('../../src/library/par-curves.json', import.meta.url), 'utf8'));
  const samples: { boards: Record<string, Record<string, string>> } = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
  const boards = attachParCurves(lib.boards, curves);
  const index = new Map(boards.map((b, i) => [b.id, i]));
  const picks: Int32Array[] = [];
  const roles: SlotRole[] = [];
  for (let s = 0; s < seeds; s++) {
    const recent: string[] = [];
    const row = new Int32Array(levels);
    for (let n = 1; n <= levels; n++) {
      const p = pickBoard(lib.boards, n, mixSeed(0x7e57, s), new Set(recent));
      row[n - 1] = index.get(p.entry.id)!;
      if (s === 0) roles.push(p.slot.role);
      recent.push(p.entry.id);
      if (recent.length > 200) recent.shift();
    }
    picks.push(row);
  }
  const games = Object.fromEntries(BOTS.map((b) => [b, boards.map((e) => Int8Array.from(decodeExtras(samples.boards[e.id][b])))])) as World['games'];
  return { boards, picks, roles, games };
}

/** Per level number: how the levels played there went. */
export interface LevelTally {
  played: number;
  beat: number;
  par: number;
  over: number;
  /** Ran out of moves here: the run ended. */
  out: number;
  /** Sum of moves banked after clearing (for the average bank curve). */
  bank: number;
}

export interface BatchResult {
  bot: Bot;
  runs: number;
  /** Levels cleared per run. */
  levels: number[];
  /** Estimated minutes per run (src/core/pacing.ts). */
  minutes: number[];
  scores: number[];
  /** Runs still going at MAX_LEVELS. */
  capped: number;
  /** Role of the level where each finished run ran out. */
  endRole: Record<SlotRole, number>;
  /** How many moves short each finished run was (1 = one more move would have done it). */
  short: number[];
  byLevel: LevelTally[];
  /** Levels started with fewer moves than par (par out of reach; beating it needs par − 1, so that may still fit). */
  poolBelowPar: number;
  /** Levels started with too few moves even to beat par. Must stay 0. */
  poolCantBeat: number;
  /** Guarantees, must stay 0: a grant too small to beat par, a par the solver can't beat. */
  grantBelowPar: number;
  parNotBeatable: number;
  /** Levels played in all (for rates). */
  played: number;
}

/** Shown par and grant per seed per level, for one tuning. */
export interface Plan {
  par: Int16Array[];
  grant: Int16Array[];
}

export function planFor(w: World, t: Tuning): Plan {
  // Same numbers as tunedPar/tunedGrant (tests/tuning.test.ts checks), computed level by level for speed.
  const levels = w.picks[0]?.length ?? 0;
  const qi = Int8Array.from({ length: levels }, (_, i) => PAR_QUANTILES.indexOf(parChance(i + 1, w.roles[i], t)));
  const bonus = Int16Array.from({ length: levels }, (_, i) => Math.max(MIN_BONUS, t.bonus[w.roles[i]]));
  const par: Int16Array[] = [];
  const grant: Int16Array[] = [];
  for (const row of w.picks) {
    const p = new Int16Array(row.length);
    const g = new Int16Array(row.length);
    for (let i = 0; i < row.length; i++) {
      const e = w.boards[row[i]];
      const extra = e.curve ? e.curve[qi[i]] : parChanceExtra(e, PAR_QUANTILES[qi[i]]);
      p[i] = e.par + Math.max(t.minCushion, extra);
      g[i] = p[i] + bonus[i];
    }
    par.push(p);
    grant.push(g);
  }
  return { par, grant };
}

export function runBatch(w: World, plan: Plan, t: Tuning, bot: Bot, runs: number, seed = 1, levels = MAX_LEVELS): BatchResult {
  const R = new Random(mixSeed(seed, BOTS.indexOf(bot), 0x5e55));
  const res: BatchResult = {
    bot,
    runs,
    levels: [],
    minutes: [],
    scores: [],
    capped: 0,
    endRole: Object.fromEntries(ROLES.map((r) => [r, 0])) as BatchResult['endRole'],
    short: [],
    byLevel: Array.from({ length: levels }, () => ({ played: 0, beat: 0, par: 0, over: 0, out: 0, bank: 0 })),
    poolBelowPar: 0,
    poolCantBeat: 0,
    grantBelowPar: 0,
    parNotBeatable: 0,
    played: 0,
  };
  const games = w.games[bot];
  for (let r = 0; r < runs; r++) {
    const s = r % w.picks.length;
    const row = w.picks[s];
    const pars = plan.par[s];
    const grants = plan.grant[s];
    let bank = 0;
    let seconds = 0;
    let score = 0;
    let cleared = 0;
    let ended = false;
    for (let i = 0; i < levels; i++) {
      const b = row[i];
      const e = w.boards[b];
      const shown = pars[i];
      const grant = grants[i];
      const pool = Math.min(bank, t.bankCap) + grant + (i === 0 ? t.welcomeGift : 0);
      res.played++;
      if (pool < shown) res.poolBelowPar++;
      if (pool < shown - 1) res.poolCantBeat++;
      if (grant < shown - 1) res.grantBelowPar++;
      if (shown <= e.par) res.parNotBeatable++;
      const g = games[b];
      const lifts = e.par + g[g.length === 1 ? 0 : R.int(g.length)];
      const tally = res.byLevel[i];
      tally.played++;
      if (lifts > pool) {
        tally.out++;
        seconds += SECONDS_PER_BOARD + pool * SECONDS_PER_TAP;
        res.endRole[w.roles[i]]++;
        res.short.push(lifts - pool);
        ended = true;
        break;
      }
      if (lifts < shown) tally.beat++;
      else if (lifts === shown) tally.par++;
      else tally.over++;
      bank = pool - lifts;
      tally.bank += Math.min(bank, t.bankCap);
      seconds += SECONDS_PER_BOARD + lifts * SECONDS_PER_TAP;
      score += pointsFor(lifts, shown);
      cleared++;
    }
    if (!ended) res.capped++;
    res.levels.push(cleared);
    res.minutes.push(seconds / 60);
    res.scores.push(score);
  }
  return res;
}

export const quantile = (xs: readonly number[], q: number): number => {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, z) => x - z);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
};

export interface BandRates {
  band: [number, number];
  played: number;
  /** Shares of levels played in the band, in percent. */
  beat: number;
  par: number;
  over: number;
  out: number;
  /** Made par or better. */
  makePar: number;
}

export function bandRates(res: BatchResult): BandRates[] {
  return BANDS.map(([a, z]) => {
    const t = { played: 0, beat: 0, par: 0, over: 0, out: 0 };
    for (let n = a; n <= Math.min(z, res.byLevel.length); n++) {
      const l = res.byLevel[n - 1];
      t.played += l.played;
      t.beat += l.beat;
      t.par += l.par;
      t.over += l.over;
      t.out += l.out;
    }
    const pct = (x: number) => (t.played ? (100 * x) / t.played : NaN);
    return { band: [a, z], played: t.played, beat: pct(t.beat), par: pct(t.par), over: pct(t.over), out: pct(t.out), makePar: pct(t.beat + t.par) };
  });
}

export interface Summary {
  bot: Bot;
  runs: number;
  medianMinutes: number;
  p10Minutes: number;
  p25Minutes: number;
  p75Minutes: number;
  p90Minutes: number;
  under5: number;
  medianLevels: number;
  p10Levels: number;
  p90Levels: number;
  capped: number;
  medianScore: number;
  /** Shares of all cleared levels, in percent. */
  mix: { beat: number; par: number; over: number };
  bands: BandRates[];
  /** Shares of finished runs, in percent. */
  endOnPeak: number;
  shortBy3: number;
  shortBy1: number;
  /** Share (%) of levels started with fewer moves than par. */
  outOfReach: number;
  fairness: { poolCantBeat: number; grantBelowPar: number; parNotBeatable: number };
}

export function summarize(res: BatchResult): Summary {
  let beat = 0;
  let par = 0;
  let over = 0;
  for (const l of res.byLevel) {
    beat += l.beat;
    par += l.par;
    over += l.over;
  }
  const cleared = beat + par + over;
  const finished = res.runs - res.capped;
  return {
    bot: res.bot,
    runs: res.runs,
    medianMinutes: quantile(res.minutes, 0.5),
    p10Minutes: quantile(res.minutes, 0.1),
    p25Minutes: quantile(res.minutes, 0.25),
    p75Minutes: quantile(res.minutes, 0.75),
    p90Minutes: quantile(res.minutes, 0.9),
    under5: (100 * res.minutes.filter((m) => m < 5).length) / res.runs,
    medianLevels: quantile(res.levels, 0.5),
    p10Levels: quantile(res.levels, 0.1),
    p90Levels: quantile(res.levels, 0.9),
    capped: (100 * res.capped) / res.runs,
    medianScore: quantile(res.scores, 0.5),
    mix: { beat: (100 * beat) / cleared, par: (100 * par) / cleared, over: (100 * over) / cleared },
    bands: bandRates(res),
    endOnPeak: finished ? (100 * res.endRole.peak) / finished : NaN,
    shortBy3: finished ? (100 * res.short.filter((x) => x <= 3).length) / finished : NaN,
    shortBy1: finished ? (100 * res.short.filter((x) => x <= 1).length) / finished : NaN,
    outOfReach: (100 * res.poolBelowPar) / res.played,
    fairness: { poolCantBeat: res.poolCantBeat, grantBelowPar: res.grantBelowPar, parNotBeatable: res.parNotBeatable },
  };
}
