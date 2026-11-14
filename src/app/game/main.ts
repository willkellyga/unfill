import './style.css';
import * as THREE from 'three';
import {
  EMPTY,
  Session,
  countBlocks,
  groupAt,
  type Board,
  type Keepsake,
  type Library,
} from '../../core';
import libraryText from '../../library/boards.json?raw';
import { Audio } from './audio';
import { Blocks } from './blocks';
import { Bottle } from './bottle';
import { Grains } from './grains';
import { SAND, sandColor, SAND_PITCH } from './palette';
import { FIRM, fallTime, planPour, type PourPlan } from './pour';
import { SLOW_FRAME_MS, TIERS, type Tier, type TierName } from './quality';
import { BLOCK, BOTTLE_SCALE, Terrarium } from './scene';
import { renderShelf } from './shelf';

// ---------------------------------------------------------------- setup

const library: Library = JSON.parse(libraryText);

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
bottle.setScale(BOTTLE_SCALE);
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
}

let pour: PourPlan | null = null;
let flights: Flight[] = [];
let press: Press | null = null;
let hover: number[] | null = null;
let fillIn: FillIn | null = null;
/** Scene time at which the next level starts, once the bottle is corked and set aside. */
let pendingNext: number | null = null;
let corked = false;
let readyAt = 0; // when the tray last became playable, for the tap timing log

// ---------------------------------------------------------------- the session, saved after every action

const SAVE_KEY = 'unfill-save';
const SHELF_KEY = 'unfill-shelf';
const params = new URLSearchParams(location.search);
/** `?tray=N` jumps straight to a level for testing, without touching her saved game. */
const trayParam = Number(params.get('tray')) || 0;
const ephemeral = trayParam > 0 || params.has('nosave');

function loadJson(key: string): unknown {
  if (ephemeral) return null;
  try {
    return JSON.parse(store.get(key) || 'null');
  } catch {
    return null;
  }
}

function loadShelf(): Keepsake[] {
  const v = loadJson(SHELF_KEY);
  return Array.isArray(v) ? (v as Keepsake[]).filter((k) => k && Array.isArray(k.layers) && Number.isInteger(k.n)) : [];
}

const newSeed = () => 1 + Math.floor(Math.random() * 1e9);
const shelfAtLoad = loadShelf();
let S: Session = Session.restore(library.boards, loadJson(SAVE_KEY), shelfAtLoad) as Session;
/** Was there a game in progress to come back to? */
const resumed = !!S;
if (!S) {
  S = new Session(library.boards, newSeed(), shelfAtLoad);
  S.begin(trayParam || 1, true);
} else if (S.cleared) {
  // closed during the clear: the bottle is already on the shelf, so carry on to the next level
  S.next();
}

// ---------------------------------------------------------------- points and the high score

const BEST_KEY = 'unfill-best';
let best = ephemeral ? 0 : Number(store.get(BEST_KEY)) || 0;
/** The best before this run, so the clear banner can say "New best!" the first time this run passes it. */
let bestAtRunStart = best;
let newBestShown = false;
/** The score shown in the HUD; it counts up to the real score as each bottle is corked. */
let shownScore = S.score;
let overShown = false;

/** Out of moves with sand still in the tray: the run is over. Shows the final score against the best. */
function showOver(): void {
  overShown = true;
  clearBanner();
  const levels = S.n - 1;
  $('overText').textContent =
    `You scored ${fmt(S.score)} points` + (levels > 0 ? ` over ${levels} ${levels === 1 ? 'level' : 'levels'}.` : '.');
  const isBest = S.score > 0 && S.score >= best && S.score > bestAtRunStart;
  $('overBest').textContent = isBest ? 'A new high score!' : `High score: ${fmt(best)}`;
  $('overBest').classList.toggle('best', isBest);
  $('over').hidden = false;
  $('againBtn').focus();
}

function newRun(): void {
  $('over').hidden = true;
  overShown = false;
  bestAtRunStart = best;
  newBestShown = false;
  S = new Session(library.boards, newSeed(), S.shelf);
  shownScore = 0;
  startBoard(1, true);
}

