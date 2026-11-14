/**
 * The difficulty study behind the rating (see gen/README.md). For N boards of one size it records every candidate
 * measure and the extra moves of four simulated players over many runs, one JSON line per board.
 *
 *   npx tsx gen/study/measure.ts <cols> <rows> <colors> <N> <shard> <shards> >> out.jsonl
 *   npx tsx gen/study/analyze.ts out.jsonl
 *
 * The saved run (study-2026-11-14.jsonl) used N = 120, 120, 100, 100, 100, 100 for the six tiers, 4 shards each.
 */
import { generateBoard, findGroups, beamSolve, carefulPlay, naivePlay, liftSizes, keyMoves, noisyPlay, mixSeed, Random, type NoisyPlayer } from '../../src/core';
const [cols, rows, colors, N, shard, shards] = process.argv.slice(2).map(Number);
const P: Record<string, NoisyPlayer> = {
  casual: { weights: [8, 4, 2, 1], lookahead: 1 },
  medium: { weights: [16, 4, 1], lookahead: 1 },
  sharp: { weights: [16, 2], lookahead: 2 },
  random: { weights: Array(64).fill(1), lookahead: 1 },
};
const RUNS = 24;
for (let i = shard; i < N; i += shards) {
  const b = generateBoard({ rows, cols, colors }, mixSeed(7, cols, rows, colors, i));
  const sol = beamSolve(b, 'column', 500);
  const par = sol.length;
  const sizes = liftSizes(b, sol, 'column');
  const km = keyMoves(b, sol, 'column', 20);
  const costlyShare = km.steps.reduce((a, s) => a + (s.choices ? s.costly / s.choices : 0), 0) / km.steps.length;
  const rec: any = { tier: `${cols}x${rows}c${colors}`, i, par, careful: carefulPlay(b, 'column').length - par, naive: naivePlay(b, 'column').length - par,
    open: findGroups(b).groups.length, singles: sizes.filter((x) => x === 1).length, key: km.keyMoves, costlyShare, firstCostly: km.steps[0].costly / Math.max(1, km.steps[0].choices) };
  for (const [name, pl] of Object.entries(P)) {
    const R = new Random(mixSeed(99, i, name.length, cols, rows));
    const runs = Array.from({ length: name === 'sharp' ? 12 : RUNS }, () => noisyPlay(b, 'column', pl, R) - par);
    rec[name] = runs;
  }
  console.log(JSON.stringify(rec));
}
