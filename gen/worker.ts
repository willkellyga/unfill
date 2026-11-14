import { parentPort } from 'node:worker_threads';
import { evaluate } from './evaluate';
import { TIERS } from './tiers';

// A worker evaluates batches of candidate indices for one tier and sends the results back.
parentPort!.on('message', (job: { tier: number; indices: number[] }) => {
  const spec = TIERS.find((t) => t.tier === job.tier)!;
  parentPort!.postMessage(job.indices.map((i) => evaluate(spec, i)));
});
