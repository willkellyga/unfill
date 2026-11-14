import './style.css';
import * as THREE from 'three';
import {
  EMPTY,
  LIBRARY_RULE,
  countBlocks,
  grantFor,
  groupAt,
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
import { Audio } from './audio';
import { Blocks } from './blocks';
import { Bottle } from './bottle';
import { Grains } from './grains';
import { SAND, sandColor, SAND_PITCH } from './palette';
import { FIRM, fallTime, planPour, retimeSolid, SOLID_FALL, type PourPlan, type SolidStyle } from './pour';
import { THEMES, type Theme, type ThemeName } from './themes';
import { SLOW_FRAME_MS, TIERS, type Tier, type TierName } from './quality';
import { BLOCK, CLASSIC_VIEW, Terrarium, type View } from './scene';

// ---------------------------------------------------------------- setup

const library: Library = JSON.parse(libraryText);
const RULE = LIBRARY_RULE;
const HOLD_MS = 300;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
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
      /* private mode */
    }
  },
};

const clock0 = performance.now();
let clockOverride: number | null = null;
const now = () => clockOverride ?? (performance.now() - clock0) / 1000;

const canvas = $<HTMLCanvasElement>('scene');
const T = new Terrarium(canvas);
const savedTier = store.get('unfill-tier') as TierName | 'auto' | null;
let tierChoice: TierName | 'auto' = savedTier && (savedTier === 'auto' || savedTier in TIERS) ? savedTier : 'auto';
let tier: Tier = TIERS[tierChoice === 'auto' ? 'medium' : tierChoice];
T.setTier(tier);

let grains = new Grains(tier.maxGrains);
T.scene.add(grains.points);
const blocks = new Blocks(T, T.blockGeometry());
blocks.setShadows(tier.shadows);
T.scene.add(blocks.mesh, blocks.bridges, blocks.ghostMesh);
const bottle = new Bottle();
T.scene.add(bottle.group);
const audio = new Audio(store.get('unfill-muted') === '1', store.get('unfill-ambient') !== '0');

function setTier(t: Tier): void {
  tier = t;
  T.setTier(t);
  blocks.setGeometry(T.blockGeometry());
  blocks.setShadows(t.shadows);
  T.buildTray(T.cols, T.rows);
  T.scene.remove(grains.points);
  grains.dispose();
  grains = new Grains(t.maxGrains);
  T.scene.add(grains.points);
  layout();
  syncSettings();
  warmup();
}

// ---------------------------------------------------------------- game state

interface Snap {
  board: Board;
  ids: Int32Array;
}

interface Flight {
  t0: number;
  blocks: { color: number; ox: number; oy: number; x: number; y: number }[];
  cx: number;
  cy: number;
  rise: number;
  arrive: number;
  done: number;
  scale: number;
}

interface Press {
  pointerId: number;
  cell: number;
  group: number[];
  timer: number;
}

interface Preview {
  group: number[];
  colors: number[];
  moved: Set<number>;
  after: Snap;
}

let runSeed = Number(store.get('unfill-run-seed')) || 1 + Math.floor(Math.random() * 1e9);
store.set('unfill-run-seed', String(runSeed));
let n = 1;
let pick!: Pick;
let total = 0;
let start!: Snap;
let cur!: Snap;
let history: Snap[] = [];
let pool!: MovePool;
let pour: PourPlan | null = null;
let flights: Flight[] = [];
let press: Press | null = null;
let preview: Preview | null = null;
let hover: number[] | null = null;
let cleared = false;
let fillIn: FillIn | null = null;
/** Scene time at which the next level starts, once the bottle is corked and set aside. */
let pendingNext: number | null = null;
let corked = false;
let readyAt = 0; // when the tray last became playable, for the tap timing log
const recent = new Set<string>();

function idsFor(b: Board): Int32Array {
  return Int32Array.from(b.cells, (v, i) => (v === EMPTY ? -1 : i));
}

/**
 * Start level `num`. With `fresh`, the move pool starts over (first level, or jumping to a level). Otherwise the
 * level follows the one just cleared: leftover moves carry over and the new tray's sand pours in from above.
 */
function startBoard(num: number, fresh: boolean): void {
  fastForward();
  endFillIn();
  pendingNext = null;
  const before = pool ? pool.moves : 0;
  cancelPress();
  n = num;
  pick = pickBoard(library.boards, n, runSeed, recent);
  recent.add(pick.entry.id);
  if (recent.size > 200) recent.delete(recent.values().next().value!);
  const { board } = transformEntry(pick.entry, pick.transform);
  const grant = grantFor(pick.slot, pick.entry);
  if (fresh || !pool) pool = startPool(grant);
  else {
    const next = nextBoardPool(pool, grant);
    pool = { moves: next.moves, atBoardStart: next.atBoardStart };
  }
  start = { board, ids: idsFor(board) };
  cur = start;
  total = countBlocks(board);
  history = [];
  cleared = false;
  corked = false;
  T.buildTray(board.cols, board.rows);
  bottle.reset();
  placeBottle();
  layout();
  const t = now();
  bottle.enterAt(t);
  if (!fresh) {
    fillIn = planFillIn(board, t + 0.15);
    countUp(before, pool.moves, 0.9);
  }
  updateHud();
  readyAt = performance.now();
  toast(fresh ? `Level ${n} · par ${pick.entry.par}` : `Level ${n} · +${grant} moves`);
}

// ---------------------------------------------------------------- the next level pours in

interface FillIn {
  blocks: { cell: number; color: number; t0: number; t1: number; drop: number }[];
  end: number;
}

/**
 * The new tray's sand pours in through the top of the glass, like a falling stack: bottom rows first, in a quick
 * ripple across the columns. Every block starts just above the inner top (hidden under the rail) and falls under
 * the same gravity, so blocks in one column keep a block's gap between them.
 */
