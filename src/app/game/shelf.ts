import type { Keepsake } from '../../core';
import { SAND_HEX } from './palette';

/**
 * The shelf: every bottle she has corked, newest first. Each is drawn as a small picture of the real bottle, its
 * sand layers being her lifts in order and in color, sized by how many blocks each lift held, with soft wavy
 * edges like hand-poured sand art. A bottle that turned spare moves into a ribbon wears it on its neck.
 */

// The 3D bottle's profile (radius, height) in its own units, drawn at K px per unit.
const PROFILE: [number, number][] = [
  [0.7, 0],
  [0.78, 0.07],
  [0.78, 1.96],
  [0.75, 2.14],
  [0.62, 2.34],
  [0.42, 2.5],
  [0.29, 2.62],
  [0.265, 2.95],
  [0.31, 2.99],
  [0.325, 3.06],
  [0.28, 3.1],
];
const K = 30;
const CX = 32;
const BASE = 112;
const FLOOR = 0.07;
const BODY_TOP = 1.96;
const INNER = 0.7;

const X = (r: number) => r * K;
const Y = (y: number) => BASE - y * K;
const f1 = (v: number) => v.toFixed(1);

const OUTLINE = (() => {
  const right = PROFILE.map(([r, y]) => `${f1(CX + X(r))},${f1(Y(y))}`);
  const left = PROFILE.slice()
    .reverse()
    .map(([r, y]) => `${f1(CX - X(r))},${f1(Y(y))}`);
  return `M${f1(CX - X(0.7))},${Y(0)} L${right.join(' L')} L${left.join(' L')} Z`;
})();

/** A small seeded random, so a bottle looks the same every time the shelf opens. */
function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    return ((s >>> 8) & 0xffff) / 0x10000;
  };
}

let clipSeq = 0;

export function bottleSvg(k: Pick<Keepsake, 'n' | 'layers' | 'lifts' | 'at' | 'spare'>, hex: readonly string[] = SAND_HEX): string {
  const id = `sb${++clipSeq}`;
  const x0 = CX - X(INNER);
  const x1 = CX + X(INNER);
  const yFloor = Y(FLOOR);
  const yTop = Y(BODY_TOP);
  const total = k.layers.reduce((a, [, n]) => a + n, 0) || 1;
  const rand = rng(k.n * 7919 + k.lifts * 31 + (k.at % 9973));
  // boundaries between layers, bottom to top, each a gentle wave
  let filled = 0;
  const tops: { y: number; a: number; b: number; c: number }[] = [];
  for (let i = 0; i < k.layers.length; i++) {
    const h = (k.layers[i][1] / total) * (yFloor - yTop);
    filled += h;
    const last = i === k.layers.length - 1;
    const amp = last ? 0.6 : Math.min(2.6, h * 0.45);
    tops.push({ y: yFloor - filled, a: (rand() - 0.5) * 2 * amp, b: (rand() - 0.5) * 2 * amp, c: (rand() - 0.5) * 2 * amp });
  }
  // painted top layer first, so each lower layer covers the part of the one above that lies under its own top
  const bands = k.layers
    .map(([color], i) => {
      const t = tops[i];
      const w = x1 - x0;
      const d =
        `M${f1(x0 - 2)},${f1(t.y + t.a)} ` +
        `C${f1(x0 + w * 0.3)},${f1(t.y + t.b)} ${f1(x0 + w * 0.65)},${f1(t.y - t.b + t.c)} ${f1(x1 + 2)},${f1(t.y + t.c)} ` +
        `L${f1(x1 + 2)},${f1(yFloor + 4)} L${f1(x0 - 2)},${f1(yFloor + 4)} Z`;
      return `<path d="${d}" fill="${hex[((color % 5) + 5) % 5]}"/>`;
    })
    .reverse()
    .join('');
  const neckY = Y(2.66);
  const ribbon =
    k.spare > 0
      ? `<g class="ribbon"><rect x="${f1(CX - 10.5)}" y="${f1(neckY - 2)}" width="21" height="4.4" rx="2"/>` +
        `<path d="M${CX},${f1(neckY)} c-7,-6 -12,-1 -9,3 c2,2 6,0 9,-3 z M${CX},${f1(neckY)} c7,-6 12,-1 9,3 c-2,2 -6,0 -9,-3 z"/>` +
        `<path d="M${CX - 1},${f1(neckY + 1)} l-4,9 M${CX + 1},${f1(neckY + 1)} l4,9" class="tail"/></g>`
      : '';
  return (
    `<svg viewBox="0 4 64 112" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><rect x="${f1(x0)}" y="${f1(yTop - 4)}" width="${f1(x1 - x0)}" height="${f1(yFloor - yTop + 4)}" rx="3"/></clipPath></defs>` +
    `<ellipse cx="${CX}" cy="${BASE + 1.5}" rx="22" ry="2.6" class="shadow"/>` +
    `<path d="${OUTLINE}" class="glassBack"/>` +
    `<g clip-path="url(#${id})">${bands}</g>` +
    `<path d="${OUTLINE}" class="glass"/>` +
    `<path d="M${f1(x0 + 3.5)},${f1(yFloor - 6)} L${f1(x0 + 3.5)},${f1(yTop + 6)}" class="shine"/>` +
    `<rect x="${f1(CX - 9.2)}" y="${f1(Y(3.36))}" width="18.4" height="${f1((3.36 - 2.86) * K)}" rx="2.2" class="cork"/>` +
    `<ellipse cx="${CX}" cy="${f1(Y(3.36))}" rx="9.2" ry="1.8" class="corkTop"/>` +
    ribbon +
    `</svg>`
  );
}

const fmtDate = (ms: number) => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

function describe(k: Keepsake): string {
  const lifts = `${k.lifts} ${k.lifts === 1 ? 'lift' : 'lifts'} (par ${k.par}${k.lifts < k.par ? ', beat it!' : ''})`;
  const parts = [`Level ${k.n}`, lifts, '★'.repeat(k.stars) + '☆'.repeat(3 - k.stars)];
  if (typeof k.points === 'number') parts.push(`${k.points.toLocaleString('en-US')} points`);
  if (k.spare > 0) parts.push(`ribbon from ${k.spare} spare ${k.spare === 1 ? 'move' : 'moves'}`);
  const d = fmtDate(k.at);
  if (d) parts.push(d);
  return parts.join(' · ');
}

export function renderShelf(grid: HTMLElement, note: HTMLElement, detail: HTMLElement, shelf: readonly Keepsake[]): void {
  const stars = shelf.reduce((a, k) => a + k.stars, 0);
  note.textContent = shelf.length
    ? `${shelf.length} ${shelf.length === 1 ? 'bottle' : 'bottles'} · ${stars} ★ · newest first`
    : 'No bottles yet';
  detail.textContent = shelf.length ? 'Tap a bottle to see how it was made.' : 'Clear a tray and its bottle is corked and set here.';
  clipSeq = 0;
  const items = shelf
    .map((k, i) => ({ k, i }))
    .reverse()
    .map(
      ({ k, i }) =>
        `<button type="button" class="keep" data-i="${i}" aria-label="${describe(k)}">${bottleSvg(k)}` +
        `<span class="cap"><b>${k.n}</b><i>${'★'.repeat(k.stars)}<s>${'★'.repeat(3 - k.stars)}</s></i></span></button>`,
    )
    .join('');
  grid.innerHTML = items;
  grid.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.keep');
    if (!b) return;
    for (const x of grid.querySelectorAll('.keep.sel')) x.classList.remove('sel');
    b.classList.add('sel');
    detail.textContent = describe(shelf[Number(b.dataset.i)]);
  };
}
