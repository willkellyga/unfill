import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  BATCH,
  DEVICE_KEY,
  OUTBOX_KEY,
  OUTBOX_LIMIT,
  Playtest,
  activeSeconds,
  cleanName,
  type PlayEvent,
  type Sender,
  type Store,
} from '../src/app/game/playtest';
import { decodeProgress, encodeProgress } from '../src/app/game/prefs';

const require = createRequire(import.meta.url);
const { load } = require('../scripts/collector-fake.cjs');

function memStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) };
}

function harness(o: { online?: boolean; fail?: number } = {}) {
  const store = memStore();
  const sent: PlayEvent[][] = [];
  const timers: { ms: number; fn: () => void }[] = [];
  let online = o.online ?? true;
  let fail = o.fail ?? 0;
  let t = 1_000_000;
  const send: Sender = async (_url, body) => {
    if (fail > 0) {
      fail--;
      throw new TypeError('network');
    }
    sent.push(JSON.parse(body).events);
    return { ok: true };
  };
  const make = () =>
    new Playtest({ store, url: 'https://script.example/exec', app: 'test', send, online: () => online, now: () => t, later: (fn, ms) => timers.push({ fn, ms }) });
  return {
    store,
    sent,
    timers,
    make,
    setOnline: (v: boolean) => (online = v),
    tick: (ms: number) => (t += ms),
  };
}

const levelFields = { run: 7, n: 1, board: 't1-0001', lifts: 3, par: 4, outcome: 'clear' as const, points: 120 };

describe('playtest outbox', () => {
  it('gives the phone one id and keeps it', () => {
    const h = harness();
    const a = h.make().device;
    expect(a).toMatch(/^[a-z0-9]{10}$/);
    expect(h.make().device).toBe(a);
    expect(h.store.get(DEVICE_KEY)).toBe(a);
  });

  it('logs a level with its timings and sends it', async () => {
    const h = harness();
    const p = h.make();
    p.name = '  Grandma   Jo ';
    p.levelStarted(7, 1, 't1-0001', 9);
    h.tick(4000);
    p.tapped(4000);
    p.poured(1200);
    p.tapped(70_000); // the phone was put down: not playing time
    p.poured(1100);
    p.tapped(2500);
    p.poured(900);
    h.tick(10_000);
    p.levelEnded(levelFields);
    await p.flush();
    expect(h.sent).toHaveLength(1);
    const [ev] = h.sent[0];
    expect(ev).toMatchObject({ type: 'level', name: 'Grandma Jo', device: p.device, app: 'test', run: 7, n: 1, board: 't1-0001', movesStart: 9 });
    expect(ev.think).toEqual([4000, 70000, 2500]);
    expect(ev.pour).toEqual([1200, 1100, 900]);
    expect(ev.activeSec).toBe(9.7);
    expect(ev.endedAt! - ev.startedAt!).toBe(14_000);
    expect(p.outbox()).toHaveLength(0);
    expect(p.sentCount()).toBe(1);
  });

  it('carries a level across an app close', () => {
    const h = harness();
    const a = h.make();
    a.levelStarted(7, 3, 't2-0100', 12);
    a.tapped(3000);
    a.poured(1000);
    const b = h.make();
    b.levelStarted(7, 3, 't2-0100', 12);
    b.tapped(2000);
    expect(b.level).toMatchObject({ resumes: 1, think: [3000, 2000], pour: [1000] });
    b.levelStarted(7, 4, 't2-0200', 10);
    expect(b.level).toMatchObject({ resumes: 0, think: [] });
  });

  it('keeps rows offline and sends them when back online', async () => {
    const h = harness({ online: false });
    const p = h.make();
    p.levelStarted(7, 1, 'a', 5);
    p.levelEnded(levelFields);
    p.opened({ run: 7, n: 2 });
    await p.flush();
    expect(h.sent).toHaveLength(0);
    expect(p.outbox()).toHaveLength(2);
    h.setOnline(true);
    await p.flush();
    expect(h.sent.flat().map((e) => e.type)).toEqual(['level', 'open']);
    expect(p.outbox()).toHaveLength(0);
  });

  it('retries a failed send with a growing wait, and loses nothing', async () => {
    const h = harness({ fail: 2 });
    const p = h.make();
    p.levelEnded(levelFields);
    await p.flush();
    expect(p.outbox()).toHaveLength(1);
    expect(h.timers.map((x) => x.ms)).toEqual([30_000]);
    h.timers.shift()!.fn();
    await p.flush();
    expect(h.timers.map((x) => x.ms)).toEqual([60_000]);
    h.timers.shift()!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.sent).toHaveLength(1);
    expect(p.outbox()).toHaveLength(0);
  });

  it('sends in batches and caps the outbox', async () => {
    const h = harness({ online: false });
    const p = h.make();
    for (let i = 0; i < OUTBOX_LIMIT + 10; i++) p.levelEnded({ ...levelFields, n: i + 1 });
    expect(p.outbox()).toHaveLength(OUTBOX_LIMIT);
    expect(p.outbox()[0].n).toBe(11);
    h.setOnline(true);
    await p.flush();
    expect(h.sent).toHaveLength(Math.ceil(OUTBOX_LIMIT / BATCH));
    expect(h.sent.every((b) => b.length <= BATCH)).toBe(true);
    expect(new Set(h.sent.flat().map((e) => e.id)).size).toBe(OUTBOX_LIMIT);
  });

  it('collects rows without a collector URL, to send once there is one', async () => {
    const h = harness();
    const p = new Playtest({ store: h.store, url: '', app: 't', send: async () => ({ ok: true }) });
    p.levelEnded(levelFields);
    await p.flush();
    expect(JSON.parse(h.store.get(OUTBOX_KEY)!)).toHaveLength(1);
    expect(p.enabled).toBe(false);
  });

  it('tidies names and counts only short pauses as play', () => {
    expect(cleanName('  a\u0007b\n  c ')).toBe('ab c');
    expect(cleanName('x'.repeat(80))).toHaveLength(40);
    expect(activeSeconds([1000, 61_000], [500])).toBe(1.5);
  });

  it('moves the playtest id and name with a progress code', () => {
    const code = encodeProgress({ save: null, shelf: [], best: 5, device: 'abc234defg', name: 'Mom' });
    expect(decodeProgress(code)).toMatchObject({ device: 'abc234defg', name: 'Mom' });
    const old = encodeProgress({ save: null, shelf: [], best: 5 });
    expect(decodeProgress(old)?.device).toBeUndefined();
    const bad = encodeProgress({ save: null, shelf: [], best: 5, device: '../../x' });
    expect(decodeProgress(bad)?.device).toBeUndefined();
  });
});