function planFillIn(b: Board, t0: number): FillIn {
  const { cols, rows, cells } = b;
  const list: FillIn['blocks'] = [];
  let end = t0;
  const start = T.innerTop + 0.3;
  for (let r = rows - 1; r >= 0; r--)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (cells[i] === EMPTY) continue;
      const drop = start - (T.cellY(r) - BLOCK / 2);
      const s = t0 + (rows - 1 - r) * 0.085 + c * 0.02;
      const d = fallTime(drop) * 0.9;
      list.push({ cell: i, color: cells[i], t0: s, t1: s + d, drop });
      end = Math.max(end, s + d + FIRM);
    }
  blocks.setClipTop(T.innerTop);
  // the hiss of it all pouring in, and a soft pat as each row lands
  const curve: [number, number][] = [];
  const nowT = now();
  for (let t = t0; t <= end; t += 0.04) {
    let active = 0;
    for (const k of list) if (t >= k.t0 && t <= k.t1) active++;
    curve.push([t - nowT, Math.min(1, Math.sqrt(active) / 3)]);
  }
  audio.hiss(curve, 3000, 0.3);
  return { blocks: list, end };
}

function endFillIn(): void {
  fillIn = null;
  blocks.setClipTop(null);
}

function drawFillIn(f: FillIn, t: number): void {
  const cols = T.cols;
  const landed = new Int8Array(cols * T.rows).fill(EMPTY);
  for (const k of f.blocks) {
    if (t < k.t0) continue;
    const c = k.cell % cols;
    const r = (k.cell / cols) | 0;
    const y = T.cellY(r) - BLOCK / 2;
    if (t < k.t1) {
      const u = (t - k.t0) / (k.t1 - k.t0);
      blocks.block({ x: T.cellX(c), y0: y + k.drop * (1 - u * u), h: 1, color: k.color });
    } else {
      const q = clamp((t - k.t1) / FIRM, 0, 1);
      const sq = Math.sin(q * Math.PI);
      blocks.block({ x: T.cellX(c), y0: y, h: 1, sy: 1 - 0.06 * sq, sx: 1 + 0.03 * sq, sz: 1 + 0.03 * sq, color: k.color });
      if (q >= 1) landed[k.cell] = k.color;
    }
  }
  blocks.bridgesFor(cols, T.rows, (i) => landed[i]);
}

/** The move counter fills up like sand pouring in. */
let countTimer = 0;
function countUp(from: number, to: number, seconds: number): void {
  cancelAnimationFrame(countTimer);
  const el = $('moves');
  const t0 = performance.now();
  el.classList.add('pour');
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    el.textContent = String(Math.round(from + (to - from) * easeOut(p)));
    if (p < 1) countTimer = requestAnimationFrame(step);
    else el.classList.remove('pour');
  };
  countTimer = requestAnimationFrame(step);
}

