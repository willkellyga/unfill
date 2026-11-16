import './fonts.css';
import './style.css';
import * as THREE from 'three';
import {
  EMPTY,
  Session,
  TutorialSession,
  DailySession,
  dailyNumber,
  dailyPuzzle,
  isPerfect,
  localYmd,
  shareText,
  streaks,
  type DailyPool,
  type DailyRecord,
  type DailySave,
  countBlocks,
  groupAt,
  type Board,
  type Keepsake,
  attachParCurves,
  type Library,
} from '../../core';
import libraryText from '../../library/boards.json?raw';
import curvesText from '../../library/par-curves.json?raw';
import dailyText from '../../library/daily.json?raw';
import { Audio } from './audio';
import { Blocks } from './blocks';
import { groupMasks } from './merged';
import { Bottle } from './bottle';
import { Grains } from './grains';
import { DAILY_SAND, SAND, sandColor, sandHex, SAND_PITCH, usePalette } from './palette';
import { FIRM, fallTime, planPour, type PourPlan } from './pour';
import {
  decodeProgress,
  encodeProgress,
  parsePatternMode,
  parseReducedMotion,
  patternFor,
  type PatternMode,
} from './prefs';
import { COLLECTOR_URL, DEVICE_KEY, Playtest, type Outcome } from './playtest';
import { browserKind, homeCardHtml } from './homecard';
import { initPwa, installState } from './pwa';
import { isLandscape, isPhone, lockPortrait, preventZoom, resetZoom } from './orientation';
import { SLOW_FRAME_MS, TIERS, type Tier, type TierName } from './quality';
import { BLOCK, BOTTLE_SCALE, Terrarium } from './scene';
import { renderShelf } from './shelf';
import { goalHtml, goalLabel } from './hud';
import { calendarHtml, describeRecord, monthOf, monthTitle, niceDate, shiftMonth, squaresHtml, statsHtml, untilMidnight } from './dailyui';

// ---------------------------------------------------------------- setup

const library: Library = JSON.parse(libraryText);
/** Boards with each one's typical-player par curve (milestone 7: par is set from bot runs). */
const boards = attachParCurves(library.boards, JSON.parse(curvesText));

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
const blocks = new Blocks(T, tier.blockSegments);
blocks.setShadows(tier.shadows);
T.scene.add(blocks.mesh, blocks.ghostMesh);
const bottle = new Bottle();
bottle.setScale(BOTTLE_SCALE);
T.scene.add(bottle.group);
const audio = new Audio(store.get('unfill-muted') === '1');

// milestone 6 settings: color-blind patterns, reduced motion (follows the phone until she flips it), vibration
let patterns: PatternMode = parsePatternMode(store.get('unfill-patterns'));
const systemReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let reduced = parseReducedMotion(store.get('unfill-motion'), !!systemReduced?.matches);
let vibrate = store.get('unfill-vibrate') !== '0';
function applyLook(): void {
  blocks.patterns = patterns;
  bottle.reduced = reduced;
  document.documentElement.classList.toggle('reduced', reduced);
}
applyLook();
systemReduced?.addEventListener?.('change', () => {
  if (store.get('unfill-motion') !== null) return; // she chose for herself
  reduced = systemReduced.matches;
  applyLook();
  syncSettings();
});

function setTier(t: Tier): void {
  tier = t;
  T.setTier(t);
  blocks.setSegments(t.blockSegments);
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
  /** Reduced motion: shrinks away in place instead of flying. */
  quick?: boolean;
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
/** The view size the camera was last framed for (see syncView). */
let framedFor = '';
/** A phone is held sideways and the upright card is up (checkUpright). */
let sideways = false;
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
/** `?daily=N` opens Daily #N straight away, for testing, without recording it or touching her saved game. */
const dailyParam = Number(params.get('daily')) || 0;
const ephemeral = trayParam > 0 || dailyParam > 0 || params.has('nosave');

declare const __BUILD__: string;
/**
 * Portal build (`npm run build:crazygames`, for CrazyGames' Basic Launch): no playtest upload, no home-screen app or
 * service worker, no "add to home screen" card, no portrait lock (the portal asks players to rotate), straight into
 * play with no start card, and the wide layout on landscape screens. `?portal` previews it on any build.
 */
declare const __PORTAL__: boolean;
const portalParam = params.has('portal');
const portal = __PORTAL__ || portalParam;
if (portal) document.documentElement.classList.add('portal');
/**
 * Playtest upload: each finished level goes to Will's Sheet (playtest.ts). Not from test links, and not from scripted
 * browsers (the perf and loop checks) unless they name a collector with `?collector=`.
 */
const playtest =
  __PORTAL__ || portalParam || ephemeral
  ? null
  : new Playtest({
      store,
      url: params.get('collector') ?? (navigator.webdriver ? '' : COLLECTOR_URL),
      app: __BUILD__,
      online: () => navigator.onLine !== false,
      later: (fn, ms) => window.setTimeout(fn, ms),
    });
// a link like ?tester=Mom names the tester on this phone
if (playtest && params.get('tester')) playtest.name = params.get('tester')!;

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
let S: Session = Session.restore(boards, loadJson(SAVE_KEY), shelfAtLoad) as Session;
/** Was there a game in progress to come back to? */
const resumed = !!S;
if (!S) {
  // `?seed=N` (testing, with ?tray) picks the same boards every load, for side-by-side screenshots
  S = new Session(boards, Number(params.get('seed')) || newSeed(), shelfAtLoad);
  S.begin(trayParam || 1, true);
} else if (S.cleared) {
  // closed during the clear: the bottle is already on the shelf, so carry on to the next level
  S.next();
}

// ---------------------------------------------------------------- the first-play lesson (state; the rest is further down)

const LESSON_KEY = 'unfill-lesson-done';
/** The lesson being played, swapped in for the run's session (which waits in `runS`), or null. */
let lesson: TutorialSession | null = null;
let runS: Session | null = null;
// players from before the lesson existed already know how to play
if (!ephemeral && store.get(LESSON_KEY) === null && (shelfAtLoad.length > 0 || (resumed && (S.n > 1 || S.taps.length > 0))))
  store.set(LESSON_KEY, '1');
/** New players get the lesson when they tap Begin. `?lesson` shows it any time; test links and scripted browsers skip it. */
const firstPlay = params.has('lesson') || (!ephemeral && !navigator.webdriver && store.get(LESSON_KEY) === null);
/** The run's session, even while the lesson is on screen. */
const run = (): Session => runS ?? S;

// ---------------------------------------------------------------- the Daily Puzzle: state and storage

const DAILY_KEY = 'unfill-daily';
const dailyPool: DailyPool = JSON.parse(dailyText);
/** Her daily results (first tries only, by daily number) and a first try in progress, if she left one. */
interface DailyStore {
  v: 1;
  records: Record<number, DailyRecord>;
  cur: DailySave | null;
}
function loadDaily(): DailyStore {
  const d = loadJson(DAILY_KEY) as DailyStore | null;
  const records: Record<number, DailyRecord> = {};
  if (d && d.records && typeof d.records === 'object') {
    for (const [k, r] of Object.entries(d.records)) {
      if (r && Number.isInteger(r.n) && r.n === Number(k) && Array.isArray(r.layers) && typeof r.cleared === 'boolean') records[r.n] = r;
    }
  }
  const cur = d && d.cur && Number.isInteger(d.cur.n) && Array.isArray(d.cur.taps) ? d.cur : null;
  return { v: 1, records, cur };
}
const daily: DailyStore = loadDaily();
function saveDaily(): void {
  if (!ephemeral) store.set(DAILY_KEY, JSON.stringify(daily));
}
/** Today's daily number, from her own calendar day (a clock set before Daily #1 still gets #1). */
const todayN = () => Math.max(1, dailyNumber(localYmd(new Date()), dailyPool.epoch));
const isDaily = (s: Session): s is DailySession => s instanceof DailySession;
/** The daily just finished, for the result card. */
let dailyResult: { record: DailyRecord; practice: boolean } | null = null;

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
  if (isDaily(S)) {
    showDailyDone();
    return;
  }
  clearBanner();
  const levels = S.n - 1;
  $('overText').textContent =
    `You scored ${fmt(S.score)} points` + (levels > 0 ? ` over ${levels} ${levels === 1 ? 'level' : 'levels'}.` : '.');
  const isBest = S.score > 0 && S.score >= best && S.score > bestAtRunStart;
  $('overBest').textContent = isBest ? 'A new high score!' : `High score: ${fmt(best)}`;
  $('overBest').classList.toggle('best', isBest);
  // a run that ends is a good moment for today's Daily, if it's still to play
  $('overDaily').hidden = ephemeral || !!daily.records[todayN()];
  $('over').hidden = false;
  $('againBtn').focus();
}

