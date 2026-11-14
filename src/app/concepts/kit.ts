/** Shared types and drawing helpers for the concept playground. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How a piece on the board is doing this frame. */
export interface PieceState {
  /** Stable per piece, for variety (rotation, petal count, flicker phase). */
  seed: number;
  /** Seconds since it last landed (large when it has been still for a while). */
  landAge: number;
  /** Rows fallen in the last landing, for how hard it lands. */
  drop: number;
  /** 0..1 while falling, else -1. */
  fall: number;
  /** Highlight while pressed (0..1). */
  glow: number;
}

export interface Flyer {
  kind: number;
  seed: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  t0: number;
  dur: number;
  /** Order within its group. */
  k: number;
  size: number;
}

export interface Collector {
  /** Start an empty keepsake for a level of `total` pieces; `enterAt` animates it in. */
  reset(total: number, enterAt: number): void;
  /** Where the piece with this running index will come to rest. */
  target(kind: number, index: number): { x: number; y: number };
  add(kind: number, t: number): void;
  pop(count: number): void;
  complete(t: number): void;
  /** When the clear flourish has finished and the next level can come in. */
  readonly doneAt: number;
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

export interface Layout {
  W: number;
  H: number;
  board: Rect;
  cell: number;
  cols: number;
  rows: number;
  /** The keepsake's area above the board. */
  top: Rect;
}

export interface Concept {
  id: string;
  name: string;
  blurb: string;
  colors: readonly string[];
  /** Page theme name (body[data-concept]). */
  ui: string;
  background(ctx: CanvasRenderingContext2D, L: Layout, t: number): void;
  /** Behind the pieces (rack, shelf, soil, night sky). */
  boardBack(ctx: CanvasRenderingContext2D, L: Layout, t: number): void;
  /** In front of the pieces (glass, shelf lip), optional. */
  boardFront?(ctx: CanvasRenderingContext2D, L: Layout, t: number): void;
  piece(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, s: number, t: number, st: PieceState): void;
  /** Fall time for h rows, and the eased progress (can overshoot for a bounce). */
  fallTime(h: number): number;
  fallEase(u: number): number;
  /** Delay between pieces of one column (bottom first) and before the fall starts after a lift. */
  stagger: number;
  liftDelay: number;
  flyTime(k: number, n: number): number;
  flyStagger: number;
  flyer(ctx: CanvasRenderingContext2D, f: Flyer, u: number, t: number): void;
  /** Extra effects drawn over everything (particles). */
  overlay?(ctx: CanvasRenderingContext2D, L: Layout, t: number): void;
  onLift?(cells: { x: number; y: number; kind: number }[], t: number, L: Layout): void;
  collector(L: () => Layout): Collector;
  sound: {
    lift(n: number, kind: number): void;
    land(rows: number): void;
    collect(kind: number, i: number): void;
    clear(): void;
  };
}

export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
export const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** Mix a #rrggbb color toward white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const to = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  r = Math.round(r + (to - r) * k);
  g = Math.round(g + (to - g) * k);
  b = Math.round(b + (to - b) * k);
  return `rgb(${r},${g},${b})`;
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A point on a quadratic curve. */
export function quad(a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, u: number) {
  const v = 1 - u;
  return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y };
}

/** Simple particles, for petals, sparks and fluff. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  t0: number;
  life: number;
  size: number;
  color: string;
  spin: number;
  kind: number;
}

export class Particles {
  list: Particle[] = [];
  add(p: Particle): void {
    if (this.list.length < 600) this.list.push(p);
  }
  draw(ctx: CanvasRenderingContext2D, t: number, paint: (ctx: CanvasRenderingContext2D, p: Particle, age: number, x: number, y: number) => void): void {
    this.list = this.list.filter((p) => t - p.t0 < p.life);
    for (const p of this.list) {
      const a = t - p.t0;
      if (a < 0) continue;
      paint(ctx, p, a / p.life, p.x + p.vx * a, p.y + p.vy * a + 0.5 * p.g * a * a);
    }
  }
}