function placeBottle(): void {
  bottle.home.copy(T.bottleSpot);
  bottle.group.position.copy(T.bottleSpot);
  bottle.group.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- lifting

function doLift(cell: number): void {
  if (cleared) return;
  const spent = spendMove(pool);
  if (!spent) {
    audio.bonk();
    toast('Out of moves. Undo gives one back, or restart the tray.');
    nudgeButtons();
    return;
  }
  const res = lift(cur.board, cell, RULE, cur.ids);
  if (!res) return;
  const t0 = now();
  logTap();
  pool = spent;
  const before = cur;
  history.push(cur);
  cur = { board: res.board, ids: res.trace!.ids };
  hover = null;

  // the tray pour, starting as the group leaves its cells
  pour = planPour(before.board, before.ids, res.group, res.trace!.steps[0] ?? [], t0 + 0.12);
  if (theme.motion === 'sand') {
    launchPourGrains(pour);
    pourSound(pour, t0);
  } else {
    retimeSolid(pour, theme.motion);
    landingSound(pour, t0);
  }

  // the group's flight to the bottle and the layer it pours
  const color = before.board.cells[cell];
  const f = makeFlight(res.group, before.board.cols, color, t0);
  flights.push(f);
  const base = bottle.surfaceY();
  const fillFrom = bottle.layerCount ? Math.min(1, (total - countBlocks(before.board)) / total) : 0;
  const pourDur = clamp(0.28 + 0.025 * res.group.length, 0.3, 0.7);
  const mouth = bottle.mouth();
  const firstFall = fallTime(mouth.y + 0.2 - base);
  const l0 = f.arrive + firstFall;
  const l1 = f.arrive + pourDur + firstFall;
  bottle.addLayer(sandColor(color), res.group.length / total, l0, l1);
  const top = bottle.surfaceY();
  launchBottleGrains(f, color, res.group.length, pourDur, base, top, l0, l1);
  launchShedGrains(f);
  f.done = l1 + 0.05;
  audio.thup(res.group.length);
  audio.bottlePour(f.arrive - t0, pourDur + firstFall, fillFrom, Math.min(1, fillFrom + res.group.length / total), SAND_PITCH[color % 5]);
  if (navigator.vibrate) {
    try {
      navigator.vibrate(8); // Android only; iPhone Safari has no web vibration
    } catch {
      /* ignore */
    }
  }
  if (isCleared(cur.board)) cleared = true;
  updateHud();
}

function makeFlight(group: number[], cols: number, color: number, t0: number): Flight {
  const pts = group.map((i) => ({ x: T.cellX(i % cols), y: T.cellY((i / cols) | 0) }));
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const extent = Math.max(0.5, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const rise = t0 + 0.3;
  const dist = Math.hypot(T.bottleSpot.x - cx, T.railTop + 3 - cy);
  const arrive = rise + clamp(0.3 + dist * 0.035, 0.38, 0.62);
  return {
    t0,
    blocks: pts.map((p) => ({ color, ox: p.x - cx, oy: p.y - cy, x: p.x, y: p.y })),
    cx,
    cy,
    rise,
    arrive,
    done: arrive + 0.6,
    scale: Math.min(0.42, 0.55 / extent),
  };
}

/** Where a flight's group center is at time t, and its scale. */
function flightPose(f: Flight, t: number): { x: number; y: number; z: number; s: number; sy: number; sx: number; glow: number; spin: number } {
  const lt = t - f.t0;
  if (lt < 0.07) {
    // squish
    const k = Math.sin((lt / 0.07) * Math.PI);
    return { x: f.cx, y: f.cy, z: 0, s: 1, sx: 1 + 0.06 * k, sy: 1 - 0.12 * k, glow: 0.45 * (lt / 0.07), spin: 0 };
  }
  const mouth = bottle.mouth();
  const rx = f.cx;
  const ry = f.cy + 0.45;
  const rz = 1.15;
  if (t < f.rise) {
    const e = easeOut((t - f.t0 - 0.07) / (f.rise - f.t0 - 0.07));
    return { x: f.cx, y: f.cy + 0.45 * e, z: rz * e, s: 1, sx: 1, sy: 1, glow: 0.45 * (1 - e) + 0.1, spin: 0 };
  }
  const p = clamp((t - f.rise) / (f.arrive - f.rise), 0, 1);
  const e = easeInOut(p);
  // quadratic arc from above the tray to just over the bottle mouth
  const mx = mouth.x;
  const my = mouth.y + 0.35;
  const mz = mouth.z;
  const px = (rx + mx) / 2;
  const py = Math.max(ry, my) + 0.5;
  const pz = 0.9;
  const a = (1 - e) * (1 - e);
  const b = 2 * (1 - e) * e;
  const c = e * e;
  return {
    x: a * rx + b * px + c * mx,
    y: a * ry + b * py + c * my,
    z: a * rz + b * pz + c * mz,
    s: 1 + (f.scale - 1) * Math.min(1, easeOut(p) * 1.35),
    sx: 1,
    sy: 1,
    glow: 0.1,
    spin: e * 1.2,
  };
}

// ---------------------------------------------------------------- grains

const tmpColor = new THREE.Color();
function grainColor(k: number): THREE.Color {
  const c = sandColor(k);
  const v = 0.82 + Math.random() * 0.32;
  tmpColor.setRGB(Math.min(1, c.r * v), Math.min(1, c.g * v), Math.min(1, c.b * v));
  if (Math.random() < 0.12) tmpColor.lerp(new THREE.Color(1, 1, 1), 0.5);
  return tmpColor;
}

function launchPourGrains(p: PourPlan): void {
  const per = tier.grainsPerBlock;
  for (const b of p.blocks) {
    const x = T.cellX(b.col);
    const srcBottom = T.cellY(b.fromRow) - BLOCK / 2;
    const dstBottom = T.cellY(b.toRow) - BLOCK / 2;
    const tau = b.d1 - b.d0;
    const fall = b.f0 - b.d0;
    for (let k = 0; k < per; k++) {
      const u = Math.random();
      const narrow = 0.28 + 0.2 * Math.random();
      grains.launch({
        x: x + (Math.random() - 0.5) * narrow * 1.4,
        y: srcBottom + u * BLOCK,
        z: (Math.random() - 0.5) * 0.65,
        ex: x + (Math.random() - 0.5) * 0.85,
        ey: dstBottom + u * BLOCK,
        ez: (Math.random() - 0.5) * 0.7,
        t0: b.d0 + u * tau,
        dur: fall,
        color: grainColor(b.color),
        size: 0.045 + Math.random() * 0.03,
      });
    }
  }
}

/** A few grains shaken loose as the group lifts out. */
function launchShedGrains(f: Flight): void {
  const per = Math.max(2, Math.round(tier.grainsPerBlock / 10));
  for (const b of f.blocks) {
    for (let k = 0; k < per; k++) {
      const t0 = f.t0 + 0.05 + Math.random() * 0.25;
      const pose = flightPose(f, t0);
      const x = pose.x + b.ox * pose.s + (Math.random() - 0.5) * 0.8;
      const y = pose.y + b.oy * pose.s - 0.45;
      const z = pose.z + (Math.random() - 0.5) * 0.6;
      const drop = 0.6 + Math.random() * 1.0;
      grains.launch({ x, y, z, ex: x + (Math.random() - 0.5) * 0.3, ey: y - drop, ez: z, t0, dur: fallTime(drop), color: grainColor(b.color), size: 0.05 });
    }
  }
}

/** The ribbon of sand from the bottle mouth down onto the growing layer. */
function launchBottleGrains(f: Flight, color: number, size: number, pourDur: number, base: number, top: number, l0: number, l1: number): void {
  const mouth = bottle.mouth();
  const count = Math.min(Math.round(tier.maxGrains * 0.3), Math.round(tier.grainsPerBlock * 0.7 * size) + 30);
  for (let k = 0; k < count; k++) {
    const t0 = f.arrive + Math.random() * pourDur;
    const sy = mouth.y + 0.25;
    // land where the surface will be when this grain arrives
    const guess = fallTime(sy - base);
    const land = t0 + guess;
    const lf = clamp((land - l0) / (l1 - l0), 0, 1);
    const ly = base + (top - base) * easeOut(lf);
    const r = Math.sqrt(Math.random()) * 0.36;
    const a = Math.random() * Math.PI * 2;
    grains.launch({
      x: mouth.x + (Math.random() - 0.5) * 0.08,
      y: sy,
      z: mouth.z + (Math.random() - 0.5) * 0.08,
      ex: mouth.x + Math.cos(a) * r,
      ey: ly,
      ez: mouth.z + Math.sin(a) * r,
      t0,
      dur: fallTime(sy - ly),
      color: grainColor(color),
      size: 0.04 + Math.random() * 0.025,
    });
  }
}

/** A puff of bright grains around the bottle when it's corked. */
function launchSparkle(t0: number): void {
  const c = bottle.center();
  const count = Math.min(220, tier.grainsPerBlock * 3);
  for (let k = 0; k < count; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.0 + Math.random() * 0.9;
    const col = new THREE.Color().setHSL(0.1 + Math.random() * 0.05, 0.6, 0.85 + Math.random() * 0.1);
    grains.launch({
      x: c.x + Math.cos(a) * 0.5,
      y: c.y + 1.4 + (Math.random() - 0.5) * 0.4,
      z: c.z + Math.sin(a) * 0.5,
      ex: c.x + Math.cos(a) * r,
      ey: c.y + 0.6 + Math.random() * 1.6,
      ez: c.z + Math.sin(a) * r * 0.6,
      t0: t0 + Math.random() * 0.15,
      dur: 0.5 + Math.random() * 0.4,
      color: col,
      size: 0.05 + Math.random() * 0.04,
      g: 0.15,
    });
  }
}

function pourSound(p: PourPlan, t0: number): void {
  if (!p.blocks.length) return;
  const colors = [...new Set(p.blocks.map((b) => b.color))];
  for (const k of colors) {
    const mine = p.blocks.filter((b) => b.color === k);
    const curve: [number, number][] = [];
    for (let t = p.start; t <= p.end + 0.02; t += 0.03) {
      let active = 0;
      for (const b of mine) if (t >= b.d0 && t <= b.f1) active++;
      curve.push([t - t0, Math.min(1, Math.sqrt(active) / 2.6)]);
    }
    audio.hiss(curve, SAND_PITCH[k % 5], 0.42 / Math.sqrt(colors.length));
  }
  // one soft pat as each column's sand firms up
  p.columnEnds.forEach((e, i) => audio.pat(e - t0 + 0.02 * i, 0.07));
}

/** Solid blocks: a knock as each one lands, pitched and weighted by the theme. */
function landingSound(p: PourPlan, t0: number): void {
  const vol = theme.motion === 'thunk' ? 0.16 : theme.motion === 'float' ? 0.05 : 0.1;
  const seen = new Set<number>();
  for (const b of [...p.blocks].sort((a, c) => a.d1 - c.d1)) {
    const slot = Math.round(b.d1 * 30);
    if (seen.has(slot)) continue;
    seen.add(slot);
    audio.pat(b.d1 - t0, vol);
  }
  if (theme.motion === 'snap' && p.blocks.length) audio.tinkle(p.end - t0 - 0.1, 3, 0.04);
}

// ---------------------------------------------------------------- undo, restart, fast-forward

/** Finish every animation now: a tap during a pour fast-forwards it. */
function fastForward(): void {
  if (pendingNext !== null) {
    // tapped while the bottle was being set aside: go straight to the next level
    pendingNext = null;
    window.setTimeout(() => startBoard(n + 1, false), 0);
  }
  if (fillIn) {
    endFillIn();
    markReady();
  }
  if (pour || flights.length) {
    pour = null;
    flights = [];
    grains.clear();
    bottle.settleAll();
    audio.hush();
    markReady();
  }
}

function undo(): void {
  if (!history.length || cleared) return;
  fastForward();
  cancelPress();
  cur = history.pop()!;
  pool = refundMove(pool);
  bottle.popLayer();
  cleared = false;
  corked = false;
  pendingNext = null;
  updateHud();
}

function restart(): void {
  if (cleared) return;
  fastForward();
  cancelPress();
  cur = start;
  history = [];
  pool = restartBoard(pool);
  bottle.reset();
  cleared = false;
  corked = false;
  pendingNext = null;
  bottle.uncork();
  updateHud();
  readyAt = performance.now();
}

// ---------------------------------------------------------------- clear: cork, set the bottle aside, next level

function maybeCork(t: number): void {
  if (!cleared || corked || pour || flights.length) return;
  corked = true;
  bottle.corkAt(t + 0.15);
  audio.cork(0.15 + 0.42, 0.15 + 0.75);
  audio.chime(0.15 + 0.95);
  launchSparkle(bottle.corkSeatTime);
  const lifts = history.length;
  const par = pick.entry.par;
  const stars = lifts <= par ? 3 : lifts <= par + 2 ? 2 : 1;
  const verdict = lifts < par ? 'Beat par!' : lifts === par ? 'Par!' : `${lifts} lifts, par ${par}`;
  window.setTimeout(() => toast(`${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  Level ${n} · ${verdict}`), 700);
  // the corked bottle slides off along the rail, then the next tray pours in
  bottle.exitAt(bottle.corkSeatTime + 0.6);
  pendingNext = bottle.corkSeatTime + 0.95;
}

function maybeNextLevel(t: number): void {
  if (pendingNext !== null && t >= pendingNext) {
    pendingNext = null;
    startBoard(n + 1, false);
  }
}

// ---------------------------------------------------------------- drawing

function drawSettled(b: Board, glowAt: (i: number) => number): void {
  const { cols, cells } = b;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === EMPTY) continue;
    const c = i % cols;
    const r = (i / cols) | 0;
    blocks.block({ x: T.cellX(c), y0: T.cellY(r) - BLOCK / 2, h: 1, color: v, glow: glowAt(i) });
  }
  blocks.bridgesFor(cols, b.rows, (i) => cells[i], glowAt);
}

