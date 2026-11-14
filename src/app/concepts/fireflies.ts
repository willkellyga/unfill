import { clamp, easeInOut, easeOut, rgba, roundRect, shade, type Collector, type Concept, type Flyer, type Layout, type PieceState } from './kit';
import { synth } from './sound';

/**
 * Fireflies: paper lanterns hang in rows over a night meadow. Lift a group and each lantern lets out a little swarm
 * of fireflies that drift up into a glass jar, which glows brighter in their colors. Lanterns above float down.
 */
const COLORS = ['#ff8fcf', '#7dffae', '#b59bff', '#ffd84d', '#78c8ff'];
const PER = 5; // fireflies per lantern

let skyCache: { key: string; c: HTMLCanvasElement } | null = null;
function sky(L: Layout): HTMLCanvasElement {
  const key = `${L.W}x${L.H}`;
  if (skyCache?.key === key) return skyCache.c;
  const c = document.createElement('canvas');
  c.width = L.W;
  c.height = L.H;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, L.H);
  grd.addColorStop(0, '#0e1233');
  grd.addColorStop(0.6, '#1f1b4a');
  grd.addColorStop(1, '#2d2050');
  g.fillStyle = grd;
  g.fillRect(0, 0, L.W, L.H);
  // a soft moon
  const m = g.createRadialGradient(L.W * 0.82, L.H * 0.05, 4, L.W * 0.82, L.H * 0.05, 90);
  m.addColorStop(0, 'rgba(255,250,225,0.5)');
  m.addColorStop(1, 'rgba(255,250,225,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, L.W, L.H);
  // meadow silhouettes
  g.fillStyle = '#151233';
  g.beginPath();
  g.moveTo(0, L.H);
  for (let x = 0; x <= L.W; x += 8) g.lineTo(x, L.H * 0.86 + Math.sin(x * 0.01) * 14 + Math.sin(x * 0.043) * 5);
  g.lineTo(L.W, L.H);
  g.fill();
  skyCache = { key, c };
  return c;
}

const stars = Array.from({ length: 60 }, (_, i) => ({ x: (i * 0.6180339) % 1, y: ((i * 0.37) % 1) * 0.9, p: i * 1.7, s: 0.6 + (i % 3) * 0.4 }));

