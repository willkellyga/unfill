import './style.css';
import {
  EMPTY,
  countBlocks,
  generateBoard,
  groupAt,
  isCleared,
  lift,
  type Board,
  type LiftResult,
  type RuleName,
} from '../core';
import { Sound } from './sound';

// ---------- constants ----------

const COLORS = ['#E88AA5', '#8FC58A', '#A996E0', '#F0C75E', '#7FB6E0'];
const SIZES = [
  { id: '5x6c3', cols: 5, rows: 6, colors: 3, label: '5×6 · 3 colors' },
  { id: '6x7c3', cols: 6, rows: 7, colors: 3, label: '6×7 · 3 colors' },
  { id: '7x8c3', cols: 7, rows: 8, colors: 3, label: '7×8 · 3 colors' },
  { id: '8x9c4', cols: 8, rows: 9, colors: 4, label: '8×9 · 4 colors' },
  { id: '8x10c4', cols: 8, rows: 10, colors: 4, label: '8×10 · 4 colors' },
  { id: '8x10c5', cols: 8, rows: 10, colors: 5, label: '8×10 · 5 colors' },
] as const;
type Size = (typeof SIZES)[number];
const DEFAULT_SIZE = SIZES[2];

const RULE_LABEL: Record<RuleName, string> = { repose: 'Slopes', column: 'Columns' };
const RULE_HELP: Record<RuleName, string> = {
  repose: 'Sand slides until no cliff is taller than one block.',
  column: 'Blocks only fall straight down, no sliding.',
};
const HOW_DEFAULT = 'Tap a block to lift its group. Hold to preview.';

const HOLD_MS = 300;
const LIFT_MS = 350;

// ---------- small helpers ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: fine */
    }
  },
};

// ---------- game state ----------

interface Snapshot {
  board: Board;
  ids: Int32Array;
}

interface Anim {
  t0: number;
  lifted: { id: number; color: number; cell: number }[];
  colorOf: Map<number, number>;
  snaps: Map<number, number>[]; // block id → cell, before the pour and after each step
  durs: number[];
  pourStart: number;
  end: number;
  after: Snapshot;
}

interface Press {
  pointerId: number;
  cell: number;
  group: number[];
  timer: number;
}

interface Preview {
  group: number[];
  moves: { id: number; from: number; to: number }[];
  after: Snapshot;
}

let size: Size = DEFAULT_SIZE;
let seed = 1;
let rule: RuleName = 'repose';
let startBoard: Board;
let cur: Snapshot;
let history: Snapshot[] = [];
let anim: Anim | null = null;
let press: Press | null = null;
let preview: Preview | null = null;
let hover: number[] | null = null;
let done = false;

const sound = new Sound(store.get('unfill-muted') === '1');

function idsFor(b: Board): Int32Array {
  return Int32Array.from(b.cells, (v, i) => (v === EMPTY ? -1 : i));
}

function startBoardWith(nextSize: Size, nextSeed: number, nextRule: RuleName): void {
  finishAnim();
  cancelPress();
  size = nextSize;
  seed = nextSeed;
  rule = nextRule;
  startBoard = generateBoard({ rows: size.rows, cols: size.cols, colors: size.colors }, seed);
  cur = { board: startBoard, ids: idsFor(startBoard) };
  history = [];
  done = false;
  hideOverlay();
  writeHash();
  layout();
  updateHud();
}

function doLift(cell: number): void {
  const res = lift(cur.board, cell, rule, cur.ids);
  if (!res) return;
  history.push(cur);
  anim = buildAnim(res, performance.now());
  cur = anim.after;
  hover = null;
  const moving = new Set(res.trace!.steps.flat().map((m) => m.id)).size;
  sound.tone([520, 780], 0.05, 0.14, 0.07);
  sound.pour(anim.pourStart / 1000, (anim.end - anim.pourStart) / 1000, moving);
  updateHud();
}

function undo(): void {
  finishAnim();
  cancelPress();
  const prev = history.pop();
  if (!prev) return;
  cur = prev;
  done = false;
  hideOverlay();
  updateHud();
}

