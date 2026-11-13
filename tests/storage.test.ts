import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { addToOutbox, approve, makePlan } from '../src/logic/plan.js';
import { restore, serialize } from '../src/logic/storage.js';
import type { CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;

describe('save and restore the board', () => {
  it('round-trips a plan and the outbox', () => {
    const plan = makePlan(cal, { after: 960 }, 'only after 4 PM');
    const done = approve(plan, '2026-11-13T15:00:00Z')!;
    const box = addToOutbox([], done.item);
    const back = restore(serialize(done.plan, box, '2026-11-13T15:01:00Z'), cal)!;
    expect(back.plan!.slot!.id).toBe('2026-11-18T17:30');
    expect(back.plan!.approval).toBe('approved');
    expect(back.plan!.constraintText).toBe('only after 4 PM');
    expect(back.outbox).toHaveLength(1);
    expect(back.savedAt).toBe('2026-11-13T15:01:00Z');
  });

  it('ignores empty, broken or old-version data', () => {
    expect(restore(null, cal)).toBeNull();
    expect(restore('not json', cal)).toBeNull();
    expect(restore(JSON.stringify({ v: 99, savedAt: 'x', plan: null, outbox: [] }), cal)).toBeNull();
    expect(restore(serialize(null, [], 'x'), cal)).toBeNull(); // nothing to show
  });

  it('drops a plan whose slot is not a real free time', () => {
    const plan = makePlan(cal);
    const tampered = { ...plan, slot: { ...plan.slot!, id: '2026-11-17T09:00' } };
    expect(restore(serialize(tampered, [], 'x'), cal)).toBeNull();
  });

  it('drops a plan whose invite does not match its slot', () => {
    const plan = makePlan(cal);
    const broken = { ...plan, invite: { ...plan.invite!, slotId: plan.alternatives[0].id } };
    expect(restore(serialize(broken, [], 'x'), cal)).toBeNull();
  });

  it('keeps a valid outbox even when the plan is unusable', () => {
    const done = approve(makePlan(cal), 'x')!;
    const json = JSON.parse(serialize(done.plan, [done.item], 'x'));
    json.plan.approval = 'maybe';
    const back = restore(JSON.stringify(json), cal)!;
    expect(back.plan).toBeNull();
    expect(back.outbox).toHaveLength(1);
  });

  it('re-reads slot times from the calendar, not from storage', () => {
    const plan = makePlan(cal);
    const json = JSON.parse(serialize(plan, [], 'x'));
    json.plan.slot.start = 0; // a tampered time with a real id
    expect(restore(JSON.stringify(json), cal)!.plan!.slot!.start).toBe(13 * 60);
  });
});
