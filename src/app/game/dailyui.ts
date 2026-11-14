import { dailyDate, dailyNumber, isPerfect, streaks, weekdayOf, DAILY_SQUARES, type DailyRecord } from '../../core';
import { DAILY_HEX } from './palette';
import { bottleSvg } from './shelf';

/**
 * The Daily Puzzle's calendar shelf: one little bottle per day she played, in the daily's own colors, laid out as a
 * month. A Perfect day (cleared in the proven best) gets a gold cork and a trophy; a day she ran out of moves keeps
 * its half-poured bottle, faded. Pure DOM strings, so main.ts only wires up the buttons.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function niceDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  void y;
  return `${DAY_SHORT[weekdayOf(ymd)]}, ${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

export function describeRecord(r: DailyRecord): string {
  const head = `#${r.n} · ${niceDate(r.ymd)}`;
  if (!r.cleared) return `${head} · out of moves (best ${r.best})`;
  return `${head} · ${r.lifts} lifts (best ${r.best})` + (isPerfect(r) ? ' 🏆' : '');
}

/** The squares of a result, as small HTML swatches (the share text uses emoji). */
export function squaresHtml(r: DailyRecord): string {
  return r.layers.map(([c]) => `<i style="background:${DAILY_HEX[((c % 5) + 5) % 5]}"></i>`).join('');
}

export function squaresText(r: DailyRecord): string {
  return r.layers.map(([c]) => DAILY_SQUARES[((c % 5) + 5) % 5]).join('');
}

export function statsHtml(records: Readonly<Record<number, DailyRecord>>, today: number): string {
  const s = streaks(records, today);
  const cell = (v: number, label: string) => `<div><b>${v}</b><small>${label}</small></div>`;
  return cell(s.current, 'day streak') + cell(s.max, 'longest') + cell(s.perfects, s.perfects === 1 ? 'perfect' : 'perfects') + cell(s.played, 'played');
}

/**
 * One month of the calendar. `month` is [year, month 1-12]. Days before Daily #1 and after today are blank.
 */
export function calendarHtml(records: Readonly<Record<number, DailyRecord>>, today: number, month: [number, number], epoch: string): string {
  const [y, m] = month;
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekdayOf(first);
  const cells: string[] = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal blank"></span>');
  for (let d = 1; d <= days; d++) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = dailyNumber(ymd, epoch);
    const r = records[n];
    if (n < 1 || n > today) {
      cells.push(`<span class="cal blank"><em>${d}</em></span>`);
    } else if (r) {
      const cls = isPerfect(r) ? 'perfect' : r.cleared ? 'cleared' : 'unfinished';
      const svg = bottleSvg({ n: r.n, layers: r.layers, lifts: r.lifts, at: r.at, spare: 0 }, DAILY_HEX);
      cells.push(
        `<button type="button" class="cal ${cls}${n === today ? ' today' : ''}" data-n="${n}" aria-label="${describeRecord(r)}">${svg}<em>${d}</em>` +
          (cls === 'perfect' ? '<span class="trophy" aria-hidden="true">🏆</span>' : '') +
          `</button>`,
      );
    } else {
      cells.push(
        `<button type="button" class="cal ${n === today ? 'today open' : 'missed'}" data-n="${n}" aria-label="Daily #${n} · ${niceDate(ymd)}${n === today ? ' · today' : ' · not played'}"><span class="ring"></span><em>${d}</em></button>`,
      );
    }
  }
  return (
    `<div class="calWeek">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>` +
    `<div class="calGrid">${cells.join('')}</div>`
  );
}

export function monthTitle(month: [number, number]): string {
  return `${MONTHS[month[1] - 1]} ${month[0]}`;
}

/** The month a daily number falls in. */
export function monthOf(n: number, epoch: string): [number, number] {
  const [y, m] = dailyDate(n, epoch).split('-').map(Number);
  return [y, m];
}

export function shiftMonth([y, m]: [number, number], by: number): [number, number] {
  const k = y * 12 + (m - 1) + by;
  return [Math.floor(k / 12), (k % 12) + 1];
}

/** "5h 12m" until her next local midnight. */
export function untilMidnight(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${mins % 60}m` : `${mins}m`;
}