function restart(): void {
  startBoardWith(size, seed, rule);
}

function setRule(next: RuleName): void {
  if (next === rule) return;
  const hadMoves = history.length > 0;
  startBoardWith(size, seed, next);
  toast(hadMoves ? `Same board, restarted with ${RULE_LABEL[next]}` : `${RULE_LABEL[next]} on`);
}

function newBoard(): void {
  startBoardWith(size, 1 + Math.floor(Math.random() * 999999), rule);
}

function checkClear(): void {
  if (done || !isCleared(cur.board)) return;
  done = true;
  const n = history.length;
  const best = recordResult(n);
  sound.tone([523, 659, 784, 1047], 0.11, 0.5, 0.08);
  const other: RuleName = rule === 'repose' ? 'column' : 'repose';
  const otherBest = best[other];
  const compare = otherBest ? ` With ${RULE_LABEL[other]} you took ${otherBest}.` : '';
  showOverlay('Tray emptied', `${n} ${n === 1 ? 'lift' : 'lifts'} with ${RULE_LABEL[rule]}.${compare}`, [
    [`Try it with ${RULE_LABEL[other]}`, () => setRule(other), true],
    ['Replay', restart, false],
    ['New board', newBoard, false],
  ]);
}

// ---------- animation ----------

function buildAnim(res: LiftResult, t0: number): Anim {
  const trace = res.trace!;
  const before = cur;
  const lifted = res.group.map((cell) => ({ id: before.ids[cell], color: before.board.cells[cell], cell }));
  const first = new Map<number, number>();
  const colorOf = new Map<number, number>();
  const inGroup = new Set(res.group);
  for (let i = 0; i < before.board.cells.length; i++) {
    if (before.board.cells[i] === EMPTY || inGroup.has(i)) continue;
    first.set(before.ids[i], i);
    colorOf.set(before.ids[i], before.board.cells[i]);
  }
  const snaps = [first];
  const durs: number[] = [];
  const cols = before.board.cols;
  trace.steps.forEach((step, k) => {
    if (step.length === 0) return;
    const next = new Map(snaps[snaps.length - 1]);
    let dist = 0;
    for (const m of step) {
      next.set(m.id, m.to);
      dist = Math.max(dist, ((m.to / cols) | 0) - ((m.from / cols) | 0));
    }
    snaps.push(next);
    durs.push(k === 0 ? Math.min(460, 120 + 55 * dist) : 0);
  });
  const slideSteps = durs.filter((d) => d === 0).length;
  const slideDur = slideSteps ? clamp(Math.round(620 / slideSteps), 45, 120) : 0;
  for (let i = 0; i < durs.length; i++) if (durs[i] === 0) durs[i] = slideDur;
  const pourStart = LIFT_MS * 0.5;
  const end = Math.max(LIFT_MS, pourStart + durs.reduce((a, b) => a + b, 0));
  return {
    t0,
    lifted,
    colorOf,
    snaps,
    durs,
    pourStart,
    end,
    after: { board: res.board, ids: trace.ids },
  };
}

function finishAnim(): void {
  if (!anim) return;
  anim = null;
  checkClear();
  updateHud();
}

// ---------- canvas ----------

const canvas = $<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d')!;
const stage = $<HTMLDivElement>('stage');
let cs = 40;
let pad = 12;
let cw = 0;
let ch = 0;

function layout(): void {
  const r = stage.getBoundingClientRect();
  const availW = Math.max(200, r.width);
  const availH = Math.max(260, r.height);
  cs = Math.floor(Math.min((availW - 8) / (size.cols + 0.6), (availH - 8) / (size.rows + 0.6)));
  cs = clamp(cs, 24, 64);
  pad = Math.round(cs * 0.3);
  cw = size.cols * cs + pad * 2;
  ch = size.rows * cs + pad * 2;
  const d = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cw * d);
  canvas.height = Math.round(ch * d);
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

