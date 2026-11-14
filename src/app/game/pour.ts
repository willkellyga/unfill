import type { Board } from '../../core';
import { EMPTY } from '../../core';

/**
 * The pour timeline for one lift, under plain column gravity.
 *
 * Each column works like an hourglass. The blocks that have to fall drain one at a time from the bottom up: the
 * lowest block crumbles away from its bottom edge, its grains stream straight down, and its landing cell fills from
 * the bottom up. Then the next block up does the same. Because every grain of a block falls the same height, the
 * landing cell fills exactly as fast as the source drains, one fall-time later, so the stream never runs into sand
 * that hasn't moved yet. Timing follows the plan: 0.5 to 1.2 s depending on how far the sand falls.
 */
export const GRAVITY_CELLS = 38;
export const STREAM_V0 = 1.2;

/** Seconds for a grain to fall `h` cells from a standing start of STREAM_V0 cells/s. */
export function fallTime(h: number): number {
  const g = GRAVITY_CELLS;
  return (-STREAM_V0 + Math.sqrt(STREAM_V0 * STREAM_V0 + 2 * g * h)) / g;
}

export interface PourBlock {
  id: number;
  color: number;
  col: number;
  fromRow: number;
  toRow: number;
  /** Draining at the source, then filling at the landing cell (scene clock, seconds). */
  d0: number;
  d1: number;
  f0: number;
  f1: number;
}

export interface PourPlan {
  blocks: PourBlock[];
  /** Blocks that stay put: id → cell. */
  still: Map<number, number>;
  colorOf: Map<number, number>;
  start: number;
  end: number;
  /** When each column's last block finishes landing, for the soft pat. */
  columnEnds: number[];
}

export const FIRM = 0.14;

/**
 * Build the plan. `before` is the board before the lift (with ids), `group` the lifted cells, and `moves` the
 * settle trace's single step (column gravity falls in one step).
 */
export function planPour(
  before: Board,
  beforeIds: Int32Array,
  group: readonly number[],
  moves: readonly { id: number; from: number; to: number }[],
  start: number,
): PourPlan {
  const { cols, cells } = before;
  const lifted = new Set(group);
  const moving = new Map<number, { from: number; to: number }>();
  for (const m of moves) moving.set(m.id, m);
  const still = new Map<number, number>();
  const colorOf = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === EMPTY || lifted.has(i)) continue;
    const id = beforeIds[i];
    colorOf.set(id, cells[i]);
    if (!moving.has(id)) still.set(id, i);
  }
  const byCol: PourBlock[][] = Array.from({ length: cols }, () => []);
  for (const m of moves) {
    const c = m.from % cols;
    byCol[c].push({
      id: m.id,
      color: colorOf.get(m.id)!,
      col: c,
      fromRow: (m.from / cols) | 0,
      toRow: (m.to / cols) | 0,
      d0: 0,
      d1: 0,
      f0: 0,
      f1: 0,
    });
  }
  const blocks: PourBlock[] = [];
  const columnEnds: number[] = [];
  let end = start;
  const mid = (cols - 1) / 2;
  for (let c = 0; c < cols; c++) {
    const list = byCol[c].sort((a, z) => z.fromRow - a.fromRow); // bottom first
    if (!list.length) continue;
    const tau = Math.min(0.13, Math.max(0.05, 0.55 / list.length));
    // columns nearer the lifted sand start a hair earlier, so the pour ripples outward
    let t = start + 0.018 * Math.abs(c - mid);
    let colEnd = t;
    for (const b of list) {
      const fall = fallTime(b.toRow - b.fromRow);
      b.d0 = t;
      b.d1 = t + tau;
      b.f0 = t + fall;
      b.f1 = t + tau + fall;
      t += tau;
      colEnd = Math.max(colEnd, b.f1);
      blocks.push(b);
    }
    columnEnds.push(colEnd);
    end = Math.max(end, colEnd + FIRM);
  }
  return { blocks, still, colorOf, start, end, columnEnds };
}
