/**
 * Performance tiers (plan: "Performance tiers"). The game starts on Medium, watches the frame time for its first
 * two seconds of play, and drops to Low if the phone can't keep up. The player can pick a tier in settings, and
 * that choice is kept.
 *
 * Depth of field (High in the plan) isn't in this slice: it needs a post-processing pass, and the camera is close
 * enough that the table already falls off softly into the backdrop.
 */
export type TierName = 'low' | 'medium' | 'high';

export interface Tier {
  name: TierName;
  label: string;
  /** Device pixel ratio cap (plan: never above 2). */
  maxDpr: number;
  /** Real-time soft shadows. Medium and Low use baked contact shadows only. */
  shadows: boolean;
  /** Grains alive on screen at once (plan: 20,000 / 8,000 / 2,000). */
  maxGrains: number;
  /** Grains per block that pours, per block that flies to the bottle. */
  grainsPerBlock: number;
  /** Rounded-corner segments of a sand block. */
  blockSegments: number;
  /** The caustic shimmer through the glass. */
  caustics: boolean;
}

export const TIERS: Record<TierName, Tier> = {
  low: { name: 'low', label: 'Low', maxDpr: 1.25, shadows: false, maxGrains: 2000, grainsPerBlock: 24, blockSegments: 2, caustics: false },
  medium: { name: 'medium', label: 'Medium', maxDpr: 2, shadows: false, maxGrains: 8000, grainsPerBlock: 90, blockSegments: 3, caustics: true },
  high: { name: 'high', label: 'High', maxDpr: 2, shadows: true, maxGrains: 20000, grainsPerBlock: 200, blockSegments: 4, caustics: true },
};

/** Frame-time check: average frame interval (ms) above which Medium steps down to Low. 50 fps. */
export const SLOW_FRAME_MS = 20;
