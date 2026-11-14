/**
 * `npm run gen`: generate, solve, measure and filter boards, then write the board library and a report.
 *
 *   npm run gen                         # the full library (about 2,400 boards; ~20 min on 4 cores)
 *   npm run gen -- --scale 0.05         # a quick small library, for trying changes
 *   npm run gen -- --threads 8 --out some/where.json
 *
 * The output is deterministic: candidates are generated from fixed seeds and kept in index order, so the same
 * code always writes the same library, whatever the number of threads.
 */
import { Worker } from 'node:worker_threads';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { LIBRARY_RULE, type Library, type LibraryEntry } from '../src/core';
import type { Candidate } from './evaluate';
import { BEAM_WIDTH, POPULATION, TIERS, type TierSpec } from './tiers';
import { writeReport, type TierRun } from './report';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = opt('out', 'src/library/boards.json');
const reportPath = opt('report', 'gen/REPORT.md');
const threads = Number(opt('threads', String(Math.max(1, availableParallelism()))));
const scale = Number(opt('scale', '1'));
const onlyTiers = opt('tiers', '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const BATCH = 4;

async function runTier(spec: TierSpec, workers: Worker[]): Promise<TierRun> {
  const want = Math.max(1, Math.round(spec.count * scale));
  const started = Date.now();
  const results = new Map<number, Candidate>();
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  const reasons: Record<string, number> = {};
  let nextIndex = 0;
  let consumed = 0;
  let done = false;

  const consume = () => {
    while (!done && results.has(consumed)) {
      const c = results.get(consumed)!;
      results.delete(consumed);
      consumed++;
      if (!c.ok) reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
      else if (seen.has(c.key)) reasons.duplicate = (reasons.duplicate ?? 0) + 1;
      else {
        seen.add(c.key);
        kept.push(c);
        if (kept.length >= want) done = true;
      }
    }
  };

  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.on('error', reject);
          const next = () => {
            if (done) {
              w.off('error', reject);
              return resolve();
            }
            const indices = Array.from({ length: BATCH }, (_, k) => nextIndex + k);
            nextIndex += BATCH;
            w.once('message', (batch: Candidate[]) => {
              for (const c of batch) results.set(c.index, c);
              consume();
              const pct = Math.min(100, Math.round((100 * kept.length) / want));
              if (process.stdout.isTTY) process.stdout.write(`\r  tier ${spec.tier}: ${kept.length}/${want} kept (${pct}%), ${consumed} tried   `);
              next();
            });
            w.postMessage({ tier: spec.tier, indices });
          };
          next();
        }),
    ),
  );
  console.log(`  tier ${spec.tier}: kept ${kept.length} of ${consumed} tried in ${Math.round((Date.now() - started) / 1000)} s`);

  // Rank by difficulty within the tier: 0 is the easiest board, 999 the hardest. Ties keep generation order.
  const okKept = kept as Extract<Candidate, { ok: true }>[];
  const entries = okKept.map((c) => c.entry);
  const exactShorter = okKept.filter((c) => c.entry.par < c.beamPar).length;
  const order = entries.map((_, i) => i).sort((a, z) => entries[a].metrics.excess100 - entries[z].metrics.excess100 || a - z);
  const ranked: LibraryEntry[] = new Array(entries.length);
  order.forEach((ei, pos) => {
    ranked[ei] = {
      id: `t${spec.tier}-${String(ei).padStart(4, '0')}`,
      ...entries[ei],
      rank: Math.floor((1000 * pos) / entries.length),
    };
  });
  return { spec, entries: ranked, tried: consumed, reasons, exactShorter, seconds: (Date.now() - started) / 1000 };
}

async function main() {
  const tiers = TIERS.filter((t) => !onlyTiers.length || onlyTiers.includes(t.tier));
  console.log(`Generating ${tiers.length} tiers on ${threads} threads (beam ${BEAM_WIDTH}, rule ${LIBRARY_RULE})`);
  const workers = Array.from({ length: threads }, () => new Worker(new URL('./worker.ts', import.meta.url)));
  const runs: TierRun[] = [];
  try {
    for (const spec of tiers) runs.push(await runTier(spec, workers));
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  const library: Library = {
    version: 1,
    rule: LIBRARY_RULE,
    generator: `gen beam=${BEAM_WIDTH} population=${POPULATION.map((p) => `${p.name}x${p.runs}`).join(',')}`,
    boards: runs.flatMap((r) => r.entries),
  };
  mkdirSync(dirname(out), { recursive: true });
  // One board per line keeps the file readable and diffs small.
  writeFileSync(
    out,
    `{"version":${library.version},"rule":${JSON.stringify(library.rule)},"generator":${JSON.stringify(library.generator)},"boards":[\n` +
      library.boards.map((b) => JSON.stringify(b)).join(',\n') +
      '\n]}\n',
  );
  writeReport(reportPath, runs, library);
  console.log(`Wrote ${library.boards.length} boards to ${out} and the report to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