function glow(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/** A round paper lantern lit from inside; `lit` dims it as its fireflies leave. */
function lantern(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, s: number, lit: number, t: number, seed: number): void {
  const flick = 0.85 + 0.15 * Math.sin(t * 7 + seed) * Math.sin(t * 3.1 + seed * 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, color, x, y, s * 0.85, 0.32 * lit * flick);
  ctx.restore();
  const rw = s * 0.36;
  const rh = s * 0.33;
  const g = ctx.createRadialGradient(x, y - rh * 0.1, rh * 0.1, x, y, rw * 1.1);
  g.addColorStop(0, lit > 0.2 ? shade(color, 0.75) : shade(color, -0.3));
  g.addColorStop(0.6, lit > 0.2 ? color : shade(color, -0.45));
  g.addColorStop(1, shade(color, -0.4));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
  ctx.fill();
  // paper ribs
  ctx.strokeStyle = rgba('#3a1d0a', 0.25);
  ctx.lineWidth = 1;
  for (const k of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rw * Math.abs(k) * 1.1 + 0.5, rh, 0, -Math.PI / 2, Math.PI / 2, k < 0);
    ctx.stroke();
  }
  // caps and string
  ctx.fillStyle = '#2a1a30';
  roundRect(ctx, x - rw * 0.4, y - rh - 3, rw * 0.8, 4, 2);
  ctx.fill();
  roundRect(ctx, x - rw * 0.35, y + rh - 1, rw * 0.7, 4, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(220,210,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(x, y - rh - 3);
  ctx.lineTo(x, y - s * 0.5);
  ctx.stroke();
}

class GlowJar implements Collector {
  private items: { kind: number; t: number }[] = [];
  private total = 1;
  private enterT = 0;
  private doneT = Infinity;
  doneAt = Infinity;
  constructor(private readonly L: () => Layout) {}
  private geom() {
    const L = this.L();
    const h = L.top.h - 12;
    const w = Math.min(130, h * 0.85);
    return { x: L.W / 2 - w / 2, y: L.top.y + 8, w, h, neck: h * 0.14 };
  }
  reset(total: number, enterAt: number): void {
    this.items = [];
    this.total = Math.max(1, total);
    this.enterT = enterAt;
    this.doneT = Infinity;
    this.doneAt = Infinity;
  }
  target(_kind: number, index: number) {
    const g = this.geom();
    const a = index * 2.4;
    return { x: g.x + g.w / 2 + Math.cos(a) * g.w * 0.25, y: g.y + g.neck + (g.h - g.neck) * (0.35 + 0.4 * ((index * 0.37) % 1)) };
  }
  add(kind: number, t: number): void {
    this.items.push({ kind, t });
  }
  pop(count: number): void {
    this.items.splice(Math.max(0, this.items.length - count));
  }
  complete(t: number): void {
    this.doneT = t;
    this.doneAt = t + 1.9;
  }
  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.geom();
    const enter = easeOut(clamp((t - this.enterT) / 0.6, 0, 1));
    const rise = t > this.doneT + 1.1 ? Math.pow(clamp((t - this.doneT - 1.1) / 0.7, 0, 1), 2) : 0;
    const fill = this.items.length / this.total;
    ctx.save();
    ctx.translate(0, -rise * (g.y + g.h + 30) + (1 - enter) * 30);
    ctx.globalAlpha = enter;
    const cx = g.x + g.w / 2;
    const cy = g.y + g.neck + (g.h - g.neck) / 2;
    // the jar's glow, in the colors it holds
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = t > this.doneT ? 1 + 0.35 * Math.sin(clamp((t - this.doneT) / 0.8, 0, 1) * Math.PI) : 1;
    const counts = [0, 0, 0, 0, 0];
    for (const it of this.items) counts[it.kind % 5]++;
    counts.forEach((c, k) => {
      if (c) glow(ctx, COLORS[k], cx + (k - 2) * 6, cy, g.w * (0.7 + fill * 0.5), Math.min(0.3, (c / this.total) * 1.0) * pulse);
    });
    ctx.restore();
    // glass
    roundRect(ctx, g.x, g.y + g.neck, g.w, g.h - g.neck, 20);
    ctx.fillStyle = 'rgba(200,210,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,225,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    roundRect(ctx, g.x + g.w * 0.2, g.y, g.w * 0.6, g.neck + 2, 5);
    ctx.stroke();
    // fireflies inside, wandering
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // a few fireflies per lantern, thinned out as the jar fills so it glows without washing out
    const per = Math.max(1, Math.min(PER, Math.floor(90 / Math.max(1, this.items.length))));
    this.items.forEach((it, i) => {
      for (let j = 0; j < per; j++) {
        const s = i * 7.3 + j * 3.1;
        const fx = cx + Math.sin(t * (0.6 + (s % 0.5)) + s) * g.w * 0.36;
        const fy = cy + Math.cos(t * (0.5 + (s % 0.4)) + s * 1.3) * (g.h - g.neck) * 0.36;
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + s * 2);
        glow(ctx, COLORS[it.kind % 5], fx, fy, 7, 0.55 * tw);
        ctx.fillStyle = rgba('#ffffff', 0.7 * tw);
        ctx.fillRect(fx - 0.8, fy - 0.8, 1.6, 1.6);
      }
    });
    ctx.restore();
    // lid twists on at the end
    if (t > this.doneT) {
      const u = easeOut(clamp((t - this.doneT) / 0.35, 0, 1));
      ctx.fillStyle = '#c9a25c';
      roundRect(ctx, g.x + g.w * 0.16, g.y - 22 * (1 - u) - 2, g.w * 0.68, g.neck * 0.8, 5);
      ctx.fill();
    }
    ctx.restore();
  }
}