function drawPour(p: PourPlan, t: number): void {
  const cols = T.cols;
  const rows = T.rows;
  // still blocks, with bridges among them
  const still = new Int8Array(cols * rows).fill(EMPTY);
  for (const [id, cell] of p.still) {
    const color = p.colorOf.get(id)!;
    still[cell] = color;
    blocks.block({ x: T.cellX(cell % cols), y0: T.cellY((cell / cols) | 0) - BLOCK / 2, h: 1, color });
  }
  if (theme.motion !== 'sand') {
    drawSolidFall(p, t, theme.motion, still);
    blocks.bridgesFor(cols, rows, (i) => still[i]);
    return;
  }
  // landed blocks join the still set once they've firmed up, so bridges grow as the sand settles
  for (const b of p.blocks) {
    const x = T.cellX(b.col);
    const srcY = T.cellY(b.fromRow) - BLOCK / 2;
    const dstY = T.cellY(b.toRow) - BLOCK / 2;
    if (t < b.d1) {
      const f = clamp((t - b.d0) / (b.d1 - b.d0), 0, 1);
      blocks.block({ x, y0: srcY + BLOCK * f, h: 1 - f, color: b.color, sx: 1 - 0.05 * f, sz: 1 - 0.05 * f });
    }
    if (t > b.f0) {
      const f = clamp((t - b.f0) / (b.f1 - b.f0), 0, 1);
      let sy = 1;
      let sx = 1 - 0.06 * (1 - f);
      if (f >= 1) {
        const k = clamp((t - b.f1) / FIRM, 0, 1);
        sy = 1 - 0.05 * Math.sin(k * Math.PI);
        sx = 1 + 0.025 * Math.sin(k * Math.PI);
        if (k >= 1) still[b.toRow * cols + b.col] = b.color;
      }
      blocks.block({ x, y0: dstY, h: f, sy, sx, sz: sx, color: b.color });
    }
  }
  blocks.bridgesFor(cols, rows, (i) => still[i]);
}

