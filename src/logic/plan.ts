/**
 * The agent's plan: two linked cards.
 *
 *   Slot card  ──uses──▶  Invite card
 *
 * The invite is always derived from the chosen slot. Any change to the slot
 * or the rule rewrites the invite and resets approval to "needs", so an
 * approval can never apply to text the user did not see.
 *
 * Plain TypeScript, no XR. Plans are immutable: every change returns a new one.
 */
import {
  clockRange,
  dayLabel,
  schedule,
  slotLabel,
  type CalendarData,
  type Constraint,
  type Slot,
} from './scheduler.js';

export const DEMO_TASK = 'Find a time for my app tester call and draft the invite';

export type Approval = 'needs' | 'approved';

export interface Invite {
  /** The slot this text was written for. */
  slotId: string;
  to: string;
  subject: string;
  body: string;
  /** 'rules' = template; 'ai' = written by the language model (Day 4). */
  source: 'rules' | 'ai';
}

export interface Plan {
  task: string;
  constraint: Constraint;
  /** What the user said, e.g. "only after 4 PM". Empty when no rule. */
  constraintText: string;
  slot: Slot | null;
  alternatives: Slot[];
  reason: string;
  invite: Invite | null;
  approval: Approval;
  /** Bumped on every change, so views know when to redraw. */
  version: number;
}

/** Template email for a slot. The AI may replace the body later; the facts stay the same. */
export function draftInvite(cal: CalendarData, slot: Slot): Invite {
  const day = dayLabel(slot.day);
  const time = `${clockRange(slot.start, slot.end)} ${cal.timezone}`;
  return {
    slotId: slot.id,
    to: `${cal.guest.name} <${cal.guest.email}>`,
    subject: `App test call: ${slotLabel(slot, cal.timezone)}`,
    body: [
      `Hi ${cal.guest.name},`,
      '',
      `Could we do a ${slot.end - slot.start}-minute call on ${day.long}, ${time}, to go through your app test notes?`,
      '',
      "I'll send the link once you confirm.",
      '',
      'Thanks,',
      cal.owner.name,
    ].join('\n'),
    source: 'rules',
  };
}

/** Run the task: pick the best slot for the rule and draft the invite for it. */
export function makePlan(
  cal: CalendarData,
  constraint: Constraint = {},
  constraintText = '',
  previous?: Plan,
): Plan {
  const result = schedule(cal, constraint);
  return {
    task: previous?.task ?? DEMO_TASK,
    constraint,
    constraintText,
    slot: result.best,
    alternatives: result.alternatives,
    reason: result.reason,
    invite: result.best ? draftInvite(cal, result.best) : null,
    approval: 'needs',
    version: (previous?.version ?? 0) + 1,
  };
}

/**
 * The user picks another slot (e.g. drags an alternative onto the invite).
 * The old best slot becomes an alternative; the invite is rewritten.
 */
export function chooseSlot(cal: CalendarData, plan: Plan, slot: Slot): Plan {
  if (plan.slot && plan.slot.id === slot.id) return plan;
  const alternatives = [plan.slot, ...plan.alternatives]
    .filter((s): s is Slot => s !== null && s.id !== slot.id)
    .slice(0, 2);
  return {
    ...plan,
    slot,
    alternatives,
    reason: 'You picked this time.',
    invite: draftInvite(cal, slot),
    approval: 'needs',
    version: plan.version + 1,
  };
}

/** True when the invite text belongs to the slot shown (the link is intact). */
export function isLinked(plan: Plan): boolean {
  return plan.slot === null ? plan.invite === null : plan.invite?.slotId === plan.slot.id;
}

/** An approved invite in the demo outbox. Nothing is ever really sent. */
export interface OutboxItem {
  id: string;
  to: string;
  subject: string;
  body: string;
  slotId: string;
  /** ISO time the user approved it (real clock, for display). */
  approvedAt: string;
}

/**
 * Approve the invite on the board. Returns null when there is nothing to
 * approve (no invite, or it is already approved), so a double pinch can never
 * put two copies in the outbox.
 */
export function approve(plan: Plan, approvedAt: string): { plan: Plan; item: OutboxItem } | null {
  if (!plan.invite || plan.approval !== 'needs' || !isLinked(plan)) return null;
  const item: OutboxItem = {
    id: `${plan.invite.slotId}#v${plan.version}`,
    to: plan.invite.to,
    subject: plan.invite.subject,
    body: plan.invite.body,
    slotId: plan.invite.slotId,
    approvedAt,
  };
  return { plan: { ...plan, approval: 'approved', version: plan.version + 1 }, item };
}

/** Newest first, no duplicates, at most `max` items. */
export function addToOutbox(outbox: OutboxItem[], item: OutboxItem, max = 5): OutboxItem[] {
  return [item, ...outbox.filter((o) => o.id !== item.id)].slice(0, max);
}
