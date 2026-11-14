/**
 * Tunes the slack schedule with simulated 100-board sessions and writes gen/economy/REPORT.md.
 *
 *   npx tsx gen/economy/tune.ts            # grid search, prints the best schedules, writes the report for SLACK
 *   npx tsx gen/economy/tune.ts --report   # only write the report for the schedule in src/core/economy.ts
 *
 * Needs gen/economy/samples.json (npx tsx gen/economy/sample.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SEGMENTS, SESSION_TARGET_SECONDS, SECONDS_PER_TAP, SLACK, type Library, type SlackSchedule, type SlotRole } from '../../src/core';
import type { Samples } from './sample';
import { PLAYERS, sessionPicks, simulateSession, type PlayerName } from './simulate';

export const SESSIONS = 40;
export const BOARDS = 100;

export interface PlayerSummary {
  firstTry: number;
  worstFirstTry: number;
  restartsPer100: number;
  hintedPer100: number;
  finalPool: number;
  maxFinalPool: number;
  minMargin: number;
  failByRole: Record<SlotRole, number>;
  avgSlack: number;
  /** Average pool after each board number. */
  poolCurve: number[];
  pace: Pace;
}

/** How play time lines up with sessions (estimates from src/core/pacing.ts). */
export interface Pace {
  /** Median minutes until the first session's closing breather (board 15) is cleared. */
  minutesToBoard15: number;
  /** Median board being played when the 12-minute mark passes, in the first session. */
  boardAt12: number;
  /** Median, 25th and 75th percentile minutes per whole wave, for the tiers with session-length waves. */
  waveMinutes: Record<string, [number, number, number]>;
  /** Average minutes per board, by tier. */
  boardMinutes: Record<number, number>;
}

const quantile = (xs: number[], q: number) => {
  const a = xs.slice().sort((x, z) => x - z);
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN;
};

function paceOf(sessions: ReturnType<typeof makeSessions>, runs: { clock: number[] }[]): Pace {
  const minutesToBoard15 = quantile(runs.map((r) => r.clock[14] / 60), 0.5);
  const boardAt12 = quantile(runs.map((r) => r.clock.findIndex((c) => c > SESSION_TARGET_SECONDS) + 1), 0.5);
  const waveMinutes: Record<string, [number, number, number]> = {};
  for (const seg of SEGMENTS.filter((x) => x.start >= 21)) {
    const times: number[] = [];
    runs.forEach((r) => {
      for (let start = seg.start; start + seg.wave - 1 <= Math.min(seg.end, r.clock.length); start += seg.wave) {
        const end = start + seg.wave - 1;
        times.push((r.clock[end - 1] - r.clock[start - 2]) / 60);
      }
    });
    const label = seg.end === Infinity ? `boards ${seg.start}+ (${seg.wave}-board waves)` : `boards ${seg.start}–${seg.end} (${seg.wave}-board waves)`;
    waveMinutes[label] = [quantile(times, 0.5), quantile(times, 0.25), quantile(times, 0.75)];
  }
  const boardMinutes: Record<number, number> = {};
  const acc: Record<number, number[]> = {};
  runs.forEach((r, ri) => r.clock.forEach((c, i) => (acc[sessions[ri].picks[i].slot.tier] ??= []).push((c - (i ? r.clock[i - 1] : 0)) / 60)));
  for (const [t, v] of Object.entries(acc)) boardMinutes[Number(t)] = v.reduce((a, x) => a + x, 0) / v.length;
  return { minutesToBoard15, boardAt12, waveMinutes, boardMinutes };
}

export function loadInputs(): { lib: Library; samples: Samples } {
  const lib: Library = JSON.parse(readFileSync(new URL('../../src/library/boards.json', import.meta.url), 'utf8'));
  const samples: Samples = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
  return { lib, samples };
}

export function makeSessions(lib: Library, sessions = SESSIONS, boards = BOARDS) {
  return Array.from({ length: sessions }, (_, i) => ({ seed: 1000 + i, picks: sessionPicks(lib.boards, 1000 + i, boards) }));
}

