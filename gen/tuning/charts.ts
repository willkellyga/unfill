/**
 * Plain SVG charts for gen/tuning/REPORT.md: make-par rate by level, runs still going by minute, moves banked by
 * level. No dependencies, so they render on GitHub and in any browser.
 */
import { writeFileSync } from 'node:fs';
import { parChance, type Tuning } from '../../src/core/tuning';
import { slotFor } from '../../src/core';
import { BOTS, BOT_LABEL, MAX_LEVELS, type BatchResult, type Bot, type Summary } from './simulate';

const COLORS: Record<Bot, string> = { casual: '#d08a3e', medium: '#3a7bd5', sharp: '#2f9e6a', careful: '#8a63c9' };
const W = 760;
const H = 360;
const M = { l: 56, r: 170, t: 36, b: 44 };

interface Series {
  name: string;
  color: string;
  pts: [number, number][];
  dash?: string;
}

function lineChart(title: string, xLabel: string, yLabel: string, xMax: number, yMax: number, series: Series[], yTicks: number[], xTicks: number[]): string {
  const x = (v: number) => M.l + ((W - M.l - M.r) * v) / xMax;
  const y = (v: number) => H - M.b - ((H - M.t - M.b) * v) / yMax;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`);
  o.push(`<rect width="${W}" height="${H}" fill="#fffdf8"/>`);
  o.push(`<text x="${M.l}" y="22" font-size="15" font-weight="600" fill="#333">${title}</text>`);
  for (const t of yTicks) o.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e6e0d4"/><text x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end" fill="#666">${t}</text>`);
  for (const t of xTicks) o.push(`<text x="${x(t)}" y="${H - M.b + 18}" text-anchor="middle" fill="#666">${t}</text>`);
  o.push(`<text x="${(M.l + W - M.r) / 2}" y="${H - 8}" text-anchor="middle" fill="#444">${xLabel}</text>`);
  o.push(`<text transform="translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)" text-anchor="middle" fill="#444">${yLabel}</text>`);
  series.forEach((s, i) => {
    if (s.pts.length) {
      const d = s.pts.map(([a, b], k) => `${k ? 'L' : 'M'}${x(a).toFixed(1)},${y(Math.min(b, yMax)).toFixed(1)}`).join('');
      o.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
    }
    const ly = M.t + 10 + i * 20;
    o.push(`<line x1="${W - M.r + 14}" x2="${W - M.r + 34}" y1="${ly}" y2="${ly}" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/><text x="${W - M.r + 40}" y="${ly + 4}" fill="#333">${s.name}</text>`);
  });
  o.push('</svg>');
  return o.join('\n');
}

/** Moving average over a window of levels, skipping levels too few runs reach. */
function smoothed(res: BatchResult, f: (l: BatchResult["byLevel"][number]) => [number, number], window = 5, minPlayed = 100, scale = 1): [number, number][] {
  const pts: [number, number][] = [];
  for (let n = 1; n <= res.byLevel.length; n++) {
    let num = 0;
    let den = 0;
    for (let k = Math.max(1, n - Math.floor(window / 2)); k <= Math.min(res.byLevel.length, n + Math.floor(window / 2)); k++) {
      const [a, b] = f(res.byLevel[k - 1]);
      num += a;
      den += b;
    }
    if (res.byLevel[n - 1].played < minPlayed) break;
    pts.push([n, den ? (scale * num) / den : 0]);
  }
  return pts;
}

export function renderCharts(batches: Record<Bot, BatchResult>, _s: Record<Bot, Summary>, t: Tuning, dir: URL): void {
  const xMax = 100;
  const target: [number, number][] = [];
  for (let n = 1; n <= xMax; n++) target.push([n, parChance(n, slotFor(n).role, t)]);
  const makePar = lineChart(
    'Made par or better, by level (5-level average)',
    'Level in the run',
    'Percent of levels',
    xMax,
    100,
    [
      ...BOTS.map((b) => ({ name: BOT_LABEL[b].split(' (')[0], color: COLORS[b], pts: smoothed(batches[b], (l) => [l.beat + l.par, l.played], 5, 100, 100).filter(([n]) => n <= xMax) })),
      { name: 'aim for typical', color: '#999', pts: target, dash: '4 3' },
    ],
    [0, 25, 50, 75, 100],
    [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  );
  writeFileSync(new URL('make-par.svg', dir), makePar);

  const tMax = 90;
  const survival = lineChart(
    'Runs still going, by minutes played',
    'Minutes (estimated)',
    'Percent of runs',
    tMax,
    100,
    BOTS.map((b) => {
      const m = batches[b].minutes.slice().sort((a, z) => a - z);
      const pts: [number, number][] = [];
      for (let k = 0; k <= tMax; k++) pts.push([k, (100 * m.filter((v) => v > k).length) / m.length]);
      return { name: BOT_LABEL[b].split(' (')[0], color: COLORS[b], pts };
    }),
    [0, 25, 50, 75, 100],
    [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  );
  writeFileSync(new URL('survival.svg', dir), survival);

  const bank = lineChart(
    `Moves banked after each level (runs still going; cap ${t.bankCap})`,
    'Level in the run',
    'Moves',
    xMax,
    t.bankCap + 1,
    BOTS.map((b) => ({ name: BOT_LABEL[b].split(' (')[0], color: COLORS[b], pts: smoothed(batches[b], (l) => [l.bank, l.played - l.out], 1).filter(([n]) => n <= xMax) })),
    [0, 5, 10, 15],
    [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  );
  writeFileSync(new URL('bank.svg', dir), bank);
  void MAX_LEVELS;
}
