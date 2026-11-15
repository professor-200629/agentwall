/**
 * "The agent's next step": after the invite is sent, the agent offers the
 * follow-ups a good assistant would think of, one at a time, and each one needs
 * your pinch. It never adds anything on its own.
 *
 *   1. A 10-minute prep block on YOUR calendar just before the call (if free).
 *   2. A reminder to the guest 1 hour before (into the demo outbox).
 *
 * Plain TypeScript, unit-tested.
 */
import type { OutboxItem } from './plan.js';
import { clock, dayLabel, hm, splitStamp, type BusyBlock, type CalendarData, type Slot } from './scheduler.js';
import type { WeekBlock } from './week.js';

export type NextStepKind = 'prep' | 'remind';

export interface NextStep {
  kind: NextStepKind;
  /** Small caps heading on the agent card. */
  title: string;
  text: string;
  yes: string;
  no: string;
}

export const PREP_MINUTES = 10;
export const REMIND_MINUTES_BEFORE = 60;

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Wed"

/** Is the owner free for [start, end) on this day (minutes after midnight)? */
function ownerFree(cal: CalendarData, day: string, start: number, end: number): boolean {
  return cal.busy.owner.every((b) => {
    const s = splitStamp(b.start);
    const e = splitStamp(b.end);
    return s.day !== day || end <= s.min || start >= e.min;
  });
}

/**
 * The prep block for this call, or null if the 10 minutes before it are not free.
 * It is shown on the week as yours, but it belongs to the call: it is NOT added to
 * the scheduling calendar, where the 10-minute gap rule would make the call itself
 * look "too close to Prep" and the watching agent would flag its own block.
 */
export function prepBlock(cal: CalendarData, slot: Slot): WeekBlock | null {
  const start = slot.start - PREP_MINUTES;
  if (start < hm(cal.workday.start) || !ownerFree(cal, slot.day, start, slot.start)) return null;
  return { day: slot.day, start, end: slot.start, who: 'you', title: 'Prep (agent)' };
}

/** The follow-ups to offer after this call's invite is sent, in order. */
export function nextSteps(cal: CalendarData, slot: Slot): NextStep[] {
  const steps: NextStep[] = [];
  const prep = prepBlock(cal, slot);
  if (prep) {
    steps.push({
      kind: 'prep',
      title: 'AGENT · NEXT STEP',
      text: `Add a ${PREP_MINUTES}-min prep block before the call (${short(slot.day)} ${clock(slot.start - PREP_MINUTES)})? It goes on your calendar.`,
      yes: 'Add prep',
      no: 'No thanks',
    });
  }
  const remindAt = slot.start - REMIND_MINUTES_BEFORE;
  steps.push({
    kind: 'remind',
    title: 'AGENT · NEXT STEP',
    text: `Send ${cal.guest.name} a reminder 1 hour before (${short(slot.day)} ${clock(remindAt)})? It goes to the demo outbox.`,
    yes: 'Add reminder',
    no: 'Skip',
  });
  return steps;
}

/** A copy of the calendar with the agent's prep block on the owner's side. */
export function withOwnerBusy(cal: CalendarData, block: BusyBlock): CalendarData {
  return { ...cal, busy: { owner: [...cal.busy.owner, block], guest: cal.busy.guest } };
}

/** The reminder as a demo outbox item (nothing is really sent). */
export function reminderItem(cal: CalendarData, slot: Slot, approvedAt: string): OutboxItem {
  const when = `${dayLabel(slot.day).long}, ${clock(slot.start)} ${cal.timezone}`;
  return {
    id: `remind-${slot.id}`,
    to: `${cal.guest.name} <${cal.guest.email}>`,
    subject: `Reminder: app test call · ${short(slot.day)} ${clock(slot.start)}`,
    body: [`Hi ${cal.guest.name},`, '', `A quick reminder of our call on ${when}.`, '', 'Thanks,', cal.owner.name].join('\n'),
    slotId: slot.id,
    approvedAt,
    status: 'sent',
  };
}
