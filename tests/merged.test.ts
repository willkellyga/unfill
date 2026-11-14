import { describe, expect, it } from 'vitest';
import { groupMasks, NB, neighborMask } from '../src/app/game/merged';

describe('joined sand masks', () => {
  // 3x3 grid, rows from the top:  A A .
  //                               A A B
  //                               . A B
  const g = [0, 0, -1, 0, 0, 1, -1, 0, 1];
  const mask = (i: number) => neighborMask(i, 3, 3, (j) => g[j] === g[i]);

  it('joins edge neighbors of one color, and the diagonal only inside a full 2x2', () => {
    expect(mask(0)).toBe(NB.R | NB.D | NB.DR);
    expect(mask(4)).toBe(NB.L | NB.U | NB.D | NB.UL);
    expect(mask(5)).toBe(NB.D);
    expect(mask(7)).toBe(NB.U);
  });

  it('never joins across the grid edge', () => {
    expect(mask(2)).toBe(0);
    expect(neighborMask(2, 3, 1, () => true)).toBe(NB.L);
  });

  it('agrees with the grid masks for a piece in flight (y up)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: -2 },
    ];
    const m = groupMasks(pts, () => true);
    expect(m[0]).toBe(NB.R | NB.D | NB.DR);
    expect(m[3]).toBe(NB.L | NB.U | NB.D | NB.UL);
    // a block that has started to melt joins nothing, and nothing joins it
    const m2 = groupMasks(pts, (k) => k !== 4);
    expect(m2[4]).toBe(0);
    expect(m2[3]).toBe(NB.L | NB.U | NB.UL);
  });
});
