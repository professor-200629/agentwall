/**
 * Your own calendar: an iCalendar (.ics) text -> the busy blocks of the days
 * the wall shows.
 *
 * Works on the text of an exported calendar, or of a private "secret address
 * in iCal format" link. Repeating meetings are expanded, moved or cancelled
 * occurrences are respected, and times are turned into the wall clock of the
 * person wearing the headset.
 *
 * Left out on purpose: all-day entries (holidays, birthdays), events marked
 * free (TRANSP:TRANSPARENT) and cancelled events. They do not block a call.
 *
 * Plain TypeScript (uses ical.js for the format), unit-tested.
 */
import ICAL from 'ical.js';
import type { BusyBlock } from './scheduler.js';

export interface LocalTime {
  /** "YYYY-MM-DD" */
  day: string;
  /** Minutes after midnight. */
  min: number;
}

export const ICS_LIMITS = {
  /** Larger files are refused before parsing. */
  maxBytes: 3_000_000,
  /** Occurrences read from one repeating event, so a daily event since 2010 cannot hang the page. */
  maxOccurrences: 4000,
  maxBlocks: 300,
  titleChars: 28,
};

const pad = (n: number) => String(n).padStart(2, '0');

/** A moment as this machine's own wall clock. */
export function machineLocal(d: Date): LocalTime {
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    min: d.getHours() * 60 + d.getMinutes(),
  };
}

const stamp = (t: LocalTime) => `${t.day}T${pad(Math.floor(t.min / 60))}:${pad(t.min % 60)}`;

/** One line, no control characters, short: a title is text from someone else's invite. */
export function cleanTitle(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return 'Busy';
  return s.length > ICS_LIMITS.titleChars ? `${s.slice(0, ICS_LIMITS.titleChars - 1)}…` : s;
}

export type IcsResult = { ok: true; blocks: BusyBlock[]; events: number } | { ok: false; error: string };

/**
 * Busy blocks inside `days` (each "YYYY-MM-DD", in wall-clock terms).
 * A block never crosses midnight: an event that does is cut per day.
 */
export function busyFromIcs(
  text: string,
  days: string[],
  toLocal: (d: Date) => LocalTime = machineLocal,
): IcsResult {
  if (typeof text !== 'string' || !/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) {
    return { ok: false, error: 'This is not a calendar file (no BEGIN:VCALENDAR).' };
  }
  if (text.length > ICS_LIMITS.maxBytes) return { ok: false, error: 'This calendar is too large (over 3 MB).' };
  if (days.length === 0) return { ok: true, blocks: [], events: 0 };

  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    return { ok: false, error: 'This calendar file could not be read.' };
  }
  // Time zones the file defines, so "TZID=America/New_York" means the right moment.
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // an odd zone definition: that event falls back to floating time
    }
  }

  const wanted = new Set(days);
  const sorted = [...days].sort();
  // A day of margin each side covers every time zone; the per-day check below is exact.
  const [fy, fm, fd] = sorted[0].split('-').map(Number);
  const [ly, lm, ld] = sorted[sorted.length - 1].split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd) - 36 * 3600_000;
  const to = Date.UTC(ly, lm - 1, ld) + 60 * 3600_000;

  // Group by UID: the master event plus its moved/cancelled occurrences.
  const masters = new Map<string, ICAL.Component>();
  const exceptions = new Map<string, ICAL.Component[]>();
  const all = root.getAllSubcomponents('vevent');
  all.forEach((ve, i) => {
    const uid = String(ve.getFirstPropertyValue('uid') ?? `no-uid-${i}`);
    if (ve.hasProperty('recurrence-id')) exceptions.set(uid, [...(exceptions.get(uid) ?? []), ve]);
    else if (!masters.has(uid)) masters.set(uid, ve);
  });
  // An exception whose master is not in the file still counts as an event of its own.
  for (const [uid, list] of exceptions) {
    if (!masters.has(uid)) list.forEach((ve, i) => masters.set(`${uid}#${i}`, ve));
  }

  const blocks: BusyBlock[] = [];
  const add = (start: Date, end: Date, title: string) => {
    const a = start.getTime();
    const b = end.getTime();
    if (!(b > a) || b <= from || a >= to) return;
    let s = toLocal(start);
    const e = toLocal(end);
    // Cut at each midnight the event crosses.
    for (let guard = 0; guard < 8 && blocks.length < ICS_LIMITS.maxBlocks; guard++) {
      const sameDay = s.day === e.day;
      const endMin = sameDay ? e.min : 24 * 60 - 1;
      if (wanted.has(s.day) && endMin > s.min) {
        blocks.push({ start: stamp(s), end: stamp({ day: s.day, min: endMin }), title });
      }
      if (sameDay) break;
      const [y, m, d] = s.day.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      s = { day: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`, min: 0 };
    }
  };
  const skip = (ve: ICAL.Component) =>
    String(ve.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED' ||
    String(ve.getFirstPropertyValue('transp') ?? '').toUpperCase() === 'TRANSPARENT';

  let events = 0;
  for (const [uid, ve] of masters) {
    try {
      const event = new ICAL.Event(ve);
      if (!event.startDate || event.startDate.isDate) continue; // all-day: not a busy time
      for (const ex of exceptions.get(uid) ?? []) event.relateException(ex);
      events++;
      if (!event.isRecurring()) {
        if (!skip(ve)) add(event.startDate.toJSDate(), event.endDate.toJSDate(), cleanTitle(event.summary));
        continue;
      }
      const it = event.iterator();
      for (let n = 0; n < ICS_LIMITS.maxOccurrences; n++) {
        const next = it.next();
        if (!next) break;
        const d = event.getOccurrenceDetails(next);
        const start = d.startDate.toJSDate();
        if (start.getTime() >= to) break;
        if (d.endDate.toJSDate().getTime() <= from) continue;
        // A moved occurrence carries its own status and title.
        if (skip(d.item.component)) continue;
        add(start, d.endDate.toJSDate(), cleanTitle(d.item.summary));
      }
    } catch {
      // one broken event must not lose the rest of the calendar
    }
  }
  blocks.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { ok: true, blocks: blocks.slice(0, ICS_LIMITS.maxBlocks), events };
}
