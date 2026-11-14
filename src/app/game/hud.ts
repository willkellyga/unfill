import { SAND_HEX } from './palette';

/**
 * The moves card at the top center (Nov 14, Will): the moves left in big type, and under it this level's par as a
 * track, one slot per par lift, each filling with the color of the sand lifted. Lifts over par hang red slots off
 * the end. The goal is the length of the row, so there's no second number to read. (Will picked this over a
 * countdown in words and labeled numbers.) The header's other slots (left, right) are plain flex rows in index.html:
 * anything new is another chip dropped into one.
 */
export interface GoalState {
  /** Moves made on this level so far, oldest first, as the sand color each one lifted. */
  lifted: readonly number[];
  par: number;
}

/** The par track under the moves count, as HTML. */
export function goalHtml(g: GoalState): string {
  const used = g.lifted.length;
  const over = Math.max(0, used - g.par);
  const n = Math.max(g.par, used);
  const slots: string[] = [];
  for (let k = 0; k < n; k++) {
    const color = g.lifted[k];
    if (k >= g.par) slots.push(`<i class="slot over"></i>`);
    else if (color === undefined) slots.push(`<i class="slot"></i>`);
    else slots.push(`<i class="slot on" style="--c:${SAND_HEX[color % SAND_HEX.length]}"></i>`);
  }
  const label = over ? `par ${g.par} <em>+${over}</em>` : `par ${g.par}`;
  // long pars get thinner slots so the row stays under the card's width
  const size = n > 16 ? 'tiny' : n > 11 ? 'small' : '';
  return `<span class="track ${size}" aria-hidden="true">${slots.join('')}</span><span class="trackLabel">${label}</span>`;
}

/** What a screen reader hears for the par track. */
export function goalLabel(g: GoalState): string {
  const used = g.lifted.length;
  if (used > g.par) return `${used} lifts, ${used - g.par} over par ${g.par}`;
  return `${used} of par ${g.par} lifts used`;
}