function newRun(): void {
  if (lesson) endLesson();
  // from a daily, the daily's first try stays saved to finish later; the run that was set aside is the one replaced
  if (isDaily(S)) {
    S = runS!;
    runS = null;
    setMood('day');
    $('dailyDone').hidden = true;
  }
  // leaving a level part way through for a new run (from Settings)
  if (!S.over && !S.cleared) logLevelEnd('quit');
  $('over').hidden = true;
  overShown = false;
  bestAtRunStart = best;
  newBestShown = false;
  S = new Session(boards, newSeed(), S.shelf);
  shownScore = 0;
  startBoard(1, true);
}

function persist(): void {
  if (ephemeral || lesson) return;
  if (isDaily(S)) {
    // only a first try is kept to come back to; practice starts fresh each time and leaves it alone
    if (S.practice) return;
    daily.cur = S.cleared || S.over ? null : S.toDailySave();
    saveDaily();
  } else store.set(SAVE_KEY, JSON.stringify(S.toSave()));
}
function persistShelf(): void {
  if (!ephemeral && !lesson) store.set(SHELF_KEY, JSON.stringify(run().shelf));
}

/** The level on screen ended (cleared, out of moves, or left for a new run): its row goes to the playtest outbox. */
function logLevelEnd(outcome: Outcome, points?: number): void {
  if (!playtest || lesson) return;
  const e = S.pick.entry;
  const st = installState();
  // daily plays are tagged by role ("daily" for the first try, "daily-practice" after), with n the daily's number
  const role = isDaily(S) ? (S.practice ? 'daily-practice' : 'daily') : S.pick.slot.role;
  playtest.levelEnded({
    outcome,
    run: S.seed,
    n: S.n,
    board: e.id,
    role,
    tier: e.tier,
    cols: e.cols,
    rows: e.rows,
    colors: e.colors,
    solverPar: e.par,
    par: S.par,
    grant: S.grant,
    movesStart: S.pool.atBoardStart,
    movesLeft: S.pool.moves,
    lifts: S.lifts,
    points,
    score: isDaily(S) ? undefined : S.score,
    taps: S.taps.slice(),
    mirror: S.pick.transform.mirror,
    perm: S.pick.transform.perm.slice(),
    installed: st.standalone,
    ios: st.ios,
  });
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
  syncCoach();
  readyAt = performance.now();
  persist();
  if (!S.over && !lesson) playtest?.levelStarted(S.seed, S.n, S.pick.entry.id, S.pool.atBoardStart);
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
  if (lesson && lesson.isLast) return finishLesson();
  const prev = { cols: S.cur.board.cols, rows: S.cur.board.rows, colors: S.pick.entry.colors };
  const { before } = S.next();
  showBoard();
  const t = now();
  bottle.enterAt(t);
  fillIn = planFillIn(S.cur.board, t + 0.15);
  countUp(before, S.pool.moves, 0.9);
  if (!lesson) levelBanner(prev);
}

// ---------------------------------------------------------------- the next level pours in

interface FillIn {
  blocks: { cell: number; color: number; t0: number; t1: number; drop: number }[];
  end: number;
  /** Reduced motion: blocks grow in place, bottom rows first, instead of falling in. */
  quick?: boolean;
}

/**
 * The new tray's sand pours in through the top of the glass, like a falling stack: bottom rows first, in a quick
 * ripple across the columns. Every block starts just above the inner top (hidden under the rail) and falls under
 * the same gravity, so blocks in one column keep a block's gap between them.
 */
function planFillIn(b: Board, t0: number): FillIn {
  const { cols, rows, cells } = b;
  if (reduced) {
    const list: FillIn['blocks'] = [];
    for (let r = rows - 1; r >= 0; r--)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (cells[i] === EMPTY) continue;
        const s = t0 + (rows - 1 - r) * 0.025;
        list.push({ cell: i, color: cells[i], t0: s, t1: s + 0.2, drop: 0 });
      }
    const end = t0 + (rows - 1) * 0.025 + 0.2;
    audio.hiss([[t0 - now(), 0.3], [end - now(), 0]], 3000, 0.2);
    return { blocks: list, end, quick: true };
  }
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
    if (f.quick) {
      const s = easeOut(clamp((t - k.t0) / (k.t1 - k.t0), 0, 1));
      blocks.block({ x: T.cellX(c), y0: T.cellY(r) - (BLOCK * s) / 2, h: 1, sx: s, sy: s, sz: s, color: k.color });
      if (s >= 1) landed[k.cell] = k.color;
      continue;
    }
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
  blocks.joinSettled(cols, T.rows, (i) => landed[i]);
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
  bottle.setScale(T.bottleScale);
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
  pour = planPour(before.board, before.ids, res.group, res.trace!.steps[0] ?? [], t0 + (reduced ? 0.1 : 0.12), reduced);
  if (!reduced) launchPourGrains(pour);
  pourSound(pour, t0);
  buzz();

  const total = S.total;
  if (reduced) {
    // reduced motion: the group fades where it is and its layer fades up in the bottle; nothing flies
    const f = quickFlight(res.group, before.board.cols, color, t0);
    flights.push(f);
    const fillFrom = bottle.layerCount ? Math.min(1, (total - countBlocks(before.board)) / total) : 0;
    bottle.addLayer(sandColor(color), res.group.length / total, t0 + 0.08, t0 + 0.34);
    audio.thup(res.group.length);
    audio.bottlePour(0.05, 0.3, fillFrom, Math.min(1, fillFrom + res.group.length / total), SAND_PITCH[color % 5]);
    afterLift(out);
    return;
  }

  // the group's flight to the bottle and the layer it pours
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
  afterLift(out);
}

function afterLift(out: { keepsake?: Keepsake | null }): void {
  if (isDaily(S)) {
    if (S.cleared || S.over) {
      logLevelEnd(S.cleared ? 'clear' : 'out');
      finishDaily(S);
    }
    persist();
    updateHud();
    return;
  }
  if (out.keepsake) logLevelEnd('clear', out.keepsake.points);
  else if (S.over) logLevelEnd('out');
  if (out.keepsake && !lesson) {
    persistShelf();
    if (S.score > best) {
      best = S.score;
      if (!ephemeral) store.set(BEST_KEY, String(best));
    }
  }
  persist();
  updateHud();
}

/**
 * A light tap on each lift. Android browsers have navigator.vibrate. iPhone Safari has no vibration API, but from
 * iOS 18 toggling a switch-style checkbox plays the system's selection tick, so a hidden one is flipped instead
 * (only works inside a tap, which is where lifts happen).
 */
