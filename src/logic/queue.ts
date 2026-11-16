/**
 * The morning queue: "2 things need your OK today".
 *
 * The agent prepares a short list of decisions. You clear them one at a time
 * with your own pinch-and-hold; nothing is done for you. When the list is
 * clear the board says so and counts the day. Come back tomorrow and the
 * count goes up; miss a day and it starts again.
 *
 * An item is cleared when its card really went out (after the Unsend window),
 * however you got there: the queue card, a chip or your voice.
 *
 * Plain TypeScript, unit-tested.
 */
import { FOCUS_TASK } from './focus.js';
import { DEMO_TASK } from './plan.js';

export type QueueId = 'focus' | 'call';

export interface QueueItem {
  id: QueueId;
  /** Short name on the board. */
  label: string;
  /** What the agent is asked when this item starts (same path as a chip). */
  say: string;
}

/** Focus first: the call comes last so its follow-ups and the agent's watch end the session. */
export const QUEUE: QueueItem[] = [
  { id: 'focus', label: 'Block 2 h of focus time', say: FOCUS_TASK },
  { id: 'call', label: 'Tester call invite', say: DEMO_TASK },
];

export const QUEUE_KEY = 'agentwall.queue.v1';

export interface QueueState {
  /** The local calendar day the `done` list belongs to (YYYY-MM-DD). */
  day: string;
  done: QueueId[];
  /** Days in a row with a clear queue, and the last day that counted. */
  streak: number;
  streakDay: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as the user's own calendar day. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The calendar day before `day`. */
export function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

export const emptyQueue = (today: string): QueueState => ({ day: today, done: [], streak: 0, streakDay: '' });

/** Which queue item a task belongs to, if any. */
export function itemForTask(task: string): QueueId | null {
  return QUEUE.find((q) => q.say === task)?.id ?? null;
}

/** The state as of `today`: yesterday's ticks are gone, and a missed day ends the streak. */
export function forToday(state: QueueState, today: string): QueueState {
  const kept = state.streakDay === today || state.streakDay === dayBefore(today);
  const streak = kept ? state.streak : 0;
  if (state.day === today) return { ...state, streak };
  return { day: today, done: [], streak, streakDay: kept ? state.streakDay : '' };
}

export function nextItem(state: QueueState): QueueItem | null {
  return QUEUE.find((q) => !state.done.includes(q.id)) ?? null;
}

export const allClear = (state: QueueState): boolean => nextItem(state) === null;

/**
 * Tick an item. `completed` is true only on the tick that clears the whole list,
 * and that is the one moment the day is counted.
 */
export function markDone(state: QueueState, id: QueueId, today: string): { state: QueueState; completed: boolean } {
  const now = forToday(state, today);
  if (now.done.includes(id)) return { state: now, completed: false };
  const next: QueueState = { ...now, done: [...now.done, id] };
  if (!allClear(next) || next.streakDay === today) return { state: next, completed: false };
  return { state: { ...next, streak: next.streak + 1, streakDay: today }, completed: true };
}

/** The line in the board's header, e.g. "TODAY 1 of 2 cleared · 3 days in a row". */
export function queueLine(state: QueueState): string {
  const days = state.streak === 1 ? '1 day' : `${state.streak} days`;
  const run = state.streak > 0 ? ` · ${days} in a row` : '';
  if (allClear(state)) return `TODAY ✓ all clear${run}`;
  return `TODAY ${state.done.length} of ${QUEUE.length} cleared${run}`;
}

export function serializeQueue(state: QueueState): string {
  return JSON.stringify({ v: 1, ...state });
}

/** Parse saved JSON; anything odd starts a fresh queue. Never trusts the stored data. */
export function parseQueue(json: string | null, today: string): QueueState {
  if (!json) return emptyQueue(today);
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (d.v !== 1 || !isDay(d.day) || !Array.isArray(d.done)) return emptyQueue(today);
    const ids = QUEUE.map((q) => q.id);
    const done = [...new Set(d.done.filter((x): x is QueueId => ids.includes(x as QueueId)))];
    const streak = typeof d.streak === 'number' && Number.isInteger(d.streak) && d.streak > 0 ? Math.min(d.streak, 9999) : 0;
    const streakDay = isDay(d.streakDay) ? d.streakDay : '';
    // A day from the future (a changed clock) is not believed.
    if (d.day > today || streakDay > today) return emptyQueue(today);
    return forToday({ day: d.day, done, streak: streakDay ? streak : 0, streakDay }, today);
  } catch {
    return emptyQueue(today);
  }
}
