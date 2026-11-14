import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  LIBRARY_RULE,
  canonicalKey,
  carefulPlay,
  entryBoard,
  findGroups,
  isCleared,
  lift,
  liftSizes,
  naivePlay,
  permutations,
  transformEntry,
  type Library,
  type LibraryEntry,
} from '../src/core';
import { evaluate } from '../gen/evaluate';
import { TIERS, tierFailures } from '../gen/tiers';

/**
 * The fairness guarantee, checked on every shipped board: its stored solution empties the tray in exactly `par`
 * moves under the game's own rules code. Also mirrored, and in every color order.
 */
const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));
const boards = library.boards;

/** Play a solution tap by tap; every tap must lift something, and the tray empties on the last tap only. */
function playsToEmpty(e: LibraryEntry, mirror: boolean, perm: number[]): string | null {
  const { board, solution } = transformEntry(e, { mirror, perm });
  if (solution.length !== e.par) return `solution has ${solution.length} moves, par is ${e.par}`;
  let b = board;
  for (let m = 0; m < solution.length; m++) {
    if (isCleared(b)) return `tray empty before move ${m + 1}`;
    const res = lift(b, solution[m], LIBRARY_RULE);
    if (!res) return `move ${m + 1} taps an empty cell`;
    b = res.board;
  }
  return isCleared(b) ? null : 'tray not empty after the last move';
}

describe('board library', () => {
  it('has at least 2,000 boards, every tier filled, unique ids and no duplicate boards (even mirrored or recolored)', () => {
    expect(library.rule).toBe(LIBRARY_RULE);
    expect(boards.length).toBeGreaterThanOrEqual(2000);
    for (const t of TIERS) expect(boards.filter((b) => b.tier === t.tier).length).toBe(t.count);
    expect(new Set(boards.map((b) => b.id)).size).toBe(boards.length);
    expect(new Set(boards.map((b) => canonicalKey(entryBoard(b)))).size).toBe(boards.length);
  });

  it('every board is a full tray of its tier size, using only its colors', () => {
    for (const e of boards) {
      const t = TIERS.find((x) => x.tier === e.tier)!;
      expect([e.cols, e.rows, e.colors]).toEqual([t.cols, t.rows, t.colors]);
      const b = entryBoard(e);
      expect(b.cells.length).toBe(e.cols * e.rows);
      for (const v of b.cells) {
        expect(v).not.toBe(EMPTY);
        expect(v).toBeLessThan(e.colors);
      }
    }
  });

  for (const t of TIERS) {
    it(`tier ${t.tier} (${t.cols}×${t.rows}, ${t.colors} colors): every board, mirrored and in every color order, empties in exactly par moves`, () => {
      const perms = permutations(t.colors);
      let checked = 0;
      for (const e of boards.filter((b) => b.tier === t.tier)) {
        for (const mirror of [false, true]) {
          for (const perm of perms) {
            const err = playsToEmpty(e, mirror, perm);
            if (err) throw new Error(`${e.id} mirror=${mirror} perm=${perm.join('')}: ${err}`);
            checked++;
          }
        }
      }
      expect(checked).toBe(t.count * 2 * perms.length);
    }, 120_000);
  }

  it('every board sits in its tier target ranges, and its stored metrics match a fresh measurement', () => {
    for (const e of boards) {
      const t = TIERS.find((x) => x.tier === e.tier)!;
      expect(tierFailures(t, e), e.id).toEqual([]);
      const b = entryBoard(e);
      expect(findGroups(b).groups.length, e.id).toBe(e.metrics.opening);
      expect(liftSizes(b, e.solution, LIBRARY_RULE).filter((s) => s === 1).length, e.id).toBe(e.metrics.singles);
      expect(carefulPlay(b, LIBRARY_RULE).length - e.par, e.id).toBe(e.metrics.carefulGap);
      expect(naivePlay(b, LIBRARY_RULE).length - e.par, e.id).toBe(e.metrics.naiveGap);
    }
  }, 120_000);

  it('difficulty ranks follow the rating within each tier', () => {
    for (const t of TIERS) {
      const tier = boards.filter((b) => b.tier === t.tier).sort((a, z) => a.rank - z.rank);
      expect(tier[0].rank).toBe(0);
      for (let i = 1; i < tier.length; i++) {
        expect(tier[i].rank).toBeGreaterThan(tier[i - 1].rank);
        expect(tier[i].metrics.excess100).toBeGreaterThanOrEqual(tier[i - 1].metrics.excess100);
      }
    }
  });

  it('the generator is deterministic: sampled boards rebuild exactly from their tier and index', () => {
    for (const t of TIERS) {
      const tier = boards.filter((b) => b.tier === t.tier);
      for (const e of [tier[0], tier[Math.floor(tier.length / 2)]]) {
        const c = evaluate(t, e.index);
        expect(c.ok).toBe(true);
        if (!c.ok) continue;
        const { id: _id, rank: _rank, ...stored } = e;
        expect(c.entry).toEqual(stored);
      }
    }
  }, 120_000);
});