let hapticLabel: HTMLLabelElement | null = null;
function buzz(): void {
  if (!vibrate) return;
  if (typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(8);
    } catch {
      /* ignore */
    }
    return;
  }
  if (!hapticLabel) {
    hapticLabel = document.createElement('label');
    hapticLabel.setAttribute('aria-hidden', 'true');
    hapticLabel.className = 'haptic';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    hapticLabel.appendChild(input);
    document.body.appendChild(hapticLabel);
  }
  hapticLabel.click();
}

/** Reduced motion's stand-in for a flight: the group glows, then shrinks away in place. */
function quickFlight(group: number[], cols: number, color: number, t0: number): Flight {
  const f = makeFlight(group, cols, color, t0);
  f.quick = true;
  f.arrive = t0 + 0.05;
  f.done = t0 + 0.3;
  return f;
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
  if (!reduced) launchSparkle(bottle.corkSeatTime);
  clearBanner();
  window.setTimeout(() => {
    if (!S.cleared || lesson || isDaily(S)) return;
    clearedBanner(S.shelf[S.shelf.length - 1]);
    countUp(shownScore, S.score, 0.9, 'score');
    shownScore = S.score;
  }, 450);
  // the corked bottle slides off along the rail toward the shelf, then the next tray pours in
  bottle.exitAt(bottle.corkSeatTime + 0.75);
  if (!lesson) window.setTimeout(isDaily(S) ? bumpDaily : bumpShelf, (bottle.corkSeatTime + 1.1 - t) * 1000);
  pendingNext = bottle.corkSeatTime + 1.2;
}

function maybeNextLevel(t: number): void {
  if (pendingNext !== null && t >= pendingNext) {
    pendingNext = null;
    if (isDaily(S)) showDailyDone();
    else nextLevel();
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
  if (isDaily(S)) {
    const p = S.puzzle;
    banner(null, `Daily #${p.n}`, S.practice ? `Practice · ${p.allowed} moves` : `${p.dayName} · ${S.pool.moves} moves left`, 1700, 'level');
    return;
  }
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
  $('shelfCount').textContent = String(run().shelf.length);
  $('shelfCount').hidden = run().shelf.length === 0;
  b.classList.remove('bump');
  void b.offsetWidth;
  b.classList.add('bump');
}

function openShelf(): void {
  audio.unlock();
  more.open = false;
  renderShelf($('shelfGrid'), $('shelfNote'), $('shelfDetail'), run().shelf);
  $('shelf').hidden = false;
  $('shelfClose').focus();
}

function closeShelf(): void {
  $('shelf').hidden = true;
}

// ---------------------------------------------------------------- the Daily Puzzle: playing it

/** The everyday room and sands, or the Daily Puzzle's dusk room and its own sands. */
function setMood(kind: 'day' | 'daily'): void {
  usePalette(kind);
  T.setMood(kind);
  document.body.classList.toggle('dailyMode', kind === 'daily');
  if (more.open) renderPatKey();
}

/**
 * Put a daily on the table: today's first try, a practice replay, or a first try she left part way (`resume`). The
 * run is set aside just as it is and comes back with "Back to run".
 */
function enterDaily(n: number, practice: boolean, resume?: DailySave): void {
  if (lesson) return;
  audio.unlock();
  $('daily').hidden = true;
  $('dailyDone').hidden = true;
  $('over').hidden = true;
  $('intro').hidden = true;
  const was = S;
  if (!isDaily(was)) {
    // a run level that was just cleared goes on to its next level first, so the run comes back ready to play
    if (S.cleared) {
      pendingNext = null;
      S.next();
    }
    persist();
    runS = S;
  } else if (!was.cleared && !was.over && !was.practice) {
    persist();
  }
  const puzzle = dailyPuzzle(dailyPool, boards, n);
  let D = resume ? DailySession.restoreDaily(boards, puzzle, resume) : null;
  if (!D) {
    D = new DailySession(boards, puzzle, practice);
    D.begin();
  }
  S = D;
  overShown = false;
  dailyResult = null;
  setMood('daily');
  showBoard();
  const t = now();
  bottle.enterAt(t);
  if (!D.lifts) fillIn = planFillIn(S.cur.board, t + 0.15);
  const p = D.puzzle;
  const sub = D.practice ? `Practice · ${p.allowed} moves` : `${p.dayName} · ${p.allowed} moves`;
  banner(null, `Daily #${p.n}`, D.lifts ? `${p.dayName} · just as you left it` : sub, 2200, 'level');
}

/** Back from a daily to the run, just as it was. */
function leaveDaily(): void {
  if (!isDaily(S) || !runS) return;
  if (!S.cleared && !S.over) persist();
  $('daily').hidden = true;
  $('dailyDone').hidden = true;
  S = runS;
  runS = null;
  overShown = false;
  setMood('day');
  showBoard();
  const t = now();
  bottle.enterAt(t);
  if (!S.lifts) fillIn = planFillIn(S.cur.board, t + 0.15);
  shownScore = S.score;
  levelBanner(null);
  updateHud();
}

/** A daily ended (cleared, or out of moves): a first try is recorded for good; practice never changes it. */
function finishDaily(D: DailySession): void {
  const record = D.record(Date.now());
  if (!D.practice && !ephemeral && !daily.records[record.n]) daily.records[record.n] = record;
  if (!D.practice) daily.cur = null;
  saveDaily();
  dailyResult = { record, practice: D.practice };
}

/** The reveal: "Best possible was X", and whether she earned the Perfect. */
function showDailyDone(): void {
  if (!dailyResult || !isDaily(S)) return;
  const { record: r, practice } = dailyResult;
  const p = S.puzzle;
  const first = daily.records[r.n];
  const perfect = isPerfect(r);
  const card = $('dailyDone');
  card.classList.toggle('perfect', perfect);
  $('doneKicker').textContent = practice ? `Practice · Daily #${r.n}` : `Daily #${r.n} · ${p.dayName}`;
  $('doneTitle').textContent = !r.cleared ? 'Out of moves' : perfect ? 'Perfect!' : 'Cleared!';
  $('doneReveal').innerHTML = `Best possible was <b>${r.best}</b>`;
  let text: string;
  if (!r.cleared) text = `Sand left after ${r.lifts} lifts.`;
  else if (perfect) text = `Matched in ${r.lifts} lifts 🏆`;
  else text = `You took ${r.lifts}, ${r.lifts - r.best} over.`;
  if (practice && first) text += ` First try: ${first.cleared ? first.lifts : 'out of moves'}.`;
  $('doneText').textContent = text;
  $('doneSquares').innerHTML = squaresHtml(r);
  const st = streaks(daily.records, todayN());
  const next = `next in ${untilMidnight(new Date())}`;
  $('doneSmall').textContent = practice
    ? `Practice · ${next}`
    : ephemeral
      ? 'Test link: not recorded.'
      : `${st.current ? `${st.current}-day streak · ` : ''}${next}`;
  $('doneShare').hidden = !first;
  $('doneBack').hidden = !runS;
  card.hidden = false;
  if (perfect && !practice) audio.chime(0.1);
  (first ? $('doneShare') : $('doneCalendar')).focus();
}

/** Share her first try at a daily, Wordle style: the share sheet on a phone, the clipboard elsewhere. */
async function shareDaily(r: DailyRecord): Promise<void> {
  // on a portal the page's own address is the bare game file, not somewhere to send friends
  const url = portal ? '' : location.origin + location.pathname;
  const text = shareText(r, dailyPuzzle(dailyPool, boards, r.n).dayName, /^https?:/.test(url) ? url : '');
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
  if (nav.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ text });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied: paste it in a message');
  } catch {
    toast('Copying is blocked here');
  }
}

// ---------------------------------------------------------------- the Daily Puzzle: its screen and calendar shelf

