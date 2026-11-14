import { EMPTY, type Board } from './grid';

/**
 * Groups: blocks of one color that touch edge to edge. Corners don't count.
 * Groups are numbered in row-major order of their first (top-left-most) cell, and each group's cell list is
 * sorted ascending, so the result is the same on every device.
 */
export interface GroupMap {
  /** Group id per cell, or -1 for empty cells. */
  readonly groupOf: Int16Array;
  /** Cell indices of each group, ascending. */
  readonly groups: number[][];
}

export function findGroups(b: Board): GroupMap {
  const { rows, cols, cells } = b;
  const n = rows * cols;
  const groupOf = new Int16Array(n).fill(-1);
  const groups: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    const k = cells[start];
    if (k === EMPTY || groupOf[start] !== -1) continue;
    const id = groups.length;
    const members: number[] = [];
    groupOf[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const r = (i / cols) | 0;
      const c = i - r * cols;
      if (r > 0) visit(i - cols);
      if (r < rows - 1) visit(i + cols);
      if (c > 0) visit(i - 1);
      if (c < cols - 1) visit(i + 1);
    }
    members.sort((a, z) => a - z);
    groups.push(members);

    function visit(j: number): void {
      if (groupOf[j] === -1 && cells[j] === k) {
        groupOf[j] = id;
        stack.push(j);
      }
    }
  }
  return { groupOf, groups };
}

/** The group containing cell i (ascending cell indices), or an empty list if the cell is empty. */
export function groupAt(b: Board, i: number): number[] {
  if (b.cells[i] === EMPTY) return [];
  const { groupOf, groups } = findGroups(b);
  return groups[groupOf[i]];
}

export function groupCount(b: Board): number {
  return findGroups(b).groups.length;
}
