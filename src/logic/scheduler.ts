/**
 * Deterministic scheduler: sample calendar + constraint -> best free slot.
 * Plain TypeScript, no XR. This is also the fallback when the AI call fails.
 *
 * Times are local wall-clock strings ("2026-11-17T13:00"). They are turned
 * into whole minutes with Date.UTC so the result never depends on the
 * machine's time zone.
 */

export interface BusyBlock {
  start: string;
  end: string;
  title: string;
}

export interface Person {
  name: string;
  email: string;
  role?: string;
}

export interface CalendarData {
  timezone: string;
  now: string;
  workday: { start: string; end: string };
  meeting: { minutes: number; bufferMinutes: number; leadMinutes: number; stepMinutes: number };
  owner: Person;
  guest: Person;
  days: string[];
  busy: { owner: BusyBlock[]; guest: BusyBlock[] };
}

/** What the user asked for. All fields optional; minutes are minutes after midnight. */
export interface Constraint {
  /** Start no earlier than this time of day ("only after 4 PM" -> 960). */
  after?: number;
  /** End no later than this time of day ("before noon" -> 720). */
  before?: number;
  /** Only this date, "YYYY-MM-DD". */
  day?: string;
  /** Never these dates. */
  notDays?: string[];
}

export interface Slot {
  /** Stable id, e.g. "2026-11-17T13:00". */
  id: string;
  day: string;
  /** Minutes after midnight. */
  start: number;
  end: number;
}

export interface ScheduleResult {
  best: Slot | null;
  /** Other good options, at most one per day, earliest first. */
  alternatives: Slot[];
  /** One plain sentence on why `best` was chosen (or why nothing fits). */
  reason: string;
}

// ---------- time helpers ----------

/** "HH:MM" -> minutes after midnight. */
export function hm(text: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Bad time "${text}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "YYYY-MM-DDTHH:MM" -> { day, minutes after midnight }. */
export function splitStamp(stamp: string): { day: string; min: number } {
  const [day, time] = stamp.split('T');
  if (!day || !time) throw new Error(`Bad timestamp "${stamp}"`);
  return { day, min: hm(time) };
}

/** Absolute minutes, comparable across days (time-zone free). */
export function absMinutes(day: string, min: number): number {
  const [y, mo, d] = day.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) / 60000 + min;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const stampOf = (day: string, min: number) => `${day}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-17" -> { weekday: "Tuesday", short: "Tue 17 Nov" }. */
export function dayLabel(day: string): { weekday: string; short: string; long: string } {
  const [y, mo, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return {
    weekday,
    short: `${weekday.slice(0, 3)} ${d} ${MONTHS[mo - 1]}`,
    long: `${weekday} ${d} ${MONTHS[mo - 1]}`,
  };
}

/** 960 -> "4:00 PM"; 780 -> "1:00 PM". */
export function clock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "1:00 – 1:30 PM" (drops the first AM/PM when both match). */
export function clockRange(start: number, end: number): string {
  const a = clock(start);
  const b = clock(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

export function slotLabel(slot: Slot, tz = 'IST'): string {
  return `${dayLabel(slot.day).short}, ${clockRange(slot.start, slot.end)} ${tz}`;
}

// ---------- scheduler ----------

interface Interval {
  from: number;
  to: number;
}

function busyIntervals(blocks: BusyBlock[], buffer: number): Interval[] {
  return blocks.map((b) => {
    const s = splitStamp(b.start);
    const e = splitStamp(b.end);
    return { from: absMinutes(s.day, s.min) - buffer, to: absMinutes(e.day, e.min) + buffer };
  });
}

/** Every slot that fits the calendar and the constraint, earliest first. */
export function freeSlots(cal: CalendarData, constraint: Constraint = {}): Slot[] {
  const { minutes, bufferMinutes, leadMinutes, stepMinutes } = cal.meeting;
  const dayStart = hm(cal.workday.start);
  const dayEnd = hm(cal.workday.end);
  const now = splitStamp(cal.now);
  const earliestAbs = absMinutes(now.day, now.min) + leadMinutes;
  const busy = [
    ...busyIntervals(cal.busy.owner, bufferMinutes),
    ...busyIntervals(cal.busy.guest, bufferMinutes),
  ];

  const out: Slot[] = [];
  for (const day of cal.days) {
    if (constraint.day && constraint.day !== day) continue;
    if (constraint.notDays?.includes(day)) continue;
    const from = Math.max(dayStart, constraint.after ?? 0);
    const to = Math.min(dayEnd, constraint.before ?? 24 * 60);
    // Start on the step grid, e.g. :00 and :30.
    const first = Math.ceil(from / stepMinutes) * stepMinutes;
    for (let start = first; start + minutes <= to; start += stepMinutes) {
      const end = start + minutes;
      const a = absMinutes(day, start);
      const b = absMinutes(day, end);
      if (a < earliestAbs) continue;
      if (busy.some((i) => a < i.to && b > i.from)) continue;
      out.push({ id: stampOf(day, start), day, start, end });
    }
  }
  return out;
}

/** Plain-English summary of a constraint, for the reason line. */
export function describeConstraint(c: Constraint): string {
  const parts: string[] = [];
  if (c.after !== undefined) parts.push(`after ${clock(c.after)}`);
  if (c.before !== undefined) parts.push(`ending by ${clock(c.before)}`);
  if (c.day) parts.push(`on ${dayLabel(c.day).long}`);
  if (c.notDays?.length) parts.push(`not on ${c.notDays.map((d) => dayLabel(d).weekday).join(', ')}`);
  return parts.join(', ');
}

export function schedule(cal: CalendarData, constraint: Constraint = {}): ScheduleResult {
  const slots = freeSlots(cal, constraint);
  const rule = describeConstraint(constraint);
  if (slots.length === 0) {
    return {
      best: null,
      alternatives: [],
      reason: rule
        ? `No time this week when you and ${cal.guest.name} are both free ${rule}.`
        : `No time this week when you and ${cal.guest.name} are both free.`,
    };
  }
  const best = slots[0];
  const seenDays = new Set([best.day]);
  const alternatives: Slot[] = [];
  for (const s of slots) {
    if (seenDays.has(s.day)) continue;
    seenDays.add(s.day);
    alternatives.push(s);
    if (alternatives.length === 2) break;
  }
  // Fewer than two other days: fill with later times on the same days.
  for (const s of slots) {
    if (alternatives.length === 2) break;
    if (s !== best && !alternatives.includes(s)) alternatives.push(s);
  }
  return {
    best,
    alternatives,
    reason: `Earliest ${cal.meeting.minutes}-min time you and ${cal.guest.name} are both free${rule ? `, ${rule}` : ''}.`,
  };
}
