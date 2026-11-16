import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import calendarJson from '../src/data/sample-calendar.json';
import { buildPayload, understandRule, type FetchLike } from '../src/logic/agent.js';
import { cleanExample, EXAMPLE, exampleApproval, exampleBlock, isExampleBlock, withExample } from '../src/logic/example-change.js';
import { makeFocusPlan } from '../src/logic/focus.js';
import { asText, eventIcs, mailtoLink, slotInstant } from '../src/logic/handoff.js';
import { HoldToApprove } from '../src/logic/hold.js';
import { reminderItem } from '../src/logic/next-step.js';
import { addToOutbox, approve, buildReceipt, makePlan, reviewedMark, type OutboxItem, type Plan } from '../src/logic/plan.js';
import { parseRequest } from '../src/logic/request.js';
import {
  candidates,
  checkHandOff,
  conflictText,
  itemSlot,
  kindOf,
  moveLine,
  needsReview,
  overlapsOf,
  planForItem,
  refreshReview,
  replacementTradeOff,
  revalidate,
  startReview,
  usable,
} from '../src/logic/review.js';
import { freeSlots, type BusyBlock, type CalendarData, type Slot } from '../src/logic/scheduler.js';
import { restore, serialize } from '../src/logic/storage.js';

const A = calendarJson as CalendarData; // snapshot A: the sample week
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const AT = '2026-11-16T04:00:00.000Z';
const at = (h: number, m = 0) => h * 60 + m;
const FRAME = 1 / 60;

/** An approval that went out (past its Unsend window). */
function sent(plan: Plan, cal: CalendarData = A): OutboxItem {
  const done = approve(plan, AT, { source: cal.source === 'yours' ? 'yours' : 'sample', startUtc: plan.slot ? slotInstant(cal, plan.slot) : null })!;
  return { ...done.item, status: 'sent' };
}
const B = (slot: Pick<Slot, 'day' | 'start' | 'end'>, cal: CalendarData = A) => withExample(cal, [exampleBlock(cal, slot)]);
const trial = (cal: CalendarData, slot: Slot, replaces?: string): Plan => ({
  ...makePlan(cal, {}, '', undefined, { slot, by: 'you' }),
  alternatives: [],
  ...(replaces ? { replaces } : {}),
});

describe('conflict detection from successive calendar inputs', () => {
  it('snapshot A is clear; snapshot B puts one labelled busy block over the approved time', () => {
    const plan = makePlan(A);
    expect(plan.slot?.id).toBe(`${TUE}T13:00`);
    const item = sent(plan);
    expect(revalidate([item], A, AT)).toMatchObject({ newly: [], changed: false });
    const block = exampleBlock(A, plan.slot!);
    expect(block).toEqual({ start: `${TUE}T13:00`, end: `${TUE}T14:00`, title: 'Client call (example change)' });
    expect(isExampleBlock(block)).toBe(true);
    const calB = B(plan.slot!);
    expect(calB.busy.owner).toHaveLength(A.busy.owner.length + 1);
    expect(A.busy.owner).toHaveLength(11); // A itself is untouched
    const checked = revalidate([item], calB, AT);
    expect(checked.newly).toEqual([item.id]);
    expect(checked.outbox[0].blocked).toEqual({ why: 'conflict', text: 'Tue 1:00 PM overlaps a new busy block', at: AT });
  });

  it('the reason names the time, and says what is not known about the guest', () => {
    const slot = makePlan(A).slot!;
    expect(conflictText(A, slot)).toEqual({ reason: 'Tue 1:00 PM overlaps a new busy block', detail: 'Both sample calendars checked' });
    expect(conflictText({ ...A, source: 'yours' }, slot).detail).toBe('Guest availability unknown');
  });

  it('your own calendar: a second import with a new event over the approved time is the same check', () => {
    const first: CalendarData = { ...A, source: 'yours', busy: { owner: [{ start: `${TUE}T09:00`, end: `${TUE}T10:00`, title: 'Standup' }], guest: [] } };
    const plan = makePlan(first, { day: TUE, after: at(15) }, 'only after 3 PM, on Tuesday');
    expect(plan.slot?.id).toBe(`${TUE}T15:00`);
    const item = sent(plan, first);
    expect(item.source).toBe('yours');
    const second: CalendarData = { ...first, busy: { owner: [...first.busy.owner, { start: `${TUE}T14:30`, end: `${TUE}T15:15`, title: 'Dentist' }], guest: [] } };
    expect(revalidate([item], first, AT).changed).toBe(false);
    const checked = revalidate([item], second, AT);
    expect(checked.outbox[0].blocked?.text).toBe('Tue 3:00 PM overlaps a new busy block');
    expect(overlapsOf(second, plan.slot!)).toEqual([{ who: 'you', day: TUE, start: at(14, 30), end: at(15, 15), title: 'Dentist' }]);
    // The reason line itself never carries an event title.
    expect(checked.outbox[0].blocked?.text).not.toMatch(/Dentist/);
  });

  it('a real overlap blocks; "too close" (the 10-minute gap) does not', () => {
    const slot = makePlan(A).slot!; // Tue 1:00 – 1:30 PM
    const near = withExample(A, [{ start: `${TUE}T13:30`, end: `${TUE}T13:45`, title: 'x' }]);
    expect(freeSlots(near).some((s) => s.id === slot.id)).toBe(false); // the planner would not pick it now
    expect(overlapsOf(near, slot)).toHaveLength(0); // but nothing collides: no conflict
  });

  it('the approved event itself, back in your calendar under its own title, is not a conflict', () => {
    const yours: CalendarData = { ...A, source: 'yours', topic: 'the Q3 budget', busy: { owner: [], guest: [] } };
    const plan = makePlan(yours, { day: TUE, after: at(15) });
    const item = sent(plan, yours);
    expect(item.subject).toMatch(/^Call about the Q3 budget: /);
    const again: CalendarData = { ...yours, busy: { owner: [{ start: `${TUE}T15:00`, end: `${TUE}T15:30`, title: 'Call about the Q3 budget' }], guest: [] } };
    expect(revalidate([item], again, AT).changed).toBe(false);
    // Another event at the very same time still is one.
    const other: CalendarData = { ...yours, busy: { owner: [{ start: `${TUE}T15:00`, end: `${TUE}T15:30`, title: 'Dentist' }], guest: [] } };
    expect(revalidate([item], other, AT).newly).toEqual([item.id]);
  });

  it('a time already over is history, not a conflict', () => {
    const item = sent(makePlan(A));
    const later = { ...B(itemSlot(item)!), now: `${WED}T09:00` };
    expect(revalidate([item], later, AT).changed).toBe(false);
  });
});