let calMonth: [number, number] | null = null;

function openDaily(): void {
  if (lesson) return;
  audio.unlock();
  more.open = false;
  closeShelf();
  calMonth = monthOf(todayN(), dailyPool.epoch);
  renderDaily();
  $('daily').hidden = false;
}

/** Closing the daily screen after a finished daily goes back to the run: there's nothing left on the table. */
function closeDaily(): void {
  $('daily').hidden = true;
  if (isDaily(S) && (S.cleared || S.over) && runS) leaveDaily();
}

function renderDaily(): void {
  const today = todayN();
  const p = dailyPuzzle(dailyPool, boards, today);
  const rec = daily.records[today];
  $('dailyNote').textContent = `#${today} · ${niceDate(p.ymd)}`;
  const D = isDaily(S) ? S : null;
  const playing = !!D && D.puzzle.n === today && !D.cleared && !D.over;
  const left = !playing && daily.cur && daily.cur.n === today && !daily.cur.practice && !rec;
  const tray = `${p.board.cols}×${p.board.rows} · ${p.entry.colors} colors · ${p.allowed} moves`;
  let html: string;
  if (playing) {
    html =
      `<h3>${p.dayName}’s Daily</h3><p>${tray}</p>` +
      `<button type="button" class="primary" data-act="close">${D?.practice ? 'Back to practice' : 'Keep going'}</button>`;
  } else if (left) {
    html = `<h3>${p.dayName}’s Daily</h3><p>${tray}</p><button type="button" class="primary" data-act="resume">Keep going</button>`;
  } else if (!rec) {
    html =
      `<h3>${p.dayName}’s Daily</h3><p>${tray}</p>` +
      `<p class="small">Fewest lifts wins. Match the best for a 🏆</p>` +
      `<button type="button" class="primary" data-act="play">Play</button>`;
  } else {
    const title = !rec.cleared ? 'Out of moves' : isPerfect(rec) ? 'Perfect! 🏆' : `Cleared in ${rec.lifts}`;
    html =
      `<h3>${title}</h3><div class="squares">${squaresHtml(rec)}</div>` +
      `<p>${rec.cleared ? `${rec.lifts} lifts` : 'Ran out of moves'} · best possible ${rec.best}</p>` +
      `<p class="small">Next in ${untilMidnight(new Date())}</p>` +
      `<button type="button" class="primary" data-act="share">Share</button>` +
      `<button type="button" data-act="practice">Practice</button>`;
  }
  if (runS) html += `<button type="button" data-act="back">Back to run</button>`;
  $('dailyToday').innerHTML = html;
  $('dailyStats').innerHTML = statsHtml(daily.records, today);
  const month = calMonth ?? monthOf(today, dailyPool.epoch);
  $('calTitle').textContent = monthTitle(month);
  $('calendar').innerHTML = calendarHtml(daily.records, today, month, dailyPool.epoch);
  const firstMonth = monthOf(1, dailyPool.epoch);
  const lastMonth = monthOf(today, dailyPool.epoch);
  $<HTMLButtonElement>('calPrev').disabled = month[0] * 12 + month[1] <= firstMonth[0] * 12 + firstMonth[1];
  $<HTMLButtonElement>('calNext').disabled = month[0] * 12 + month[1] >= lastMonth[0] * 12 + lastMonth[1];
  const played = Object.keys(daily.records).length;
  $('calDetail').textContent = played ? 'Tap a bottle for details.' : 'Each Daily adds a bottle.';
}

$('dailyToday').onclick = (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  const today = todayN();
  if (act === 'close') closeDaily();
  else if (act === 'play') enterDaily(today, false);
  else if (act === 'resume') enterDaily(today, false, daily.cur ?? undefined);
  else if (act === 'practice') enterDaily(today, true);
  else if (act === 'share' && daily.records[today]) void shareDaily(daily.records[today]);
  else if (act === 'back') leaveDaily();
};
$('calendar').onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
  if (!b) return;
  for (const x of $('calendar').querySelectorAll('.sel')) x.classList.remove('sel');
  b.classList.add('sel');
  const n = Number(b.dataset.n);
  const r = daily.records[n];
  $('calDetail').textContent = r ? describeRecord(r) : b.getAttribute('aria-label') ?? '';
};
$('calPrev').onclick = () => {
  calMonth = shiftMonth(calMonth ?? monthOf(todayN(), dailyPool.epoch), -1);
  renderDaily();
};
$('calNext').onclick = () => {
  calMonth = shiftMonth(calMonth ?? monthOf(todayN(), dailyPool.epoch), 1);
  renderDaily();
};
$('dailyBtn').onclick = openDaily;
$('dailyClose').onclick = closeDaily;
$('daily').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDaily();
});
$('doneShare').onclick = () => {
  const r = dailyResult && daily.records[dailyResult.record.n];
  if (r) void shareDaily(r);
};
$('doneCalendar').onclick = () => {
  $('dailyDone').hidden = true;
  openDaily();
};
$('doneBack').onclick = leaveDaily;

/** A dot on the Daily button while today's is still to play. */
function syncDailyDot(): void {
  const today = todayN();
  $('dailyDot').hidden = ephemeral || !!daily.records[today] || (isDaily(S) && S.puzzle.n === today);
}

function bumpDaily(): void {
  const b = $('dailyBtn');
  b.classList.remove('bump');
  void b.offsetWidth;
  b.classList.add('bump');
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
  blocks.joinSettled(cols, b.rows, (i) => cells[i]);
}

function drawPour(p: PourPlan, t: number): void {
  if (p.quick) return drawQuickPour(p, t);
  const cols = T.cols;
  const rows = T.rows;
  // still blocks, joined into pieces
  const still = new Int8Array(cols * rows).fill(EMPTY);
  for (const [id, cell] of p.still) {
    const color = p.colorOf.get(id)!;
    still[cell] = color;
    blocks.block({ x: T.cellX(cell % cols), y0: T.cellY((cell / cols) | 0) - BLOCK / 2, h: 1, color });
  }
  // landed blocks join the still set once they've firmed up, so pieces knit together as the sand settles
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
  blocks.joinSettled(cols, rows, (i) => still[i]);
}

/** Reduced motion: the blocks that fall shrink away where they were and grow where they land. */
function drawQuickPour(p: PourPlan, t: number): void {
  const cols = T.cols;
  const still = new Int8Array(cols * T.rows).fill(EMPTY);
  for (const [id, cell] of p.still) {
    const color = p.colorOf.get(id)!;
    still[cell] = color;
    blocks.block({ x: T.cellX(cell % cols), y0: T.cellY((cell / cols) | 0) - BLOCK / 2, h: 1, color });
  }
  for (const b of p.blocks) {
    const x = T.cellX(b.col);
    const out = 1 - easeInOut(clamp((t - b.d0) / (b.d1 - b.d0), 0, 1));
    if (out > 0.01) blocks.block({ x, y0: T.cellY(b.fromRow) - (BLOCK * out) / 2, h: 1, sx: out, sy: out, sz: out, color: b.color });
    const inn = easeInOut(clamp((t - b.f0) / (b.f1 - b.f0), 0, 1));
    if (inn > 0.01) blocks.block({ x, y0: T.cellY(b.toRow) - (BLOCK * inn) / 2, h: 1, sx: inn, sy: inn, sz: inn, color: b.color });
    if (inn >= 1) still[b.toRow * cols + b.col] = b.color;
  }
  blocks.joinSettled(cols, T.rows, (i) => still[i]);
}

