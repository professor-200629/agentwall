/**
 * "The agent keeps watch": after an invite is approved, the (sample) world
 * changes and the agent notices the conflict and offers to re-plan. It never
 * acts on its own: a re-plan needs a fresh pinch-and-hold.
 * Plain TypeScript, unit-tested.
 */
import { freeSlots, stampOf, type BusyBlock, type CalendarData, type Slot } from './scheduler.js';

/** Seconds after the first approval before the sample change lands. */
export const WATCH_DELAY_SECONDS = 8;

/** The labelled SAMPLE change: the guest gets a new event exactly over the approved slot. */
export function sampleChange(slot: Slot): BusyBlock {
  return {
    start: stampOf(slot.day, slot.start),
    end: stampOf(slot.day, slot.end),
    title: 'Dentist (sample change)',
  };
}

/** A copy of the calendar with one more busy block for the guest. */
export function withGuestBusy(cal: CalendarData, block: BusyBlock): CalendarData {
  return { ...cal, busy: { owner: cal.busy.owner, guest: [...cal.busy.guest, block] } };
}

/** Is this slot still free for both people in this calendar? */
export function stillFree(cal: CalendarData, slot: Slot): boolean {
  return freeSlots(cal).some((s) => s.id === slot.id);
}
