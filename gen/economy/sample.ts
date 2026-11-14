/**
 * Samples how many moves each simulated player needs on every library board, for the move-economy simulator.
 * A player's moves on a board don't depend on its move pool (it plays the board the same way either way), so the
 * session simulator can draw from these samples instead of replaying games, which makes tuning instant.
 *
 *   npx tsx gen/economy/sample.ts        # writes gen/economy/samples.json (about 5 min on 4 cores)
 *
 * Deterministic: each board's samples come from a fixed seed.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { LIBRARY_RULE, Random, entryBoard, mixSeed, noisyPlay, type Library, type LibraryEntry } from '../../src/core';
import { POPULATION } from '../tiers';

/** Runs per player per board. */
export const SAMPLE_RUNS: Record<string, number> = { casual: 16, medium: 16, sharp: 8 };

export interface Samples {
  /** Extra moves over par, per board id, per player: one number per run. */
  boards: Record<string, Record<string, number[]>>;
}

function sampleBoard(e: LibraryEntry): Record<string, number[]> {
  const board = entryBoard(e);
  const out: Record<string, number[]> = {};
  POPULATION.forEach((p, pi) => {
    const R = new Random(mixSeed(0xec0, e.tier, e.index, pi));
    out[p.name] = Array.from({ length: SAMPLE_RUNS[p.name] }, () => noisyPlay(board, LIBRARY_RULE, p.player, R) - e.par);
  });
  return out;
}

if (!isMainThread) {
  parentPort!.on('message', (batch: LibraryEntry[]) => parentPort!.postMessage(batch.map((e) => [e.id, sampleBoard(e)])));
} else {
  const lib: Library = JSON.parse(readFileSync(new URL('../../src/library/boards.json', import.meta.url), 'utf8'));
  const threads = availableParallelism();
  const workers = Array.from({ length: threads }, () => new Worker(new URL(import.meta.url)));
  const queue = lib.boards.slice();
  const results = new Map<string, Record<string, number[]>>();
  const t0 = Date.now();
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.on('error', reject);
          const next = () => {
            const batch = queue.splice(0, 8);
            if (!batch.length) return resolve();
            w.once('message', (rows: [string, Record<string, number[]>][]) => {
              for (const [id, s] of rows) results.set(id, s);
              next();
            });
            w.postMessage(batch);
          };
          next();
        }),
    ),
  );
  await Promise.all(workers.map((w) => w.terminate()));
  const samples: Samples = { boards: {} };
  for (const e of lib.boards) samples.boards[e.id] = results.get(e.id)!;
  writeFileSync(
    new URL('./samples.json', import.meta.url),
    '{"boards":{\n' + lib.boards.map((e) => `${JSON.stringify(e.id)}:${JSON.stringify(samples.boards[e.id])}`).join(',\n') + '\n}}\n',
  );
  console.log(`Sampled ${lib.boards.length} boards in ${Math.round((Date.now() - t0) / 1000)} s`);
}
