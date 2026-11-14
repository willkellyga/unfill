/**
 * Seeded random numbers (mulberry32). Integers only: the same seed gives the same sequence on every device.
 * Used by the generator and, later, by play-time board picking and reshuffling. The rules never use it.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, n). Rejection sampling, so there is no modulo bias and no floating point. */
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError(`Random.int: bad range ${n}`);
    const limit = 0x100000000 - (0x100000000 % n);
    let x = this.nextU32();
    while (x >= limit) x = this.nextU32();
    return x % n;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Fisher–Yates shuffle, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /** Current internal state, to save and resume a sequence. */
  get seedState(): number {
    return this.state;
  }
}

/** Mix several integers into one 32-bit seed (for example tier, board number, attempt). */
export function mixSeed(...parts: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const p of parts) {
    h = Math.imul(h ^ (p | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
