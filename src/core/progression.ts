import { Random, mixSeed } from './random';
import { permutations, type BoardTransform, type LibraryEntry } from './library';

/**
 * Progression: which board comes next. Difficulty climbs as the board number rises, in a sawtooth: each wave of
 * boards builds up to a peak and then drops to a breather, and every new tier (a bigger tray or a new color) starts
 * back near the easy end of its range. The overall trend keeps rising because later tiers are harder across the
 * board, and within each tier the targets drift upward.
 *
 * Wave lengths are fitted to a typical play session (Block Blast averages about 12 minutes; see pacing.ts). From
 * board 21 on, one wave takes a typical player about one session: a warm-up, a climb, one peak, and a breather to
 * finish on. The first session covers the tutorial, the 6×7 wave and the first 7×8 wave, ending on a breather.
 *
 * Difficulty here is a board's rank within its tier (0 easiest, 999 hardest) by the simulated-player rating.
 */
export type SlotRole = 'tutorial' | 'build' | 'peak' | 'breather' | 'cleanser';

export interface Slot {
  /** Board number, from 1. */
  n: number;
  tier: number;
  role: SlotRole;
  /** Target difficulty rank within the tier, 0..999. */
  target: number;
}

/**
 * Tiers by board number, and each tier's wave length in boards. The plan's 1–3, 4–10 and 11–20 are kept; tier 4
 * runs to board 44 so it holds three whole session-length waves, and the endless tier starts at 45. Wave lengths
 * come from the session simulation (gen/economy/REPORT.md): about 12 minutes per wave for a typical player from
 * board 21 on.
 */
export const SEGMENTS: { start: number; end: number; tier: number; wave: number }[] = [
  { start: 1, end: 3, tier: 1, wave: 0 },
  { start: 4, end: 10, tier: 2, wave: 7 },
  { start: 11, end: 20, tier: 3, wave: 5 },
  { start: 21, end: 44, tier: 4, wave: 8 },
  { start: 45, end: Infinity, tier: 5, wave: 7 },
];

/** Offsets added to the tier's rising base: building boards climb from −100 to +100, then the peak and breather. */
export const PEAK_OFFSET = 250;
export const BREATHER_OFFSET = -250;

/** From this board on, every other peak uses the five-color tier (plan: "4, some 5 from 61"). */
export const FIVE_COLOR_FROM = 61;
/** From this board on, every other breather is a small palette-cleanser tray (plan: "every so often a small board"). */
export const CLEANSER_FROM = 45;
/** Over this many boards of the endless tier, its base keeps rising, then holds. */
const ENDLESS_RAMP = 100;

const clamp = (x: number) => Math.max(0, Math.min(999, Math.round(x)));

export function slotFor(n: number): Slot {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`slotFor: bad board number ${n}`);
  const seg = SEGMENTS.find((s) => n >= s.start && n <= s.end)!;
  if (seg.tier === 1) return { n, tier: 1, role: 'tutorial', target: 60 + 60 * (n - 1) };
  // The wave restarts with each tier, so a new tray size never opens on a peak.
  const waveIndex = Math.floor((n - seg.start) / seg.wave);
  const pos = (n - seg.start) % seg.wave;
  const builds = seg.wave - 2;
  // The base rises through the segment: from 200 to 600 in the fixed tiers, 250 to 700 in the endless one.
  let base: number;
  if (seg.end === Infinity) base = 250 + 450 * Math.min(1, (n - seg.start) / ENDLESS_RAMP);
  else base = 200 + (400 * (n - seg.start)) / (seg.end - seg.start);
  const oddWave = waveIndex % 2 === 1;
  if (pos < builds) {
    const offset = builds === 1 ? 0 : -100 + (200 * pos) / (builds - 1);
    return { n, tier: seg.tier, role: 'build', target: clamp(base + offset) };
  }
  if (pos === builds) {
    const tier = n >= FIVE_COLOR_FROM && oddWave ? 6 : seg.tier;
    return { n, tier, role: 'peak', target: clamp(base + PEAK_OFFSET) };
  }
  if (n >= CLEANSER_FROM && oddWave) {
    // A smaller tray as a palette cleanser, after the five-color peaks: a mid-difficulty board of the 7×8 tier.
    return { n, tier: 3, role: 'cleanser', target: 500 };
  }
  return { n, tier: seg.tier, role: 'breather', target: clamp(base + BREATHER_OFFSET) };
}

export interface Pick {
  slot: Slot;
  entry: LibraryEntry;
  transform: BoardTransform;
}

/**
 * Pick the board for board number `n`: from the slot's tier, the board whose rank is nearest the target among
 * those not played recently, with a seeded random choice among the closest few so runs differ. Then a random
 * mirror and color order. `seed` identifies the player's run; the same seed, board number and history give the
 * same pick.
 */
export function pickBoard(boards: readonly LibraryEntry[], n: number, seed: number, recent: ReadonlySet<string>): Pick {
  const slot = slotFor(n);
  const R = new Random(mixSeed(seed, n));
  const pool = boards.filter((b) => b.tier === slot.tier);
  if (!pool.length) throw new Error(`pickBoard: no boards in tier ${slot.tier}`);
  const fresh = pool.filter((b) => !recent.has(b.id));
  const from = fresh.length ? fresh : pool;
  const byDistance = from
    .map((b) => ({ b, d: Math.abs(b.rank - slot.target) }))
    .sort((a, z) => a.d - z.d || (a.b.id < z.b.id ? -1 : 1));
  const entry = byDistance[R.int(Math.min(8, byDistance.length))].b;
  const perms = permutations(entry.colors);
  return { slot, entry, transform: { mirror: R.int(2) === 1, perm: perms[R.int(perms.length)] } };
}
