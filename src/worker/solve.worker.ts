import { searchFinish } from '../core/hint';

/**
 * Background search for hints and the on-track glow, so the scene never stutters while it thinks (plan: "Web
 * Worker for hints, the on-track check and backup board generation").
 */
export interface SolveRequest {
  id: number;
  cols: number;
  rows: number;
  cells: Int8Array;
  budget: number;
  deadlineMs: number;
}

export interface SolveReply {
  id: number;
  taps: number[];
  fits: boolean;
  width: number;
  ms: number;
}

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, cols, rows, cells, budget, deadlineMs } = e.data;
  const t0 = performance.now();
  const a = searchFinish({ cols, rows, cells }, budget, deadlineMs, () => performance.now());
  const reply: SolveReply = { id, ...a, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(reply);
};