function cellFromEvent(e: PointerEvent): number | null {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (cw / r.width) - pad;
  const y = (e.clientY - r.top) * (ch / r.height) - pad;
  const c = Math.floor(x / cs);
  const row = Math.floor(y / cs);
  if (c < 0 || c >= size.cols || row < 0 || row >= size.rows) return null;
  return row * size.cols + c;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const grainCache = new Map<number, [number, number, boolean][]>();
function grains(id: number): [number, number, boolean][] {
  let g = grainCache.get(id);
  if (!g) {
    let a = (id * 977 + seed * 31 + 7) | 0;
    const R = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    g = [];
    for (let i = 0; i < 14; i++) g.push([0.12 + R() * 0.76, 0.12 + R() * 0.76, R() < 0.5]);
    grainCache.set(id, g);
  }
  return g;
}

function drawBlock(x: number, y: number, color: number, id: number, alpha = 1, s = cs): void {
  const ins = s * 0.06;
  ctx.globalAlpha = alpha;
  roundRect(x + ins, y + ins, s - 2 * ins, s - 2 * ins, s * 0.2);
  ctx.fillStyle = COLORS[color % COLORS.length];
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.26)';
  ctx.fillRect(x, y, s, s * 0.18);
  ctx.fillStyle = 'rgba(90,50,30,.10)';
  ctx.fillRect(x, y + s * 0.82, s, s * 0.2);
  const gs = Math.max(1, s * 0.045);
  for (const [fx, fy, light] of grains(id)) {
    ctx.fillStyle = light ? 'rgba(255,255,255,.5)' : 'rgba(90,50,30,.16)';
    ctx.fillRect(x + fx * s, y + fy * s, gs, gs);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Fill the gaps between edge-touching blocks of one color, so groups read as one piece. */
function drawBridges(colorAt: (r: number, c: number) => number): void {
  const ins = cs * 0.06 + 1;
  for (let r = 0; r < size.rows; r++)
    for (let c = 0; c < size.cols; c++) {
      const v = colorAt(r, c);
      if (v === EMPTY) continue;
      const x = pad + c * cs;
      const y = pad + r * cs;
      ctx.fillStyle = COLORS[v % COLORS.length];
      const right = c + 1 < size.cols && colorAt(r, c + 1) === v;
      const down = r + 1 < size.rows && colorAt(r + 1, c) === v;
      if (right) ctx.fillRect(x + cs - ins - cs * 0.2, y + ins, 2 * ins + cs * 0.4, cs - 2 * ins);
      if (down) ctx.fillRect(x + ins, y + cs - ins - cs * 0.2, cs - 2 * ins, 2 * ins + cs * 0.4);
      if (right && down && colorAt(r + 1, c + 1) === v) ctx.fillRect(x + cs - ins - 1, y + cs - ins - 1, 2 * ins + 2, 2 * ins + 2);
    }
}

function outlineCells(cells: number[], color: string, width: number, dash?: number[]): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) {
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -performance.now() / 40;
  }
  for (const i of cells) {
    const r = (i / size.cols) | 0;
    const c = i % size.cols;
    roundRect(pad + c * cs + 1.5, pad + r * cs + 1.5, cs - 3, cs - 3, cs * 0.22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTray(): void {
  ctx.clearRect(0, 0, cw, ch);
  roundRect(0, 0, cw, ch, 22);
  ctx.fillStyle = '#E4C6AB';
  ctx.fill();
  for (let r = 0; r < size.rows; r++)
    for (let c = 0; c < size.cols; c++) {
      roundRect(pad + c * cs + cs * 0.1, pad + r * cs + cs * 0.1, cs * 0.8, cs * 0.8, cs * 0.18);
      ctx.fillStyle = 'rgba(150,100,70,.10)';
      ctx.fill();
    }
}

function drawBoard(b: Board, ids: Int32Array): void {
  drawBridges((r, c) => b.cells[r * size.cols + c]);
  for (let i = 0; i < b.cells.length; i++) {
    const v = b.cells[i];
    if (v === EMPTY) continue;
    drawBlock(pad + (i % size.cols) * cs, pad + ((i / size.cols) | 0) * cs, v, ids[i]);
  }
}

/**
 * Hold-to-preview: the tray as it will be after the lift, drawn solid so new groups show. Blocks that moved get a
 * dashed outline where they land, and the group being lifted keeps a glowing outline where it was.
 */
function drawPreview(now: number): void {
  const p = preview!;
  drawBoard(p.after.board, p.after.ids);
  outlineCells(
    p.moves.map((m) => m.to),
    'rgba(255,255,255,.95)',
    2,
    [5, 4],
  );
  const pulse = 0.55 + 0.45 * Math.sin(now / 140);
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.1 * pulse})`;
  for (const i of p.group) {
    roundRect(pad + (i % size.cols) * cs + 1.5, pad + ((i / size.cols) | 0) * cs + 1.5, cs - 3, cs - 3, cs * 0.22);
    ctx.fill();
  }
  ctx.restore();
  outlineCells(p.group, `rgba(255,255,255,${pulse})`, 3.5);
}

function drawAnim(now: number): void {
  const a = anim!;
  const t = now - a.t0;
  // pour
  const pt = Math.max(0, t - a.pourStart);
  let i = 0;
  let acc = 0;
  while (i < a.durs.length && acc + a.durs[i] <= pt) {
    acc += a.durs[i];
    i++;
  }
  const A = a.snaps[Math.min(i, a.snaps.length - 1)];
  const B = a.snaps[Math.min(i + 1, a.snaps.length - 1)];
  const f = i < a.durs.length ? (pt - acc) / a.durs[i] : 0;
  const still = new Int8Array(size.rows * size.cols).fill(EMPTY);
  const stillBlocks: [number, number][] = [];
  const moving: [number, number, number, number][] = [];
  for (const [id, from] of A) {
    const to = B.get(id)!;
    const color = a.colorOf.get(id)!;
    if (from === to) {
      still[from] = color;
      stillBlocks.push([id, from]);
    } else {
      // falls accelerate straight down; slides tip sideways off the ledge, then drop
      const fr = (from / size.cols) | 0;
      const fc = from % size.cols;
      const tr = (to / size.cols) | 0;
      const tc = to % size.cols;
      moving.push([id, color, lerp(fc, tc, easeOut(f)), lerp(fr, tr, easeIn(f))]);
    }
  }
  drawBridges((r, c) => still[r * size.cols + c]);
  for (const [id, cell] of stillBlocks) drawBlock(pad + (cell % size.cols) * cs, pad + ((cell / size.cols) | 0) * cs, a.colorOf.get(id)!, id);
  for (const [id, color, x, y] of moving) {
    const px = pad + x * cs;
    const py = pad + y * cs;
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = `rgba(170,110,80,${0.3 * (1 - k / 4)})`;
      const gx = px + cs * 0.3 + ((k * 7 + id) % 5) * cs * 0.09;
      ctx.fillRect(gx, py - cs * 0.12 - k * cs * 0.13, Math.max(1.5, cs * 0.05), Math.max(1.5, cs * 0.05));
    }
    drawBlock(px, py, color, id);
  }
  // the lifted group rises out of the tray and fades
  const lp = clamp(t / LIFT_MS, 0, 1);
  if (lp < 1) {
    const e = easeOut(lp);
    for (const L of a.lifted) {
      const r = (L.cell / size.cols) | 0;
      const c = L.cell % size.cols;
      const s = cs * (1 + 0.1 * Math.sin(lp * Math.PI));
      ctx.save();
      ctx.shadowColor = 'rgba(90,50,30,.28)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 5;
      drawBlock(pad + c * cs - (s - cs) / 2, pad + (r - 0.9 * e) * cs - (s - cs) / 2, L.color, L.id, 1 - e, s);
      ctx.restore();
    }
  }
  if (t >= a.end) finishAnim();
}

function frame(now: number): void {
  drawTray();
  if (anim) drawAnim(now);
  else if (preview) drawPreview(now);
  else {
    drawBoard(cur.board, cur.ids);
    if (hover) outlineCells(hover, 'rgba(255,255,255,.95)', 2.5);
  }
  requestAnimationFrame(frame);
}

// ---------- input: tap to lift, hold to preview, slide off to cancel ----------

function cancelPress(): void {
  if (press) clearTimeout(press.timer);
  press = null;
  if (preview) setHow(HOW_DEFAULT);
  preview = null;
}

function showPreview(): void {
  if (!press) return;
  const res = lift(cur.board, press.cell, rule, cur.ids)!;
  const finalCell = new Map<number, number>();
  res.trace!.ids.forEach((id, i) => {
    if (id >= 0) finalCell.set(id, i);
  });
  const moves: Preview['moves'] = [];
  for (let i = 0; i < cur.board.cells.length; i++) {
    const id = cur.ids[i];
    if (id < 0 || res.group.includes(i)) continue;
    const to = finalCell.get(id)!;
    if (to !== i) moves.push({ id, from: i, to });
  }
  preview = { group: res.group, moves, after: { board: res.board, ids: res.trace!.ids } };
  setHow('Preview: release to lift, slide off to cancel.', true);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  if (anim) {
    // a tap during a pour fast-forwards it
    sound.hush();
    finishAnim();
    return;
  }
  if (done) return;
  const cell = cellFromEvent(e);
  if (cell === null || cur.board.cells[cell] === EMPTY) return;
  cancelPress();
  canvas.setPointerCapture(e.pointerId);
  press = {
    pointerId: e.pointerId,
    cell,
    group: groupAt(cur.board, cell),
    timer: window.setTimeout(showPreview, HOLD_MS),
  };
  hover = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (press && e.pointerId === press.pointerId) {
    const cell = cellFromEvent(e);
    if (cell === null || !press.group.includes(cell)) {
      const wasPreview = !!preview;
      cancelPress();
      if (wasPreview) toast('Cancelled, no move spent');
    }
    return;
  }
  if (e.pointerType !== 'mouse' || anim || done) {
    hover = null;
    return;
  }
  const cell = cellFromEvent(e);
  hover = cell !== null && cur.board.cells[cell] !== EMPTY ? groupAt(cur.board, cell) : null;
  canvas.style.cursor = hover ? 'pointer' : 'default';
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  const cell = cellFromEvent(e);
  const target = press.cell;
  const ok = cell !== null && press.group.includes(cell);
  cancelPress();
  if (ok) doLift(target);
});

canvas.addEventListener('pointercancel', cancelPress);
canvas.addEventListener('pointerleave', () => {
  hover = null;
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    undo();
  }
});

// ---------- HUD, overlay, toast ----------

function setHow(text: string, active = false): void {
  const el = $('how');
  el.textContent = text;
  el.classList.toggle('active', active);
}

function updateHud(): void {
  const n = history.length;
  $('lifts').textContent = String(n);
  $('liftsLabel').textContent = n === 1 ? 'lift' : 'lifts';
  const left = countBlocks(cur.board);
  $('left').textContent = `${left} ${left === 1 ? 'block' : 'blocks'} left`;
  $('boardLabel').textContent = `Rules lab · board ${seed} · ${size.label}`;
  $<HTMLButtonElement>('undo').disabled = n === 0;
  $<HTMLButtonElement>('restart').disabled = n === 0;
  $('ruleRepose').setAttribute('aria-pressed', String(rule === 'repose'));
  $('ruleColumn').setAttribute('aria-pressed', String(rule === 'column'));
  $('ruleHelp').textContent = RULE_HELP[rule];
  $<HTMLSelectElement>('size').value = size.id;
  renderResults();
}

function showOverlay(title: string, text: string, buttons: [string, () => void, boolean][]): void {
  $('ovTitle').textContent = title;
  $('ovText').textContent = text;
  const box = $('ovButtons');
  box.innerHTML = '';
  for (const [label, fn, primary] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.onclick = fn;
    box.appendChild(b);
  }
  $('overlay').hidden = false;
}

function hideOverlay(): void {
  $('overlay').hidden = true;
}

let toastTimer = 0;
function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1700);
}

// ---------- rule comparison results (kept on this device) ----------

interface ResultRow {
  key: string;
  label: string;
  repose?: number;
  column?: number;
  t: number;
}
const RESULTS_KEY = 'unfill-lab-results';

function loadResults(): ResultRow[] {
  try {
    const rows = JSON.parse(store.get(RESULTS_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function boardKeyNow(): string {
  return `${size.id}-s${seed}`;
}

function recordResult(lifts: number): ResultRow {
  const rows = loadResults();
  const key = boardKeyNow();
  let row = rows.find((r) => r.key === key);
  if (!row) {
    row = { key, label: `${size.label} · #${seed}`, t: 0 };
    rows.push(row);
  }
  row[rule] = Math.min(row[rule] ?? Infinity, lifts);
  row.t = Date.now();
  rows.sort((a, b) => b.t - a.t);
  store.set(RESULTS_KEY, JSON.stringify(rows.slice(0, 200)));
  return row;
}

