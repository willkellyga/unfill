import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  EMPTY,
  boardsEqual,
  cloneBoard,
  colorCounts,
  countBlocks,
  findGroups,
  fromRows,
  generateBoard,
  isCleared,
  isSettled,
  lift,
  mirrorBoard,
  mirrorCell,
  recolorBoard,
  replay,
  settle,
  toRows,
  RULE_NAMES,
  Random,
  type Board,
  type RuleName,
} from '../src/core';

// ---------- arbitraries ----------

/** Any board, including floating blocks and holes (what's left right after a lift is like this). */
const anyBoard = fc
  .record({
    rows: fc.integer({ min: 1, max: 10 }),
    cols: fc.integer({ min: 1, max: 9 }),
    colors: fc.integer({ min: 1, max: 5 }),
    holeWeight: fc.integer({ min: 0, max: 3 }),
  })
  .chain(({ rows, cols, colors, holeWeight }) =>
    fc
      .array(fc.integer({ min: -holeWeight, max: colors - 1 }), { minLength: rows * cols, maxLength: rows * cols })
      .map((arr): Board => ({ rows, cols, cells: Int8Array.from(arr, (v) => (v < 0 ? EMPTY : v)) })),
  );

/** Boards that are mirror-symmetric in shape but not in color, the hardest case for mirror-safe tie-breaks. */
const nearSymmetricBoard = fc
  .record({
    rows: fc.integer({ min: 2, max: 10 }),
    cols: fc.integer({ min: 2, max: 9 }),
    colors: fc.integer({ min: 1, max: 4 }),
  })
  .chain(({ rows, cols, colors }) =>
    fc
      .record({
        heights: fc.array(fc.integer({ min: 0, max: rows }), { minLength: cols, maxLength: cols }),
        paint: fc.array(fc.integer({ min: 0, max: colors - 1 }), { minLength: rows * cols, maxLength: rows * cols }),
      })
      .map(({ heights, paint }): Board => {
        const cells = new Int8Array(rows * cols).fill(EMPTY);
        for (let c = 0; c < cols; c++) {
          const h = Math.max(heights[c], heights[cols - 1 - c]); // symmetric skyline
          for (let k = 0; k < h; k++) {
            const i = (rows - 1 - k) * cols + c;
            cells[i] = paint[i];
          }
        }
        return { rows, cols, cells };
      }),
  );

/** Real boards from the generator at every size the plan uses, plus a few smaller ones. */
const generatedBoard = fc
  .record({
    rows: fc.integer({ min: 4, max: 10 }),
    cols: fc.integer({ min: 3, max: 8 }),
    colors: fc.integer({ min: 3, max: 5 }),
    seed: fc.integer({ min: 0, max: 0x7fffffff }),
  })
  .map(({ rows, cols, colors, seed }) => generateBoard({ rows, cols, colors }, seed));

const ruleArb = fc.constantFrom<RuleName>(...RULE_NAMES);

function settled(b: Board, rule: RuleName) {
  const out = cloneBoard(b);
  const stats = settle(out, rule);
  return { out, stats };
}

const permutations = (n: number): fc.Arbitrary<number[]> =>
  fc.array(fc.nat(), { minLength: n, maxLength: n }).map((keys) =>
    keys.map((k, i) => [k, i] as const).sort((a, z) => a[0] - z[0] || a[1] - z[1]).map(([, i]) => i),
  );

/** Play a game with random taps (seeded); calls back after every move. */
function playRandom(b: Board, rule: RuleName, seed: number, onMove?: (tap: number, before: Board, after: Board) => void) {
  const R = new Random(seed);
  let cur = b;
  let moves = 0;
  while (!isCleared(cur)) {
    const filled: number[] = [];
    for (let i = 0; i < cur.cells.length; i++) if (cur.cells[i] !== EMPTY) filled.push(i);
    const tap = R.pick(filled);
    const res = lift(cur, tap, rule)!;
    onMove?.(tap, cur, res.board);
    cur = res.board;
    moves++;
    if (moves > b.cells.length) throw new Error('game did not end');
  }
  return moves;
}

// ---------- groups ----------

describe('groups', () => {
  it('joins edge neighbors of one color and never corners', () => {
    const b = fromRows(['01', '10']);
    expect(findGroups(b).groups).toEqual([[0], [1], [2], [3]]);
    const c = fromRows(['00.', '.00', '1.0']);
    expect(findGroups(c).groups).toEqual([[0, 1, 4, 5, 8], [6]]);
  });

  it('partitions every filled cell into exactly one single-colored, connected group', () => {
    fc.assert(
      fc.property(anyBoard, (b) => {
        const { groupOf, groups } = findGroups(b);
        let total = 0;
        for (const g of groups) {
          total += g.length;
          for (const i of g) expect(b.cells[i]).toBe(b.cells[g[0]]);
        }
        expect(total).toBe(countBlocks(b));
        for (let i = 0; i < b.cells.length; i++) {
          if (b.cells[i] === EMPTY) expect(groupOf[i]).toBe(-1);
          // no two same-colored edge neighbors sit in different groups
          const c = i % b.cols;
          if (c + 1 < b.cols && b.cells[i] !== EMPTY && b.cells[i] === b.cells[i + 1]) expect(groupOf[i]).toBe(groupOf[i + 1]);
          if (i + b.cols < b.cells.length && b.cells[i] !== EMPTY && b.cells[i] === b.cells[i + b.cols])
            expect(groupOf[i]).toBe(groupOf[i + b.cols]);
        }
      }),
      { numRuns: 500 },
    );
  });
});

