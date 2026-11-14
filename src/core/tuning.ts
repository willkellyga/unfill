import type { LibraryEntry } from './library';
import type { SlotRole } from './progression';

/**
 * Milestone 7: the tuning knobs. Everything that decides how hard a run feels lives in TUNING below, so a playtest
 * can be followed by a one-line change and `npm run tuning` (gen/tuning/README.md).
 *
 * Par. Each board has a recorded spread of how many extra moves over the solver's best route a typical player
 * takes (src/library/par-curves.json: the "medium" bot, 128 games per board). The par she is shown on level n is
 *
 *     shown par = solver par + the extra moves a typical player stays within q% of the time,
 *
 * so q is literally "how often a typical player makes par or better here". q falls as the run goes on (makePar),
 * dips on peaks and rises on breathers (roleShift). Par never drops below solver par + minCushion, so it can always
 * be beaten.
 *
 * Moves. Each level pours in its shown par plus a bonus by role. The bonus is never below −1, so the moves a level
 * gives back are always enough to beat its par (Will: "the number of moves you get back should be enough to beat
 * par on the next level"). With a −1 bonus, making par exactly costs a banked move. Leftover moves carry over up to
 * bankCap, and the bank is what keeps par itself in reach; the bot runs check that a typical player starts a level
 * with fewer moves than par only rarely ("almost never out of reach"). A run ends only after going over par by more
 * than the moves banked.
 */
export interface Tuning {
  /**
   * Chance, in percent, that a typical player makes par or better, by level number in the run: [level, percent]
   * points, straight lines between them, held flat after the last one.
   */
  makePar: [number, number][];
  /** Percentage points added to makePar by the level's place in the wave: the sawtooth. */
  roleShift: Record<SlotRole, number>;
  /** Shown par is at least solver par + this. 1 or more means par can always be beaten. */
  minCushion: number;
  /**
   * Moves poured in on top of the shown par, by role. −1 or more, so a level always gives back enough moves to beat
   * its par. −1 means making par exactly spends one banked move; 0 keeps the bank level; more refills it.
   */
  bonus: Record<SlotRole, number>;
  /** Extra moves on level 1. */
  welcomeGift: number;
  /** Most moves carried from one level to the next; the rest becomes a ribbon on the bottle. */
  bankCap: number;
}

/**
 * Tuned with bot runs (gen/tuning/REPORT.md): a typical run lasts about 14 minutes (Will, Nov 14: 12–15, one
 * sitting). A typical player makes par on about 3 levels in 4 early on; by level 11 par is set so a typical player
 * makes it only 15% of the time on a build level (the +1 floor keeps small trays kinder than that), easing to 5% by
 * level 51 so even a sharp player's run ends. Peaks are 20 points stricter, breathers 20 points kinder and pour in 3
 * extra moves; builds and peaks give back par − 1, so making par exactly spends a banked move.
 */
export const TUNING: Tuning = {
  makePar: [
    [1, 75],
    [5, 70],
    [11, 15],
    [51, 5],
  ],
  roleShift: { tutorial: 10, build: 0, peak: -20, breather: 20, cleanser: 20 },
  minCushion: 1,
  bonus: { tutorial: 2, build: -1, peak: -1, breather: 3, cleanser: 3 },
  welcomeGift: 5,
  bankCap: 15,
};

/** The quantiles stored per board in par-curves.json, in percent. */
export const PAR_QUANTILES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];
/** Stored extras are offset by this, so a bot that beats the solver by a few moves still fits in one character. */
export const OFFSET = 5;

export function encodeExtras(xs: readonly number[]): string {
  return xs.map((x) => Math.max(0, Math.min(35, x + OFFSET)).toString(36)).join('');
}

export function decodeExtras(s: string): number[] {
  return Array.from(s, (ch) => parseInt(ch, 36) - OFFSET);
}

export interface ParCurves {
  reference: string;
  games: number;
  quantiles: number[];
  boards: Record<string, string>;
}

/** A board with its typical-player curve attached (see attachParCurves). */
export type TunedEntry = LibraryEntry & { curve?: number[] };

/** Attach each board's par curve. Boards without one fall back to the typical player's average (parChanceExtra). */
export function attachParCurves<T extends LibraryEntry>(boards: readonly T[], curves: ParCurves): (T & { curve?: number[] })[] {
  if (curves.quantiles.join() !== PAR_QUANTILES.join()) throw new Error('par-curves.json: unexpected quantiles');
  return boards.map((b) => {
    const s = curves.boards[b.id];
    return s ? { ...b, curve: decodeExtras(s) } : { ...b };
  });
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** The make-par chance for level n before the role shift (straight lines between the makePar points). */
export function baseChance(n: number, t: Tuning = TUNING): number {
  const pts = t.makePar;
  if (n <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [n1, p1] = pts[i];
    if (n <= n1) {
      const [n0, p0] = pts[i - 1];
      return p0 + ((p1 - p0) * (n - n0)) / (n1 - n0);
    }
  }
  return pts[pts.length - 1][1];
}

/** The make-par chance for level n in its role, rounded to the stored 5% steps and kept within 5–95%. */
export function parChance(n: number, role: SlotRole, t: Tuning = TUNING): number {
  return clamp(Math.round((baseChance(n, t) + t.roleShift[role]) / 5) * 5, 5, 95);
}

/** Extra moves over solver par that a typical player stays within `chance`% of the time on this board. */
export function parChanceExtra(entry: { curve?: number[]; metrics: LibraryEntry['metrics'] }, chance: number): number {
  if (entry.curve) return entry.curve[PAR_QUANTILES.indexOf(chance)];
  // No curve: use the typical player's average, which is roughly the 50% point.
  return Math.floor(((entry.metrics.players.medium ?? entry.metrics.excess100) + 50) / 100);
}

/** The par she sees and scores against on level n. */
export function tunedPar(n: number, role: SlotRole, entry: { par: number; curve?: number[]; metrics: LibraryEntry['metrics'] }, t: Tuning = TUNING): number {
  return entry.par + Math.max(t.minCushion, parChanceExtra(entry, parChance(n, role, t)));
}

/** The lowest bonus allowed: a level always gives back enough moves to beat its par (par − 1 lifts). */
export const MIN_BONUS = -1;

/** Moves poured in for level n: its shown par plus the role's bonus (never below MIN_BONUS). */
export function tunedGrant(shownPar: number, role: SlotRole, t: Tuning = TUNING): number {
  return shownPar + Math.max(MIN_BONUS, t.bonus[role]);
}
