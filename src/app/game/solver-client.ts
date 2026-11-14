import { searchFinish, type Board } from '../../core';
import type { SolveReply, SolveRequest } from '../../worker/solve.worker';
import SolveWorker from '../../worker/solve.worker?worker&inline';

export interface Finish {
  taps: number[];
  fits: boolean;
}

/**
 * Asks the background worker for a way to finish a board within a move budget. Only the newest question
 * matters: asking again while it's still thinking about an older board stops that search (the worker is
 * replaced), so answers never queue up behind stale boards. If workers aren't available, a narrower search runs
 * on the page between frames instead.
 */
export class SolverClient {
  private worker: Worker | null = null;
  private broken = false;
  private seq = 0;
  private pending: { id: number; board: Board; budget: number; resolve: (f: Finish | null) => void } | null = null;

  private spawn(): Worker | null {
    if (this.broken) return null;
    try {
      const w = new SolveWorker();
      w.onmessage = (e: MessageEvent<SolveReply>) => {
        const p = this.pending;
        if (!p || p.id !== e.data.id) return;
        this.pending = null;
        p.resolve({ taps: e.data.taps, fits: e.data.fits });
      };
      w.onerror = (e) => {
        // a page that forbids workers: answer on the page instead, now and from now on
        e.preventDefault?.();
        this.broken = true;
        this.worker = null;
        const p = this.pending;
        if (p) this.fallback(p.id, p.board, p.budget, p.resolve);
      };
      return w;
    } catch {
      this.broken = true;
      return null;
    }
  }

  /** Resolves with the answer, or null if a newer question replaced this one. */
  ask(b: Board, budget: number, deadlineMs = 500): Promise<Finish | null> {
    const id = ++this.seq;
    if (this.pending) {
      // drop the stale search
      this.pending.resolve(null);
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
    return new Promise((resolve) => {
      const board = { cols: b.cols, rows: b.rows, cells: b.cells.slice() };
      this.pending = { id, board, budget, resolve };
      if (!this.worker) this.worker = this.spawn();
      if (this.worker) {
        const req: SolveRequest = { id, cols: b.cols, rows: b.rows, cells: b.cells.slice(), budget, deadlineMs };
        this.worker.postMessage(req, [req.cells.buffer]);
        return;
      }
      this.fallback(id, board, budget, resolve);
    });
  }

  /** No worker: a narrower search on the page, after this frame. */
  private fallback(id: number, b: Board, budget: number, resolve: (f: Finish | null) => void): void {
    window.setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.pending = null;
      const a = searchFinish(b, budget, 60, () => performance.now(), [12, 48]);
      resolve({ taps: a.taps, fits: a.fits });
    }, 30);
  }

  /** Forget any pending question (its promise resolves with null). */
  cancel(): void {
    if (!this.pending) return;
    this.pending.resolve(null);
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
