import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EMPTY,
  Random,
  beamSolve,
  boardKey,
  canonicalKey,
  carefulPlay,
  countGroups,
  exactSolve,
  findGroups,
  generateBoard,
  isCleared,
  lift,
  mirrorBoard,
  naivePlay,
  noisyPlay,
  permutations,
  recolorBoard,
  replay,
  type Board,
} from '../src/core';

const rule = 'column' as const;

const smallBoard = fc
  .record({
    rows: fc.integer({ min: 2, max: 5 }),
    cols: fc.integer({ min: 2, max: 4 }),
    colors: fc.integer({ min: 2, max: 3 }),
    seed: fc.integer(),
  })
  .map(({ rows, cols, colors, seed }) => generateBoard({ rows, cols, colors }, seed));

/** True minimum by breadth-first search over every reachable board. Only for tiny boards. */
function bfsMinimum(start: Board): number {
  let layer = new Map([[boardKey(start), start]]);
  for (let depth = 0; ; depth++) {
    const next = new Map<string, Board>();
    for (const b of layer.values()) {
      if (isCleared(b)) return depth;
      for (const g of findGroups(b).groups) {
        const child = lift(b, g[0], rule)!.board;
        next.set(boardKey(child), child);
      }
    }
    layer = next;
  }
}

describe('solver', () => {
  it('countGroups agrees with findGroups', () => {
    fc.assert(
      fc.property(smallBoard, fc.integer({ min: 0, max: 30 }), (b, holes) => {
        const c = b.cells.slice();
        const R = new Random(holes);
        for (let k = 0; k < holes; k++) c[R.int(c.length)] = EMPTY;
        const h = { ...b, cells: c };
        expect(countGroups(h)).toBe(findGroups(h).groups.length);
      }),
      { numRuns: 500 },
    );
  });

  it('beam and exact solutions replay to empty, and exact search finds the true minimum on tiny boards', () => {
    fc.assert(
      fc.property(smallBoard, (b) => {
        const beam = beamSolve(b, rule, 50);
        expect(isCleared(replay(b, beam, rule))).toBe(true);
        const ex = exactSolve(b, rule, beam.length, 1_000_000);
        expect(ex.complete).toBe(true);
        expect(ex.taps).not.toBeNull();
        expect(isCleared(replay(b, ex.taps!, rule))).toBe(true);
        expect(ex.taps!.length).toBe(bfsMinimum(b));
        expect(beam.length).toBeGreaterThanOrEqual(ex.taps!.length);
        // Asking for anything shorter than the minimum finds nothing, and says the search was complete.
        const none = exactSolve(b, rule, ex.taps!.length - 1, 1_000_000);
        expect(none).toMatchObject({ complete: true, taps: null });
      }),
      { numRuns: 120 },
    );
  });

  it('exact search reports an incomplete search when the node budget runs out', () => {
    const b = generateBoard({ rows: 10, cols: 8, colors: 4 }, 1);
    const res = exactSolve(b, rule, 9, 50);
    expect(res.complete).toBe(false);
    expect(res.taps).toBeNull();
  });

  it('solutions carry over to mirrored and recolored boards', () => {
    const b = generateBoard({ rows: 8, cols: 7, colors: 3 }, 42);
    const taps = beamSolve(b, rule, 100);
    const m = mirrorBoard(b);
    const mt = taps.map((t) => t - (t % 7) + (6 - (t % 7)));
    expect(isCleared(replay(m, mt, rule))).toBe(true);
    for (const perm of permutations(3)) expect(isCleared(replay(recolorBoard(b, perm), taps, rule))).toBe(true);
  });

  it('players always finish, and are deterministic', () => {
    const b = generateBoard({ rows: 9, cols: 8, colors: 4 }, 7);
    expect(isCleared(replay(b, carefulPlay(b, rule), rule))).toBe(true);
    expect(isCleared(replay(b, naivePlay(b, rule), rule))).toBe(true);
    const player = { weights: [16, 4, 1], lookahead: 1 as const };
    const a = Array.from({ length: 5 }, ((R) => () => noisyPlay(b, rule, player, R))(new Random(3)));
    const z = Array.from({ length: 5 }, ((R) => () => noisyPlay(b, rule, player, R))(new Random(3)));
    expect(a).toEqual(z);
    const par = beamSolve(b, rule, 200).length;
    for (const moves of a) expect(moves).toBeGreaterThanOrEqual(par - 2);
  });

  it('canonicalKey is the same for a board, its mirror and any recoloring, and differs otherwise', () => {
    fc.assert(
      fc.property(smallBoard, fc.integer({ min: 0, max: 5 }), (b, p) => {
        const perm = permutations(3)[p];
        const safe = b.cells.every((v) => v < 3) ? perm : [0, 1, 2];
        const k = canonicalKey(b);
        expect(canonicalKey(mirrorBoard(b))).toBe(k);
        expect(canonicalKey(recolorBoard(b, safe))).toBe(k);
      }),
      { numRuns: 300 },
    );
    const a = generateBoard({ rows: 6, cols: 5, colors: 3 }, 1);
    const z = generateBoard({ rows: 6, cols: 5, colors: 3 }, 2);
    expect(canonicalKey(a)).not.toBe(canonicalKey(z));
  });

  it('permutations lists every color order once', () => {
    expect(permutations(3)).toEqual([
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]);
    expect(new Set(permutations(5).map((p) => p.join(''))).size).toBe(120);
  });
});
