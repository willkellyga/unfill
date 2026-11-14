import { parentPort } from 'node:worker_threads';
import { entryBoard, type LibraryEntry } from '../../src/core';
import { proveMinimum } from './prove';

// Proves one board at a time and sends back the result.
parentPort!.on('message', (job: { entry: LibraryEntry; budget: number }) => {
  const r = proveMinimum(entryBoard(job.entry), job.entry.solution, job.budget);
  parentPort!.postMessage({ id: job.entry.id, budget: job.budget, complete: r.complete, best: r.best, startBound: r.startBound, nodes: r.nodes, ms: r.ms });
});