function persist(): void {
  if (!ephemeral) store.set(SAVE_KEY, JSON.stringify(S.toSave()));
}
function persistShelf(): void {
  if (!ephemeral) store.set(SHELF_KEY, JSON.stringify(S.shelf));
}

/** Show the session's current board: the tray, the bottle with the layers poured so far, the HUD. */
function showBoard(): void {
  pendingNext = null;
  fastForward();
  endFillIn();
  press = null;
  T.buildTray(S.cur.board.cols, S.cur.board.rows);
  bottle.reset();
  placeBottle();
  layout();
  corked = false;
  S.history.forEach((snap, k) => {
    const after = k + 1 < S.history.length ? S.history[k + 1] : S.cur;
    const size = countBlocks(snap.board) - countBlocks(after.board);
    bottle.addLayer(sandColor(snap.board.cells[S.taps[k]]), size / S.total, -2, -1);
  });
  bottle.settleAll();
  bottle.update(now());
  updateHud();
  readyAt = performance.now();
  persist();
}

/**
 * Start level `num` with a fresh move pool (the first level, a jump, or starting over), shown at once.
 */
function startBoard(num: number, fresh: boolean): void {
  if (fresh) {
    S.begin(num, true);
    showBoard();
    bottle.enterAt(now());
    levelBanner(null);
    return;
  }
  nextLevel();
}

/** The level after a clear: leftover moves carry over and the new tray's sand pours in from above. */
function nextLevel(): void {
  const prev = { cols: S.cur.board.cols, rows: S.cur.board.rows, colors: S.pick.entry.colors };
  const { before } = S.next();
  showBoard();
  const t = now();
  bottle.enterAt(t);
  fillIn = planFillIn(S.cur.board, t + 0.15);
  countUp(before, S.pool.moves, 0.9);
  levelBanner(prev);
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
const countTimers: Record<string, number> = {};
function countUp(from: number, to: number, seconds: number, id = 'moves'): void {
  cancelAnimationFrame(countTimers[id] ?? 0);
  const el = $(id);
  const t0 = performance.now();
  el.classList.add('pour');
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    el.textContent = fmt(Math.round(from + (to - from) * easeOut(p)));
    if (p < 1) countTimers[id] = requestAnimationFrame(step);
    else el.classList.remove('pour');
  };
  countTimers[id] = requestAnimationFrame(step);
}

