/**
 * Milestone 7: tune par and the move grant with bot runs, then write gen/tuning/REPORT.md and its charts.
 *
 *   npm run tuning                 # search (1,000 runs per bot per candidate), then 5,000 runs per bot on the winner
 *   npm run tuning -- --report     # only check the shipped TUNING (src/core/tuning.ts) with 5,000 runs per bot
 *   npm run tuning -- --minutes 12-15   # search with a different typical run length target
 *
 * Needs src/library/par-curves.json and gen/tuning/samples.json (npm run tuning:sample).
 */
import { writeFileSync } from 'node:fs';
import { SECONDS_PER_TAP } from '../../src/core';
import { TUNING, type Tuning } from '../../src/core/tuning';
import { TARGETS } from './targets';
import { BANDS, BOTS, BOT_LABEL, MAX_LEVELS, loadWorld, planFor, quantile, runBatch, summarize, type BatchResult, type Bot, type Summary, type World } from './simulate';
import { renderCharts } from './charts';

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const minutesArg = args[args.indexOf('--minutes') + 1];
if (args.includes('--minutes')) {
  const [lo, hi] = minutesArg.split('-').map(Number);
  TARGETS.typical.medianMinutes = [lo, hi];
}

export const SEARCH_RUNS = 1000;
export const FINAL_RUNS = 5000;
const SEEDS = 1000;

/** How far a value is outside [lo, hi], in units of `scale`, squared. */
const out = (x: number, lo: number, hi: number, scale: number) => {
  const d = x < lo ? lo - x : x > hi ? x - hi : 0;
  return (d / scale) ** 2;
};

export interface Check {
  name: string;
  value: string;
  target: string;
  ok: boolean;
  penalty: number;
}

export function checks(s: Record<Bot, Summary>): Check[] {
  const T = TARGETS;
  const ty = s.medium;
  const c: Check[] = [];
  const add = (name: string, v: number, lo: number, hi: number, scale: number, target: string, unit = '') => {
    const penalty = Number.isNaN(v) ? 1 : out(v, lo, hi, scale);
    c.push({ name, value: `${Number.isNaN(v) ? 'n/a' : v.toFixed(unit === ' min' ? 1 : 0)}${unit}`, target, ok: penalty === 0, penalty });
  };
  const [mlo, mhi] = T.typical.medianMinutes;
  add('Typical: median run length', ty.medianMinutes, mlo, mhi, 2, `${mlo}–${mhi} min`, ' min');
  add('Typical: runs over before 5 minutes', ty.under5, 0, T.typical.under5Max, 2, `≤ ${T.typical.under5Max}%`, '%');
  const [elo, ehi] = T.typical.earlyMakePar;
  add('Typical: make par or better, levels 1–10', ty.bands[0].makePar, elo, ehi, 5, `${elo}–${ehi}%`, '%');
  const [llo, lhi] = T.typical.lateMakePar;
  add('Typical: make par or better, levels 11–20', ty.bands[1].makePar, llo, lhi, 5, `${llo}–${lhi}%`, '%');
  for (const k of ['beat', 'par', 'over'] as const) {
    const t = T.typical.mix[k];
    add(`Typical: ${k === 'beat' ? 'beat par' : k === 'par' ? 'exactly par' : 'over par'}, all levels`, ty.mix[k], t - 7, t + 7, 4, `about ${t}%`, '%');
  }
  add('Casual: median run length', s.casual.medianMinutes, T.casual.medianMinutesMin, Infinity, 2, `≥ ${T.casual.medianMinutesMin} min`, ' min');
  const sharpBands = s.sharp.bands.filter((b) => b.played >= 200);
  const worstSharp = Math.min(...sharpBands.map((b) => b.beat));
  add('Sharp: beat par, worst level band', worstSharp, T.sharp.beatEveryBandMin, Infinity, 4, `≥ ${T.sharp.beatEveryBandMin}%`, '%');
  add('Sharp: median run length', s.sharp.medianMinutes, 0, T.sharp.medianMinutesMax, 5, `≤ ${T.sharp.medianMinutesMax} min`, ' min');
  add(`Sharp: runs still going at level ${MAX_LEVELS}`, s.sharp.capped, 0, T.sharp.cappedMax, 2, `≤ ${T.sharp.cappedMax}%`, '%');
  add('Typical: runs that end on a peak', ty.endOnPeak, T.endings.onPeakMin, Infinity, 5, `≥ ${T.endings.onPeakMin}%`, '%');
  add('Typical: runs that end 3 or fewer moves short', ty.shortBy3, T.endings.shortBy3Min, Infinity, 5, `≥ ${T.endings.shortBy3Min}%`, '%');
  add('Typical: levels started with fewer moves than par', ty.outOfReach, 0, T.typical.outOfReachMax, 1, `≤ ${T.typical.outOfReachMax}%`, '%');
  const unfair = BOTS.reduce((a, b) => a + s[b].fairness.poolCantBeat + s[b].fairness.grantBelowPar + s[b].fairness.parNotBeatable, 0);
  c.push({ name: 'Guarantees: levels where par could not be beaten (by the solver, or with the moves in hand)', value: String(unfair), target: '0', ok: unfair === 0, penalty: unfair ? 1e6 : 0 });
  return c;
}

