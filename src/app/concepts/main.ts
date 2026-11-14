import './style.css';
import {
  EMPTY,
  LIBRARY_RULE,
  countBlocks,
  grantFor,
  isCleared,
  lift,
  nextBoardPool,
  pickBoard,
  refundMove,
  restartBoard,
  spendMove,
  startPool,
  transformEntry,
  type Board,
  type Library,
  type MovePool,
  type Pick,
} from '../../core';
import libraryText from '../../library/boards.json?raw';
import { clamp, type Collector, type Concept, type Flyer, type Layout, type PieceState } from './kit';
import { synth } from './sound';
import { marbles } from './marbles';
import { yarn } from './yarn';
import { flowers } from './flowers';
import { fireflies } from './fireflies';

/**
 * Concept playground: the same rules, boards and move economy as the game, drawn four very different ways.
 * Each concept decides what the pieces are, how they fall, how a lifted group leaves, and what keepsake it fills.
 */
const CONCEPTS: Concept[] = [marbles, yarn, flowers, fireflies];
const library: Library = JSON.parse(libraryText);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
let conceptIdx = Math.max(0, CONCEPTS.findIndex((c) => c.id === params.get('c')));
let concept = CONCEPTS[conceptIdx];

// ---------------------------------------------------------------- game state (same rules as the game)

interface Piece {
  id: number;
  kind: number;
  col: number;
  row: number;
  /** Visual row while falling: from → to between t0 and t0 + dur. */
  fall: { from: number; to: number; t0: number; dur: number } | null;
  landT: number;
  drop: number;
  landed: boolean;
}

let n = 1;
let pick: Pick;
let pool: MovePool;
let start: { board: Board; ids: Int32Array };
let cur: { board: Board; ids: Int32Array };
let history: { board: Board; ids: Int32Array; size: number }[] = [];
let pieces = new Map<number, Piece>();
let flyers: Flyer[] = [];
let collected = 0;
let total = 0;
let phase: 'play' | 'clearing' = 'play';
let collector: Collector;
const seed = 1 + Math.floor(Math.random() * 1e9);
const recent = new Set<string>();
let L: Layout;

const now = () => performance.now() / 1000;

function idsFor(b: Board): Int32Array {
  return Int32Array.from(b.cells, (v, i) => (v === EMPTY ? -1 : i));
}

function startLevel(num: number, fresh: boolean): void {
  n = num;
  pick = pickBoard(library.boards, n, seed, recent);
  recent.add(pick.entry.id);
  const { board } = transformEntry(pick.entry, pick.transform);
  const grant = grantFor(pick.slot, pick.entry);
  pool = fresh || !pool ? startPool(grant) : nextBoardPool(pool, grant);
  start = { board, ids: idsFor(board) };
  cur = start;
  history = [];
  flyers = [];
  collected = 0;
  total = countBlocks(board);
  phase = 'play';
  layout();
  const t = now();
  collector.reset(total, t);
  buildPieces(t + 0.25, true);
  hud();
  toast(fresh ? `Level ${n} · par ${pick.entry.par}` : `Level ${n} · +${grant} moves`);
}

/** Pieces for the current board; with `pourIn`, they fall in from above the board, bottom rows first. */
function buildPieces(t: number, pourIn: boolean): void {
  pieces = new Map();
  const { cols, rows, cells } = cur.board;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === EMPTY) continue;
    const id = cur.ids[i];
    const col = i % cols;
    const row = (i / cols) | 0;
    const p: Piece = { id, kind: cells[i], col, row, fall: null, landT: -99, drop: 0, landed: true };
    if (pourIn) {
      const from = row - rows - 1;
      p.fall = { from, to: row, t0: t + (rows - 1 - row) * 0.06 + col * 0.018, dur: concept.fallTime(row - from) };
      p.landed = false;
    }
    pieces.set(id, p);
  }
}

function visualRow(p: Piece, t: number): number {
  if (!p.fall) return p.row;
  const f = p.fall;
  const u = clamp((t - f.t0) / f.dur, 0, 1);
  return f.from + (f.to - f.from) * concept.fallEase(u);
}