function placeBottle(): void {
  bottle.home.copy(T.bottleSpot);
  bottle.group.position.copy(T.bottleSpot);
  bottle.group.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- lifting

function doLift(cell: number): void {
  if (S.cleared) return;
  const out = S.lift(cell, Date.now());
  if (!out || out === 'out') return;
  const { before, res, color } = out;
  const t0 = now();
  logTap();
  hover = null;

  // the tray pour, starting as the group leaves its cells
  pour = planPour(before.board, before.ids, res.group, res.trace!.steps[0] ?? [], t0 + 0.12);
  launchPourGrains(pour);
  pourSound(pour, t0);

  // the group's flight to the bottle and the layer it pours
  const total = S.total;
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
  if (out.keepsake) {
    persistShelf();
    if (S.score > best) {
      best = S.score;
      if (!ephemeral) store.set(BEST_KEY, String(best));
    }
  }
  persist();
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

// ---------------------------------------------------------------- undo, restart, fast-forward

/** Finish every animation now: a tap during a pour fast-forwards it. */
function fastForward(): void {
  if (pendingNext !== null) {
    // tapped while the bottle was being set aside: go straight to the next level
    pendingNext = null;
    window.setTimeout(nextLevel, 0);
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

// ---------------------------------------------------------------- clear: cork, set the bottle aside, next level

function maybeCork(t: number): void {
  if (!S.cleared || corked || pour || flights.length || fillIn) return;
  corked = true;
  bottle.corkAt(t + 0.15);
  audio.cork(0.15 + 0.42, 0.15 + 0.75);
  audio.chime(0.15 + 0.95);
  launchSparkle(bottle.corkSeatTime);
  clearBanner();
  window.setTimeout(() => {
    if (!S.cleared) return;
    clearedBanner(S.shelf[S.shelf.length - 1]);
    countUp(shownScore, S.score, 0.9, 'score');
    shownScore = S.score;
  }, 450);
  // the corked bottle slides off along the rail toward the shelf, then the next tray pours in
  bottle.exitAt(bottle.corkSeatTime + 0.75);
  window.setTimeout(bumpShelf, (bottle.corkSeatTime + 1.1 - t) * 1000);
  pendingNext = bottle.corkSeatTime + 1.2;
}

function maybeNextLevel(t: number): void {
  if (pendingNext !== null && t >= pendingNext) {
    pendingNext = null;
    nextLevel();
  }
}

// ---------------------------------------------------------------- banners: the level coming in, the bottle corked

let bannerTimer = 0;

function banner(stars: number | null, title: string, sub: string, ms: number, kind: 'level' | 'clear'): void {
  const el = $('banner');
  const s = $('bannerStars');
  s.hidden = stars === null;
  if (stars !== null) {
    s.innerHTML = [0, 1, 2].map((k) => `<i class="${k < stars ? 'on' : ''}" style="animation-delay:${0.08 + k * 0.14}s">★</i>`).join('');
  }
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;
  $('bannerSub').hidden = !sub;
  el.className = `banner ${kind}`;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

function clearBanner(): void {
  clearTimeout(bannerTimer);
  $('banner').classList.remove('show');
}

/** As a level pours in: its number, par and the moves it brought. Notes a bigger tray or a new color. */
function levelBanner(prev: { cols: number; rows: number; colors: number } | null): void {
  const { cols, rows } = S.cur.board;
  const colors = S.pick.entry.colors;
  let sub = prev ? `par ${S.par} · +${S.grant} moves` : `par ${S.par} · ${S.pool.moves} moves`;
  if (prev && (cols !== prev.cols || rows !== prev.rows) && cols * rows > prev.cols * prev.rows) sub = `A bigger tray! ${sub}`;
  else if (prev && colors > prev.colors) sub = `A new color! ${sub}`;
  else if (prev && cols * rows < prev.cols * prev.rows) sub = `A little one · ${sub}`;
  banner(null, `Level ${S.n}`, sub, 1700, 'level');
}

function clearedBanner(k: Keepsake | undefined): void {
  if (!k) return;
  const verdict = k.lifts < k.par ? 'Beat par!' : k.lifts === k.par ? 'Par!' : `${k.lifts - k.par} over par`;
  let sub = `${verdict} · ${k.lifts} ${k.lifts === 1 ? 'lift' : 'lifts'}, par ${k.par}`;
  if (newBestShown === false && best > 0 && S.score > bestAtRunStart) {
    newBestShown = true;
    sub += ' · New best!';
  }
  if (k.spare > 0) sub += ` · ${k.spare} spare ${k.spare === 1 ? 'move' : 'moves'} became a ribbon`;
  banner(k.stars, `+${fmt(k.points)} points`, sub, 2600, 'clear');
}

// ---------------------------------------------------------------- the shelf

function bumpShelf(): void {
  const b = $('shelfBtn');
  $('shelfCount').textContent = String(S.shelf.length);
  $('shelfCount').hidden = S.shelf.length === 0;
  b.classList.remove('bump');
  void b.offsetWidth;
  b.classList.add('bump');
}

function openShelf(): void {
  audio.unlock();
  more.open = false;
  renderShelf($('shelfGrid'), $('shelfNote'), $('shelfDetail'), S.shelf);
  $('shelf').hidden = false;
  $('shelfClose').focus();
}

function closeShelf(): void {
  $('shelf').hidden = true;
}

// ---------------------------------------------------------------- drawing

function drawSettled(b: Board, glowAt: (i: number) => number, liftAt?: (i: number) => number): void {
  const { cols, cells } = b;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === EMPTY) continue;
    const c = i % cols;
    const r = (i / cols) | 0;
    const z = liftAt ? liftAt(i) : 0;
    blocks.block({ x: T.cellX(c), y0: T.cellY(r) - BLOCK / 2, h: 1, color: v, glow: glowAt(i), z, sx: 1 + z * 0.25, sz: 1 + z * 0.25 });
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
  else {
    const hv = hover ? new Set(hover) : null;
    drawSettled(S.cur.board, (i) => (hv && hv.has(i) ? 0.22 : 0));
  }
  drawFlights(t);
  blocks.end(0.5);

  bottle.update(t);
  T.moveBottleShadow(bottle.offset.x, bottle.offset.y);
  grains.update(t);
  T.tick(t);
  maybeCork(t);
  maybeNextLevel(t);
  if (S.over && !overShown && !pour && !flights.length && !fillIn) showOver();
  T.render();
  const cost = performance.now() - t0;
  jsCost = jsCost * 0.95 + cost * 0.05;
  if (costLog.length < 5000) costLog.push(cost);
  if (showFps && frameIdx % 15 === 0) drawFps();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input: tap to lift

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  audio.unlock();
  if (pour || fillIn) {
    fastForward();
    return;
  }
  if (S.cleared) {
    // a tap after the last lift hurries things along: finish the pour, then skip ahead to the next level
    fastForward();
    return;
  }
  if (S.over) return;
  const cell = T.pick(e.clientX, e.clientY);
  if (cell === null || S.cur.board.cells[cell] === EMPTY) return;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* fine */
  }
  press = { pointerId: e.pointerId, cell, group: groupAt(S.cur.board, cell) };
  hover = null;
});

canvas.addEventListener('pointermove', (e) => {
  if (press && e.pointerId === press.pointerId) {
    // sliding off the group before letting go cancels the tap
    const cell = T.pick(e.clientX, e.clientY);
    if (cell === null || !press.group.includes(cell)) press = null;
    return;
  }
  if (e.pointerType !== 'mouse' || pour || S.cleared) {
    hover = null;
    return;
  }
  const cell = T.pick(e.clientX, e.clientY);
  hover = cell !== null && S.cur.board.cells[cell] !== EMPTY ? groupAt(S.cur.board, cell) : null;
  canvas.style.cursor = hover ? 'pointer' : 'default';
});

canvas.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.pointerId) return;
  const cell = T.pick(e.clientX, e.clientY);
  const target = press.cell;
  const ok = cell !== null && press.group.includes(cell);
  press = null;
  if (ok) doLift(target);
});
canvas.addEventListener('pointercancel', () => {
  press = null;
});
canvas.addEventListener('pointerleave', () => {
  hover = null;
});
// ---------------------------------------------------------------- HUD

