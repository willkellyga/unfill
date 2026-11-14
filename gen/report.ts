import { writeFileSync } from 'node:fs';
import { pickBoard, slotFor, type Library, type LibraryEntry, type Pick } from '../src/core';
import { BEAM_WIDTH, POPULATION, tierFailures, type TierSpec } from './tiers';

export interface TierRun {
  spec: TierSpec;
  entries: LibraryEntry[];
  tried: number;
  reasons: Record<string, number>;
  /** Boards where exact search found a shorter solution than the beam. */
  exactShorter: number;
  seconds: number;
}

/** The plan's repose-rule par figures (from the solver experiment), for comparison with column gravity. */
const PLAN_REPOSE_PAR: Record<number, number> = { 1: 5.0, 2: 5.6, 3: 6.6, 4: 9.3, 5: 9.9, 6: 11.4 };

const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const ok = (pass: boolean) => (pass ? 'yes' : '**NO**');

export function writeReport(path: string, runs: TierRun[], library: Library): void {
  const L: string[] = [];
  L.push('# Board library report', '');
  L.push(
    `Written by \`npm run gen\`. ${library.boards.length} boards, sand rule \`${library.rule}\`, beam ${BEAM_WIDTH}. ` +
      `Difficulty is the average extra moves over par that the simulated players need ` +
      `(${POPULATION.map((p) => `${p.name} ×${p.runs}`).join(', ')}).`,
    '',
  );

  L.push('## Tiers against their targets', '');
  L.push('| Tier | Size | Boards | Par avg [range] | Target par | Plan (repose) par | Careful gap avg (min) | Naive gap avg | Singles share avg (max) | Opening avg (min) | All in range |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of runs) {
    const s = r.spec;
    const E = r.entries;
    const pars = E.map((e) => e.par);
    const cg = E.map((e) => e.metrics.carefulGap);
    const share = E.map((e) => e.metrics.singles / e.par);
    const open = E.map((e) => e.metrics.opening);
    const fails = E.filter((e) => tierFailures(s, e).length).length;
    L.push(
      `| ${s.tier} | ${s.cols}×${s.rows}, ${s.colors} colors | ${E.length} | ${f1(avg(pars))} [${Math.min(...pars)}–${Math.max(...pars)}] | ${s.par[0]}–${s.par[1]} | ${f1(PLAN_REPOSE_PAR[s.tier])} | ` +
        `${f2(avg(cg))} (${Math.min(...cg)}; target ≥ ${s.minCarefulGap}) | ${f2(avg(E.map((e) => e.metrics.naiveGap)))} | ` +
        `${Math.round(100 * avg(share))}% (${Math.round(100 * Math.max(...share))}%; target ≤ ${Math.round(100 * s.maxSinglesShare)}%) | ` +
        `${f1(avg(open))} (${Math.min(...open)}; target ≥ ${s.minOpening}) | ${ok(fails === 0)} |`,
    );
  }
  L.push('');

  L.push('## Difficulty by tier', '');
  L.push('Average extra moves over par, per simulated player and overall (the rating). Spread is the easiest and hardest board.', '');
  L.push(`| Tier | ${POPULATION.map((p) => p.name).join(' | ')} | Rating avg | Easiest – hardest |`);
  L.push(`| --- | ${POPULATION.map(() => '---').join(' | ')} | --- | --- |`);
  for (const r of runs) {
    const E = r.entries;
    const ex = E.map((e) => e.metrics.excess100 / 100);
    L.push(
      `| ${r.spec.tier} | ${POPULATION.map((p) => f2(avg(E.map((e) => e.metrics.players[p.name] / 100)))).join(' | ')} | ${f2(avg(ex))} | ${f2(Math.min(...ex))} – ${f2(Math.max(...ex))} |`,
    );
  }
  L.push('');

  L.push('## Solver checks', '');
  L.push('| Tier | Candidates tried | Kept | Rejected for | Exact search | Time |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of runs) {
    const rej = Object.entries(r.reasons)
      .sort((a, z) => z[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    const proven = r.entries.filter((e) => e.proven === true).length;
    const ran = r.entries.filter((e) => e.proven !== null).length;
    const exact = ran ? `${proven}/${ran} proven minimal; beam beaten on ${r.exactShorter}` : 'not run (board too big)';
    L.push(`| ${r.spec.tier} | ${r.tried} | ${r.entries.length} | ${rej || '–'} | ${exact} | ${Math.round(r.seconds)} s |`);
  }
  L.push('');

  // Progression preview: one simulated run of 100 boards.
  L.push('## Progression preview (one run, boards 1–100)', '');
  L.push(
    'One line per wave: each board as its role (T tutorial, B build, P peak, R breather, C small-tray cleanser), ' +
      "tier and rating in extra moves over par. Waves restart at each new tier, and from board 21 one wave is about " +
      'one 12-minute session for a typical player (gen/economy/REPORT.md).',
    '',
  );
  const recent: string[] = [];
  const picks: Pick[] = [];
  for (let n = 1; n <= 100; n++) {
    const p = pickBoard(library.boards, n, 1, new Set(recent));
    recent.push(p.entry.id);
    if (recent.length > 200) recent.shift();
    picks.push(p);
  }
  const roleLetter = { tutorial: 'T', build: 'B', peak: 'P', breather: 'R', cleanser: 'C' } as const;
  let row: Pick[] = [];
  for (const p of picks) {
    row.push(p);
    const ends = p.slot.role === 'breather' || p.slot.role === 'cleanser' || (p.slot.role === 'tutorial' && p.slot.n === 3) || p.slot.n === 100;
    if (!ends) continue;
    const cells = row.map((q) => `${roleLetter[q.slot.role]}${q.slot.tier} ${f1(q.entry.metrics.excess100 / 100)}`);
    L.push(`- Boards ${row[0].slot.n}–${p.slot.n}: ${cells.join(' · ')}`);
    row = [];
  }
  L.push('');
  const byRole = (role: string, from: number) => avg(picks.filter((p) => p.slot.n >= from && p.slot.role === role).map((p) => p.entry.metrics.excess100 / 100));
  L.push(
    `Boards 21–100 by role: build ${f2(byRole('build', 21))}, peak ${f2(byRole('peak', 21))}, breather ${f2(byRole('breather', 21))}, ` +
      `cleanser ${f2(byRole('cleanser', 21))} extra moves on average.`,
    '',
  );
  L.push(`Slot rules: ${[1, 4, 9, 10, 21, 27, 28, 45, 57, 58, 71, 72].map((n) => { const s = slotFor(n); return `board ${n} → tier ${s.tier} ${s.role} @${s.target}`; }).join('; ')}.`, '');
  writeFileSync(path, L.join('\n'));
}