describe('an old approval is blocked at once, and stays blocked', () => {
  const plan = makePlan(A);
  const item = sent(plan);
  const calB = B(plan.slot!);
  const blocked = revalidate([item], calB, AT).outbox[0];

  it('nothing can be handed off from a blocked item', () => {
    expect(usable(item)).toBe(true);
    expect(mailtoLink(item)).toMatch(/^mailto:sam\.tester@example\.com\?/);
    expect(eventIcs(item)).toMatch(/BEGIN:VEVENT/);
    expect(usable(blocked)).toBe(false);
    expect(mailtoLink(blocked)).toBeNull();
    expect(eventIcs(blocked)).toBeNull();
    expect(asText(blocked)).toBe('');
    expect(checkHandOff([item], item.id, A, AT)).toMatchObject({ ok: true });
    // The hand-off boundary checks the newest calendar again, even when the stored item still looks fine.
    expect(checkHandOff([item], item.id, calB, AT)).toEqual({ ok: false, why: 'Tue 1:00 PM overlaps a new busy block' });
    expect(checkHandOff([item], 'gone', calB, AT)).toEqual({ ok: false, why: 'This approval is gone.' });
    expect(checkHandOff([{ ...item, status: 'sending' }], item.id, A, AT)).toMatchObject({ ok: false });
  });

  it('after leaving and coming back it is still blocked, and the example block is still on the wall', () => {
    const json = serialize(null, [blocked], AT, [exampleBlock(A, plan.slot!)]);
    const back = restore(json, A)!;
    expect(back.example).toEqual([exampleBlock(A, plan.slot!)]);
    expect(back.outbox[0].blocked).toEqual(blocked.blocked);
    const cal = withExample(A, back.example);
    expect(checkHandOff(back.outbox, item.id, cal, AT).ok).toBe(false);
    expect(needsReview(back.outbox)?.id).toBe(item.id);
    // Even with the flag wiped from storage, the saved example block brings the conflict back.
    const wiped = JSON.parse(json);
    delete wiped.outbox[0].blocked;
    const again = restore(JSON.stringify(wiped), A)!;
    expect(again.outbox[0].blocked).toBeUndefined();
    expect(revalidate(again.outbox, withExample(A, again.example), AT).newly).toEqual([item.id]);
  });

  it('a conflict stays until you replace it, even if a later calendar is clear again', () => {
    expect(revalidate([blocked], A, AT)).toMatchObject({ changed: false, newly: [] });
    expect(revalidate([blocked], A, AT).outbox[0].blocked?.why).toBe('conflict');
  });

  it('the approved plan on the board is dropped when its time is busy; the item brings it back for the review', () => {
    const done = approve(plan, AT)!;
    const back = restore(serialize(done.plan, [blocked], AT, [exampleBlock(A, plan.slot!)]), A)!;
    expect(back.plan).toBeNull(); // Tue 1:00 PM is not a free time any more
    const again = planForItem(back.outbox[0], 7)!;
    expect(again).toMatchObject({ approval: 'approved', version: 7, slot: { id: `${TUE}T13:00`, start: at(13), end: at(13, 30) } });
    expect(again.invite?.subject).toBe(item.subject);
  });

  it('the reminder for that call is blocked with it', () => {
    const remind = reminderItem(A, plan.slot!, AT);
    expect(kindOf(remind)).toBe('reminder');
    const checked = revalidate([remind, item], calB, AT);
    expect(checked.outbox.every((o) => o.blocked?.why === 'conflict')).toBe(true);
    expect(mailtoLink(checked.outbox[0])).toBeNull();
    expect(needsReview(checked.outbox)?.id).toBe(item.id); // the call is what gets reviewed, not its reminder
  });
});

