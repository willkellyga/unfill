/**
 * `npm run daily`: build the Daily Puzzle pool (src/library/daily.json) from the board library.
 *
 *   1. For each tier the week uses, rank its boards by how much a clever order beats greedy play.
 *   2. Prove the true minimum of the best candidates with the exact prover (prove.ts), on all cores. A board whose
 *      proof doesn't finish within its node budget is left out: "Best possible" must really be the best.
 *   3. Give each weekday its boards (Monday small, building to a big 5-color Sunday) and its move allowance.
 *
 *   npm run daily -- --cached   # rebuild from the cached proofs only
 *
 * Proofs are cached in gen/daily/proofs.json (by board id and node budget), so a rerun only proves new candidates.
 * Everything is deterministic: node budgets, not clocks, cap the work.
 */
import { Worker } from 'node:worker_threads';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import {
  LIBRARY_RULE,
  attachParCurves,
  carefulPlay,
  entryBoard,
  isCleared,
  naivePlay,
  replay,
  type Library,
  type LibraryEntry,
} from '../../src/core';
import { DAILY_WEEK, type DailyPool } from '../../src/core/daily';
import { CANDIDATES, NODE_BUDGET, cleverness } from './plan';

interface Proof {
  id: string;
  budget: number;
  complete: boolean;
  best: number[];
  startBound: number;
  nodes: number;
  ms: number;
}

const CACHE = 'gen/daily/proofs.json';
const OUT = 'src/library/daily.json';
const threads = Math.max(1, availableParallelism());

const lib = JSON.parse(readFileSync('src/library/boards.json', 'utf8')) as Library;
const curves = JSON.parse(readFileSync('src/library/par-curves.json', 'utf8'));
const boards = attachParCurves(lib.boards, curves);
const cache: Record<string, Proof> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
const cacheKey = (id: string, budget: number) => `${id}@${budget}`;
/** A cached proof that settles this board at this budget: any finished proof, or a try with at least this budget. */
function cached(id: string, budget: number): Proof | undefined {
  let found: Proof | undefined;
  for (const p of Object.values(cache)) {
    if (p.id !== id) continue;
    if (p.complete) return p;
    if (p.budget >= budget) found = p;
  }
  return found;
}

function saveCache(): void {
  const keys = Object.keys(cache).sort();
  writeFileSync(CACHE, '{\n' + keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(cache[k])}`).join(',\n') + '\n}\n');
}

async function proveAll(jobs: { entry: LibraryEntry; budget: number }[]): Promise<void> {
  const todo = jobs.filter((j) => !cached(j.entry.id, j.budget));
  console.log(`${jobs.length} candidates, ${todo.length} to prove on ${threads} threads`);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: threads }, () => new Worker(new URL('./worker.ts', import.meta.url)));
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.on('error', reject);
          const step = () => {
            if (next >= todo.length) return resolve();
            const job = todo[next++];
            w.once('message', (p: Proof) => {
              cache[cacheKey(p.id, p.budget)] = p;
              done++;
              if (done % 10 === 0 || done === todo.length) {
                saveCache();
                console.log(`  ${done}/${todo.length} proved or tried`);
              }
              step();
            });
            w.postMessage(job);
          };
          step();
        }),
    ),
  );
  await Promise.all(workers.map((w) => w.terminate()));
  saveCache();
}

async function main() {
  const jobs: { entry: LibraryEntry; budget: number }[] = [];
  for (const [tierText, count] of Object.entries(CANDIDATES)) {
    const tier = Number(tierText);
    const ranked = boards
      .filter((b) => b.tier === tier)
      .sort((a, z) => cleverness(z) - cleverness(a) || (a.id < z.id ? -1 : 1))
      .slice(0, count);
    for (const entry of ranked) jobs.push({ entry, budget: NODE_BUDGET[tier] });
  }
  // --cached: build from the proofs already cached, without proving anything new (for a quick look)
  if (!process.argv.includes('--cached')) await proveAll(jobs);

  // Proven boards, with their metrics measured against the true minimum.
  const proven = jobs.flatMap(({ entry, budget }) => {
    const p = cached(entry.id, budget);
    if (!p || !p.complete) return [];
    const b = entryBoard(entry);
    if (!isCleared(replay(b, p.best, LIBRARY_RULE))) throw new Error(`${entry.id}: proof's solution does not clear`);
    const best = p.best.length;
    const careful = carefulPlay(b, LIBRARY_RULE).length - best;
    const naive = naivePlay(b, LIBRARY_RULE).length - best;
    // the typical player's extra moves over the TRUE best, at each stored quantile
    const curve = (entry as LibraryEntry & { curve?: number[] }).curve?.map((x) => x + entry.par - best) ?? null;
    return [{ entry, best, solution: p.best, careful, naive, curve }];
  });

  const pool: DailyPool = { version: 1, epoch: DAILY_WEEK.epoch, days: [] };
  for (let wd = 0; wd < 7; wd++) {
    const spec = DAILY_WEEK.days[wd];
    const fits = proven
      .filter((p) => p.entry.tier === spec.tier && p.careful >= spec.minTrap)
      .sort((a, z) => cleverness(a.entry, a.careful) - cleverness(z.entry, z.careful) || (a.entry.id < z.entry.id ? -1 : 1));
    // Two weekdays can share a tier: the earlier one takes the gentler half, the later one the trickier half.
    const sharers = DAILY_WEEK.days.filter((d) => d.tier === spec.tier);
    const share = sharers.indexOf(spec);
    const part = sharers.length > 1 ? fits.slice(Math.floor((share * fits.length) / sharers.length), Math.floor(((share + 1) * fits.length) / sharers.length)) : fits;
    const list = part.map((p) => {
      const q = p.curve ? p.curve[curves.quantiles.indexOf(spec.allowQuantile)] : 3;
      return { id: p.entry.id, best: p.best, solution: p.solution, allowed: p.best + Math.max(spec.minSpare, q), trap: p.careful };
    });
    pool.days.push(list);
    console.log(`${spec.name}: tier ${spec.tier}, ${list.length} boards (best ${Math.min(...list.map((d) => d.best))}-${Math.max(...list.map((d) => d.best))})`);
  }
  writeFileSync(
    OUT,
    `{"version":${pool.version},"epoch":${JSON.stringify(pool.epoch)},"days":[\n` +
      pool.days.map((list) => '[\n' + list.map((d) => JSON.stringify(d)).join(',\n') + '\n]').join(',\n') +
      '\n]}\n',
  );
  const better = proven.filter((p) => p.best < p.entry.par).length;
  console.log(`Wrote ${OUT}. ${proven.length} proven of ${jobs.length}; ${better} were shorter than the library's par.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
