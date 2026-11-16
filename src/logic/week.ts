/**
 * The week mural's data: for every half hour of the sample week, why the agent
 * can or can't use it. Plain TypeScript, unit-tested.
 *
 * The reasons come from code, not from the AI, so the wall's transparency never
 * depends on the model telling the truth.
 */
import { focusWindows } from './focus.js';
import {
  absMinutes,
  clock,
  dayLabel,
  freeSlots,
  hm,
  splitStamp,
  type BusyBlock,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

export type CellKind = 'past' | 'busy' | 'buffer' | 'rule' | 'short' | 'free';

export interface WeekCell {
  day: string;
  /** Minutes after midnight. */
  start: number;
  kind: CellKind;
  /** Short reason shown on the mural, e.g. "Sam · Class", "before 4 PM rule". */
  reason: string;
}

export interface WeekBlock {
  day: string;
  start: number;
  end: number;
  who: 'you' | 'guest';
  title: string;
}

export interface WeekModel {
  days: string[];
  dayStart: number;
  dayEnd: number;
  step: number;
  cells: WeekCell[];
  blocks: WeekBlock[];
  /** Cells the agent could not use (everything except 'free'). */
  ruledOut: number;
}

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Wed"

function toBlocks(list: BusyBlock[], who: 'you' | 'guest'): WeekBlock[] {
  return list.map((b) => {
    const s = splitStamp(b.start);
    const e = splitStamp(b.end);
    return { day: s.day, start: s.min, end: e.min, who, title: b.title };
  });
}

/** One part of the user's rule: the single day, the after/before times, or one excluded day. */
export type RuleKey = 'day' | 'after' | 'before' | `not:${string}`;

/** Which rule part rules out this half hour (the first that applies), or null. */
export function ruleKeyFor(c: Constraint, day: string, start: number, end: number): RuleKey | null {
  if (c.day && c.day !== day) return 'day';
  if (c.notDays?.includes(day)) return `not:${day}`;
  if (c.after !== undefined && start < c.after) return 'after';
  if (c.before !== undefined && end > c.before) return 'before';
  return null;
}

function ruleReason(c: Constraint, day: string, start: number, end: number): string {
  const key = ruleKeyFor(c, day, start, end);
  if (key === 'day') return `only ${short(c.day!)} rule`;
  if (key === 'after') return `before ${clock(c.after!).replace(':00', '')} rule`;
  if (key === 'before') return `after ${clock(c.before!).replace(':00', '')} rule`;
  if (key) return `not ${short(day)} rule`;
  return 'your rule';
}

/**
 * @param opts.focus focus time: only YOUR calendar counts, and a half hour is free
 *   only inside a 2-hour window ('short' = free, but the gap is under 2 hours)
 */
export function weekModel(
  cal: CalendarData,
  constraint: Constraint = {},
  opts: { focus?: boolean; /** Length of the block to fit, when it is not the 2-hour focus block. */ minutes?: number } = {},
): WeekModel {
  const blockMin = opts.minutes ?? 120;
  const blockWord = blockMin === 120 ? '2 free hours' : `${blockMin} free minutes`;
  const gapWord = blockMin === 120 ? '2 h' : `${blockMin} min`;
  const { minutes, bufferMinutes, leadMinutes, stepMinutes } = cal.meeting;
  const dayStart = hm(cal.workday.start);
  const dayEnd = hm(cal.workday.end);
  const now = splitStamp(cal.now);
  const earliest = absMinutes(now.day, now.min) + leadMinutes;
  const blocks = opts.focus
    ? toBlocks(cal.busy.owner, 'you')
    : [...toBlocks(cal.busy.owner, 'you'), ...toBlocks(cal.busy.guest, 'guest')];
  const free = new Set(freeSlots(cal, constraint).map((s) => s.id));
  const windows = opts.focus ? focusWindows(cal, constraint, blockMin) : [];
  const label = (b: WeekBlock) => `${b.who === 'you' ? 'You' : cal.guest.name} · ${b.title}`;

  const cells: WeekCell[] = [];
  for (const day of cal.days) {
    for (let start = dayStart; start + minutes <= dayEnd; start += stepMinutes) {
      const end = start + minutes;
      const id = `${day}T${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      const onDay = blocks.filter((b) => b.day === day);
      const hit = onDay.find((b) => start < b.end && end > b.start);
      const near = onDay.find((b) => start < b.end + bufferMinutes && end > b.start - bufferMinutes);
      let kind: CellKind;
      let reason: string;
      if (absMinutes(day, start) < earliest) {
        kind = 'past';
        reason = 'too soon';
      } else if (hit) {
        kind = 'busy';
        reason = label(hit);
      } else if (near) {
        kind = 'buffer';
        reason = `too close to ${near.title}`;
      } else if (opts.focus) {
        const covered = windows.some((w) => w.day === day && w.start <= start && w.end >= end);
        if (covered) {
          kind = 'free';
          reason = `part of ${blockWord}`;
        } else if (ruleKeyFor(constraint, day, start, end)) {
          kind = 'rule';
          reason = ruleReason(constraint, day, start, end);
        } else {
          kind = 'short';
          reason = `gap under ${gapWord}`;
        }
      } else if (!free.has(id)) {
        kind = 'rule';
        reason = ruleReason(constraint, day, start, end);
      } else {
        kind = 'free';
        reason = 'free for both';
      }
      cells.push({ day, start, kind, reason });
    }
  }
  return {
    days: [...cal.days],
    dayStart,
    dayEnd,
    step: stepMinutes,
    cells,
    blocks,
    ruledOut: cells.filter((c) => c.kind !== 'free').length,
  };
}

/**
 * A trade-off worth saying out loud before the user approves, or null.
 * (NN/g found users lose trust when an agent silently accepts a worse slot.)
 */
export function tradeOff(cal: CalendarData, slot: Slot, constraint: Constraint = {}): string | null {
  const dayEnd = hm(cal.workday.end);
  if (slot.end >= dayEnd) return 'Trade-off: last half hour of the workday.';
  const blocks = [...toBlocks(cal.busy.owner, 'you'), ...toBlocks(cal.busy.guest, 'guest')].filter(
    (b) => b.day === slot.day,
  );
  const whose = (b: WeekBlock) => (b.who === 'you' ? 'your' : `${cal.guest.name}'s`);
  for (const b of blocks) {
    const before = slot.start - b.end; // busy block ends just before the call
    if (before >= 0 && before <= 20) return `Trade-off: only ${before} min after ${whose(b)} ${b.title}.`;
    const after = b.start - slot.end; // busy block starts just after the call
    if (after >= 0 && after <= 20) return `Trade-off: only ${after} min before ${whose(b)} ${b.title}.`;
  }
  if (freeSlots(cal, constraint).length === 1) return 'Trade-off: the only time that fits this week.';
  return null;
}
