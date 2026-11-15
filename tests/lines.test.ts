import { describe, expect, it } from 'vitest';
import calendarJson from '../src/data/sample-calendar.json';
import { lineFor, spokenTime } from '../src/logic/lines.js';
import { schedule, type CalendarData, type Slot } from '../src/logic/scheduler.js';

const cal = calendarJson as CalendarData;
const best = schedule(cal, {}).best as Slot; // Tue 1:00 PM
const wed = schedule(cal, { after: 16 * 60 }).best as Slot; // Wed 5:30 PM

describe('what the agent says out loud', () => {
  it('reads times the way people say them', () => {
    expect(spokenTime(best)).toBe('Tuesday at 1:00 PM');
    expect(spokenTime(wed)).toBe('Wednesday at 5:30 PM');
  });

  it('one short sentence per moment', () => {
    expect(lineFor({ kind: 'planned', slot: wed, guest: 'Sam' })).toBe(
      'Wednesday at 5:30 PM works for you and Sam. Pinch and hold the card to send it.',
    );
    expect(lineFor({ kind: 'conflict', guest: 'Sam' })).toBe('Sam just got busy at that time. Want me to re-plan?');
    expect(lineFor({ kind: 'rule-removed', rule: 'after 4 PM' })).toBe('Okay, after 4 PM is gone. Here is the new best time.');
    for (const kind of ['sent', 'unsent', 'offer-prep', 'moved'] as const) {
      const line = lineFor({ kind });
      expect(line.length).toBeGreaterThan(5);
      expect(line.length).toBeLessThan(90);
    }
  });
});