function evaluate(w: World, t: Tuning, runs: number, seed = 1): { summaries: Record<Bot, Summary>; batches: Record<Bot, BatchResult>; checks: Check[]; penalty: number } {
  const plan = planFor(w, t);
  const batches = Object.fromEntries(BOTS.map((b) => [b, runBatch(w, plan, t, b, b === 'careful' ? Math.min(runs, 1000) : runs, seed)])) as Record<Bot, BatchResult>;
  const summaries = Object.fromEntries(BOTS.map((b) => [b, summarize(batches[b])])) as Record<Bot, Summary>;
  const c = checks(summaries);
  return { summaries, batches, checks: c, penalty: c.reduce((a, x) => a + x.penalty, 0) };
}

/** The search space: the shape of the make-par line, the sawtooth, and the bonus moves. */
function* candidates(): Generator<Tuning> {
  for (const early of [70, 75, 80])
    for (const late of [10, 15, 20, 25])
      for (const lateAt of [10, 12, 15, 20])
        for (const tail of [20, 40])
          for (const peak of [-10, -20, -30])
            for (const breather of [10, 20])
              for (const buildBonus of [-1, 0])
                for (const breatherBonus of [1, 2, 3])
                  yield {
                    makePar: [
                      [1, Math.min(95, early + 5)],
                      [5, early],
                      [lateAt, late],
                      // keeps tightening slowly, so even a sharp player's run ends
                      [lateAt + tail, Math.max(5, late - 10)],
                    ],
                    roleShift: { tutorial: 10, build: 0, peak, breather, cleanser: breather },
                    minCushion: 1,
                    bonus: { tutorial: 2, build: buildBonus, peak: -1, breather: breatherBonus, cleanser: breatherBonus },
                    welcomeGift: TUNING.welcomeGift,
                    bankCap: TUNING.bankCap,
                  };
}

const t0 = Date.now();
const world = loadWorld(SEEDS);
console.log(`World: ${SEEDS} board sequences of ${MAX_LEVELS} levels in ${Math.round((Date.now() - t0) / 1000)} s`);

