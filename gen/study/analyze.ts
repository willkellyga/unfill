/**
 * Which measure best predicts how hard a board is? Reads the JSON lines written by measure.ts and prints, per tier,
 * the rank correlation (Spearman) of each candidate measure with the simulated-player rating.
 *
 *   npx tsx gen/study/analyze.ts gen/study/study-2026-11-14.jsonl
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const rows: Rec[] = process.argv
  .slice(2)
  .flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean))
  .map((l) => JSON.parse(l));

const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
function ranks(v: number[]): number[] {
  const idx = v.map((_, i) => i).sort((a, z) => v[a] - v[z]);
  const r = new Array(v.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
    for (let k = i; k <= j; k++) r[idx[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

const players = ['casual', 'medium', 'sharp', 'random'];
for (const r of rows) {
  for (const p of players) {
    const runs: number[] = r[p];
    const h = runs.length >> 1;
    r[`${p}Mean`] = mean(runs);
    r[`${p}A`] = mean(runs.slice(0, h));
    r[`${p}B`] = mean(runs.slice(h));
  }
  r.rating = (r.casualMean + r.mediumMean + r.sharpMean) / 3;
  r.ratingA = (r.casualA + r.mediumA + r.sharpA) / 3;
  r.ratingB = (r.casualB + r.mediumB + r.sharpB) / 3;
}
const size = (t: string) => t.split(/[xc]/).map(Number);
const tiers = [...new Set(rows.map((r) => r.tier as string))].sort((a, z) => {
  const [ac, ar, ak] = size(a);
  const [zc, zr, zk] = size(z);
  return ac * ar - zc * zr || ak - zk;
});
const by = (t: string) => rows.filter((r) => r.tier === t);
const f2 = (x: number) => x.toFixed(2);

console.log('| Tier | Boards | Par avg | casual | medium | sharp | random | Rating split-half reliability |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const t of tiers) {
  const R = by(t);
  console.log(
    `| ${t} | ${R.length} | ${f2(mean(R.map((r) => r.par)))} | ${players.map((p) => f2(mean(R.map((r) => r[`${p}Mean`])))).join(' | ')} | ${f2(spearman(R.map((r) => r.ratingA), R.map((r) => r.ratingB)))} |`,
  );
}
console.log('');
const cands: [string, string][] = [
  ['par', 'Par'],
  ['careful', 'Careful-player gap'],
  ['naive', 'Naive-player gap'],
  ['open', 'Opening choices'],
  ['singles', 'Singles in par solution'],
  ['key', 'Key moves (plan)'],
  ['costlyShare', 'Share of costly choices per step'],
  ['firstCostly', 'Share of costly first moves'],
  ['randomMean', 'Random-player gap'],
];
console.log(`| Measure | ${tiers.join(' | ')} |`);
console.log(`| --- | ${tiers.map(() => '---').join(' | ')} |`);
for (const [k, label] of cands) {
  console.log(`| ${label} | ${tiers.map((t) => f2(spearman(by(t).map((r) => r[k]), by(t).map((r) => r.rating)))).join(' | ')} |`);
}
console.log(`| Sharp vs casual player agreement | ${tiers.map((t) => f2(spearman(by(t).map((r) => r.sharpMean), by(t).map((r) => r.casualMean)))).join(' | ')} |`);