describe('trying another time, and approving the one you see', () => {
  const plan = makePlan(A);
  const old = plan.slot!;
  const item = sent(plan);
  const calB = B(old);
  const box = revalidate([item], calB, AT).outbox;

  it('B leaves two sensible alternatives: the nearest, and the same time of day on another day', () => {
    const c = candidates(calB, 'call', old);
    expect(c.map((x) => [x.label, x.why])).toEqual([
      ['Wed 5:30 PM', 'nearest'],
      ['Thu 1:00 PM', 'same time of day'],
    ]);
    // Every candidate is a time the scheduler itself calls free.
    const free = new Set(freeSlots(calB).map((s) => s.id));
    expect(c.every((x) => free.has(x.slot.id))).toBe(true);
    expect(c.some((x) => x.slot.id === old.id)).toBe(false);
  });

  it('one computed trade-off per candidate', () => {
    const [wed, thu] = candidates(calB, 'call', old);
    expect(replacementTradeOff(calB, 'call', old, wed.slot)).toBe('Last half hour of the workday');
    expect(replacementTradeOff(calB, 'call', old, thu.slot)).toBe("Leaves 30 minutes before Sam's next event");
    expect(moveLine('call', old, wed.slot)).toBe('Moves the call 1 day 4 h 30 min later');
    expect(moveLine('call', old, thu.slot)).toBe('Moves the call 2 days later');
    expect(moveLine('call', old, { ...old, id: 'x', start: at(15), end: at(15, 30) })).toBe('Moves the call 2 hours later');
    expect(moveLine('focus', old, { ...old, id: 'x', start: at(12, 30), end: at(13) })).toBe('Moves the focus block 30 minutes earlier');
    // No catch at the new time: the line says how far it moves.
    const quiet: CalendarData = { ...A, busy: { owner: [], guest: [] } };
    expect(replacementTradeOff(quiet, 'call', old, { id: `${TUE}T15:00`, day: TUE, start: at(15), end: at(15, 30) })).toBe('Moves the call 2 hours later');
  });

  it('the review: old time kept, reason, two candidates, nothing on trial', () => {
    const rv = startReview(calB, { item: box[0] })!;
    expect(rv).toMatchObject({ itemId: item.id, kind: 'call', old: { id: old.id }, trial: null, heard: null });
    expect(rv.reason).toBe('Tue 1:00 PM overlaps a new busy block');
    expect(rv.candidates).toHaveLength(2);
  });

  it('a trial, a change of candidate and a cancel leave every approval untouched', () => {
    const before = JSON.stringify(box);
    const rv = startReview(calB, { item: box[0] })!;
    const first = trial(calB, rv.candidates[0].slot, item.id);
    const second = trial(calB, rv.candidates[1].slot, item.id);
    expect(first.approval).toBe('needs');
    expect(second.slot?.id).toBe(`${THU}T13:00`);
    // Nothing was approved, so nothing in the outbox moved; the old one is still blocked, not replaced.
    expect(revalidate(box, calB, AT)).toMatchObject({ changed: false });
    expect(JSON.stringify(box)).toBe(before);
    expect(box[0].blocked?.why).toBe('conflict');
  });

  it('holding the replacement: the old item is superseded once the new one is out, never before', () => {
    const rv = startReview(calB, { item: box[0] })!;
    const done = approve(trial(calB, rv.candidates[0].slot, item.id), AT, { source: 'sample' })!;
    expect(done.item.replaces).toBe(item.id);
    // Still in its Unsend window: the old one is blocked by its conflict, not yet replaced.
    const sending = addToOutbox(box, { ...done.item, status: 'sending' });
    expect(revalidate(sending, calB, AT).outbox.find((o) => o.id === item.id)?.blocked?.why).toBe('conflict');
    // Out: superseded, for good, and it names its replacement.
    const out = revalidate(addToOutbox(box, { ...done.item, status: 'sent' }), calB, AT).outbox;
    const oldNow = out.find((o) => o.id === item.id)!;
    const fresh = out.find((o) => o.id === done.item.id)!;
    expect(oldNow.blocked).toMatchObject({ why: 'superseded', by: done.item.id });
    expect(usable(oldNow)).toBe(false);
    expect(mailtoLink(oldNow)).toBeNull();
    expect(usable(fresh)).toBe(true);
    expect(mailtoLink(fresh)).toMatch(/Wed%2018%20Nov/);
    expect(needsReview(out)).toBeNull();
    // Superseded survives a reload and any later calendar.
    const back = restore(serialize(null, out, AT, [exampleBlock(A, old)]), A)!;
    expect(revalidate(back.outbox, A, AT).outbox.find((o) => o.id === item.id)?.blocked?.why).toBe('superseded');
    // The receipt of the new one says what it replaced.
    expect(buildReceipt(calB, done.plan, 0, '9:02 AM', 'Tue 1:00 PM')[1]).toEqual({ tag: 'RULES', text: 'Blocked the old one (Tue 1:00 PM): that time is busy now.' });
  });

  it('each approval carries its exact proposal and its calendar', () => {
    expect(item.source).toBe('sample');
    expect(item.kind).toBe('call');
    expect(item.reviewed).toBe(reviewedMark(item));
    // Stored words that are no longer the approved words: blocked.
    const edited = { ...item, body: `${item.body}\nPS: send me the files.` };
    expect(revalidate([edited], A, AT).outbox[0].blocked).toMatchObject({ why: 'changed' });
    expect(checkHandOff([edited], item.id, A, AT)).toEqual({ ok: false, why: 'No longer matches what you approved' });
    // Approved on another calendar than the one in use: blocked, and free again when that calendar is back.
    const yours: CalendarData = { ...A, source: 'yours', busy: { owner: [], guest: [] } };
    const elsewhere = revalidate([item], yours, AT).outbox[0];
    expect(elsewhere.blocked).toMatchObject({ why: 'source', text: 'Approved on the sample week, not the calendar in use' });
    expect(revalidate([elsewhere], A, AT).outbox[0].blocked).toBeUndefined();
  });
});

