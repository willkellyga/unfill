import { estimateBoardSeconds, grantFor, nextBoardPool, pickBoard, startPool, type LibraryEntry, type Pick, type SlackSchedule, type SlotRole } from '../../src/core';
import { Random, mixSeed } from '../../src/core';
import type { Samples } from './sample';

/**
 * Simulated 100-board sessions under a slack schedule (plan, milestone 3).
 *
 * Each board is attempted with the player's style. If an attempt needs more moves than the pool holds, the player
 * restarts the board (the pool goes back to its board-start value) and tries again, a little wiser each time: a
 * retry is played by the next sharper player. After three failed attempts the player follows the hints, which play
 * the stored par solution; that always fits, because the pool at board start is at least the board's grant.
 */
export type PlayerName = 'careful' | 'naive' | 'casual' | 'medium' | 'sharp';
export const PLAYERS: PlayerName[] = ['careful', 'medium', 'casual', 'sharp', 'naive'];

/** Who plays each attempt. `careful` and `naive` are the plan's deterministic players; the rest are sampled. */
const ATTEMPTS: Record<PlayerName, PlayerName[]> = {
  careful: ['careful', 'sharp', 'sharp'],
  naive: ['naive', 'casual', 'medium'],
  casual: ['casual', 'medium', 'sharp'],
  medium: ['medium', 'sharp', 'sharp'],
  sharp: ['sharp', 'sharp', 'sharp'],
};

export interface SessionResult {
  boards: number;
  /** Boards cleared on the first attempt. */
  firstTry: number;
  restarts: number;
  /** Boards finished by following the hints after three failed attempts. */
  hinted: number;
  /** Smallest pool at the start of a board, minus that board's par (the fairness margin; never below 0). */
  minMargin: number;
  finalPool: number;
  /** Pool after each board (for charts). */
  pools: number[];
  /** Per role: boards played and boards that needed a restart. */
  byRole: Record<SlotRole, { boards: number; failed: number }>;
  slackTotal: number;
  /** Moves above the bank cap, turned into stars or decorations. */
  overflow: number;
  /** Estimated play time after each board, in seconds from the start of the session (src/core/pacing.ts). */
  clock: number[];
}

/** The boards one session plays: picks depend only on the seed, not on the economy, so they're computed once. */
export function sessionPicks(boards: readonly LibraryEntry[], seed: number, count: number): Pick[] {
  const recent: string[] = [];
  const out: Pick[] = [];
  for (let n = 1; n <= count; n++) {
    const p = pickBoard(boards, n, seed, new Set(recent));
    out.push(p);
    recent.push(p.entry.id);
    if (recent.length > 200) recent.shift();
  }
  return out;
}

function excessFor(who: PlayerName, e: LibraryEntry, samples: Samples, R: Random): number {
  if (who === 'careful') return e.metrics.carefulGap;
  if (who === 'naive') return e.metrics.naiveGap;
  const runs = samples.boards[e.id][who];
  return runs[R.int(runs.length)];
}

export function simulateSession(picks: readonly Pick[], samples: Samples, schedule: SlackSchedule, player: PlayerName, seed: number): SessionResult {
  const R = new Random(mixSeed(seed, PLAYERS.indexOf(player), 0xa11));
  const roles: SlotRole[] = ['tutorial', 'build', 'peak', 'breather', 'cleanser'];
  const res: SessionResult = {
    boards: picks.length,
    firstTry: 0,
    restarts: 0,
    hinted: 0,
    minMargin: Infinity,
    finalPool: 0,
    pools: [],
    byRole: Object.fromEntries(roles.map((r) => [r, { boards: 0, failed: 0 }])) as SessionResult['byRole'],
    slackTotal: 0,
    overflow: 0,
    clock: [],
  };
  let clock = 0;
  let pool = 0;
  picks.forEach((p, i) => {
    const grant = grantFor(p.slot, p.entry, schedule);
    res.slackTotal += grant - p.entry.par;
    if (i === 0) pool = startPool(grant, schedule).moves;
    else {
      const next = nextBoardPool({ moves: pool, atBoardStart: pool }, grant, schedule);
      res.overflow += next.overflow;
      pool = next.moves;
    }
    res.minMargin = Math.min(res.minMargin, pool - p.entry.par);
    const role = res.byRole[p.slot.role];
    role.boards++;
    let used = -1;
    let fails = 0;
    let taps = 0;
    for (const who of ATTEMPTS[player]) {
      const need = p.entry.par + excessFor(who, p.entry, samples, R);
      if (need <= pool) {
        used = need;
        break;
      }
      fails++;
      taps += pool; // ran out of moves partway
    }
    if (used < 0) {
      // Three failed attempts: follow the hints (the par solution), which always fits.
      used = p.entry.par;
      res.hinted++;
    }
    taps += used;
    clock += estimateBoardSeconds(taps, fails);
    res.clock.push(clock);
    if (fails === 0) res.firstTry++;
    else role.failed++;
    res.restarts += fails;
    if (pool - used < 0) throw new Error('fairness broken: the par solution does not fit the pool');
    pool -= used;
    res.pools.push(pool);
  });
  res.finalPool = pool;
  return res;
}
