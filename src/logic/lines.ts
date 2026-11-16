/**
 * What the agent says out loud: one short, FIXED sentence per moment, so each one
 * can ship as a small pre-recorded clip (public/voice/<id>.mp3) played through
 * Web Audio, the same path as the chimes.
 *
 * Why fixed: the first real Quest test (steve40, 16 Nov) heard the chimes but no
 * voice. Quest Browser's speechSynthesis stays silent, so the browser voice is
 * only a fallback now. The times are on the board; the voice says what happened.
 * Plain TypeScript, unit-tested.
 */

export const CLIP_TEXT = {
  planned: 'I found a time that works for you both. Pinch and hold the card to send it.',
  'planned-focus': 'I found two free hours for you. Pinch and hold the card to block them.',
  sent: 'Sent to the demo outbox.',
  'sent-offer-prep': 'Sent. Want a ten minute prep block before the call?',
  'offer-prep': 'Want a ten minute prep block before the call?',
  'sent-offer-remind': 'Sent. Should I remind Sam an hour before?',
  'offer-remind': 'Should I remind Sam an hour before?',
  unsent: 'Unsent. Nothing left.',
  conflict: 'Sam just got busy at that time. Want me to re-plan?',
  replanned: 'I moved it to a new time. It needs your hold again.',
  'rule-removed': 'Okay, that rule is gone. Here is the new best time.',
  moved: 'Board moved.',
  summon: 'Here you go.',
  'voice-on': 'Voice on.',
} as const;

export type ClipId = keyof typeof CLIP_TEXT;
export const CLIP_IDS = Object.keys(CLIP_TEXT) as ClipId[];

export interface SpokenLine {
  id: ClipId;
  text: string;
}

export function lineFor(id: ClipId): SpokenLine {
  return { id, text: CLIP_TEXT[id] };
}

/** The line after an invite is sent: "Sent." plus the first offer, or just "Sent". */
export function afterSendLine(offer: 'prep' | 'remind' | null): SpokenLine {
  return lineFor(offer === 'prep' ? 'sent-offer-prep' : offer === 'remind' ? 'sent-offer-remind' : 'sent');
}
