/**
 * Playtest upload (Nov 14, Will: "make the playtest data come back automatically" from family and friends).
 *
 * Every level she finishes (cleared, out of moves, or left for a new run) becomes one row: which board, par, the
 * moves she had, her lifts, and how long each lift took to think about and to pour. The rows wait in an outbox in
 * localStorage and are sent in small batches to Will's collector (a Google Apps Script web app writing to a Google
 * Sheet, see collector/), so nothing is lost offline: the outbox is retried when the phone is back online, when the
 * app opens, and after every level. gen/tuning/playtest.ts reads the Sheet's rows to compare players with the bots.
 *
 * Each phone gets a random id the first time it plays, and the tester can add a name in Settings (or arrive through
 * a link with ?tester=Name), so Will can tell people apart. Nothing else about the person or the phone is sent.
 */

/** Will's collector: the Apps Script web app URL (Deploy › Web app) behind the "Unfill playtest" Sheet in his Google account. */
export const COLLECTOR_URL =
  'https://script.google.com/macros/s/AKfycbxyLVTdZAzsTs1T1gQO3OgO_G_0Pw4rsK8aD_-XULz48lX8xeubuMsakhh4dZj-Qt0z/exec';

export const DEVICE_KEY = 'unfill-device';
export const NAME_KEY = 'unfill-tester';
export const OUTBOX_KEY = 'unfill-outbox';
export const LEVEL_KEY = 'unfill-pt-level';
export const SENT_KEY = 'unfill-pt-sent';
export const SEQ_KEY = 'unfill-pt-seq';

/** The outbox keeps at most this many rows (about 300 KB); the oldest go first if a phone is offline for weeks. */
export const OUTBOX_LIMIT = 500;
/** Rows per request: well under the 64 KB a request sent as the page closes may carry. */
export const BATCH = 25;
/** Longest name kept. */
export const NAME_MAX = 40;

export interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

export type Outcome = 'clear' | 'out' | 'quit';

/** One row of the Sheet. Field names are the Sheet's column names (collector/Code.gs COLUMNS). */
export interface PlayEvent {
  /** Unique per row (device and a counter), so a row sent twice is counted once. */
  id: string;
  type: 'level' | 'open';
  device: string;
  name: string;
  /** The build that played it (git commit on GitHub Pages). */
  app: string;
  /** When the row was made (ms since 1970). */
  at: number;
  /** The run's seed: the same for every level of one run. */
  run?: number;
  /** Level number in the run. */
  n?: number;
  /** Library board id, as in src/library/boards.json and gen/tuning/samples.json. */
  board?: string;
  role?: string;
  tier?: number;
  cols?: number;
  rows?: number;
  colors?: number;
  /** The solver's par for the board (the library's par), the par she was shown, and the moves the level poured in. */
  solverPar?: number;
  par?: number;
  grant?: number;
  /** Moves she had when the level started (leftovers plus the grant), and when it ended. */
  movesStart?: number;
  movesLeft?: number;
  lifts?: number;
  outcome?: Outcome;
  /** Points for the board (clears only) and the run's score after it. */
  points?: number;
  score?: number;
  startedAt?: number;
  endedAt?: number;
  /** Thinking plus pouring time over the level's lifts, in seconds, leaving out pauses over a minute. */
  activeSec?: number;
  /**
   * Per lift, in order: ms the tray sat ready before the tap, and ms the pour took until it was playable again (a tap
   * during a pour skips the rest of it). The last lift of a level has no pour time.
   */
  think?: number[];
  pour?: number[];
  /** Cells tapped, in order, on the board as shown (after the mirror and color swap below). */
  taps?: number[];
  mirror?: boolean;
  perm?: number[];
  /** Times the level was picked up again after the app was closed. */
  resumes?: number;
  installed?: boolean;
  ios?: boolean;
  screen?: string;
}

/** The level in progress, kept in localStorage so a level that spans an app close still has all its timings. */
export interface LevelLog {
  run: number;
  n: number;
  board: string;
  startedAt: number;
  movesStart: number;
  think: number[];
  pour: number[];
  resumes: number;
}