function renderResults(): void {
  const rows = loadResults();
  const mine = rows.find((r) => r.key === boardKeyNow());
  const fmt = (n?: number) => (n === undefined ? '–' : `${n}`);
  $('thisBoard').textContent = `This board, fewest lifts: Slopes ${fmt(mine?.repose)} · Columns ${fmt(mine?.column)}. Switching rules restarts the same board.`;
  const body = $('resultsBody');
  body.innerHTML = '';
  for (const r of rows.slice(0, 12)) {
    const tr = document.createElement('tr');
    for (const text of [r.label, fmt(r.repose), fmt(r.column)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

$('copyResults').onclick = async () => {
  const rows = loadResults();
  const text = ['Board\tSlopes\tColumns', ...rows.map((r) => `${r.label}\t${r.repose ?? ''}\t${r.column ?? ''}`)].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Results copied');
  } catch {
    toast('Copy not allowed here');
  }
};
$('clearResults').onclick = () => {
  store.set(RESULTS_KEY, '[]');
  renderResults();
};

// ---------- controls ----------

const sizeSelect = $<HTMLSelectElement>('size');
for (const s of SIZES) {
  const o = document.createElement('option');
  o.value = s.id;
  o.textContent = s.label;
  sizeSelect.appendChild(o);
}
sizeSelect.onchange = () => {
  const next = SIZES.find((s) => s.id === sizeSelect.value) ?? DEFAULT_SIZE;
  startBoardWith(next, seed, rule);
};
$('undo').onclick = undo;
$('restart').onclick = restart;
$('newBoard').onclick = newBoard;
$('ruleRepose').onclick = () => setRule('repose');
$('ruleColumn').onclick = () => setRule('column');
const soundBtn = $('sound');
function syncSound(): void {
  soundBtn.textContent = sound.muted ? 'Sound off' : 'Sound on';
  soundBtn.setAttribute('aria-pressed', String(!sound.muted));
}
soundBtn.onclick = () => {
  sound.muted = !sound.muted;
  store.set('unfill-muted', sound.muted ? '1' : '0');
  syncSound();
  if (!sound.muted) sound.tone([660], 0, 0.12, 0.08);
};
syncSound();

// ---------- share a board by link: #7x8c3-s123-repose ----------

function writeHash(): void {
  const h = `#${size.id}-s${seed}-${rule}`;
  try {
    if (location.hash !== h) window.history.replaceState(null, '', h);
  } catch {
    /* some embedded viewers don't allow it */
  }
  store.set('unfill-lab-last', h);
}

function readHash(h: string): boolean {
  const m = /^#?(\w+)-s(\d+)-(repose|column)$/.exec(h);
  if (!m) return false;
  const s = SIZES.find((x) => x.id === m[1]);
  if (!s) return false;
  startBoardWith(s, Number(m[2]), m[3] as RuleName);
  return true;
}

window.addEventListener('hashchange', () => {
  if (location.hash !== `#${size.id}-s${seed}-${rule}`) readHash(location.hash);
});
window.addEventListener('resize', layout);

if (!readHash(location.hash) && !readHash(store.get('unfill-lab-last') ?? '')) {
  startBoardWith(DEFAULT_SIZE, 1 + Math.floor(Math.random() * 999999), 'column');
}
void document.fonts?.ready.then(layout);
requestAnimationFrame(frame);
setHow(HOW_DEFAULT);
