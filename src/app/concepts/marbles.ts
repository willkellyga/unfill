import { clamp, easeOut, quad, roundRect, shade, type Collector, type Concept, type Flyer, type Layout, type PieceState } from './kit';
import { synth } from './sound';

/**
 * Marbles: glass marbles sit in a wooden solitaire board. Lift a group and the marbles hop out and arc into a
 * glass jar, clinking down onto the pile. Marbles above drop into the empty holes with a couple of bounces.
 */
const COLORS = ['#e8436a', '#22b07d', '#7b5cff', '#ffad14', '#1d97f5'];
let mouth = { x: 0, y: 0 };

function bounceOut(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
}

/** A glass marble with a twisted ribbon inside; `roll` turns the ribbon as it rolls. */
function marble(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, roll: number, seed: number, shadow = true): void {
  if (shadow) {
    ctx.fillStyle = 'rgba(40,20,5,0.28)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.18, y + r * 0.82, r * 0.82, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // glass body
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, shade(color, 0.55));
  g.addColorStop(0.45, color);
  g.addColorStop(1, shade(color, -0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // the twist inside
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(roll + seed);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = shade(color, 0.7);
  ctx.beginPath();
  ctx.moveTo(-r, -r * 0.1);
  ctx.bezierCurveTo(-r * 0.3, -r * 0.7, r * 0.3, r * 0.6, r, r * 0.05);
  ctx.bezierCurveTo(r * 0.3, r * 0.35, -r * 0.3, -r * 0.35, -r, -r * 0.1);
  ctx.fill();
  ctx.fillStyle = shade(color, -0.25);
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.25);
  ctx.bezierCurveTo(-r * 0.2, -r * 0.2, r * 0.2, r * 0.9, r, r * 0.45);
  ctx.lineTo(r, r * 0.55);
  ctx.bezierCurveTo(r * 0.2, r, -r * 0.2, -r * 0.05, -r, r * 0.35);
  ctx.fill();
  ctx.restore();
  // shine
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x + r * 0.42, y + r * 0.38, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

let woodCache: { key: string; c: HTMLCanvasElement } | null = null;
function woodBackground(L: Layout): HTMLCanvasElement {
  const key = `${L.W}x${L.H}`;
  if (woodCache?.key === key) return woodCache.c;
  const c = document.createElement('canvas');
  c.width = L.W;
  c.height = L.H;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, L.H);
  grd.addColorStop(0, '#f3e1c4');
  grd.addColorStop(1, '#e7c9a0');
  g.fillStyle = grd;
  g.fillRect(0, 0, L.W, L.H);
  let s = 3;
  const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const y = R() * L.H;
    g.strokeStyle = `rgba(160,110,60,${0.05 + R() * 0.08})`;
    g.lineWidth = 0.6 + R() * 1.6;
    g.beginPath();
    for (let x = 0; x <= L.W; x += 10) g.lineTo(x, y + Math.sin(x * 0.012 + i) * (2 + R() * 3));
    g.stroke();
  }
  woodCache = { key, c };
  return c;
}

class Jar implements Collector {
  private items: { kind: number; t: number }[] = [];
  private enterT = 0;
  private lidT = Infinity;
  doneAt = Infinity;
  private total = 1;
  constructor(private readonly L: () => Layout) {}

  private geom() {
    const L = this.L();
    const h = L.top.h - 10;
    const w = Math.min(160, L.W * 0.4, h * 1.0);
    const x = L.W / 2 - w / 2;
    const y = L.top.y + 6;
    const neck = h * 0.16;
    const inner = { x: x + 8, y: y + neck + 6, w: w - 16, h: h - neck - 12 };
    // marble size so the whole level fits, packed in offset rows
    let r = inner.w / 6;
    for (; r > 2; r -= 0.25) {
      const per = Math.floor(inner.w / (2 * r));
      const rows = Math.ceil(this.total / Math.max(1, per));
      if (rows * r * 1.75 + r * 0.3 <= inner.h) break;
    }
    return { x, y, w, h, neck, inner, r };
  }