export const fireflies: Concept = {
  id: 'fireflies',
  name: 'Fireflies',
  blurb: 'Lanterns set their fireflies free into a glowing jar.',
  colors: COLORS,
  ui: 'fireflies',
  background(ctx, L, t) {
    ctx.drawImage(sky(L), 0, 0, L.W, L.H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.p))})`;
      ctx.fillRect(s.x * L.W, s.y * L.H * 0.5, s.s, s.s);
    }
  },
  boardBack(ctx, L) {
    // strings the lanterns hang from, one per row
    const b = L.board;
    ctx.strokeStyle = 'rgba(210,200,255,0.18)';
    ctx.lineWidth = 1;
    for (let r = 0; r < L.rows; r++) {
      const y = b.y + r * L.cell + L.cell * 0.04;
      ctx.beginPath();
      ctx.moveTo(b.x - 6, y);
      ctx.quadraticCurveTo(b.x + b.w / 2, y + 6, b.x + b.w + 6, y);
      ctx.stroke();
    }
  },
  piece(ctx, kind, x, y, s, t, st: PieceState) {
    // lanterns float, sway as they drift down, and bob on landing
    let dx = Math.sin(t * 0.9 + st.seed) * s * 0.03;
    let dy = Math.sin(t * 1.2 + st.seed * 0.7) * s * 0.03;
    if (st.fall >= 0) dx += Math.sin(st.fall * Math.PI) * s * 0.12 * (st.seed % 2 ? 1 : -1);
    if (st.landAge < 1) dy += Math.sin(st.landAge * 7) * Math.exp(-st.landAge * 4) * s * 0.06;
    lantern(ctx, COLORS[kind % 5], x + dx, y + dy, s * (1 + 0.08 * st.glow), 1 + st.glow * 0.5, t, st.seed);
  },
  fallTime: (h) => 0.45 + 0.13 * h,
  fallEase: easeInOut,
  stagger: 0.08,
  liftDelay: 0.25,
  flyTime: (k) => 1.0 + (k % 4) * 0.08,
  flyStagger: 0.05,
  flyer(ctx, f: Flyer, u, t) {
    // the lantern fades where it hung while its fireflies wander up to the jar
    if (u < 0.35) lantern(ctx, COLORS[f.kind % 5], f.from.x, f.from.y, f.size * (1 - u * 0.4), 1 - u / 0.35, t, f.seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < PER; j++) {
      const s = f.seed + j * 5.7;
      const v = clamp(u * (1.05 + j * 0.04) - j * 0.03, 0, 1);
      const e = easeInOut(v);
      const wob = Math.sin(v * Math.PI) * (30 + (j % 3) * 14);
      const x = f.from.x + (f.to.x - f.from.x) * e + Math.sin(v * 9 + s) * wob * 0.5;
      const y = f.from.y + (f.to.y - f.from.y) * e + Math.cos(v * 7 + s) * wob * 0.3;
      glow(ctx, COLORS[f.kind % 5], x, y, 9, 0.75);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.restore();
  },
  collector: (L) => new GlowJar(L),
  sound: {
    lift(n) {
      for (let i = 0; i < Math.min(8, n * 2); i++) synth.tone(1800 + Math.random() * 1800, i * 0.04, 0.25, 0.02);
      synth.noise(0, 0.35, 0.03, 1400, 0.5);
    },
    land() {
      synth.tone(220, 0, 0.3, 0.02, 'sine');
    },
    collect(_k, i) {
      const scale = [1568, 1760, 2093, 2349, 2637, 3136];
      synth.tone(scale[(i * 3) % scale.length], 0, 0.5, 0.025);
    },
    clear() {
      [523, 784, 1047, 1568, 2093].forEach((f, i) => synth.tone(f, 0.2 + i * 0.13, 1.2, 0.05));
    },
  },
};
