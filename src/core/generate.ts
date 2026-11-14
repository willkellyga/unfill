import { EMPTY, createBoard, type Board } from './grid';
import { Random } from './random';

export interface BoardSpec {
  rows: number;
  cols: number;
  colors: number;
}

/**
 * The plan's generator, ported from solver-experiment/sim.js with two changes: the tray starts completely
 * full (sim.js left the top row empty and could leave holes), and it uses integer random only.
 *
 * Fill from the bottom up with small pieces of 2 to 4 blocks. Each piece gets a color that doesn't touch
 * another piece of that color, which stops giant same-color blobs. If no color fits, the piece's first block
 * is placed anyway so the tray is always full (it then merges with a neighbor of its color).
 */
export function generateBoard(spec: BoardSpec, seed: number): Board {
  const { rows, cols, colors } = spec;
  if (colors < 1 || colors > 36) throw new RangeError(`generateBoard: bad color count ${colors}`);
  const R = new Random(seed);
  const b = createBoard(rows, cols);
  const cells = b.cells;
  const piece = new Int32Array(rows * cols).fill(-1);

  const neighbors = (i: number): number[] => {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    const out: number[] = [];
    if (r < rows - 1) out.push(i + cols);
    if (r > 0) out.push(i - cols);
    if (c < cols - 1) out.push(i + 1);
    if (c > 0) out.push(i - 1);
    return out;
  };
  const touchesOther = (i: number, k: number, me: number) =>
    neighbors(i).some((j) => cells[j] === k && piece[j] !== me);

  let nextPiece = 0;
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const seedCell = r * cols + c;
      if (cells[seedCell] !== EMPTY) continue;
      const me = nextPiece++;
      const fits: number[] = [];
      for (let k = 0; k < colors; k++) if (!touchesOther(seedCell, k, me)) fits.push(k);
      const k = fits.length ? R.pick(fits) : R.int(colors);
      const size = 2 + R.int(3);
      const queue = [seedCell];
      let placed = 0;
      while (queue.length && placed < size) {
        const j = queue.splice(R.int(queue.length), 1)[0];
        if (cells[j] !== EMPTY) continue;
        if (j !== seedCell && touchesOther(j, k, me)) continue;
        cells[j] = k;
        piece[j] = me;
        placed++;
        for (const n of neighbors(j)) if (cells[n] === EMPTY) queue.push(n);
      }
    }
  }
  return b;
}
