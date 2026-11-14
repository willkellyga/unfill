/**
 * After a playtest: line a real player up against the bots, on the very boards she played.
 *
 *   npm run tuning:calibrate -- UNFILL1:...        # the code from Settings › Move your progress
 *   npm run tuning:calibrate -- path/to/code.txt
 *
 * It reads the shelf (every cleared level keeps its board id, lifts and time from milestone 7 on) and reports:
 *   - which bot plays most like her (likelihood of her lifts under each bot's recorded games on those boards),
 *   - where she sits within the typical bot on average (50% = exactly typical, lower = better than typical),
 *   - her real seconds per lift, to replace the 5 s estimate in src/core/pacing.ts,
 *   - her runs (levels reached), to compare with REPORT.md.
 * Then change TUNING or TARGETS and re-run `npm run tuning`. For the automatic playtest Sheet, use playtest.ts instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Keepsake } from '../../src/core';
import { SECONDS_PER_BOARD } from '../../src/core';
import { boardById, botMatch } from './match';
import { BOT_LABEL, quantile } from './simulate';

const arg = process.argv.slice(2).join('').trim();
if (!arg) {
  console.log('Usage: npm run tuning:calibrate -- UNFILL1:... (or a file holding the code)');
  process.exit(1);
}
const code = (existsSync(arg) ? readFileSync(arg, 'utf8') : arg).replace(/\s+/g, '');
if (!code.startsWith('UNFILL1:')) throw new Error('Not a progress code (it should start with UNFILL1:)');
const data = JSON.parse(Buffer.from(code.slice(8), 'base64url').toString('utf8')) as { shelf: Keepsake[]; best: number };
const shelf = (data.shelf ?? []).slice().sort((a, z) => a.at - z.at);


// Runs: a level 1 after a later level starts a new run.
const runs: number[] = [];
for (const k of shelf) {
  if (!runs.length || k.n <= 1) runs.push(0);
  runs[runs.length - 1] = Math.max(runs[runs.length - 1], k.n);
}
console.log(`${shelf.length} cleared levels on the shelf, ${runs.length} runs; best score ${data.best ?? 0}`);
console.log(`Levels reached per run: ${runs.join(', ')} (median ${quantile(runs, 0.5)})`);

// Time per lift, from levels cleared within 5 minutes of the one before (the same sitting).
const perLift: number[] = [];
for (let i = 1; i < shelf.length; i++) {
  const gap = (shelf[i].at - shelf[i - 1].at) / 1000;
  if (gap > 0 && gap < 300 && shelf[i].n === shelf[i - 1].n + 1) perLift.push((gap - SECONDS_PER_BOARD) / shelf[i].lifts);
}
if (perLift.length) console.log(`Seconds per lift: median ${quantile(perLift, 0.5).toFixed(1)} over ${perLift.length} levels (estimate in pacing.ts: 5)`);

// Which bot plays most like her.
const known = shelf.filter((k) => k.id && boardById(k.id));
console.log(`${known.length} levels have a board id to compare with the bots (levels cleared before milestone 7 don't).`);
const m = botMatch(known.map((k) => ({ board: k.id!, lifts: k.lifts })));
if (m) {
  console.log('\nHow likely her lifts are under each bot (higher is closer):');
  for (const b of m.ranked) console.log(`  ${BOT_LABEL[b].padEnd(40)} ${m.perLevel[b].toFixed(3)} per level`);
  console.log(`\nShe plays closest to: ${BOT_LABEL[m.ranked[0]]}.`);
  console.log(`Against the typical bot she sits at the ${m.typicalPercentile.toFixed(0)}th percentile on average (50 = typical; lower = fewer moves).`);
  if (m.levels < 20) console.log('Fewer than 20 levels: treat this as a first look (skill estimates settle after 10–20 levels).');
}