/** Blocks falling as solid pieces, each with its theme's landing: jelly wobble, gem glint-bounce, soft float, toy thunk. */
function drawSolidFall(p: PourPlan, t: number, style: SolidStyle, still: Int8Array): void {
  const cols = T.cols;
  const settle = SOLID_FALL[style].settle;
  for (const b of p.blocks) {
    const x = T.cellX(b.col);
    const srcY = T.cellY(b.fromRow) - BLOCK / 2;
    const dstY = T.cellY(b.toRow) - BLOCK / 2;
    if (t < b.d1) {
      const u = clamp((t - b.d0) / (b.d1 - b.d0), 0, 1);
      const e = style === 'float' ? u * u * (3 - 2 * u) : u * u;
      // jelly stretches a little as it falls
      const st = style === 'jelly' ? 0.1 * Math.sin(u * Math.PI * 0.5) * (t > b.d0 ? 1 : 0) : 0;
      blocks.block({ x, y0: srcY + (dstY - srcY) * e, h: 1, sy: 1 + st, sx: 1 - st * 0.5, sz: 1 - st * 0.5, color: b.color });
      continue;
    }
    const q = clamp((t - b.d1) / settle, 0, 1);
    let y = dstY;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    if (style === 'jelly') {
      const k = Math.cos(q * Math.PI * 3) * Math.exp(-q * 4.5) * (1 - q);
      sy = 1 - 0.22 * k;
      sx = 1 + 0.13 * k;
      y = dstY - (BLOCK * (1 - sy)) / 2; // squash from the floor up
    } else if (style === 'snap') {
      y = dstY + 0.07 * Math.sin(q * Math.PI);
    } else if (style === 'thunk') {
      y = dstY + 0.09 * Math.abs(Math.sin(q * Math.PI * 2)) * (1 - q);
      rot = 0.09 * Math.sin(q * Math.PI * 3) * (1 - q);
      sy = 1 - 0.04 * Math.sin(Math.min(1, q * 4) * Math.PI);
    } else {
      sy = 1 - 0.03 * Math.sin(q * Math.PI);
    }
    blocks.block({ x, y0: y, h: 1, sx, sy, sz: sx, rotY: rot, color: b.color });
    if (q >= 1) still[b.toRow * cols + b.col] = b.color;
  }
}

function drawPreview(p: Preview, t: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * 7);
  drawSettled(p.after.board, (i) => (p.moved.has(i) ? 0.08 + 0.16 * pulse : 0));
  const cols = T.cols;
  p.group.forEach((cell, k) => {
    blocks.ghost(T.cellX(cell % cols), T.cellY((cell / cols) | 0), 0.62, 0.9, p.colors[k]);
  });
}

function drawFlights(t: number): void {
  for (const f of flights) {
    const pose = flightPose(f, t);
    const pourDur = f.done - f.arrive;
    const nb = f.blocks.length;
    f.blocks.forEach((b, k) => {
      let s = pose.s;
      if (t > f.arrive) {
        // pour in: blocks melt into the mouth one after another
        const kt = f.arrive + (k / nb) * pourDur * 0.6;
        const melt = clamp((t - kt) / (pourDur * 0.4 + 0.05), 0, 1);
        s *= 1 - melt;
        if (s <= 0.01) return;
      }
      const cs = Math.cos(pose.spin);
      const sn = Math.sin(pose.spin);
      const ox = b.ox * pose.s;
      const oy = b.oy * pose.s;
      const x = pose.x + ox * cs;
      const z = pose.z - ox * sn;
      const y = pose.y + oy;
      blocks.block({
        x,
        y0: y - (BLOCK * s * pose.sy) / 2,
        h: 1,
        sx: s * pose.sx,
        sy: s * pose.sy,
        sz: s * pose.sx,
        z,
        rotY: pose.spin,
        color: b.color,
        glow: pose.glow,
      });
    });
  }
}

// ---------------------------------------------------------------- frame loop