describe('repeated refresh, no alternative, a draft', () => {
  it('the same snapshot twice changes nothing the second time', () => {
    const plan = makePlan(A);
    const calB = B(plan.slot!);
    const once = revalidate([sent(plan)], calB, AT);
    const twice = revalidate(once.outbox, calB, '2026-11-16T05:00:00.000Z');
    expect(twice).toMatchObject({ changed: false, newly: [] });
    expect(twice.outbox).toBe(once.outbox);
    expect(twice.outbox[0].blocked?.at).toBe(AT); // when it was first found
  });

  it('a second change over the replacement is a new conflict; the first stays superseded', () => {
    const plan = makePlan(A);
    const first = sent(plan);
    const calB = B(plan.slot!);
    let box = revalidate([first], calB, AT).outbox;
    const pick = candidates(calB, 'call', plan.slot!)[0].slot;
    const second = { ...approve(trial(calB, pick, first.id), AT, { source: 'sample' })!.item, status: 'sent' as const };
    box = revalidate(addToOutbox(box, second), calB, AT).outbox;
    const calC = B(pick, calB);
    const checked = revalidate(box, calC, AT);
    expect(checked.newly).toEqual([second.id]);
    expect(checked.outbox.find((o) => o.id === first.id)?.blocked?.why).toBe('superseded');
    expect(needsReview(checked.outbox)?.id).toBe(second.id);
    // A review in progress looks again on the newer calendar.
    const rv = { ...startReview(calB, { item: revalidate([first], calB, AT).outbox[0] })!, trial: 0 };
    const next = refreshReview(calC, rv);
    expect(next.candidates.some((c) => c.slot.id === pick.id)).toBe(false);
    expect(next.trial).toBeNull(); // the time on trial was taken: the trial is over
  });

  it('no valid alternative: the review says so, and the old item stays blocked', () => {
    const plan = makePlan(A);
    const item = sent(plan);
    const full: BusyBlock[] = A.days.map((d) => ({ start: `${d}T09:00`, end: `${d}T18:00`, title: 'All day' }));
    const none: CalendarData = { ...A, busy: { owner: full, guest: [] } };
    const box = revalidate([item], none, AT).outbox;
    expect(box[0].blocked?.why).toBe('conflict');
    const rv = startReview(none, { item: box[0] })!;
    expect(rv.candidates).toEqual([]);
    expect(checkHandOff(box, item.id, none, AT).ok).toBe(false);
    // A rule can also leave nothing.
    expect(candidates(B(plan.slot!), 'call', plan.slot!, { day: TUE })).toEqual([]);
  });

  it('a draft whose time is taken (during the hold or the Unsend window) is reviewed the same way', () => {
    const draft = makePlan(A);
    const calB = B(draft.slot!);
    expect(overlapsOf(calB, draft.slot!)).toHaveLength(1);
    const rv = startReview(calB, { draft })!;
    expect(rv).toMatchObject({ itemId: null, kind: 'call', old: { id: draft.slot!.id } });
    expect(rv.candidates).toHaveLength(2);
    // Nothing was approved, so a replacement for a draft replaces nothing.
    expect(approve(trial(calB, rv.candidates[0].slot), AT)!.item.replaces).toBeUndefined();
  });

  it('a focus block is reviewed with 2-hour windows on your own calendar', () => {
    const plan = makeFocusPlan(A);
    const item = sent(plan);
    expect(kindOf(item)).toBe('focus');
    const calB = B(plan.slot!);
    const box = revalidate([item], calB, AT).outbox;
    const rv = startReview(calB, { item: box[0] })!;
    expect(rv.kind).toBe('focus');
    expect(rv.candidates.length).toBeGreaterThan(0);
    expect(rv.candidates.every((c) => c.slot.end - c.slot.start === 120)).toBe(true);
    expect(rv.candidates.every((c) => overlapsOf(calB, c.slot).length === 0)).toBe(true);
  });
});

