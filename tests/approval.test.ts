import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { HOLD, HoldToApprove } from '../src/logic/hold.js';
import { addToOutbox, approve, chooseSlot, makePlan } from '../src/logic/plan.js';
import type { CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const FRAME = 1 / 60;

/** Run `seconds` of frames; returns the events seen. */
function run(h: HoldToApprove, seconds: number, pressed: boolean, enabled = true) {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += FRAME) events.push(h.update(FRAME, pressed, enabled));
  return events;
}

describe('HoldToApprove', () => {
  it('completes after about one second of holding, exactly once', () => {
    const h = new HoldToApprove();
    const events = run(h, 0.95, true);
    expect(events).not.toContain('complete');
    expect(h.progress).toBeGreaterThan(0.9);
    const more = run(h, 0.1, true);
    expect(more.filter((e) => e === 'complete')).toHaveLength(1);
    expect(h.progress).toBe(0);
  });

  it('does not approve again while the same pinch is still held', () => {
    const h = new HoldToApprove();
    run(h, 1.05, true);
    expect(run(h, 3, true)).not.toContain('complete');
  });

  it('can approve again after a real release', () => {
    const h = new HoldToApprove();
    run(h, 1.05, true);
    run(h, 0.3, false);
    expect(run(h, 1.05, true)).toContain('complete');
  });

  it('a short tap does nothing', () => {
    const h = new HoldToApprove();
    expect(run(h, 0.2, true)).not.toContain('complete');
    run(h, 1, false);
    expect(h.progress).toBe(0);
  });

  it('survives a ray flicker shorter than the grace time', () => {
    const h = new HoldToApprove();
    run(h, 0.5, true);
    const before = h.progress;
    run(h, HOLD.graceSeconds - 0.03, false);
    expect(h.progress).toBeCloseTo(before);
    expect(run(h, 0.55, true)).toContain('complete');
  });

  it('letting go drains the ring instead of snapping it to zero', () => {
    const h = new HoldToApprove();
    run(h, 0.6, true);
    run(h, HOLD.graceSeconds + 0.05, false);
    expect(h.progress).toBeGreaterThan(0);
    expect(h.progress).toBeLessThan(0.6);
    run(h, 0.5, false);
    expect(h.progress).toBe(0);
  });

  it('does nothing while approval is not possible', () => {
    const h = new HoldToApprove();
    expect(run(h, 2, true, false)).not.toContain('complete');
    expect(h.progress).toBe(0);
  });

  it('a long frame stall cannot complete a hold by itself', () => {
    const h = new HoldToApprove();
    expect(h.update(5, true, true)).toBe('holding');
    expect(h.progress).toBeCloseTo(0.1);
  });

  it('needs a release after approving, even if approval becomes possible again', () => {
    const h = new HoldToApprove();
    run(h, 1.05, true); // approved
    run(h, 0.5, true, false); // invite approved: nothing to do
    // A new invite appears while the user is still pinching: no instant approval.
    expect(run(h, 1.5, true, true)).not.toContain('complete');
    run(h, 0.3, false);
    expect(run(h, 1.05, true)).toContain('complete');
  });
});

describe('approve and the demo outbox', () => {
  it('approving moves the invite to the outbox and marks the card approved', () => {
    const plan = makePlan(cal);
    const r = approve(plan, '2026-11-13T15:00:00Z')!;
    expect(r.plan.approval).toBe('approved');
    expect(r.plan.version).toBe(plan.version + 1);
    expect(r.item.subject).toBe(plan.invite!.subject);
    expect(r.item.slotId).toBe(plan.slot!.id);
  });

  it('cannot approve twice, or approve when there is no invite', () => {
    const plan = makePlan(cal);
    const once = approve(plan, 'x')!;
    expect(approve(once.plan, 'x')).toBeNull();
    expect(approve(makePlan(cal, { day: '2026-11-16' }), 'x')).toBeNull();
  });

  it('a change after approval needs a fresh approval', () => {
    const approved = approve(makePlan(cal), 'x')!.plan;
    const changed = makePlan(cal, { after: 16 * 60 }, 'only after 4 PM', approved);
    expect(changed.approval).toBe('needs');
    expect(approve(changed, 'y')).not.toBeNull();
    const swapped = chooseSlot(cal, approved, approved.alternatives[0]);
    expect(swapped.approval).toBe('needs');
  });

  it('outbox keeps newest first, no duplicates, capped', () => {
    const plan = makePlan(cal);
    const a = approve(plan, 'x')!.item;
    const b = approve(chooseSlot(cal, plan, plan.alternatives[0]), 'y')!.item;
    let box = addToOutbox([], a);
    box = addToOutbox(box, b);
    box = addToOutbox(box, a);
    expect(box.map((i) => i.id)).toEqual([a.id, b.id]);
    let many = box;
    for (let i = 0; i < 10; i++) many = addToOutbox(many, { ...a, id: `n${i}` }, 5);
    expect(many).toHaveLength(5);
  });
});