/** A pause longer than this (the phone put down) doesn't count as playing time. */
export const IDLE_MS = 60_000;

export function activeSeconds(think: readonly number[], pour: readonly number[]): number {
  let ms = 0;
  for (const t of think) if (t <= IDLE_MS) ms += t;
  for (const p of pour) if (p <= IDLE_MS) ms += p;
  return Math.round(ms / 100) / 10;
}

function readJson<T>(store: Store, key: string, fallback: T): T {
  try {
    const v = JSON.parse(store.get(key) || 'null');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/** A random id for this phone, made once: 10 letters and digits, no meaning. */
export function deviceId(store: Store, random: () => number = Math.random): string {
  const have = store.get(DEVICE_KEY);
  if (have && /^[a-z0-9]{6,32}$/.test(have)) return have;
  let id = '';
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 10; i++) id += abc[Math.floor(random() * abc.length)];
  store.set(DEVICE_KEY, id);
  return id;
}

export function cleanName(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export interface SendResult {
  ok: boolean;
}
export type Sender = (url: string, body: string) => Promise<SendResult>;

/**
 * POST a batch to the Apps Script web app. Apps Script answers with a redirect that a page can't read across
 * origins, so this is a no-cors request: it resolves once the collector has the rows and rejects if the network
 * fails, which is all the outbox needs. text/plain keeps it a simple request (no preflight, which Apps Script
 * can't answer); keepalive lets the last batch finish as the app closes.
 */
export const fetchSender: Sender = async (url, body) => {
  await fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body });
  return { ok: true };
};

export interface PlaytestOptions {
  store: Store;
  url: string;
  app: string;
  send?: Sender;
  online?: () => boolean;
  now?: () => number;
  /** Timer for retries (window.setTimeout in the game). */
  later?: (fn: () => void, ms: number) => unknown;
  random?: () => number;
}

/**
 * The outbox and the level in progress. The game calls levelStarted / tapped / levelEnded; flush() sends what's
 * waiting. With no URL nothing is sent, but rows still collect, so play from before the collector exists arrives once
 * it does.
 */
export class Playtest {
  readonly device: string;
  private store: Store;
  private url: string;
  private app: string;
  private send: Sender;
  private online: () => boolean;
  private now: () => number;
  private later: (fn: () => void, ms: number) => unknown;
  private random: () => number;
  private busy = false;
  private failures = 0;
  private retryPending = false;
  level: LevelLog | null;

  constructor(o: PlaytestOptions) {
    this.store = o.store;
    this.url = o.url;
    this.app = o.app;
    this.send = o.send ?? fetchSender;
    this.online = o.online ?? (() => true);
    this.now = o.now ?? Date.now;
    this.later = o.later ?? ((fn, ms) => setTimeout(fn, ms));
    this.random = o.random ?? Math.random;
    this.device = deviceId(this.store, this.random);
    this.level = readJson<LevelLog | null>(this.store, LEVEL_KEY, null);
  }

  get name(): string {
    return cleanName(this.store.get(NAME_KEY) || '');
  }
  set name(s: string) {
    this.store.set(NAME_KEY, cleanName(s));
  }

  get enabled(): boolean {
    return !!this.url;
  }

  outbox(): PlayEvent[] {
    const v = readJson<PlayEvent[]>(this.store, OUTBOX_KEY, []);
    return Array.isArray(v) ? v : [];
  }

  /** Rows the collector has taken from this phone. */
  sentCount(): number {
    return Number(this.store.get(SENT_KEY)) || 0;
  }

  /** Device, a counter, and a random tail: a code moved to the home-screen app takes the device id along, and its
   * counter starts over there. */
  private nextId(): string {
    const seq = (Number(this.store.get(SEQ_KEY)) || 0) + 1;
    this.store.set(SEQ_KEY, String(seq));
    return `${this.device}-${seq}-${Math.floor(this.random() * 36 ** 4).toString(36).padStart(4, '0')}`;
  }