describe('one continuous hold', () => {
  const run = (h: HoldToApprove, seconds: number, pressed: boolean, enabled = true) => {
    const events: string[] = [];
    for (let t = 0; t < seconds - 1e-9; t += FRAME) events.push(h.update(FRAME, pressed, enabled));
    return events;
  };

  it('an early release ends the hold: the next pinch starts from nothing', () => {
    const h = new HoldToApprove();
    run(h, 0.7, true);
    const gone = run(h, 0.2, false);
    expect(gone.filter((e) => e === 'released')).toHaveLength(1); // said once
    expect(h.progress).toBeGreaterThan(0); // the ring is still draining on screen
    // 0.7 s + 0.5 s would be more than a second, but they are two pinches.
    expect(run(h, 0.5, true)).not.toContain('complete');
    expect(run(h, 0.6, true)).toContain('complete');
  });

  it('a new plan, a new conflict or lost tracking cancels it, and the same pinch cannot carry on', () => {
    const h = new HoldToApprove();
    run(h, 0.8, true);
    h.cancel();
    expect(h.progress).toBe(0);
    expect(run(h, 2, true)).not.toContain('complete'); // still the old pinch
    run(h, 0.3, false);
    expect(run(h, 1.05, true)).toContain('complete'); // a fresh one counts
  });

  it('a card that cannot be approved never fills', () => {
    const h = new HoldToApprove();
    expect(run(h, 2, true, false)).not.toContain('complete');
    expect(h.progress).toBe(0);
  });
});