const frameTimes = new Float32Array(120);
let frameIdx = 0;
let lastFrame = 0;
let jsCost = 0;
/** Per-frame CPU time (ms) for the performance script. */
const costLog: number[] = [];
let tierCheck: { until: number; sum: number; count: number } | null = null;

function frame(): void {
  const t0 = performance.now();
  const t = now();
  if (lastFrame) {
    const dt = t0 - lastFrame;
    frameTimes[frameIdx++ % frameTimes.length] = dt;
    if (tierCheck) {
      tierCheck.sum += dt;
      tierCheck.count++;
      if (t0 >= tierCheck.until) {
        const avg = tierCheck.sum / Math.max(1, tierCheck.count);
        tierCheck = null;
        if (tierChoice === 'auto' && tier.name === 'medium' && avg > SLOW_FRAME_MS) {
          setTier(TIERS.low);
          toast('Switched to Low quality to keep things smooth');
        }
      }
    }
  }
  lastFrame = t0;

  if (pour && t >= pour.end) {
    pour = null;
    markReady();
  }
  flights = flights.filter((f) => t < f.done);

  blocks.begin();
  if (fillIn && t >= fillIn.end) {
    endFillIn();
    markReady();
  }
  if (pour) drawPour(pour, t);
  else if (fillIn) drawFillIn(fillIn, t);
  else if (preview) drawPreview(preview, t);
  else {
    const hv = hover ? new Set(hover) : null;
    drawSettled(cur.board, (i) => (hv && hv.has(i) ? 0.22 : 0));
  }
  drawFlights(t);
  blocks.end(preview ? 0.38 + 0.18 * Math.sin(t * 7) : 0.5);

  bottle.update(t);
  T.moveBottleShadow(bottle.offset.x, bottle.offset.y);
  grains.update(t);
  T.tick(t);
  maybeCork(t);
  maybeNextLevel(t);
  T.render();
  const cost = performance.now() - t0;
  jsCost = jsCost * 0.95 + cost * 0.05;
  if (costLog.length < 5000) costLog.push(cost);
  if (showFps && frameIdx % 15 === 0) drawFps();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input: tap to lift, hold to preview

function cancelPress(): void {
  if (press) clearTimeout(press.timer);
  press = null;
  if (preview) setHint('');
  preview = null;
}

function showPreview(): void {
  if (!press) return;
  const res = lift(cur.board, press.cell, RULE, cur.ids)!;
  const finalCell = new Map<number, number>();
  res.trace!.ids.forEach((id, i) => {
    if (id >= 0) finalCell.set(id, i);
  });
  const moved = new Set<number>();
  for (let i = 0; i < cur.board.cells.length; i++) {
    const id = cur.ids[i];
    if (id < 0 || res.group.includes(i)) continue;
    const to = finalCell.get(id)!;
    if (to !== i) moved.add(to);
  }
  preview = {
    group: res.group,
    colors: res.group.map((i) => cur.board.cells[i]),
    moved,
    after: { board: res.board, ids: res.trace!.ids },
  };
  setHint('Release to lift · slide off to cancel');
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  audio.unlock();
  if (pour || fillIn) {
    fastForward();
    return;
  }
  if (cleared) {
    // a tap after the last lift hurries things along: finish the pour, then skip ahead to the next level
    fastForward();
    return;
  }
  const cell = T.pick(e.clientX, e.clientY);
  if (cell === null || cur.board.cells[cell] === EMPTY) return;
  cancelPress();
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* fine */
  }
  press = { pointerId: e.pointerId, cell, group: groupAt(cur.board, cell), timer: window.setTimeout(showPreview, HOLD_MS) };
  hover = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (press && e.pointerId === press.pointerId) {
    const cell = T.pick(e.clientX, e.clientY);
    if (cell === null || !press.group.includes(cell)) {
      const was = !!preview;
      cancelPress();
      if (was) toast('Cancelled, no move spent');
    }
    return;
  }
  if (e.pointerType !== 'mouse' || pour || cleared) {
    hover = null;
    return;
  }
  const cell = T.pick(e.clientX, e.clientY);
  hover = cell !== null && cur.board.cells[cell] !== EMPTY ? groupAt(cur.board, cell) : null;
  canvas.style.cursor = hover ? 'pointer' : 'default';
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  const cell = T.pick(e.clientX, e.clientY);
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

// ---------------------------------------------------------------- HUD

function updateHud(): void {
  if (!$('moves').classList.contains('pour')) $('moves').textContent = String(pool.moves);
  $('movesLabel').textContent = pool.moves === 1 ? 'move' : 'moves';
  $('levelLabel').innerHTML =
    `<b>Level ${n}</b><span class="meta"> · par ${pick.entry.par}<span class="size"> · ${pick.entry.cols}×${pick.entry.rows}</span></span>`;
  const left = countBlocks(cur.board);
  $('left').textContent = `${left} ${left === 1 ? 'block' : 'blocks'} left`;
  $('hud').classList.toggle('empty', pool.moves === 0 && !cleared);
  // once a level is cleared it's done: the next one is already on its way
  $<HTMLButtonElement>('undo').disabled = history.length === 0 || cleared;
  $<HTMLButtonElement>('restart').disabled = history.length === 0 || cleared;
  if (pool.moves === 0 && !cleared) setHint('Out of moves. Undo, or restart the level.', true);
  else if (!preview) setHint('');
}

const HOW = 'Tap a block to lift its group. Hold to preview.';
function setHint(text: string, active = !!text): void {
  const el = $('hint');
  el.textContent = text || HOW;
  el.classList.toggle('active', active);
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function nudgeButtons(): void {
  const bar = $('bar');
  bar.classList.remove('nudge');
  void bar.offsetWidth;
  bar.classList.add('nudge');
}

function layout(): void {
  const hud = $('hud').getBoundingClientRect();
  const bar = $('bar').getBoundingClientRect();
  const H = window.innerHeight;
  // with the bottle centered on top, the header's chips sit either side of it, so the scene can use their height
  const top = ui === 'hero' ? hud.top + parseFloat(getComputedStyle($('hud')).paddingTop) : hud.bottom + 4;
  const side = ui === 'classic' ? 10 : 4;
  T.frame({ top: Math.max(8, top), bottom: H - bar.top + 6, side });
  const vp = T.viewport;
  grains.setScale(vp.h * T.renderer.getPixelRatio(), T.fov);
}

// ---------------------------------------------------------------- look-and-feel themes (mockups)

const urlTheme = new URLSearchParams(location.search).get('theme');
const savedTheme = urlTheme ?? store.get('unfill-theme');
let themeName: ThemeName = savedTheme && savedTheme in THEMES ? (savedTheme as ThemeName) : 'terrarium';
let theme: Theme = THEMES[themeName];

function applyTheme(name: ThemeName): void {
  themeName = name;
  theme = THEMES[name];
  theme.sand.forEach((h, i) => SAND[i].set(h));
  T.blockLook = { radius: theme.block.radius, segments: theme.block.segments };
  blocks.setGeometry(T.blockGeometry());
  blocks.applyTheme(theme);
  T.applyTheme(theme);
  document.body.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.chrome);
  for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-theme]')) b.setAttribute('aria-pressed', String(b.dataset.theme === name));
}
for (const b of document.querySelectorAll<HTMLButtonElement>('button[data-theme]')) {
  b.onclick = () => {
    store.set('unfill-theme', b.dataset.theme!);
    applyTheme(b.dataset.theme as ThemeName);
    warmup();
  };
}

