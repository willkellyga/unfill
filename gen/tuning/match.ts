/**
 * Which bot plays most like a real player, on the very boards they played (used by calibrate.ts for a progress
 * code and playtest.ts for the playtest Sheet).
 */
import { readFileSync } from 'node:fs';
import type { Library, LibraryEntry } from '../../src/core';
import { decodeExtras } from '../../src/core/tuning';
import { BOTS, type Bot } from './simulate';

export interface Played {
  /** Library board id. */
  board: string;
  lifts: number;
}

export interface Match {
  /** Levels that could be compared (a known board with recorded bot games). */
  levels: number;
  /** Mean log-likelihood per level of the player's lifts under each bot (higher is closer). */
  perLevel: Record<Bot, number>;
  /** Bots, closest first. */
  ranked: Bot[];
  /** Where the player sits within the typical bot on average: 50 = typical, lower = fewer moves. */
  typicalPercentile: number;
}

let cache: { byId: Map<string, LibraryEntry>; samples: Record<string, Record<string, string>> } | null = null;
function world() {
  if (!cache) {
    const lib: Library = JSON.parse(readFileSync(new URL('../../src/library/boards.json', import.meta.url), 'utf8'));
    const s: { boards: Record<string, Record<string, string>> } = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8'));
    cache = { byId: new Map(lib.boards.map((b) => [b.id, b])), samples: s.boards };
  }
  return cache;
}

export function boardById(id: string): LibraryEntry | undefined {
  return world().byId.get(id);
}

export function botMatch(played: readonly Played[]): Match | null {
  const { byId, samples } = world();
  const known = played.filter((k) => k.board && byId.has(k.board) && samples[k.board]);
  if (!known.length) return null;
  const loglik = Object.fromEntries(BOTS.map((b) => [b, 0])) as Record<Bot, number>;
  const pct: number[] = [];
  for (const k of known) {
    const extra = k.lifts - byId.get(k.board)!.par;
    for (const b of BOTS) {
      const games = decodeExtras(samples[k.board][b]);
      // Smoothed chance of exactly these lifts: games within one move count half, so a careful bot isn't ruled out by one move.
      const hits = games.filter((g) => g === extra).length + 0.5 * games.filter((g) => Math.abs(g - extra) === 1).length;
      loglik[b] += Math.log((hits + 0.5) / (games.length + 1));
    }
    const typical = decodeExtras(samples[k.board].medium);
    pct.push((100 * (typical.filter((g) => g < extra).length + 0.5 * typical.filter((g) => g === extra).length)) / typical.length);
  }
  const perLevel = Object.fromEntries(BOTS.map((b) => [b, loglik[b] / known.length])) as Record<Bot, number>;
  return {
    levels: known.length,
    perLevel,
    ranked: BOTS.slice().sort((a, z) => loglik[z] - loglik[a]),
    typicalPercentile: pct.reduce((a, x) => a + x, 0) / pct.length,
  };
}
