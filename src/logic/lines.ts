/**
 * What the agent says out loud: one short sentence at a key moment, never a
 * paragraph. Plain TypeScript (the speaking itself is in ui/voice-out.ts), so the
 * words are unit-tested.
 */
import { clock, dayLabel, type Slot } from './scheduler.js';

export type SpokenMoment =
  | { kind: 'planned'; slot: Slot; guest: string }
  | { kind: 'planned-focus'; slot: Slot }
  | { kind: 'sent' }
  | { kind: 'unsent' }
  | { kind: 'offer-prep' }
  | { kind: 'offer-remind'; guest: string }
  | { kind: 'conflict'; guest: string }
  | { kind: 'replanned'; slot: Slot }
  | { kind: 'rule-removed'; rule: string }
  | { kind: 'moved' };

/** "Wednesday at 5:30 PM" (words a voice reads well). */
export function spokenTime(slot: Slot): string {
  return `${dayLabel(slot.day).weekday} at ${clock(slot.start)}`;
}

export function lineFor(m: SpokenMoment): string {
  switch (m.kind) {
    case 'planned':
      return `${spokenTime(m.slot)} works for you and ${m.guest}. Pinch and hold the card to send it.`;
    case 'planned-focus':
      return `${spokenTime(m.slot)} is free for two hours. Pinch and hold the card to block it.`;
    case 'sent':
      return 'Sent to the demo outbox.';
    case 'unsent':
      return 'Unsent. Nothing left.';
    case 'offer-prep':
      return 'Want a ten minute prep block before the call?';
    case 'offer-remind':
      return `Should I remind ${m.guest} an hour before?`;
    case 'conflict':
      return `${m.guest} just got busy at that time. Want me to re-plan?`;
    case 'replanned':
      return `Moved to ${spokenTime(m.slot)}. It needs your hold again.`;
    case 'rule-removed':
      return `Okay, ${m.rule} is gone. Here is the new best time.`;
    case 'moved':
      return 'Board moved.';
  }
}
