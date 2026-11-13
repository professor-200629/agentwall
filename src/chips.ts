/**
 * Preset chips: the always-available way to talk to the agent (voice is the
 * other). Each chip just "says" a sentence; the same text goes through the
 * AI or the rules, exactly like a voice transcript.
 */
import { DEMO_TASK } from './logic/plan.js';

export interface Chip {
  id: string;
  label: string;
  /** What pinching the chip says to the agent. Empty for the mic chip. */
  say: string;
}

export const CHIPS: Chip[] = [
  { id: 'task', label: 'Find time + draft invite', say: DEMO_TASK },
  { id: 'after4', label: 'Only after 4 PM', say: 'only after 4 PM' },
  { id: 'thu', label: 'Thursday', say: 'Thursday only' },
  { id: 'notwed', label: 'Not Wed', say: 'not Wednesday' },
  { id: 'any', label: 'Any time', say: 'any time' },
  { id: 'mic', label: '🎤 Speak', say: '' },
];

export type ChipLook = 'normal' | 'hover' | 'active' | 'disabled' | 'listening' | 'busy';
