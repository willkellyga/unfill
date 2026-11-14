import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SLACK,
  grantFor,
  nextBoardPool,
  refundMove,
  restartBoard,
  slackFor,
  spendMove,
  startPool,
  type Library,
  type SlotRole,
} from '../src/core';
import { evaluateSchedule, makeSessions } from '../gen/economy/tune';
import type { Samples } from '../gen/economy/sample';
import { sessionPicks } from '../gen/economy/simulate';

const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));
const samples: Samples = JSON.parse(readFileSync(new URL('../gen/economy/samples.json', import.meta.url), 'utf8'));
const ROLES: SlotRole[] = ['tutorial', 'build', 'peak', 'breather', 'cleanser'];

describe('grants', () => {
  it('every library board, in every role, gets a whole-number grant of at least par', () => {
    for (const e of library.boards) {
      for (const role of ROLES) {
        const slack = slackFor({ role }, e);
        expect(Number.isInteger(slack)).toBe(true);
        expect(slack).toBeGreaterThanOrEqual(0);
        expect(slack).toBeLessThanOrEqual(SLACK.max);
        expect(grantFor({ role }, e)).toBe(e.par + slack);
      }
    }
  });

  it('rides the sawtooth: on the same board a peak gives the least slack and a breather the most', () => {
    for (const e of library.boards) {
      const s = (role: SlotRole) => slackFor({ role }, e);
      expect(s('peak')).toBeLessThanOrEqual(s('build'));
      expect(s('build')).toBeLessThanOrEqual(s('breather'));
    }
  });

  it('a harder-rated board gets at least as much slack in the same role', () => {
    const tier = library.boards.filter((b) => b.tier === 5).sort((a, z) => a.metrics.excess100 - z.metrics.excess100);
    for (let i = 1; i < tier.length; i++) expect(slackFor({ role: 'build' }, tier[i])).toBeGreaterThanOrEqual(slackFor({ role: 'build' }, tier[i - 1]));
  });
});

describe('move pool', () => {
  it('starts with board 1 grant plus the welcome gift; spend, undo and restart behave', () => {
    const p = startPool(10);
    expect(p).toEqual({ moves: 10 + SLACK.welcomeGift, atBoardStart: 10 + SLACK.welcomeGift });
    const spent = spendMove(spendMove(p)!)!;
    expect(spent.moves).toBe(p.moves - 2);
    expect(refundMove(spent).moves).toBe(p.moves - 1);
    expect(refundMove(p).moves).toBe(p.moves); // never above the board-start value
    expect(restartBoard(spent)).toEqual(p);
    expect(spendMove({ moves: 0, atBoardStart: 5 })).toBeNull();
  });

  it('carries leftovers over up to the bank cap and reports the overflow', () => {
    const cap = SLACK.bankCap!;
    expect(nextBoardPool({ moves: 3, atBoardStart: 20 }, 12)).toEqual({ moves: 15, atBoardStart: 15, overflow: 0 });
    expect(nextBoardPool({ moves: cap + 7, atBoardStart: 40 }, 12)).toEqual({ moves: cap + 12, atBoardStart: cap + 12, overflow: 7 });
    expect(nextBoardPool({ moves: 50, atBoardStart: 60 }, 12, { ...SLACK, bankCap: null }).moves).toBe(62);
  });

  it('fairness: however moves are spent, undone or restarted, every board starts with at least its par', () => {
    const picks = sessionPicks(library.boards, 7, 120);
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(30), fc.boolean()), { minLength: 120, maxLength: 120 }), (plays) => {
        let pool = startPool(grantFor(picks[0].slot, picks[0].entry));
        picks.forEach((p, i) => {
          if (i > 0) pool = nextBoardPool(pool, grantFor(p.slot, p.entry));
          expect(pool.moves).toBeGreaterThanOrEqual(p.entry.par);
          const [wasted, restart] = plays[i];
          // Spend some moves exploring, maybe restart, then finish with the stored solution (par moves).
          for (let k = 0; k < wasted; k++) pool = spendMove(pool) ?? pool;
          if (restart || pool.moves < p.entry.par) pool = restartBoard(pool);
          for (let k = 0; k < Math.min(wasted, pool.moves - p.entry.par); k++) pool = spendMove(pool)!;
          for (let k = 0; k < p.entry.par; k++) {
            const next = spendMove(pool);
            expect(next).not.toBeNull();
            pool = next!;
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe('simulated 100-board sessions (plan milestone 3 targets)', () => {
  const res = evaluateSchedule(makeSessions(library), samples, SLACK);

  it('the careful player clears at least 90% of boards without a restart', () => {
    expect(res.careful.firstTry).toBeGreaterThanOrEqual(0.9);
    expect(res.careful.worstFirstTry).toBeGreaterThanOrEqual(0.85);
  });

  it('the naive player needs restarts but always recovers, and nobody restarts a tutorial board', () => {
    expect(res.naive.restartsPer100).toBeGreaterThan(0);
    for (const p of Object.values(res)) {
      expect(p.minMargin).toBeGreaterThanOrEqual(0);
      expect(p.failByRole.tutorial).toBe(0);
    }
  });

  it('a typical player feels the sawtooth: restarts mostly on peaks, rarely on breathers', () => {
    const f = res.medium.failByRole;
    expect(res.medium.firstTry).toBeGreaterThanOrEqual(0.85);
    expect(f.peak).toBeGreaterThan(f.build);
    expect(f.build).toBeGreaterThan(f.breather);
    expect(f.breather).toBeLessThanOrEqual(0.05);
  });

  it('fits a Block Blast-length session (about 12 minutes): one wave per session for a typical player', () => {
    const pace = res.medium.pace;
    for (const [, [median]] of Object.entries(pace.waveMinutes)) {
      expect(median).toBeGreaterThanOrEqual(10);
      expect(median).toBeLessThanOrEqual(14);
    }
    // The first session ends on the first 7×8 breather (board 15) at about 12 minutes.
    expect(pace.minutesToBoard15).toBeGreaterThanOrEqual(10);
    expect(pace.minutesToBoard15).toBeLessThanOrEqual(15);
  });

  it('the bank cap keeps a strong player\'s pool near one board\'s worth', () => {
    expect(res.sharp.maxFinalPool).toBeLessThanOrEqual(SLACK.bankCap! + 8);
  });
});
