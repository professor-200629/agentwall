/**
 * The agent learns from your corrections, but only with your consent.
 *
 * Every time you move the agent's own pick to another time, that is a
 * correction. When the last two corrections say the same thing ("not on
 * Tuesday", "later than that", "earlier than that"), the agent offers a rule.
 * It becomes a rule only if you pinch yes; a rule you declined is not offered
 * again. Nothing here changes a plan by itself.
 *
 * Plain TypeScript, unit-tested.
 */
import { clock, dayLabel, type Constraint, type Slot } from './scheduler.js';

export const LEARN_KEY = 'agentwall.learn.v1';
/** Corrections that must agree before the agent says anything. */
export const LEARN_AFTER = 2;
const KEEP = 6;

export interface Correction {
  fromDay: string;
  fromStart: number;
  toDay: string;
  toStart: number;
}

export interface LearnState {
  corrections: Correction[];
  /** Keys of proposals you said no to. */
  declined: string[];
}

export interface RuleProposal {
  /** Stable id of this suggestion, e.g. "not:2026-11-17" or "after:900". */
  key: string;
  rule: Constraint;
  /** What the agent noticed, for the card. */
  noticed: string;
  /** The rule in words, for the button question. */
  label: string;
}

export const emptyLearn = (): LearnState => ({ corrections: [], declined: [] });

export function addCorrection(state: LearnState, from: Slot, to: Slot): LearnState {
  if (from.id === to.id) return state;
  const c: Correction = { fromDay: from.day, fromStart: from.start, toDay: to.day, toStart: to.start };
  return { ...state, corrections: [...state.corrections, c].slice(-KEEP) };
}

export function decline(state: LearnState, key: string): LearnState {
  return state.declined.includes(key) ? state : { ...state, declined: [...state.declined, key].slice(-20) };
}

/** After a yes or a no the pattern starts counting from zero again. */
export const settle = (state: LearnState): LearnState => ({ ...state, corrections: [] });

/**
 * A rule the last corrections agree on, or null. Never proposes what the
 * current rule already says, or what you declined before.
 */
export function proposeRule(state: LearnState, current: Constraint): RuleProposal | null {
  const last = state.corrections.slice(-LEARN_AFTER);
  if (last.length < LEARN_AFTER) return null;
  const candidates: RuleProposal[] = [];

  // Away from the same day, every time.
  const day = last[0].fromDay;
  if (last.every((c) => c.fromDay === day && c.toDay !== day)) {
    const name = dayLabel(day).weekday;
    if (current.day !== day && !current.notDays?.includes(day)) {
      candidates.push({
        key: `not:${day}`,
        rule: { notDays: [day] },
        noticed: `You moved my pick off ${name} ${LEARN_AFTER} times.`,
        label: `not ${name}`,
      });
    }
  }
  // Later in the day, every time: the earliest time you accepted becomes the limit.
  if (last.every((c) => c.toStart > c.fromStart)) {
    const after = Math.min(...last.map((c) => c.toStart));
    if (current.after === undefined || current.after < after) {
      candidates.push({
        key: `after:${after}`,
        rule: { after },
        noticed: `You moved my pick to a later time ${LEARN_AFTER} times.`,
        label: `only after ${clock(after)}`,
      });
    }
  }
  // Earlier in the day, every time: the latest start you accepted is the limit (+30 min call).
  if (last.every((c) => c.toStart < c.fromStart)) {
    const before = Math.max(...last.map((c) => c.toStart)) + 30;
    if (current.before === undefined || current.before > before) {
      candidates.push({
        key: `before:${before}`,
        rule: { before },
        noticed: `You moved my pick to an earlier time ${LEARN_AFTER} times.`,
        label: `only before ${clock(before)}`,
      });
    }
  }
  return candidates.find((p) => !state.declined.includes(p.key)) ?? null;
}

export function serializeLearn(state: LearnState): string {
  return JSON.stringify({ v: 1, ...state });
}

/** Parse saved JSON; anything malformed is dropped. */
export function parseLearn(json: string | null): LearnState {
  if (!json) return emptyLearn();
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    if (d.v !== 1) return emptyLearn();
    const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const isMin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1440;
    const corrections = (Array.isArray(d.corrections) ? d.corrections : [])
      .filter(
        (c): c is Correction =>
          !!c && typeof c === 'object' && isDay(c.fromDay) && isDay(c.toDay) && isMin(c.fromStart) && isMin(c.toStart),
      )
      .map((c) => ({ fromDay: c.fromDay, fromStart: c.fromStart, toDay: c.toDay, toStart: c.toStart }))
      .slice(-KEEP);
    const declined = (Array.isArray(d.declined) ? d.declined : [])
      .filter((k): k is string => typeof k === 'string' && /^(not|after|before):[\d-]{1,10}$/.test(k))
      .slice(-20);
    return { corrections, declined };
  } catch {
    return emptyLearn();
  }
}
