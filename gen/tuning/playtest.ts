/**
 * Read the automatic playtest Sheet (collector/) and line each tester up against the bots and the targets.
 *
 *   npm run tuning:playtest -- plays.csv      # the Plays tab: File › Download › Comma-separated values (.csv)
 *   npm run tuning:playtest -- plays.json     # or the tab's values as the Sheets API returns them ({ values: [[...]] })
 *
 * For each tester (their name, or the phone's id if they didn't give one; a name joins all their phones):
 *   - runs and levels reached, and real minutes per finished run (target in targets.ts: 12–15 for a typical player),
 *   - beat / make / over par on cleared levels, and make par on levels 1–10 and 11–20,
 *   - real seconds per lift (thinking + pouring), to replace the 5 s estimate in src/core/pacing.ts,
 *   - which bot plays most like them, on the very boards they played.
 * Then everyone together. Change TUNING or TARGETS and re-run `npm run tuning`.
 */
import { readFileSync } from 'node:fs';
import { SECONDS_PER_BOARD, SECONDS_PER_TAP } from '../../src/core';
import { botMatch } from './match';
import { BOT_LABEL, quantile } from './simulate';
import { TARGETS } from './targets';

export interface Row {
  id: string;
  type: string;
  name: string;
  device: string;
  app: string;
  at: number;
  run: number;
  n: number;
  board: string;
  par: number;
  solverPar: number;
  movesStart: number;
  lifts: number;
  outcome: string;
  activeSec: number;
  think: number[];
  pour: number[];
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f);
      rows.push(row);
      row = [];
      f = '';
    } else f += c;
  }
  if (f || row.length) {
    row.push(f);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const num = (v: unknown) => (v === '' || v === undefined || v === null ? NaN : Number(v));
const list = (v: unknown): number[] => {
  try {
    const a = typeof v === 'string' ? JSON.parse(v || '[]') : v;
    return Array.isArray(a) ? a.map(Number) : [];
  } catch {
    return [];
  }
};

/** The Plays tab (header row first) as rows, each id once. */
export function readRows(table: unknown[][]): Row[] {
  const [head, ...body] = table;
  const col = (name: string) => (head as string[]).indexOf(name);
  const get = (r: unknown[], name: string) => (col(name) < 0 ? '' : r[col(name)]);
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of body) {
    const id = String(get(r, 'id'));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      type: String(get(r, 'type')),
      name: String(get(r, 'name') ?? '').trim(),
      device: String(get(r, 'device')),
      app: String(get(r, 'app')),
      at: num(get(r, 'at')),
      run: num(get(r, 'run')),
      n: num(get(r, 'n')),
      board: String(get(r, 'board')),
      par: num(get(r, 'par')),
      solverPar: num(get(r, 'solverPar')),
      movesStart: num(get(r, 'movesStart')),
      lifts: num(get(r, 'lifts')),
      outcome: String(get(r, 'outcome')),
      activeSec: num(get(r, 'activeSec')),
      think: list(get(r, 'think')),
      pour: list(get(r, 'pour')),
    });
  }
  return out.sort((a, z) => a.at - z.at);
}

/** Who each row belongs to: the name given on any of a phone's rows, else the phone's id. */
export function testers(rows: readonly Row[]): Map<string, Row[]> {
  const nameOf = new Map<string, string>();
  for (const r of rows) if (r.name) nameOf.set(r.device, r.name);
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    const who = nameOf.get(r.device) ?? `phone ${r.device}`;
    if (!by.has(who)) by.set(who, []);
    by.get(who)!.push(r);
  }
  return by;
}

export interface Summary {
  levels: number;
  runs: { levels: number; minutes: number; finished: boolean }[];
  clears: number;
  beat: number;
  par: number;
  over: number;
  makeParEarly: number | null;
  makeParLate: number | null;
  outOfReach: number;
  secondsPerLift: number | null;
  thinkMedian: number | null;
  pourMedian: number | null;
}

const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);