const fmt = (v: number) => v.toLocaleString('en-US');

function updateHud(): void {
  if (!$('moves').classList.contains('pour')) $('moves').textContent = String(S.pool.moves);
  $('movesLabel').textContent = S.pool.moves === 1 ? 'move left' : 'moves left';
  $('levelNum').textContent = `Level ${S.n}`;
  // moves made on this tray next to its par
  $('used').textContent = String(S.lifts);
  $('par').textContent = String(S.par);
  $('levelLabel').classList.toggle('over', S.lifts > S.par);
  if (!$('score').classList.contains('pour')) $('score').textContent = fmt(shownScore);
  $('best').textContent = `best ${fmt(Math.max(best, S.score))}`;
  $('movesPill').classList.toggle('low', S.pool.moves <= 3 && !S.cleared);
  setHint('');
}

const HOW = 'Tap a block to lift its group.';
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

function layout(): void {
  const hud = $('hud').getBoundingClientRect();
  const bar = $('bar').getBoundingClientRect();
  const H = window.innerHeight;
  // the bottle sits centered on top and the header's chips sit either side of it, so the scene can use their height
  const top = hud.top + parseFloat(getComputedStyle($('hud')).paddingTop);
  T.frame({ top: Math.max(8, top), bottom: H - bar.top + 6, side: 4 });
  const vp = T.viewport;
  grains.setScale(vp.h * T.renderer.getPixelRatio(), T.fov);
  // banners sit in the middle of the tray
  const mid = T.toScreen(new THREE.Vector3(0, T.rows / 2, 0));
  document.documentElement.style.setProperty('--banner-y', `${Math.round(mid.y)}px`);
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
let overArmed = 0;
$('startOver').onclick = () => {
  // two taps, so a stray one can't end her run; the shelf of bottles and the high score stay
  if (!overArmed) {
    $('startOver').textContent = 'Tap again to start a new run';
    overArmed = window.setTimeout(() => {
      overArmed = 0;
      $('startOver').textContent = 'New run from level 1';
    }, 3000);
    return;
  }
  clearTimeout(overArmed);
  overArmed = 0;
  $('startOver').textContent = 'New run from level 1';
  more.open = false;
  newRun();
};

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
  pendingTap = think > 60000 ? null : { n: S.n, c: S.cur.board.cols, r: S.cur.board.rows, think, anim: 0, at };
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

$('againBtn').onclick = () => {
  audio.unlock();
  newRun();
};
$('overShelf').onclick = openShelf;
$('shelfBtn').onclick = openShelf;
$('shelfClose').onclick = closeShelf;
$('shelf').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeShelf();
});
$('startBtn').onclick = () => {
  audio.unlock();
  $('intro').hidden = true;
  if (tierChoice === 'auto') tierCheck = { until: performance.now() + 2000, sum: 0, count: 0 };
  levelBanner(null);
};
// her progress is saved after every move; this catches anything in flight when the page goes away
window.addEventListener('pagehide', persist);

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);