// ---------- the plan's rules properties ----------

describe('rules properties (both rules)', () => {
  it('preserves the number of blocks of every color', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, (b, rule) => {
        expect(colorCounts(settled(b, rule).out)).toEqual(colorCounts(b));
      }),
      { numRuns: 2000 },
    );
  });

  it('leaves no floating block, and (repose) no step taller than one block', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, (b, rule) => {
        const { out } = settled(b, rule);
        expect(isSettled(out, rule)).toBe(true);
        expect(isSettled(out, 'column')).toBe(true); // nothing floats under either rule
      }),
      { numRuns: 2000 },
    );
  });

  it('is deterministic: the same input always gives the same output', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, (b, rule) => {
        const a = settled(b, rule);
        const z = settled(cloneBoard(b), rule);
        expect(boardsEqual(a.out, z.out)).toBe(true);
        expect(a.stats).toEqual(z.stats);
      }),
      { numRuns: 1000 },
    );
  });

  it('is at rest once settled (settling again changes nothing)', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, (b, rule) => {
        const once = settled(b, rule).out;
        const twice = settled(once, rule);
        expect(boardsEqual(once, twice.out)).toBe(true);
        expect(twice.stats.slides).toBe(0);
      }),
      { numRuns: 1000 },
    );
  });

  it('is color-swap safe: recolor then settle equals settle then recolor', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, permutations(5), (b, rule, perm) => {
        const a = settled(recolorBoard(b, perm), rule).out;
        const z = recolorBoard(settled(b, rule).out, perm);
        expect(boardsEqual(a, z)).toBe(true);
      }),
      { numRuns: 1500 },
    );
  });

  it('is mirror safe: mirror then settle equals settle then mirror (always on even widths)', () => {
    const check = (b: Board, rule: RuleName) => {
      const plain = settled(b, rule);
      const mirrored = settled(mirrorBoard(b), rule);
      expect(plain.stats.fallbackTies).toBe(mirrored.stats.fallbackTies);
      if (b.cols % 2 === 0) expect(plain.stats.fallbackTies).toBe(0);
      if (plain.stats.fallbackTies === 0) expect(toRows(mirrored.out)).toEqual(toRows(mirrorBoard(plain.out)));
    };
    fc.assert(fc.property(anyBoard, ruleArb, check), { numRuns: 3000 });
    fc.assert(fc.property(nearSymmetricBoard, ruleArb, check), { numRuns: 3000 });
  });

  it('the trace describes exactly how the blocks moved', () => {
    fc.assert(
      fc.property(anyBoard, ruleArb, (b, rule) => {
        const ids = new Int32Array(b.cells.length).map((_, i) => (b.cells[i] === EMPTY ? -1 : i));
        const out = cloneBoard(b);
        const trace = { ids: ids.slice(), steps: [] as { id: number; from: number; to: number }[][] };
        settle(out, rule, trace);
        // Replaying the moves on the input reproduces the output.
        const re = cloneBoard(b);
        const where = ids.slice();
        for (const step of trace.steps) {
          for (const m of step) {
            expect(where[m.from]).toBe(m.id);
            expect(re.cells[m.to]).toBe(EMPTY);
            re.cells[m.to] = re.cells[m.from];
            re.cells[m.from] = EMPTY;
            where[m.to] = m.id;
            where[m.from] = -1;
          }
        }
        expect(boardsEqual(re, out)).toBe(true);
        expect(Array.from(where)).toEqual(Array.from(trace.ids));
        for (let i = 0; i < out.cells.length; i++) {
          if (out.cells[i] !== EMPTY) expect(b.cells[trace.ids[i]]).toBe(out.cells[i]);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('whole games', () => {
  it('every board can be emptied, a lift always removes its whole group, and the board stays settled', () => {
    fc.assert(
      fc.property(generatedBoard, ruleArb, fc.integer(), (b, rule, seed) => {
        playRandom(b, rule, seed, (tap, before, after) => {
          const res = lift(before, tap, rule)!;
          expect(countBlocks(after)).toBe(countBlocks(before) - res.group.length);
          expect(isSettled(after, rule)).toBe(true);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('a mirrored board played with mirrored taps stays the mirror image, move by move', () => {
    let fallbackGames = 0;
    let games = 0;
    fc.assert(
      fc.property(generatedBoard, ruleArb, fc.integer(), (b, rule, seed) => {
        const taps: number[] = [];
        let fallback = 0;
        playRandom(b, rule, seed, (tap, before) => {
          taps.push(tap);
          fallback += lift(before, tap, rule)!.stats.fallbackTies;
        });
        games++;
        if (fallback > 0) {
          fallbackGames++;
          expect(b.cols % 2).toBe(1);
          return;
        }
        let cur = b;
        let mir = mirrorBoard(b);
        for (const tap of taps) {
          cur = lift(cur, tap, rule)!.board;
          mir = lift(mir, mirrorCell(b.cols, tap), rule)!.board;
          expect(toRows(mir)).toEqual(toRows(mirrorBoard(cur)));
        }
      }),
      { numRuns: 400 },
    );
    // The symmetric fallback should be rare in real play.
    expect(fallbackGames).toBeLessThanOrEqual(Math.ceil(games * 0.05));
  });

  it('replay reproduces a game and rejects a tap on an empty cell', () => {
    const b = generateBoard({ rows: 8, cols: 7, colors: 3 }, 42);
    const taps: number[] = [];
    let last = b;
    playRandom(b, 'repose', 7, (tap, _before, after) => {
      taps.push(tap);
      last = after;
    });
    expect(isCleared(replay(b, taps, 'repose'))).toBe(true);
    expect(isCleared(last)).toBe(true);
    expect(() => replay(b, [...taps, 0], 'repose')).toThrow(/empty cell/);
  });
});

// ---------- the repose rule, by example ----------

function settleRows(rows: string[], rule: RuleName = 'repose') {
  const b = fromRows(rows);
  const stats = settle(b, rule);
  return { rows: toRows(b), stats };
}

describe('repose rule examples', () => {
  it('blocks fall straight down first', () => {
    expect(settleRows(['0..', '...', '.1.'], 'column').rows).toEqual(['...', '...', '01.']);
  });

  it('a column 2+ taller than a neighbor sheds its top block onto it', () => {
    expect(settleRows(['0..', '1..', '2..']).rows).toEqual(['...', '1..', '20.']);
  });

  it('plain column gravity never slides', () => {
    expect(settleRows(['0..', '1..', '2..'], 'column').rows).toEqual(['0..', '1..', '2..']);
  });

  it('if both neighbors are 2+ lower, the block goes to the lower one', () => {
    // heights 1,4,2: the left neighbor is lower
    expect(settleRows(['.0.', '.1.', '.22', '333']).rows).toEqual(['...', '.1.', '022', '333']);
  });

  it('if both neighbors are equally low, the block goes toward the middle', () => {
    // 4 columns, heights 0,2,0,1: column 1 sheds toward the middle (right)
    expect(settleRows(['.0..', '.1.2']).rows).toEqual(['....', '.102']);
    // and its mirror image sheds left
    expect(settleRows(['..0.', '2.1.']).rows).toEqual(['....', '201.']);
  });

  it('the tallest column goes first', () => {
    // heights 3,0,2,0: column 0 (tallest) sheds onto column 1 first, then column 2 can only shed right.
    // (If column 2 went first it would shed left, toward the middle, and column 1 would end up "2 under 0".)
    expect(settleRows(['0...', '1.2.', '3.4.']).rows).toEqual(['....', '1...', '3042']);
  });

  it('odd widths: the center column slides toward the side holding less sand', () => {
    // 5 columns, heights 0,0,3,0,1: the right half holds more, so the top block goes left
    const r = settleRows(['..0..', '..1..', '..2.3']);
    expect(r.rows).toEqual(['.....', '.....', '.0213']);
    expect(r.stats.fallbackTies).toBe(0);
  });

  it('odd widths: when both sides of the center pour into it, the fuller side goes first', () => {
    // heights 1,2,0,2,0: columns 1 and 3 both pour into the center; the left half holds more, so column 1's
    // top block lands first, and column 3 then sheds right instead.
    const r = settleRows(['.0.1.', '21.3.']);
    expect(r.rows).toEqual(['.....', '21031']);
    expect(r.stats.fallbackTies).toBe(0);
  });

  it('a perfectly symmetric tray uses the fixed fallback (left) and reports it', () => {
    const r = settleRows(['.0.', '.1.']);
    expect(r.rows).toEqual(['...', '01.']);
    expect(r.stats.fallbackTies).toBe(1);
  });
});

// ---------- generator and seeded random ----------

describe('seeded random and generator', () => {
  it('the same seed gives the same sequence; int(n) stays in range', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 1000 }), (seed, n) => {
        const a = new Random(seed);
        const z = new Random(seed);
        for (let k = 0; k < 50; k++) {
          const x = a.int(n);
          expect(x).toBe(z.int(n));
          expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true);
        }
      }),
    );
  });

  it('generates full trays, deterministically, using only the allowed colors', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 10 }),
        fc.integer({ min: 5, max: 8 }),
        fc.integer({ min: 3, max: 5 }),
        fc.integer(),
        (rows, cols, colors, seed) => {
          const b = generateBoard({ rows, cols, colors }, seed);
          expect(countBlocks(b)).toBe(rows * cols);
          expect(Math.max(...b.cells)).toBeLessThan(colors);
          expect(boardsEqual(b, generateBoard({ rows, cols, colors }, seed))).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('pins one generated board, so a change to the generator or the random numbers is noticed', () => {
    expect(toRows(generateBoard({ rows: 6, cols: 5, colors: 3 }, 1))).toMatchSnapshot();
  });
});
