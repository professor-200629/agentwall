import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { busyFromIcs, cleanTitle, type LocalTime } from '../src/logic/ics.js';
import { buildRealCalendar, clipToWorkday, workWeek } from '../src/logic/real-week.js';
import { focusWindows } from '../src/logic/focus.js';
import { makePlan } from '../src/logic/plan.js';
import { freeSlots, type CalendarData } from '../src/logic/scheduler.js';

const sample = calendarJson as CalendarData;
const pad = (n: number) => String(n).padStart(2, '0');
/** The headset wearer lives in India (UTC+5:30), whatever machine runs the tests. */
const ist = (d: Date): LocalTime => {
  const t = new Date(d.getTime() + 330 * 60_000);
  return {
    day: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    min: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
};
const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const NY = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

function blocks(text: string, days = WEEK) {
  const r = busyFromIcs(text, days, ist);
  if (!r.ok) throw new Error(r.error);
  return r.blocks;
}

describe('your own calendar: an .ics text becomes busy blocks', () => {
  it('refuses what is not a calendar, with a plain reason', () => {
    expect(busyFromIcs('<html>Sign in</html>', WEEK, ist)).toEqual({ ok: false, error: 'This is not a calendar file (no BEGIN:VCALENDAR).' });
    expect(busyFromIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nnonsense', WEEK, ist).ok).toBe(false);
  });

  it('a UTC event lands on the wearer\'s wall clock', () => {
    const b = blocks(cal(ev(['UID:1', 'DTSTART:20261117T043000Z', 'DTEND:20261117T053000Z', 'SUMMARY:Standup'])));
    expect(b).toEqual([{ start: '2026-11-17T10:00', end: '2026-11-17T11:00', title: 'Standup' }]);
  });

  it('a time zone the file defines is honoured (9 AM New York = 7:30 PM India)', () => {
    const b = blocks(cal(NY, ev(['UID:2', 'DTSTART;TZID=America/New_York:20261118T090000', 'DTEND;TZID=America/New_York:20261118T100000', 'SUMMARY:US sync'])));
    expect(b).toEqual([{ start: '2026-11-18T19:30', end: '2026-11-18T20:30', title: 'US sync' }]);
  });

  it('a weekly meeting that started months ago shows up this week', () => {
    const b = blocks(cal(ev(['UID:3', 'DTSTART:20260105T083000Z', 'DTEND:20260105T093000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:Team sync'])));
    expect(b.map((x) => x.start)).toEqual(['2026-11-16T14:00', '2026-11-18T14:00']);
  });

  it('a repeat that ended, and a skipped date, are not shown', () => {
    const ended = blocks(cal(ev(['UID:4', 'DTSTART:20260105T083000Z', 'DTEND:20260105T093000Z', 'RRULE:FREQ=WEEKLY;UNTIL=20260301T000000Z', 'SUMMARY:Old'])));
    expect(ended).toEqual([]);
    const skipped = blocks(cal(ev(['UID:5', 'DTSTART:20261116T083000Z', 'DTEND:20261116T093000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE:20261117T083000Z', 'SUMMARY:Daily'])));
    expect(skipped.map((x) => x.start)).toEqual(['2026-11-16T14:00', '2026-11-18T14:00']);
  });

  it('one occurrence moved to another time: the new time counts, the old one does not', () => {
    const b = blocks(
      cal(
        ev(['UID:6', 'DTSTART:20261116T083000Z', 'DTEND:20261116T093000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'SUMMARY:Review']),
        ev(['UID:6', 'RECURRENCE-ID:20261117T083000Z', 'DTSTART:20261117T103000Z', 'DTEND:20261117T113000Z', 'SUMMARY:Review (moved)']),
      ),
    );
    expect(b).toEqual([
      { start: '2026-11-16T14:00', end: '2026-11-16T15:00', title: 'Review' },
      { start: '2026-11-17T16:00', end: '2026-11-17T17:00', title: 'Review (moved)' },
    ]);
  });

  it('all-day entries, events marked free and cancelled events do not block time', () => {
    const b = blocks(
      cal(
        ev(['UID:7', 'DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'SUMMARY:Holiday']),
        ev(['UID:8', 'DTSTART:20261117T043000Z', 'DTEND:20261117T053000Z', 'TRANSP:TRANSPARENT', 'SUMMARY:FYI']),
        ev(['UID:9', 'DTSTART:20261117T063000Z', 'DTEND:20261117T073000Z', 'STATUS:CANCELLED', 'SUMMARY:Off']),
      ),
    );
    expect(b).toEqual([]);
  });

  it('events outside the days shown are left out', () => {
    const b = blocks(cal(ev(['UID:10', 'DTSTART:20261123T043000Z', 'DTEND:20261123T053000Z', 'SUMMARY:Next week'])));
    expect(b).toEqual([]);
  });

  it('an event across midnight is cut per day', () => {
    const b = blocks(cal(ev(['UID:11', 'DTSTART:20261117T170000Z', 'DTEND:20261117T200000Z', 'SUMMARY:Late call'])));
    expect(b).toEqual([
      { start: '2026-11-17T22:30', end: '2026-11-17T23:59', title: 'Late call' },
      { start: '2026-11-18T00:00', end: '2026-11-18T01:30', title: 'Late call' },
    ]);
  });

  it('titles are one short line; an empty one reads "Busy"', () => {
    expect(cleanTitle('  Budget\n review\twith   finance and the whole leadership team ')).toBe('Budget review with finance …');
    expect(cleanTitle('')).toBe('Busy');
    expect(cleanTitle(undefined)).toBe('Busy');
  });

  it('one broken event does not lose the others', () => {
    const b = blocks(cal(ev(['UID:12', 'DTSTART:not-a-date', 'SUMMARY:Broken']), ev(['UID:13', 'DTSTART:20261119T043000Z', 'DTEND:20261119T050000Z', 'SUMMARY:Fine'])));
    expect(b.map((x) => x.title)).toEqual(['Fine']);
  });
});

describe('the week the wall shows for your own calendar', () => {
  it('five working days from today; a weekend starts on Monday', () => {
    expect(workWeek(new Date(2026, 10, 18, 10, 0))).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24']);
    expect(workWeek(new Date(2026, 10, 21, 10, 0))[0]).toBe('2026-11-23');
    expect(workWeek(new Date(2026, 11, 31, 10, 0))).toEqual(['2026-12-31', '2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06']);
  });

  it('blocks are clipped to working hours; anything outside is dropped', () => {
    const out = clipToWorkday(
      [
        { start: '2026-11-17T08:00', end: '2026-11-17T09:30', title: 'Early' },
        { start: '2026-11-17T17:30', end: '2026-11-17T19:00', title: 'Late' },
        { start: '2026-11-17T20:00', end: '2026-11-17T21:00', title: 'Dinner' },
        { start: '2026-11-25T10:00', end: '2026-11-25T11:00', title: 'Other week' },
        { start: 'rubbish', end: 'rubbish', title: 'Bad' },
      ],
      WEEK,
      540,
      1080,
    );
    expect(out).toEqual([
      { start: '2026-11-17T09:00', end: '2026-11-17T09:30', title: 'Early' },
      { start: '2026-11-17T17:30', end: '2026-11-17T18:00', title: 'Late' },
    ]);
  });

  it('the agent plans on your busy times: the real week replaces the sample one', () => {
    const now = new Date(2026, 10, 17, 8, 0); // Tuesday 8 AM
    const real = buildRealCalendar(
      sample,
      {
        blocks: [
          { start: '2026-11-17T09:00', end: '2026-11-17T17:30', title: 'Offsite' },
          { start: '2026-11-18T09:00', end: '2026-11-18T10:00', title: 'Standup' },
        ],
        guest: { name: 'Priya', email: 'priya@example.com' },
      },
      now,
    );
    expect(real.days[0]).toBe('2026-11-17');
    expect(real.busy.guest).toEqual([]);
    expect(real.owner.name).toBe('Me');
    expect(real.source).toBe('yours');
    const slots = freeSlots(real);
    // Tuesday is busy until 5:30 PM and the 10-minute gap after it leaves no half hour before 6 PM.
    expect(slots.filter((s) => s.day === '2026-11-17')).toEqual([]);
    // Wednesday: free from 10:30 (10 min after the standup, on the half hour).
    expect(slots[0]).toMatchObject({ day: '2026-11-18', start: 630 });
    const plan = makePlan(real);
    expect(plan.slot?.id).toBe('2026-11-18T10:30');
    expect(plan.invite?.to).toBe('Priya <priya@example.com>');
    // Focus time works on the real week too.
    expect(focusWindows(real)[0]).toMatchObject({ day: '2026-11-18' });
  });

  it('with no guest given, the sample guest stays (and the board labels it)', () => {
    const real = buildRealCalendar(sample, { blocks: [] }, new Date(2026, 10, 17, 8, 0));
    expect(real.guest).toEqual(sample.guest);
  });
});