function drawFlights(t: number): void {
  for (const f of flights) {
    if (f.quick) {
      const k = clamp((t - f.t0) / (f.done - f.t0), 0, 1);
      const s = 1 - easeInOut(k);
      if (s <= 0.01) continue;
      for (const b of f.blocks) blocks.block({ x: b.x, y0: b.y - (BLOCK * s) / 2, h: 1, sx: s, sy: s, sz: s, color: b.color, glow: 0.4 * (1 - k) });
      continue;
    }
    const pose = flightPose(f, t);
    const pourDur = f.done - f.arrive;
    const nb = f.blocks.length;
    // pour in: blocks melt into the mouth one after another
    const meltOf = (k: number) =>
      t > f.arrive ? clamp((t - (f.arrive + (k / nb) * pourDur * 0.6)) / (pourDur * 0.4 + 0.05), 0, 1) : 0;
    // the piece flies as one: blocks stay joined until each starts to melt
    const joins = groupMasks(
      f.blocks.map((b) => ({ x: b.ox, y: b.oy })),
      (k) => meltOf(k) === 0,
    );
    f.blocks.forEach((b, k) => {
      let s = pose.s;
      const melt = meltOf(k);
      if (melt > 0) {
        s *= 1 - melt;
        if (s <= 0.01) return;
      }
      const cs = Math.cos(pose.spin);
      const sn = Math.sin(pose.spin);
      // a joined piece squashes as one (its blocks' spacing too), so no gaps open up inside it
      const whole = joins[k] !== 0;
      const ox = b.ox * pose.s * (whole ? pose.sx : 1);
      const oy = b.oy * pose.s * (whole ? pose.sy : 1);
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
        join: joins[k],
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
  syncView();
  const t0 = performance.now();
  if (sideways) {
    // the upright card covers the tray: nothing to draw, and the frame-rate check starts over once she turns back
    lastFrame = 0;
    if (tierCheck) tierCheck = { until: t0 + 2000, sum: 0, count: 0 };
    requestAnimationFrame(frame);
    return;
  }
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
    // the lesson's next group to lift breathes softly
    const tg = lesson && !S.cleared ? new Set(lesson.target() ?? []) : null;
    const breathe = reduced ? 0.2 : 0.14 + 0.1 * Math.sin(t * 4);
    drawSettled(S.cur.board, (i) => (hv && hv.has(i) ? 0.22 : tg && tg.has(i) ? breathe : 0));
  }
  drawFlights(t);
  blocks.end(0.5);

  bottle.update(t);
  T.moveBottleShadow(bottle.offset.x, bottle.offset.y);
  grains.update(t);
  T.tick(reduced ? 0 : t);
  maybeCork(t);
  maybeNextLevel(t);
  if (S.over && !overShown && !pour && !flights.length && !fillIn) {
    if (lesson) lessonOutOfMoves();
    else showOver();
  }
  placeHand();
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
  if (!ok) return;
  // a guided lesson step only takes the group it's pointing at
  const tg = lesson?.target();
  if (tg && !tg.includes(target)) return nudgeCoach();
  doLift(target);
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
  const D = isDaily(S) ? S : null;
  $('levelWord').textContent = lesson ? 'lesson' : D ? 'daily' : 'level';
  $('levelNum').textContent = D ? `#${D.puzzle.n}` : String(S.n);
  // the moves made on this tray against its par, each as the color it lifted; a daily's best stays hidden until it's done
  const goal = { lifted: S.taps.map((cell, k) => S.history[k].board.cells[cell]), par: S.par, hidden: !!D };
  $('goal').innerHTML = goalHtml(goal);
  $('goal').setAttribute('aria-label', goalLabel(goal));
  $('movesPill').dataset.lifts = String(S.lifts);
  $('movesPill').classList.toggle('overPar', !D && S.lifts > S.par);
  if (D) {
    $('score').textContent = D.practice ? '–' : String(streaks(daily.records, todayN()).current);
    $('best').textContent = D.practice ? 'practice' : 'day streak';
  } else {
    if (!$('score').classList.contains('pour')) $('score').textContent = fmt(shownScore);
    $('best').textContent = `best ${fmt(Math.max(best, run().score))}`;
  }
  syncDailyDot();
  $('movesPill').classList.toggle('low', S.pool.moves <= 3 && !S.cleared && !lesson);
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

/** What the framing depends on: the canvas's real size, the window's, and the pixel density. */
function viewKey(): string {
  return `${canvas.clientWidth}x${canvas.clientHeight} ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`;
}
/**
 * The wide layout (portal builds, or `?wide`): on a landscape screen the level, moves and score stack in a column at the
 * left, the buttons in a column at the right, and the bottle stands on the table beside the tray, so the tray gets
 * the full height of the screen instead of sitting small in the middle with empty sides.
 */
const wideOk = portal || params.has('wide');
function isWide(): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return wideOk && w >= 600 && w >= 1.25 * h;
}

function layout(): void {
  framedFor = viewKey();
  T.renderer.setPixelRatio(Math.min(tier.maxDpr, window.devicePixelRatio || 1));
  const wide = isWide();
  document.documentElement.classList.toggle('wide', wide);
  if (wide !== T.wide) {
    T.setWide(wide);
    placeBottle();
  }
  const view = canvas.getBoundingClientRect();
  if (wide) {
    // the columns' inner edges bound the tray; during the lesson the speech bubble sits under it
    const hud = $('hud').getBoundingClientRect();
    const foot = $('bar').getBoundingClientRect();
    const coach = $('coach');
    const bottom = coach.hidden ? 14 : view.bottom - coach.getBoundingClientRect().top + 8;
    T.frame({ top: 14, bottom, side: 0, left: hud.right - view.left + 10, right: view.right - foot.left + 10 });
    const vp = T.viewport;
    grains.setScale(vp.h * T.renderer.getPixelRatio(), T.fov);
    const mid = T.toScreen(new THREE.Vector3(0, T.rows / 2, 0));
    document.documentElement.style.setProperty('--banner-y', `${Math.round(mid.y)}px`);
    document.documentElement.style.setProperty('--banner-x', `${Math.round(mid.x)}px`);
    return;
  }
  document.documentElement.style.removeProperty('--banner-x');
  const bar = $('bar').getBoundingClientRect();
  // the bottle stands centered under the moves card, with the side chips beside its neck
  const top = $('hudCenter').getBoundingClientRect().bottom - view.top + 4;
  // measured against the canvas, not window.innerHeight, which iOS can report stale for a moment after a rotation
  // during the lesson the speech bubble sits over the buttons, so the tray stays clear of it
  const coach = $('coach');
  const edge = coach.hidden ? bar.top : Math.min(bar.top, coach.getBoundingClientRect().top);
  T.frame({ top: Math.max(8, top), bottom: view.bottom - edge + 6, side: 4 });
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
  $('setFps').setAttribute('aria-checked', String(showFps));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tier]')) {
    b.setAttribute('aria-pressed', String(b.dataset.tier === tierChoice));
  }
  $('tierNote').textContent = tierChoice === 'auto' ? `Auto picked ${tier.label}.` : `${tier.label}, chosen by you.`;
  $('fps').hidden = !showFps;
  $('setVibe').setAttribute('aria-checked', String(vibrate));
  $('vibeNote').textContent =
    typeof navigator.vibrate === 'function' ? 'a light tap with each lift' : 'a light tap with each lift (iPhone: iOS 18 or later)';
  $('setMotion').setAttribute('aria-checked', String(reduced));
  $('motionNote').textContent =
    store.get('unfill-motion') === null
      ? `sand fades into place instead of pouring; following your device (${systemReduced?.matches ? 'on' : 'off'})`
      : 'sand fades into place instead of pouring';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pat]')) {
    b.setAttribute('aria-pressed', String(b.dataset.pat === patterns));
  }
  renderPatKey();
  syncInstall();
  syncPlaytest();
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
$('setVibe').onclick = () => {
  vibrate = !vibrate;
  store.set('unfill-vibrate', vibrate ? '1' : '0');
  syncSettings();
  buzz();
};
$('setMotion').onclick = () => {
  reduced = !reduced;
  store.set('unfill-motion', reduced ? '1' : '0');
  if (reduced) grains.clear();
  applyLook();
  syncSettings();
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pat]')) {
  b.onclick = () => {
    patterns = parsePatternMode(b.dataset.pat ?? null);
    store.set('unfill-patterns', patterns);
    applyLook();
    syncSettings();
  };
}