// ---------------------------------------------------------------- layouts (UI mockups)

type UiName = 'classic' | 'board' | 'hero' | 'cozy';
const UI_VIEWS: Record<UiName, View> = {
  classic: CLASSIC_VIEW,
  /** Head-on, the glass edge to edge, like a classic block puzzle board. */
  board: { pitchDeg: 6, yawDeg: 0, box: 'tight', bottleAt: 'right', bottleScale: 0.6 },
  /** The bottle front and center above the tray, with the level and moves either side of it. */
  hero: { pitchDeg: 7, yawDeg: 0, box: 'tight', bottleAt: 'center', bottleScale: 0.72 },
  /** The tilted terrarium, cropped close so the tray fills the screen. */
  cozy: { pitchDeg: 15, yawDeg: 6, box: 'tight', bottleAt: 'right', bottleScale: 0.66 },
};
const urlUi = new URLSearchParams(location.search).get('ui');
// Will picked Bottle top, so it's the default now
const savedUi = urlUi ?? store.get('unfill-ui');
let ui: UiName = savedUi && savedUi in UI_VIEWS ? (savedUi as UiName) : 'hero';

function applyUi(name: UiName): void {
  ui = name;
  document.body.dataset.ui = name;
  T.view = UI_VIEWS[name];
  bottle.setScale(T.view.bottleScale);
  placeBottle();
  layout();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ui]')) b.setAttribute('aria-pressed', String(b.dataset.ui === name));
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ui]')) {
  b.onclick = () => {
    store.set('unfill-ui', b.dataset.ui!);
    applyUi(b.dataset.ui as UiName);
  };
}

// ---------------------------------------------------------------- settings

let showFps = store.get('unfill-fps') === '1';

function syncSettings(): void {
  $('setSound').setAttribute('aria-checked', String(!audio.muted));
  $('setAmbient').setAttribute('aria-checked', String(audio.ambient));
  $<HTMLButtonElement>('setAmbient').disabled = audio.muted;
  $('setFps').setAttribute('aria-checked', String(showFps));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tier]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tier === tierChoice));
  }
  $('tierNote').textContent = tierChoice === 'auto' ? `Auto picked ${tier.label}.` : `${tier.label}, chosen by you.`;
  $('fps').hidden = !showFps;
  const s = timingSummary();
  $('timingText').textContent = s
    ? `${s.taps} taps logged: ${s.think.toFixed(1)} s thinking + ${s.anim.toFixed(1)} s pouring per tap on average.`
    : 'No taps logged yet.';
}

const more = $<HTMLDetailsElement>('more');
more.addEventListener('toggle', () => {
  if (more.open) syncSettings();
  $('gear').setAttribute('aria-expanded', String(more.open));
});
// the compact layouts open the settings from a gear button instead of the summary row
$('gear').onclick = () => {
  more.open = !more.open;
};
// tapping the tray closes the settings panel
canvas.addEventListener('pointerdown', () => {
  more.open = false;
}, true);
$('setSound').onclick = () => {
  audio.unlock();
  audio.setMuted(!audio.muted);
  store.set('unfill-muted', audio.muted ? '1' : '0');
  syncSettings();
};
$('setAmbient').onclick = () => {
  audio.unlock();
  audio.setAmbient(!audio.ambient);
  store.set('unfill-ambient', audio.ambient ? '1' : '0');
  syncSettings();
};
$('setFps').onclick = () => {
  showFps = !showFps;
  store.set('unfill-fps', showFps ? '1' : '0');
  syncSettings();
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tier]')) {
  b.onclick = () => {
    tierChoice = b.dataset.tier as TierName | 'auto';
    store.set('unfill-tier', tierChoice);
    setTier(TIERS[tierChoice === 'auto' ? 'medium' : tierChoice]);
  };
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tray]')) {
  b.onclick = () => {
    more.open = false;
    startBoard(Number(b.dataset.tray), true);
  };
}
$('copyTimings').onclick = async () => {
  const s = timingSummary();
  const rows = loadTimings();
  const text = [
    s ? `Unfill tap timings: ${s.taps} taps, ${s.think.toFixed(2)} s thinking + ${s.anim.toFixed(2)} s pouring per tap` : 'No taps yet',
    'tray,cols,rows,think_ms,pour_ms',
    ...rows.map((r) => `${r.n},${r.c},${r.r},${r.think},${r.anim}`),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('Timings copied');
  } catch {
    toast('Copying is blocked here');
  }
};

