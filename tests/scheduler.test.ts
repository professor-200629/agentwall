import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import {
  clock,
  clockRange,
  dayLabel,
  freeSlots,
  hm,
  schedule,
  slotLabel,
  splitStamp,
  type CalendarData,
} from '../src/logic/scheduler.js';
import { chooseSlot, draftInvite, isLinked, makePlan } from '../src/logic/plan.js';

const cal = calendarJson as CalendarData;
const at = (h: number, m = 0) => h * 60 + m;

describe('time helpers', () => {
  it('formats clock times', () => {
    expect(clock(at(13))).toBe('1:00 PM');
    expect(clock(at(12))).toBe('12:00 PM');
    expect(clock(0)).toBe('12:00 AM');
    expect(clock(at(9, 30))).toBe('9:30 AM');
    expect(clockRange(at(17, 30), at(18))).toBe('5:30 – 6:00 PM');
    expect(clockRange(at(11, 30), at(12, 30))).toBe('11:30 AM – 12:30 PM');
  });

  it('names days without depending on the machine time zone', () => {
    expect(dayLabel('2026-11-17').short).toBe('Tue 17 Nov');
    expect(dayLabel('2026-11-20').long).toBe('Friday 20 Nov');
  });

  it('rejects malformed times', () => {
    expect(() => hm('4pm')).toThrow();
    expect(() => splitStamp('2026-11-17')).toThrow();
  });
});

describe('sample calendar', () => {
  it('is well formed: every busy block is on a listed day and ends after it starts', () => {
    for (const b of [...cal.busy.owner, ...cal.busy.guest]) {
      const s = splitStamp(b.start);
      const e = splitStamp(b.end);
      expect(cal.days).toContain(s.day);
      expect(e.day).toBe(s.day);
      expect(e.min).toBeGreaterThan(s.min);
    }
  });
});

describe('schedule', () => {
  it('with no rule, picks the earliest time both are free: Tue 1:00 PM', () => {
    const r = schedule(cal);
    expect(r.best?.id).toBe('2026-11-17T13:00');
    expect(r.best?.end).toBe(at(13, 30));
    expect(r.alternatives.map((s) => s.id)).toEqual(['2026-11-18T17:30', '2026-11-19T12:30']);
    expect(r.reason).toBe('Earliest 30-min time you and Sam are both free.');
  });

  it('"only after 4 PM" skips Tuesday (Sam commutes, then my gym) and picks Wed 5:30 PM', () => {
    const r = schedule(cal, { after: at(16) });
    expect(r.best?.id).toBe('2026-11-18T17:30');
    expect(r.alternatives.map((s) => s.id)).toEqual(['2026-11-19T16:00', '2026-11-20T17:30']);
    expect(r.reason).toContain('after 4:00 PM');
  });

  it('never returns a slot that touches anyone’s busy time or its 10-min buffer', () => {
    for (const s of freeSlots(cal)) {
      for (const b of [...cal.busy.owner, ...cal.busy.guest]) {
        const bs = splitStamp(b.start);
        const be = splitStamp(b.end);
        if (bs.day !== s.day) continue;
        const overlaps = s.start < be.min + 10 && s.end > bs.min - 10;
        expect(overlaps, `${s.id} vs ${b.title}`).toBe(false);
      }
    }
  });

  it('stays inside working hours and on the 30-min grid', () => {
    for (const s of freeSlots(cal)) {
      expect(s.start).toBeGreaterThanOrEqual(at(9));
      expect(s.end).toBeLessThanOrEqual(at(18));
      expect(s.start % 30).toBe(0);
      expect(s.end - s.start).toBe(30);
    }
  });

  it('does not book in the past or without 30 min notice', () => {
    // Exactly 30 min before Tue 1:00 PM: still bookable.
    expect(schedule({ ...cal, now: '2026-11-17T12:30' }).best?.id).toBe('2026-11-17T13:00');
    // One minute later it is too short notice; 1:30 PM hits the buffer before
    // the 2:00 PM design review, so the next free time is Wed 5:30 PM.
    expect(schedule({ ...cal, now: '2026-11-17T12:31' }).best?.id).toBe('2026-11-18T17:30');
    // Thu 5:00 PM: Thu 5:30 PM is exactly 30 min away, so still fine...
    expect(schedule({ ...cal, now: '2026-11-19T17:00' }).best?.id).toBe('2026-11-19T17:30');
    // ...but at 5:01 PM Thursday is over and Friday is next.
    expect(schedule({ ...cal, now: '2026-11-19T17:01' }).best?.id).toBe('2026-11-20T17:30');
  });

  it('honours "before", a single day and excluded days', () => {
    expect(schedule(cal, { before: at(13) }).best?.id).toBe('2026-11-19T12:30');
    expect(schedule(cal, { day: '2026-11-20' }).best?.id).toBe('2026-11-20T17:30');
    expect(schedule(cal, { notDays: ['2026-11-17'] }).best?.id).toBe('2026-11-18T17:30');
  });

  it('explains when nothing fits', () => {
    const r = schedule(cal, { day: '2026-11-16' });
    expect(r.best).toBeNull();
    expect(r.alternatives).toEqual([]);
    expect(r.reason).toBe('No time this week when you and Sam are both free on Monday 16 Nov.');
  });

  it('labels slots for the card', () => {
    expect(slotLabel(schedule(cal).best!)).toBe('Tue 17 Nov, 1:00 – 1:30 PM IST');
  });
});

