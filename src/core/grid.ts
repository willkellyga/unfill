/**
 * The board: a rows × cols grid of color indices in an Int8Array, row 0 at the top. EMPTY marks a hole.
 * Colors are small integers (0..colors-1). The rules only ever compare colors for equality, so any
 * relabeling of colors (a "color swap") commutes with every rule.
 */
export const EMPTY = -1;

export interface Board {
  readonly rows: number;
  readonly cols: number;
  readonly cells: Int8Array;
}

export function createBoard(rows: number, cols: number, fill: number = EMPTY): Board {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError(`createBoard: bad size ${cols}x${rows}`);
  }
  return { rows, cols, cells: new Int8Array(rows * cols).fill(fill) };
}

export function cloneBoard(b: Board): Board {
  return { rows: b.rows, cols: b.cols, cells: b.cells.slice() };
}

export const cellIndex = (cols: number, r: number, c: number): number => r * cols + c;
export const rowOf = (cols: number, i: number): number => (i / cols) | 0;
export const colOf = (cols: number, i: number): number => i % cols;

export function countBlocks(b: Board): number {
  let n = 0;
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i] !== EMPTY) n++;
  return n;
}

export function isCleared(b: Board): boolean {
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i] !== EMPTY) return false;
  return true;
}

/** Blocks of each color, indexed by color. */
export function colorCounts(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.cells.length; i++) {
    const v = b.cells[i];
    if (v === EMPTY) continue;
    while (out.length <= v) out.push(0);
    out[v]++;
  }
  return out;
}

/** Number of blocks in each column (its sand height once settled). */
export function columnCounts(b: Board): Int16Array {
  const h = new Int16Array(b.cols);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i] !== EMPTY) h[i % b.cols]++;
  return h;
}

export function boardsEqual(a: Board, b: Board): boolean {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

const SYMBOLS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Rows as text, top row first: '.' is empty, '0'..'9' then 'a'.. are colors. */
export function toRows(b: Board): string[] {
  const out: string[] = [];
  for (let r = 0; r < b.rows; r++) {
    let s = '';
    for (let c = 0; c < b.cols; c++) {
      const v = b.cells[r * b.cols + c];
      s += v === EMPTY ? '.' : SYMBOLS[v];
    }
    out.push(s);
  }
  return out;
}

export function fromRows(rows: readonly string[]): Board {
  const b = createBoard(rows.length, rows[0].length);
  rows.forEach((line, r) => {
    if (line.length !== b.cols) throw new Error(`fromRows: row ${r} has ${line.length} cells, expected ${b.cols}`);
    for (let c = 0; c < b.cols; c++) {
      const ch = line[c];
      if (ch === '.') continue;
      const v = SYMBOLS.indexOf(ch);
      if (v < 0) throw new Error(`fromRows: bad symbol '${ch}'`);
      b.cells[r * b.cols + c] = v;
    }
  });
  return b;
}

/** Compact, stable key: "8x10:" followed by one symbol per cell. 80 characters of cells for an 8×10 board. */
export function boardKey(b: Board): string {
  return `${b.cols}x${b.rows}:${toRows(b).join('')}`;
}

export const mirrorCell = (cols: number, i: number): number => {
  const c = i % cols;
  return i - c + (cols - 1 - c);
};

/** Left–right mirror image. */
export function mirrorBoard(b: Board): Board {
  const out = createBoard(b.rows, b.cols);
  for (let i = 0; i < b.cells.length; i++) out.cells[mirrorCell(b.cols, i)] = b.cells[i];
  return out;
}

/** Apply a color permutation: color k becomes perm[k]. */
export function recolorBoard(b: Board, perm: readonly number[]): Board {
  const out = createBoard(b.rows, b.cols);
  for (let i = 0; i < b.cells.length; i++) {
    const v = b.cells[i];
    out.cells[i] = v === EMPTY ? EMPTY : perm[v];
  }
  return out;
}