let chosen: Tuning = TUNING;
let searched = 0;
let botRuns = 0;
const top: { t: Tuning; penalty: number; failed: string[] }[] = [];
if (!reportOnly) {
  for (const t of candidates()) {
    const r = evaluate(world, t, SEARCH_RUNS, 1);
    searched++;
    botRuns += SEARCH_RUNS * 3 + Math.min(SEARCH_RUNS, 1000);
    top.push({ t, penalty: r.penalty, failed: r.checks.filter((x) => !x.ok).map((x) => x.name) });
    top.sort((a, z) => a.penalty - z.penalty);
    if (top.length > 10) top.pop();
    if (searched % 200 === 0) console.log(`${searched} candidates, best penalty ${top[0].penalty.toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  console.log(`Searched ${searched} candidates (${botRuns.toLocaleString('en-US')} bot runs) in ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const x of top.slice(0, 5)) console.log(x.penalty.toFixed(3), JSON.stringify(x.t), x.failed.join('; '));
  chosen = top[0].t;
  console.log('\nBest tuning (paste into TUNING in src/core/tuning.ts):\n' + JSON.stringify(chosen, null, 2));
}

// Final check on fresh runs (a different seed from the search).
const final = evaluate(world, chosen, FINAL_RUNS, 2);
botRuns += FINAL_RUNS * 3 + 1000;
for (const x of final.checks) console.log(`${x.ok ? 'ok  ' : 'MISS'} ${x.name}: ${x.value} (target ${x.target})`);
renderCharts(final.batches, final.summaries, chosen, new URL('./', import.meta.url));
writeFileSync(new URL('./REPORT.md', import.meta.url), report(chosen, final.summaries, final.checks, reportOnly ? null : { searched, botRuns, top }));
console.log(`Wrote gen/tuning/REPORT.md in ${Math.round((Date.now() - t0) / 1000)} s`);

function report(t: Tuning, s: Record<Bot, Summary>, c: Check[], search: { searched: number; botRuns: number; top: typeof top } | null): string {
  const f0 = (x: number) => (Number.isNaN(x) ? '–' : x.toFixed(0));
  const f1 = (x: number) => (Number.isNaN(x) ? '–' : x.toFixed(1));
  const L: string[] = [];
  L.push('# Tuning report (milestone 7)', '');
  L.push('Generated by `npm run tuning`' + (search ? '' : ' -- --report') + '. Do not edit by hand.', '');
  if (search) {
    L.push(
      `Search: ${search.searched.toLocaleString('en-US')} candidate tunings × ${SEARCH_RUNS.toLocaleString('en-US')} runs per bot, then ${FINAL_RUNS.toLocaleString('en-US')} fresh runs per bot on the winner: ${search.botRuns.toLocaleString('en-US')} bot runs in all.`,
      '',
    );
  } else L.push(`${FINAL_RUNS.toLocaleString('en-US')} runs per bot on the shipped TUNING.`, '');
  L.push(`Play time is estimated at ${SECONDS_PER_TAP} s per lift plus 8 s per level (src/core/pacing.ts) until her playtest gives real times.`, '');
  L.push('## Targets', '', '| Check | Result | Target | |', '| --- | --- | --- | --- |');
  for (const x of c) L.push(`| ${x.name} | ${x.value} | ${x.target} | ${x.ok ? 'ok' : '**miss**'} |`);
  L.push('', '## Tuning', '', '```json', JSON.stringify(t, null, 2), '```', '');
  L.push('## Runs by bot', '', '| Bot | Median run | Middle half | 10%–90% | Levels (median, 10%–90%) | Under 5 min | Median score | Beat / par / over | Started below par |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const b of BOTS) {
    const x = s[b];
    L.push(
      `| ${BOT_LABEL[b]} | ${f1(x.medianMinutes)} min | ${f1(x.p25Minutes)}–${f1(x.p75Minutes)} min | ${f1(x.p10Minutes)}–${f1(x.p90Minutes)} min | ${x.medianLevels} (${x.p10Levels}–${x.p90Levels}) | ${f0(x.under5)}% | ${x.medianScore.toLocaleString('en-US')} | ${f0(x.mix.beat)} / ${f0(x.mix.par)} / ${f0(x.mix.over)}% | ${f1(x.outOfReach)}% |`,
    );
  }
  L.push('', '## How each level band goes', '', 'Share of levels played in the band: beat par / exactly par / over par / ran out (the run ended there).', '');
  L.push('| Levels | ' + BOTS.map((b) => BOT_LABEL[b].split(' (')[0]).join(' | ') + ' |', '| --- |' + BOTS.map(() => ' --- |').join(''));
  BANDS.forEach((band, i) => {
    const cells = BOTS.map((b) => {
      const r = s[b].bands[i];
      return r.played < 100 ? '(few runs get here)' : `${f0(r.beat)} / ${f0(r.par)} / ${f0(r.over)} / ${f0(r.out)}`;
    });
    L.push(`| ${band[0]}–${band[1] === MAX_LEVELS ? band[1] : band[1]} | ${cells.join(' | ')} |`);
  });
  L.push('', '## How runs end', '', '| Bot | End on a peak | 1 move short | 3 or fewer short |', '| --- | --- | --- | --- |');
  for (const b of BOTS) L.push(`| ${BOT_LABEL[b]} | ${f0(s[b].endOnPeak)}% | ${f0(s[b].shortBy1)}% | ${f0(s[b].shortBy3)}% |`);
  if (search) {
    L.push('', '## Runner-up tunings', '', '| Penalty | Tuning | Missed |', '| --- | --- | --- |');
    for (const x of search.top.slice(1, 6)) L.push(`| ${x.penalty.toFixed(2)} | \`${JSON.stringify({ makePar: x.t.makePar, roleShift: x.t.roleShift, bonus: x.t.bonus })}\` | ${x.failed.join('; ') || 'none'} |`);
  }
  L.push('', '## Charts', '', '![Make par by level](make-par.svg)', '', '![Runs still going](survival.svg)', '', '![Moves banked](bank.svg)', '');
  return L.join('\n');
}

export { quantile };
