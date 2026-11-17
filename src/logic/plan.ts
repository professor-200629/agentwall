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
import { focusBlock, isFocus } from './focus.js';
import { moveNote } from './move.js';
import {
  clock,
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

/** One of your own meetings that the plan is moving (the third task). */
export interface Moving {
  day: string;
  /** Minutes after midnight, where the meeting is now. */
  start: number;
  end: number;
  title: string;
}

export interface Plan {
  task: string;
  /** Set when the task is "move this meeting": the meeting, where it is now. */
  moving?: Moving;
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
  /** Who made this plan, shown on the board so the user knows. */
  by: 'ai' | 'rules' | 'you';
  /** Why the rules were used instead of the AI, when that happened. */
  note: string;
  /** Set on a replacement: the id of the approved item whose time no longer fits. */
  replaces?: string;
}

/** Optional overrides when the AI chose the slot or wrote the email. */
export interface PlanOptions {
  slot?: Slot;
  reason?: string;
  body?: string;
  by?: Plan['by'];
  note?: string;
}

/** Template email for a slot. The AI may replace the body later; the facts stay the same. */
export function draftInvite(cal: CalendarData, slot: Slot): Invite {
  const day = dayLabel(slot.day);
  const time = `${clockRange(slot.start, slot.end)} ${cal.timezone}`;
  // The sample week is about an app test call. Your own calendar uses the topic you gave, or none.
  const yours = cal.source === 'yours';
  const title = yours ? (cal.topic ? `Call about ${cal.topic}` : 'Call') : 'App test call';
  const purpose = yours ? (cal.topic ? `, to talk about ${cal.topic}` : '') : ', to go through your app test notes';
  return {
    slotId: slot.id,
    to: cal.guest.email ? `${cal.guest.name} <${cal.guest.email}>` : cal.guest.name,
    subject: `${title}: ${slotLabel(slot, cal.timezone)}`,
    body: [
      `Hi ${cal.guest.name},`,
      '',
      `Could we do a ${slot.end - slot.start}-minute call on ${day.long}, ${time}${purpose}?`,
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
  opts: PlanOptions = {},
): Plan {
  const result = schedule(cal, constraint);
  const slot = opts.slot ?? result.best;
  // Alternatives: the scheduler's other good options, minus the chosen slot.
  const others = [result.best, ...result.alternatives].filter(
    (s): s is Slot => s !== null && s.id !== slot?.id,
  );
  const seen = new Set<string>();
  const alternatives = others.filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 2);
  let invite = slot ? draftInvite(cal, slot) : null;
  if (invite && opts.body) invite = { ...invite, body: opts.body, source: 'ai' };
  return {
    task: DEMO_TASK, // makePlan is the meeting planner (focus.ts makes focus plans)
    constraint,
    constraintText,
    slot,
    alternatives,
    reason: opts.reason ?? result.reason,
    invite,
    approval: 'needs',
    version: (previous?.version ?? 0) + 1,
    by: opts.by ?? 'rules',
    note: opts.note ?? '',
  };
}

/**
 * The user picks another slot (e.g. drags an alternative onto the invite).
 * The old best slot becomes an alternative; the invite is rewritten.
 */
export function chooseSlot(cal: CalendarData, plan: Plan, slot: Slot): Plan {
  if (plan.slot && plan.slot.id === slot.id) return plan;
  // The time you leave becomes a runner-up only while it was still open: one that is approved
  // (it is held now) or blocked by a conflict is not "also free".
  const alternatives = [plan.approval === 'needs' ? plan.slot : null, ...plan.alternatives]
    .filter((s): s is Slot => s !== null && s.id !== slot.id)
    .slice(0, 2);
  return {
    ...plan,
    slot,
    alternatives,
    reason: 'You picked this time.',
    invite: plan.moving ? moveNote(cal, plan.moving, slot) : isFocus(plan) ? focusBlock(cal, slot) : draftInvite(cal, slot),
    approval: 'needs',
    version: plan.version + 1,
    by: 'you',
    note: '',
  };
}

/** True when the invite text belongs to the slot shown (the link is intact). */
export function isLinked(plan: Plan): boolean {
  return plan.slot === null ? plan.invite === null : plan.invite?.slotId === plan.slot.id;
}

export type ItemKind = 'call' | 'focus' | 'move' | 'reminder';

/**
 * Why an approved item must not be handed off any more.
 * - conflict: the latest calendar has a busy time over it (stays until you replace it)
 * - superseded: you approved a replacement (for good)
 * - source: it was approved on another calendar than the one in use
 * - changed: the stored words are not the words you held
 */
export interface Blocked {
  why: 'conflict' | 'superseded' | 'source' | 'changed';
  /** One plain line, e.g. "Tue 1:00 PM overlaps a new busy block". */
  text: string;
  /** ISO time it was found. */
  at: string;
  /** superseded: the id of the approval that replaced this one. */
  by?: string;
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
  /** How long the event lasts, for the calendar file. */
  minutes?: number;
  /** 'sending' during the Unsend window, then 'sent' (into the demo outbox). */
  status?: 'sending' | 'sent';
  /** What the rules, the AI and the user each did (shown on the desk card). */
  receipt?: ReceiptLine[];
  /** What was approved: a call, a focus block, a moved meeting, a reminder. */
  kind?: ItemKind;
  /** The calendar it was approved on. Older records have none (see review.ts). */
  source?: 'sample' | 'yours';
  /** A mark of exactly the words and time on the card when you held it. */
  reviewed?: string;
  /** The approved start as a moment in time (ISO, UTC): the calendar file means this instant anywhere. */
  startUtc?: string;
  /** The rule in force when you approved; a replacement is looked for inside it. */
  rule?: Constraint;
  /** The approved item this one replaced after a conflict. */
  replaces?: string;
  /** Set while the item must not be handed off. */
  blocked?: Blocked;
  /** The labelled example approval that "Try a calendar change" puts there. You did not hold it. */
  example?: boolean;
}

/** FNV-1a over the text, as 8 hex characters. Not a secret: it only notices a change. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The mark of what was reviewed: who, the words, the time and the length. */
export function reviewedMark(item: Pick<OutboxItem, 'to' | 'subject' | 'body' | 'slotId' | 'minutes'>): string {
  return fnv(JSON.stringify([item.to, item.subject, item.body, item.slotId, item.minutes ?? null]));
}

export interface ReceiptLine {
  tag: 'RULES' | 'AI' | 'YOU' | 'DEMO';
  text: string;
}

/** Seconds the user has to pull an approved invite back. */
export const UNSEND_SECONDS = 5;

/** Undo an approval inside the Unsend window: the invite needs approval again. */
export function unapprove(plan: Plan): Plan {
  if (plan.approval !== 'approved') return plan;
  return { ...plan, approval: 'needs', version: plan.version + 1 };
}

export function removeFromOutbox(outbox: OutboxItem[], id: string): OutboxItem[] {
  return outbox.filter((o) => o.id !== id);
}

/** The finished receipt: five short lines tagged by who did what. */
export function buildReceipt(
  cal: CalendarData,
  plan: Plan,
  ruledOut: number,
  approvedLabel: string,
  /** A replacement: the old time it took over from, e.g. "Tue 1:00 PM". */
  replaced = '',
): ReceiptLine[] {
  const first = dayLabel(cal.days[0]);
  const last = dayLabel(cal.days[cal.days.length - 1]);
  const pick = plan.slot ? `${dayLabel(plan.slot.day).short.split(' ')[0]} ${clock(plan.slot.start)}` : 'no time';
  const picked: ReceiptLine =
    plan.by === 'you'
      ? { tag: 'YOU', text: `You picked ${pick}.` }
      : plan.by === 'ai'
        ? { tag: 'AI', text: `Picked ${pick}${plan.invite?.source === 'ai' ? ' and wrote the email' : ''}.` }
        : { tag: 'RULES', text: `Picked ${pick} and ${plan.moving ? 'drafted the calendar change' : isFocus(plan) ? 'drafted the calendar block' : 'wrote the email'}.` };
  return [
    { tag: 'RULES', text: `Read ${cal.source === 'yours' ? 'your own week' : 'the sample week'} (${first.short.split(' ')[0]} ${first.short.split(' ')[1]}–${last.short.split(' ')[0]} ${last.short.split(' ')[1]} ${last.short.split(' ')[2]}).` },
    replaced
      ? { tag: 'RULES', text: `Blocked the old one (${replaced}): that time is busy now.` }
      : { tag: 'RULES', text: `Ruled out ${ruledOut} half hours: busy, too soon or your rule.` },
    picked,
    { tag: 'YOU', text: `Held to approve at ${approvedLabel}.` },
    { tag: 'DEMO', text: 'In the demo outbox. Nothing was sent.' },
  ];
}

/**
 * Approve the invite on the board. Returns null when there is nothing to
 * approve (no invite, or it is already approved), so a double pinch can never
 * put two copies in the outbox.
 */
export function approve(
  plan: Plan,
  approvedAt: string,
  ctx: { source?: 'sample' | 'yours'; startUtc?: string | null; example?: boolean } = {},
): { plan: Plan; item: OutboxItem } | null {
  if (!plan.invite || plan.approval !== 'needs' || !isLinked(plan)) return null;
  const item: OutboxItem = {
    id: `${plan.invite.slotId}#v${plan.version}`,
    to: plan.invite.to,
    subject: plan.invite.subject,
    body: plan.invite.body,
    slotId: plan.invite.slotId,
    approvedAt,
    minutes: plan.slot ? plan.slot.end - plan.slot.start : undefined,
    kind: plan.moving ? 'move' : isFocus(plan) ? 'focus' : 'call',
    rule: plan.constraint,
  };
  // The approval belongs to these exact words and this exact time, on this calendar.
  item.reviewed = reviewedMark(item);
  if (ctx.source) item.source = ctx.source;
  if (ctx.startUtc) item.startUtc = ctx.startUtc;
  if (ctx.example) item.example = true;
  if (plan.replaces) item.replaces = plan.replaces;
  return { plan: { ...plan, approval: 'approved', version: plan.version + 1 }, item };
}

/**
 * An id is used once. An item's id is its time plus the plan's version, and the version counts
 * from 1 again after a fresh start: a later approval for the same time could get the id of an
 * older item, and inherit its history ("replaced by ..." would land on the new approval).
 * Returns `id`, or `id.2`, `id.3`, ... when an item has that id or names it as the one it replaced.
 */
export function freshId(outbox: OutboxItem[], id: string): string {
  const taken = (x: string) => outbox.some((o) => o.id === x || o.replaces === x || o.blocked?.by === x);
  let out = id;
  for (let n = 2; taken(out) && n < 1000; n++) out = `${id}.${n}`;
  return out;
}

/** Newest first, no duplicates, at most `max` items. */
export function addToOutbox(outbox: OutboxItem[], item: OutboxItem, max = 5): OutboxItem[] {
  return [item, ...outbox.filter((o) => o.id !== item.id)].slice(0, max);
}