export function summarize(rows: readonly Row[]): Summary {
  const levels = rows.filter((r) => r.type === 'level');
  const byRun = new Map<string, Row[]>();
  for (const r of levels) {
    const k = `${r.device}:${r.run}`;
    if (!byRun.has(k)) byRun.set(k, []);
    byRun.get(k)!.push(r);
  }
  const runs = [...byRun.values()].map((rs) => ({
    levels: Math.max(...rs.map((r) => (r.outcome === 'clear' ? r.n : r.n - 1))),
    // playing time (pauses over a minute left out) plus each level's clear and pour-in, as the bot runs count it
    minutes: rs.reduce((s, r) => s + (r.activeSec || 0) + SECONDS_PER_BOARD, 0) / 60,
    finished: rs.some((r) => r.outcome === 'out' || r.outcome === 'quit'),
  }));
  const clears = levels.filter((r) => r.outcome === 'clear');
  const made = (rs: Row[]) => (rs.length ? pct(rs.filter((r) => r.lifts <= r.par).length, rs.length) : null);
  const think = levels.flatMap((r) => r.think.filter((t) => t <= 60_000));
  const pour = levels.flatMap((r) => r.pour.filter((t) => t <= 60_000));
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  return {
    levels: levels.length,
    runs,
    clears: clears.length,
    beat: pct(clears.filter((r) => r.lifts < r.par).length, clears.length),
    par: pct(clears.filter((r) => r.lifts === r.par).length, clears.length),
    over: pct(clears.filter((r) => r.lifts > r.par).length, clears.length),
    makeParEarly: made(clears.filter((r) => r.n <= 10)),
    makeParLate: made(clears.filter((r) => r.n >= 11 && r.n <= 20)),
    outOfReach: pct(levels.filter((r) => r.movesStart < r.par).length, levels.length),
    secondsPerLift: think.length && pour.length ? (mean(think) + mean(pour)) / 1000 : null,
    thinkMedian: think.length ? quantile(think, 0.5) / 1000 : null,
    pourMedian: pour.length ? quantile(pour, 0.5) / 1000 : null,
  };
}

function report(who: string, rows: Row[]): void {
  const s = summarize(rows);
  const devices = new Set(rows.map((r) => r.device)).size;
  const last = rows.at(-1);
  console.log(`\n${who}: ${s.levels} levels on ${devices} ${devices === 1 ? 'phone' : 'phones'}, last played ${last ? new Date(last.at).toISOString().slice(0, 16).replace('T', ' ') : '-'}`);
  if (!s.levels) return console.log('  opened the game but has not finished a level yet');
  const done = s.runs.filter((r) => r.finished);
  const going = s.runs.filter((r) => !r.finished);
  if (done.length) {
    console.log(
      `  finished runs: ${done.length}; levels cleared ${done.map((r) => r.levels).join(', ')}; minutes ${done.map((r) => r.minutes.toFixed(1)).join(', ')}` +
        ` (median ${quantile(done.map((r) => r.minutes), 0.5).toFixed(1)}; target ${TARGETS.typical.medianMinutes.join('–')})`,
    );
  }
  if (going.length) console.log(`  run in progress: level ${going.map((r) => r.levels + 1).join(', ')} so far`);
  if (s.clears) {
    console.log(`  cleared levels: beat par ${s.beat.toFixed(0)}%, par ${s.par.toFixed(0)}%, over ${s.over.toFixed(0)}% (target mix ${TARGETS.typical.mix.beat}/${TARGETS.typical.mix.par}/${TARGETS.typical.mix.over})`);
    const f = (v: number | null, t: [number, number]) => (v === null ? '-' : `${v.toFixed(0)}% (target ${t.join('–')})`);
    console.log(`  make par: levels 1–10 ${f(s.makeParEarly, TARGETS.typical.earlyMakePar)}, levels 11–20 ${f(s.makeParLate, TARGETS.typical.lateMakePar)}`);
  }
  if (s.outOfReach) console.log(`  levels started with fewer moves than par: ${s.outOfReach.toFixed(0)}%`);
  if (s.secondsPerLift !== null)
    console.log(
      `  seconds per lift: ${s.secondsPerLift.toFixed(1)} on average (thinking median ${s.thinkMedian!.toFixed(1)}, pour median ${s.pourMedian!.toFixed(1)}; pacing.ts assumes ${SECONDS_PER_TAP})`,
    );
  const m = botMatch(rows.filter((r) => r.type === 'level' && r.outcome === 'clear'));
  if (m) {
    console.log(
      `  plays closest to: ${BOT_LABEL[m.ranked[0]]}, then ${BOT_LABEL[m.ranked[1]]}; ${m.typicalPercentile.toFixed(0)}th percentile of the typical bot (50 = typical, lower = fewer moves)` +
        (m.levels < 20 ? `; only ${m.levels} levels, a first look` : ''),
    );
  }
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.log('Usage: npm run tuning:playtest -- plays.csv (the Plays tab, downloaded as CSV) or plays.json');
    process.exit(1);
  }
  const text = readFileSync(path, 'utf8');
  let table: unknown[][];
  if (/^\s*[[{]/.test(text)) {
    const j = JSON.parse(text);
    table = Array.isArray(j) ? j : j.values;
  } else table = parseCsv(text);
  const rows = readRows(table);
  const by = testers(rows);
  const apps = [...new Set(rows.map((r) => r.app))];
  console.log(`${rows.length} rows from ${by.size} ${by.size === 1 ? 'tester' : 'testers'} (builds: ${apps.join(', ')})`);
  for (const [who, rs] of [...by].sort((a, z) => z[1].length - a[1].length)) report(who, rs);
  if (by.size > 1) report('Everyone', rows.slice());
}

if (import.meta.url === `file://${process.argv[1]}`) main();
