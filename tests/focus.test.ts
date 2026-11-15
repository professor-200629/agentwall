import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { FOCUS_TASK, focusTradeOff, focusWindows, isFocus, makeFocusPlan } from '../src/logic/focus.js';
import { chooseSlot, DEMO_TASK, isLinked } from '../src/logic/plan.js';
import { focusRequest, runAgent } from '../src/logic/agent.js';
import { parseRequest } from '../src/logic/request.js';
import { restore, serialize } from '../src/logic/storage.js';
import type { CalendarData } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const THU = '2026-11-19';
const at = (h: number, m = 0) => h * 60 + m;

describe('focus time: two free hours on YOUR calendar', () => {
  it('only Thursday has two free hours in the sample week', () => {
    const w = focusWindows(cal);
    expect(new Set(w.map((s) => s.day))).toEqual(new Set([THU]));
    expect(w[0]).toMatchObject({ day: THU, start: at(12, 30), end: at(14, 30) }); // 10-min gap after the 12:00 workshop
    expect(w.every((s) => s.end - s.start === 120)).toBe(true);
  });

  it('the guest does not matter (Sam has class Thu 2–3 PM, the window still counts)', () => {
    expect(focusWindows(cal).some((s) => s.day === THU && s.start <= at(14) && s.end >= at(15))).toBe(true);
  });

  it('rules apply: "only after 4 PM" leaves Thu 4–6 PM; "not Thursday" leaves nothing', () => {
    expect(focusWindows(cal, { after: at(16) }).map((s) => s.id)).toEqual([`${THU}T16:00`]);
    expect(focusWindows(cal, { notDays: [THU] })).toEqual([]);
  });

  it('the plan: a calendar block on the desk, linked to the window, explained in one line', () => {
    const p = makeFocusPlan(cal);
    expect(isFocus(p)).toBe(true);
    expect(p.task).toBe(FOCUS_TASK);
    expect(p.slot?.id).toBe(`${THU}T12:30`);
    expect(p.invite?.subject).toBe('Focus time: Thu 19 Nov, 12:30 – 2:30 PM IST');
    expect(p.invite?.to).toMatch(/^Your calendar/);
    expect(isLinked(p)).toBe(true);
    expect(p.reason).toBe('Mon–Wed have no 2-hour gap, so Thu 12:30 PM is first.');
    // Runner-ups never overlap the chosen two hours.
    expect(p.alternatives.every((a) => a.start >= p.slot!.end || a.end <= p.slot!.start)).toBe(true);
    // ...nor each other (two pills never sit on top of each other).
    const [a, b] = p.alternatives;
    if (a && b) expect(a.day !== b.day || a.end <= b.start || b.end <= a.start).toBe(true);
  });

  it('says the catch: the only day with room', () => {
    const w = focusWindows(cal);
    expect(focusTradeOff(cal, w, w[0])).toBe('Trade-off: Thu is the only day with 2 free hours.');
  });

  it('no window: no block, and it says why', () => {
    const p = makeFocusPlan(cal, { notDays: [THU] });
    expect(p.slot).toBeNull();
    expect(p.invite).toBeNull();
    expect(p.reason).toBe('No two free hours this week fit your rule.');
  });
});


describe('focus time inside the app: routing, picks, saving', () => {
  it('"block 2 hours of focus time" is the focus task (no AI needed)', async () => {
    expect(parseRequest(FOCUS_TASK, cal).intent).toBe('focus');
    expect(parseRequest('some deep work please', cal).intent).toBe('focus');
    const r = await runAgent(cal, FOCUS_TASK, null, { url: 'https://never-called.test', fetch: () => Promise.reject(new Error('no AI')) });
    expect(r.plan?.task).toBe(FOCUS_TASK);
    expect(r.plan?.slot?.id).toBe(`${THU}T12:30`);
  });

  it('rules apply to focus time while it is on the board', () => {
    const focus = makeFocusPlan(cal);
    const r = focusRequest(cal, 'only after 4 PM', focus)!;
    expect(r.plan?.task).toBe(FOCUS_TASK);
    expect(r.plan?.slot?.id).toBe(`${THU}T16:00`);
  });

  it('switching back to the meeting starts from no rule', async () => {
    const focus = makeFocusPlan(cal, { after: at(16) }, 'only after 4 PM');
    const r = await runAgent(cal, DEMO_TASK, focus, { url: '' });
    expect(r.plan?.task).toBe(DEMO_TASK);
    expect(r.plan?.constraint).toEqual({});
    expect(r.plan?.slot?.id).toBe('2026-11-17T13:00');
  });

  it('picking another window keeps it a calendar block', () => {
    const focus = makeFocusPlan(cal);
    const other = focus.alternatives[0];
    const picked = chooseSlot(cal, focus, other);
    expect(picked.invite?.subject).toMatch(/^Focus time: /);
    expect(isLinked(picked)).toBe(true);
  });

  it('a saved focus block comes back after a reload', () => {
    const focus = makeFocusPlan(cal);
    const back = restore(serialize(focus, [], '2026-11-15T10:00:00Z'), cal);
    expect(back?.plan?.task).toBe(FOCUS_TASK);
    expect(back?.plan?.slot).toEqual(focus.slot);
  });
});