export function evaluateSchedule(
  sessions: ReturnType<typeof makeSessions>,
  samples: Samples,
  schedule: SlackSchedule,
  players: readonly PlayerName[] = PLAYERS,
): Record<string, PlayerSummary> {
  const out: Record<string, PlayerSummary> = {};
  for (const player of players) {
    const runs = sessions.map((s) => simulateSession(s.picks, samples, schedule, player, s.seed));
    const roles: SlotRole[] = ['tutorial', 'build', 'peak', 'breather', 'cleanser'];
    const sum = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0);
    const boards = sum((r) => r.boards);
    out[player] = {
      firstTry: sum((r) => r.firstTry) / boards,
      worstFirstTry: Math.min(...runs.map((r) => r.firstTry / r.boards)),
      restartsPer100: (100 * sum((r) => r.restarts)) / boards,
      hintedPer100: (100 * sum((r) => r.hinted)) / boards,
      finalPool: sum((r) => r.finalPool) / runs.length,
      maxFinalPool: Math.max(...runs.map((r) => r.finalPool)),
      minMargin: Math.min(...runs.map((r) => r.minMargin)),
      failByRole: Object.fromEntries(
        roles.map((role) => {
          const b = sum((r) => r.byRole[role].boards);
          return [role, b ? sum((r) => r.byRole[role].failed) / b : 0];
        }),
      ) as Record<SlotRole, number>,
      avgSlack: sum((r) => r.slackTotal) / boards,
      poolCurve: runs[0].pools.map((_, i) => runs.reduce((a, r) => a + r.pools[i], 0) / runs.length),
      pace: paceOf(sessions, runs),
    };
  }
  return out;
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const f1 = (x: number) => x.toFixed(1);

function scheduleText(s: SlackSchedule): string {
  const r = s.role;
  return `build ${r.build}, peak ${r.peak}, breather ${r.breather}, cleanser ${r.cleanser}, tutorial ${r.tutorial}, +${s.perMovePct}% of rating, range ${s.min}–${s.max}`;
}

export function writeReport(path: string, schedule: SlackSchedule, res: Record<string, PlayerSummary>, tuning: string[]): void {
  const L: string[] = ['# Move economy report', ''];
  L.push(
    `Written by \`npx tsx gen/economy/tune.ts\`. ${SESSIONS} simulated sessions of ${BOARDS} boards per player, ` +
      `on the shipped board library. Schedule: ${scheduleText(schedule)}; welcome gift ${schedule.welcomeGift}.`,
    '',
  );
  L.push('## Players against the targets', '');
  L.push(
    'Plan targets: the careful player clears at least 90% of boards without a restart; the naive player needs ' +
      'restarts but always recovers. "Hinted" boards are ones finished by following the hints after three failed attempts.',
    '',
  );
  L.push('| Player | First-try clears (worst session) | Restarts per 100 boards | Hinted per 100 | Pool after board 100: avg (max) | Lowest margin over par at a board start |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of PLAYERS) {
    const r = res[p];
    L.push(`| ${p} | ${pct(r.firstTry)} (${pct(r.worstFirstTry)}) | ${f1(r.restartsPer100)} | ${f1(r.hintedPer100)} | ${f1(r.finalPool)} (${r.maxFinalPool}) | ${r.minMargin} |`);
  }
  L.push('');
  const c = res.careful;
  L.push(`- Careful player first try: ${pct(c.firstTry)}, target ≥ 90%: **${c.firstTry >= 0.9 ? 'met' : 'NOT met'}**.`);
  L.push(`- Naive player needs restarts (${f1(res.naive.restartsPer100)} per 100 boards) and always recovers: every board was finished, and the pool never fell below par at a board start (lowest margin ${res.naive.minMargin}).`);
  L.push(`- Average slack: ${f1(c.avgSlack)} moves per board.`, '');
  L.push('## The sawtooth in the move counter', '');
  L.push('Share of boards that needed a restart, by role in the wave.', '');
  L.push('| Player | Tutorial | Build | Peak | Breather | Cleanser |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of PLAYERS) {
    const f = res[p].failByRole;
    L.push(`| ${p} | ${pct(f.tutorial)} | ${pct(f.build)} | ${pct(f.peak)} | ${pct(f.breather)} | ${pct(f.cleanser)} |`);
  }
  L.push('', '## Session length', '');
  L.push(
    `Target: Block Blast's average session, about ${SESSION_TARGET_SECONDS / 60} minutes (AppMagic via Udonis, 2026). ` +
      `Times are estimates at ${SECONDS_PER_TAP} s per tap plus board and restart overheads (src/core/pacing.ts), ` +
      'to be calibrated with real taps in milestone 4. Restarted attempts count their taps.',
    '',
  );
  const waveKeys = Object.keys(res.medium.pace.waveMinutes);
  L.push(`| Player | First session: board at 12 min | Minutes to finish board 15 (first breather) | ${waveKeys.map((k) => `Wave minutes, ${k}: median (middle half)`).join(' | ')} |`);
  L.push(`| --- | --- | --- | ${waveKeys.map(() => '---').join(' | ')} |`);
  for (const p of PLAYERS) {
    const pc = res[p].pace;
    L.push(
      `| ${p} | ${pc.boardAt12} | ${f1(pc.minutesToBoard15)} | ${waveKeys.map((k) => { const [m, a, b] = pc.waveMinutes[k]; return `${f1(m)} (${f1(a)}–${f1(b)})`; }).join(' | ')} |`,
    );
  }
  L.push('', 'Average minutes per board by tier:', '');
  L.push(`| Player | ${[1, 2, 3, 4, 5, 6].map((t) => `Tier ${t}`).join(' | ')} |`);
  L.push(`| --- | ${[1, 2, 3, 4, 5, 6].map(() => '---').join(' | ')} |`);
  for (const p of PLAYERS) L.push(`| ${p} | ${[1, 2, 3, 4, 5, 6].map((t) => f1(res[p].pace.boardMinutes[t] ?? NaN)).join(' | ')} |`);
  L.push('', '## Pool size through a session', '');
  L.push('Average moves left after clearing each tenth board.', '');
  L.push(`| Player | ${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].join(' | ')} |`);
  L.push(`| --- | ${Array(10).fill('---').join(' | ')} |`);
  for (const p of PLAYERS) L.push(`| ${p} | ${[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => f1(res[p].poolCurve[n - 1])).join(' | ')} |`);
  L.push('');
  if (tuning.length) L.push('## Tuning', '', ...tuning, '');
  writeFileSync(path, L.join('\n'));
}

