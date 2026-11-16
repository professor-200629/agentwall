/**
 * The week the wall shows when it reads YOUR calendar: the next five working
 * days from today, with your own busy times, in your own wall clock.
 *
 * The sample calendar supplies only what a calendar file does not say: the
 * working hours and the meeting length. Plain TypeScript, unit-tested.
 */
import { hm, splitStamp, stampOf, type BusyBlock, type CalendarData, type Person } from './scheduler.js';

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The next `count` working days (Mon–Fri), starting today when today is one. */
export function workWeek(now: Date, count = 5): string[] {
  const out: string[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let guard = 0; out.length < count && guard < 14; guard++) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) out.push(dayOf(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** "YYYY-MM-DDTHH:MM" for a moment, in the machine's wall clock. */
export function nowStamp(now: Date): string {
  return stampOf(dayOf(now), now.getHours() * 60 + now.getMinutes());
}

/** A short name for the machine's time zone, e.g. "IST" or "GMT+5:30". */
export function zoneLabel(now: Date): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName');
    return part?.value || 'local time';
  } catch {
    return 'local time';
  }
}

/** Keep the part of each block that lies inside the working day; drop the rest. */
export function clipToWorkday(blocks: BusyBlock[], days: string[], dayStart: number, dayEnd: number): BusyBlock[] {
  const out: BusyBlock[] = [];
  for (const b of blocks) {
    let s: { day: string; min: number };
    let e: { day: string; min: number };
    try {
      s = splitStamp(b.start);
      e = splitStamp(b.end);
    } catch {
      continue;
    }
    if (s.day !== e.day || !days.includes(s.day)) continue;
    const from = Math.max(s.min, dayStart);
    const to = Math.min(e.min, dayEnd);
    if (to <= from) continue;
    out.push({ start: stampOf(s.day, from), end: stampOf(s.day, to), title: b.title });
  }
  return out;
}

export interface RealSource {
  /** Your busy blocks, already in wall-clock stamps. */
  blocks: BusyBlock[];
  /** Who the call is with, if you said so on the start page. */
  guest?: Person | null;
  /** Your first name, for signing the email. */
  owner?: string;
  /** What the call is about, e.g. "the Q3 budget". */
  topic?: string;
}

/** The calendar the agent plans on, built from your own busy times. */
export function buildRealCalendar(sample: CalendarData, source: RealSource, now: Date): CalendarData {
  const days = workWeek(now, sample.days.length);
  const dayStart = hm(sample.workday.start);
  const dayEnd = hm(sample.workday.end);
  return {
    ...sample,
    timezone: zoneLabel(now),
    now: nowStamp(now),
    days,
    source: 'yours',
    topic: source.topic || undefined,
    owner: { name: source.owner || 'Me', email: '' },
    guest: source.guest ?? sample.guest,
    // Only your own calendar is known: the guest's is not, and the board says so.
    busy: { owner: clipToWorkday(source.blocks, days, dayStart, dayEnd), guest: [] },
  };
}