/** A row of the five sands as they look with the chosen patterns. */
function renderPatKey(): void {
  const el = $('patKey');
  const svgFor = (sand: number): string => {
    const k = patternFor(sand, patterns);
    const fill = sandHex(sand);
    // as in the block shader: dark sands (the daily's indigo) get light marks
    const rgb = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
    const ink = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 0.42 ? 'rgba(255,255,255,0.45)' : 'rgba(70,45,35,0.32)';
    const id = `pk${sand}`;
    const defs = [
      '',
      `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.5" fill="${ink}"/></pattern>`,
      `<pattern id="${id}" width="14" height="7" patternUnits="userSpaceOnUse"><path d="M0 3.5 Q3.5 1.2 7 3.5 T14 3.5" stroke="${ink}" stroke-width="1.6" fill="none"/></pattern>`,
      `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0L7 7M7 0L0 7" stroke="${ink}" stroke-width="0.9"/></pattern>`,
      `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="10" height="2.8" fill="${ink}"/></pattern>`,
    ][k];
    return `<svg viewBox="0 0 28 28" width="28" height="28"><defs>${defs}</defs><rect x="1" y="1" width="26" height="26" rx="7" fill="${fill}"/>${
      k ? `<rect x="1" y="1" width="26" height="26" rx="7" fill="url(#${id})"/>` : ''
    }</svg>`;
  };
  el.innerHTML = [0, 1, 2, 3, 4].map(svgFor).join('');
}

/** The home-screen row: how to install here, or that it's installed and works offline. */
function syncInstall(): void {
  const st = installState();
  const note = $('installNote');
  const row = $('installRow');
  if (portal) {
    row.hidden = true;
    return;
  }
  row.querySelector('.installBtn')?.remove();
  if (st.standalone) {
    note.textContent = st.offlineReady
      ? 'Installed, and it plays offline. Your progress is saved on this phone.'
      : 'Installed. Getting the offline copy ready…';
  } else if (!st.offlineCapable) {
    note.textContent =
      'This preview link can’t be added to the home screen or play offline. Your progress is saved in this browser.';
  } else if (st.prompt) {
    note.textContent = 'Install Unfill as an app. It opens full screen and plays offline.';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'installBtn primary';
    b.textContent = 'Install Unfill';
    b.onclick = () => void st.prompt?.();
    row.appendChild(b);
  } else if (st.ios) {
    note.innerHTML =
      'In Safari, tap <b>Share</b> <span class="shareIcon" aria-label="(the square with an arrow)"></span>, then <b>Add to Home Screen</b>. It opens full screen and plays offline. Your Safari progress doesn’t move over by itself: use “Move your progress” below.';
    showMeHow(row);
  } else if (deviceKind === 'android') {
    note.textContent = 'Add Unfill to your home screen from Chrome’s ⋮ menu. It opens full screen and plays offline.';
    showMeHow(row);
  } else {
    note.textContent = st.offlineReady
      ? 'Ready to play offline in this browser. Use your browser’s “Install” or “Add to Home screen” menu item to make it an app.'
      : 'Use your browser’s “Install” or “Add to Home screen” menu item to make it an app.';
  }
}

function showMeHow(row: HTMLElement): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'installBtn';
  b.textContent = 'Show me how';
  b.onclick = () => {
    more.open = false;
    showHomeCard();
  };
  row.appendChild(b);
}

// ---------------------------------------------------------------- the Add to Home Screen card (first open)

const HOME_KEY = 'unfill-home-asked';
const deviceKind = browserKind(navigator.userAgent, navigator.maxTouchPoints, navigator.platform);
let homeOpen = false;

/** The welcome card: how to add Unfill to the home screen on this phone (homecard.ts). */
function showHomeCard(): void {
  homeOpen = true;
  const st = installState();
  $('homeInner').innerHTML = homeCardHtml({ kind: deviceKind, prompt: st.prompt, hasProgress: resumed || run().shelf.length > 0 });
  $('homeCard').hidden = false;
  const install = document.getElementById('homeInstall');
  if (install)
    install.onclick = async () => {
      await st.prompt?.();
      closeHomeCard();
    };
  $('homeLater').onclick = closeHomeCard;
  $('homeInner').scrollTop = 0;
}
function closeHomeCard(): void {
  homeOpen = false;
  $('homeCard').hidden = true;
}

/**
 * The first time a phone opens the game in its browser (not the home-screen app), show the card once. `?homecard`
 * shows it any time (to preview it); test links and scripted browsers don't get it otherwise.
 */
function maybeAskHome(): void {
  const st = installState();
  if (params.has('homecard')) return showHomeCard();
  if (ephemeral || st.standalone || !st.offlineCapable || deviceKind === 'other' || navigator.webdriver) return;
  if (store.get(HOME_KEY) === '1') return;
  store.set(HOME_KEY, '1');
  showHomeCard();
}

// ---------------------------------------------------------------- playtest: name and what's been sent

function syncPlaytest(): void {
  const row = $('playtestRow');
  row.hidden = !playtest;
  if (!playtest) return;
  const input = $<HTMLInputElement>('testerName');
  if (document.activeElement !== input) input.value = playtest.name;
  const waiting = playtest.outbox().length;
  const sent = playtest.sentCount();
  $('playtestStatus').textContent = !playtest.enabled
    ? `${waiting} ${waiting === 1 ? 'level' : 'levels'} saved to send once Will's collector is set up.`
    : waiting
      ? `${sent} sent, ${waiting} waiting to send${navigator.onLine === false ? ' when you’re back online' : ''}.`
      : `${sent} sent, all up to date.`;
}
$<HTMLInputElement>('testerName').addEventListener('change', (e) => {
  if (!playtest) return;
  playtest.name = (e.target as HTMLInputElement).value;
  syncPlaytest();
});

// ---------------------------------------------------------------- moving her progress (Safari ⇄ home-screen app)