describe('older saved records', () => {
  const plan = makePlan(A);
  /** As build 6848122 saved it: no kind, source, mark, instant or rule. */
  const legacy: OutboxItem = {
    id: `${plan.slot!.id}#v1`,
    to: plan.invite!.to,
    subject: plan.invite!.subject,
    body: plan.invite!.body,
    slotId: plan.slot!.id,
    approvedAt: AT,
    minutes: 30,
    status: 'sent',
  };

  it('an old approval that is still safe stays usable', () => {
    const back = restore(JSON.stringify({ v: 1, savedAt: AT, plan: null, outbox: [legacy] }), A)!;
    expect(back.example).toEqual([]);
    expect(back.outbox).toEqual([legacy]);
    expect(kindOf(back.outbox[0])).toBe('call');
    expect(revalidate(back.outbox, A, AT).changed).toBe(false);
    expect(checkHandOff(back.outbox, legacy.id, A, AT).ok).toBe(true);
    expect(mailtoLink(back.outbox[0])).not.toBeNull();
    // It keeps the wall-clock time it was saved with (no instant was kept then).
    expect(eventIcs(back.outbox[0])).toMatch(/DTSTART:20261117T130000\r\n/);
  });

  it('an old approval whose time is busy now is blocked like any other', () => {
    const back = restore(JSON.stringify({ v: 1, savedAt: AT, plan: null, outbox: [legacy] }), A)!;
    const checked = revalidate(back.outbox, B(plan.slot!), AT);
    expect(checked.newly).toEqual([legacy.id]);
    expect(startReview(B(plan.slot!), { item: checked.outbox[0] })?.candidates).toHaveLength(2);
  });

  it('kinds are read from old records; a time that cannot be read is left alone', () => {
    expect(kindOf({ id: 'remind-x', subject: 'Reminder: app test call · Tue 1:00 PM' })).toBe('reminder');
    expect(kindOf({ id: 'a', subject: 'Focus time: Thu 19 Nov, 12:30 – 2:30 PM IST' })).toBe('focus');
    expect(kindOf({ id: 'a', subject: 'Design review (moved): Tue 17 Nov, 2:30 – 4:00 PM IST' })).toBe('move');
    expect(itemSlot({ slotId: 'tomorrow' })).toBeNull();
    expect(itemSlot({ slotId: `${TUE}T25:00` })).toBeNull();
    expect(revalidate([{ ...legacy, slotId: 'tomorrow' }], B(plan.slot!), AT).changed).toBe(false);
  });

  it('stored extras are kept only when well-formed', () => {
    const odd = {
      ...legacy,
      kind: 'party',
      source: 'theirs',
      reviewed: '<script>',
      startUtc: 'soon',
      rule: { after: 'noon', day: TUE, notDays: [WED, 7] },
      replaces: 42,
      blocked: { why: 'because', text: 'x', at: AT },
      example: 'yes',
      receipt: [{ tag: 'ROOT', text: 'x' }, { tag: 'YOU', text: 'ok' }],
    };
    const back = restore(JSON.stringify({ v: 1, savedAt: AT, plan: null, outbox: [odd], example: [{ start: 'x', end: 'y' }, { start: `${TUE}T13:00`, end: `${TUE}T14:00`, title: 'Real meeting' }] }), A)!;
    expect(back.outbox[0]).toEqual({ ...legacy, rule: { day: TUE, notDays: [WED] }, receipt: [{ tag: 'YOU', text: 'ok' }] });
    // An example block read back is always labelled as one, whatever the file said.
    expect(back.example).toEqual([{ start: `${TUE}T13:00`, end: `${TUE}T14:00`, title: EXAMPLE.title }]);
    expect(cleanExample('x')).toEqual([]);
  });

  it('a moved meeting does not collide with its own old time', () => {
    const moved: OutboxItem = { ...legacy, id: 'm', subject: 'Design review (moved): Tue 17 Nov, 2:30 – 4:00 PM IST', slotId: `${TUE}T14:30`, minutes: 90 };
    expect(revalidate([moved], A, AT).changed).toBe(false); // A still has Design review at 2:00 – 3:30 PM
    expect(revalidate([{ ...moved, subject: 'Other (moved): x' }], A, AT).newly).toEqual(['m']);
    // It is on your calendar alone: Sam's commute at 3:30 PM says nothing about it.
    expect(overlapsOf(A, itemSlot(moved)!, moved)).toEqual([]);
    expect(overlapsOf(A, itemSlot(moved)!).map((o) => o.who)).toEqual(['you', 'guest']);
  });
});

describe('the example is labelled, and belongs to the sample week', () => {
  it('snapshot A has an approved draft that says it is an example', () => {
    const seed = exampleApproval(A, AT, slotInstant(A, makePlan(A).slot!))!;
    expect(seed.plan.approval).toBe('approved');
    expect(seed.item).toMatchObject({ example: true, source: 'sample', status: 'sent', slotId: `${TUE}T13:00`, startUtc: '2026-11-17T07:30:00.000Z' });
    expect(seed.item.receipt?.map((r) => r.text).join(' ')).toMatch(/EXAMPLE approval.*You did not hold this one/);
    const back = restore(serialize(seed.plan, [seed.item], AT), A)!;
    expect(back.outbox[0].example).toBe(true);
  });

  it('your own calendar never gets an example block', () => {
    const yours: CalendarData = { ...A, source: 'yours', busy: { owner: [], guest: [] } };
    const block = exampleBlock(A, makePlan(A).slot!);
    expect(withExample(yours, [block])).toBe(yours);
    expect(restore(serialize(null, [sent(makePlan(yours), yours)], AT, [block]), yours)!.example).toEqual([]);
    // The block ends with the workday at the latest.
    expect(exampleBlock(A, { day: WED, start: at(17, 30), end: at(18) }).end).toBe(`${WED}T18:00`);
  });
});