  private slide(t: number): number {
    const e = clamp((t - this.enterT) / 0.5, 0, 1);
    const x = (1 - easeOut(e)) * -this.L().W * 0.7;
    const out = t > this.lidT + 0.9 ? Math.pow(clamp((t - this.lidT - 0.9) / 0.5, 0, 1), 2) * this.L().W : 0;
    return x + out;
  }

  reset(total: number, enterAt: number): void {
    this.items = [];
    this.total = Math.max(1, total);
    this.enterT = enterAt;
    this.lidT = Infinity;
    this.doneAt = Infinity;
  }
  target(_kind: number, index: number) {
    const g = this.geom();
    const per = Math.max(1, Math.floor(g.inner.w / (2 * g.r)));
    const row = Math.floor(index / per);
    const k = index % per;
    const off = row % 2 ? g.r : 0;
    const usable = per - (row % 2 ? 1 : 0);
    const kk = Math.min(k, usable - 1);
    const left = g.inner.x + (g.inner.w - per * 2 * g.r) / 2 + g.r;
    return { x: left + off + kk * 2 * g.r, y: g.inner.y + g.inner.h - g.r - row * g.r * 1.75 };
  }
  add(kind: number, t: number): void {
    this.items.push({ kind, t });
  }
  pop(count: number): void {
    this.items.splice(Math.max(0, this.items.length - count));
  }
  complete(t: number): void {
    this.lidT = t + 0.15;
    this.doneAt = t + 1.55;
  }
  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.geom();
    const dx = this.slide(t);
    ctx.save();
    ctx.translate(dx, 0);
    mouth = { x: g.x + g.w / 2 + dx, y: g.y + g.neck * 0.5 };
    // jar back
    ctx.fillStyle = 'rgba(80,40,10,0.18)';
    ctx.beginPath();
    ctx.ellipse(g.x + g.w / 2, g.y + g.h + 2, g.w * 0.48, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    roundRect(ctx, g.x, g.y + g.neck, g.w, g.h - g.neck, 22);
    ctx.fillStyle = 'rgba(225,245,250,0.35)';
    ctx.fill();
    // marbles inside
    this.items.forEach((it, i) => {
      const p = this.target(it.kind, i);
      const age = t - it.t;
      const bounce = age < 0.35 ? -Math.abs(Math.sin(age * Math.PI * 3)) * g.r * 0.5 * (1 - age / 0.35) : 0;
      marble(ctx, COLORS[it.kind % 5], p.x, p.y + bounce, g.r * 0.96, i * 1.7, i, false);
    });
    // glass front and rim
    roundRect(ctx, g.x, g.y + g.neck, g.w, g.h - g.neck, 22);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(ctx, g.x + 8, g.y + g.neck + 10, 9, g.h - g.neck - 30, 5);
    ctx.fill();
    roundRect(ctx, g.x + g.w * 0.18, g.y + g.neck * 0.25, g.w * 0.64, g.neck * 0.9, 6);
    ctx.fillStyle = 'rgba(230,248,252,0.5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // lid screws on at the end
    if (t > this.lidT) {
      const u = clamp((t - this.lidT) / 0.35, 0, 1);
      const ly = g.y - 30 * (1 - easeOut(u));
      const grd = ctx.createLinearGradient(0, ly, 0, ly + g.neck);
      grd.addColorStop(0, '#f3c75b');
      grd.addColorStop(1, '#b8861f');
      ctx.fillStyle = grd;
      roundRect(ctx, g.x + g.w * 0.12, ly, g.w * 0.76, g.neck * 1.05, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,80,10,0.5)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const xx = g.x + g.w * 0.12 + (g.w * 0.76 * i) / 8;
        ctx.beginPath();
        ctx.moveTo(xx, ly + 3);
        ctx.lineTo(xx, ly + g.neck - 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export const marbles: Concept = {
  id: 'marbles',
  name: 'Marbles',
  blurb: 'Glass marbles hop out and clink into a jar.',
  colors: COLORS,
  ui: 'marbles',
  background(ctx, L) {
    ctx.drawImage(woodBackground(L), 0, 0, L.W, L.H);
  },
  boardBack(ctx, L) {
    const b = L.board;
    const pad = L.cell * 0.18;
    ctx.fillStyle = 'rgba(70,35,10,0.25)';
    roundRect(ctx, b.x - pad + 3, b.y - pad + 6, b.w + 2 * pad, b.h + 2 * pad, 18);
    ctx.fill();
    const grd = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    grd.addColorStop(0, '#a8682f');
    grd.addColorStop(1, '#8a4f1f');
    ctx.fillStyle = grd;
    roundRect(ctx, b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,170,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // a dimple for every hole
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++) {
        const x = b.x + (c + 0.5) * L.cell;
        const y = b.y + (r + 0.5) * L.cell;
        const h = ctx.createRadialGradient(x, y - L.cell * 0.08, L.cell * 0.05, x, y, L.cell * 0.4);
        h.addColorStop(0, '#5a2f10');
        h.addColorStop(1, '#93582a');
        ctx.fillStyle = h;
        ctx.beginPath();
        ctx.arc(x, y, L.cell * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
  },
  piece(ctx, kind, x, y, s, _t, st: PieceState) {
    const r = s * 0.42 * (1 + 0.06 * st.glow);
    const roll = st.fall >= 0 ? y / (r * 1.2) : 0;
    if (st.glow) {
      ctx.fillStyle = 'rgba(255,240,200,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
      ctx.fill();
    }
    marble(ctx, COLORS[kind % 5], x, y, r, roll, st.seed);
  },
  fallTime: (h) => 0.28 + 0.085 * h,
  fallEase: bounceOut,
  stagger: 0.05,
  liftDelay: 0.12,
  flyTime: () => 0.75,
  flyStagger: 0.06,
  flyer(ctx, f: Flyer, u, t) {
    // hop up, arc over to the jar's mouth, then drop onto the pile
    const r0 = f.size * 0.42;
    const hop = clamp(u / 0.12, 0, 1);
    let p: { x: number; y: number };
    if (u < 0.65) {
      const v = clamp((u - 0.05) / 0.6, 0, 1);
      const c = { x: (f.from.x + mouth.x) / 2, y: Math.min(f.from.y, mouth.y) - 70 };
      p = quad(f.from, c, mouth, easeOut(v));
      p.y -= Math.sin(hop * Math.PI) * 6;
    } else {
      const v = (u - 0.65) / 0.35;
      p = { x: mouth.x + (f.to.x - mouth.x) * v, y: mouth.y + (f.to.y - mouth.y) * v * v };
    }
    const target = r0 * 0.45;
    const r = r0 + (target - r0) * clamp((u - 0.1) / 0.5, 0, 1);
    marble(ctx, COLORS[f.kind % 5], p.x, p.y, r, t * 9 + f.k, f.seed, false);
  },
  collector: (L) => new Jar(L),
  sound: {
    lift(n) {
      for (let i = 0; i < Math.min(n, 6); i++) synth.tone(700 + i * 60, i * 0.05, 0.08, 0.06, 'triangle', 1.8);
    },
    land(rows) {
      const v = Math.min(0.12, 0.03 + rows * 0.02);
      synth.tone(2200 + Math.random() * 900, 0, 0.09, v);
      synth.tone(3300 + Math.random() * 600, 0.11, 0.06, v * 0.5);
    },
    collect(_k, i) {
      synth.tone(2600 + ((i * 377) % 1400), 0, 0.12, 0.07);
      synth.tone(4100 + ((i * 211) % 900), 0.01, 0.08, 0.03);
    },
    clear() {
      [784, 988, 1175, 1568].forEach((f, i) => synth.tone(f, 0.25 + i * 0.09, 0.5, 0.08));
    },
  },
};