$('copyProgress').onclick = async () => {
  const code = encodeProgress({
    save: run().toSave(),
    shelf: run().shelf,
    best: Math.max(best, run().score),
    daily: { records: daily.records },
    device: playtest?.device,
    name: playtest?.name || undefined,
  });
  try {
    await navigator.clipboard.writeText(code);
    toast('Progress code copied');
  } catch {
    // no clipboard here: show the code so it can be copied by hand
    $('pasteBox').hidden = false;
    $<HTMLTextAreaElement>('pasteCode').value = code;
    $<HTMLTextAreaElement>('pasteCode').select();
    toast('Copy the code in the box');
  }
};
$('pasteToggle').onclick = () => {
  const box = $('pasteBox');
  box.hidden = !box.hidden;
  $('pasteToggle').setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) $('pasteCode').focus();
};
let loadArmed = 0;
$('loadProgress').onclick = () => {
  const p = decodeProgress($<HTMLTextAreaElement>('pasteCode').value);
  const shelf = p ? (p.shelf as Keepsake[]).filter((k) => k && Array.isArray(k.layers) && Number.isInteger(k.n)) : [];
  const restored = p && p.save ? Session.restore(boards, p.save, shelf) : null;
  if (!p || (p.save && !restored)) {
    toast('That code didn’t work. Copy it again and paste the whole thing.');
    return;
  }
  // two taps, because this replaces the game on this device
  if (!loadArmed) {
    $('loadProgress').textContent = `Tap again to load level ${restored ? restored.n : 1}, ${shelf.length} bottles`;
    loadArmed = window.setTimeout(() => {
      loadArmed = 0;
      $('loadProgress').textContent = 'Load this progress';
    }, 4000);
    return;
  }
  clearTimeout(loadArmed);
  loadArmed = 0;
  if (ephemeral) {
    toast('Not in a test link (?tray or ?nosave)');
    return;
  }
  store.set(SAVE_KEY, JSON.stringify(p.save));
  store.set(SHELF_KEY, JSON.stringify(shelf));
  store.set(BEST_KEY, String(Math.max(best, p.best)));
  // daily first tries from the other side join the ones here (a day played on both keeps this side's)
  if (p.daily) {
    const records = { ...(p.daily.records as Record<number, DailyRecord>), ...daily.records };
    store.set(DAILY_KEY, JSON.stringify({ v: 1, records, cur: daily.cur }));
  }
  // the same player on both sides: keep one playtest id (and their name) for Safari and the home-screen app
  if (p.device) store.set(DEVICE_KEY, p.device);
  if (playtest && p.name && !playtest.name) playtest.name = p.name;
  location.reload();
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
  // lesson taps aren't play: not timed, not sent
  if (lesson) return;
  const at = performance.now();
  const think = Math.round(at - readyAt);
  playtest?.tapped(think);
  // a long pause (the phone put down) isn't thinking time
  pendingTap = { n: S.n, c: S.cur.board.cols, r: S.cur.board.rows, think, anim: 0, at };
}

/** The tray is playable again: the pour time is known, so the tap's row is saved. */
function markReady(): void {
  readyAt = performance.now();
  syncCoach();
  if (!pendingTap) return;
  const { at, ...row } = pendingTap;
  row.anim = Math.round(readyAt - at);
  pendingTap = null;
  playtest?.poured(row.anim);
  if (row.think > 60000) return;
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

// ---------------------------------------------------------------- the first-play lesson (core/tutorial.ts)

/**
 * Two little trays before level 1 for a new player, and again from Settings. The run's session waits in `runS`
 * untouched (and its save stays as it was), the lesson's session plays in its place, then the run comes back.
 */
function startLesson(): void {
  if (lesson || isDaily(S)) return;
  pendingNext = null;
  fastForward();
  clearBanner();
  more.open = false;
  closeShelf();
  $('over').hidden = true;
  runS = S;
  lesson = new TutorialSession();
  S = lesson;
  overShown = false;
  lesson.begin(1);
  document.documentElement.classList.add('lesson');
  $('coach').hidden = false;
  showBoard();
  const t = now();
  bottle.enterAt(t);
  fillIn = planFillIn(S.cur.board, t + 0.15);
}

/** Lesson 2's bottle is away: the closing card, then back to the run. */
function finishLesson(): void {
  if (!lesson) return;
  // portal: no card between the lesson and level 1; play carries straight on
  if (portal) return endLesson();
  $('coach').hidden = true;
  $('tapHand').hidden = true;
  const r = runS!;
  $('lessonGo').textContent = r.lifts === 0 && r.n === 1 ? 'Start level 1' : `Back to level ${r.n}`;
  $('lessonDone').hidden = false;
  $('lessonGo').focus();
}

/** Back to the run, where it was. */
function endLesson(): void {
  if (!lesson) return;
  if (!ephemeral) store.set(LESSON_KEY, '1');
  pendingNext = null;
  fastForward();
  clearTimeout(coachTimer);
  lesson = null;
  S = runS!;
  runS = null;
  document.documentElement.classList.remove('lesson');
  $('coach').hidden = true;
  $('tapHand').hidden = true;
  $('lessonDone').hidden = true;
  overShown = false;
  showBoard();
  const t = now();
  bottle.enterAt(t);
  if (!S.over) {
    fillIn = planFillIn(S.cur.board, t + 0.15);
    if (S.lifts === 0) levelBanner(null);
  }
}

/** Lesson 2 ran dry: say what that means in a run, then pour the tray in again. */
let coachTimer = 0;
function lessonOutOfMoves(): void {
  overShown = true;
  setCoach('<b>Out of moves!</b> That ends a run. Let’s try again.');
  clearTimeout(coachTimer);
  coachTimer = window.setTimeout(() => {
    if (!lesson) return;
    overShown = false;
    lesson.begin(lesson.n);
    showBoard();
    fillIn = planFillIn(S.cur.board, now() + 0.15);
  }, 2600);
}

function setCoach(html: string): void {
  const el = $('coachText');
  if (el.innerHTML === html) return;
  el.innerHTML = html;
  const c = $('coach');
  c.classList.remove('fresh');
  void c.offsetWidth;
  c.classList.add('fresh');
}

const COLOR_NAMES = ['pink', 'green', 'lilac', 'yellow', 'blue'];

/** What the speech bubble says, from where the lesson is. Called whenever the tray settles. */
function syncCoach(): void {
  const L = lesson;
  $('movesPill').classList.toggle('spot', !!L && L.n === 2 && L.lifts === 0 && !S.cleared);
  if (!L || overShown) return;
  const target = L.target();
  const color = target ? COLOR_NAMES[S.cur.board.cells[target[0]]] : '';
  if (L.n === 1) {
    if (S.cleared) setCoach('Tray empty, bottle full!');
    else if (L.lifts === 0) setCoach(`Tap the <b>${color}</b> sand.`);
    else if (L.lifts === 1) setCoach(`Sand falls and joins up. Tap the <b>${color}</b>.`);
    else setCoach(`Now the <b>${color}</b>.`);
    return;
  }
  const over = L.lifts - L.par;
  if (S.cleared) setCoach(over < 0 ? '<b>Under par!</b> Bonus points.' : over === 0 ? '<b>Par!</b> Nicely done.' : 'Cleared, over par: fewer points.');
  else if (L.lifts === 0)
    setCoach(`<b>Par ${L.par}</b>: empty the tray in ${L.par} lifts or fewer.`);
  else if (S.pool.moves <= 2)
    setCoach(`${over > 0 ? 'Over par. ' : ''}<b>${S.pool.moves}</b> ${S.pool.moves === 1 ? 'move' : 'moves'} left. Run out and the run ends.`);
  else if (over > 0) setCoach('Over par: still counts, fewer points.');
  else setCoach('Lift one color to join up another.');
}

/** A tap on the wrong sand during a guided step: the bubble gives a little shake. */
function nudgeCoach(): void {
  const c = $('coach');
  c.classList.remove('nudge');
  void c.offsetWidth;
  c.classList.add('nudge');
}

/** The finger rests on the group to lift next, while the tray is still. */
function placeHand(): void {
  const hand = $('tapHand');
  const target = lesson && !S.cleared && !pour && !fillIn && !flights.length && !overShown ? lesson.target() : null;
  if (!target) {
    if (!hand.hidden) hand.hidden = true;
    return;
  }
  // the cell nearest the group's middle, so the finger lands on sand even for an L or a cup
  const cols = T.cols;
  const cx = target.reduce((a, i) => a + T.cellX(i % cols), 0) / target.length;
  const cy = target.reduce((a, i) => a + T.cellY((i / cols) | 0), 0) / target.length;
  let best = target[0];
  let bd = Infinity;
  for (const i of target) {
    const d = Math.hypot(T.cellX(i % cols) - cx, T.cellY((i / cols) | 0) - cy);
    if (d < bd - 1e-6) {
      bd = d;
      best = i;
    }
  }
  const p = T.toScreen(new THREE.Vector3(T.cellX(best % cols), T.cellY((best / cols) | 0), BLOCK / 2));
  hand.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  if (hand.hidden) hand.hidden = false;
}

$('coachSkip').onclick = () => {
  audio.unlock();
  endLesson();
};
$('lessonGo').onclick = () => {
  audio.unlock();
  endLesson();
};
$('replayLesson').onclick = () => {
  audio.unlock();
  if (isDaily(S)) leaveDaily();
  startLesson();
};

// ---------------------------------------------------------------- buttons, start

$('againBtn').onclick = () => {
  audio.unlock();
  newRun();
};
$('overShelf').onclick = openShelf;
$('overDaily').onclick = () => {
  const today = todayN();
  if (daily.cur && daily.cur.n === today && !daily.cur.practice) enterDaily(today, false, daily.cur);
  else enterDaily(today, false);
};
$('shelfBtn').onclick = openShelf;
$('shelfClose').onclick = closeShelf;
$('shelf').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeShelf();
});
$('startBtn').onclick = () => {
  audio.unlock();
  $('intro').hidden = true;
  startPlay();
};
/** Play begins: the lesson for a new player, or the level's banner. */
function startPlay(): void {
  if (tierChoice === 'auto') tierCheck = { until: performance.now() + 2000, sum: 0, count: 0 };
  if (firstPlay && !isDaily(S)) startLesson();
  else levelBanner(null);
  // time spent on the intro card isn't thinking time
  readyAt = performance.now();
  const st = installState();
  playtest?.opened({ run: run().seed, n: run().n, installed: st.standalone, ios: st.ios, screen: `${screen.width}x${screen.height}` });
}
if (!portal) {
  initPwa(() => {
    syncInstall();
    // Android's install prompt can arrive after the card is up: swap the steps for the one-tap button
    if (homeOpen) showHomeCard();
  }, toast);
  maybeAskHome();
} else {
  // on a portal, the progress code (a Safari/home-screen helper) and the tap log (for tuning) aren't needed
  $('moveRow').hidden = true;
  $('timingRow').hidden = true;
  // iOS can leave sound suspended after the app was in the background; a tap or click brings it back
  for (const type of ['touchend', 'click'])
    document.addEventListener(type, () => audio.resumeIfSuspended(), { passive: true, capture: true });
}
window.addEventListener('appinstalled', closeHomeCard);

