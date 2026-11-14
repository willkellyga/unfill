import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PAR_QUANTILES,
  Random,
  Session,
  TUNING,
  attachParCurves,
  baseChance,
  decodeExtras,
  encodeExtras,
  findGroups,
  parChance,
  shownPar,
  slotFor,
  tunedGrant,
  tunedPar,
  type Library,
  type ParCurves,
  type SlotRole,
} from '../src/core';
import { loadWorld, planFor } from '../gen/tuning/simulate';

const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));
const curves: ParCurves = JSON.parse(readFileSync(new URL('../src/library/par-curves.json', import.meta.url), 'utf8'));
const boards = attachParCurves(library.boards, curves);
const ROLES: SlotRole[] = ['tutorial', 'build', 'peak', 'breather', 'cleanser'];

describe('par curves', () => {
  it('cover every board, with quantiles that never go down', () => {
    expect(curves.quantiles).toEqual(PAR_QUANTILES);
    for (const b of boards) {
      expect(b.curve, b.id).toBeDefined();
      expect(b.curve!.length).toBe(PAR_QUANTILES.length);
      for (let i = 1; i < b.curve!.length; i++) expect(b.curve![i]).toBeGreaterThanOrEqual(b.curve![i - 1]);
    }
  });

  it('encode and decode round-trip', () => {
    const xs = [-5, -1, 0, 1, 9, 30];
    expect(decodeExtras(encodeExtras(xs))).toEqual(xs);
  });
});

describe('tuning guarantees (Will: par beatable; the moves a level gives back are enough to beat par)', () => {
  it('par is always at least solver par + 1, and every level gives back enough moves to beat it', () => {
    expect(TUNING.minCushion).toBeGreaterThanOrEqual(1);
    for (const b of boards)
      for (const n of [1, 5, 12, 25, 40, 60, 90, 150])
        for (const role of ROLES) {
          const p = tunedPar(n, role, b);
          expect(p).toBeGreaterThanOrEqual(b.par + 1);
          expect(tunedGrant(p, role)).toBeGreaterThanOrEqual(p - 1);
        }
  });

  it('par gets harder the longer the run goes: the make-par chance never rises with the level', () => {
    for (let n = 2; n <= 200; n++) expect(baseChance(n)).toBeLessThanOrEqual(baseChance(n - 1));
    expect(parChance(1, 'tutorial')).toBeGreaterThan(parChance(80, 'build'));
    // and the sawtooth: peaks are stricter than builds, breathers easier
    expect(parChance(30, 'peak')).toBeLessThan(parChance(30, 'build'));
    expect(parChance(30, 'breather')).toBeGreaterThan(parChance(30, 'build'));
  });

  it('a session shows tunedPar and every level starts with enough moves to beat par', () => {
    for (const seed of [1, 2, 3]) {
      const s = new Session(boards, seed);
      s.begin(1, true);
      const R = new Random(seed);
      for (let guard = 0; guard < 4000 && !s.over; guard++) {
        if (s.lifts === 0) {
          expect(s.par).toBe(shownPar(s.n, s.pick.entry));
          expect(s.par).toBe(tunedPar(s.n, slotFor(s.n).role, s.pick.entry));
          expect(s.pool.moves).toBeGreaterThanOrEqual(s.par - 1);
          expect(s.grant).toBeGreaterThanOrEqual(s.par - 1);
          // and the stored solution (solver par) always fits
          expect(s.pool.moves).toBeGreaterThanOrEqual(s.pick.entry.par);
        }
        const groups = findGroups(s.cur.board).groups;
        s.lift(groups[R.int(groups.length)][0]);
        if (s.cleared) {
          expect(s.shelf[s.shelf.length - 1].id).toBe(s.pick.entry.id);
          s.next();
        }
      }
    }
  });

  it("the bot simulator's fast par plan matches the game's", () => {
    const w = loadWorld(3, 80);
    const plan = planFor(w, TUNING);
    w.picks.forEach((row, s) =>
      row.forEach((b, i) => {
        const p = tunedPar(i + 1, w.roles[i], w.boards[b]);
        expect(plan.par[s][i]).toBe(p);
        expect(plan.grant[s][i]).toBe(tunedGrant(p, w.roles[i]));
      }),
    );
  });
});