showBoard();
bumpShelf();
$('shelfBtn').classList.remove('bump');
if (resumed && S.over) {
  // closed on the final board of a run: show how it ended
  $('intro').hidden = true;
} else if (resumed) {
  $('introTitle').textContent = 'Welcome back';
  $('introText').textContent = `You're on level ${S.n} with ${fmt(S.score)} points` + (best > S.score ? `. Your best is ${fmt(best)}.` : '.');
  $('introSmall').textContent = S.taps.length ? 'Your tray is just as you left it.' : 'The next tray is ready.';
  $('startBtn').textContent = 'Keep playing';
}
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
  board: () => ({ cols: S.cur.board.cols, rows: S.cur.board.rows, cells: Array.from(S.cur.board.cells) }),
  busy: () => !!pour || flights.length > 0 || !!fillIn,
  level: () => S.n,
  moves: () => S.pool.moves,
  /** Is a S.cleared level on its way out (cork, bottle exit) before the next one pours in? */
  advancing: () => S.cleared || pendingNext !== null,
  frames: () => Array.from(frameTimes.slice(0, Math.min(frameIdx, frameTimes.length))),
  jsCost: () => jsCost,
  renderInfo: () => ({ calls: T.renderer.info.render.calls, triangles: T.renderer.info.render.triangles, points: T.renderer.info.render.points }),
  costs: () => costLog.slice(),
  setTier: (name: TierName) => {
    tierChoice = name;
    setTier(TIERS[name]);
  },
  start: (num: number) => startBoard(num, true),
  shelf: () => S.shelf.length,
  par: () => S.par,
  taps: () => S.taps.slice(),
  score: () => S.score,
  best: () => best,
  over: () => S.over,
  overShown: () => !$('over').hidden,
  save: () => store.get(SAVE_KEY),
  dismissIntro: () => $('startBtn').click(),
  /** Freeze the scene clock (seconds) for frame-exact screenshots; null resumes. */
  freeze: (t: number | null) => {
    clockOverride = t;
  },
  now: () => now(),
  solution: () => S.knownFinish() ?? [],
  fastForward: () => fastForward(),
  cellScreen: (i: number) => T.toScreen(new THREE.Vector3(T.cellX(i % T.cols), T.cellY((i / T.cols) | 0), BLOCK / 2)),
  grains: () => ({ busyUntil: grains.busyUntil, cap: grains.capacity }),
};
