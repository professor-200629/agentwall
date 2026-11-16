import { existsSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { afterSendLine, CLIP_IDS, CLIP_TEXT, lineFor } from '../src/logic/lines.js';

describe('what the agent says out loud (pre-recorded clips)', () => {
  it('one short fixed sentence per moment', () => {
    for (const id of CLIP_IDS) {
      expect(CLIP_TEXT[id].length).toBeGreaterThan(5);
      expect(CLIP_TEXT[id].length).toBeLessThan(90);
      expect(lineFor(id)).toEqual({ id, text: CLIP_TEXT[id] });
    }
  });

  it('after sending: "Sent." plus the first offer, or just "Sent to the demo outbox."', () => {
    expect(afterSendLine('prep').text).toBe('Sent. Want a ten minute prep block before the call?');
    expect(afterSendLine('remind').text).toBe('Sent. Should I remind Sam an hour before?');
    expect(afterSendLine(null).id).toBe('sent');
  });

  it('every line has its clip in public/voice (Quest Browser has no speech voice, 16 Nov)', () => {
    for (const id of CLIP_IDS) {
      const file = `public/voice/${id}.mp3`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(4000);
    }
  });
});
