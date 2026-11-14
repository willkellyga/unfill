/**
 * Look-and-feel themes (mockups). A theme changes only how the game looks, sounds and moves: the sand colors, the
 * room, the frame, the block material and shape, how blocks fall when the sand below them is lifted, and the
 * page's UI (through body[data-theme] in style.css). The rules and the board are untouched.
 */
export type MotionStyle = 'sand' | 'jelly' | 'snap' | 'float' | 'thunk';

export interface Theme {
  label: string;
  /** Library colors 0..4. */
  sand: [string, string, string, string, string];
  room: {
    /** Backdrop gradient, top to bottom. */
    sky: [string, string, string];
    fog: string;
    hemiSky: string;
    hemiGround: string;
    hemiI: number;
    key: string;
    keyI: number;
    env: number;
    exposure: number;
    /** Table tint, and whether it keeps its wood grain. */
    table: string;
    tableGrain: boolean;
    caustics: boolean;
  };
  frame: { color: string; grain: boolean; roughness: number; metalness: number };
  glass: { color: string; opacity: number };
  block: {
    /** Corner radius, and segments (1 makes a crisp chamfer, like a cut gem). */
    radius: number;
    segments: number;
    roughness: number;
    metalness: number;
    env: number;
    /** 'sand' grain, 'grain' painted wood, or 'none' for smooth. */
    map: 'sand' | 'grain' | 'none';
    flat: boolean;
    /** Lit from within by its own color (0..1). */
    self: number;
    /** Fill the seams between touching blocks of one color, so a group reads as one piece. */
    bridges: boolean;
  };
  motion: MotionStyle;
  /** Browser chrome color. */
  chrome: string;
}

export const THEMES = {
  terrarium: {
    label: 'Terrarium',
    sand: ['#e98aa6', '#8cc486', '#a894e0', '#f1c65a', '#7db4e0'],
    room: {
      sky: ['#fbeee0', '#f6e2cd', '#efd3b8'],
      fog: '#f3dcc5',
      hemiSky: '#fff1e2',
      hemiGround: '#c59a76',
      hemiI: 1.35,
      key: '#ffd6a3',
      keyI: 2.4,
      env: 0.32,
      exposure: 1,
      table: '#f4e4d0',
      tableGrain: true,
      caustics: true,
    },
    frame: { color: '#ffffff', grain: true, roughness: 0.78, metalness: 0 },
    glass: { color: '#f4fbff', opacity: 0.1 },
    block: { radius: 0.13, segments: 3, roughness: 0.93, metalness: 0, env: 0.6, map: 'sand', flat: false, self: 0, bridges: true },
    motion: 'sand',
    chrome: '#f6e2cd',
  },
  /** Glossy candy jelly on a strawberry-milk room: bouncy squash and stretch, bubbly UI. */
  jelly: {
    label: 'Jelly',
    sand: ['#ff6f9f', '#3fd0a0', '#a07bff', '#ffbf3c', '#4cb8ff'],
    room: {
      sky: ['#fff0f6', '#ffdcea', '#ffc8de'],
      fog: '#ffd2e4',
      hemiSky: '#fff6fb',
      hemiGround: '#f0a9c6',
      hemiI: 1.45,
      key: '#fff3f8',
      keyI: 2.1,
      env: 0.55,
      exposure: 1.02,
      table: '#ffc3da',
      tableGrain: false,
      caustics: false,
    },
    frame: { color: '#fff7fb', grain: false, roughness: 0.3, metalness: 0 },
    glass: { color: '#ffe6f1', opacity: 0.14 },
    block: { radius: 0.3, segments: 5, roughness: 0.16, metalness: 0, env: 1.5, map: 'none', flat: false, self: 0.14, bridges: false },
    motion: 'jelly',
    chrome: '#ffdcea',
  },
  /** Cut gems in a gold frame on deep navy: crisp, quick drops with a glint. */
  gems: {
    label: 'Gems',
    sand: ['#ff3d7f', '#22c96e', '#8a4dff', '#ffbd2e', '#1e8fff'],
    room: {
      sky: ['#33438c', '#232e66', '#161d45'],
      fog: '#1d2657',
      hemiSky: '#d6defd',
      hemiGround: '#2b2457',
      hemiI: 1.05,
      key: '#ffffff',
      keyI: 2.8,
      env: 0.9,
      exposure: 1.05,
      table: '#2a356f',
      tableGrain: false,
      caustics: false,
    },
    frame: { color: '#e0ad4a', grain: false, roughness: 0.28, metalness: 0.85 },
    glass: { color: '#dfe8ff', opacity: 0.08 },
    block: { radius: 0.27, segments: 1, roughness: 0.08, metalness: 0.35, env: 3.2, map: 'none', flat: true, self: 0.06, bridges: false },
    motion: 'snap',
    chrome: '#232e66',
  },
  /** Night: soft glowing pastels drift down slowly in a dusky violet room. */
  moonlit: {
    label: 'Moonlit',
    sand: ['#ff7fb6', '#5fe0a8', '#9c82ff', '#ffd062', '#5fc0ff'],
    room: {
      sky: ['#1b1838', '#2a2552', '#3d3163'],
      fog: '#26224a',
      hemiSky: '#9a97e0',
      hemiGround: '#1b1532',
      hemiI: 0.75,
      key: '#cbd8ff',
      keyI: 1.25,
      env: 0.25,
      exposure: 1,
      table: '#2b2550',
      tableGrain: false,
      caustics: false,
    },
    frame: { color: '#4a4380', grain: false, roughness: 0.55, metalness: 0.2 },
    glass: { color: '#cfd6ff', opacity: 0.1 },
    block: { radius: 0.22, segments: 4, roughness: 0.5, metalness: 0, env: 0.4, map: 'sand', flat: false, self: 0.32, bridges: true },
    motion: 'float',
    chrome: '#1b1838',
  },
  /** Painted wooden toy blocks on a linen table: heavy, satisfying thunks, chunky stamped UI. */
  toys: {
    label: 'Toys',
    sand: ['#e0533a', '#3f9a62', '#3a6db8', '#f0ae2e', '#8c58a6'],
    room: {
      sky: ['#f7f3ea', '#efe7d8', '#e6dac5'],
      fog: '#ece2cf',
      hemiSky: '#fffaf0',
      hemiGround: '#b89c7a',
      hemiI: 1.3,
      key: '#fff0d8',
      keyI: 2.5,
      env: 0.3,
      exposure: 1,
      table: '#f6ead6',
      tableGrain: true,
      caustics: true,
    },
    frame: { color: '#ffffff', grain: true, roughness: 0.75, metalness: 0 },
    glass: { color: '#f4fbff', opacity: 0.08 },
    block: { radius: 0.06, segments: 2, roughness: 0.72, metalness: 0, env: 0.45, map: 'grain', flat: false, self: 0, bridges: false },
    motion: 'thunk',
    chrome: '#efe7d8',
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;
