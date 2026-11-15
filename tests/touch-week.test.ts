import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { makePlan } from '../src/logic/plan.js';
import { ruleText } from '../src/logic/request.js';
import { freeSlots, type CalendarData, type Constraint } from '../src/logic/scheduler.js';
import { cellAt, muralAction, ruleLabel, withoutRule } from '../src/logic/touch-week.js';
import { ruleKeyFor, weekModel } from '../src/logic/week.js';

const cal = calendarJson as CalendarData;
const at = (h: number, m = 0) => h * 60 + m;
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const dayIndex = (d: string) => cal.days.indexOf(d);

const rules: Constraint = { after: at(16), notDays: [WED] };
const plan = makePlan(cal, rules, ruleText(rules));
const week = weekModel(cal, rules);

describe('ruleKeyFor: which rule part rules out a half hour', () => {
  it('names the part, in the same order as the mural labels', () => {
    expect(ruleKeyFor(rules, TUE, at(10), at(10, 30))).toBe('after');
    expect(ruleKeyFor(rules, WED, at(17), at(17, 30))).toBe(`not:${WED}`);
    expect(ruleKeyFor({ day: THU }, MON, at(14), at(14, 30))).toBe('day');
    expect(ruleKeyFor({ before: at(12) }, TUE, at(14), at(14, 30))).toBe('before');
    expect(ruleKeyFor(rules, TUE, at(16, 30), at(17))).toBeNull();
  });
});

describe('withoutRule / ruleLabel', () => {
  it('removes only that part', () => {
    expect(withoutRule(rules, 'after')).toEqual({ notDays: [WED] });
    expect(withoutRule(rules, `not:${WED}`)).toEqual({ after: at(16) });
    expect(withoutRule({ notDays: [WED, THU] }, `not:${WED}`)).toEqual({ notDays: [THU] });
    expect(withoutRule({ day: THU, after: at(16) }, 'day')).toEqual({ after: at(16) });
  });

  it('says it the way the board does', () => {
    expect(ruleLabel(rules, 'after')).toBe('after 4 PM');
    expect(ruleLabel(rules, `not:${WED}`)).toBe('not Wed');
    expect(ruleLabel({ day: THU }, 'day')).toBe('only Thu');
  });
});

describe('muralAction: pinching a spot on the week', () => {
  it('a free half hour picks that time', () => {
    const free = freeSlots(cal, rules).find((s) => s.id !== plan.slot?.id)!;
    const a = muralAction(cal, plan, week, dayIndex(free.day), free.start + 10)!;
    expect(a.kind).toBe('pick');
    expect(a.kind === 'pick' && a.slot.id).toBe(free.id);
  });

  it('an amber rule area removes that rule', () => {
    const ruleCell = (reason: string) => week.cells.find((c) => c.kind === 'rule' && c.reason === reason)!;
    const early = ruleCell('before 4 PM rule');
    const a = muralAction(cal, plan, week, dayIndex(early.day), early.start + 5)!;
    expect(a).toMatchObject({ kind: 'remove-rule', key: 'after', label: 'after 4 PM' });
    const wed = ruleCell('not Wed rule');
    const b = muralAction(cal, plan, week, dayIndex(wed.day), wed.start + 20)!;
    expect(b).toMatchObject({ kind: 'remove-rule', key: `not:${WED}`, label: 'not Wed' });
  });

  it('a busy block explains why', () => {
    const a = muralAction(cal, plan, week, dayIndex(MON), at(9, 45))!;
    expect(a).toMatchObject({ kind: 'explain', text: 'Mon 9:30 AM · You · Sprint planning' });
  });

  it('nothing outside the week or without a plan', () => {
    expect(cellAt(week, 7, at(10))).toBeNull();
    expect(cellAt(week, 0, at(8))).toBeNull();
    expect(cellAt(week, 0, at(18))).toBeNull();
    expect(muralAction(cal, null, week, 0, at(10))).toBeNull();
  });

  it('removing a rule frees the times it blocked', () => {
    const before = freeSlots(cal, rules).length;
    const after = freeSlots(cal, withoutRule(rules, 'after')).length;
    expect(after).toBeGreaterThan(before);
  });
});