// frame-rate readout
function drawFps(): void {
  const k = Math.min(frameIdx, frameTimes.length);
  if (!k) return;
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < k; i++) {
    sum += frameTimes[i];
    worst = Math.max(worst, frameTimes[i]);
  }
  const avg = sum / k;
  $('fps').textContent = `${Math.round(1000 / avg)} fps · worst ${worst.toFixed(0)} ms · ${tier.label}`;
}

// ---------------------------------------------------------------- tap timing log (for re-running the economy tuner)

interface TimingRow {
  n: number;
  c: number;
  r: number;
  think: number;
  anim: number;
}
const TIMING_KEY = 'unfill-timings';
let pendingTap: (TimingRow & { at: number }) | null = null;

function loadTimings(): TimingRow[] {
  try {
    const v = JSON.parse(store.get(TIMING_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** A tap: thinking time is how long the tray sat ready before it. */
function logTap(): void {
  const at = performance.now();
  const think = Math.round(at - readyAt);
  // a long pause (the phone put down) isn't thinking time
  pendingTap = think > 60000 ? null : { n, c: cur.board.cols, r: cur.board.rows, think, anim: 0, at };
}

/** The tray is playable again: the pour time is known, so the tap's row is saved. */
function markReady(): void {
  readyAt = performance.now();
  if (!pendingTap) return;
  const { at, ...row } = pendingTap;
  row.anim = Math.round(readyAt - at);
  pendingTap = null;
  const rows = loadTimings();
  rows.push(row);
  store.set(TIMING_KEY, JSON.stringify(rows.slice(-1000)));
}

function timingSummary(): { taps: number; think: number; anim: number } | null {
  const rows = loadTimings();
  if (!rows.length) return null;
  return {
    taps: rows.length,
    think: rows.reduce((s, r) => s + r.think, 0) / rows.length / 1000,
    anim: rows.reduce((s, r) => s + r.anim, 0) / rows.length / 1000,
  };
}

// ---------------------------------------------------------------- buttons, start

$('undo').onclick = undo;
$('restart').onclick = restart;
$('startBtn').onclick = () => {
  audio.unlock();
  $('intro').hidden = true;
  if (tierChoice === 'auto') tierCheck = { until: performance.now() + 2000, sum: 0, count: 0 };
};

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);

applyTheme(themeName);
startBoard(Number(new URLSearchParams(location.search).get('tray')) || 1, true);
applyUi(ui);
warmup();

/**
 * Compile every shader before play: a bottle layer, the cork, the preview ghost and the grains. Otherwise each one
 * compiles the first time it appears, and on a phone that's a visible hitch in the middle of a pour.
 */
function warmup(): void {
  // Drawn for one frame (under the intro card) inside the real scene, so the lights and fog match and the GPU
  // builds its pipelines too, not just the shader programs.
  const warm = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mats = [...bottle.warmables(SAND), blocks.ghostMaterial];
  mats.forEach((m, i) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(-1 + (i % 4) * 0.5, T.rows / 2 + Math.floor(i / 4) * 0.5, 0);
    mesh.frustumCulled = false;
    warm.add(mesh);
  });
  T.scene.add(warm);
  // one grain, alive for this frame only, so the point pipeline is built too
  const t = now();
  grains.launch({ x: 0, y: T.rows / 2, z: 0, ex: 0, ey: T.rows / 2, ez: 0, t0: t - 0.01, dur: 0.05, color: SAND[0], size: 0.1, g: 0 });
  grains.update(t);
  T.renderer.compile(T.scene, T.camera);
  T.render();
  T.scene.remove(warm);
  geo.dispose();
}
void document.fonts?.ready.then(layout);
requestAnimationFrame(frame);

// Hooks for the scripted performance check (scripts/perf.mjs). Harmless in normal play.
(window as unknown as { unfill: unknown }).unfill = {
  tap: (cell: number) => doLift(cell),
  board: () => ({ cols: cur.board.cols, rows: cur.board.rows, cells: Array.from(cur.board.cells) }),
  busy: () => !!pour || flights.length > 0 || !!fillIn,
  level: () => n,
  moves: () => pool.moves,
  /** Is a cleared level on its way out (cork, bottle exit) before the next one pours in? */
  advancing: () => cleared || pendingNext !== null,
  frames: () => Array.from(frameTimes.slice(0, Math.min(frameIdx, frameTimes.length))),
  jsCost: () => jsCost,
  renderInfo: () => ({ calls: T.renderer.info.render.calls, triangles: T.renderer.info.render.triangles, points: T.renderer.info.render.points }),
  costs: () => costLog.slice(),
  setTier: (name: TierName) => {
    tierChoice = name;
    setTier(TIERS[name]);
  },
  start: (num: number) => startBoard(num, true),
  setUi: (name: UiName) => applyUi(name),
  setTheme: (name: ThemeName) => applyTheme(name),
  dismissIntro: () => $('startBtn').click(),
  /** Freeze the scene clock (seconds) for frame-exact screenshots; null resumes. */
  freeze: (t: number | null) => {
    clockOverride = t;
  },
  now: () => now(),
  solution: () => transformEntry(pick.entry, pick.transform).solution,
  fastForward: () => fastForward(),
  cellScreen: (i: number) => T.toScreen(new THREE.Vector3(T.cellX(i % T.cols), T.cellY((i / T.cols) | 0), BLOCK / 2)),
  grains: () => ({ busyUntil: grains.busyUntil, cap: grains.capacity }),
};
