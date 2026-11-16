/**
 * Rule-based understanding of what the user asked, for preset chips, voice
 * transcripts and as the fallback when the AI is slow or offline.
 *
 * "Find a time for my app tester call"   -> intent 'plan'
 * "only after 4 PM", "mornings", "not Wednesday", "Thursday only",
 * "tomorrow", "before 3"                 -> intent 'rule' with a Constraint
 * "any time" / "clear the rule"          -> intent 'clear'
 *
 * Plain TypeScript, unit-tested.
 */
import { dayLabel, describeConstraint, splitStamp, type CalendarData, type Constraint } from './scheduler.js';

export type Intent = 'plan' | 'focus' | 'rule' | 'clear' | 'unknown';

export interface ParsedRequest {
  intent: Intent;
  /** Only the parts this request mentions; merge with the current rule. */
  rule: Constraint;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "4", "4:30", "16", with optional am/pm -> minutes after midnight. Bare 1–7 mean PM (work hours). */
function toMinutes(h: string, m: string | undefined, ampm: string | undefined): number | null {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (!Number.isFinite(hour) || hour > 23 || min > 59) return null;
  const mer = ampm?.replace(/\./g, '').toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  else if (mer === 'am' && hour === 12) hour = 0;
  else if (!mer && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + min;
}

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?`;

/** Map a weekday name to the matching date in the sample week. */
function dayFor(cal: CalendarData, name: string): string | undefined {
  return cal.days.find((d) => dayLabel(d).weekday.toLowerCase() === name);
}

export function parseRequest(text: string, cal: CalendarData): ParsedRequest {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()} `;
  const rule: Constraint = {};

  if (/\b(any ?time|clear (the )?(rule|filter)s?|remove (the )?(rule|filter)s?|no (rule|limit)s?|reset)\b/.test(t)) {
    return { intent: 'clear', rule: {} };
  }

  // Times.
  // "I'm busy until 3", "in meetings till 2:30": free AFTER that time. (Read as "before 3" until 16 Nov.)
  const busyUntil = new RegExp(
    String.raw`\b(?:busy|tied up|booked|unavailable|not free|not available|in (?:a )?(?:meeting|class|call)s?)\s+(?:until|till|til|before)\s+${TIME}`,
  ).exec(t);
  const after = busyUntil ?? new RegExp(String.raw`\b(?:after|from|later than|not before)\s+${TIME}`).exec(t);
  if (after) {
    const m = toMinutes(after[1], after[2], after[3]);
    if (m !== null) rule.after = m;
  } else if (/\bafter ?noon\b|\bafternoons?\b/.test(t)) {
    rule.after = 12 * 60;
  } else if (/\bevenings?\b/.test(t)) {
    rule.after = 16 * 60;
  }
  // (?<!not ) so "not before 4" is read only as "after 4".
  const before = busyUntil
    ? null
    : new RegExp(String.raw`(?<!not )\b(?:before|by|until|no later than|ending by)\s+${TIME}`).exec(t);
  if (before) {
    const m = toMinutes(before[1], before[2], before[3]);
    if (m !== null) rule.before = m;
  } else if (/\b(before|by) noon\b|\bmornings?\b/.test(t)) {
    rule.before = 12 * 60;
  }

  // Days: "not Wednesday" / "except Wednesday" / "no Wednesday".
  const notDays: string[] = [];
  for (const name of WEEKDAYS) {
    const day = dayFor(cal, name);
    if (!day) continue;
    if (new RegExp(String.raw`\b(not|except|no|skip|avoid)( on)? ${name}s?\b`).test(t)) notDays.push(day);
    else if (new RegExp(String.raw`\b${name}s?\b`).test(t)) rule.day = day;
  }
  if (notDays.length) rule.notDays = notDays;
  if (/\btomorrow\b/.test(t)) {
    const today = splitStamp(cal.now).day;
    const i = cal.days.indexOf(today);
    // "the day after tomorrow" is two days on, not one. (Read as tomorrow until 16 Nov.)
    const ahead = /\bday after tomorrow\b/.test(t) ? 2 : 1;
    if (i >= 0 && i + ahead < cal.days.length) rule.day = cal.days[i + ahead];
  }

  const hasRule = Object.keys(rule).length > 0;
  // The second task: "block 2 hours of focus time", "deep work", "heads-down time".
  if (/\b(focus|deep work|heads?[- ]down)\b/.test(t)) return { intent: 'focus', rule };
  const wantsPlan = /\b(find|schedule|book|set up|arrange|plan|pick)\b.*\b(time|call|meeting|slot)\b|\b(draft|invite)\b/.test(t);
  if (wantsPlan) return { intent: 'plan', rule };
  if (hasRule) return { intent: 'rule', rule };
  return { intent: 'unknown', rule };
}

/** New rule parts override old ones; a new single day replaces excluded days that clash. */
export function mergeConstraint(current: Constraint, next: Constraint): Constraint {
  const merged: Constraint = { ...current, ...next };
  if (next.notDays && current.notDays) {
    merged.notDays = [...new Set([...current.notDays, ...next.notDays])];
  }
  if (merged.day && merged.notDays?.includes(merged.day)) {
    if (next.day) merged.notDays = merged.notDays.filter((d) => d !== merged.day);
    else delete merged.day;
  }
  if (merged.notDays && merged.notDays.length === 0) delete merged.notDays;
  // "after 5 PM" + "before 4 PM" is impossible: the newer half wins.
  if (merged.after !== undefined && merged.before !== undefined && merged.after >= merged.before) {
    if (next.after !== undefined) delete merged.before;
    else delete merged.after;
  }
  return merged;
}

/** Short label for the board's "Rule ·" line, e.g. "only after 4 PM, not Wednesday". */
export function ruleText(c: Constraint): string {
  const d = describeConstraint(c).replace(/:00 /g, ' ');
  return d ? `only ${d}` : '';
}
