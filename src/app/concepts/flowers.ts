import { clamp, easeOut, quad, roundRect, shade, Particles, type Collector, type Concept, type Flyer, type Layout, type PieceState } from './kit';
import { synth } from './sound';

/**
 * Flowers: blooms grow in a raised garden bed. Lift a group and they're picked, stems and all, and fly up into a
 * vase, filling out a bouquet. A puff of petals drifts down from where they grew; flowers above slide down and sway.
 */
const COLORS = ['#ef5d8c', '#ffc12e', '#4b8fe0', '#9a68d8', '#ff7a3c'];
const petals = new Particles();

/** Five kinds of flower, one per color, drawn face-on with radius r. */
function bloom(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, r: number, rot: number): void {
  const col = COLORS[kind % 5];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  switch (kind % 5) {
    case 0: {
      // rose: overlapping petals spiraling in
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.fillStyle = shade(col, -0.1);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(col, -0.3);
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.2) {
        const rr = r * 0.05 + (a / (Math.PI * 5)) * r * 0.5;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
      break;
    }
    case 1: {
      // sunflower
      for (let i = 0; i < 14; i++) {
        ctx.save();
        ctx.rotate((i / 14) * Math.PI * 2);
        ctx.fillStyle = i % 2 ? col : shade(col, -0.1);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.62, r * 0.17, r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#7a4a1e';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a3412';
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const d = Math.sqrt(i / 9) * r * 0.3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 2: {
      // cornflower: frilly spiky petals
      for (let i = 0; i < 10; i++) {
        ctx.save();
        ctx.rotate((i / 10) * Math.PI * 2);
        ctx.fillStyle = i % 2 ? col : shade(col, 0.18);
        ctx.beginPath();
        ctx.moveTo(-r * 0.14, -r * 0.2);
        ctx.lineTo(-r * 0.22, -r * 0.95);
        ctx.lineTo(-r * 0.07, -r * 0.8);
        ctx.lineTo(0, -r * 1.0);
        ctx.lineTo(r * 0.07, -r * 0.8);
        ctx.lineTo(r * 0.22, -r * 0.95);
        ctx.lineTo(r * 0.14, -r * 0.2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = shade(col, -0.45);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 3: {
      // violet: five round petals and a bright eye
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = i < 2 ? shade(col, 0.15) : col;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * 0.45, r * 0.38, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff6c9';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2b51c';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // tulip, seen from the side
      ctx.fillStyle = shade(col, -0.15);
      ctx.beginPath();
      ctx.ellipse(-r * 0.35, 0, r * 0.42, r * 0.7, -0.25, 0, Math.PI * 2);
      ctx.ellipse(r * 0.35, 0, r * 0.42, r * 0.7, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.55);
      ctx.quadraticCurveTo(0, -r * 0.2, r * 0.4, -r * 0.55);
      ctx.quadraticCurveTo(r * 0.55, r * 0.6, 0, r * 0.7);
      ctx.quadraticCurveTo(-r * 0.55, r * 0.6, -r * 0.4, -r * 0.55);
      ctx.fill();
      ctx.fillStyle = shade(col, 0.3);
      ctx.beginPath();
      ctx.ellipse(-r * 0.12, -r * 0.05, r * 0.08, r * 0.3, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

class Bouquet implements Collector {
  private items: { kind: number; t: number }[] = [];
  private total = 1;
  private slots: { x: number; y: number }[] = [];
  private headR = 8;
  private enterT = 0;
  private doneT = Infinity;
  doneAt = Infinity;
  private key = '';
  constructor(private readonly L: () => Layout) {}

  private geom() {
    const L = this.L();
    const vh = Math.min(62, L.top.h * 0.42);
    const vw = vh * 0.85;
    const vx = L.W / 2 - vw / 2;
    const vy = L.top.y + L.top.h - vh - 4;
    const key = `${L.W}x${L.top.h}x${this.total}`;
    if (key !== this.key) {
      // a dome of flower heads above the vase, filled from the middle outward
      this.key = key;
      const rx = Math.min(L.W * 0.3, 140);
      const ry = L.top.h - vh - 8;
      const cx = L.W / 2;
      const cy = vy + 6;
      const area = (Math.PI * rx * ry) / 2;
      this.headR = Math.max(4, Math.sqrt(area / this.total / Math.PI) * 1.05);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; pts.length < this.total && i < 4000; i++) {
        const a = i * 2.39996;
        const d = Math.sqrt(i / (this.total * 2.2));
        const x = cx + Math.cos(a) * d * rx;
        const y = cy - Math.abs(Math.sin(a)) * d * ry;
        if (d <= 1.0) pts.push({ x, y });
      }
      pts.sort((p, q) => Math.hypot(p.x - cx, (p.y - cy + ry * 0.45) * 1.4) - Math.hypot(q.x - cx, (q.y - cy + ry * 0.45) * 1.4));
      this.slots = pts;
    }
    return { vx, vy, vw, vh, mouth: { x: L.W / 2, y: vy + 6 } };
  }
  reset(total: number, enterAt: number): void {
    this.items = [];
    this.total = Math.max(1, total);
    this.enterT = enterAt;
    this.doneT = Infinity;
    this.doneAt = Infinity;
    this.key = '';
  }
  target(_kind: number, index: number) {
    this.geom();
    return this.slots[Math.min(index, this.slots.length - 1)] ?? { x: this.L().W / 2, y: this.L().top.y + 30 };
  }
  add(kind: number, t: number): void {
    this.items.push({ kind, t });
  }
  pop(count: number): void {
    this.items.splice(Math.max(0, this.items.length - count));
  }
  complete(t: number): void {
    this.doneT = t;
    this.doneAt = t + 1.8;
  }
  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.geom();
    const L = this.L();
    const enter = easeOut(clamp((t - this.enterT) / 0.5, 0, 1));
    const away = t > this.doneT + 1.1 ? Math.pow(clamp((t - this.doneT - 1.1) / 0.6, 0, 1), 2) : 0;
    ctx.save();
    ctx.translate(away * L.W, (1 - enter) * 40);
    ctx.globalAlpha = enter;
    // stems first, then heads, so they sit together as one bunch
    ctx.strokeStyle = '#5f9a4a';
    ctx.lineWidth = 1.6;
    this.items.forEach((_it, i) => {
      const p = this.slots[i];
      if (!p) return;
      ctx.beginPath();
      ctx.moveTo(g.mouth.x + (p.x - g.mouth.x) * 0.15, g.mouth.y + 8);
      ctx.quadraticCurveTo((p.x + g.mouth.x) / 2, p.y + (g.mouth.y - p.y) * 0.6, p.x, p.y);
      ctx.stroke();
    });
    this.items.forEach((it, i) => {
      const p = this.slots[i];
      if (!p) return;
      const pop = clamp((t - it.t) / 0.25, 0, 1);
      const sway = Math.sin(t * 1.6 + i) * 0.08;
      bloom(ctx, it.kind, p.x, p.y, this.headR * (0.6 + 0.4 * easeOut(pop)), sway + i);
    });
    // the vase, in front
    const vg = ctx.createLinearGradient(g.vx, 0, g.vx + g.vw, 0);
    vg.addColorStop(0, '#dfe9f2');
    vg.addColorStop(0.4, '#ffffff');
    vg.addColorStop(1, '#c9d6e3');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.moveTo(g.vx + g.vw * 0.22, g.vy);
    ctx.lineTo(g.vx + g.vw * 0.78, g.vy);
    ctx.quadraticCurveTo(g.vx + g.vw * 0.7, g.vy + g.vh * 0.25, g.vx + g.vw, g.vy + g.vh * 0.6);
    ctx.quadraticCurveTo(g.vx + g.vw, g.vy + g.vh, g.vx + g.vw * 0.75, g.vy + g.vh);
    ctx.lineTo(g.vx + g.vw * 0.25, g.vy + g.vh);
    ctx.quadraticCurveTo(g.vx, g.vy + g.vh, g.vx, g.vy + g.vh * 0.6);
    ctx.quadraticCurveTo(g.vx + g.vw * 0.3, g.vy + g.vh * 0.25, g.vx + g.vw * 0.22, g.vy);
    ctx.fill();
    ctx.strokeStyle = '#5a86b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.vx + g.vw * 0.06, g.vy + g.vh * 0.68);
    ctx.quadraticCurveTo(g.vx + g.vw / 2, g.vy + g.vh * 0.78, g.vx + g.vw * 0.94, g.vy + g.vh * 0.68);
    ctx.stroke();
    // a ribbon once the bouquet is complete
    if (t > this.doneT + 0.2) {
      const u = easeOut(clamp((t - this.doneT - 0.2) / 0.4, 0, 1));
      ctx.fillStyle = '#e8486f';
      const bx = g.mouth.x;
      const by = g.vy + 4;
      ctx.beginPath();
      ctx.ellipse(bx - 9 * u, by, 9 * u, 5 * u, 0.4, 0, Math.PI * 2);
      ctx.ellipse(bx + 9 * u, by, 9 * u, 5 * u, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(bx - 3, by + 2, 2, 14 * u);
      ctx.fillRect(bx + 1, by + 2, 2, 12 * u);
    }
    ctx.restore();
  }
}

export const flowers: Concept = {
  id: 'flowers',
  name: 'Flowers',
  blurb: 'Pick blooms from the garden bed into a bouquet.',
  colors: COLORS,
  ui: 'flowers',
  background(ctx, L) {
    const g = ctx.createLinearGradient(0, 0, 0, L.H);
    g.addColorStop(0, '#dff1fb');
    g.addColorStop(0.35, '#f3f7e6');
    g.addColorStop(1, '#cfe5b4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L.W, L.H);
  },
  boardBack(ctx, L) {
    const b = L.board;
    const pad = L.cell * 0.2;
    // the planter box and its soil
    ctx.fillStyle = 'rgba(60,40,20,0.2)';
    roundRect(ctx, b.x - pad + 2, b.y - pad + 7, b.w + 2 * pad, b.h + 2 * pad, 12);
    ctx.fill();
    ctx.fillStyle = '#b98352';
    roundRect(ctx, b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 12);
    ctx.fill();
    const s = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    s.addColorStop(0, '#6b4a30');
    s.addColorStop(1, '#5a3c25');
    ctx.fillStyle = s;
    roundRect(ctx, b.x - pad * 0.4, b.y - pad * 0.4, b.w + pad * 0.8, b.h + pad * 0.8, 8);
    ctx.fill();
    // little leaves in each plot
    for (let r = 0; r < L.rows; r++)
      for (let c = 0; c < L.cols; c++) {
        const x = b.x + (c + 0.5) * L.cell;
        const y = b.y + (r + 0.5) * L.cell;
        ctx.fillStyle = 'rgba(40,25,12,0.35)';
        ctx.beginPath();
        ctx.ellipse(x, y + L.cell * 0.32, L.cell * 0.32, L.cell * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
  },
  piece(ctx, kind, x, y, s, t, st: PieceState) {
    let rot = Math.sin(t * 1.3 + st.seed) * 0.06;
    if (st.landAge < 0.8) rot += Math.sin(st.landAge * 10) * Math.exp(-st.landAge * 5) * 0.35 * Math.min(1, st.drop / 2);
    if (st.fall >= 0) rot += Math.sin(st.fall * Math.PI) * 0.25 * (st.seed % 2 ? 1 : -1);
    // leaves
    ctx.save();
    ctx.translate(x, y + s * 0.18);
    ctx.rotate(rot * 0.5);
    ctx.fillStyle = '#5c9c48';
    ctx.beginPath();
    ctx.ellipse(-s * 0.2, s * 0.1, s * 0.2, s * 0.08, -0.5, 0, Math.PI * 2);
    ctx.ellipse(s * 0.2, s * 0.1, s * 0.2, s * 0.08, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const r = s * 0.38 * (1 + 0.1 * st.glow);
    if (st.glow) {
      ctx.fillStyle = 'rgba(255,255,220,0.6)';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.04, r * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
    bloom(ctx, kind, x, y - s * 0.04, r, rot);
  },
  fallTime: (h) => 0.3 + 0.08 * h,
  fallEase: (u) => (u < 0.85 ? (u / 0.85) * (u / 0.85) : 1 + Math.sin(((u - 0.85) / 0.15) * Math.PI) * -0.04),
  stagger: 0.05,
  liftDelay: 0.15,
  flyTime: (k) => 0.7 + (k % 3) * 0.05,
  flyStagger: 0.07,
  flyer(ctx, f: Flyer, u, t) {
    const c = { x: f.from.x + (f.to.x - f.from.x) * 0.3, y: Math.min(f.from.y, f.to.y) - 60 };
    const p = quad(f.from, c, f.to, easeOut(u));
    const r = f.size * 0.38 * (1 - 0.45 * u);
    // the stem trails behind as it's picked
    ctx.strokeStyle = '#5f9a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - 3, p.y + r * 2.2);
    ctx.stroke();
    bloom(ctx, f.kind, p.x, p.y, r, u * 4 + f.k);
    void t;
  },
  overlay(ctx, _L, t) {
    petals.draw(ctx, t, (c, p, age, x, y) => {
      c.globalAlpha = 1 - age;
      c.fillStyle = p.color;
      c.save();
      c.translate(x + Math.sin((t - p.t0) * 6 + p.spin) * 6, y);
      c.rotate(p.spin + (t - p.t0) * 3);
      c.beginPath();
      c.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.globalAlpha = 1;
    });
  },
  onLift(cells, t) {
    for (const c of cells)
      for (let i = 0; i < 4; i++)
        petals.add({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 40, g: 120, t0: t, life: 1.1, size: 3 + Math.random() * 2, color: COLORS[c.kind % 5], spin: Math.random() * 6, kind: c.kind });
  },
  collector: (L) => new Bouquet(L),
  sound: {
    lift(n) {
      synth.noise(0, 0.18, 0.06, 3200, 0.6);
      synth.tone(660, 0.02, 0.12, 0.04 + Math.min(0.04, n * 0.005), 'sine', 1.5);
    },
    land(rows) {
      synth.noise(0, 0.08, Math.min(0.06, 0.02 + rows * 0.01), 500, 0.8, 'lowpass');
    },
    collect(_k, i) {
      const scale = [1047, 1175, 1319, 1568, 1760, 2093];
      synth.tone(scale[i % scale.length], 0, 0.35, 0.035);
    },
    clear() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => synth.tone(f, 0.15 + i * 0.1, 0.8, 0.06));
    },
  },
};