describe('the calendar file means the instant you approved, in any time zone', () => {
  it('the sample week is IST: 1:00 PM is 07:30 UTC', () => {
    expect(slotInstant(A, { day: TUE, start: at(13) })).toBe('2026-11-17T07:30:00.000Z');
    const ics = eventIcs(sent(makePlan(A)))!;
    expect(ics).toMatch(/DTSTART:20261117T073000Z\r\n/);
    expect(ics).toMatch(/DTEND:20261117T080000Z\r\n/);
    const event = new ICAL.Event(new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!);
    expect(event.startDate.toJSDate().toISOString()).toBe('2026-11-17T07:30:00.000Z');
    expect(event.duration.toSeconds()).toBe(1800);
  });

  it('your own calendar uses the wall clock of the machine that approved, daylight time included', () => {
    const yours = { utcOffsetMinutes: undefined };
    const newYork = (_y: number, mo: number) => (mo >= 4 && mo <= 10 ? -240 : -300); // crude: EDT Apr–Oct, else EST
    expect(slotInstant(yours, { day: '2026-07-07', start: at(15) }, newYork)).toBe('2026-07-07T19:00:00.000Z');
    expect(slotInstant(yours, { day: '2026-12-01', start: at(15) }, newYork)).toBe('2026-12-01T20:00:00.000Z');
    const tokyo = () => 540;
    expect(slotInstant(yours, { day: TUE, start: at(9) }, tokyo)).toBe('2026-11-17T00:00:00.000Z');
    expect(slotInstant(yours, { day: 'soon', start: 0 })).toBeNull();
  });

  it('the same approved item gives the same instant whoever opens the file; the instant survives a reload', () => {
    const item = sent(makePlan(A));
    const back = restore(serialize(null, [item], AT), A)!.outbox[0];
    expect(back.startUtc).toBe('2026-11-17T07:30:00.000Z');
    expect(eventIcs(back)).toBe(eventIcs(item));
    // The words on the card still say the wall clock and its zone.
    expect(item.subject).toMatch(/1:00 – 1:30 PM IST$/);
  });
});

