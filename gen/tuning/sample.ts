/**
 * Records bot games on every library board, for milestone 7 (tuning). Two independent sets, so par is never
 * tuned and judged on the same games:
 *
 *   src/library/par-curves.json   the typical ("medium") player's extra moves over solver par on each board, as
 *                                 quantiles (5%, 10%, ... 95%) from 128 games. The game reads it to set par.
 *   gen/tuning/samples.json       separate games for the run simulator: casual 64, medium 64, sharp 48 per board,
 *                                 plus the deterministic careful player.
 *
 *   npm run tuning:sample     # about 10 minutes on 4 cores; deterministic (fixed seeds per board)
 *
 * Re-run after regenerating the board library. Both files store extra moves over the solver's par, offset by
 * OFFSET and written one base-36 character per number, so a board's games fit on one short line.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { LIBRARY_RULE, Random, entryBoard, mixSeed, noisyPlay, type Library, type LibraryEntry } from '../../src/core';
import { PAR_QUANTILES, encodeExtras } from '../../src/core/tuning';
import { POPULATION } from '../tiers';

/** Games per player per board for the simulator. */
export const SIM_RUNS: Record<string, number> = { casual: 64, medium: 64, sharp: 48 };
/** Games of the reference player per board for the par curves. */
export const CURVE_RUNS = 128;
export const REFERENCE = 'medium';

type Row = { id: string; curve: string; sim: Record<string, string> };

function quantileOf(sorted: number[], q: number): number {
  // smallest x with P(X <= x) >= q
  const k = Math.max(0, Math.ceil(q * sorted.length) - 1);
  return sorted[k];
}

function sampleBoard(e: LibraryEntry): Row {
  const board = entryBoard(e);
  const ref = POPULATION.find((p) => p.name === REFERENCE)!;
  const Rc = new Random(mixSeed(0x9a7c, e.tier, e.index));
  const curveGames = Array.from({ length: CURVE_RUNS }, () => noisyPlay(board, LIBRARY_RULE, ref.player, Rc) - e.par).sort((a, z) => a - z);
  const curve = encodeExtras(PAR_QUANTILES.map((q) => quantileOf(curveGames, q / 100)));
  const sim: Record<string, string> = {};
  POPULATION.forEach((p, pi) => {
    const R = new Random(mixSeed(0x51e7, e.tier, e.index, pi));
    sim[p.name] = encodeExtras(Array.from({ length: SIM_RUNS[p.name] }, () => noisyPlay(board, LIBRARY_RULE, p.player, R) - e.par));
  });
  sim.careful = encodeExtras([e.metrics.carefulGap]);
  return { id: e.id, curve, sim };
}

if (!isMainThread) {
  parentPort!.on('message', (batch: LibraryEntry[]) => parentPort!.postMessage(batch.map(sampleBoard)));
} else {
  const lib: Library = JSON.parse(readFileSync(new URL('../../src/library/boards.json', import.meta.url), 'utf8'));
  const threads = availableParallelism();
  const workers = Array.from({ length: threads }, () => new Worker(new URL(import.meta.url)));
  // Slow (big) boards first, so the workers finish together.
  const queue = lib.boards.slice().sort((a, z) => z.tier - a.tier);
  const results = new Map<string, Row>();
  const t0 = Date.now();
  let done = 0;
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.on('error', reject);
          const next = () => {
            const batch = queue.splice(0, 4);
            if (!batch.length) return resolve();
            w.once('message', (rows: Row[]) => {
              for (const r of rows) results.set(r.id, r);
              done += rows.length;
              if (done % 200 < rows.length) console.log(`${done}/${lib.boards.length} boards, ${Math.round((Date.now() - t0) / 1000)} s`);
              next();
            });
            w.postMessage(batch);
          };
          next();
        }),
    ),
  );
  await Promise.all(workers.map((w) => w.terminate()));
  const ids = lib.boards.map((e) => e.id);
  writeFileSync(
    new URL('../../src/library/par-curves.json', import.meta.url),
    `{"reference":${JSON.stringify(REFERENCE)},"games":${CURVE_RUNS},"quantiles":${JSON.stringify(PAR_QUANTILES)},"boards":{\n` +
      ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(results.get(id)!.curve)}`).join(',\n') +
      '\n}}\n',
  );
  writeFileSync(
    new URL('./samples.json', import.meta.url),
    `{"games":${JSON.stringify({ ...SIM_RUNS, careful: 1 })},"boards":{\n` +
      ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(results.get(id)!.sim)}`).join(',\n') +
      '\n}}\n',
  );
  console.log(`Sampled ${ids.length} boards in ${Math.round((Date.now() - t0) / 1000)} s`);
}