// her progress is saved after every move; this catches anything in flight when the page goes away
window.addEventListener('pagehide', persist);
// playtest rows waiting from an earlier offline session go now, when the connection comes back, and as the app closes
void playtest?.flush();
window.addEventListener('online', () => void playtest?.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void playtest?.flush();
});

window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);

// ---------------------------------------------------------------- phones play upright (orientation.ts)

preventZoom();
// a portal asks players to turn their phone itself, and the wide layout plays sideways
if (!portal) lockPortrait();
let sidewaysSince = 0;

/** Show the "turn your phone upright" card while a phone is sideways; it keeps taps off the tray. */
function checkUpright(): void {
  const now = !portal && isPhone() && isLandscape();
  if (now === sideways) return;
  sideways = now;
  $('upright').hidden = !sideways;
  document.documentElement.classList.toggle('sideways', sideways);
  if (sideways) {
    sidewaysSince = performance.now();
    // a press started before turning never lands
    press = null;
    hover = null;
    return;
  }
  // time spent sideways isn't thinking time
  const t = performance.now();
  readyAt += t - Math.max(sidewaysSince, readyAt);
  resetZoom();
  layout();
}

/**
 * Called every frame. Resize events on iPhone can arrive before a rotation has settled, and the old code framed the
 * camera once, for whatever size it saw then. Comparing the canvas's real size each frame reframes it as soon as the
 * size changes, so the picture and the tap mapping always match the screen.
 */
function syncView(): void {
  checkUpright();
  if (viewKey() !== framedFor) layout();
}

screen.orientation?.addEventListener?.('change', syncView);
window.addEventListener('orientationchange', syncView);
checkUpright();

showBoard();
bumpShelf();
$('shelfBtn').classList.remove('bump');
// a daily first try left part way comes back as she left it (or ?daily=N, a test link)
const dailyResume = dailyParam ? null : daily.cur && !daily.cur.practice && daily.cur.taps.length ? daily.cur : null;
if (dailyParam) enterDaily(dailyParam, false);
else if (dailyResume) enterDaily(dailyResume.n, false, dailyResume);
if (isDaily(S)) {
  $('intro').hidden = !dailyResume;
  $('introTitle').textContent = 'Welcome back';
  $('introText').textContent = `Daily #${S.puzzle.n} · ${S.pool.moves} moves left`;
  $('introSmall').textContent = '';
  $('startBtn').textContent = 'Keep going';
} else if (resumed && S.over) {
  // closed on the final board of a run: show how it ended
  $('intro').hidden = true;
} else if (resumed) {
  $('introTitle').textContent = 'Welcome back';
  $('introText').textContent = `You're on level ${S.n} with ${fmt(S.score)} points` + (best > S.score ? `. Your best is ${fmt(best)}.` : '.');
  $('introSmall').textContent = S.taps.length ? 'Your tray is just as you left it.' : 'The next tray is ready.';
  $('startBtn').textContent = 'Keep playing';
}
if (firstPlay && !isDaily(S) && !(resumed && S.over)) {
  $('introTitle').textContent = 'Unfill';
  $('introText').textContent = 'Lift the colors out of a tray of sand to fill a bottle for your shelf.';
  $('introSmall').textContent = 'First, a quick lesson.';
  $('startBtn').textContent = 'Begin';
}
warmup();
// portal: no start card; new players land in the lesson, everyone else straight back in their tray
if (portal && !$('intro').hidden) {
  $('intro').hidden = true;
  startPlay();
}

/**
 * Compile every shader before play: a bottle layer, the cork, the preview ghost and the grains. Otherwise each one
 * compiles the first time it appears, and on a phone that's a visible hitch in the middle of a pour.
 */
function warmup(): void {
  // Drawn for one frame (under the intro card) inside the real scene, so the lights and fog match and the GPU
  // builds its pipelines too, not just the shader programs.
  const warm = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const mats = [...bottle.warmables(SAND), ...bottle.warmables(DAILY_SAND), blocks.ghostMaterial];
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
  /** The scene itself, for the marketing renders (marketing/render.mjs): camera framing, the bottle, the wide layout. */
  stage: () => ({ T, bottle, layout, placeBottle }),
  /** Freeze the scene clock (seconds) for frame-exact screenshots; null resumes. */
  freeze: (t: number | null) => {
    clockOverride = t;
  },
  now: () => now(),
  solution: () => S.knownFinish() ?? [],
  fastForward: () => fastForward(),
  cellScreen: (i: number) => T.toScreen(new THREE.Vector3(T.cellX(i % T.cols), T.cellY((i / T.cols) | 0), BLOCK / 2)),
  grains: () => ({ busyUntil: grains.busyUntil, cap: grains.capacity }),
  lesson: () => (lesson ? { n: S.n, target: lesson.target(), coach: $('coach').textContent, done: !$('lessonDone').hidden } : null),
  startLesson: () => startLesson(),
  daily: {
    open: () => openDaily(),
    play: (n?: number, practice = false) => enterDaily(n ?? todayN(), practice),
    back: () => leaveDaily(),
    today: () => todayN(),
    state: () => {
      const D = isDaily(S) ? S : null;
      return D
        ? { on: true, n: D.puzzle.n, best: D.puzzle.best, allowed: D.puzzle.allowed, practice: D.practice, lifts: D.lifts, cleared: D.cleared, over: D.over }
        : { on: false };
    },
    records: () => daily.records,
    doneShown: () => !$('dailyDone').hidden,
    screenShown: () => !$('daily').hidden,
  },
};
