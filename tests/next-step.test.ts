import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { nextSteps, prepBlock, reminderItem, withOwnerBusy } from '../src/logic/next-step.js';
import { freeSlots, schedule, type CalendarData, type Slot } from '../src/logic/scheduler.js';
import { weekModel } from '../src/logic/week.js';

const cal = calendarJson as CalendarData;
const best = schedule(cal, {}).best as Slot; // Tue 1:00 PM with the sample week

describe("the agent's next step after sending", () => {
  it('offers a prep block first, then a reminder, each needing a yes', () => {
    const steps = nextSteps(cal, best);
    expect(steps.map((s) => s.kind)).toEqual(['prep', 'remind']);
    expect(steps[0].text).toMatch(/10-min prep block .*Tue 12:50 PM/);
    expect(steps[1].text).toMatch(/reminder 1 hour before \(Tue 12:00 PM\)/);
    expect(steps.every((s) => s.yes && s.no)).toBe(true);
  });

  it('only offers prep when the 10 minutes before are free for you', () => {
    const busyBefore = withOwnerBusy(cal, { start: `${best.day}T12:40`, end: `${best.day}T13:00`, title: 'Errand' });
    expect(prepBlock(busyBefore, best)).toBeNull();
    expect(nextSteps(busyBefore, best).map((s) => s.kind)).toEqual(['remind']);
  });

  it('the prep block is yours, right before the call, and never conflicts with it', () => {
    const block = prepBlock(cal, best)!;
    expect(block).toEqual({ day: best.day, start: best.start - 10, end: best.start, who: 'you', title: 'Prep (agent)' });
    // Display-only: the call stays free in the scheduling calendar (the gap rule
    // would otherwise call it "too close to Prep").
    expect(freeSlots(cal).some((s) => s.id === best.id)).toBe(true);
    expect(weekModel(cal).cells.find((c) => c.day === best.day && c.start === best.start)?.kind).toBe('free');
  });

  it('the reminder is a demo outbox item to the guest', () => {
    const r = reminderItem(cal, best, '2026-11-15T10:00:00Z');
    expect(r).toMatchObject({ status: 'sent', slotId: best.id });
    expect(r.subject).toBe('Reminder: app test call · Tue 1:00 PM');
    expect(r.to).toContain(cal.guest.name);
  });
});
