/**
 * What you approved, as real things you can use: an email draft that opens in
 * your own mail app (a mailto: link) and a calendar file (.ics) for your own
 * calendar.
 *
 * Agent Wall still sends nothing. You approved the words on the wall; these
 * hand the same words to the apps that do the sending, and the last click
 * there is yours as well.
 *
 * Plain TypeScript, unit-tested.
 */
import type { OutboxItem } from './plan.js';
import type { CalendarData, Slot } from './scheduler.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** "Sam <sam@example.com>" -> name and address; null when there is no usable address. */
export function recipient(to: string): { name: string; email: string } | null {
  const m = /^\s*(.*?)\s*<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>\s*$/.exec(to);
  if (m) return { name: m[1], email: m[2] };
  const bare = /^\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*$/.exec(to);
  return bare ? { name: '', email: bare[1] } : null;
}

/**
 * The approved start as a moment in time (ISO, UTC), fixed when you approve.
 * The sample week states its own offset (IST, +5:30). Your own calendar is in this
 * machine's wall clock on that day, daylight time included.
 */
export function slotInstant(
  cal: Pick<CalendarData, 'utcOffsetMinutes'>,
  slot: Pick<Slot, 'day' | 'start'>,
  localOffset: (y: number, mo: number, d: number, min: number) => number = (y, mo, d, min) =>
    -new Date(y, mo - 1, d, Math.floor(min / 60), min % 60).getTimezoneOffset(),
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.day);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const offset = typeof cal.utcOffsetMinutes === 'number' ? cal.utcOffsetMinutes : localOffset(y, mo, d, slot.start);
  const t = Date.UTC(y, mo - 1, d, 0, slot.start) - offset * 60_000;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** A blocked item (a conflict, a replaced approval) has nothing to hand off. */
const blocked = (item: object): boolean => !!(item as { blocked?: unknown }).blocked;

/** An email draft in the user's own mail app; null when the item has nobody to write to. */
export function mailtoLink(item: Pick<OutboxItem, 'to' | 'subject' | 'body'>): string | null {
  if (blocked(item)) return null;
  const who = recipient(item.to);
  if (!who) return null;
  // The address is the path of the link; only subject and body are parameters.
  const q = `subject=${encodeURIComponent(item.subject)}&body=${encodeURIComponent(item.body.replace(/\r?\n/g, '\r\n'))}`;
  return `mailto:${encodeURIComponent(who.email).replace(/%40/g, '@')}?${q}`;
}

/** Minutes the event lasts: what was stored if sane, else half an hour. */
export function eventMinutes(item: { minutes?: unknown }): number {
  const m = item.minutes;
  return typeof m === 'number' && Number.isInteger(m) && m >= 5 && m <= 720 ? m : 30;
}

const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes are folded, as the format asks. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** A reminder is a message, not an event. */
export const isEvent = (item: Pick<OutboxItem, 'id'>): boolean => !item.id.startsWith('remind-');

/**
 * A calendar file for the approved time, or null when the item is not an event,
 * is blocked, or its time cannot be read.
 *
 * The file holds the moment you approved (UTC), so it is the same instant on a
 * device in any time zone. Records saved before that moment was kept have only
 * the wall clock: those stay "floating" (the same clock time wherever opened).
 */
export function eventIcs(item: OutboxItem): string | null {
  if (!isEvent(item) || blocked(item)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(item.slotId);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const instant = item.startUtc ? new Date(item.startUtc) : null;
  const exact = instant !== null && !Number.isNaN(instant.getTime());
  const start = exact ? instant : new Date(Date.UTC(y, mo - 1, d, h, mi));
  const end = new Date(start.getTime() + eventMinutes(item) * 60_000);
  const local = (t: Date) =>
    `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00${exact ? 'Z' : ''}`;
  const approved = new Date(item.approvedAt);
  const stamp = Number.isNaN(approved.getTime()) ? start : approved;
  const utc = `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}${pad(stamp.getUTCSeconds())}Z`;
  // The title without the date the subject line carries ("App test call: Tue 17 Nov, …").
  const title = item.subject.split(': ')[0] || item.subject;
  const who = recipient(item.to);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agent Wall//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${item.id.replace(/[^\w.#:-]/g, '_')}@agentwall`,
    `DTSTAMP:${utc}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    `SUMMARY:${escapeText(title)}`,
    `DESCRIPTION:${escapeText(item.body)}`,
    ...(who ? [`ATTENDEE;CN=${escapeText(who.name || who.email).replace(/[":]/g, '')}:mailto:${who.email}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** The whole message as plain text, for the clipboard ('' for a blocked item). */
export function asText(item: Pick<OutboxItem, 'to' | 'subject' | 'body'>): string {
  if (blocked(item)) return '';
  return `To: ${item.to}\nSubject: ${item.subject}\n\n${item.body}`;
}