describe('plan: linked slot and invite cards', () => {
  it('drafts the invite for the chosen slot', () => {
    const plan = makePlan(cal);
    expect(isLinked(plan)).toBe(true);
    expect(plan.invite!.slotId).toBe(plan.slot!.id);
    expect(plan.invite!.to).toBe('Sam <sam.tester@example.com>');
    expect(plan.invite!.subject).toBe('App test call: Tue 17 Nov, 1:00 – 1:30 PM IST');
    expect(plan.invite!.body).toContain('Tuesday 17 Nov, 1:00 – 1:30 PM IST');
    expect(plan.approval).toBe('needs');
  });

  it('a new rule recomputes the slot and rewrites the invite', () => {
    const before = makePlan(cal);
    const after = makePlan(cal, { after: at(16) }, 'only after 4 PM', before);
    expect(after.slot!.id).toBe('2026-11-18T17:30');
    expect(after.invite!.body).toContain('Wednesday 18 Nov, 5:30 – 6:00 PM IST');
    expect(after.invite!.body).not.toContain('Tuesday');
    expect(after.version).toBe(before.version + 1);
    expect(isLinked(after)).toBe(true);
  });

  it('any change resets approval to "needs"', () => {
    const approved = { ...makePlan(cal), approval: 'approved' as const };
    expect(makePlan(cal, { after: at(16) }, 'only after 4 PM', approved).approval).toBe('needs');
    expect(chooseSlot(cal, approved, approved.alternatives[0]).approval).toBe('needs');
  });

  it('picking another slot swaps it with the current one and rewrites the invite', () => {
    const plan = makePlan(cal);
    const thu = plan.alternatives[1];
    const next = chooseSlot(cal, plan, thu);
    expect(next.slot!.id).toBe('2026-11-19T12:30');
    expect(next.invite!.subject).toBe('App test call: Thu 19 Nov, 12:30 – 1:00 PM IST');
    expect(next.alternatives.map((s) => s.id)).toEqual(['2026-11-17T13:00', '2026-11-18T17:30']);
    expect(isLinked(next)).toBe(true);
  });

  it('picking the slot already shown changes nothing', () => {
    const plan = makePlan(cal);
    expect(chooseSlot(cal, plan, plan.slot!)).toBe(plan);
  });

  it('with no free time there is no invite to approve', () => {
    const plan = makePlan(cal, { day: '2026-11-16' }, 'Monday only');
    expect(plan.slot).toBeNull();
    expect(plan.invite).toBeNull();
    expect(isLinked(plan)).toBe(true);
  });

  it('detects a broken link', () => {
    const plan = makePlan(cal);
    const broken = { ...plan, invite: draftInvite(cal, plan.alternatives[0]) };
    expect(isLinked(broken)).toBe(false);
  });
});