function doLift(cell: number): void {
  if (phase !== 'play') return;
  const spent = spendMove(pool);
  if (!spent) {
    toast('Out of moves. Undo gives one back, or restart the level.');
    return;
  }
  const res = lift(cur.board, cell, LIBRARY_RULE, cur.ids);
  if (!res) return;
  pool = spent;
  const t = now();
  const before = cur;
  history.push({ ...before, size: res.group.length });
  cur = { board: res.board, ids: res.trace!.ids };
  const kind = before.board.cells[cell];

  // the group leaves for the keepsake
  const cols = before.board.cols;
  const leaving: { x: number; y: number; kind: number }[] = [];
  res.group.forEach((c, k) => {
    const id = before.ids[c];
    const p = pieces.get(id);
    const vr = p ? visualRow(p, t) : (c / cols) | 0;
    pieces.delete(id);
    const from = { x: cx(c % cols), y: cy(vr) };
    leaving.push({ ...from, kind });
    const index = collected + flyers.length;
    flyers.push({
      kind,
      seed: id * 7 + 3,
      from,
      to: collector.target(kind, index),
      t0: t + k * concept.flyStagger,
      dur: concept.flyTime(k, res.group.length),
      k,
      size: L.cell,
    });
  });
  concept.onLift?.(leaving, t, L);
  concept.sound.lift(res.group.length, kind);

  // the pieces above fall, bottom first in each column
  const moves = res.trace!.steps[0] ?? [];
  const byCol = new Map<number, typeof moves>();
  for (const m of moves) {
    const c = m.from % cols;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(m);
  }
  for (const list of byCol.values()) {
    list.sort((a, b) => b.from - a.from);
    list.forEach((m, k) => {
      const p = pieces.get(m.id);
      if (!p) return;
      const from = visualRow(p, t);
      const to = (m.to / cols) | 0;
      p.row = to;
      p.fall = { from, to, t0: t + concept.liftDelay + k * concept.stagger, dur: concept.fallTime(to - from) };
      p.landed = false;
      p.drop = to - from;
    });
  }
  hud();
}

function undo(): void {
  if (!history.length || phase !== 'play') return;
  const h = history.pop()!;
  cur = { board: h.board, ids: h.ids };
  pool = refundMove(pool);
  // finish flights now, then take the group back out of the keepsake
  for (const f of flyers) {
    collector.add(f.kind, now());
    collected++;
  }
  flyers = [];
  collector.pop(h.size);
  collected -= h.size;
  buildPieces(now(), false);
  hud();
}

function restart(): void {
  if (phase !== 'play') return;
  cur = start;
  history = [];
  pool = restartBoard(pool);
  flyers = [];
  collected = 0;
  collector.reset(total, now());
  buildPieces(now() + 0.1, true);
  hud();
}

// ---------------------------------------------------------------- layout

const cx = (c: number) => L.board.x + (c + 0.5) * L.cell;
const cy = (r: number) => L.board.y + (r + 0.5) * L.cell;

function layout(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const safeTop = $('hud').getBoundingClientRect().top;
  const foot = $('foot').getBoundingClientRect();
  const cols = cur?.board.cols ?? 7;
  const rows = cur?.board.rows ?? 8;
  const topH = clamp(H * 0.2, 112, 170);
  const top = { x: 0, y: safeTop, w: W, h: topH };
  const availH = foot.top - 12 - (top.y + top.h + 6);
  const cell = Math.floor(Math.min((W - 20) / cols, availH / rows));
  const bw = cell * cols;
  const bh = cell * rows;
  const board = { x: Math.round((W - bw) / 2), y: Math.round(top.y + top.h + 6 + (availH - bh) / 2), w: bw, h: bh };
  L = { W, H, board, cell, cols, rows, top };
}
const getL = () => L;

// ---------------------------------------------------------------- input

let press: { cell: number; t: number; x: number; y: number } | null = null;
function cellAt(x: number, y: number): number | null {
  const c = Math.floor((x - L.board.x) / L.cell);
  const r = Math.floor((y - L.board.y) / L.cell);
  if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return null;
  return r * L.cols + c;
}
canvas.addEventListener('pointerdown', (e) => {
  synth.unlock();
  const cell = cellAt(e.clientX, e.clientY);
  if (cell === null || cur.board.cells[cell] === EMPTY) return;
  press = { cell, t: now(), x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!press) return;
  const p = press;
  press = null;
  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 24) return;
  doLift(p.cell);
});
canvas.addEventListener('pointercancel', () => (press = null));

// ---------------------------------------------------------------- frame

