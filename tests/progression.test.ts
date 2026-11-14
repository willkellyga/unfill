import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLEANSER_FROM, FIVE_COLOR_FROM, SEGMENTS, pickBoard, slotFor, type Library, type Pick } from '../src/core';

const library: Library = JSON.parse(readFileSync(new URL('../src/library/boards.json', import.meta.url), 'utf8'));

/** One player's run: board picks for boards 1..count, remembering the last 200 ids like the game will. */
function run(seed: number, count: number): Pick[] {
  const recent: string[] = [];
  const out: Pick[] = [];
  for (let n = 1; n <= count; n++) {
    const p = pickBoard(library.boards, n, seed, new Set(recent));
    out.push(p);
    recent.push(p.entry.id);
    if (recent.length > 200) recent.shift();
  }
  return out;
}
const rating = (p: Pick) => p.entry.metrics.excess100;
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

describe('progression schedule', () => {
  it('follows the plan tiers by board number', () => {
    expect([1, 3, 4, 10, 11, 20, 21, 44, 45, 61].map((n) => slotFor(n).tier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(slotFor(71)).toMatchObject({ tier: 6, role: 'peak' });
    expect(slotFor(64)).toMatchObject({ tier: 5, role: 'peak' });
    expect(slotFor(57)).toMatchObject({ tier: 5, role: 'peak' });
    expect(slotFor(72)).toMatchObject({ tier: 3, role: 'cleanser' });
    expect(slotFor(65)).toMatchObject({ tier: 5, role: 'breather' });
    let fiveColor = 0;
    let peaks = 0;
    for (let n = CLEANSER_FROM; n < 300; n++) {
      const s = slotFor(n);
      if (s.role === 'cleanser') expect(n).toBeGreaterThanOrEqual(CLEANSER_FROM);
      if (s.tier === 6) {
        expect(n).toBeGreaterThanOrEqual(FIVE_COLOR_FROM);
        // A five-color peak is always followed by a small-tray cleanser.
        expect(slotFor(n + 1).role).toBe('cleanser');
        fiveColor++;
      }
      if (s.role === 'peak' && n >= FIVE_COLOR_FROM) peaks++;
    }
    // "Some" five-color boards: every other peak.
    expect(Math.abs(fiveColor * 2 - peaks)).toBeLessThanOrEqual(1);
  });

  it('every wave is building boards, one peak, then one breather; a new tier never opens on a peak', () => {
    for (const seg of SEGMENTS.slice(1)) {
      expect(slotFor(seg.start).role).toBe('build');
      const end = Math.min(seg.end, seg.start + 6 * seg.wave - 1);
      for (let n = seg.start; n <= end; n++) {
        const pos = (n - seg.start) % seg.wave;
        const role = slotFor(n).role;
        if (pos < seg.wave - 2) expect(role).toBe('build');
        else if (pos === seg.wave - 2) expect(role).toBe('peak');
        else expect(['breather', 'cleanser']).toContain(role);
      }
      // Fixed tiers hold whole waves.
      if (seg.end !== Infinity) expect((seg.end - seg.start + 1) % seg.wave).toBe(0);
    }
  });

  it('is a sawtooth: within each wave the targets build to a peak, then drop to a breather', () => {
    for (let n = 5; n < 300; n++) {
      const s = slotFor(n);
      const prev = slotFor(n - 1);
      if (s.tier !== prev.tier || prev.role === 'cleanser' || s.role === 'cleanser') continue;
      if (s.role === 'build' && prev.role === 'build') expect(s.target).toBeGreaterThan(prev.target);
      if (s.role === 'peak') expect(s.target).toBeGreaterThan(prev.target);
      if (s.role === 'breather') expect(s.target).toBeLessThan(prev.target);
    }
  });

  it('target difficulty keeps rising through each tier, then holds in the endless tier', () => {
    const waveMean = (from: number, len: number) => mean(Array.from({ length: len }, (_, k) => slotFor(from + k).target));
    expect(waveMean(29, 8)).toBeGreaterThan(waveMean(21, 8));
    expect(waveMean(37, 8)).toBeGreaterThan(waveMean(29, 8));
    expect(waveMean(94, 7)).toBeGreaterThan(waveMean(45, 7));
    expect(slotFor(150).target).toBe(slotFor(248).target);
    expect(slotFor(150).role).toBe(slotFor(248).role);
  });
});

describe('progression with the real library', () => {
  const runs = [1, 2, 3, 4, 5].map((seed) => run(seed, 200));

  it('picks are deterministic per seed, vary between seeds, and never repeat within 200 boards', () => {
    expect(run(1, 60).map((p) => p.entry.id)).toEqual(runs[0].slice(0, 60).map((p) => p.entry.id));
    expect(runs[1].map((p) => p.entry.id)).not.toEqual(runs[0].map((p) => p.entry.id));
    for (const r of runs) expect(new Set(r.map((p) => p.entry.id)).size).toBe(r.length);
  });

  it('each pick comes from its slot tier, with a valid mirror and color order', () => {
    for (const r of runs) {
      for (const p of r) {
        expect(p.entry.tier).toBe(p.slot.tier);
        expect([...p.transform.perm].sort()).toEqual([...Array(p.entry.colors).keys()]);
      }
    }
  });

  it('gets harder as the board number rises (rated difficulty, averaged over runs)', () => {
    const avgRating = (from: number, to: number) => mean(runs.flatMap((r) => r.slice(from - 1, to).map(rating)));
    const tutorial = avgRating(1, 3);
    const tier2 = avgRating(4, 10);
    const tier3 = avgRating(11, 20);
    const tier4 = avgRating(21, 44);
    const endless = avgRating(45, 200);
    expect(tier2).toBeGreaterThan(tutorial);
    expect(tier3).toBeGreaterThan(tier2);
    expect(tier4).toBeGreaterThan(tier3);
    expect(endless).toBeGreaterThan(tier4);
    // Within tier 4 and the endless tier, the later half is harder than the earlier half.
    expect(avgRating(33, 44)).toBeGreaterThan(avgRating(21, 32));
    expect(avgRating(122, 200)).toBeGreaterThan(avgRating(45, 84));
  });

  it('peaks are harder than the boards before them, and breathers are easier (sawtooth in rated difficulty)', () => {
    let peaksAbove = 0;
    let breathersBelow = 0;
    let waves = 0;
    for (const r of runs) {
      for (let i = 1; i < r.length; i++) {
        const p = r[i];
        if (p.slot.role === 'peak' && r[i - 1].slot.role === 'build' && r[i + 1]) {
          waves++;
          const builds = mean([r[i - 3], r[i - 2], r[i - 1]].filter((x) => x && x.slot.role === 'build').map(rating));
          // (the last three building boards before the peak)
          if (rating(p) > builds) peaksAbove++;
          if (rating(r[i + 1]) < rating(p)) breathersBelow++; // breather or cleanser
        }
      }
    }
    expect(waves).toBeGreaterThan(100);
    expect(peaksAbove / waves).toBeGreaterThan(0.9);
    expect(breathersBelow / waves).toBeGreaterThan(0.9);
  });
});
