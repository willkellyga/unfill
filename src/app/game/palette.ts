import * as THREE from 'three';

/**
 * Five pastel sands, the same hues as the 2D lab so the colors she knows carry over, nudged a little warmer and
 * softer for lit 3D surfaces. Order matters: library colors 0..4 map to these.
 */
export const SAND_HEX = ['#e98aa6', '#8cc486', '#a894e0', '#f1c65a', '#7db4e0'] as const;

/**
 * The Daily Puzzle's own sands (Will: "use different colors for the daily puzzles"): a dusk set, deeper and richer
 * than the everyday pastels, so a daily tray never looks like just another level. Tangerine, teal, orchid, butter
 * and indigo, in the same slots as the emoji squares of the share text (🟧🟩🟪🟨🟦, core/daily.ts DAILY_SQUARES).
 *
 * Checked like the everyday sands (Machado 2009 color-vision simulation, OKLab distance ×100, closest pair): normal
 * 18.2, protanopia 11.3, deuteranopia 12.6, tritanopia 14.3, against 9.6 / 7.2 / 3.9 / 5.0 for the pastels. The
 * color-blind patterns follow the slot, so indigo (the fifth) keeps the stripes.
 */
export const DAILY_HEX = ['#f08a3c', '#45b39a', '#b15fc0', '#f5d76e', '#34509c'] as const;

export const SAND = SAND_HEX.map((h) => new THREE.Color(h));
export const DAILY_SAND = DAILY_HEX.map((h) => new THREE.Color(h));

let active = SAND;
let activeHex: readonly string[] = SAND_HEX;

/** Switch every sand in the scene to the everyday or the daily colors. */
export function usePalette(kind: 'day' | 'daily'): void {
  active = kind === 'daily' ? DAILY_SAND : SAND;
  activeHex = kind === 'daily' ? DAILY_HEX : SAND_HEX;
}

export function sandColor(k: number): THREE.Color {
  return active[((k % active.length) + active.length) % active.length];
}

export function sandHex(k: number): string {
  return activeHex[((k % activeHex.length) + activeHex.length) % activeHex.length];
}

/** Each sand gets a slightly different hiss: the center pitch of its grain sound, in Hz. */
export const SAND_PITCH = [3600, 2900, 4300, 3200, 2500] as const;
