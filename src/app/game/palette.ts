import * as THREE from 'three';

/**
 * Five pastel sands, the same hues as the 2D lab so the colors she knows carry over, nudged a little warmer and
 * softer for lit 3D surfaces. Order matters: library colors 0..4 map to these.
 */
export const SAND_HEX = ['#e98aa6', '#8cc486', '#a894e0', '#f1c65a', '#7db4e0'] as const;

export const SAND = SAND_HEX.map((h) => new THREE.Color(h));

export function sandColor(k: number): THREE.Color {
  return SAND[((k % SAND.length) + SAND.length) % SAND.length];
}

/** Each sand gets a slightly different hiss: the center pitch of its grain sound, in Hz. */
export const SAND_PITCH = [3600, 2900, 4300, 3200, 2500] as const;
