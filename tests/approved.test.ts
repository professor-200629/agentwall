import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { heldBy, holdsTime, withApproved } from '../src/logic/approved.js';
import { exampleBlock, withExample } from '../src/logic/example-change.js';
import { makeFocusPlan } from '../src/logic/focus.js';
import { makeMovePlan } from '../src/logic/move.js';
import { reminderItem } from '../src/logic/next-step.js';
import { approve, makePlan, type OutboxItem, type Plan } from '../src/logic/plan.js';
import { candidates, revalidate } from '../src/logic/review.js';
import type { CalendarData, Slot } from '../src/logic/scheduler.js';

const A = calendarJson as CalendarData;
const TUE = '2026-11-17';
const THU = '2026-11-19';
const AT = '2026-11-16T04:00:00.000Z';
const at = (h: number, m = 0) => h * 60 + m;
const overlap = (a: Pick<Slot, 'day' | 'start' | 'end'>, b: Pick<Slot, 'day' | 'start' | 'end'>) => a.day === b.day && a.start < b.end && b.start < a.end;

/** An approval that went out (past its Unsend window). */
function sent(plan: Plan): OutboxItem {
  return { ...approve(plan, AT, { source: 'sample' })!.item, status: 'sent' };
}

describe('what you approved is busy time for the agent', () => {
  it('asking for the same call again does not offer the time you already approved', () => {
    const first = makePlan(A);
    expect(first.slot?.id).toBe(`${TUE}T13:00`);
    const box = [sent(first)];
    // The calendar that was read alone would offer it again: two invites for one time.
    expect(makePlan(A).slot?.id).toBe(`${TUE}T13:00`);
    const again = makePlan(withApproved(A, box));
    expect(again.slot).not.toBeNull();
    expect(overlap(again.slot!, first.slot!)).toBe(false);
    // Not as a runner-up either, and never closer than the calendar's own gap between meetings.
    for (const s of [again.slot!, ...again.alternatives]) {
      expect(overlap(s, first.slot!)).toBe(false);
      expect(s.day !== TUE || s.start >= first.slot!.end + A.meeting.bufferMinutes || s.end <= first.slot!.start - A.meeting.bufferMinutes).toBe(true);
    }
  });

  it('a call does not land on an approved focus block', () => {
    const focus = makeFocusPlan(A);
    expect(focus.slot).toMatchObject({ day: THU, start: at(12, 30), end: at(14, 30) });
    const box = [sent(focus)];
    expect(overlap(makePlan(A, { day: THU }).slot!, focus.slot!)).toBe(true); // what happened before
    const call = makePlan(withApproved(A, box), { day: THU });
    expect(call.slot?.day).toBe(THU);
    expect(overlap(call.slot!, focus.slot!)).toBe(false);
  });

  it('moving a meeting does not put it on an approved call', () => {
    const call = makePlan(A);
    const box = [sent(call)];
    const lunch = { day: TUE, start: at(12), end: at(12, 45), title: 'Lunch' };
    expect(overlap(makeMovePlan(A, lunch).slot!, call.slot!)).toBe(true); // what happened before
    const moved = makeMovePlan(withApproved(A, box), lunch);
    expect(moved.slot).not.toBeNull();
    for (const s of [moved.slot!, ...moved.alternatives]) expect(overlap(s, call.slot!)).toBe(false);
  });

  it('a replacement is not offered on top of another approval that stands', () => {
    const one = sent(makePlan(A));
    const two = sent(makePlan(withApproved(A, [one])));
    const calB = withExample(A, [exampleBlock(A, { day: TUE, start: at(13), end: at(13, 30) })]);
    const box = revalidate([one, two], calB, AT).outbox;
    expect(box[0].blocked?.why).toBe('conflict');
    const slotTwo = { day: two.slotId.slice(0, 10), start: at(Number(two.slotId.slice(11, 13)), Number(two.slotId.slice(14))), end: 0 };
    slotTwo.end = slotTwo.start + 30;
    const found = candidates(withApproved(calB, box), 'call', { id: one.slotId, day: TUE, start: at(13), end: at(13, 30) });
    expect(found.length).toBeGreaterThan(0);
    for (const c of found) expect(overlap(c.slot, slotTwo)).toBe(false);
  });
});

describe('which approvals hold their time', () => {
  const call = sent(makePlan(A));
  const focus = sent(makeFocusPlan(A));

  it('a call and a focus block do, also inside the Unsend window', () => {
    expect(holdsTime(call)).toBe(true);
    expect(holdsTime(focus)).toBe(true);
    expect(holdsTime({ ...call, status: 'sending' })).toBe(true);
    const cal = withApproved(A, [call, focus]);
    expect(cal.busy.owner).toHaveLength(A.busy.owner.length + 2);
    expect(cal.busy.owner.slice(-2)).toEqual([
      { start: `${TUE}T13:00`, end: `${TUE}T13:30`, title: 'App test call (approved)' },
      { start: `${THU}T12:30`, end: `${THU}T14:30`, title: 'Focus time (approved)' },
    ]);
    expect(cal.busy.guest).toBe(A.busy.guest);
    expect(A.busy.owner).toHaveLength(11); // the calendar that was read is untouched
  });

  it('a blocked or replaced one does not, nor a reminder, nor the one left out', () => {
    expect(holdsTime({ ...call, blocked: { why: 'conflict', text: 'x', at: AT } })).toBe(false);
    expect(holdsTime({ ...call, blocked: { why: 'superseded', text: 'x', at: AT, by: 'y' } })).toBe(false);
    expect(holdsTime(reminderItem(A, makePlan(A).slot!, AT))).toBe(false);
    expect(withApproved(A, [{ ...call, blocked: { why: 'conflict', text: 'x', at: AT } }])).toBe(A);
    expect(withApproved(A, [call], call.id)).toBe(A);
    expect(withApproved(A, [])).toBe(A);
  });

  it('the approval boundary can name the approval that holds a time', () => {
    const tue1 = { day: TUE, start: at(13), end: at(13, 30) };
    expect(heldBy([call, focus], tue1)?.id).toBe(call.id);
    expect(heldBy([call, focus], { day: TUE, start: at(13, 15), end: at(13, 45) })?.id).toBe(call.id); // a partial overlap counts
    expect(heldBy([call, focus], { day: TUE, start: at(13, 30), end: at(14) })).toBeNull(); // touching is not overlapping
    expect(heldBy([call, focus], { day: THU, start: at(14), end: at(14, 30) })?.id).toBe(focus.id);
    expect(heldBy([call], tue1, call.id)).toBeNull(); // the one being replaced
    expect(heldBy([{ ...call, blocked: { why: 'conflict', text: 'x', at: AT } }], tue1)).toBeNull();
  });
});
