import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import calendarJson from '../src/data/sample-calendar.json';
import { eventIcs, mailtoLink } from '../src/logic/handoff.js';
import { checkedMoving, isMove, makeMovePlan, movableAt, moveWindows, nearestFirst, withMoved, withoutBlock } from '../src/logic/move.js';
import { approve, chooseSlot, isLinked, makePlan } from '../src/logic/plan.js';
import { restore, serialize } from '../src/logic/storage.js';
import { muralAction } from '../src/logic/touch-week.js';
import { weekModel } from '../src/logic/week.js';
import { freeSlots, type CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const TUE = '2026-11-17';
const WED = '2026-11-18';
const at = (h: number, m = 0) => h * 60 + m;
const review = { day: TUE, start: at(14), end: at(15, 30), title: 'Design review' };

describe('third task: move one of your own meetings', () => {
  it('finds your meeting under a pinch; not the guest\'s, not empty time', () => {
    expect(movableAt(cal, TUE, at(14, 30))).toEqual(review);
    expect(movableAt(cal, TUE, at(15, 30))).toBeNull(); // it ended at 3:30
    expect(movableAt(cal, TUE, at(11, 30))).toBeNull(); // Sam's class
    expect(movableAt(cal, TUE, at(13))).toBeNull(); // free
  });

  it('a meeting that already started, or a whole-day block, is not offered', () => {
    expect(movableAt(cal, '2026-11-16', at(9, 30))?.title).toBe('Sprint planning'); // starts in 30 min: still movable
    expect(movableAt({ ...cal, now: '2026-11-16T10:00' }, '2026-11-16', at(10, 30))).toBeNull();
    expect(movableAt(cal, '2026-11-20', at(10))).toBeNull(); // 8-hour hack day
  });

  it('its own time does not block it, and its current start is never offered back', () => {
    const w = moveWindows(cal, review);
    expect(w[0]).toMatchObject({ day: TUE, start: at(13), end: at(14, 30) });
    expect(w.some((s) => s.day === TUE && s.start === at(14))).toBe(false);
    expect(w.every((s) => s.end - s.start === 90)).toBe(true);
    // Still respects your other meetings (gym at 5 PM, with the 10-minute gap).
    expect(w.filter((s) => s.day === TUE).map((s) => s.start)).toEqual([at(13), at(13, 30), at(14, 30), at(15)]);
  });

  it('the plan: a change on your calendar, linked to the new time, explained in one line', () => {
    const p = makeMovePlan(cal, review);
    expect(isMove(p)).toBe(true);
    expect(p.task).toBe('Move “Design review” to another time');
    // 1:30 PM and 2:30 PM are both 30 minutes away: the later one wins. (1:00 PM, the first of the day, is further.)
    expect(p.slot?.id).toBe(`${TUE}T14:30`);
    expect(p.reason).toBe('Tue 2:30 PM is the nearest free 90 minutes: 30 min later, same day.');
    expect(p.invite?.subject).toBe('Design review (moved): Tue 17 Nov, 2:30 – 4:00 PM IST');
    expect(p.invite?.body).toMatch(/Moved from Tuesday 17 Nov, 2:00 – 3:30 PM\nto Tuesday 17 Nov, 2:30 – 4:00 PM IST\./);
    expect(p.invite?.body).toMatch(/tell the others yourself/);
    expect(isLinked(p)).toBe(true);
    expect(p.alternatives.every((a) => a.id !== p.slot?.id)).toBe(true);
  });

  it('rules apply: "not Tuesday" sends it to another day and says why', () => {
    const p = makeMovePlan(cal, review, { notDays: [TUE] }, 'only not on Tuesday');
    expect(p.slot?.day).not.toBe(TUE);
    // Tuesday was not searched (the rule leaves it out), so the line does not say it is full.
    expect(p.reason).toMatch(/^Your rule leaves out Tue, so /);
    const none = makeMovePlan(cal, review, { day: '2026-11-20' });
    expect(none.slot).toBeNull();
    expect(none.invite).toBeNull();
    expect(none.reason).toBe('No other time this week has 90 free minutes inside your rule.');
  });

  it('picking another time on the wall keeps it a move, not a meeting invite', () => {
    const p = makeMovePlan(cal, review);
    const week = weekModel(withoutBlock(cal, review), {}, { focus: true, minutes: 90 });
    const a = muralAction(cal, p, week, week.days.indexOf(TUE), at(13)); // the window that starts at 1:00 PM
    expect(a).toMatchObject({ kind: 'pick', slot: { day: TUE, start: at(13) } });
    const picked = chooseSlot(cal, p, (a as { slot: (typeof p.alternatives)[number] }).slot);
    expect(picked.moving).toEqual(review);
    expect(picked.invite?.subject).toMatch(/^Design review \(moved\): Tue 17 Nov, 1:00 – 2:30 PM/);
    expect(picked.by).toBe('you');
  });

  it('the week says how long a gap must be', () => {
    const week = weekModel(withoutBlock(cal, review), {}, { focus: true, minutes: 90 });
    const reasons = new Set(week.cells.map((c) => c.reason));
    expect(reasons.has('part of 90 free minutes')).toBe(true);
    expect(reasons.has('gap under 90 min')).toBe(true);
    // Focus time keeps its own words.
    expect(new Set(weekModel(cal, {}, { focus: true }).cells.map((c) => c.reason)).has('part of 2 free hours')).toBe(true);
  });

  it('after you approve, the meeting sits at its new time and the next task plans around it', () => {
    const p = makeMovePlan(cal, review, {}, '', undefined, { slot: moveWindows(cal, review)[0] }); // you picked 1:00 PM
    const after = withMoved(cal, review, p.slot!);
    expect(after.busy.owner).toHaveLength(cal.busy.owner.length);
    expect(after.busy.owner.some((b) => b.start === `${TUE}T14:00`)).toBe(false);
    expect(after.busy.owner.some((b) => b.start === `${TUE}T13:00` && b.end === `${TUE}T14:30` && b.title === 'Design review')).toBe(true);
    // The old default call time (Tue 1:00 PM) is now taken.
    expect(makePlan(cal).slot?.id).toBe(`${TUE}T13:00`);
    expect(freeSlots(after).some((s) => s.id === `${TUE}T13:00`)).toBe(false);
    // Moving a meeting that is not there changes nothing.
    expect(withMoved(cal, { ...review, start: at(8) }, p.slot!)).toBe(cal);
  });

  it('what you approved becomes a calendar file, with no one to email', () => {
    const item = approve(makeMovePlan(cal, review), '2026-11-16T04:00:00.000Z')!.item;
    expect(item.minutes).toBe(90);
    expect(mailtoLink(item)).toBeNull();
    const event = new ICAL.Event(new ICAL.Component(ICAL.parse(eventIcs(item)!)).getFirstSubcomponent('vevent')!);
    expect(event.summary).toBe('Design review (moved)');
    expect(event.startDate.toString()).toBe('2026-11-17T14:30:00');
    expect(event.duration.toSeconds()).toBe(5400);
  });

  it('the known case: Wednesday 3 PM stays on Wednesday when 2:30 and 3:30 are free', () => {
    // A week with a free Tuesday morning (the old code took the first window of the week: Tue 9:00 AM,
    // and said "No room left on Wed").
    const week: CalendarData = {
      ...cal,
      busy: {
        owner: [
          { start: `${WED}T09:00`, end: `${WED}T13:00`, title: 'Build' },
          { start: `${WED}T15:00`, end: `${WED}T16:00`, title: 'Budget review' },
        ],
        guest: [],
      },
    };
    const meeting = { day: WED, start: at(15), end: at(16), title: 'Budget review' };
    const all = moveWindows(week, meeting);
    expect(all[0]).toMatchObject({ day: '2026-11-16', start: at(9, 30) }); // the first window of the week is Monday
    expect(all.some((s) => s.day === TUE && s.start === at(9))).toBe(true); // Tue 9:00 AM is free
    expect(all.some((s) => s.day === WED && s.start === at(14, 30))).toBe(true);
    expect(all.some((s) => s.day === WED && s.start === at(15, 30))).toBe(true);
    const p = makeMovePlan(week, meeting);
    expect(p.slot).toMatchObject({ day: WED, start: at(15, 30) }); // 30 minutes later, not another day
    expect(p.reason).toBe('Wed 3:30 PM is the nearest free 60 minutes: 30 min later, same day.');
    expect(p.alternatives[0]).toMatchObject({ day: WED }); // the runner-ups are the next nearest
    expect(nearestFirst(meeting, all).slice(0, 2).map((s) => s.start)).toEqual([at(15, 30), at(14, 30)]);
    // Another day is chosen, and said, only when Wednesday really has no room.
    const full: CalendarData = {
      ...week,
      busy: { owner: [...week.busy.owner, { start: `${WED}T13:00`, end: `${WED}T15:00`, title: 'Lunch + calls' }, { start: `${WED}T16:00`, end: `${WED}T18:00`, title: 'Workshop' }], guest: [] },
    };
    const q = makeMovePlan(full, meeting);
    expect(q.slot?.day).not.toBe(WED);
    expect(q.reason).toMatch(/^Wed has no other free 60 minutes, so /);
  });

  it('a saved move comes back only if that meeting is really on the calendar', () => {
    const p = makeMovePlan(cal, review);
    const back = restore(serialize(p, [], '2026-11-16T04:00:00.000Z'), cal);
    expect(back?.plan?.moving).toEqual(review);
    expect(back?.plan?.slot?.id).toBe(`${TUE}T14:30`);
    const forged = JSON.parse(serialize(p, [], '2026-11-16T04:00:00.000Z'));
    forged.plan.moving = { day: WED, start: at(9), end: at(9, 30), title: '<img src=x>' };
    expect(restore(JSON.stringify(forged), cal)).toBeNull();
    expect(checkedMoving(cal, { day: TUE, start: at(14), end: at(15, 30), title: 'anything' })?.title).toBe('Design review');
    expect(checkedMoving(cal, 'x')).toBeNull();
  });
});
