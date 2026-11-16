/**
 * Save and restore the board (plan + demo outbox) as JSON, e.g. in
 * localStorage, so reopening the app shows yesterday's board.
 *
 * Restoring never trusts the stored data: anything malformed, from another
 * version, or whose invite no longer matches its slot is dropped. An approved
 * item keeps only fields that are checked here; whether it may still be handed
 * off is decided again from the calendar (review.ts), never from this file alone.
 * Plain TypeScript, unit-tested.
 */
import { cleanExample, withExample } from './example-change.js';
import { FOCUS_TASK, focusWindows } from './focus.js';
import { isLinked, type Blocked, type ItemKind, type OutboxItem, type Plan, type ReceiptLine } from './plan.js';
import { checkedMoving, moveWindows } from './move.js';
import { freeSlots, type BusyBlock, type CalendarData, type Constraint, type Slot } from './scheduler.js';

export const STORAGE_KEY = 'agentwall.board.v1';
const VERSION = 1;
const MAX_ITEMS = 5;

export interface SavedBoard {
  v: number;
  savedAt: string;
  plan: Plan | null;
  outbox: OutboxItem[];
  /** The labelled example change's busy blocks (sample week only), so a conflict is still shown after a reload. */
  example: BusyBlock[];
}

export function serialize(plan: Plan | null, outbox: OutboxItem[], savedAt: string, example: BusyBlock[] = []): string {
  const data: SavedBoard = { v: VERSION, savedAt, plan, outbox: outbox.slice(0, MAX_ITEMS), example };
  return JSON.stringify(data);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isStr = (v: unknown): v is string => typeof v === 'string';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: ItemKind[] = ['call', 'focus', 'move', 'reminder'];
const WHYS: Array<Blocked['why']> = ['conflict', 'superseded', 'source', 'changed'];
const TAGS: Array<ReceiptLine['tag']> = ['RULES', 'AI', 'YOU', 'DEMO'];

function slotOk(v: unknown, known: Map<string, Slot>): v is Slot {
  return isObj(v) && isStr(v.id) && known.has(v.id);
}

/** A stored rule, kept only where it is well-formed. */
export function cleanRule(v: unknown): Constraint {
  const out: Constraint = {};
  if (!isObj(v)) return out;
  const minute = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 24 * 60;
  if (minute(v.after)) out.after = v.after as number;
  if (minute(v.before)) out.before = v.before as number;
  if (isStr(v.day) && DAY.test(v.day)) out.day = v.day;
  if (Array.isArray(v.notDays)) {
    const days = v.notDays.filter((d): d is string => isStr(d) && DAY.test(d)).slice(0, 7);
    if (days.length) out.notDays = days;
  }
  return out;
}

/** One approved item as read back: the six base fields must be text; the rest is kept only when valid. */
function cleanItem(v: unknown): OutboxItem | null {
  if (!isObj(v) || !['id', 'to', 'subject', 'body', 'slotId', 'approvedAt'].every((k) => isStr(v[k]))) return null;
  const item: OutboxItem = {
    id: v.id as string,
    to: v.to as string,
    subject: v.subject as string,
    body: v.body as string,
    slotId: v.slotId as string,
    approvedAt: v.approvedAt as string,
  };
  if (typeof v.minutes === 'number') item.minutes = v.minutes;
  if (v.status === 'sending' || v.status === 'sent') item.status = v.status;
  if (Array.isArray(v.receipt)) {
    item.receipt = v.receipt
      .filter((r): r is ReceiptLine => isObj(r) && TAGS.includes(r.tag as ReceiptLine['tag']) && isStr(r.text))
      .slice(0, 6)
      .map((r) => ({ tag: r.tag, text: r.text.slice(0, 200) }));
  }
  if (KINDS.includes(v.kind as ItemKind)) item.kind = v.kind as ItemKind;
  if (v.source === 'sample' || v.source === 'yours') item.source = v.source;
  if (isStr(v.reviewed) && /^[0-9a-f]{8}$/.test(v.reviewed)) item.reviewed = v.reviewed;
  if (isStr(v.startUtc) && !Number.isNaN(Date.parse(v.startUtc))) item.startUtc = v.startUtc;
  if (isObj(v.rule)) item.rule = cleanRule(v.rule);
  if (isStr(v.replaces)) item.replaces = v.replaces.slice(0, 80);
  const b = v.blocked;
  if (isObj(b) && WHYS.includes(b.why as Blocked['why']) && isStr(b.text) && isStr(b.at)) {
    item.blocked = { why: b.why as Blocked['why'], text: b.text.slice(0, 160), at: b.at };
    if (isStr(b.by)) item.blocked.by = b.by.slice(0, 80);
  }
  if (v.example === true) item.example = true;
  return item;
}

/** Parse saved JSON. Returns null when there is nothing usable. */
export function restore(json: string | null, cal: CalendarData): SavedBoard | null {
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isObj(data) || data.v !== VERSION || !isStr(data.savedAt)) return null;
  const outbox = Array.isArray(data.outbox)
    ? data.outbox.map(cleanItem).filter((o): o is OutboxItem => o !== null).slice(0, MAX_ITEMS)
    : [];
  // The example change belongs to the sample week; the plan is checked against the week as it was shown.
  const example = cal.source === 'yours' ? [] : cleanExample(data.example);
  cal = withExample(cal, example);

  // Slots are re-read from the calendar, so a tampered time cannot sneak in.
  const isFocusPlan = isObj(data.plan) && data.plan.task === FOCUS_TASK;
  // A "move this meeting" plan is believed only if that meeting is really on the calendar.
  const moving = isObj(data.plan) && data.plan.moving !== undefined ? checkedMoving(cal, data.plan.moving) : null;
  if (isObj(data.plan) && data.plan.moving !== undefined && !moving) data.plan = null;
  const known = new Map(
    (moving ? moveWindows(cal, moving) : isFocusPlan ? focusWindows(cal) : freeSlots(cal)).map((s) => [s.id, s]),
  );
  let plan: Plan | null = null;
  const p = data.plan;
  if (
    isObj(p) &&
    isStr(p.task) &&
    isObj(p.constraint) &&
    isStr(p.constraintText) &&
    (p.approval === 'needs' || p.approval === 'approved') &&
    typeof p.version === 'number' &&
    (p.slot === null || slotOk(p.slot, known)) &&
    Array.isArray(p.alternatives) &&
    p.alternatives.every((a) => slotOk(a, known))
  ) {
    const candidate: Plan = {
      ...(p as unknown as Plan),
      ...(moving ? { moving } : {}),
      slot: p.slot === null ? null : known.get((p.slot as Slot).id)!,
      alternatives: (p.alternatives as Slot[]).map((a) => known.get(a.id)!),
      by: (['ai', 'rules', 'you'] as const).includes(p.by as Plan['by']) ? (p.by as Plan['by']) : 'rules',
      note: isStr(p.note) ? p.note : '',
    };
    if (isStr(p.replaces)) candidate.replaces = p.replaces.slice(0, 80);
    else delete candidate.replaces;
    const inviteOk =
      candidate.invite === null ||
      (isObj(candidate.invite) && ['slotId', 'to', 'subject', 'body'].every((k) => isStr((candidate.invite as unknown as Record<string, unknown>)[k])));
    if (inviteOk && isLinked(candidate)) plan = candidate;
  }
  if (!plan && outbox.length === 0) return null;
  return { v: VERSION, savedAt: data.savedAt, plan, outbox, example };
}