describe('collector (collector/Code.gs, run against an in-memory Sheet)', () => {
  const post = (gs: ReturnType<typeof load>, body: unknown) =>
    JSON.parse(gs.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);

  it('writes one row per event under a header, once per id', () => {
    const gs = load();
    const ev = { id: 'd1-1-aaaa', type: 'level', device: 'd1', name: 'Jo', n: 3, think: [1, 2], mirror: false, points: 0 };
    expect(post(gs, { v: 1, events: [ev, { ...ev, id: 'd1-2-bbbb', n: 4 }] })).toEqual({ ok: true, added: 2 });
    expect(post(gs, { v: 1, events: [ev] })).toEqual({ ok: true, added: 0 });
    const rows = gs.sheet('Plays');
    const head = rows[0];
    expect(rows).toHaveLength(3);
    const row = Object.fromEntries(head.map((h: string, i: number) => [h, rows[1][i]]));
    expect(row).toMatchObject({ id: 'd1-1-aaaa', name: 'Jo', n: 3, think: '[1,2]', mirror: false, points: 0, board: '' });
    expect(row.received).toBeInstanceOf(Date);
  });

  it('keeps what it can’t read in Errors, and never lets a name become a formula', () => {
    const gs = load();
    expect(post(gs, 'not json').ok).toBe(false);
    expect(gs.sheet('Errors')[1][2]).toBe('not json');
    post(gs, { events: [{ id: 'x-1', device: 'x', name: '=HYPERLINK("evil")' }, { id: 5 }, null] });
    const rows = gs.sheet('Plays');
    expect(rows).toHaveLength(2);
    expect(rows[1][rows[0].indexOf('name')]).toBe('\'=HYPERLINK("evil")');
  });
});

describe('reading the Sheet (gen/tuning/playtest.ts)', () => {
  it('reads the Plays tab back from CSV, one row per id, a name joining a tester’s phones', async () => {
    const { parseCsv, readRows, summarize, testers } = await import('../gen/tuning/playtest');
    const { toCsv } = require('../scripts/collector-fake.cjs');
    const gs = load();
    const lv = (id: string, device: string, n: number, extra: object = {}) => ({
      id, type: 'level', device, name: '', app: 't', at: n, run: 1, n, board: 't1-0001', par: 5, solverPar: 4, movesStart: 6,
      lifts: 5, outcome: 'clear', activeSec: 30, think: [5000, 6000], pour: [1000], ...extra,
    });
    gs.doPost({ postData: { contents: JSON.stringify({ events: [lv('a1', 'phoneaaa', 1), lv('a2', 'phoneaaa', 2, { name: 'Jo, "the" aunt', lifts: 4 })] }) } });
    gs.doPost({ postData: { contents: JSON.stringify({ events: [lv('b1', 'phonebbb', 1, { outcome: 'out', lifts: 6 }), lv('a1', 'phoneaaa', 1)] }) } });
    const rows = readRows(parseCsv(toCsv(gs.sheet('Plays'))));
    expect(rows.map((r) => r.id)).toEqual(['a1', 'b1', 'a2']);
    expect(rows[0].think).toEqual([5000, 6000]);
    const by = testers(rows);
    expect([...by.keys()]).toEqual(['Jo, "the" aunt', 'phone phonebbb']);
    const s = summarize(by.get('Jo, "the" aunt')!);
    expect(s).toMatchObject({ levels: 2, clears: 2, beat: 50, par: 50, over: 0 });
    expect(s.runs).toEqual([{ levels: 2, minutes: (60 + 16) / 60, finished: false }]);
    expect(s.secondsPerLift).toBe(6.5);
    expect(summarize(by.get('phone phonebbb')!).runs[0]).toMatchObject({ levels: 0, finished: true });
  });
});