  private base(type: PlayEvent['type']): PlayEvent {
    return { id: this.nextId(), type, device: this.device, name: this.name, app: this.app, at: this.now() };
  }

  private saveLevel(): void {
    this.store.set(LEVEL_KEY, JSON.stringify(this.level));
  }

  /**
   * A level is on screen. If it's the one already being logged (the app was closed mid-level and reopened), its
   * timings carry on; otherwise a new log starts.
   */
  levelStarted(run: number, n: number, board: string, movesStart: number): void {
    const l = this.level;
    if (l && l.run === run && l.n === n && l.board === board) {
      l.resumes++;
    } else {
      this.level = { run, n, board, startedAt: this.now(), movesStart, think: [], pour: [], resumes: 0 };
    }
    this.saveLevel();
  }

  /** A lift: how long the tray sat ready before the tap. */
  tapped(thinkMs: number): void {
    if (!this.level) return;
    this.level.think.push(Math.max(0, Math.round(thinkMs)));
    this.saveLevel();
  }

  /**
   * The pour after a lift finished and the tray is playable again. The lift that ends a level ends its log first,
   * so a level's pour list is one shorter than its think list when it was cleared or ran out.
   */
  poured(ms: number): void {
    const l = this.level;
    if (!l || l.pour.length >= l.think.length) return;
    l.pour.push(Math.max(0, Math.round(ms)));
    this.saveLevel();
  }

  /** The level ended: its row goes in the outbox and is sent. `fields` are the board and result from the session. */
  levelEnded(fields: Omit<PlayEvent, 'id' | 'type' | 'device' | 'name' | 'app' | 'at'> & { outcome: Outcome }): void {
    const l = this.level;
    const think = l ? l.think : [];
    const pour = l ? l.pour : [];
    const ev: PlayEvent = {
      ...this.base('level'),
      ...fields,
      startedAt: l?.startedAt,
      endedAt: this.now(),
      movesStart: l?.movesStart ?? fields.movesStart,
      activeSec: activeSeconds(think, pour),
      think,
      pour,
      resumes: l?.resumes ?? 0,
    };
    this.level = null;
    this.saveLevel();
    this.enqueue(ev);
  }

  /** The app was opened and play started: shows who opened it, even before a level is finished. */
  opened(fields: Pick<PlayEvent, 'run' | 'n' | 'installed' | 'ios' | 'screen'>): void {
    this.enqueue({ ...this.base('open'), ...fields });
  }

  private enqueue(ev: PlayEvent): void {
    const box = this.outbox();
    box.push(ev);
    if (box.length > OUTBOX_LIMIT) box.splice(0, box.length - OUTBOX_LIMIT);
    this.store.set(OUTBOX_KEY, JSON.stringify(box));
    void this.flush();
  }

  /** Send what's waiting, a batch at a time. Safe to call any time; one flush runs at once. */
  async flush(): Promise<void> {
    if (this.busy || !this.url || !this.online()) return;
    this.busy = true;
    try {
      for (;;) {
        const batch = this.outbox().slice(0, BATCH);
        if (!batch.length) break;
        let ok = false;
        try {
          ok = (await this.send(this.url, JSON.stringify({ v: 1, events: batch }))).ok;
        } catch {
          ok = false;
        }
        if (!ok) {
          this.retry();
          break;
        }
        this.failures = 0;
        // rows may have been added while this batch was out: drop only the ones just sent
        const sent = new Set(batch.map((e) => e.id));
        this.store.set(OUTBOX_KEY, JSON.stringify(this.outbox().filter((e) => !sent.has(e.id))));
        this.store.set(SENT_KEY, String(this.sentCount() + batch.length));
      }
    } finally {
      this.busy = false;
    }
  }

  /** Try again later: 30 s, 1, 2, 4 ... up to 15 minutes. */
  private retry(): void {
    if (this.retryPending) return;
    this.retryPending = true;
    const ms = Math.min(15 * 60_000, 30_000 * 2 ** this.failures);
    this.failures++;
    this.later(() => {
      this.retryPending = false;
      void this.flush();
    }, ms);
  }
}
