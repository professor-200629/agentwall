/**
 * The third task: move one of your own meetings.
 *
 * You pinch a meeting on the week. The agent looks for the NEAREST other time this
 * week that is long enough and free on YOUR calendar, shows it on the wall like any
 * other plan, and puts a "calendar change" card on your desk. Nothing moves
 * until you pinch and hold it. Rules ("only after 4 PM", "not Wed") apply.
 *
 * The agent knows only your calendar: it does not know who else is in the
 * meeting, and the card says so instead of pretending.
 *
 * Plain TypeScript, unit-tested.
 */
import { focusWindows } from './focus.js';
import type { Invite, Moving, Plan, PlanOptions } from './plan.js';
import {
  absMinutes,
  clock,
  clockRange,
  dayLabel,
  slotLabel,
  splitStamp,
  stampOf,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

export const MOVE = { minMinutes: 15, maxMinutes: 240 };

export const isMove = (plan: Pick<Plan, 'moving'> | null | undefined): boolean => !!plan?.moving;
export const moveTask = (title: string) => `Move “${title}” to another time`;

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Tue"
const same = (b: { start: string; end: string }, m: Moving) =>
  b.start === stampOf(m.day, m.start) && b.end === stampOf(m.day, m.end);

/** Your meeting under a point on the week (a day and a minute), if it can be moved. */
export function movableAt(cal: CalendarData, day: string, minute: number): Moving | null {
  const now = splitStamp(cal.now);
  for (const b of cal.busy.owner) {
    let s: { day: string; min: number };
    let e: { day: string; min: number };
    try {
      s = splitStamp(b.start);
      e = splitStamp(b.end);
    } catch {
      continue;
    }
    if (s.day !== day || e.day !== day || minute < s.min || minute >= e.min) continue;
    const length = e.min - s.min;
    if (length < MOVE.minMinutes || length > MOVE.maxMinutes) return null; // a whole-day block is not "a meeting"
    if (absMinutes(s.day, s.min) <= absMinutes(now.day, now.min)) return null; // already started
    return { day, start: s.min, end: e.min, title: b.title };
  }
  return null;
}

/** The calendar as if that meeting were not there (so its own time does not block it). */
export function withoutBlock(cal: CalendarData, m: Moving): CalendarData {
  return { ...cal, busy: { ...cal.busy, owner: cal.busy.owner.filter((b) => !same(b, m)) } };
}

/** The calendar after the move: the meeting sits at its new time. */
export function withMoved(cal: CalendarData, m: Moving, slot: Slot): CalendarData {
  const rest = cal.busy.owner.filter((b) => !same(b, m));
  if (rest.length === cal.busy.owner.length) return cal; // it was not there: change nothing
  const moved = { start: stampOf(slot.day, slot.start), end: stampOf(slot.day, slot.end), title: m.title };
  return { ...cal, busy: { ...cal.busy, owner: [...rest, moved] } };
}

/** Every other time this week the meeting fits on your calendar, earliest first. */
export function moveWindows(cal: CalendarData, m: Moving, constraint: Constraint = {}): Slot[] {
  return focusWindows(withoutBlock(cal, m), constraint, m.end - m.start).filter(
    (s) => !(s.day === m.day && s.start === m.start),
  );
}

/**
 * The same windows, nearest to where the meeting is now first. A tie (30 minutes
 * earlier or later) goes to the later one. Until 16 Nov the first window of the
 * WEEK was taken, so a Wednesday 3 PM meeting went to Tuesday 9 AM although
 * Wednesday 2:30 and 3:30 were free, and the reason said Wednesday had no room.
 */
export function nearestFirst(m: Moving, windows: Slot[]): Slot[] {
  const t0 = absMinutes(m.day, m.start);
  const at = (s: Slot) => absMinutes(s.day, s.start);
  return [...windows].sort((a, b) => Math.abs(at(a) - t0) - Math.abs(at(b) - t0) || at(b) - at(a));
}

/** One line that says what was searched and what was chosen, and nothing that was not checked. */
function reason(m: Moving, windows: Slot[], best: Slot | null, rule: Constraint = {}): string {
  const len = m.end - m.start;
  if (!best) return `No other time this week has ${len} free minutes inside your rule.`;
  const when = `${short(best.day)} ${clock(best.start)}`;
  if (best.day === m.day) {
    const delta = best.start - m.start;
    const by = Math.abs(delta) >= 60 && Math.abs(delta) % 60 === 0 ? `${Math.abs(delta) / 60} h` : `${Math.abs(delta)} min`;
    return `${when} is the nearest free ${len} minutes: ${by} ${delta > 0 ? 'later' : 'earlier'}, same day.`;
  }
  // The meeting's own day was not searched at all when your rule leaves it out.
  if (rule.notDays?.includes(m.day) || (rule.day !== undefined && rule.day !== m.day)) {
    return `Your rule leaves out ${short(m.day)}, so ${when} is the nearest.`;
  }
  // Said only when it is true: no window on the meeting's own day was found.
  const sameDay = windows.some((w) => w.day === m.day);
  const inside = rule.after !== undefined || rule.before !== undefined ? ' inside your rule' : '';
  return sameDay
    ? `${when} is the nearest free ${len} minutes.`
    : `${short(m.day)} has no other free ${len} minutes${inside}, so ${when} is the nearest.`;
}

/** The card on the desk: a change on your own calendar. */
export function moveNote(cal: CalendarData, m: Moving, slot: Slot): Invite {
  const from = `${dayLabel(m.day).long}, ${clockRange(m.start, m.end)}`;
  const to = `${dayLabel(slot.day).long}, ${clockRange(slot.start, slot.end)}`;
  return {
    slotId: slot.id,
    to: cal.source === 'yours' ? 'Your calendar' : `Your calendar (${cal.owner.name}, sample)`,
    // The part before ": " becomes the event's title in the calendar file.
    subject: `${m.title} (moved): ${slotLabel(slot, cal.timezone)}`,
    body: [
      `Moved from ${from}`,
      `to ${to} ${cal.timezone}.`,
      '',
      'Only your calendar is known here: tell the others yourself.',
      'Nothing else is moved.',
    ].join('\n'),
    source: 'rules',
  };
}

/** Run the move task: pick the first time the meeting fits and draft the change. */
export function makeMovePlan(
  cal: CalendarData,
  m: Moving,
  constraint: Constraint = {},
  constraintText = '',
  previous?: Plan,
  opts: PlanOptions = {},
): Plan {
  const windows = nearestFirst(m, moveWindows(cal, m, constraint));
  const slot = opts.slot ?? windows[0] ?? null;
  const clash = (a: Slot, b: Slot) => a.day === b.day && a.start < b.end && b.start < a.end;
  const alternatives: Slot[] = [];
  for (const w of windows) {
    if (alternatives.length >= 2) break;
    if (slot && (w.id === slot.id || clash(w, slot))) continue;
    if (alternatives.some((a) => clash(a, w))) continue;
    alternatives.push(w);
  }
  return {
    task: moveTask(m.title),
    moving: m,
    constraint,
    constraintText,
    slot,
    alternatives,
    reason: opts.reason ?? reason(m, windows, slot, constraint),
    invite: slot ? moveNote(cal, m, slot) : null,
    approval: 'needs',
    version: (previous?.version ?? 0) + 1,
    by: opts.by ?? 'rules',
    note: opts.note ?? '',
  };
}

/** A stored `moving` is believed only when that meeting is really on the calendar. */
export function checkedMoving(cal: CalendarData, raw: unknown): Moving | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.day !== 'string' || typeof r.start !== 'number' || typeof r.end !== 'number') return null;
  const found = cal.busy.owner.find((b) => {
    try {
      return same(b, { day: r.day as string, start: r.start as number, end: r.end as number, title: '' });
    } catch {
      return false;
    }
  });
  return found ? { day: r.day, start: r.start, end: r.end, title: found.title } : null;
}
