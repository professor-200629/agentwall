/**
 * The week on the wall is touchable. Pinching a spot on the mural:
 *   - a free half hour   -> the invite moves to that time (you picked it)
 *   - an amber rule area -> that rule is removed and the agent re-plans
 *   - a busy block       -> the board says why the agent can't use it
 *
 * Big amber rule areas are easy targets for a shaky hand ray (the first Quest
 * tester found the small chips needed "extreme accuracy"). Plain TypeScript.
 */
import { focusWindows, isFocus } from './focus.js';
import { moveWindows } from './move.js';
import type { Plan } from './plan.js';
import { ruleText } from './request.js';
import { clock, dayLabel, freeSlots, type CalendarData, type Constraint, type Slot } from './scheduler.js';
import { ruleKeyFor, type RuleKey, type WeekCell, type WeekModel } from './week.js';

export type MuralAction =
  | { kind: 'pick'; slot: Slot; cell: WeekCell }
  | { kind: 'remove-rule'; key: RuleKey; label: string; cell: WeekCell }
  | { kind: 'explain'; text: string; cell: WeekCell };

const short = (day: string) => dayLabel(day).short.split(' ')[0]; // "Wed"

/** The rule part, said the way the board's rule line says it. */
export function ruleLabel(c: Constraint, key: RuleKey): string {
  if (key === 'day') return c.day ? `only ${short(c.day)}` : 'only one day';
  if (key === 'after') return c.after !== undefined ? `after ${clock(c.after).replace(':00', '')}` : 'after';
  if (key === 'before') return c.before !== undefined ? `before ${clock(c.before).replace(':00', '')}` : 'before';
  return `not ${short(key.slice(4))}`;
}

/** The constraint without one rule part. */
export function withoutRule(c: Constraint, key: RuleKey): Constraint {
  const next: Constraint = { ...c };
  if (key === 'day') delete next.day;
  else if (key === 'after') delete next.after;
  else if (key === 'before') delete next.before;
  else {
    const days = (c.notDays ?? []).filter((d) => d !== key.slice(4));
    if (days.length) next.notDays = days;
    else delete next.notDays;
  }
  return next;
}

/** The cell under a point on the mural (day column, minutes after midnight). */
export function cellAt(week: WeekModel, dayIndex: number, minute: number): WeekCell | null {
  const day = week.days[dayIndex];
  if (!day || minute < week.dayStart || minute >= week.dayEnd) return null;
  return week.cells.find((c) => c.day === day && minute >= c.start && minute < c.start + week.step) ?? null;
}

/** What pinching this spot of the mural does, or null for nothing. */
export function muralAction(
  cal: CalendarData,
  plan: Plan | null,
  week: WeekModel,
  dayIndex: number,
  minute: number,
): MuralAction | null {
  if (!plan) return null;
  const cell = cellAt(week, dayIndex, minute);
  if (!cell) return null;
  if (cell.kind === 'free') {
    // Focus time and a moved meeting are blocks on your own calendar: a pinch inside one picks it.
    const solo = isFocus(plan) || !!plan.moving;
    const pool = plan.moving
      ? moveWindows(cal, plan.moving, plan.constraint)
      : isFocus(plan)
        ? focusWindows(cal, plan.constraint)
        : freeSlots(cal, plan.constraint);
    const slot =
      pool.find((s) => s.day === cell.day && s.start === cell.start) ??
      (solo ? pool.find((s) => s.day === cell.day && s.start <= cell.start && s.end > cell.start) : undefined);
    return slot ? { kind: 'pick', slot, cell } : null;
  }
  if (cell.kind === 'rule') {
    const key = ruleKeyFor(plan.constraint, cell.day, cell.start, cell.start + cal.meeting.minutes);
    return key ? { kind: 'remove-rule', key, label: ruleLabel(plan.constraint, key), cell } : null;
  }
  const when = `${short(cell.day)} ${clock(cell.start)}`;
  return { kind: 'explain', text: `${when} · ${cell.reason}`, cell };
}

/** The rule line after removing one part ("" when no rule is left). */
export const ruleLineWithout = (c: Constraint, key: RuleKey): string => ruleText(withoutRule(c, key));
