/**
 * What you approved is busy time.
 *
 * The calendar that was read knows nothing of the calls and focus blocks approved
 * on this board. A planner that looks at that calendar alone can offer the same
 * time twice, put a call on top of a focus block, or move a meeting onto a call.
 * So planners look at the calendar plus the approvals that still stand, and the
 * approval boundary refuses a time another standing approval already holds.
 *
 * Plain TypeScript, unit-tested.
 */
import type { OutboxItem } from './plan.js';
import { itemSlot, kindOf } from './review.js';
import { stampOf, type BusyBlock, type CalendarData, type Slot } from './scheduler.js';

type Item = Pick<OutboxItem, 'id' | 'subject' | 'kind' | 'slotId' | 'minutes' | 'blocked'>;

/**
 * Does this approval hold its time? A call or a focus block that is not blocked
 * (by a conflict, a replacement, changed words or another calendar). One still in
 * its Unsend window counts: it is yours until you take it back. A moved meeting is
 * already on the calendar itself, and a reminder holds no time.
 */
export function holdsTime(item: Item): boolean {
  if (item.blocked) return false;
  const kind = kindOf(item);
  return kind === 'call' || kind === 'focus';
}

/** The words before the time in an item's subject: "App test call", "Focus time". */
const titleOf = (item: Pick<OutboxItem, 'subject'>): string => (item.subject.split(': ')[0] || item.subject).trim();

/**
 * The calendar the agent plans on: what was read, plus every standing approval as a
 * busy block on your side. `except` leaves one item out (the one being replaced).
 * With nothing to add the calendar comes back as it is.
 */
export function withApproved(cal: CalendarData, outbox: Item[], except?: string | null): CalendarData {
  const blocks: BusyBlock[] = [];
  for (const o of outbox) {
    if (o.id === except || !holdsTime(o)) continue;
    const slot = itemSlot(o);
    if (!slot) continue;
    blocks.push({ start: stampOf(slot.day, slot.start), end: stampOf(slot.day, slot.end), title: `${titleOf(o)} (approved)` });
  }
  if (blocks.length === 0) return cal;
  return { ...cal, busy: { owner: [...cal.busy.owner, ...blocks], guest: cal.busy.guest } };
}

/** The standing approval whose time this slot overlaps, or null. */
export function heldBy<T extends Item>(outbox: T[], slot: Pick<Slot, 'day' | 'start' | 'end'>, except?: string | null): T | null {
  for (const o of outbox) {
    if (o.id === except || !holdsTime(o)) continue;
    const s = itemSlot(o);
    if (s && s.day === slot.day && s.start < slot.end && slot.start < s.end) return o;
  }
  return null;
}
