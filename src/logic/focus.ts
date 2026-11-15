/**
 * The second task: "Block 2 hours of focus time". Same agent, same wall, same
 * hold-to-approve, different job: find two free hours on YOUR calendar (the
 * guest does not matter) and put a calendar block on the desk instead of an email.
 * Plain TypeScript, unit-tested.
 */
import type { Invite, Plan, PlanOptions } from './plan.js';
import {
  absMinutes,
  clock,
  clockRange,
  dayLabel,
  hm,
  splitStamp,
  stampOf,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

export const FOCUS = { minutes: 120 };
export const FOCUS_TASK = 'Block 2 hours of focus time';

export const isFocus = (plan: Pick<Plan, 'task'> | null | undefined): boolean => plan?.task === FOCUS_TASK;

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Thu"

/** Every 2-hour window on the owner's calendar that fits the rule (30-min grid, 10-min gaps, 30-min notice). */
export function focusWindows(cal: CalendarData, constraint: Constraint = {}, minutes = FOCUS.minutes): Slot[] {
  const { bufferMinutes, leadMinutes, stepMinutes } = cal.meeting;
  const dayStart = hm(cal.workday.start);
  const dayEnd = hm(cal.workday.end);
  const now = splitStamp(cal.now);
  const earliest = absMinutes(now.day, now.min) + leadMinutes;
  const out: Slot[] = [];
  for (const day of cal.days) {
    if (constraint.day && constraint.day !== day) continue;
    if (constraint.notDays?.includes(day)) continue;
    const busy = cal.busy.owner
      .map((b) => ({ s: splitStamp(b.start), e: splitStamp(b.end) }))
      .filter((b) => b.s.day === day);
    for (let start = dayStart; start + minutes <= dayEnd; start += stepMinutes) {
      const end = start + minutes;
      if (absMinutes(day, start) < earliest) continue;
      if (constraint.after !== undefined && start < constraint.after) continue;
      if (constraint.before !== undefined && end > constraint.before) continue;
      if (busy.some((b) => start < b.e.min + bufferMinutes && end > b.s.min - bufferMinutes)) continue;
      out.push({ id: stampOf(day, start), day, start, end });
    }
  }
  return out;
}

/** Why the agent picked this window, in one line. */
export function focusReason(cal: CalendarData, windows: Slot[], best: Slot | null): string {
  if (!best) return 'No two free hours this week fit your rule.';
  const daysWithRoom = new Set(windows.map((w) => w.day));
  const full = cal.days.filter((d) => !daysWithRoom.has(d) && cal.days.indexOf(d) < cal.days.indexOf(best.day));
  const when = `${short(best.day)} ${clock(best.start)}`;
  if (full.length === 0) return `${when} is your first two free hours.`;
  const names = full.map(short);
  const list = names.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
  return `${list} ${full.length === 1 ? 'has' : 'have'} no 2-hour gap, so ${when} is first.`;
}

/** The card on the desk: a calendar block on your own (sample) calendar. */
export function focusBlock(cal: CalendarData, slot: Slot): Invite {
  return {
    slotId: slot.id,
    to: `Your calendar (${cal.owner.name}, sample)`,
    subject: `Focus time: ${dayLabel(slot.day).short}, ${clockRange(slot.start, slot.end)} ${cal.timezone}`,
    body: [
      `Blocked for deep work: ${dayLabel(slot.day).long}, ${clockRange(slot.start, slot.end)}.`,
      '',
      'Shows as busy. Notifications off.',
      'Nothing else is moved.',
    ].join('\n'),
    source: 'rules',
  };
}

/** A worth-knowing catch about this window, or null. */
export function focusTradeOff(cal: CalendarData, windows: Slot[], slot: Slot): string | null {
  const days = new Set(windows.map((w) => w.day));
  if (days.size === 1) return `Trade-off: ${short(slot.day)} is the only day with 2 free hours.`;
  if (slot.end >= hm(cal.workday.end)) return 'Trade-off: runs to the end of the workday.';
  return null;
}

/** Run the focus task: pick the first 2-hour window and draft the calendar block. */
export function makeFocusPlan(
  cal: CalendarData,
  constraint: Constraint = {},
  constraintText = '',
  previous?: Plan,
  opts: PlanOptions = {},
): Plan {
  const windows = focusWindows(cal, constraint);
  const slot = opts.slot ?? windows[0] ?? null;
  // Runner-ups: the next windows that overlap neither the chosen one nor each other.
  const alternatives: Slot[] = [];
  const clash = (a: Slot, b: Slot) => a.day === b.day && a.start < b.end && b.start < a.end;
  for (const w of windows) {
    if (alternatives.length >= 2) break;
    if (slot && (w.id === slot.id || clash(w, slot))) continue;
    if (alternatives.some((a) => clash(a, w))) continue;
    alternatives.push(w);
  }
  return {
    task: FOCUS_TASK,
    constraint,
    constraintText,
    slot,
    alternatives,
    reason: opts.reason ?? focusReason(cal, windows, slot),
    invite: slot ? focusBlock(cal, slot) : null,
    approval: 'needs',
    version: (previous?.version ?? 0) + 1,
    by: opts.by ?? 'rules',
    note: opts.note ?? '',
  };
}
