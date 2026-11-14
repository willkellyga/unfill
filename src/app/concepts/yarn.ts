import { clamp, easeOut, quad, roundRect, shade, type Collector, type Concept, type Flyer, type Layout, type PieceState } from './kit';
import { synth } from './sound';

/**
 * Yarn: balls of wool sit in a wooden cubby shelf. Lift a group and each ball rolls up toward the knitting needles,
 * unwinding into the scarf as it goes; the scarf grows a stripe of that color. Balls above drop softly and squash.
 */
const COLORS = ['#e46b8c', '#79b86f', '#8c7bd6', '#efb547', '#56a5d4'];
let needle = { x: 0, y: 0 };

/** A ball of yarn: shaded sphere wrapped in strands, turned by `spin`. */
function ball(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number, spin: number, sx = 1, sy = 1, tail = true): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(color, 0.3));
  g.addColorStop(0.7, color);
  g.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
  ctx.clip();
  ctx.rotate(spin);
  ctx.lineCap = 'round';
  // two crossing bands of strands
  for (let band = 0; band < 2; band++) {
    ctx.save();
    ctx.rotate(band ? 1.1 : -0.4);
    for (let i = -4; i <= 4; i++) {
      ctx.strokeStyle = i % 2 ? shade(color, -0.22) : shade(color, 0.22);
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.beginPath();
      ctx.ellipse(0, i * r * 0.2, r * 1.05, r * 0.32, 0, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  if (tail) {
    ctx.strokeStyle = shade(color, -0.1);
    ctx.lineWidth = Math.max(1.2, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(r * 0.6, r * 0.7);
    ctx.quadraticCurveTo(r * 1.1, r * 1.05, r * 0.95, r * 1.0);
    ctx.stroke();
  }
  ctx.restore();
}

/** Knit stitches: little V's, `cols` across and `rows` down, inside a rect. */
function knit(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number, rows: number): void {
  ctx.fillStyle = shade(color, -0.12);
  ctx.fillRect(x, y, w, h);
  const sh = h / rows;
  const sw = sh * 0.9;
  const cols = Math.max(1, Math.round(w / sw));
  const cw = w / cols;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const px = x + c * cw;
      const py = y + r * sh;
      ctx.fillStyle = shade(color, 0.12);
      ctx.beginPath();
      ctx.ellipse(px + cw * 0.3, py + sh * 0.5, cw * 0.26, sh * 0.5, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(px + cw * 0.7, py + sh * 0.5, cw * 0.26, sh * 0.5, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
}

let bgCache: { key: string; c: HTMLCanvasElement } | null = null;
function linen(L: Layout): HTMLCanvasElement {
  const key = `${L.W}x${L.H}`;
  if (bgCache?.key === key) return bgCache.c;
  const c = document.createElement('canvas');
  c.width = L.W;
  c.height = L.H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6eee3';
  g.fillRect(0, 0, L.W, L.H);
  for (let y = 0; y < L.H; y += 3) {
    g.fillStyle = y % 6 ? 'rgba(150,120,90,0.05)' : 'rgba(255,255,255,0.35)';
    g.fillRect(0, y, L.W, 1);
  }
  for (let x = 0; x < L.W; x += 3) {
    g.fillStyle = 'rgba(150,120,90,0.04)';
    g.fillRect(x, 0, 1, L.H);
  }
  bgCache = { key, c };
  return c;
}

class Scarf implements Collector {
  private items: { kind: number; t: number }[] = [];
  private total = 1;
  private enterT = 0;
  private doneT = Infinity;
  doneAt = Infinity;
  constructor(private readonly L: () => Layout) {}

  private geom() {
    const L = this.L();
    const w = L.W - 40;
    const h = Math.min(54, L.top.h * 0.42);
    const x = 20;
    const y = L.top.y + L.top.h - h - 8;
    return { x, y, w, h, seg: w / this.total };
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
    return { x: g.x + g.seg * (index + 1), y: g.y + g.h / 2 };
  }
  add(kind: number, t: number): void {
    this.items.push({ kind, t });
  }
  pop(count: number): void {
    this.items.splice(Math.max(0, this.items.length - count));
  }
  complete(t: number): void {
    this.doneT = t;
    this.doneAt = t + 1.7;
  }
  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.geom();
    const enter = easeOut(clamp((t - this.enterT) / 0.5, 0, 1));
    const lift = t > this.doneT + 1.0 ? Math.pow(clamp((t - this.doneT - 1.0) / 0.6, 0, 1), 2) : 0;
    ctx.save();
    ctx.translate(0, -lift * (g.y + g.h + 40));
    ctx.globalAlpha = enter;
    // stripes knit so far, each growing in as its ball unwinds
    let x = g.x;
    let end = g.x;
    this.items.forEach((it) => {
      const grow = clamp((t - it.t) / 0.25, 0, 1);
      const w = g.seg * grow;
      knit(ctx, COLORS[it.kind % 5], x, g.y, w + 0.6, g.h, 5);
      x += w;
      end = x;
    });
    // soft shadow under the scarf
    ctx.fillStyle = 'rgba(90,60,30,0.12)';
    ctx.fillRect(g.x, g.y + g.h, Math.max(0, end - g.x), 3);
    // fringe on the cast-on end, and on the far end once finished
    const fringe = (fx: number, kind: number) => {
      ctx.strokeStyle = COLORS[kind % 5];
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const fy = g.y + 4 + (i * (g.h - 8)) / 5;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.quadraticCurveTo(fx + (fx < g.x + 5 ? -6 : 6), fy + 2, fx + (fx < g.x + 5 ? -12 : 12), fy + 4);
        ctx.stroke();
      }
    };
    if (this.items.length) fringe(g.x, this.items[0].kind);
    if (t > this.doneT && this.items.length) fringe(end, this.items[this.items.length - 1].kind);
    // knitting needles at the growing end
    needle = { x: end, y: g.y + g.h / 2 };
    if (t < this.doneT + 0.3) {
      const wig = Math.sin(t * 18) * 0.05;
      for (const a of [-0.55 + wig, -0.95 - wig]) {
        ctx.save();
        ctx.translate(end, g.y + g.h / 2);
        ctx.rotate(a);
        ctx.fillStyle = '#c99b62';
        roundRect(ctx, -3, -g.h * 1.25, 6, g.h * 2.2, 3);
        ctx.fill();
        ctx.fillStyle = '#e8c27e';
        ctx.beginPath();
        ctx.arc(0, -g.h * 1.25, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

export const yarn: Concept = {
  id: 'yarn',
  name: 'Yarn',
  blurb: 'Balls of wool unwind and knit a striped scarf.',
  colors: COLORS,
  ui: 'yarn',
  background(ctx, L) {
    ctx.drawImage(linen(L), 0, 0, L.W, L.H);
  },
  boardBack(ctx, L) {
    const b = L.board;
    const pad = L.cell * 0.14;
    ctx.fillStyle = 'rgba(90,55,25,0.2)';
    roundRect(ctx, b.x - pad + 2, b.y - pad + 6, b.w + 2 * pad, b.h + 2 * pad, 10);
    ctx.fill();
    ctx.fillStyle = '#d9a86c';
    roundRect(ctx, b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 10);
    ctx.fill();
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++) {
        const x = b.x + c * L.cell + L.cell * 0.05;
        const y = b.y + r * L.cell + L.cell * 0.05;
        const s = L.cell * 0.9;
        const g = ctx.createLinearGradient(0, y, 0, y + s);
        g.addColorStop(0, '#8a5a30');
        g.addColorStop(0.35, '#b07a45');
        g.addColorStop(1, '#c48e55');
        ctx.fillStyle = g;
        roundRect(ctx, x, y, s, s, 4);
        ctx.fill();
      }
  },
  piece(ctx, kind, x, y, s, _t, st: PieceState) {
    const r = s * 0.4;
    let sx = 1;
    let sy = 1;
    if (st.landAge < 0.45) {
      const k = Math.sin(st.landAge * Math.PI * 4) * Math.exp(-st.landAge * 8) * Math.min(1, st.drop / 2);
      sy = 1 - 0.18 * k;
      sx = 1 + 0.12 * k;
    }
    if (st.glow) {
      sx *= 1.07;
      sy *= 1.07;
    }
    const spin = st.fall >= 0 ? y / (r * 2) : st.seed;
    ball(ctx, COLORS[kind % 5], x, y + s * 0.06 + r * (1 - sy), r, spin, sx, sy);
  },
  fallTime: (h) => 0.2 + 0.075 * h,
  fallEase: (u) => u * u,
  stagger: 0.035,
  liftDelay: 0.1,
  flyTime: () => 0.85,
  flyStagger: 0.09,
  flyer(ctx, f: Flyer, u, t) {
    // the ball rolls up to the needles, unwinding: a strand runs from it to the scarf the whole way
    const c = { x: (f.from.x + f.to.x) / 2 + (f.k % 2 ? 40 : -40), y: Math.min(f.from.y, f.to.y) - 40 };
    const p = quad(f.from, c, needle, easeOut(u));
    const r = f.size * 0.4 * (1 - 0.85 * u);
    ctx.strokeStyle = COLORS[f.kind % 5];
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo((p.x + needle.x) / 2, Math.max(p.y, needle.y) + 30 * (1 - u), needle.x, needle.y);
    ctx.stroke();
    ball(ctx, COLORS[f.kind % 5], p.x, p.y, r, t * 10 + f.seed, 1, 1, false);
  },
  collector: (L) => new Scarf(L),
  sound: {
    lift(n) {
      synth.tone(330, 0, 0.25, 0.08, 'triangle', 0.7);
      synth.noise(0, 0.12 + n * 0.02, 0.05, 900, 0.8, 'lowpass');
    },
    land(rows) {
      synth.noise(0, 0.1, Math.min(0.1, 0.03 + rows * 0.015), 260, 0.7, 'lowpass');
    },
    collect(_k, i) {
      // two needle clicks
      synth.tone(1900 + (i % 3) * 80, 0, 0.03, 0.05, 'square');
      synth.tone(2200, 0.07, 0.03, 0.04, 'square');
    },
    clear() {
      [392, 494, 587, 784].forEach((f, i) => synth.tone(f, 0.2 + i * 0.12, 0.7, 0.07, 'triangle'));
    },
  },
};
