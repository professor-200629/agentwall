/**
 * Save and restore the board (plan + demo outbox) as JSON, e.g. in
 * localStorage, so reopening the app shows yesterday's board.
 *
 * Restoring never trusts the stored data: anything malformed, from another
 * version, or whose invite no longer matches its slot is dropped.
 * Plain TypeScript, unit-tested.
 */
import { FOCUS_TASK, focusWindows } from './focus.js';
import { isLinked, type OutboxItem, type Plan } from './plan.js';
import { checkedMoving, moveWindows } from './move.js';
import { freeSlots, type CalendarData, type Slot } from './scheduler.js';

export const STORAGE_KEY = 'agentwall.board.v1';
const VERSION = 1;

export interface SavedBoard {
  v: number;
  savedAt: string;
  plan: Plan | null;
  outbox: OutboxItem[];
}

export function serialize(plan: Plan | null, outbox: OutboxItem[], savedAt: string): string {
  const data: SavedBoard = { v: VERSION, savedAt, plan, outbox: outbox.slice(0, 5) };
  return JSON.stringify(data);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isStr = (v: unknown): v is string => typeof v === 'string';

function slotOk(v: unknown, known: Map<string, Slot>): v is Slot {
  return isObj(v) && isStr(v.id) && known.has(v.id);
}

function outboxOk(v: unknown): v is OutboxItem {
  return isObj(v) && ['id', 'to', 'subject', 'body', 'slotId', 'approvedAt'].every((k) => isStr(v[k]));
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
  const outbox = Array.isArray(data.outbox) ? data.outbox.filter(outboxOk).slice(0, 5) : [];

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
    const candidate = {
      ...(p as unknown as Plan),
      ...(moving ? { moving } : {}),
      slot: p.slot === null ? null : known.get((p.slot as Slot).id)!,
      alternatives: (p.alternatives as Slot[]).map((a) => known.get(a.id)!),
      by: (['ai', 'rules', 'you'] as const).includes(p.by as Plan['by']) ? (p.by as Plan['by']) : 'rules',
      note: isStr(p.note) ? p.note : '',
    };
    const inviteOk =
      candidate.invite === null ||
      (isObj(candidate.invite) && ['slotId', 'to', 'subject', 'body'].every((k) => isStr((candidate.invite as unknown as Record<string, unknown>)[k])));
    if (inviteOk && isLinked(candidate)) plan = candidate;
  }
  if (!plan && outbox.length === 0) return null;
  return { v: VERSION, savedAt: data.savedAt, plan, outbox };
}