function frame(): void {
  const t = now();
  ctx.clearRect(0, 0, L.W, L.H);
  concept.background(ctx, L, t);
  collector.draw(ctx, t);
  concept.boardBack(ctx, L, t);

  // pieces, clipped to the board so new levels pour in from its top edge
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.board.x - L.cell, L.board.y - 2, L.board.w + 2 * L.cell, L.board.h + L.cell);
  ctx.clip();
  const pressGroup = press && t - press.t > 0.04 ? press.cell : -1;
  for (const p of pieces.values()) {
    let fallU = -1;
    if (p.fall) {
      const f = p.fall;
      fallU = clamp((t - f.t0) / f.dur, 0, 1);
      if (fallU >= 1) {
        p.fall = null;
        p.landT = f.t0 + f.dur;
        p.drop = f.to - f.from;
        fallU = -1;
        if (!p.landed) {
          p.landed = true;
          concept.sound.land(p.drop);
        }
      }
    }
    const vr = visualRow(p, t);
    const st: PieceState = {
      seed: p.id * 13 + 5,
      landAge: t - p.landT,
      drop: p.drop,
      fall: fallU,
      glow: pressGroup >= 0 && cur.ids[pressGroup] === p.id ? 1 : 0,
    };
    concept.piece(ctx, p.kind, cx(p.col), cy(vr), L.cell, t, st);
  }
  ctx.restore();
  concept.boardFront?.(ctx, L, t);

  // flights to the keepsake
  flyers = flyers.filter((f) => {
    const u = (t - f.t0) / f.dur;
    if (u >= 1) {
      collector.add(f.kind, t);
      collected++;
      concept.sound.collect(f.kind, collected);
      return false;
    }
    if (u >= 0) concept.flyer(ctx, f, u, t);
    return true;
  });
  concept.overlay?.(ctx, L, t);

  // level flow: keepsake flourish, then the next level pours straight in
  if (phase === 'play' && isCleared(cur.board) && !flyers.length) {
    phase = 'clearing';
    collector.complete(t);
    concept.sound.clear();
    const lifts = history.length;
    const par = pick.entry.par;
    const stars = lifts <= par ? 3 : lifts <= par + 2 ? 2 : 1;
    window.setTimeout(() => toast(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  Level ${n} · ${lifts <= par ? 'Par!' : `${lifts} lifts`}`), 300);
  }
  if (phase === 'clearing' && t >= collector.doneAt) startLevel(n + 1, false);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- HUD

function hud(): void {
  $('level').innerHTML = `<b>Level ${n}</b><span>par ${pick.entry.par}</span>`;
  $('moves').innerHTML = `<b>${pool.moves}</b><span>${pool.moves === 1 ? 'move' : 'moves'}</span>`;
  $<HTMLButtonElement>('undo').disabled = !history.length;
  $<HTMLButtonElement>('restart').disabled = !history.length;
}

let toastTimer = 0;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2000);
}

function setConcept(i: number): void {
  conceptIdx = (i + CONCEPTS.length) % CONCEPTS.length;
  concept = CONCEPTS[conceptIdx];
  document.body.dataset.concept = concept.ui;
  $('cname').textContent = concept.name;
  $('cblurb').textContent = concept.blurb;
  collector = concept.collector(getL);
  if (cur) {
    // replay this level in the new concept
    cur = start;
    history = [];
    pool = restartBoard(pool);
    flyers = [];
    collected = 0;
    phase = 'play';
    collector.reset(total, now());
    buildPieces(now() + 0.15, true);
    hud();
  }
  const u = new URL(location.href);
  u.searchParams.set('c', concept.id);
  history_replace(u);
}
function history_replace(u: URL): void {
  try {
    window.history.replaceState(null, '', u);
  } catch {
    /* sandboxed */
  }
}

$('undo').onclick = undo;
$('restart').onclick = restart;
$('prev').onclick = () => setConcept(conceptIdx - 1);
$('next').onclick = () => setConcept(conceptIdx + 1);
window.addEventListener('resize', layout);

setConcept(conceptIdx);
startLevel(Number(params.get('level')) || 1, true);
requestAnimationFrame(frame);

(window as unknown as { concepts: unknown }).concepts = {
  tap: (cell: number) => doLift(cell),
  solution: () => transformEntry(pick.entry, pick.transform).solution,
  busy: () => flyers.length > 0 || [...pieces.values()].some((p) => p.fall) || phase !== 'play',
  set: (i: number) => setConcept(i),
  level: () => n,
};