async function main() {
  const { lib, samples } = loadInputs();
  const sessions = makeSessions(lib);
  const tuning: string[] = [];
  if (!process.argv.includes('--report')) {
    const rows: { s: SlackSchedule; res: Record<string, PlayerSummary> }[] = [];
    for (const perMovePct of [0, 25, 50, 75, 100])
      for (const build of [0, 1, 2, 3, 4])
        for (const peakDrop of [1, 2, 3])
          for (const breatherLift of [1, 2, 3, 4]) {
            const s: SlackSchedule = {
              ...SLACK,
              perMovePct,
              role: { tutorial: SLACK.role.tutorial, build, peak: build - peakDrop, breather: build + breatherLift, cleanser: build + breatherLift },
            };
            rows.push({ s, res: evaluateSchedule(sessions, samples, s) });
          }
    // The plan's target, plus a cozy target for the typical (medium) player, plus a sawtooth the player can feel.
    const ok = rows.filter((r) => {
      const { careful, medium } = r.res;
      const f = medium.failByRole;
      const tutorialSafe = PLAYERS.every((p) => r.res[p].failByRole.tutorial === 0);
      return (
        careful.firstTry >= 0.9 &&
        careful.worstFirstTry >= 0.85 &&
        medium.firstTry >= 0.88 &&
        medium.firstTry <= 0.94 &&
        f.peak > f.build &&
        f.build > f.breather &&
        f.breather <= 0.05 &&
        tutorialSafe
      );
    });
    ok.sort((a, z) => a.res.careful.avgSlack - z.res.careful.avgSlack || z.res.medium.failByRole.peak - a.res.medium.failByRole.peak);
    tuning.push(
      `Grid search over ${rows.length} schedules (rating share 0–100%, build 0–4, peak 1–3 below build, breather 1–4 above; ` +
        `bank cap ${SLACK.bankCap}). Kept: careful player ≥ 90% first try overall and ≥ 85% in every session (plan); ` +
        'medium player 88–94% first try (cozy for a typical player); restarts on peaks > builds > breathers for the ' +
        'medium player, with breathers at most 5% (the sawtooth is felt); no restarts on the tutorial boards. ' +
        `${ok.length} schedules qualify, sorted by least slack. The shipped one is marked; see gen/economy/README.md for why.`,
      '',
      '| Schedule | Avg slack | Careful first try (worst) | Medium first try | Casual first try | Medium restarts: peak / build / breather |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const r of ok) {
      const f = r.res.medium.failByRole;
      const shipped = JSON.stringify(r.s) === JSON.stringify(SLACK) ? ' **(shipped)**' : '';
      tuning.push(
        `| ${scheduleText(r.s)}${shipped} | ${f1(r.res.careful.avgSlack)} | ${pct(r.res.careful.firstTry)} (${pct(r.res.careful.worstFirstTry)}) | ${pct(r.res.medium.firstTry)} | ${pct(r.res.casual.firstTry)} | ${pct(f.peak)} / ${pct(f.build)} / ${pct(f.breather)} |`,
      );
    }
    // Why a bank cap: the same schedule without one.
    const uncapped = evaluateSchedule(sessions, samples, { ...SLACK, bankCap: null });
    tuning.push(
      '',
      `Without the bank cap, the shipped schedule leaves the sharp player ${f1(uncapped.sharp.finalPool)} moves ` +
        `and the careful player ${f1(uncapped.careful.finalPool)} moves after board 100 (up to ${uncapped.sharp.maxFinalPool}), ` +
        'so the move counter stops mattering for a good player. With the cap, the bank stays near one board\'s worth, ' +
        'and overflow becomes stars or bottle decorations (plan: "If it gets too big, a cap can turn overflow into stars").',
    );
    console.log(tuning.join('\n'));
  }
  const res = evaluateSchedule(sessions, samples, SLACK);
  writeReport(new URL('./REPORT.md', import.meta.url).pathname, SLACK, res, tuning);
  console.log(`\nCurrent SLACK: careful ${pct(res.careful.firstTry)} first try; report written.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
