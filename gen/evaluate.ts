import {
  LIBRARY_RULE,
  Random,
  beamSolve,
  canonicalKey,
  carefulPlay,
  cellsString,
  exactSolve,
  findGroups,
  generateBoard,
  isCleared,
  liftSizes,
  mixSeed,
  naivePlay,
  noisyPlay,
  replay,
  type LibraryEntry,
} from '../src/core';
import { BEAM_WIDTH, POPULATION, type TierSpec } from './tiers';

export type Candidate =
  | { index: number; ok: false; reason: string }
  | { index: number; ok: true; key: string; beamPar: number; entry: Omit<LibraryEntry, 'id' | 'rank'> };

const rule = LIBRARY_RULE;

/** Generate candidate `index` of a tier, solve it, measure it and check it against the tier's targets. */
export function evaluate(spec: TierSpec, index: number): Candidate {
  const seed = mixSeed(0x5eed, spec.tier, index);
  const board = generateBoard({ rows: spec.rows, cols: spec.cols, colors: spec.colors }, seed);

  // Cheap checks first.
  const opening = findGroups(board).groups.length;
  if (opening < spec.minOpening) return { index, ok: false, reason: 'opening' };

  let solution = beamSolve(board, rule, BEAM_WIDTH);
  const beamPar = solution.length;
  let proven: boolean | null = null;
  if (spec.exactBudget > 0) {
    // Is there anything shorter than the beam's answer? If so, the exact answer becomes par.
    const ex = exactSolve(board, rule, solution.length - 1, spec.exactBudget);
    if (ex.taps) {
      solution = ex.taps;
      proven = ex.complete;
    } else proven = ex.complete;
  }
  const par = solution.length;
  // The fairness check: the solution really empties the board in the shared rules code.
  if (!isCleared(replay(board, solution, rule))) throw new Error(`tier ${spec.tier} #${index}: solution does not clear`);
  if (par < spec.par[0] || par > spec.par[1]) return { index, ok: false, reason: 'par' };

  const singles = liftSizes(board, solution, rule).filter((s) => s === 1).length;
  if (singles > Math.floor(par * spec.maxSinglesShare)) return { index, ok: false, reason: 'singles' };
  const carefulGap = carefulPlay(board, rule).length - par;
  if (carefulGap < spec.minCarefulGap) return { index, ok: false, reason: 'carefulGap' };
  const naiveGap = naivePlay(board, rule).length - par;
  if (naiveGap < spec.minNaiveGap) return { index, ok: false, reason: 'naiveGap' };

  // The difficulty rating: average extra moves over par across the simulated player population.
  const players: Record<string, number> = {};
  for (const p of POPULATION) {
    const rand = new Random(mixSeed(seed, POPULATION.indexOf(p)));
    let sum = 0;
    for (let r = 0; r < p.runs; r++) sum += noisyPlay(board, rule, p.player, rand) - par;
    players[p.name] = Math.round((100 * sum) / p.runs);
  }
  // Each player counts equally, whatever its number of runs.
  const excess100 = Math.round(POPULATION.reduce((a, p) => a + players[p.name], 0) / POPULATION.length);

  return {
    index,
    ok: true,
    key: canonicalKey(board),
    beamPar,
    entry: {
      tier: spec.tier,
      index,
      cols: spec.cols,
      rows: spec.rows,
      colors: spec.colors,
      cells: cellsString(board),
      solution,
      par,
      proven,
      metrics: { carefulGap, naiveGap, singles, opening, excess100, players },
    },
  };
}