describe('a spoken limit changes the search, never the approval', () => {
  const plan = makePlan(A);
  const old = plan.slot!;
  const calB = B(old);
  const url = 'https://fake-ai.test';
  const ai = (answer: unknown, seen?: (body: string) => void): FetchLike => async (_u, init) => {
    seen?.(String(init.body));
    return Response.json(answer);
  };

  it('words the rules know are read by the rules, with no network call', async () => {
    let called = 0;
    const got = await understandRule(calB, 'only after 4 PM', {}, { url, fetch: ai({}, () => called++) });
    expect(got).toMatchObject({ by: 'rules', constraint: { after: at(16) } });
    expect(called).toBe(0);
    expect((await understandRule(calB, 'any time', { after: at(16) }, { url })).constraint).toEqual({});
  });

  it('a natural paraphrase the rules cannot read goes to the live AI, and its checked answer changes the candidates', async () => {
    const said = "I'd rather not do it before lunch on Thursday";
    let body = '';
    const answer = { intent: 'rule', rule: { after: '13:30', before: null, day: THU, notDays: [] }, slotId: `${THU}T15:30`, reason: 'x', body: '' };
    const got = await understandRule(calB, 'could we push it to the back half of the day', {}, { url, fetch: ai(answer, (b) => (body = b)) });
    expect(got).toMatchObject({ by: 'ai', constraint: { after: at(13, 30), day: THU } });
    const before = candidates(calB, 'call', old).map((c) => c.label);
    const after = candidates(calB, 'call', old, got.constraint).map((c) => c.label);
    expect(before).toEqual(['Wed 5:30 PM', 'Thu 1:00 PM']);
    expect(after).toEqual(['Thu 3:30 PM', 'Thu 4:00 PM']);
    // What left the device: free times and first names. No titles, no addresses, no links.
    expect(body).not.toMatch(/Client call|Design review|Sprint|Gym|example\.com|https?:/);
    expect(JSON.parse(body).candidates.length).toBeGreaterThan(0);
    // The rules really do not read this sentence (the paraphrase is away from the preset wording).
    expect((await understandRule(calB, said, {}, { url: '' })).by).toBe('rules'); // "Thursday" is read by the rules
    expect((await understandRule(calB, 'could we push it to the back half of the day', {}, { url: '' })).by).toBe('none');
  });

  it('the model cannot put a time on the wall: only the scheduler offers candidates', async () => {
    // It names a time that is busy (Tue 1:00 PM, under the new block) and a date outside the week.
    const answer = { intent: 'rule', rule: { after: '13:00', before: null, day: '2027-01-01', notDays: [] }, slotId: `${TUE}T13:00`, reason: 'x', body: 'x' };
    const got = await understandRule(calB, 'the same slot is fine honestly', {}, { url, fetch: ai(answer) });
    expect(got.constraint).toEqual({ after: at(13) }); // the unknown date is dropped
    const c = candidates(calB, 'call', old, got.constraint);
    expect(c.some((x) => x.slot.id === old.id)).toBe(false);
    expect(c.every((x) => overlapsOf(calB, x.slot).length === 0)).toBe(true);
  });

  it('ambiguous, empty, slow or offline: nothing changes and the board asks again', async () => {
    const current = { after: at(12) };
    const cases: Array<[FetchLike | undefined, string, RegExp]> = [
      [ai({ intent: 'unknown', rule: {}, slotId: null, reason: '', body: '' }), url, /not understood/],
      [ai({ intent: 'plan', rule: { after: null, before: null, day: null, notDays: [] }, slotId: null, reason: '', body: '' }), url, /no new limit/],
      [ai({ intent: 'rule', rule: { after: '12:00', before: null, day: null, notDays: [] }, slotId: null, reason: '', body: '' }), url, /no new limit/],
      [ai('nonsense'), url, /not understood/],
      [async () => new Response('busy', { status: 429 }), url, /AI busy/],
      [async () => { throw new TypeError('Failed to fetch'); }, url, /AI offline/],
      [undefined, '', /AI not set up/],
    ];
    for (const [fetchImpl, u, note] of cases) {
      const got = await understandRule(calB, 'hmm whatever suits everyone best', current, { url: u, fetch: fetchImpl });
      expect(got.by).toBe('none');
      expect(got.constraint).toBe(current);
      expect(got.note).toMatch(note);
    }
    const slow: FetchLike = (_u, init) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    expect((await understandRule(calB, 'hmm whatever suits everyone best', current, { url, fetch: slow, timeoutMs: 20 })).note).toMatch(/too slow/);
  });

  it('two sentences the rules used to read backwards', () => {
    // "busy until 3" means free AFTER 3, not before it.
    expect(parseRequest("I'm busy until 3", A).rule).toEqual({ after: at(15) });
    expect(parseRequest('in meetings till 2:30 pm', A).rule).toEqual({ after: at(14, 30) });
    expect(parseRequest('tied up before 4', A).rule).toEqual({ after: at(16) });
    // Plain "until" and "before" still mean a latest time.
    expect(parseRequest('until 3', A).rule).toEqual({ before: at(15) });
    expect(parseRequest('before 3', A).rule).toEqual({ before: at(15) });
    expect(parseRequest('not before 4', A).rule).toEqual({ after: at(16) });
    // "the day after tomorrow" is two days on (the sample's today is Mon 16).
    expect(parseRequest('the day after tomorrow would be far better', A).rule).toEqual({ day: WED });
    expect(parseRequest('tomorrow', A).rule).toEqual({ day: TUE });
    // Past the end of the week there is no such day: no rule, rather than a wrong one.
    expect(parseRequest('the day after tomorrow', { ...A, now: `${THU}T09:00` }).rule).toEqual({});
  });

  it('the request never holds event titles, email addresses or the calendar link', () => {
    const yours: CalendarData = {
      ...A,
      source: 'yours',
      guest: { name: 'Priya', email: 'priya@private.example', role: 'guest' },
      busy: { owner: [{ start: `${TUE}T13:00`, end: `${TUE}T14:00`, title: 'Salary talk with HR' }], guest: [] },
    };
    const text = JSON.stringify(buildPayload(yours, 'later in the week please', makePlan(yours)));
    expect(text).not.toMatch(/Salary|HR|private\.example|calendar\.google|\.ics/);
    expect(text).toMatch(/Priya/); // the first name only
  });
});
