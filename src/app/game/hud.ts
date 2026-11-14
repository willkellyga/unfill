import { SAND_HEX } from './palette';

/**
 * The moves card at the top center (Nov 14, Will): the moves left in big type, and under it how this level is going
 * against its par. Kept as a small pure renderer so the header's three slots (left, center, right) stay easy to add
 * to: each slot is a flex row, and anything new is just another chip dropped into one.
 *
 * Three ways of showing the par line were mocked for Will (`?readout=`):
 *  - track: a row of par slots that fill, one per lift, with the color of the sand lifted; lifts over par add red
 *    slots past the end. The goal is the length of the row, so there's no second number to read.
 *  - countdown: words, "par 7 · 5 lifts to go", then "at par", then "1 over par".
 *  - labels: the old used / par numbers, but labeled: "lifts 2 of 7 par".
 */
export type Readout = 'track' | 'countdown' | 'labels';
export const READOUTS: readonly Readout[] = ['track', 'countdown', 'labels'];

export interface GoalState {
  /** Moves made on this level so far, oldest first, as the sand color each one lifted. */
  lifted: readonly number[];
  par: number;
  /** The level is empty (its last lift landed). */
  cleared: boolean;
}

/** The par line under the moves count, as HTML. */
export function goalHtml(kind: Readout, g: GoalState): string {
  const used = g.lifted.length;
  const over = Math.max(0, used - g.par);
  if (kind === 'track') {
    const slots: string[] = [];
    for (let k = 0; k < Math.max(g.par, used); k++) {
      const color = g.lifted[k];
      if (k >= g.par) slots.push(`<i class="slot over"></i>`);
      else if (color === undefined) slots.push(`<i class="slot"></i>`);
      else slots.push(`<i class="slot on" style="--c:${SAND_HEX[color % SAND_HEX.length]}"></i>`);
    }
    const label = over ? `par ${g.par} <em>+${over}</em>` : `par ${g.par}`;
    // long pars get thinner slots so the row stays under the card's width
    const n = Math.max(g.par, used);
    const size = n > 16 ? 'tiny' : n > 11 ? 'small' : '';
    return `<span class="track ${size}" aria-hidden="true">${slots.join('')}</span><span class="trackLabel">${label}</span>`;
  }
  if (kind === 'countdown') {
    const left = g.par - used;
    let tail: string;
    if (over) tail = `<em>${over} over par</em>`;
    else if (g.cleared) tail = left > 0 ? `<b>${left} under par!</b>` : '<b>at par!</b>';
    else if (left === 0) tail = 'at par';
    else tail = `<b>${left}</b> ${left === 1 ? 'lift' : 'lifts'} to go`;
    return `<span>par ${g.par}</span><span class="dot">·</span><span>${tail}</span>`;
  }
  return `<span>lifts <b class="${over ? 'overN' : ''}">${used}</b> of <b>${g.par}</b> par</span>`;
}

/** What a screen reader hears for the par line. */
export function goalLabel(g: GoalState): string {
  const used = g.lifted.length;
  if (used > g.par) return `${used} lifts, ${used - g.par} over par ${g.par}`;
  return `${used} of par ${g.par} lifts used`;
}

export function parseReadout(v: string | null): Readout {
  return READOUTS.includes(v as Readout) ? (v as Readout) : 'track';
}
