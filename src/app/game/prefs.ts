/**
 * Milestone 6 settings that aren't sound or quality: color-blind patterns, reduced motion and vibration. Pure
 * functions with no DOM, so they're unit-tested (tests/prefs.test.ts). main.ts reads and writes them through its
 * localStorage wrapper.
 */

// ---------------------------------------------------------------- color-blind patterns

/** Off, only the fifth sand (the plan's default), or every sand. */
export type PatternMode = 'off' | 'fifth' | 'all';

/** Surface patterns, drawn by the block shader (blocks.ts). 0 is plain. */
export const PATTERN = { plain: 0, dots: 1, waves: 2, crosshatch: 3, stripes: 4 } as const;

/**
 * The pattern each sand carries, by sand index (palette.ts: pink, green, lilac, yellow, blue).
 *
 * Picked from a color-vision check of the five sands (Machado 2009 simulation, OKLab distance; see the PR):
 * lilac and blue are the closest pair for everyone, and the closest pair outright for deuteranopia, so blue,
 * the fifth sand (it only appears on 5-color levels), gets the boldest pattern, stripes, and is the one patterned by
 * default. Pink and green are the next-worst pair for deuteranopia, so pink stays plain and green gets dots; every
 * close pair under every simulated deficiency ends up with two different patterns.
 */
export const SAND_PATTERN = [PATTERN.plain, PATTERN.dots, PATTERN.waves, PATTERN.crosshatch, PATTERN.stripes] as const;

/** The fifth sand: library color 4 exists only on 5-color boards (recoloring permutes 0..colors-1). */
export const FIFTH_SAND = 4;

export function patternFor(sand: number, mode: PatternMode): number {
  const k = ((sand % 5) + 5) % 5;
  if (mode === 'off') return PATTERN.plain;
  if (mode === 'fifth') return k === FIFTH_SAND ? SAND_PATTERN[k] : PATTERN.plain;
  return SAND_PATTERN[k];
}

export function parsePatternMode(v: string | null): PatternMode {
  return v === 'off' || v === 'all' || v === 'fifth' ? v : 'fifth';
}

// ---------------------------------------------------------------- reduced motion

/**
 * Stored as '1' or '0' once she flips the switch; until then it follows the phone's own Reduce Motion setting.
 */
export function parseReducedMotion(stored: string | null, systemPrefersReduced: boolean): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return systemPrefersReduced;
}

// ---------------------------------------------------------------- moving her progress between Safari and the home-screen app

/**
 * On an iPhone, a web app added to the home screen keeps its own storage, separate from Safari's, so her game in
 * Safari doesn't follow her into the app. A progress code carries it across (and doubles as a backup): the saved
 * run, the shelf of bottles and the high score, as JSON in base64url.
 */
export interface Progress {
  save: unknown;
  shelf: unknown[];
  best: number;
  /** The playtest id and tester name (playtest.ts), so Safari and the home-screen app count as one player. */
  device?: string;
  name?: string;
}

const PREFIX = 'UNFILL1:';

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeProgress(p: Progress): string {
  return PREFIX + toBase64Url(JSON.stringify({ v: 1, save: p.save, shelf: p.shelf, best: p.best, device: p.device, name: p.name }));
}

/** The progress in a code, or null if it isn't one. Whitespace (from a message or a note) is ignored. */
export function decodeProgress(code: string): Progress | null {
  const s = code.replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) return null;
  try {
    const d = JSON.parse(fromBase64Url(s.slice(PREFIX.length)));
    if (!d || d.v !== 1 || !Array.isArray(d.shelf)) return null;
    const best = Number(d.best);
    if (!Number.isFinite(best) || best < 0) return null;
    const device = typeof d.device === 'string' && /^[a-z0-9]{6,32}$/.test(d.device) ? d.device : undefined;
    const name = typeof d.name === 'string' ? d.name.slice(0, 40) : undefined;
    return { save: d.save ?? null, shelf: d.shelf, best: Math.floor(best), device, name };
  } catch {
    return null;
  }
}
